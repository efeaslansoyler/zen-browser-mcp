// Local-only fixtures. Adds 127.0.0.1 to sensitive sites temporarily, preserving config.
// Run from your terminal: node scripts/check-permissions.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { call, type Content } from '../src/zen.ts';
const text = (result: Content[]) => result.filter(c => c.type === 'text').map(c => c.text).join('\n');
const chrome = async (code: string) => JSON.parse(text(await call('chrome_eval', { code })));
const command = (tool: string, args: object = {}) => call(tool, args, 30_000, { id: 'codex', name: 'Codex' });
const configFile = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'zen-mcp/config.json');
const token = `zen-permission-test-${Date.now()}`;
let tabId: number | undefined, modified = false, temporary = '', backupFile: string | undefined;
const original = fs.existsSync(configFile) ? fs.readFileSync(configFile) : undefined;
let sensitiveURL = '';
const server = http.createServer((request, response) => {
  if (request.url === '/redirect') { response.writeHead(302, { Location: sensitiveURL }); response.end(); return; }
  if (request.url === '/embed') { response.setHeader('Content-Type', 'text/html'); response.end(`<!doctype html><title>Embedded fixture</title><iframe src="${sensitiveURL}"></iframe>`); return; }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><title>Zen permission test</title><h1>Disposable permission test</h1><p id="result">untouched</p>');
});
const write = () => ({ name: 'javascript_tool', input: { tabId, text: `document.getElementById("result").textContent=${JSON.stringify(token)}` } });
const settle = <T>(promise: Promise<T>) => promise.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
async function answer(result: 'done' | 'cancelled') {
  for (let i = 0; i < 100; i++) {
    const clicked = await chrome(`(() => {
      if(h.island.state!=="ask") return false;
      const el=h.findTab(${tabId}).ownerDocument.getElementById("zen-mcp-island");
      if(!el.textContent.includes(${JSON.stringify(token)})) return false;
      el.querySelector(${JSON.stringify(result === 'done' ? '.ok' : '.cancel')}).click();
      return true;
    })()`);
    if (clicked) return;
    await sleep(50);
  }
  throw new Error('Expected permission prompt for the disposable fixture did not appear.');
}
try {
  const state = await chrome('({version:h.version,paused:h.state.paused})');
  assert(!state.paused, 'Resume automation before running this test.');
  const settings = original ? JSON.parse(original.toString()) : { mode: 'auto', sensitive: [] };
  assert(settings.mode !== 'ask', 'This automatic test requires your existing auto mode; no settings have been changed.');
  const existing = settings.sensitive || [];
  assert(!existing.some((host: string) => ['localhost', '127.0.0.1'].includes(host.replace(/^\*?\./, ''))), 'Local fixture hosts are already sensitive; no settings have been changed.');
  console.log(text(await call('reload')));
  let ready = false;
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    try { if (await chrome(`h.version>${state.version}`)) { ready = true; break; } } catch {}
  }
  assert(ready, 'Bridge reload failed; check $XDG_RUNTIME_DIR/zen-mcp.log.');
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert(address && typeof address !== 'string');
  const ordinaryURL = `http://localhost:${address.port}/`;
  sensitiveURL = `http://127.0.0.1:${address.port}/`;
  tabId = JSON.parse(text(await command('tabs_create_mcp'))).tabId;
  await command('navigate', { tabId, url: ordinaryURL });
  temporary = JSON.stringify({ ...settings, sensitive: [...existing, '127.0.0.1'] }, null, 2) + '\n';
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  if (original) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zen-permission-backup-'));
    backupFile = path.join(dir, 'config.json');
    fs.writeFileSync(backupFile, original, { mode: 0o600 });
  }
  await sleep(20); // Ensure the config mtime differs even on millisecond-resolution filesystems.
  fs.writeFileSync(configFile, temporary, { mode: 0o600 });
  modified = true;
  for (const redirect of [false, true]) {
    await command('navigate', { tabId, url: ordinaryURL });
    const pending = settle(command('browser_batch', { actions: [
      { name: 'navigate', input: { tabId, url: redirect ? ordinaryURL + 'redirect' : sensitiveURL } },
      write(), write(),
    ] }));
    await answer('cancelled');
    const result = await pending;
    assert(!result.error, String(result.error));
    assert(result.value?.isError, 'Denied action must fail the batch');
    assert.match(text(result.value), /remaining 1 step/);
    const content = text(await command('get_page_text', { tabId }));
    assert(content.includes('untouched') && !content.includes(token), 'A denied write ran');
    console.log(`✓ ${redirect ? 'HTTP redirect' : 'Direct navigation'} to sensitive site asks; denial blocks remaining writes`);
  }
  await command('navigate', { tabId, url: ordinaryURL });
  const allowed = settle(command('browser_batch', { actions: [
    { name: 'navigate', input: { tabId, url: sensitiveURL } }, write(), write(),
  ] }));
  await answer('done');
  const result = await allowed;
  assert(!result.error && !result.value?.isError, 'Same-document writes failed after approval');
  assert(text(await command('get_page_text', { tabId })).includes(token));
  console.log('✓ Approval allows grouped writes on the unchanged destination document');
  // Switch the same local fixture from legacy sensitive to the unified blocked rule.
  const ordinaryTab = JSON.parse(text(await command('tabs_create_mcp'))).tabId;
  const embeddedTab = JSON.parse(text(await command('tabs_create_mcp'))).tabId;
  try {
    await command('navigate', { tabId: ordinaryTab, url: ordinaryURL });
    await command('navigate', { tabId: embeddedTab, url: ordinaryURL + 'embed' });
    temporary = JSON.stringify({ ...settings, sites: { ...settings.sites, '127.0.0.1': 'block' } }, null, 2) + '\n';
    await sleep(20);
    fs.writeFileSync(configFile, temporary, { mode: 0o600 });
    for (const tool of ['get_page_text', 'read_page', 'javascript_tool', 'computer']) {
      const result = await settle(command(tool, { tabId, text: 'document.title', action: 'screenshot' }));
      assert(result.error && /blocked/.test(String(result.error)), `${tool} must reject blocked page`);
    }
    console.log('✓ Blocked page rejects text/tree reads, JavaScript and screenshots');
    const embedded = await settle(command('computer', { tabId: embeddedTab, action: 'screenshot' }));
    assert(embedded.error && /blocked/.test(String(embedded.error)), 'A blocked iframe must prevent parent screenshots');
    console.log('✓ Loaded blocked iframe prevents screenshot access to its ordinary parent page');
    for (const url of [sensitiveURL, ordinaryURL + 'redirect']) {
      const result = await settle(command('navigate', { tabId: ordinaryTab, url }));
      assert(result.error && /blocked/.test(String(result.error)), `Navigation must reject ${url}: ${result.error}`);
    }
    console.log('✓ Direct navigation and HTTP redirect to blocked site rejected');
    const listing = JSON.parse(text(await command('tabs_context_mcp')));
    const blocked = listing.tabs.find((tab: any) => tab.tabId === tabId);
    assert(blocked.blocked && !blocked.title && !blocked.url);
    console.log('✓ Blocked tab title and URL are redacted from agent tab list');
    const menu = await chrome(`(() => {
      const tab=h.findTab(${tabId}); const win=tab.ownerDocument.defaultView;
      h.prepareTabMenu(win,[tab]);
      const menu=win.document.getElementById('tabContextMenu');
      const labels=[...menu.querySelectorAll('menu')].find(el=>el.getAttribute('label')?.includes('127.0.0.1'));
      return labels ? [...labels.querySelectorAll('menuitem')].map(el=>({label:el.getAttribute('label'),checked:el.getAttribute('checked')})) : null;
    })()`);
    assert(menu?.length === 3 && menu[2].checked === 'true', JSON.stringify(menu));
    console.log('✓ Real tab context menu shows three site rules and selected block');
  } finally {
    await command('tabs_close_mcp', { tabId: embeddedTab });
    await command('tabs_close_mcp', { tabId: ordinaryTab });
  }
  console.log('All live permission and site-rule checks passed.');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  // Dismiss only this fixture's question so a failed test cannot hold the queue open.
  if (tabId !== undefined) {
    await chrome(`(() => {
      const el=h.findTab(${tabId})?.ownerDocument.getElementById("zen-mcp-island");
      if(h.island.state==="ask" && el?.textContent.includes(${JSON.stringify(token)})) el.querySelector('.cancel').click();
      return true;
    })()`).catch(() => {});
  }
  if (modified) {
    if (fs.readFileSync(configFile, 'utf8') === temporary) {
      if (original) fs.writeFileSync(configFile, original);
      else fs.unlinkSync(configFile);
      console.log('Original permission configuration restored.');
      if (backupFile) fs.rmSync(path.dirname(backupFile), { recursive: true });
    } else {
      console.error(`Configuration changed during test; left it intact. Original backup: ${backupFile || '(no original file)'}`);
      process.exitCode = 1;
    }
  }
  if (tabId !== undefined) await command('tabs_close_mcp', { tabId }).catch(error => { console.error('Test tab cleanup failed:', error); process.exitCode = 1; });
  server.closeAllConnections();
  if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
}
