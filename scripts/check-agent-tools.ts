// Headless only. Use a disposable runtime directory with an installed copy of Zen.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { agentProfile, alive, prepareProfile } from "../src/profiles.ts";
import { call } from "../src/zen.ts";
import { approveWhile, pageEval } from "./support/fixture.ts";

const runtime = process.env.XDG_RUNTIME_DIR;
assert(runtime && (fs.statSync(runtime).mode & 0o777) === 0o700, "Use a private disposable XDG_RUNTIME_DIR.");
for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"])
  assert(process.env[key]?.startsWith(runtime + "/"), `${key} must be inside the disposable XDG_RUNTIME_DIR.`);
const binary = fs.realpathSync(process.argv[2] ?? "");
assert(binary.startsWith(runtime + "/"), "Copy Zen into the disposable runtime directory.");
const workspace = fs.mkdtempSync(path.join(runtime, "tools-"));
const profile = agentProfile(path.dirname(binary));
assert(!fs.existsSync(profile), "Use a fresh disposable agent profile.");
const children: ReturnType<typeof spawn>[] = [];
const tabs = new Set<number>();
const results = new Set<string>();

async function run(name: string, args: object = {}) {
  const result = await call(name, args, 35_000);
  const text = result.map((item) => ("text" in item ? item.text : "")).join("\n");
  assert(!result.isError, text);
  return text;
}

async function start(dir: string, mode: string) {
  prepareProfile(dir);
  process.env.ZEN_MCP_SOCKET = path.join(workspace, mode + ".sock");
  const child = spawn(binary, ["--headless", "--no-remote", "--new-instance", "--profile", dir], {
    env: process.env,
    detached: true,
    stdio: ["ignore", "ignore", "inherit"],
  });
  children.push(child);
  const deadline = Date.now() + 15_000;
  while (child.pid && alive(child.pid) && Date.now() < deadline) {
    if (fs.existsSync(process.env.ZEN_MCP_SOCKET)) {
      const reply = await run("chrome_eval", {
        code: "h.browserWindows().some(win => win.gBrowser && win.gBrowserInit?.delayedStartupFinished) ? h.browserMode : null",
      }).catch(() => "");
      if (reply === mode) {
        return;
      }
    }
    await sleep(100);
  }
  throw new Error(`Headless ${mode} browser did not start.`);
}

