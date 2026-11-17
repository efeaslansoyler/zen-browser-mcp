// Live coordination through real stdio MCP clients. Only disposable fixture tabs are used.
// Run: node scripts/check-coordination.ts
// Requires existing auto mode; temporarily tests ask mode and restores the original file.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { call } from "../src/zen.ts";

const text = (result: { content: any[] }) =>
  result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
const chrome = async (code: string) => JSON.parse(text({ content: await call("chrome_eval", { code }) }));
const clients: Client[] = [],
  tabs = new Set<number>();
const token = `zen-coordination-${Date.now()}`;
const configFile = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "zen-mcp/config.json");
let original: Buffer | undefined, temporary: string | undefined;
const running: Promise<unknown>[] = [];
async function tool(client: Client, name: string, args: Record<string, unknown> = {}, error = false) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 40_000 });
  assert.equal(Boolean(result.isError), error, text(result));
  return result;
}
const work = async (client: Client, action: string, tabId?: number, summary?: string) =>
  JSON.parse(
    text(
      await tool(client, "tab_work", { action, ...(tabId == null ? {} : { tabId }), ...(summary ? { summary } : {}) }),
    ),
  );
async function connect(name: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const client = new Client({ name, version: "coordination-test" });
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
async function answer(tabId: number, accept: boolean) {
  for (let i = 0; i < 100; i++) {
    const clicked = await chrome(`(() => {
      if(h.island.state!=="ask") return false;
      const el=h.findTab(${tabId}).ownerDocument.getElementById("zen-mcp-island");
      if(!el.textContent.includes(${JSON.stringify(token)})) return false;
      el.querySelector(${JSON.stringify(accept ? ".ok" : ".cancel")}).click();
      return true;
    })()`);
    if (clicked) return;
    await sleep(50);
  }
  throw new Error("Expected fixture handoff prompt did not appear.");
}
try {
  original = fs.existsSync(configFile) ? fs.readFileSync(configFile) : undefined;
  const settings = original ? JSON.parse(original.toString()) : {};
  assert(settings.mode !== "ask", "This test requires your existing auto mode; settings were not changed.");
  const before = await chrome("({version:h.version,paused:h.state.paused})");
  assert(!before.paused, "Resume browser automation before running this test.");
  console.log(text({ content: await call("reload") }));
  let ready = false;
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    try {
      if (await chrome(`h.version>${before.version} && !!h.ownership.work`)) {
        ready = true;
        break;
      }
    } catch {}
  }
  assert(ready, "Coordination bridge did not reload.");

  let askFixture: { a: Client; b: Client; tabId: number; ownerA: string; ownerB: string } | undefined;
  for (const names of [
    ["codex-mcp-client", "codex-mcp-client"],
    ["claude-code", "claude-code"],
    ["codex-mcp-client", "claude-code"],
  ]) {
    const a = await connect(names[0]),
      b = await connect(names[1]);
    const createdA = JSON.parse(text(await tool(a, "tabs_create_mcp")));
    tabs.add(createdA.tabId);
    const createdB = JSON.parse(text(await tool(b, "tabs_create_mcp")));
    tabs.add(createdB.tabId);
    const tabId = createdA.tabId,
      ownerA = createdA.owner.session,
      ownerB = createdB.owner.session;
    assert.notEqual(ownerA, ownerB);
    await tool(a, "navigate", {
      tabId,
      url:
        "data:text/html;charset=utf-8," +
        encodeURIComponent(`<!doctype html><title>${token}</title><p id="result">original fixture</p>`),
    });
    await work(a, "start", tabId, `${token}: editing fixture; not yet submitted`);
    let complete = false;
    const waiting = tool(a, "computer", { tabId, action: "wait", duration: 5 }).finally(() => {
      complete = true;
    });
    running.push(waiting.catch(() => {}));
    let executing = false;
    for (let i = 0; i < 50; i++) {
      if ((await work(b, "status", tabId)).executing) {
        executing = true;
        break;
      }
      await sleep(20);
    }
    assert(executing, "Fixture wait never started.");
    const queued = await work(b, "request", tabId, `${token}: inspect after owner completes`);
    assert.equal(queued.position, 1);
    assert.equal(queued.owner.session, ownerA);
    assert.equal(complete, false, "Request blocked behind the active tool.");
    assert(queued.task.summary.includes("not yet submitted"));
    await waiting;
    assert.equal(
      (await work(b, "status", tabId)).owner.session,
      ownerA,
      "Tool completion was incorrectly treated as task completion.",
    );
    await tool(b, "get_page_text", { tabId }, true);
    // Owner receives the waiting queue in its normal tool reply.
    const changed = await tool(a, "javascript_tool", {
      tabId,
      action: "javascript_exec",
      text: 'document.getElementById("result").textContent="owner saved"',
    });
    assert(text(changed).includes("Other sessions are waiting"));
    const handed = await work(a, "finish", tabId, `${token}: saved; submit not clicked`);
    assert.equal(handed.owner.session, ownerB);
    assert.equal(handed.handoff.summary, `${token}: saved; submit not clicked`);
    await tool(a, "get_page_text", { tabId }, true);
    assert(text(await tool(b, "get_page_text", { tabId })).includes("owner saved"));
    console.log(
      `✓ ${names.join(" → ")}: live status, queued wait, no premature transfer, automatic handoff and context`,
    );
    askFixture = { a, b, tabId, ownerA, ownerB };
  }

  assert(askFixture);
  const { a, b, tabId, ownerA, ownerB } = askFixture;
  // Finish before the next request: a ready tab must also transfer immediately in auto mode.
  await work(b, "finish", tabId, `${token}: B done`);
  assert.equal((await work(a, "request", tabId, `${token}: another task`)).owner.session, ownerA);
  await work(b, "request", tabId, `${token}: cancelled request`);
  await work(b, "cancel", tabId);
  assert.equal((await work(a, "status", tabId)).queue.length, 0);

  // Exercise actual Allow/Deny island buttons. The config backup survives interrupted runs.
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "zen-coordination-config-"));
  if (original) fs.writeFileSync(path.join(backupDir, "config.json"), original, { mode: 0o600 });
  console.log(`Temporarily testing ask mode. Original config backup: ${backupDir}`);
  assert.equal(
    fs.existsSync(configFile) ? fs.readFileSync(configFile, "utf8") : undefined,
    original?.toString(),
    "Config changed during the test; refusing to overwrite it.",
  );
  const askConfig = JSON.stringify({ ...settings, mode: "ask" }, null, 2) + "\n";
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  await sleep(20);
  fs.writeFileSync(configFile, askConfig, { mode: 0o600 });
  temporary = askConfig;
  await work(b, "request", tabId, `${token}: approved review`);
  assert.equal((await work(a, "finish", tabId, `${token}: ready for review`)).owner.session, ownerA);
  for (const accept of [false, true]) {
    const pending = tool(b, "request_tab", { tabId, reason: `${token}: approved review` });
    running.push(pending.catch(() => {}));
    await answer(tabId, accept);
    await pending;
    assert.equal((await work(b, "status", tabId)).owner.session, accept ? ownerB : ownerA);
  }
  assert.equal((await work(b, "status", tabId)).handoff.summary, `${token}: ready for review`);
  console.log("✓ Ask mode: finish does not transfer; actual Deny preserves owner; Allow transfers with context");
  console.log("All live coordination checks passed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  // Closing only the fixture clients cancels any fixture operation before cleanup.
  await Promise.allSettled(clients.map((client) => client.close()));
  await Promise.allSettled(running);
  for (const tabId of tabs) {
    await chrome(
      `(() => {const tab=h.findTab(${tabId});if(tab)tab.ownerDocument.defaultView.gBrowser.removeTab(tab,{animate:false,skipPermitUnload:true});return true;})()`,
    ).catch((error) => {
      console.error(`Could not close test tab ${tabId}:`, error);
      process.exitCode = 1;
    });
  }
  if (temporary) {
    if (fs.existsSync(configFile) && fs.readFileSync(configFile, "utf8") === temporary) {
      if (original) fs.writeFileSync(configFile, original, { mode: 0o600 });
      else fs.unlinkSync(configFile);
      console.log("Original permission settings restored.");
    } else {
      console.error("Config changed externally; left it untouched. Restore from the printed backup if needed.");
      process.exitCode = 1;
    }
  }
  if (tabs.size) console.log("Disposable test tabs closed.");
}
