// why: Preserve the original configuration because the last check temporarily exercises ask mode.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { call } from "../src/zen.ts";
import { reloadBridge } from "./support/bridge.ts";

const text = (result: Record<string, unknown>) =>
  (result.content as { type: string; text?: string }[])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
const chrome = async (code: string) => JSON.parse(text({ content: await call("chrome_eval", { code }) }));
const clients: Client[] = [];
const tabs = new Set<number>();
const running: Promise<unknown>[] = [];
const token = `zen-tab-access-${Date.now()}`;
const configFile = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "zen-mcp/config.json");
let original: Buffer | undefined, temporary: string | undefined;
const settle = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ value, error: undefined }),
    (error) => ({ value: undefined, error }),
  );
async function tool(client: Client, name: string, args: Record<string, unknown> = {}, error = false) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 40_000 });
  assert.equal(Boolean(result.isError), error, text(result));
  return result;
}
// why: Separate the tool's reply from appended shared-tab activity.
const json = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
  JSON.parse(((await tool(client, name, args)).content as { text: string }[])[0].text);
async function connect() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  // why: Claude process sessions appear in menus; Codex requires a conversation identity.
  const client = new Client({ name: "claude-code", version: "tab-access-test" });
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
async function menu(tabId: number, session: string | null) {
  await chrome(`(() => {
    const tab=h.findTab(${tabId}), win=tab.ownerDocument.defaultView;
    h.prepareTabMenu(win,[tab]);
    const item=${JSON.stringify(session)}
      ? [...win.document.getElementById('tabContextMenu').querySelectorAll('[data-zen-session]')].find(node=>node.getAttribute('data-zen-session')===${JSON.stringify(session)})
      : win.document.getElementById('zen-mcp-context-give');
    if(!item) throw new Error('Tab menu entry missing');
    item.doCommand();
    return true;
  })()`);
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
  throw new Error("Expected join prompt did not appear.");
}
const members = (tabId: number) => chrome(`h.access.members(${tabId})`);
const server = http.createServer((_, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(
    '<!doctype html><title>Zen tab access test</title><h1>Disposable tab access test</h1><input aria-label="Fixture field" value="untouched">',
  );
});