const json = async (name: string, args: object = {}) => JSON.parse(await run(name, args));
let requests = 0;
let mockRequests = 0;
const fixture = http.createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (request.url?.startsWith("/api/")) {
    if (request.url.startsWith("/api/mock")) mockRequests++;
    response.setHeader("Content-Type", "text/plain");
    response.end("online");
    return;
  }
  if (request.url !== "/") {
    response.writeHead(404).end();
    return;
  }
  response.setHeader("Content-Type", "text/html");
  response.end(`<!doctype html><title>Agent tools fixture</title><h1>Page request ${++requests}</h1>
    <label>Fixture input <input></label>
    <style>i{display:block;width:70px;height:70px;background:teal;animation:slide .75s linear infinite alternate}
    @keyframes slide{to{transform:translateX(150px) rotate(90deg)}}</style><i></i>`);
});
try {
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const address = fixture.address();
  assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/`;
  const open = async () => {
    const { tabId } = await json("tabs_create_mcp", { clean: true });
    tabs.add(tabId);
    await run("navigate", { tabId, url });
    return tabId;
  };
  await start(path.join(workspace, "together"), "together");
  const togetherTab = await open();
  await assert.rejects(run("cookies", { action: "set", tabId: togetherTab }), /requires an agent browser mode/);
  await assert.rejects(run("storage", { action: "get", tabId: togetherTab }), /requires an agent browser mode/);
  await assert.rejects(
    run("browser_batch", { actions: [{ name: "cookies", input: { action: "list", tabId: togetherTab } }] }),
    /requires an agent browser mode/,
  );
  await run("tabs_close_mcp", { tabId: togetherTab });
  tabs.delete(togetherTab);
  console.log("✓ Together mode rejects cookie and storage access");

  await start(profile, "agent");
  const tabId = await open();
  const second = await open();
  const pageRequest = requests;
  const reload = await run("navigate", { tabId, url: "reload", bypass_cache: true, read: "all" });
  assert.match(reload, new RegExp(`Page request ${pageRequest + 1}`));
  await run("navigate", { tabId, url: "reload" });
  assert.equal(requests, pageRequest + 2);
  console.log("✓ Reload and bypass-cache reload use the current URL and can return page refs");

  const pdf = await json("save_pdf", { tabId });
  results.add(pdf.path);
  assert(path.isAbsolute(pdf.path));
  assert.equal(fs.statSync(pdf.path).size, pdf.bytes);
  assert.equal(fs.statSync(pdf.path).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(pdf.path).subarray(0, 5).toString(), "%PDF-");
  console.log("✓ Headless print produced a non-empty private PDF");

  const cookies = (args: object) => json("cookies", { tabId, ...args });
  const name = "agentCookie";
  const expires = Math.floor(Date.now() / 1000) + 60;
  await cookies({ action: "set", name, value: "sample", http_only: true, expires });
  const listed = await cookies({ action: "list", url });
  assert(listed.untrusted);
  const cookie = listed.cookies.find((entry: any) => entry.name === name);
  assert.deepEqual(cookie && [cookie.value, cookie.http_only, cookie.expires], ["sample", true, expires]);
  assert(!String(await pageEval(tabId, "document.cookie")).includes(name));
  await cookies({ action: "delete", name });
  assert(!(await cookies({ action: "list" })).cookies.some((entry: any) => entry.name === name));
  for (const area of ["local", "session"]) {
    const storage = (args: object) => json("storage", { tabId, area, ...args });
    await storage({ action: "set", key: "a", value: "fixture" });
    assert.deepEqual(await storage({ action: "get", key: "a" }), { untrusted: true, value: "fixture" });
    await storage({ action: "remove", key: "a" });
    assert.equal((await storage({ action: "get", key: "a" })).value, null);
    await storage({ action: "set", key: "b", value: "clear me" });
    await storage({ action: "clear" });
    assert.equal((await storage({ action: "get", key: "b" })).value, null);
  }
  console.log("✓ Agent mode round-trips an HttpOnly cookie plus local and session storage");

  const network = (action: string, args: object = {}) =>
    approveWhile(json("network_control", { tabId, action, ...args }), `network rules (${action})`);
  const fetchFrom = async (id: number, route: string) =>
    JSON.parse(
      await pageEval(
        id,
        `fetch(${JSON.stringify(route)}, {cache:"no-store"})
      .then(async (r) => JSON.stringify([r.status, r.headers.get("content-type"), r.headers.get("x-fixture"), await r.text()]))
      .catch(() => JSON.stringify(null))`,
      ),
    );
  const online = [200, "text/plain", null, "online"];
  await network("block", { urlPattern: "/api/block" });
  assert.equal(await fetchFrom(tabId, "/api/block"), null);
  assert.deepEqual(await fetchFrom(second, "/api/block"), online);
  await network("mock", {
    urlPattern: "/api/mock",
    status: 418,
    content_type: "application/json",
    headers: { "X-Fixture": "override" },
    body: '{"fixture":"réponse"}',
  });
  assert.deepEqual(await fetchFrom(tabId, "/api/mock"), [
    418,
    "application/json; charset=utf-8",
    "override",
    '{"fixture":"réponse"}',
  ]);
  assert.equal(mockRequests, 0);
  assert.deepEqual(await fetchFrom(second, "/api/mock"), online);
  assert.equal(mockRequests, 1);
  await network("offline");
  assert.equal(await fetchFrom(tabId, "/api/online"), null);
  assert.deepEqual(await fetchFrom(second, "/api/online"), online);
  await network("clear");
  assert.deepEqual(await fetchFrom(tabId, "/api/block"), online);
  assert.deepEqual(await fetchFrom(tabId, "/api/mock"), online);
  console.log("✓ Block, native UTF-8 mock (status and header), and offline are tab-scoped; clear restores HTTP");
  await network("block", { urlPattern: "/api/block" });
  await run("navigate", { tabId, url: url.replace("127.0.0.1", "localhost") });
  await run("navigate", { tabId, url });
  assert.deepEqual(await fetchFrom(tabId, "/api/block"), online);
  console.log("✓ Cross-origin navigation clears the tab's rules");

  let ffmpeg = true;
  try {
    const version = execFileSync("ffmpeg", ["-version"], { encoding: "utf8" }).split("\n")[0];
    console.log(version);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    ffmpeg = false;
  }
  if (!ffmpeg) {
    await assert.rejects(run("record", { tabId, action: "start" }), /requires ffmpeg/);
    console.log("↷ Video playback skipped: ffmpeg is not installed");
  } else {
    await run("chrome_eval", {
      code: `(h.findTab(${tabId}).ownerDocument.defaultView.gBrowser.selectedTab = h.findTab(${tabId}), true)`,
    });
    const sample = () =>
      pageEval(
        tabId,
        `new Promise((resolve) => {
      const start = performance.now();
      let frames = 0;
      const sample = (now) => {
        frames++;
        if (performance.now() - start < 1500) requestAnimationFrame(sample);
        else resolve(String(frames * 1000 / (performance.now() - start)));
      };
      requestAnimationFrame(sample);
    })`,
      ).then(Number);
    const baseline = await sample();
    const started = await json("record", { tabId, action: "start", duration: 4 });
    results.add(started.path);
    const recording = await sample();
    const video = await json("record", { tabId, action: "stop" });
    assert.equal(video.path, started.path);
    assert(video.frames >= 4 && video.frames <= 16);
    assert.equal(video.fps, 4);
    assert(video.bytes > 0);
    execFileSync("ffmpeg", ["-v", "error", "-xerror", "-i", video.path, "-f", "null", "-"]);
    console.log("✓ ffmpeg decoded the headless recording");
    console.log(
      `  rAF ${baseline.toFixed(1)} → ${recording.toFixed(1)} fps; ${video.frames} snapshots, ${(video.captureMs / video.frames).toFixed(1)} ms per frame`,
    );
  }
} finally {
  for (const tabId of tabs) await run("tabs_close_mcp", { tabId }).catch(() => {});
  for (const child of children) {
    if (!child.pid || !alive(child.pid)) continue;
    const exited = once(child, "exit");
    process.kill(-child.pid, "SIGTERM");
    const escalation = setTimeout(() => {
      if (child.pid && alive(child.pid)) process.kill(-child.pid, "SIGKILL");
    }, 3000);
    try {
      await exited;
    } finally {
      clearTimeout(escalation);
    }
  }
  fixture.close();
  fixture.closeAllConnections();
  for (const file of results) fs.rmSync(file, { force: true });
  fs.rmSync(profile, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
