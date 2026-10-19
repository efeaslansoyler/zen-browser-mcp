import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../browser/main.js', import.meta.url), 'utf8');
const block = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function harness({ mode = 'auto', sensitive = [], site = 'https://ordinary.test', answer } = {}) {
  const settings = { mode, sensitive };
  const prompts = [], effects = [];
  const browser = { browserId: 1, browsingContext: {} };
  const navigate = (url, document = {}) => {
    const parsed = new URL(url);
    browser.currentURI = { host: parsed.hostname, prePath: parsed.origin, spec: parsed.href };
    browser.browsingContext.currentWindowGlobal = document;
  };
  navigate(site);
  const context = vm.createContext({
    readConfig: () => settings, operation: null, state: { paused: false, tabs: new Set([1]) },
    activeAgent: { name: 'Codex' }, activeCalls: 0,
    findTab: () => ({ linkedBrowser: browser }), paintTab() {}, describeAction: () => '', logActivity() {},
    island: null, L: en => en, shortRefs: x => x, Stopped: class extends Error {},
    DialogOpen: class extends Error {},
    askIsland: async (...args) => {
      prompts.push({ host: browser.currentURI.host, message: args[2] });
      return answer ? answer({ prompts, browser, navigate, settings }) : 'done';
    },
    text: value => [{ type: 'text', text: value }],
    tools: {
      navigate: async args => { navigate(args.url); return []; },
      javascript_tool: async args => { effects.push(args.text); return []; },
      redirect: async args => { navigate(args.url); return []; },
      changePolicy: async args => { Object.assign(settings, args.settings); return []; },
    },
  });
  vm.runInContext(block('    const hostOf =', "    // ---- tool'lar:") +
    block('    async function runTool(', '    // ---- etkinlik günlüğü:') +
    'tools.browser_batch = ({' + block('      async browser_batch(', '      async navigate(') + '}).browser_batch;', context);
  const action = (name, input = {}) => ({ name, input: { tabId: 1, ...input } });
  const batch = actions => context.tools.browser_batch({ actions });
  return { context, browser, prompts, effects, settings, navigate, batch, action };
}

test('auto-mode batch rechecks a sensitive destination after navigation', async () => {
  const h = harness({ sensitive: ['sensitive.test'] });
  const result = await h.batch([
    h.action('javascript_tool', { text: 'before' }),
    h.action('navigate', { url: 'https://sensitive.test/' }),
    h.action('javascript_tool', { text: 'after' }),
  ]);
  assert(!result.isError);
  assert.deepEqual(h.effects, ['before', 'after']);
  assert.equal(h.prompts.length, 1);
  assert.equal(h.prompts[0].host, 'sensitive.test');
});

test('denying redirected destination prevents its write and all remaining steps', async () => {
  const h = harness({ sensitive: ['sensitive.test'], answer: () => 'cancelled' });
  const result = await h.batch([
    h.action('redirect', { url: 'https://sub.sensitive.test/' }),
    h.action('javascript_tool', { text: 'must not run' }),
    h.action('javascript_tool', { text: 'also blocked' }),
  ]);
  assert(result.isError);
  assert.deepEqual(h.effects, []);
  assert.equal(h.prompts.length, 1);
  assert.match(result[0].text, /remaining 1 step/);
});

test('ask mode groups unchanged-page actions but asks again after navigation', async () => {
  const h = harness({ mode: 'ask' });
  await h.batch([
    h.action('javascript_tool', { text: 'one' }),
    h.action('javascript_tool', { text: 'two' }),
    h.action('navigate', { url: 'https://other.test/' }),
    h.action('javascript_tool', { text: 'three' }),
    h.action('javascript_tool', { text: 'four' }),
  ]);
  assert.deepEqual(h.effects, ['one', 'two', 'three', 'four']);
  assert.equal(h.prompts.length, 2);
  assert(!h.prompts[0].message.includes('three'), 'Destination actions must not be preapproved');
  assert(h.prompts[1].message.includes('three'));
});

test('same-origin document replacement invalidates a grant', async () => {
  const h = harness({ mode: 'ask' });
  await h.batch([
    h.action('javascript_tool', { text: 'one' }),
    h.action('redirect', { url: 'https://ordinary.test/new-page' }),
    h.action('javascript_tool', { text: 'two' }),
  ]);
  assert.equal(h.prompts.length, 2);
  assert.deepEqual(h.effects, ['one', 'two']);
});

test('navigation during the permission question requires a fresh answer', async () => {
  const h = harness({ mode: 'ask', answer: ({ prompts, navigate }) => {
    if (prompts.length === 1) { navigate('https://other.test/'); return 'done'; }
    return 'cancelled';
  } });
  const result = await h.batch([h.action('javascript_tool', { text: 'blocked' })]);
  assert(result.isError);
  assert.equal(h.prompts.length, 2);
  assert.deepEqual(h.effects, []);
  assert.equal(h.prompts[1].host, 'other.test');
});

test('a config change is checked even if the page did not change', async () => {
  const h = harness();
  await h.batch([
    h.action('javascript_tool', { text: 'auto' }),
    h.action('changePolicy', { settings: { mode: 'ask' } }),
    h.action('javascript_tool', { text: 'needs permission' }),
  ]);
  assert.equal(h.prompts.length, 1);
  assert.deepEqual(h.effects, ['auto', 'needs permission']);
});

test('approved grants are invalidated by policy edits and do not leak across batches', async () => {
  const h = harness({ mode: 'ask' });
  await h.batch([
    h.action('javascript_tool', { text: 'one' }),
    h.action('changePolicy', { settings: { sensitive: ['ordinary.test'] } }),
    h.action('javascript_tool', { text: 'two' }),
  ]);
  assert.equal(h.prompts.length, 2);
  await h.batch([h.action('javascript_tool', { text: 'three' })]);
  assert.equal(h.prompts.length, 3);
});

test('automatic ordinary-site actions remain prompt free', async () => {
  const h = harness();
  await h.batch([h.action('javascript_tool', { text: 'one' }), h.action('navigate', { url: 'https://other.test/' }), h.action('javascript_tool', { text: 'two' })]);
  assert.equal(h.prompts.length, 0);
  assert.deepEqual(h.effects, ['one', 'two']);
});

test('an origin change invalidates approval even before the document identity changes', async () => {
  const h = harness({ mode: 'ask' });
  h.context.tools.changeOrigin = async () => {
    h.navigate('https://other.test/', h.browser.browsingContext.currentWindowGlobal);
    return [];
  };
  await h.batch([h.action('javascript_tool', { text: 'one' }), h.action('changeOrigin'), h.action('javascript_tool', { text: 'two' })]);
  assert.equal(h.prompts.length, 2);
  assert.equal(h.prompts[1].host, 'other.test');
});

test('navigation while describing a target discards the old permission description', async () => {
  const h = harness({ mode: 'ask' });
  let descriptions = 0;
  h.context.longRef = x => x;
  h.context.queryRef = async () => {
    if (++descriptions === 2) h.navigate('https://other.test/');
    return { value: `target on ${h.browser.currentURI.host}` };
  };
  h.context.tools.form_input = async () => { h.effects.push('typed'); return []; };
  await h.batch([h.action('form_input', { ref: 'ref_1', value: 'hello' })]);
  assert.equal(h.prompts.length, 1);
  assert.equal(h.prompts[0].host, 'other.test');
  assert(!h.prompts[0].message.includes('ordinary.test'));
  assert.deepEqual(h.effects, ['typed']);
});
