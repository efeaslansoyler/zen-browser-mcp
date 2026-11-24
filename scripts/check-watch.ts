// why: Require auto mode and use only the fixture tab.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import "./support/require-sandbox.ts";

const text = (result: any) =>
  result.content
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("\n");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let tabId: number | undefined;
let client: Client | undefined;
async function tool(name: string, args: Record<string, unknown> = {}, error = false) {
  const result = await client!.callTool({ name, arguments: args }, undefined, { timeout: 60_000 });
  assert.equal(Boolean(result.isError), error, text(result));
  return text(result);
}
const lines = (file: string) =>
  fs.existsSync(file)
    ? fs
        .readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
async function until(file: string, done: (l: any[]) => boolean, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (done(lines(file))) return lines(file);
    await sleep(200);
  }
  throw new Error(`timed out; events so far: ${JSON.stringify(lines(file))}`);
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><title>watch</title><p id=status>Offline</p><span class=price>10</span>
<script>
setTimeout(() => { document.getElementById('status').textContent = 'Live now'; }, 3000);
let p = 10; setInterval(() => { document.querySelector('.price').textContent = String(++p); }, 1000);
</script>`);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;

try {
  const configFile = path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
    "zen-mcp/config.json",
  );
  const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, "utf8")) : {};
  assert(config.mode !== "ask", "Requires your existing auto mode; no settings changed.");
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  client = new Client({ name: "claude-code", version: "watch-test" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["src/server.ts"],
      cwd: process.cwd(),
      env: { ...env, ZEN_MCP_CHANNEL: "0" },
    }),
  );
  tabId = JSON.parse(await tool("tabs_create_mcp")).tabId;
  await tool("navigate", { tabId, url: `http://127.0.0.1:${port}/` });

  const live = JSON.parse(await tool("watch", { tabId, text: "Live now", interval: 0.5 }));
  const price = JSON.parse(await tool("watch", { tabId, selector: ".price", change: true, interval: 0.5 }));
  assert.equal(JSON.parse(await tool("watch", { action: "list" })).watches.length, 2);

  const done = await until(live.events, (l) => l.at(-1)?.final);
  assert.equal(done[0].event, "started");
  assert.equal(done.at(-1).event, "matched");
  const after = (Date.parse(done.at(-1).t) - Date.parse(done[0].t)) / 1000;
  // why: Bound match latency to catch events accidentally appended to an older file.
  assert(after >= 2 && after < 8, `matched after ${after} s`);
  console.log(`ok  text watch matched after ${after.toFixed(1)} s, then ended`);

  const changes = await until(price.events, (l) => l.filter((e) => e.event === "changed").length >= 2);
  const changed = changes.filter((e) => e.event === "changed");
  assert.equal(Number(changed[1].value), Number(changed[1].previous) + 1);
  console.log(`ok  change watch: ${changed.map((e) => `${e.previous}→${e.value}`).join(", ")}`);

  await tool("watch", { action: "stop", id: price.id });
  assert.equal(lines(price.events).at(-1).reason, "stopped by the agent");
  assert.match(await tool("watch", { action: "stop", id: price.id }, true), /No watch/);
  console.log("ok  stop writes a final line");

  const gone = JSON.parse(await tool("watch", { tabId, text: "Never shown", interval: 0.5 }));
  await tool("tabs_close_mcp", { tabId });
  tabId = undefined;
  const closed = await until(gone.events, (l) => l.at(-1)?.event === "ended");
  assert.match(closed.at(-1).reason, /tab closed/);
  console.log("ok  closing the tab ends its watches");
  assert.equal(JSON.parse(await tool("watch", { action: "list" })).watches.length, 0);
} finally {
  if (tabId != null) await tool("tabs_close_mcp", { tabId }).catch(() => {});
  await client?.close().catch(() => {});
  server.close();
}
