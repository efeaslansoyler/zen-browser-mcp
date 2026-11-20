// Real MCP download tracking test: click a link in a disposable tab, wait for the file, check
// state/path/sha256, ownership and the no-download timeout. Run: node scripts/check-downloads.ts
// Requires existing auto mode. Deletes only the files it downloaded and its own tab.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { call } from "../src/zen.ts";

const text = (result: Record<string, unknown>) =>
  (result.content as { type: string; text?: string }[])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
const chrome = async (code: string) => text({ content: await call("chrome_eval", { code }) });
const clients: Client[] = [],
  files: string[] = [];
let tabId: number | undefined;
const nativeDialog = process.argv.includes("--native-dialog");
async function tool(client: Client, name: string, args: Record<string, unknown> = {}, error = false) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 60_000 });
  assert.equal(Boolean(result.isError), error, text(result));
  return text(result);
}
async function connect(name: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const client = new Client({ name, version: "downloads-test" });
  clients.push(client);
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["src/server.ts"],
      cwd: process.cwd(),
      env: { ...env, ZEN_MCP_CHANNEL: "0" },
    }),
  );
  return client;
}

const body = randomBytes(3_000_000);
const expected = createHash("sha256").update(body).digest("hex");
const name = `zen-mcp-check-${Date.now()}.bin`;
const server = http.createServer((req, res) => {
  if (req.url === "/slow") {
    // a slow stream: runs until cancelled
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": 50_000_000,
      "content-disposition": `attachment; filename="slow-${name}"`,
    });
    const timer = setInterval(() => res.write(randomBytes(64 * 1024)), 100);
    res.on("close", () => clearInterval(timer));
  } else if (req.url === "/file") {
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": body.length,
      "content-disposition": `attachment; filename="${name}"`,
    });
    res.end(body);
  } else {
    res.writeHead(200, { "content-type": "text/html" });
    res.end('<!doctype html><title>downloads</title><a href="/file">Get file</a>');
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;

// Exercise only the native dialog for this fixture's unique URL and filename.
async function dialog(file: string, action: "find" | "save" | "cancel") {
  for (let i = 0; i < 40; i++) {
    const found = await chrome(`(() => {
      for (const win of Services.wm.getEnumerator(null)) {
        if (win.document.documentURI !== "chrome://mozapps/content/downloads/unknownContentType.xhtml") continue;
        const launcher = win.dialog?.mLauncher;
        if (launcher?.source.spec !== ${JSON.stringify(`http://127.0.0.1:${port}/${file}`)} ||
            launcher.suggestedFileName !== ${JSON.stringify(file === "slow" ? `slow-${name}` : name)}) continue;
        const action = ${JSON.stringify(action)};
        if (action === "find") return true;
        const dialog = win.document.querySelector("dialog");
        if (action === "cancel") {
          dialog.cancelDialog();
          return true;
        }
        const button = dialog.getButton("accept");
        if (button.disabled) return false;
        win.document.getElementById("save").click();
        button.click();
        return true;
      }
      return false;
    })()`);
    if (found === "true") return;
    await sleep(100);
  }
  assert.fail(`Could not ${action} the fixture download dialog for /${file}`);
}

const waiting = {
  state: "waiting_for_user",
  message: "Choose Save or Cancel in the browser download dialog. After saving, call downloads wait again.",
};

try {
  const configFile = path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
    "zen-mcp/config.json",
  );
  const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, "utf8")) : {};
  assert(config.mode !== "ask", "Requires your existing auto mode; no settings changed.");
  const [a, b] = [await connect("claude-code"), await connect("codex")];
  tabId = JSON.parse(await tool(a, "tabs_create_mcp")).tabId;
  await tool(a, "navigate", { tabId, url: `http://127.0.0.1:${port}/` });
  assert.match(await tool(a, "downloads", { tabId }), /No downloads from this tab yet/);

  const ref = /\b(ref_\d+)\b/.exec(await tool(a, "find", { tabId, query: "Get file" }))![1];
  const click = () => tool(a, "computer", { tabId, action: "left_click", ref });
  await click();
  if (nativeDialog) {
    try {
      await dialog("file", "find");
      assert.deepEqual(JSON.parse(await tool(a, "downloads", { tabId, action: "wait", timeout: 2 })), waiting);
      assert.deepEqual(JSON.parse(await tool(a, "downloads", { tabId })), {
        downloads: [],
        pending: waiting,
      });
      const otherTab = JSON.parse(await tool(a, "tabs_create_mcp")).tabId;
      try {
        assert.match(await tool(a, "downloads", { tabId: otherTab }), /No downloads from this tab yet/);
        assert.match(await tool(b, "downloads", { tabId }, true), /used by other sessions/);
      } finally {
        await tool(a, "tabs_close_mcp", { tabId: otherTab });
      }
    } finally {
      await dialog("file", "cancel");
    }
    assert.match(await tool(a, "downloads", { tabId }), /No downloads from this tab yet/);
    console.log("ok  native dialog → scoped pending status → cancel clears it");
    await click();
    await dialog("file", "save");
  }
  const done = JSON.parse(await tool(a, "downloads", { tabId, action: "wait", timeout: 30 }));
  files.push(done.path);
  assert.equal(done.state, "done", JSON.stringify(done));
  assert.equal(done.filename, name);
  assert.equal(done.size, body.length);
  assert.equal(done.sha256, expected);
  assert.equal(fs.statSync(done.path).size, body.length);
  const dir = path.join(process.env.XDG_RUNTIME_DIR || "/tmp", "zen-mcp-downloads");
  const doneFile = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${done.id}-`))
    .map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  const doneLines = fs
    .readFileSync(doneFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(doneLines[0].state, "downloading");
  assert.equal(doneLines.at(-1).state, "done");
  assert.equal(doneLines.at(-1).sha256, expected);
  console.log("ok  click → wait: done, path, size, sha256");

  const listed = JSON.parse(await tool(a, "downloads", { tabId }));
  assert.equal(listed.downloads.length, 1);
  assert.equal(listed.downloads[0].id, done.id);
  assert.equal(listed.downloads[0].sha256, expected);
  console.log("ok  list shows it with the cached sha256");

  assert.match(
    await tool(a, "downloads", { tabId, action: "wait", timeout: 2 }, true),
    /No download started within 2 s/,
  );
  console.log("ok  wait with nothing new times out");

  // navigation-started download (no click) is tracked too
  await tool(a, "navigate", { tabId, url: `http://127.0.0.1:${port}/file` }).catch(() => {});
  if (nativeDialog) await dialog("file", "save");
  const second = JSON.parse(await tool(a, "downloads", { tabId, action: "wait", timeout: 30 }));
  files.push(second.path);
  assert.equal(second.state, "done");
  assert.notEqual(second.id, done.id);
  assert.equal(second.sha256, expected);
  console.log("ok  navigate → wait: second download");

  await tool(a, "navigate", { tabId, url: `http://127.0.0.1:${port}/slow` }).catch(() => {});
  if (nativeDialog) await dialog("slow", "save");
  const running = JSON.parse(await tool(a, "downloads", { tabId, action: "wait", until: "start", timeout: 10 }));
  assert.equal(running.state, "downloading");
  assert(running.events && fs.existsSync(running.events), "no events file");
  // event lines arrive as it progresses (every 10%); wait for at least one progress line
  for (let i = 0; i < 80 && fs.readFileSync(running.events, "utf8").trim().split("\n").length < 2; i++)
    await new Promise((resolve) => setTimeout(resolve, 250));
  const lines = fs
    .readFileSync(running.events, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert(lines.length >= 2 && lines.at(-1).progress >= 10, JSON.stringify(lines));
  assert.equal(lines.at(-1).totalBytes, 50_000_000);
  console.log(`ok  wait until start → events file (${lines.length} lines, ${lines.at(-1).progress}%)`);
  const canceled = JSON.parse(await tool(a, "downloads", { tabId, action: "cancel", id: running.id }));
  assert.equal(canceled.state, "canceled");
  assert.equal(canceled.progress, undefined);
  assert(!fs.existsSync(running.path) && !fs.existsSync(`${running.path}.part`), "partial file left behind");
  for (let i = 0; i < 20 && !fs.readFileSync(running.events, "utf8").includes('"canceled"'); i++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(JSON.parse(fs.readFileSync(running.events, "utf8").trim().split("\n").at(-1)!).state, "canceled");
  assert(!fs.readFileSync(running.events, "utf8").includes('"paused"'), "cancel showed a transient paused state");
  assert.match(await tool(a, "downloads", { tabId, action: "cancel", id: done.id }, true), /already finished/);
  console.log("ok  live progress → cancel removes the partial file");

  assert.match(await tool(b, "downloads", { tabId }, true), /used by other sessions/);
  console.log("ok  other session cannot see the tab's downloads");
} finally {
  for (const file of files) fs.rmSync(file, { force: true });
  // also remove from Gecko's download list (only this test's files)
  await chrome(
    `(async () => { const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs"); const list = await Downloads.getList(Downloads.ALL); for (const d of await list.getAll()) if (d.target.path.includes(${JSON.stringify(name.replace(/\.bin$/, ""))})) { await list.remove(d); await d.finalize(true); } return "ok"; })()`,
  ).catch(() => {});
  if (tabId != null) await tool(clients[0], "tabs_close_mcp", { tabId }).catch(() => {});
  for (const client of clients) await client.close().catch(() => {});
  server.close();
}
