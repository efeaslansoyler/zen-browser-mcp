// why: A title reaches the bridge through the client's lifecycle connection, so use real MCP processes.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { call, subscribe } from "../src/zen.ts";
import { assertBridgeRunsCheckout } from "./support/bridge.ts";

await assertBridgeRunsCheckout();

const text = (result: any) => result.content.find((c: any) => c.type === "text").text;
const chrome = async (code: string) => {
  const [result] = await call("chrome_eval", { code });
  assert.equal(result?.type, "text");
  return JSON.parse(result.text);
};
async function until(done: () => Promise<boolean>, ms: number, message: string) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) if (await done()) return;
  throw new Error(message);
}
const names = () => chrome("h.sendTargets().map(({id,name})=>({id,name}))") as Promise<{ id: string; name: string }[]>;
const named = async (start: string) => (await names()).find(({ name }) => name.startsWith(start));

const token = `title-${Date.now()}`;
const home = fs.mkdtempSync(path.join(os.tmpdir(), "zen-mcp-titles-"));
const transcript = path.join(home, "projects", "-fixture", "conversation.jsonl");
const rename = (customTitle: string) =>
  fs.appendFileSync(transcript, JSON.stringify({ type: "custom-title", customTitle }) + "\n");
fs.mkdirSync(path.join(home, "sessions"), { recursive: true });
fs.mkdirSync(path.dirname(transcript), { recursive: true });
fs.writeFileSync(
  path.join(home, "sessions", `${process.pid}.json`),
  JSON.stringify({ sessionId: "conversation", cwd: "/fixture" }),
);

const server = http.createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end("<!doctype html><title>Title change test</title><h1>Disposable</h1>");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const fixture = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;

const client = new Client({ name: "claude-code", version: "title-change-test" });
const tabs: number[] = [];
let relay: ReturnType<typeof subscribe> | undefined;
try {
  rename(`${token} one`);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && !/^(T3CODE|CLAUDE_CODE)_/.test(entry[0]),
    ),
  );
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["src/server.ts"],
      cwd: process.cwd(),
      env: { ...env, ZEN_MCP_CHANNEL: "0", CLAUDE_CONFIG_DIR: home },
    }),
  );
  const tool = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args }, undefined, { timeout: 60_000 });
  const open = async () => {
    const { tabId } = JSON.parse(text(await tool("tabs_create_mcp", { url: fixture })));
    tabs.push(tabId);
    return tabId as number;
  };
  const tabId = await open();
  const held = await open();
  await until(async () => !!(await named(`${token} one`)), 5000, "The first title never reached the menus.");
  const { id } = (await named(`${token} one`))!;
  assert(!(await tool("tab_work", { tabId: held, action: "hold", summary: "title change test", minutes: 3 })).isError);

  const running = tool("computer", { tabId, action: "wait", duration: 25 });
  await sleep(500);
  const queued = tool("get_page_text", { tabId });
  rename(`${token} two`);
  await until(async () => !!(await named(`${token} two`)), 20_000, "The new title never reached the menus.");
  assert.equal((await named(`${token} two`))!.id, id);
  const hold = await chrome(`!!h.holdOf(${held})`);
  assert.equal(hold, true, "The title change released the hold.");
  const ran = await running;
  assert(!ran.isError, text(ran));
  const after = await queued;
  assert(!after.isError, text(after));
  console.log("✓ Claude: a new title keeps the running call, the queued call and the hold, and shows in menus");

  const thread = "00000000-0000-4000-8000-000000000045";
  const session = `codex:${thread}`;
  const agent = { id: "codex", name: "Codex" };
  relay = subscribe(() => {}, {
    cwd: "/fixture",
    title: `${token} codex one`,
    threadId: thread,
    agent,
    ack: true,
    session,
  });
  await until(async () => !!(await named(`${token} codex one`)), 5000, "The Codex title never reached the menus.");
  const [created] = await call("tabs_create_mcp", { url: fixture }, 20_000, agent, session);
  assert.equal(created?.type, "text");
  const codexTab = JSON.parse(created.text).tabId;
  tabs.push(codexTab);
  const waiting = call("computer", { tabId: codexTab, action: "wait", duration: 4 }, 20_000, agent, session);
  await sleep(500);
  relay.setTitle(`${token} codex two`);
  await until(async () => !!(await named(`${token} codex two`)), 3000, "The new Codex title never reached the menus.");
  assert.equal((await named(`${token} codex two`))!.id, session);
  const waited = await waiting;
  assert(!waited.isError, text({ content: waited }));
  relay.setTitle(undefined);
  await until(async () => !(await named(token + " codex")), 3000, "A removed title stayed in the menus.");
  console.log("✓ Codex: a new title keeps the running call and shows in menus; a removed title leaves them");

  const last = call("computer", { tabId: codexTab, action: "wait", duration: 10 }, 20_000, agent, session).then(
    (content) => text({ content }),
    (error) => error.message,
  );
  await sleep(500);
  relay.close();
  assert.match(await last, /disconnected/);
  await client.close();
  await until(
    async () => !(await names()).some((target) => target.id === id || target.id === session),
    5000,
    "A closed client stayed in the menus.",
  );
  assert.equal(await chrome(`!!h.holdOf(${held})`), false, "A closed client kept its hold.");
  console.log("✓ A closed client still cancels its call, loses its hold and leaves the menus");
} finally {
  relay?.close();
  await client.close().catch(() => {});
  for (const tabId of tabs)
    await chrome(
      `(()=>{const tab=h.findTab(${tabId}); tab?.ownerDocument.defaultView.gBrowser.removeTab(tab); return true})()`,
    );
  server.close();
  fs.rmSync(home, { recursive: true, force: true });
}