try {
  original = fs.existsSync(configFile) ? fs.readFileSync(configFile) : undefined;
  const settings = original ? JSON.parse(original.toString()) : {};
  assert(settings.mode !== "ask", "This test requires your existing auto mode; settings were not changed.");
  const before = await chrome("({version:h.version,paused:h.state.paused})");
  assert(!before.paused, "Resume browser automation before running this test.");
  console.log(text({ content: await reloadBridge() }));
  let ready = false;
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    try {
      if (await chrome(`h.version>${before.version} && !!h.access`)) {
        ready = true;
        break;
      }
    } catch {}
  }
  assert(ready, "Updated bridge did not become ready; check $XDG_RUNTIME_DIR/zen-mcp.log.");
  // why: An origin-bearing URL is necessary to exercise an origin-scoped hold.
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const fixture = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  const a = await connect(),
    b = await connect();
  const createdA = await json(a, "tabs_create_mcp"),
    createdB = await json(b, "tabs_create_mcp");
  tabs.add(createdA.tabId);
  tabs.add(createdB.tabId);
  const tabId = createdA.tabId,
    other = createdB.tabId;
  const sessionA = (await json(a, "tabs_context_mcp")).session.id,
    sessionB = (await json(b, "tabs_context_mcp")).session.id;
  assert.notEqual(sessionA, sessionB, "Same-type clients shared a session");
  for (const [client, id] of [
    [a, tabId],
    [b, other],
  ] as const)
    await tool(client, "navigate", { tabId: id, url: fixture });
  const field = async (client: Client, id: number) =>
    /\[(ref_[^\]]+)\]/.exec(text(await tool(client, "find", { tabId: id, query: "Fixture field" })))![1];
  const type = async (client: Client, id: number, value: string) =>
    tool(client, "form_input", { tabId: id, ref: await field(client, id), value });

  for (const [client, own, foreign] of [
    [a, tabId, other],
    [b, other, tabId],
  ] as const) {
    const list = await json(client, "tabs_context_mcp");
    assert.deepEqual(
      list.tabs.map((tab: any) => tab.tabId),
      [own],
    );
    assert(list.agentTabs.some((tab: any) => tab.tabId === foreign));
    for (const name of ["get_page_text", "tabs_close_mcp"])
      assert.match(text(await tool(client, name, { tabId: foreign }, true)), /used by other sessions/);
    assert.match(
      text(await tool(client, "form_input", { tabId: foreign, ref: "ref_1", value: "BAD" }, true)),
      /used by other sessions/,
    );
  }
  console.log(
    "✓ Two real Claude Code MCP clients have separate tab lists; foreign reads, writes and closes are refused",
  );

  const joined = await json(b, "request_tab", { tabId, reason: `${token}: check the field` });
  assert.match(joined.note, /joined/);
  assert.deepEqual(await members(tabId), [sessionA, sessionB]);
  await json(a, "tab_work", { action: "start", tabId, summary: `${token}: filling the field` });
  const listB = await json(b, "tabs_context_mcp");
  const shared = listB.tabs.find((tab: any) => tab.tabId === tabId);
  assert.equal(shared.sharedWith[0].task.summary, `${token}: filling the field`);
  await tool(a, "get_page_text", { tabId });
  const started = Date.now();
  const waiting = settle(tool(a, "computer", { tabId, action: "wait", duration: 3 }));
  await sleep(300);
  await tool(b, "get_page_text", { tabId: other });
  const parallel = Date.now() - started;
  await type(b, tabId, "written by B");
  const turn = Date.now() - started;
  assert(!(await waiting).error);
  assert(parallel < 2500, `A call in another tab waited for the busy tab (${parallel} ms)`);
  assert(turn >= 2900, `A call in the busy tab didn't wait its turn (${turn} ms)`);
  console.log(
    `✓ Joining is immediate in auto mode; the other tab answered in ${parallel} ms while the shared tab waited its turn (${turn} ms)`,
  );

  const afterB = text(await tool(a, "computer", { tabId, action: "wait", duration: 0.1 }));
  const report = JSON.parse(afterB.split("\n").find((line) => line.includes('"meanwhile"'))!);
  assert.equal(report.meanwhile[0].actions, 2, afterB);
  assert.match(report.pageChanged, /read the page again/);
  assert(!afterB.includes("written by B"), "B's typed value reached A");
  const reread = text(await tool(a, "read_page", { tabId, filter: "interactive" }));
  assert(reread.includes("written by B") && !reread.includes("pageChanged"));
  console.log(
    "✓ The other member's actions come with the next call (count and time, no values), with a read-again warning",
  );

  // why: Hold refusals must be immediate even while the holder occupies the tab lock.
  const held = await json(a, "tab_work", {
    action: "hold",
    tabId,
    summary: `${token}: paying, don't touch the cart`,
    minutes: 3,
    noWorkaround: true,
  });
  assert.equal(held.hold.by, "you");
  const busy = settle(tool(a, "computer", { tabId, action: "wait", duration: 3 }));
  await sleep(300);
  const refusedAt = Date.now();
  assert.match(text(await tool(b, "get_page_text", { tabId }, true)), /is held by .*paying, don't touch the cart/);
  assert(Date.now() - refusedAt < 1500, "A held tab made the other member wait");
  // why: Check that the watch can answer before the holder's running call finishes.
  const watchAt = Date.now();
  const watching = await json(b, "watch", { tabId, hold: true });
  assert(Date.now() - watchAt < 1500, "Watching a hold waited for the busy tab");
  assert.match(watching.hold.reason, /paying/);
  assert.match(text(await tool(b, "get_page_text", { tabId: other }, true)), /Don't work on http:\/\/127\.0\.0\.1/);
  await tool(b, "navigate", { tabId: other, url: "about:blank" });
  assert.match(text(await tool(b, "navigate", { tabId: other, url: fixture }, true)), /is held by/);
  assert(!(await busy).error);
  assert.match(text(await tool(a, "get_page_text", { tabId })), /Disposable tab access test/);
  await chrome(`(() => {
    const tab=h.findTab(${tabId}), win=tab.ownerDocument.defaultView;
    h.prepareTabMenu(win,[tab]);
    const item=win.document.getElementById('zen-mcp-context-give-release');
    if(item.hidden||!item.getAttribute('label').includes(${JSON.stringify(token)})) throw new Error('Remove hold item missing');
    item.doCommand();
    return true;
  })()`);
  let released = false;
  for (let i = 0; i < 50 && !released; i++) {
    await sleep(100);
    released = fs.existsSync(watching.events) && fs.readFileSync(watching.events, "utf8").includes('"released"');
  }
  assert(released, "The hold watch didn't report the release");
  await tool(b, "navigate", { tabId: other, url: fixture });
  await tool(b, "get_page_text", { tabId });
  console.log(
    "✓ A hold refuses the other member at once, also on the same site in its own tab (noWorkaround); a hold watch answers at once and reports when the menu's Remove hold ends it",
  );

  const left = text(await tool(a, "tabs_close_mcp", { tabId }));
  assert.match(left, /still work in tab/);
  assert(await chrome(`!!h.findTab(${tabId})`), "Leaving closed a shared tab");
  assert.deepEqual(await members(tabId), [sessionB]);
  await tool(a, "get_page_text", { tabId }, true);
  console.log("✓ Closing a shared tab only leaves it; the other session keeps it");

  await menu(tabId, sessionA);
  assert.deepEqual(await members(tabId), [sessionB, sessionA]);
  const active = settle(tool(b, "computer", { tabId, action: "wait", duration: 30 }));
  await sleep(200);
  await menu(tabId, null);
  const taken = await active;
  assert(taken.error || taken.value?.isError, "Take-back did not cancel active work");
  await tool(a, "get_page_text", { tabId }, true);
  await tool(b, "get_page_text", { tabId }, true);
  assert(await chrome(`!!h.findTab(${tabId})`), "Take-back closed the tab");
  console.log("✓ The share menu adds a session; take-back cancels active work of every member and leaves the tab open");

  await menu(other, sessionA);
  await tool(a, "tabs_close_mcp", { tabId: other });
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "zen-tab-access-config-"));
  if (original) fs.writeFileSync(path.join(backupDir, "config.json"), original, { mode: 0o600 });
  console.log(`Temporarily testing ask mode. Original config backup: ${backupDir}`);
  const askConfig = JSON.stringify({ ...settings, mode: "ask" }, null, 2) + "\n";
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, askConfig, { mode: 0o600 });
  temporary = askConfig;
  for (const accept of [false, true]) {
    const pending = tool(a, "request_tab", { tabId: other, reason: `${token}: review` });
    running.push(pending.catch(() => {}));
    await answer(other, accept);
    assert.match(text(await pending), accept ? /joined/ : /declined/);
    assert.deepEqual(await members(other), accept ? [sessionB, sessionA] : [sessionB]);
  }
  console.log("✓ Ask mode: joining an agent tab asks; Deny keeps the session out, Allow lets it in");

  await b.close();
  let gone = false;
  for (let i = 0; i < 100; i++) {
    if (!(await members(other)).includes(sessionB)) {
      gone = true;
      break;
    }
    await sleep(100);
  }
  assert(gone, "MCP shutdown did not take the session out of its tabs after the reconnect grace");
  assert.deepEqual(await members(other), [sessionA]);
  await a.close();
  for (let i = 0; i < 100 && (await members(other)).length; i++) await sleep(100);
  assert.deepEqual(await members(other), []);
  assert(await chrome(`!!h.findTab(${other})`), "Session shutdown closed the tab");
  console.log(
    "✓ MCP process shutdown leaves the session's tabs after the reconnect grace; the last one gives the tab back open",
  );
  console.log("All live tab access checks passed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  server.close();
  // why: Disconnect only fixture sessions so cleanup cancels their work without touching other sessions.
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
