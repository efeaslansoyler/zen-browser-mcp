import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { call, type Content } from "../src/zen.ts";
import { pageEval } from "./support/fixture.ts";

const agent = { id: "codex", name: "Codex" };
const text = (content: Content[]) =>
  content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
const command = async (tool: string, args: object = {}) => text(await call(tool, args, 60_000, agent));

const held = new Set<http.ServerResponse>();
const field = '<input aria-label="Field">';
const pages: Record<string, string> = {
  "/head-script": `<!doctype html><head><script src="/held.js"></script></head><body>${field}`,
  "/body-script": `<!doctype html><body><script src="/held.js"></script>${field}`,
  "/image": `<!doctype html><body><img src="/held.png" hidden>`,
  "/partial": `<!doctype html><body><p>Ready</p><script src="/held.js"></script>${field}`,
  "/late": `<!doctype html><body><script>setTimeout(()=>document.body.innerHTML=${JSON.stringify(field)},1500)</script>`,
  "/empty": "<!doctype html><body></body>",
  "/form": `<!doctype html><body>${field}`,
  "/top": `<!doctype html><title>Top</title><iframe id="frame" width="300" height="100"></iframe>`,
};
const server = http.createServer((request, response) => {
  const path = request.url!;
  if (path.startsWith("/held")) return void held.add(response);
  if (path === "/xml") return void response.setHeader("content-type", "application/xml").end("<a/>");
  response.setHeader("content-type", "text/html; charset=utf-8").end(pages[path] ?? "");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address() as AddressInfo;
const origin = `http://127.0.0.1:${port}`;
const tabs: number[] = [];
const open = async (path: string): Promise<number> => {
  const { tabId } = JSON.parse((await command("tabs_create_mcp", { url: "about:blank" })).split("\n")[0]);
  tabs.push(tabId);
  await command("navigate", { tabId, url: origin + path });
  return tabId;
};
const release = () => {
  // why: Gecko would request a dropped script again.
  for (const response of held) response.end();
  held.clear();
};

try {
  for (const host of ["127.0.0.1", "localhost"]) {
    const tabId = await open("/top");
    const load = async (path: string) => {
      await pageEval(tabId, `document.getElementById("frame").src = "http://${host}:${port}${path}"; 0`);
      await sleep(500);
    };
    const inFrame = async (filter = "all") =>
      (await command("read_page", { tabId, filter }))
        .split(/\n *\[iframe [^\n]*\]\n/)[1]
        .split("\nThe same read")[0]
        .trim();
    const readFrame = async (path: string) => {
      await load(path);
      return inFrame();
    };
    // why: Only the first load of a frame waits for its response in an empty initial document.
    for (const path of ["/held", "/head-script", "/body-script", "/image"]) {
      await load(path);
      for (const filter of ["all", "interactive"]) assert.equal(await inFrame(filter), "(still loading)", path);
      release();
    }
    console.log(`✓ A frame of ${host} that has shown nothing yet is still loading`);

    const partial = await readFrame("/partial");
    assert.match(partial, /text "Ready"/);
    assert.doesNotMatch(partial, /loading/);
    release();
    assert.equal(await readFrame("/empty"), "(no visible elements)");
    assert.equal(await readFrame("/xml"), "(empty page)");
    assert.equal(await readFrame("/late"), "(no visible elements)");
    await sleep(1500);
    assert.match(await command("read_page", { tabId }), /textbox "Field"/);
    console.log(`✓ A loaded frame of ${host} without content says so; content that is there is read while it loads`);
  }

  for (const path of ["/head-script", "/body-script"]) {
    const tabId = await open("/form");
    await pageEval(tabId, `setTimeout(() => (location.href = "${origin}${path}"), 50); 0`);
    await sleep(700);
    const loading = await command("read_page", { tabId });
    assert.match(loading, /\(still loading\)$/, `${path}: ${loading}`);
    release();
    await command("wait_for", { tabId, selector: "input" });
    assert.match(await command("read_page", { tabId }), /textbox "Field"/);
  }
  const emptyTab = await open("/empty");
  assert.match(await command("read_page", { tabId: emptyTab }), /\(no visible elements\)$/);
  console.log("✓ A page that has shown nothing yet is still loading");
  console.log("All live loading checks passed.");
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  release();
  for (const tabId of tabs) await command("tabs_close_mcp", { tabId }).catch(console.error);
  server.closeAllConnections();
  server.close();
}
