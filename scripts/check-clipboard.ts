// Uses a disposable page and per-call fixture-only island answers. Preserves the system clipboard.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { call, type Content } from '../src/zen.ts';
const text = (r: Content[]) => r.filter(c => c.type === 'text').map(c => c.text).join('\n');
const chrome = async (code: string) => JSON.parse(text(await call('chrome_eval', { code })));
const client = new Client({ name: 'codex-mcp-client', version: 'clipboard-smoke' });
const transport = new StdioClientTransport({ command: process.execPath, args: ['src/server.ts'], cwd: process.cwd() });
async function tool(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Content[];
  if (result.isError) throw new Error(text(content));
  return content;
}
const token = `zen-clipboard-test-${Date.now()}`;
let tabId: number | undefined, backup = false, modified = false;
let extensionDirectory: string | undefined, extensionInstalled = false;
const extensionId = `clipboard-fixture-${Date.now()}@local.invalid`;
let flavors: string[] = [];
try { flavors = execFileSync('wl-paste', ['--list-types'], { encoding: 'utf8', stdio: 'pipe' }).trim().split('\n').filter(Boolean); }
catch (e: any) { assert(e.status === 1 && String(e.stderr).includes('Nothing is copied'), 'Cannot safely inspect clipboard formats; no changes made.'); }
flavors = [...new Set(flavors.map(flavor => flavor.startsWith('text/plain') || ['UTF8_STRING','TEXT','STRING'].includes(flavor) ? 'text/plain' : flavor))];
const backupKey = `__zenClipboardBackup${Date.now()}`;
const originalTab = await chrome('Services.wm.getMostRecentWindow("navigator:browser").gBrowser.selectedBrowser.browserId');
try {
  const state = await chrome('({paused:h.state.paused,version:h.version})'); assert(!state.paused);
  console.log(text(await call('reload')));
  for (let i = 0; i < 50; i++) { await sleep(50); try { if (await chrome(`h.version>${state.version}`)) break; } catch {} }
  // Native values remain in the browser; clipboard content is never printed or sent to the model.
  await chrome(`(()=>{const w=Services.wm.getMostRecentWindow('navigator:browser');const Cc=Components.classes,Ci=Components.interfaces;const cb=Cc['@mozilla.org/widget/clipboard;1'].getService(Ci.nsIClipboard);const saved=Cc['@mozilla.org/widget/transferable;1'].createInstance(Ci.nsITransferable);saved.init(null);for(const flavor of ${JSON.stringify(flavors)}){const t=Cc['@mozilla.org/widget/transferable;1'].createInstance(Ci.nsITransferable);t.init(null);t.addDataFlavor(flavor);cb.getData(t,cb.kGlobalClipboard);const v={};t.getTransferData(flavor,v);saved.addDataFlavor(flavor);saved.setTransferData(flavor,v.value);}w[${JSON.stringify(backupKey)}]=saved;return true;})()`);
  backup = true;
  await client.connect(transport);
  tabId = JSON.parse(text(await tool('tabs_create_mcp'))).tabId;
  await tool('navigate', { tabId, url: 'data:text/html,' + encodeURIComponent('<!doctype html><title>Disposable clipboard fixture</title><textarea aria-label="Source">fixture selection</textarea><textarea aria-label="Destination"></textarea><script>for(const type of ["copy","paste"])document.addEventListener(type,event=>document.body.dataset[type]=String(event.isTrusted));</script>') });
  const tree = text(await tool('read_page', { tabId }));
  const sourceRef = tree.match(/textbox "Source" \[([^\]]+)\]/)?.[1];
  const targetRef = tree.match(/textbox "Destination" \[([^\]]+)\]/)?.[1]; assert(sourceRef && targetRef, tree);
  async function answer(allow: boolean) {
    for (let i = 0; i < 100; i++) {
      const ready = await chrome(`(()=>{if(h.island.state!=='ask')return false;const node=h.findTab(${tabId}).ownerDocument.getElementById('zen-mcp-island');if(!/System clipboard permission|Sistem panosu izni/.test(node.textContent))return false;node.querySelector('${allow ? '.ok' : '.cancel'}').click();return true;})()`);
      if (ready) return;
      await sleep(30);
    }
    throw new Error('Expected clipboard island request did not appear.');
  }
  async function approved(name: string, args: Record<string, unknown>, allow = true) {
    const pending = tool(name, { tabId, ...args }).then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
    await answer(allow);
    const result = await pending;
    if (allow) { assert(!result.error, String(result.error)); return result.value!; }
    assert(result.error && /denied|did not answer/.test(String(result.error))); return [];
  }
  await approved('clipboard', { action: 'write', text: token }, false);
  console.log('✓ Denied write does not touch system clipboard');
  await approved('clipboard', { action: 'write', text: token }); modified = true;
  const read = JSON.parse(text(await approved('clipboard', { action: 'read', max_chars: 10 })));
  assert.equal(read.text, token.slice(0, 10)); assert(read.truncated && read.untrusted);
  await approved('clipboard', { action: 'read' }, false);
  console.log('✓ Native write/read, truncation and per-call denial work through real MCP');
  await approved('clipboard', { action: 'paste', ref: targetRef });
  let result = text(await tool('javascript_tool', { tabId, action: 'javascript_exec', text: 'JSON.stringify({value:document.querySelectorAll("textarea")[1].value,trusted:document.body.dataset.paste})' }));
  assert(result.includes(token) && result.includes('true'), result);
  await tool('computer', { tabId, action: 'left_click', ref: sourceRef });
  await tool('computer', { tabId, action: 'key', text: 'ctrl+a' });
  await approved('clipboard', { action: 'copy' });
  result = JSON.parse(text(await approved('clipboard', { action: 'read' }))).text;
  assert.equal(result, 'fixture selection');
  console.log('✓ Native copy/paste work on the exact page and generate trusted clipboard events');
  await approved('computer', { action: 'key', text: 'ctrl+c' }, false);
  assert.equal(await chrome('Services.wm.getMostRecentWindow("navigator:browser").gBrowser.selectedBrowser.browserId'), originalTab, 'Clipboard operations must not switch tabs');
  console.log('✓ Ctrl+C cannot bypass consent; background page clipboard actions do not switch tabs');
  const batch = tool('browser_batch', { actions: [
    { name: 'clipboard', input: { tabId, action: 'read' } },
    { name: 'clipboard', input: { tabId, action: 'write', text: 'must never be written' } },
  ] }).then(value => ({value,error:undefined}),error => ({value:undefined,error}));
  await answer(true); await answer(false);
  assert((await batch).error, 'Second clipboard step must require its own approval');
  console.log('✓ Batch approval is never reused for a second clipboard operation');
  const changing = tool('clipboard', { tabId, action: 'paste', ref: targetRef }).then(() => null,error => error);
  // Wait for this fixture's prompt, then simulate a page update while approval is pending.
  for(let i=0;i<100;i++){if(await chrome(`h.island.state==='ask'`))break;await sleep(20);}
  await chrome(`(async()=>{await h.query(h.findTab(${tabId}).linkedBrowser,'eval',{code:'document.querySelectorAll("textarea")[1].value="changed while awaiting approval"'});return true;})()`);
  await answer(true);
  assert.match(String(await changing), /target\/selection changed/);
  console.log('✓ A field changed during approval cannot receive an old authorized paste');

  extensionDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'zen-clipboard-panel-'));
  fs.writeFileSync(path.join(extensionDirectory, 'manifest.json'), JSON.stringify({ manifest_version: 2, name: 'Zen clipboard panel fixture', version: '1.0', browser_specific_settings: { gecko: { id: extensionId } }, browser_action: { default_popup: 'popup.html' } }));
  fs.writeFileSync(path.join(extensionDirectory, 'popup.html'), '<!doctype html><title>Clipboard panel fixture</title><style>body{width:300px;height:140px}</style><textarea aria-label="Panel target"></textarea>');
  await chrome(`(async()=>{const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');const f=Components.classes['@mozilla.org/file/local;1'].createInstance(Components.interfaces.nsIFile);f.initWithPath(${JSON.stringify(extensionDirectory)});await AddonManager.installTemporaryAddon(f);return true;})()`);
  extensionInstalled = true;
  const opening = tool('extensions', { action: 'open', tabId, extensionId });
  for(let i=0;i<100;i++){
    const answered=await chrome(`(()=>{const n=h.findTab(${tabId}).ownerDocument.getElementById('zen-mcp-island');if(h.island.state!=='ask'||!n.textContent.includes('Zen clipboard panel fixture'))return false;n.querySelector('.ok').click();return true;})()`);
    if(answered)break;await sleep(30);
  }
  await opening;
  const panelTree = text(await tool('extensions', { action: 'read', tabId, extensionId }));
  const panelRef = panelTree.match(/textbox "Panel target" \[([^\]]+)\]/)?.[1];assert(panelRef,panelTree);
  const pasting = tool('clipboard', { action: 'paste', tabId, extensionId, ref: panelRef }).then(value=>({value,error:undefined}),error=>({value:undefined,error}));
  for(let i=0;i<100;i++){if(await chrome(`h.island.state==='ask'`))break;await sleep(20);}
  const pinned = await chrome(`(()=>{const {ExtensionParent}=ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');const {ViewPopup}=ChromeUtils.importESModule('resource:///modules/ExtensionPopups.sys.mjs');const win=h.findTab(${tabId}).ownerDocument.defaultView;return ViewPopup.for(ExtensionParent.GlobalManager.extensionMap.get(${JSON.stringify(extensionId)}),win).panel.getAttribute('noautohide');})()`);
  assert.equal(pinned,true,'Panel must stay open while island permission is shown');
  await answer(true);const pasted=await pasting;assert(!pasted.error,String(pasted.error));
  assert(text(await tool('extensions', { action: 'read', tabId, extensionId })).includes('fixture selection'));
  await tool('extensions', { action: 'close', tabId, extensionId });
  console.log('✓ Extension-panel paste uses separate consent and keeps the popup open during approval');
  console.log('All live clipboard checks passed.');
} finally {
  if (tabId !== undefined) {
    await chrome(`(()=>{const n=h.findTab(${tabId})?.ownerDocument.getElementById('zen-mcp-island');if(h.island.state==='ask' && /System clipboard permission|Sistem panosu izni/.test(n?.textContent||''))n.querySelector('.cancel').click();return true;})()`).catch(() => {});
    await tool('extensions', { action: 'close', tabId, extensionId }).catch(() => {});
    await chrome(`(()=>{const original=h.findTab(${originalTab}),test=h.findTab(${tabId});if(original&&test&&test.ownerDocument.defaultView.gBrowser.selectedTab===test)original.ownerDocument.defaultView.gBrowser.selectedTab=original;return true;})()`).catch(()=>{});
    await tool('tabs_close_mcp', { tabId }).catch(console.error);
  }
  await client.close();
  if(extensionInstalled) await chrome(`(async()=>{const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');await(await AddonManager.getAddonByID(${JSON.stringify(extensionId)}))?.uninstall();return true;})()`);
  if(extensionDirectory)fs.rmSync(extensionDirectory,{recursive:true});
  if (backup) {
    // The test is short; do not replace clipboard data copied independently during it.
    const unchanged = !modified || await chrome(`(()=>{const Cc=Components.classes,Ci=Components.interfaces;const c=Cc['@mozilla.org/widget/clipboard;1'].getService(Ci.nsIClipboard),t=Cc['@mozilla.org/widget/transferable;1'].createInstance(Ci.nsITransferable);t.init(null);t.addDataFlavor('text/plain');c.getData(t,c.kGlobalClipboard);const v={};t.getTransferData('text/plain',v);return [${JSON.stringify(token)},'fixture selection'].includes(v.value.QueryInterface(Ci.nsISupportsString).data);})()`).catch(() => false);
    if (modified && unchanged) {
      if (flavors.length) await chrome(`(()=>{const w=Services.wm.getMostRecentWindow('navigator:browser'),c=Components.classes['@mozilla.org/widget/clipboard;1'].getService(Components.interfaces.nsIClipboard);c.setData(w[${JSON.stringify(backupKey)}],null,c.kGlobalClipboard);return true;})()`);
      else execFileSync('wl-copy', ['--clear']);
      console.log('Original system clipboard restored.');
    } else if (modified) console.log('Clipboard changed outside this test; preserved the newer content.');
    await chrome(`(()=>{delete Services.wm.getMostRecentWindow('navigator:browser')[${JSON.stringify(backupKey)}];return true;})()`);
  }
}
