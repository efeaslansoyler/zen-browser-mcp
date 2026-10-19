import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { Ownership } from '../browser/Ownership.sys.mjs';
import { Cancellation } from '../browser/Cancellation.sys.mjs';
import { agentTheme } from '../browser/Agent.sys.mjs';
const source = fs.readFileSync(new URL('../browser/main.js', import.meta.url), 'utf8');
const block = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const timers = { setTimeout, clearTimeout };

test('owners are session IDs; the same agent type grants no shared access', () => {
  const owners = new Ownership();
  owners.assign(1, 'codex-A');
  owners.check(1, 'codex-A');
  assert.throws(() => owners.check(1, 'codex-B'), /another session/);
  assert.throws(() => owners.check(1, null), /another session/);
  assert.throws(() => owners.assign(2, ''), /session ID/);
});

test('transfer away and back still invalidates an old queue ticket', () => {
  const owners = new Ownership();
  owners.assign(1, 'A');
  const ticket = owners.ticket([1, 1]);
  owners.assign(1, 'B');
  owners.assign(1, 'A');
  assert.throws(() => owners.checkTicket(ticket), /changed/);
  const current = owners.ticket([1]);
  owners.assign(1, 'A');
  owners.checkTicket(current);
});

function harness() {
  const tabs = new Map(), effects = [], chromeTimers = new Map();
  const store = new Map();
  let next = 1, timerId = 0, started;
  const first = new Promise(resolve => { started = resolve; });
  const context = vm.createContext({
    Ownership, Cancellation, agentTheme, activeAgent: agentTheme({ id: 'codex' }), activeSession: null,
    ownership: new Ownership(), sessions: new Map(), sessionVersions: new Map(),
    ownerConnections: new Map(), disconnectTimers: new Map(),
    operation: null, stopGeneration: 0, toolQueue: Promise.resolve(),
    state: { tabs: new Set(), scale: new Map(), pickedTabs: new Set(), paused: false },
    network: new Map(), tabRequests: new Map(), MARK: 'zen-mcp',
    lastUse: new Map(), activeCalls: 0, island: null, commands: {},
    findTab: id => tabs.get(id), restoreMarks() {},
    SessionStore: {
      setCustomTabValue(tab, key, value) { store.set(`${tab.linkedBrowser.browserId}:${key}`, value); },
      getCustomTabValue(tab, key) { return store.get(`${tab.linkedBrowser.browserId}:${key}`) || ''; },
      deleteCustomTabValue(tab, key) { store.delete(`${tab.linkedBrowser.browserId}:${key}`); },
    },
    applyTheme(tab, theme) { tab.setAttribute('data-zen-agent', theme.id); return theme; },
    cancelAsk() {}, describeWrite: async () => undefined,
    requirePermission: async () => ({ context: {}, asked: false }),
    permissionContext: () => ({}), samePermissionContext: () => true,
    hostOf: () => 'fixture.test', describeAction: () => '', logActivity() {},
    L: en => en, shortRefs: x => x, logError() {},
    DialogOpen: class extends Error {}, Stopped: class extends Error {},
    setTimeout(fn) { chromeTimers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { chromeTimers.delete(id); },
    text: value => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    reply(_, output, result) { output.result = result; },
    tools: {
      read: async args => { context.browserFor(args.tabId); effects.push('read'); return []; },
      write: async args => { context.browserFor(args.tabId); effects.push('write'); return []; },
      wait: async args => { context.browserFor(args.tabId); started(); await context.operation.wait(30000, timers); return []; },
    },
  });
  function addTab() {
    const id = next++;
    const attrs = new Map();
    const tab = { isConnected: true, linkedPanel: true, label: `tab-${id}`,
      linkedBrowser: { browserId: id, currentURI: { spec: 'https://fixture.test/' } },
      style: { removeProperty() {}, setProperty() {} },
      getAttribute: key => attrs.get(key) || '', setAttribute: (key, value) => attrs.set(key, value),
      hasAttribute: key => attrs.has(key), removeAttribute: key => attrs.delete(key),
      ownerDocument: { defaultView: { gBrowser: { removeTab() { tabs.delete(id); tab.isConnected = false; } } } },
    };
    tabs.set(id, tab);
    return tab;
  }
  context.createTab = () => { const tab = addTab(); context.mark(tab); return tab; };
  vm.runInContext(block('    function sessionInfo(', '    function browserWindows(') +
    block('    function liveTabs(', '    // Claude in Chrome gibi') +
    block('    function paintTab(', '    function restoreMarks(') +
    block('    async function runTool(', '    // ---- etkinlik günlüğü:') +
    block('    async function handle(', '    function onConnection(') +
    'Object.assign(tools, ({' + block('      async tabs_context_mcp(', '      // Birkaç tool çağrısı') + '}));' +
    'tools.browser_batch = ({' + block('      async browser_batch(', '      async navigate(') + '}).browser_batch;' +
    'tools.request_tab = ({' + block('      async request_tab(', '      async file_upload(') + '}).request_tab;', context);
  const request = async (session, tool, args = {}) => {
    const output = {};
    await context.handle(JSON.stringify({ session, agent: { id: 'codex' }, tool, args }), null, output);
    return output.result;
  };
  const register = id => context.sessionInfo(id, agentTheme({ id: 'codex' }));
  const own = (id = 'A') => { register(id); const tab = addTab(); context.mark(tab, 'true', id); return tab.linkedBrowser.browserId; };
  return { context, tabs, effects, chromeTimers, first, request, register, own };
}

test('real dispatcher filters tab lists and blocks foreign reads, writes and closes', async () => {
  const h = harness();
  const a = h.own('A'), b = h.own('B');
  const listed = await h.request('A', 'tabs_context_mcp');
  assert.deepEqual(JSON.parse(listed.content[0].text).tabs.map(tab => tab.tabId), [a]);
  for (const tool of ['read', 'write', 'tabs_close_mcp']) {
    const result = await h.request('A', tool, { tabId: b });
    assert.equal(result.ok, false);
    assert.match(result.error, /another session/);
  }
  assert.deepEqual(h.effects, []);
  assert(h.tabs.has(b));
  assert.equal((await h.request('A', 'read', { tabId: a })).ok, true);
});

test('user transfer immediately cancels work; only the new owner can act', async () => {
  const h = harness();
  const tabId = h.own('A'); h.register('B');
  const pending = h.request('A', 'wait', { tabId });
  await h.first;
  h.context.mark(h.tabs.get(tabId), 'true', 'B');
  assert.match((await pending).error, /revoked or transferred/);
  assert.equal(h.context.state.paused, false);
  assert.equal((await h.request('A', 'write', { tabId })).ok, false);
  assert.equal((await h.request('B', 'write', { tabId })).ok, true);
});

test('old queued writes are rejected even after transfer back to the same owner', async () => {
  const h = harness();
  const tabId = h.own('A'); h.register('B');
  const pending = h.request('A', 'wait', { tabId });
  await h.first;
  const queued = h.request('A', 'write', { tabId });
  h.context.mark(h.tabs.get(tabId), 'true', 'B');
  h.context.mark(h.tabs.get(tabId), 'true', 'A');
  await pending;
  assert.match((await queued).error, /changed after this request was queued/);
  assert.deepEqual(h.effects, []);
  assert.equal((await h.request('A', 'write', { tabId })).ok, true);
});

test('taking back a tab cancels active work without closing the user tab', async () => {
  const h = harness();
  const tabId = h.own();
  const pending = h.request('A', 'wait', { tabId });
  await h.first;
  h.context.unmark(h.tabs.get(tabId));
  assert.match((await pending).error, /revoked or transferred/);
  assert(h.tabs.has(tabId));
  assert.equal((await h.request('A', 'read', { tabId })).ok, false);
});

test('an owner closing its created tab succeeds without self-cancellation', async () => {
  const h = harness();
  const tabId = h.own();
  assert.equal((await h.request('A', 'tabs_close_mcp', { tabId })).ok, true);
  assert(!h.tabs.has(tabId));
});

test('session end releases only its tabs and invalidates queued tab creation', async () => {
  const h = harness();
  const a = h.own('A'), b = h.own('B');
  const pending = h.request('A', 'wait', { tabId: a });
  await h.first;
  const queued = h.request('A', 'tabs_create_mcp');
  h.context.endOwnerSession('A');
  assert.match((await pending).error, /disconnected/);
  assert.match((await queued).error, /disconnected while the request was queued/);
  assert(h.tabs.has(a));
  assert.equal(h.context.ownership.owner(a), undefined);
  assert.equal(h.context.ownership.owner(b), 'B');
});

test('final lifecycle connection closing cancels work; reconnect grace preserves ownership', async () => {
  const h = harness();
  const tabId = h.own('A');
  const one = {}, two = {};
  const theme = agentTheme({ id: 'codex' });
  h.context.connectOwnerSession('A', one, theme, '/project');
  h.context.connectOwnerSession('A', two, theme, '/project');
  const pending = h.request('A', 'wait', { tabId });
  await h.first;
  h.context.disconnectOwnerSession('A', one);
  h.context.operation.check();
  h.context.disconnectOwnerSession('A', two);
  assert.match((await pending).error, /disconnected/);
  assert.equal(h.context.ownership.owner(tabId), 'A');
  h.context.connectOwnerSession('A', {}, theme, '/project');
  assert.equal(h.chromeTimers.size, 0);
  assert.equal(h.context.ownership.owner(tabId), 'A');
});

test('expired disconnect grace releases ownership but leaves the tab open', () => {
  const h = harness();
  const tabId = h.own('A'), transport = {};
  h.context.connectOwnerSession('A', transport, agentTheme({ id: 'codex' }), '/project');
  h.context.disconnectOwnerSession('A', transport);
  for (const callback of h.chromeTimers.values()) callback();
  assert.equal(h.context.ownership.owner(tabId), undefined);
  assert(h.tabs.has(tabId));
});

test('persisted marks without a live runtime owner cannot grant restored-tab access', () => {
  const h = harness();
  const tabId = h.own('A');
  h.context.sessions.delete('A');
  h.context.restoreMark(h.tabs.get(tabId));
  assert.equal(h.context.ownership.owner(tabId), undefined);
  assert.equal(h.tabs.get(tabId).hasAttribute('zen-mcp'), false);
});

test('request_tab requires an explicit answer and can transfer a picked foreign tab', async () => {
  const h = harness();
  const tabId = h.own('A');
  h.context.state.pickedTabs.add(tabId);
  h.context.askIsland = async () => 'cancelled';
  let result = await h.request('B', 'request_tab', { tabId, reason: 'test transfer' });
  assert.equal(result.ok, true);
  assert.equal(h.context.ownership.owner(tabId), 'A');
  h.context.askIsland = async () => 'done';
  result = await h.request('B', 'request_tab', { tabId, reason: 'test transfer' });
  assert.equal(result.ok, true);
  assert.equal(h.context.ownership.owner(tabId), 'B');
});

test('tool lifecycle subscriptions never become element-delivery targets', () => {
  const h = harness();
  h.context.subscribers = new Map();
  h.context.pendingDeliveries = new Map();
  h.context.shuttingDown = false;
  vm.runInContext(block('    function subscribe(', '    function channelTarget('), h.context);
  const transport = {};
  const id = h.context.subscribe({ session: 'A', toolsOnly: true, agent: { id: 'codex' }, cwd: '/project' }, transport, {});
  assert.equal(id, 'A');
  assert.equal(h.context.subscribers.size, 0);
  assert(h.context.ownerConnections.get('A').has(transport));
  h.context.unsubscribe(id, transport);
  assert.equal(h.context.sessions.get('A').disconnected, true);
});

test('pick access metadata is specific to the destination, not to agent branding', () => {
  const h = harness();
  const tabId = h.own('A');
  vm.runInContext(block('    function pickMessage(', '    const SHOTS_DIR'), h.context);
  const current = { browser: h.tabs.get(tabId).linkedBrowser, info: {
    rect: { x: 0, y: 0, width: 10, height: 10 }, viewport: { width: 100, height: 100 },
    styles: {}, url: 'https://fixture.test/', selector: '#element', html: '<div/>',
  } };
  assert.equal(h.context.pickMessage(current, 'note', 'A').meta.tab_id, String(tabId));
  assert.equal(h.context.pickMessage(current, 'note', 'B').meta.source_tab, String(tabId));
  h.context.unmark(h.tabs.get(tabId));
  assert.equal(h.context.pickMessage(current, 'note').meta.source_tab, String(tabId));
});

test('native tab closure cancels a pending wait and removes pick eligibility', async () => {
  const h = harness();
  const tabId = h.own('A');
  h.context.state.pickedTabs.add(tabId);
  vm.runInContext(block('    const onTabClose =', '    function watchWindow(') + 'globalThis.closeEvent = onTabClose;', h.context);
  const pending = h.request('A', 'wait', { tabId });
  await h.first;
  h.context.closeEvent({ target: h.tabs.get(tabId) });
  assert.match((await pending).error, /revoked or transferred/);
  assert.equal(h.context.state.pickedTabs.has(tabId), false);
});

test('session menu pins explicit fixture tabs even when native context points elsewhere', () => {
  const h = harness();
  const tabId = h.own('A');
  const other = h.own('B');
  let context = [h.tabs.get(tabId)];
  class Node {
    children = []; attrs = new Map(); listeners = new Map();
    setAttribute(key, value) { this.attrs.set(key, value); }
    getAttribute(key) { return this.attrs.get(key); }
    append(...nodes) { this.children.push(...nodes); }
    insertBefore(node, before) { const i = this.children.indexOf(before); if(i < 0) this.children.push(node); else this.children.splice(i, 0, node); }
    replaceChildren(...nodes) { this.children = nodes; }
    addEventListener(event, callback) { this.listeners.set(event, callback); }
    removeEventListener() {}
    remove() {}
    find(check) { if (check(this)) return this; for(const child of this.children) { const found=child.find(check); if(found)return found; } }
  }
  const menu = new Node(); menu.id = 'tabContextMenu';
  const win = { document: { createXULElement: () => new Node(), getElementById: id => menu.find(node => node.id === id) } };
  Object.assign(h.context, {
    MENU_ID: 'zen-mcp-context-give', tabMenuBuilders: new WeakMap(), contextTabs: () => context,
    menuAgent: () => agentTheme({ id: 'codex' }), paintMenuIcon() {},
    readConfig: () => ({ mode: 'auto' }), toggleMode() {},
  });
  vm.runInContext(block('    function attachMenu(', '    // ---- Claude Code oturumları:'), h.context);
  vm.runInContext(block('    function prepareTabMenu(', '    function menuAgent('), h.context);
  h.tabs.get(tabId).ownerDocument.defaultView = win;
  h.context.attachMenu(win);
  menu.listeners.get('popupshowing')({ target: menu });
  context = [h.tabs.get(other)]; // Native popup setup may change contextTab.
  h.context.prepareTabMenu(win, [h.tabs.get(tabId)]);
  assert.throws(() => h.context.prepareTabMenu(win, [h.tabs.get(other)]), /same window/);
  const a = menu.find(node => node.getAttribute('data-zen-session') === 'A');
  const b = menu.find(node => node.getAttribute('data-zen-session') === 'B');
  assert(a && b);
  assert.notEqual(a.getAttribute('label'), b.getAttribute('label'));
  b.listeners.get('command')();
  assert.equal(h.context.ownership.owner(tabId), 'B');
  menu.find(node => node.id === 'zen-mcp-context-give').listeners.get('command')();
  assert.equal(h.context.ownership.owner(tabId), undefined);
  assert.equal(h.context.ownership.owner(other), 'B', 'The unrelated selected tab must remain untouched');
});

test('a future batch tab transferred away and back cannot reuse its old authorization', async () => {
  const h = harness();
  const first = h.own('A'), second = h.own('A'); h.register('B');
  let next;
  const released = new Promise(resolve => { next = resolve; });
  h.context.tools.hold = async ({ tabId }) => { h.context.browserFor(tabId); await released; return []; };
  const pending = h.request('A', 'browser_batch', { actions: [
    { name: 'hold', input: { tabId: first } }, { name: 'write', input: { tabId: second } },
  ] });
  await new Promise(resolve => setImmediate(resolve));
  h.context.mark(h.tabs.get(second), 'true', 'B');
  h.context.mark(h.tabs.get(second), 'true', 'A');
  next();
  const result = await pending;
  assert(result.isError);
  assert.match(result.content[0].text, /changed after this request was queued/);
  assert.deepEqual(h.effects, []);
});

test('an explicit grant inside a batch refreshes only that tab authorization', async () => {
  const h = harness();
  const tabId = h.own('A');
  h.context.state.pickedTabs.add(tabId);
  h.context.askIsland = async () => 'done';
  const result = await h.request('B', 'browser_batch', { actions: [
    { name: 'request_tab', input: { tabId, reason: 'explicit test grant' } },
    { name: 'write', input: { tabId } },
  ] });
  assert.equal(result.ok, true);
  assert(!result.isError);
  assert.deepEqual(h.effects, ['write']);
});

test('bridge reload closes lifecycle transports without discarding runtime ownership', () => {
  const h = harness();
  const tabId = h.own('A');
  let closed = 0;
  h.context.connectOwnerSession('A', { close() { closed++; } }, agentTheme({ id: 'codex' }), '/project');
  Object.assign(h.context, {
    shuttingDown: false, sessionSweep: null, subscribers: new Map(), pendingDeliveries: new Map(),
    sss: { unregisterSheet() {}, USER_SHEET: 1 }, markSheet: {}, menuCleanups: new Set(),
    NETWORK_TOPICS: [], Services: { obs: { removeObserver() {} } },
    onWindowReady() {}, browserWindows: () => [], server: null,
    ChromeUtils: { unregisterWindowActor() {} }, localFile: () => ({ remove() {} }),
    socketPath: '/fixture.sock', Cr: { NS_OK: 0 },
  });
  vm.runInContext(block('    function stop() {', '    globalThis.zenMcpStop?.();'), h.context);
  h.context.stop();
  assert.equal(closed, 1);
  assert.equal(h.context.ownership.owner(tabId), 'A');
  assert(h.context.sessions.has('A'));
});
