import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { Cancellation } from '../browser/Cancellation.sys.mjs';
import { Ownership } from '../browser/Ownership.sys.mjs';
import * as agent from '../browser/Agent.sys.mjs';
const timers = { setTimeout, clearTimeout };

test('cancel clears outstanding timers and cannot be undone by starting new work', async () => {
  const handles = new Set();
  const clock = { setTimeout(fn) { handles.add(fn); return fn; }, clearTimeout(fn) { handles.delete(fn); } };
  const old = new Cancellation();
  const waiting = old.wait(30000, clock);
  const rejected = assert.rejects(waiting, /stopped/);
  old.cancel(new Error('stopped'));
  await rejected;
  assert.equal(handles.size, 0);
  const fresh = new Cancellation();
  fresh.check();
  assert.throws(() => old.check(), /stopped/);
});

test('cancel wins even when a response resolved before its continuation runs', async () => {
  const scope = new Cancellation();
  const result = scope.race(Promise.resolve('old result'));
  scope.cancel(new Error('stopped'));
  await assert.rejects(result, /stopped/);
});

function actorHarness() {
  const events = [];
  let firstEvent;
  const first = new Promise(resolve => { firstEvent = resolve; });
  const emit = value => { events.push(value); firstEvent(); };
  const source = fs.readFileSync(new URL('../browser/actors/ZenMcpChild.sys.mjs', import.meta.url), 'utf8');
  const context = vm.createContext({
    JSWindowActorChild: class {}, URL, Cancellation, Ci: {}, Cc: {},
    ChromeUtils: { importESModule(url) {
      if (url.includes('Cancellation')) return { Cancellation };
      if (url.includes('Timer')) return timers;
      return agent;
    } },
    Services: { locale: { appLocaleAsBCP47: 'en' }, scriptloader: { loadSubScript(_, eu) {
      eu.sendString = text => emit(['text', text]);
      eu.synthesizeKey = key => emit(['key', key]);
      eu.synthesizeMouseAtPoint = (x, y, event) => emit(['mouse', event.type, x, y]);
      eu.synthesizeWheelAtPoint = () => emit(['wheel']);
    } } },
  });
  // Run the real actor class with browser APIs stubbed at the platform boundary.
  vm.runInContext(source.replaceAll('import.meta.url', JSON.stringify('file:///browser/actors/ZenMcpChild.sys.mjs')).replace('export class ZenMcpChild', 'globalThis.Actor = class ZenMcpChild'), context);
  const actor = new context.Actor();
  actor.contentWindow = { innerWidth: 100, innerHeight: 100, devicePixelRatio: 1 };
  const node = () => ({ isConnected: true, style: { setProperty() {} }, setAttribute() {},
    classList: { add() {}, remove() {} }, append() {}, attachShadow() { return node(); } });
  actor.document = { activeElement: null, hidden: true, createElement: node,
    documentElement: node(), elementFromPoint: () => null,
    scrollingElement: { scrollLeft: 0, scrollTop: 0, scrollBy: () => emit(['fallback-scroll']) } };
  return { actor, events, first };
}

for (const kind of ['text', 'keys']) {
  test(`actor cancels ${kind} midway; fresh request works without resuming old input`, async () => {
    const { actor, events, first } = actorHarness();
    // Cursor labels are optional when the cursor has not been created.
    const data = { requestId: 1, kind, text: 'x'.repeat(500), keys: Array.from({ length: 500 }, () => ({ key: 'a', mods: {} })) };
    const pending = actor.receiveMessage({ name: 'input', data });
    await first;
    await actor.receiveMessage({ name: 'cancel_operation', data: { requestId: 1 } });
    const result = await pending;
    assert.match(result.error, /cancelled/);
    const count = events.length;
    assert(count > 0 && count < 500);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(events.length, count);
    const next = await actor.receiveMessage({ name: 'input', data: { requestId: 2, kind: 'text', text: 'OK' } });
    assert.equal(next.value, 'done');
    assert.equal(events.slice(count).map(e => e[1]).join(''), 'OK');
  });
}

