// End-to-end ownership test with two real stdio MCP clients of the same agent type.
// Run locally: node scripts/check-ownership.ts. No settings or user tabs are changed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { call, type Content } from '../src/zen.ts';
const text = (result: { content: any[] }) => result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
const chrome = async (code: string) => JSON.parse(text({ content: await call('chrome_eval', { code }) }));
const clients: Client[] = [];
const tabs = new Set<number>();
const settle = <T>(promise: Promise<T>) => promise.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
async function tool(client: Client, name: string, args: Record<string, unknown> = {}, error = false) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 40_000 });
  assert.equal(Boolean(result.isError), error, text(result));
  return result;
}
async function transfer(tabId: number, owner: string, back?: string) {
  // Exercise the actual right-click submenu handlers without opening/moving user tabs.
  await chrome(`(() => {
    const tab=h.findTab(${tabId});
    const win=tab.ownerDocument.defaultView;
    const menu=win.document.getElementById('tabContextMenu');
    for(const owner of ${JSON.stringify(back ? [owner, back] : [owner])}) {
      // A synthetic root popup event lets Zen reset contextTab to the user's selected
      // tab. Build the real menu for the explicit fixture instead, then use XUL's
      // native command dispatch (not an untrusted synthetic Event).
      h.prepareTabMenu(win,[tab]);
      const item=[...menu.querySelectorAll('[data-zen-session]')].find(node=>node.getAttribute('data-zen-session')===owner);
      if(!item) throw new Error('Session transfer menu entry missing: '+owner);
      item.doCommand();
      if(h.ownership.owner(${tabId})!==owner) throw new Error('Menu did not transfer the test tab; actual owner: '+h.ownership.owner(${tabId}));
    }
    return true;
  })()`);
}
try {
  const configFile = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'zen-mcp/config.json');
  const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
  assert(config.mode !== 'ask', 'Automatic ownership test requires your existing auto mode; no settings have been changed.');
  const before = await chrome('({version:h.version,paused:h.state.paused})');
  assert(!before.paused, 'Resume browser automation before running this test.');
  console.log(text({ content: await call('reload') }));
  let ready = false;
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    try { if (await chrome(`h.version>${before.version} && !!h.ownership`)) { ready = true; break; } } catch {}
  }
  assert(ready, 'Updated ownership bridge did not become ready; check $XDG_RUNTIME_DIR/zen-mcp.log.');
  const fixture = 'data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><title>Zen ownership test</title><h1>Disposable ownership test</h1><p id="result">untouched</p>');
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  for (let i = 0; i < 2; i++) {
    // Claude Code identities: their MCP process sessions are listed in the tab menu. A Codex MCP
    // process session is not (Codex tabs belong to conversations), so the transfer menu would miss it.
    const client = new Client({ name: 'claude-code', version: 'ownership-test' });
    clients.push(client);
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ['src/server.ts'], cwd: process.cwd(), env: { ...env, ZEN_MCP_CHANNEL: '0' } }));
  }
  const [a, b] = clients;
  const createdA = JSON.parse(text(await tool(a, 'tabs_create_mcp'))); tabs.add(createdA.tabId);
  const createdB = JSON.parse(text(await tool(b, 'tabs_create_mcp'))); tabs.add(createdB.tabId);
  const tabId = createdA.tabId;
  const ownerA = createdA.owner.session, ownerB = createdB.owner.session;
  assert.notEqual(ownerA, ownerB, 'Same-type clients shared a session');
  await tool(a, 'navigate', { tabId, url: fixture });
  await tool(b, 'navigate', { tabId: createdB.tabId, url: fixture });
  for (const [client, expected, foreign] of [[a, tabId, createdB.tabId], [b, createdB.tabId, tabId]] as const) {
    const list = JSON.parse(text(await tool(client, 'tabs_context_mcp')));
    assert(list.tabs.some((tab: any) => tab.tabId === expected));
    assert(!list.tabs.some((tab: any) => tab.tabId === foreign));
    for (const name of ['get_page_text', 'tabs_close_mcp']) {
      assert.match(text(await tool(client, name, { tabId: foreign }, true)), /another session/);
    }
    assert.match(text(await tool(client, 'javascript_tool', { tabId: foreign, action: 'javascript_exec', text: 'document.title="BAD"' }, true)), /another session/);
  }
  console.log('✓ Two real Claude Code MCP clients have separate tab lists; foreign reads, writes and closes are rejected');

  const waiting = settle(a.callTool({ name: 'computer', arguments: { tabId, action: 'wait', duration: 30 } }));
  await sleep(250);
  const seen = await chrome(`h.sessions.get(${JSON.stringify(ownerA)}).seen`);
  await sleep(20);
  const queued = settle(a.callTool({ name: 'javascript_tool', arguments: { tabId, action: 'javascript_exec', text: 'document.getElementById("result").textContent="BAD"' } }));
  let accepted = false;
  for (let i = 0; i < 50; i++) {
    if (await chrome(`h.sessions.get(${JSON.stringify(ownerA)}).seen > ${seen}`)) { accepted = true; break; }
    await sleep(20);
  }
  assert(accepted, 'Queued test write did not reach the bridge');
  await transfer(tabId, ownerB, ownerA);
  const oldWait = await waiting, oldWrite = await queued;
  assert(!oldWait.error && oldWait.value?.isError, 'Transfer did not cancel active work');
  assert.match(text(oldWait.value), /revoked or transferred/);
  assert(!oldWrite.error && oldWrite.value?.isError, 'Transfer-back revived an old queued write');
  assert.match(text(oldWrite.value), /changed after this request was queued/);
  assert(text(await tool(a, 'get_page_text', { tabId })).includes('untouched'));
  console.log('✓ Actual session-transfer menu cancels active work and rejects queued writes even after transfer back');

  await transfer(tabId, ownerB);
  await tool(a, 'get_page_text', { tabId }, true);
  await tool(b, 'javascript_tool', { tabId, action: 'javascript_exec', text: 'document.getElementById("result").textContent="new owner works"' });
  assert(text(await tool(b, 'get_page_text', { tabId })).includes('new owner works'));
  console.log('✓ New owner can work; previous owner loses access');

  const active = settle(b.callTool({ name: 'computer', arguments: { tabId, action: 'wait', duration: 30 } }));
  await sleep(150);
  await chrome(`(() => {
    const tab=h.findTab(${tabId}), win=tab.ownerDocument.defaultView;
    h.prepareTabMenu(win,[tab]);
    win.document.getElementById('zen-mcp-context-give').doCommand();
    return true;
  })()`);
  const taken = await active;
  assert(!taken.error && taken.value?.isError, 'Take-back did not cancel active work');
  await tool(b, 'get_page_text', { tabId }, true);
  assert(await chrome(`!!h.findTab(${tabId})`), 'Take-back closed the user tab');
  console.log('✓ Take-back menu cancels active work and leaves the tab open');

  await transfer(tabId, ownerB);
  await b.close();
  let released = false;
  for (let i = 0; i < 100; i++) {
    const state = await chrome(`({owner:h.ownership.owner(${tabId})||null,open:!!h.findTab(${tabId})})`);
    assert(state.open, 'Session shutdown closed the tab');
    if (!state.owner) { released = true; break; }
    await sleep(100);
  }
  assert(released, 'MCP shutdown did not release tab ownership after reconnect grace');
  console.log('✓ Actual MCP process shutdown releases ownership after reconnect grace; tab stays open');
  console.log('All live ownership checks passed.');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  // End fixture clients before cleanup; these are the only tabs this script may close.
  await Promise.allSettled(clients.map(client => client.close()));
  for (const tabId of tabs) {
    await chrome(`(() => {const tab=h.findTab(${tabId}); if(tab)tab.ownerDocument.defaultView.gBrowser.removeTab(tab,{animate:false,skipPermitUnload:true}); return true;})()`)
      .catch(error => { console.error(`Could not close test tab ${tabId}:`, error); process.exitCode = 1; });
  }
  if (tabs.size) console.log('Test tabs closed; permission settings unchanged.');
}
