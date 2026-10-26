import test from 'node:test';
import assert from 'node:assert/strict';
import * as agentModule from '../browser/Agent.sys.mjs';

// Minimal chrome DOM: exercises the real Island class rendering and state transitions.
class Element {
  children = [];
  attrs = new Map();
  style = { setProperty: (k, v) => this.attrs.set(k, v) };
  classList = { toggle() {} };
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(k, v) { this.attrs.set(k, v); }
  removeAttribute(k) { this.attrs.delete(k); }
  listeners = new Map();
  addEventListener(event, callback) { this.listeners.set(event, callback); }
  replaceChildren(...nodes) { this.children = nodes; }
  focus() {}
  removeEventListener() {}
  remove() {}
  querySelector(selector) {
    for (const child of this.children) {
      if (child.className?.split(' ').includes(selector.slice(1))) return child;
      const match = child.querySelector(selector);
      if (match) return match;
    }
    return null;
  }
}

test('island switches clients, confirmation, pause and Claude selection without stale branding', async () => {
  const originalServices = globalThis.Services;
  const originalChromeUtils = globalThis.ChromeUtils;
  globalThis.Services = { locale: { appLocaleAsBCP47: 'en' }, io: { newURI: x => x } };
  globalThis.ChromeUtils = { importESModule: () => agentModule };
  try {
    const { Island } = await import('../browser/Island.sys.mjs');
    const documentElement = new Element();
    const win = {
      document: { documentElement, createElementNS: () => new Element() },
      windowUtils: { loadSheet() {}, removeSheet() {}, AUTHOR_SHEET: 1 },
      gBrowser: { tabContainer: new Element() },
      addEventListener() {}, removeEventListener() {},
    };
    const browser = { ownerDocument: { defaultView: win }, currentURI: { host: 'example.test' } };
    const sent = [];
    const selections = [];
    const answers = [];
    const island = new Island({ answer: (...args) => answers.push(args), send: (...args) => sent.push(args), selectTarget: value => selections.push(value) }, { setTimeout: () => 1, clearTimeout() {} });
    island.attach(win);
    const el = documentElement.children[0];
    const expectTheme = (name, color) => {
      assert.equal(el.attrs.get('aria-label'), name);
      assert.equal(el.attrs.get('--zen-agent-accent'), color);
      assert.match(el.querySelector('.action').textContent, new RegExp(name));
      assert.equal(el.hidden, false);
    };
    island.setAgent(agentModule.identifyAgent('codex-mcp-client'));
    island.working(browser, 'example.test — clicking');
    expectTheme('Codex', '#a7e8d0');
    assert.match(el.querySelector('.spark').style.background, /assets\/codex\.svg/);
    island.ask(browser, 'permission', 'Test confirmation', true);
    expectTheme('Codex', '#a7e8d0');
    assert.equal(el.querySelector('.message').textContent, 'Test confirmation');
    el.querySelector('.answer-note').value = '  Use another tab  ';
    el.querySelector('.cancel').listeners.get('click')();
    assert.deepEqual(answers.pop(), [browser, 'cancelled', 'Use another tab']);
    island.ask(browser, 'permission', 'Next question', true);
    assert.equal(el.querySelector('.answer-note').value, '');
    el.querySelector('.ok').listeners.get('click')();
    assert.deepEqual(answers.pop(), [browser, 'done', '']);
    el.querySelector('.answer-note').value = 'Only read the title';
    el.querySelector('.ok').listeners.get('click')();
    assert.deepEqual(answers.pop(), [browser, 'done', 'Only read the title']);
    island.askEnded();
    island.stopped();
    expectTheme('Codex', '#a7e8d0');
    assert.equal(el.querySelector('.stop').textContent, 'Resume');
    island.resumed();
    island.setAgent(agentModule.identifyAgent('claude-code'));
    island.working(browser, 'example.test — reading');
    expectTheme('Claude', '#d97757');
    island.setAgent(agentModule.identifyAgent('Another Agent'));
    island.working(browser, 'example.test — reading');
    expectTheme('Another Agent', '#87b8f5');
    island.picking(browser);
    expectTheme('Claude', '#d97757');
    island.pickEnded();
    expectTheme('Another Agent', '#87b8f5');
    const targets = [
      { id: 'codex-session', name: 'Codex · project', agent: agentModule.identifyAgent('codex') },
      { id: 'claude-session', name: 'Claude · project', agent: agentModule.identifyAgent('claude') },
    ];
    island.compose(browser, 'button Test', targets, 'codex-session');
    expectTheme('Codex', '#a7e8d0');
    const select = el.querySelector('.target');
    assert.equal(select.value, 'codex-session');
    select.value = 'claude-session';
    select.listeners.get('change')();
    expectTheme('Claude', '#d97757');
    assert.equal(selections[0].id, 'claude-session');
    const compose = el.children[2];
    const note = compose.children[0];
    const sendButton = compose.children[1].children[2];
    note.value = 'Change this button';
    sendButton.listeners.get('click')();
    sendButton.listeners.get('click')();
    assert.deepEqual(sent, [['Change this button', 'claude-session']]);
    assert.equal(select.disabled, true);
    island.sent('Queued');
    expectTheme('Claude', '#d97757');
    island.pickEnded();
    island.compose(browser, 'button Again', targets, 'codex-session');
    assert.equal(sendButton.disabled, false);
    island.destroy();
  } finally {
    globalThis.Services = originalServices;
    globalThis.ChromeUtils = originalChromeUtils;
  }
});