test('real parent batch and queue stay cancelled across immediate Stop/Resume', async () => {
  const source = fs.readFileSync(new URL('../browser/main.js', import.meta.url), 'utf8');
  const block = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const replies = [];
  const effects = [];
  let started;
  const first = new Promise(resolve => { started = resolve; });
  const context = vm.createContext({
    Cancellation, ...timers, state: { paused: false, tabs: new Map() },
    operation: null, stopGeneration: 0, toolQueue: Promise.resolve(),
    ownership: new Ownership(), sessions: new Map([['test-session', {}]]), sessionVersions: new Map(),
    sessionInfo() { return {}; }, activeSession: null,
    activeAgent: {}, island: null, activeCalls: 0,
    liveTabs: () => [], cancelAsk() {}, logActivity() {},
    findTab() {}, paintTab() {}, describeWrite() {}, requirePermission() {},
    agentTheme: () => ({ id: 'codex' }), lastUse: new Map(), commands: {},
    text: value => [{ type: 'text', text: value }],
    reply: (_, __, result) => replies.push(result), logError() {},
    DialogOpen: class extends Error {}, shortRefs: x => x,
    tools: {
      wait: async () => { started(); await context.operation.wait(30000, timers); return []; },
      effect: async () => { effects.push('ran'); return []; },
    },
  });
  vm.runInContext(block('    class Stopped extends Error', '    // Adada evet/hayır sorusu') +
    block('    async function runTool(', '    // ---- etkinlik günlüğü:') +
    block('    async function handle(', '    function onConnection(') +
    'tools.browser_batch = ({' + block('      async browser_batch(', '      async navigate(') + '}).browser_batch;', context);
  const batch = context.handle(JSON.stringify({ session: 'test-session', tool: 'browser_batch', args: { actions: [
    { name: 'wait' }, { name: 'effect' },
  ] } }));
  await first;
  const queued = context.handle(JSON.stringify({ session: 'test-session', tool: 'effect' }));
  context.stopClaude();
  context.resumeClaude();
  await Promise.all([batch, queued]);
  assert.equal(effects.length, 0);
  assert.equal(replies[0].isError, true);
  assert.match(replies[0].content[0].text, /remaining 1 step/);
  assert.equal(replies[1].ok, false);
  assert.match(replies[1].error, /stopped/);
  await context.handle(JSON.stringify({ session: 'test-session', tool: 'effect' }));
  assert.equal(effects.length, 1);
  assert.equal(replies.at(-1).ok, true);
});

test('cancel navigation stops loading and removes its listener and timeout', async () => {
  const source = fs.readFileSync(new URL('../browser/main.js', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('    function waitForLoad('), source.indexOf('    const sleep ='));
  const scope = new Cancellation();
  const handles = new Set();
  let stopped = 0, removed = 0;
  const browser = { addProgressListener() {}, removeProgressListener() { removed++; }, stop() { stopped++; } };
  const context = vm.createContext({ operation: scope, pendingListeners: new Set(),
    ChromeUtils: { generateQI() {} }, Ci: { nsIWebProgress: { NOTIFY_STATE_WINDOW: 1 } },
    setTimeout: fn => { handles.add(fn); return fn; }, clearTimeout: fn => handles.delete(fn),
  });
  vm.runInContext(code, context);
  const loaded = context.waitForLoad(browser);
  scope.cancel();
  await loaded;
  assert.equal(stopped, 1);
  assert.equal(removed, 1);
  assert.equal(handles.size, 0);
  assert.equal(context.pendingListeners.size, 0);
});

for (const kind of ['drag', 'wheel', 'click']) {
  test(`actor cancellation cleans up ${kind} without subsequent input`, async () => {
    const { actor, events, first } = actorHarness();
    if (kind === 'click') actor.document.hidden = false;
    const pending = actor.receiveMessage({ name: 'input', data: {
      requestId: 7, kind, x: 10, y: 10, to: [80, 80], dx: 0, dy: 100,
    } });
    if (kind === 'click') await new Promise(resolve => setTimeout(resolve, 10));
    else await first;
    await actor.receiveMessage({ name: 'cancel_operation', data: { requestId: 7 } });
    const result = await pending;
    assert.match(result.error, /cancelled/);
    if (kind === 'drag') {
      assert.equal(events.filter(e => e[1] === 'mousedown').length, 1);
      assert.equal(events.filter(e => e[1] === 'mouseup').length, 1);
      assert.equal(events.filter(e => e[1] === 'mousemove').length, 1);
    } else if (kind === 'wheel') assert.deepEqual(events, [['wheel']]);
    else assert.deepEqual(events, []);
  });
}

test('parent cancellation module loads through the trusted resource scheme', () => {
  const source = fs.readFileSync(new URL('../browser/main.js', import.meta.url), 'utf8');
  const declaration = source.split('\n').find(line => line.includes('const { Cancellation }'));
  assert(declaration, 'Cancellation import missing');
  let loaded;
  vm.runInNewContext(declaration, {
    dirURI: 'file:///home/example/browser/', version: 12,
    ChromeUtils: { importESModule(uri) {
      assert(uri.startsWith('resource://'), 'Firefox rejects untrusted module schemes');
      loaded = uri;
      return { Cancellation };
    } },
  });
  assert.equal(loaded, 'resource://zenmcp/Cancellation.sys.mjs?v=12');
});
