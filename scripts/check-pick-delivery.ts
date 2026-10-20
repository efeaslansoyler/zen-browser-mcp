// Live, opt-in test: sends one browser pick to the exact current Codex chat.
// node scripts/check-pick-delivery.ts (requires CODEX_THREAD_ID in the environment)
// Add --automatic to verify the existing hook receiver without connect_session.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { call } from '../src/zen.ts';
import { contactRelay, ensureCodexRelay } from '../src/codex-relay.ts';
import { THREAD_ID } from '../src/delivery.ts';

const threadId = process.env.CODEX_THREAD_ID;
assert(threadId && THREAD_ID.test(threadId), 'Run in the intended Codex command environment; CODEX_THREAD_ID must be present.');
const label = `Zen delivery test ${randomUUID().slice(0, 8)}`;
const client = new Client({ name: 'codex-mcp-client', version: 'delivery-smoke' });
const transport = new StdioClientTransport({ command: process.execPath, args: ['src/server.ts'], cwd: process.cwd() });
const getText = (r: any) => r.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
async function tool(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert(!result.isError, getText(result));
  return result;
}
async function evaluate(code: string) { const [result] = await call('chrome_eval', { code }); assert.equal(result.type, 'text'); if (result.type !== 'text') throw new Error('Expected text'); return JSON.parse(result.text); }
const receiverExisted = await contactRelay(threadId);
const automatic = process.argv.includes('--automatic');
if (automatic) assert(receiverExisted, 'The hook must have started this conversation receiver already.');
let tabId: number | undefined;
try {
  await client.connect(transport);
  if (!automatic) await tool('connect_session', { threadId, label });
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    target = await evaluate(`[...h.subscribers.values()].filter(s => ${automatic ? `s.threadId === ${JSON.stringify(threadId)}` : `s.name.includes(${JSON.stringify(label)})`}).map(s => ({id:s.id,name:s.name}))[0] ?? null`);
    if (!target) await sleep(100);
  }
  assert(target, 'Codex subscription did not register');
  tabId = JSON.parse(getText(await tool('tabs_create_mcp'))).tabId;
  await tool('navigate', { tabId, url: 'data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><title>Zen selection delivery test</title><button style="font:24px system-ui;margin:60px;padding:20px">Queue test element</button>') });
  const tree = getText(await tool('read_page', { tabId }));
  const ref = tree.match(/button "Queue test element" \[([^\]]+)\]/)?.[1];
  assert(ref, tree);
  await evaluate(`(() => {const browser=h.findTab(${tabId}).linkedBrowser;h.startPick(browser.ownerDocument.defaultView,{browser});return true;})()`);
  await tool('computer', { tabId, action: 'left_click', ref });
  let ready = false;
  for (let i = 0; i < 40; i++) {
    ready = await evaluate('Boolean(h.pick?.info && h.island.pickMode === "compose")');
    if (ready) break;
    await sleep(100);
  }
  assert(ready, 'The browser element picker did not reach compose mode');
  const note = 'ZEN_PICK_QUEUE_TEST_20261020_B: Efe’nin onayladığı gerçek Zen öğe seçimi → Codex queue testidir. Bu mesaj sana sohbet girdisi olarak ulaşınca yalnızca alındığını ve öğe bağlamının geldiğini belirt; yeni mesaj gönderme ve dosya değiştirme.';
  await evaluate(`(async () => {await h.sendPick(${JSON.stringify(note)},${JSON.stringify(target.id)});return true;})()`);
  const result = await evaluate(`(() => {const i=h.findTab(${tabId}).linkedBrowser.ownerDocument.getElementById('zen-mcp-island');return {mode:h.island.pickMode,text:i.textContent,agent:i.getAttribute('data-zen-agent')};})()`);
  assert.equal(result.mode, 'sent');
  assert.equal(result.agent, 'codex');
  assert(result.text.includes('Queued for') || result.text.includes('kuyruğa alındı'), result.text);
  console.log('✓ Actual MCP binding → browser picker → element context/screenshot → codex queue → acknowledged mint island');
  console.log('Queued to thread:', threadId);
} finally {
  if (tabId) await tool('tabs_close_mcp', { tabId }).catch(() => {});
  await client.close();
  if (!automatic) {
    if (receiverExisted) await ensureCodexRelay({ threadId, cwd: process.cwd() });
    else await contactRelay(threadId, 'stop');
  }
}
