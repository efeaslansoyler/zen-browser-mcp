import test from "node:test";
import assert from "node:assert/strict";
import * as agentModule from "../browser/Agent.sys.mjs";

// Minimal chrome DOM: exercises the real Island class rendering and state transitions.
class Element {
  children = [];
  value = "";
  attrs = new Map();
  style = { setProperty: (k, v) => this.attrs.set(k, v) };
  classList = { toggle() {} };
  append(...nodes) {
    this.children.push(...nodes);
  }
  setAttribute(k, v) {
    this.attrs.set(k, v);
  }
  removeAttribute(k) {
    this.attrs.delete(k);
  }
  toggleAttribute(k, on) {
    if (on) this.attrs.set(k, "");
    else this.attrs.delete(k);
  }
  listeners = new Map();
  addEventListener(event, callback) {
    this.listeners.set(event, callback);
  }
  replaceChildren(...nodes) {
    this.children = nodes;
  }
  focus() {}
  removeEventListener() {}
  remove() {}
  querySelector(selector) {
    for (const child of this.children) {
      if (typeof child !== "object") continue; // text
      if (child.className?.split(" ").includes(selector.slice(1))) return child;
      const match = child.querySelector(selector);
      if (match) return match;
    }
    return null;
  }
}

test("island switches clients, confirmation, pause and Claude selection without stale branding", async () => {
  const originalServices = globalThis.Services;
  const originalChromeUtils = globalThis.ChromeUtils;
  globalThis.Services = { locale: { appLocaleAsBCP47: "en" }, io: { newURI: (x) => x } };
  globalThis.ChromeUtils = { importESModule: () => agentModule };
  try {
    const { Island } = await import("../browser/Island.sys.mjs");
    const documentElement = new Element();
    const win = {
      document: { documentElement, createElementNS: () => new Element() },
      windowUtils: { loadSheet() {}, removeSheet() {}, AUTHOR_SHEET: 1 },
      gBrowser: { tabContainer: new Element() },
      addEventListener() {},
      removeEventListener() {},
    };
    const browser = { ownerDocument: { defaultView: win }, currentURI: { host: "example.test" } };
    const sent = [];
    const selections = [];
    const answers = [];
    const island = new Island(
      {
        answer: (...args) => answers.push(args),
        send: (...args) => sent.push(args),
        selectTarget: (value) => selections.push(value),
      },
      { setTimeout: () => 1, clearTimeout() {} },
    );
    island.attach(win);
    const el = documentElement.children[0];
    const expectTheme = (name, color) => {
      assert.equal(el.attrs.get("aria-label"), name);
      assert.equal(el.attrs.get("--zen-agent-accent"), color);
      assert.match(el.querySelector(".action").textContent, new RegExp(name));
      assert.equal(el.hidden, false);
    };
    island.setAgent(agentModule.identifyAgent("codex-mcp-client"));
    island.working(browser, "example.test — clicking");
    expectTheme("Codex", "#a7e8d0");
    assert.match(el.querySelector(".spark").style.background, /assets\/codex\.svg/);
    const first = island.ask(browser, "permission", "Test confirmation", true);
    expectTheme("Codex", "#a7e8d0");
    assert.equal(el.querySelector(".message").textContent, "Test confirmation");
    el.querySelector(".answer-note").value = "  Use another tab  ";
    el.querySelector(".cancel").listeners.get("click")();
    assert.deepEqual(answers.pop(), [browser, "cancelled", "Use another tab"]);
    island.askEnded(first);
    const next = island.ask(browser, "permission", "Next question", true);
    assert.equal(el.querySelector(".answer-note").value, "");
    el.querySelector(".ok").listeners.get("click")();
    assert.deepEqual(answers.pop(), [browser, "done", ""]);
    el.querySelector(".answer-note").value = "Only read the title";
    el.querySelector(".ok").listeners.get("click")();
    assert.deepEqual(answers.pop(), [browser, "done", "Only read the title"]);
    island.askEnded(next);
    island.stopped();
    expectTheme("Codex", "#a7e8d0");
    assert.equal(el.querySelector(".stop").textContent, "Resume");
    island.resumed();
    island.setAgent(agentModule.identifyAgent("claude-code"));
    island.working(browser, "example.test — reading");
    expectTheme("Claude", "#d97757");
    island.setAgent(agentModule.identifyAgent("Another Agent"));
    island.working(browser, "example.test — reading");
    expectTheme("Another Agent", "#87b8f5");
    island.picking(browser);
    expectTheme("Claude", "#d97757");
    island.pickEnded();
    expectTheme("Another Agent", "#87b8f5");
    const targets = [
      { id: "codex-session", name: "Codex · project", agent: agentModule.identifyAgent("codex") },
      { id: "claude-session", name: "Claude · project", agent: agentModule.identifyAgent("claude") },
    ];
    island.compose(browser, "button Test", targets, "codex-session");
    expectTheme("Codex", "#a7e8d0");
    const select = el.querySelector(".target");
    assert.equal(select.value, "codex-session");
    select.value = "claude-session";
    select.listeners.get("change")();
    expectTheme("Claude", "#d97757");
    assert.equal(selections[0].id, "claude-session");
    const compose = el.querySelector(".compose");
    const note = compose.children[0];
    const sendButton = el.querySelector(".compose-footer").children[2];
    note.value = "Change this button";
    sendButton.listeners.get("click")();
    sendButton.listeners.get("click")();
    assert.deepEqual(sent, [["Change this button", "claude-session", []]]);
    assert.equal(select.disabled, true);
    island.sent("Queued");
    expectTheme("Claude", "#d97757");
    island.pickEnded();
    island.compose(browser, "button Again", targets, "codex-session");
    assert.equal(sendButton.disabled, false);
    island.destroy();
  } finally {
    globalThis.Services = originalServices;
    globalThis.ChromeUtils = originalChromeUtils;
  }
});

test("island asks with option buttons and without a tab", async () => {
  const originalServices = globalThis.Services;
  const originalChromeUtils = globalThis.ChromeUtils;
  globalThis.Services = { locale: { appLocaleAsBCP47: "en" }, io: { newURI: (x) => x } };
  globalThis.ChromeUtils = { importESModule: () => agentModule };
  try {
    const { Island } = await import("../browser/Island.sys.mjs");
    const makeWindow = () => {
      const documentElement = new Element();
      return {
        document: { documentElement, createElementNS: () => new Element() },
        windowUtils: { loadSheet() {}, removeSheet() {}, AUTHOR_SHEET: 1 },
        gBrowser: { tabContainer: new Element() },
        addEventListener() {},
        removeEventListener() {},
      };
    };
    const win = makeWindow();
    const other = makeWindow();
    const browser = { ownerDocument: { defaultView: win }, currentURI: { host: "example.test" } };
    const answers = [];
    const island = new Island({ answer: (...args) => answers.push(args) }, { setTimeout: () => 1, clearTimeout() {} });
    island.attach(win);
    island.attach(other);
    const el = win.document.documentElement.children[0];
    const otherEl = other.document.documentElement.children[0];

    const color = island.ask(browser, "needs you", "Which color?", true, {}, ["Red", "Blue"]);
    const choices = el.querySelector(".choices");
    assert.equal(choices.hidden, false);
    assert.deepEqual(
      choices.children.map((button) => button.textContent),
      ["Red", "Blue"],
    );
    assert.equal(el.querySelector(".ok").hidden, true);
    assert.equal(otherEl.hidden, true, "a tab question stays in its own window");
    el.querySelector(".answer-note").value = " darker ";
    choices.children[1].listeners.get("click")();
    assert.deepEqual(answers.pop(), [browser, "done", "darker", "Blue"]);
    island.askEnded(color);
    assert.equal(choices.children.length, 0);
    assert.equal(el.querySelector(".ok").hidden, true);

    const site = island.ask(null, "needs you", "Which site should I use?", true, {}, ["A", "B"]);
    assert.equal(el.hidden, false);
    assert.equal(otherEl.hidden, false, "a tab-less question shows in every window");
    assert.equal(el.querySelector(".goto").hidden, true);
    otherEl.querySelector(".choices").children[0].listeners.get("click")();
    assert.deepEqual(answers.pop(), [null, "done", "", "A"]);
    el.querySelector(".cancel").listeners.get("click")();
    assert.deepEqual(answers.pop(), [null, "cancelled", ""]);
    island.askEnded(site);
    assert.equal(el.hidden, true);
    assert.equal(otherEl.hidden, true);

    island.ask(null, "needs you", "Stop me", true, {}, ["A", "B"]);
    island.stopped();
    assert.equal(el.querySelector(".choices").children.length, 0, "stop clears the answer buttons");
    island.resumed();

    island.ask(null, "needs you", "Ready?", true);
    assert.equal(el.querySelector(".choices").hidden, true);
    assert.equal(el.querySelector(".ok").hidden, false);
    island.destroy();
  } finally {
    globalThis.Services = originalServices;
    globalThis.ChromeUtils = originalChromeUtils;
  }
});

test("several agents share one row; question cards never change under the user", async () => {
  const originalServices = globalThis.Services;
  const originalChromeUtils = globalThis.ChromeUtils;
  globalThis.Services = { locale: { appLocaleAsBCP47: "en" }, io: { newURI: (x) => x } };
  globalThis.ChromeUtils = { importESModule: () => agentModule };
  try {
    const { Island } = await import("../browser/Island.sys.mjs");
    const documentElement = new Element();
    const win = {
      document: { documentElement, createElementNS: () => new Element() },
      windowUtils: { loadSheet() {}, removeSheet() {}, AUTHOR_SHEET: 1 },
      gBrowser: { tabContainer: new Element() },
      addEventListener() {},
      removeEventListener() {},
    };
    const tab = (host) => ({ ownerDocument: { defaultView: win }, currentURI: { host } });
    const [a, b] = [tab("a.test"), tab("b.test")];
    const answers = [];
    const timers = [];
    const holds = new Map();
    const island = new Island(
      { answer: (...args) => answers.push(args), holdOf: (browser) => holds.get(browser) ?? null },
      { setTimeout: (fn) => timers.push(fn), clearTimeout() {} },
    );
    island.attach(win);
    const el = documentElement.children[0];
    const workers = el.querySelector(".workers");
    const shown = () => workers.querySelector(".action").textContent;
    const icons = () => workers.querySelector(".pager").children[1].children;
    const claude = agentModule.identifyAgent("claude-code");
    const codex = agentModule.identifyAgent("codex-mcp-client");

    island.working(a, "a.test — clicking", { session: "A", agent: claude });
    assert.equal(el.attrs.get("state"), "working");
    assert.equal(workers.querySelector(".pager").hidden, true, "one agent: no icons");
    island.working(b, "b.test — typing", { session: "B", agent: codex });
    assert.match(shown(), /^Claude · clicking/, "the row doesn't jump to every new action");
    assert.equal(workers.querySelector(".pager").hidden, false);
    assert.equal(icons().length, 2);
    assert(icons()[0].attrs.has("on"));
    assert(icons()[1].attrs.has("recent"), "the agent that just acted glows");
    workers.querySelector(".pager").children[2].listeners.get("click")(); // ▶
    assert.match(shown(), /^Codex · typing/);
    island.working(a, "a.test — reading", { session: "A", agent: claude });
    assert.match(shown(), /^Codex/, "a picked agent stays on the row");
    holds.set(b, { session: "B", reason: "Paying", endsIn: "5 min" });
    island.working(b, "b.test — typing", { session: "B", agent: codex });
    assert.equal(workers.querySelector(".lock").hidden, false);
    assert.equal(workers.querySelector(".lock").textContent, "🔒 5 min");
    assert(icons()[1].attrs.has("locked"));

    const token = {};
    const first = island.ask(a, "a.test — asks for permission", "Claude wants to click", true, {}, [], {
      agent: claude,
    });
    assert.equal(el.attrs.get("state"), "ask");
    assert(workers.attrs.has("busy"), "the agents' row stays under the card");
    const second = island.ask(null, "asks", "Codex wants to know", true, {}, [], { key: token, agent: codex });
    assert.equal(el.querySelector(".message").textContent, "Claude wants to click", "the card on screen stays");
    const next = el.querySelector(".main").children[3].children[2];
    assert(next.attrs.has("unseen"), "a dot tells a new card came");
    assert.match(el.querySelector(".count").children[0], /^1\/2$/);
    next.listeners.get("click")();
    assert.equal(el.querySelector(".message").textContent, "Codex wants to know");
    assert(!next.attrs.has("unseen"));
    assert.equal(el.attrs.get("--zen-agent-accent"), "#a7e8d0", "the island takes the asking agent's color");
    el.querySelector(".ok").listeners.get("click")();
    assert.deepEqual(answers.pop(), [token, "done", ""]);
    island.askEnded(second);
    assert.equal(el.querySelector(".message").textContent, "Claude wants to click");
    island.askEnded(first);
    assert.equal(el.attrs.get("state"), "working");

    // a finished agent's row goes a little later; the last one hides the island
    island.finished("A");
    island.finished("B");
    for (const run of timers.splice(0)) run();
    assert.equal(el.hidden, true);
    island.destroy();
  } finally {
    globalThis.Services = originalServices;
    globalThis.ChromeUtils = originalChromeUtils;
  }
});

test("a multi-element pick's note step has a general field and one numbered field per element", async () => {
  const originalServices = globalThis.Services;
  const originalChromeUtils = globalThis.ChromeUtils;
  globalThis.Services = { locale: { appLocaleAsBCP47: "en" }, io: { newURI: (x) => x } };
  globalThis.ChromeUtils = { importESModule: () => agentModule };
  try {
    const { Island } = await import("../browser/Island.sys.mjs");
    const documentElement = new Element();
    const win = {
      document: { documentElement, createElementNS: () => new Element() },
      windowUtils: { loadSheet() {}, removeSheet() {}, AUTHOR_SHEET: 1 },
      gBrowser: { tabContainer: new Element() },
      addEventListener() {},
      removeEventListener() {},
    };
    const browser = { ownerDocument: { defaultView: win }, currentURI: { host: "example.test" } };
    const sent = [];
    const island = new Island({ send: (...args) => sent.push(args) }, { setTimeout: () => 1, clearTimeout() {} });
    island.attach(win);
    const el = documentElement.children[0];
    const compose = el.querySelector(".compose");
    const general = compose.children[0];
    const sendButton = el.querySelector(".compose-footer").children[2];
    const rows = () => el.querySelector(".element-notes").children;
    const field = (index) => rows()[index].children[1];

    island.compose(browser, "3 selected elements", [], "", 3);
    assert.equal(rows().length, 3);
    assert.deepEqual(
      rows().map((row) => row.children[0].textContent),
      ["1", "2", "3"],
    );
    sendButton.listeners.get("click")();
    assert.equal(sent.length, 0, "an empty pick is not sent");
    field(1).value = "  Remove this  ";
    sendButton.listeners.get("click")();
    assert.deepEqual(sent.pop(), ["", "", ["", "Remove this", ""]]);
    assert.equal(field(0).disabled, true);

    island.compose(browser, "2 selected elements", [], "", 2);
    assert.equal(rows().length, 2);
    assert.equal(field(0).value, "");
    assert(!field(0).disabled);
    general.value = "Lighter";
    field(0).listeners.get("keydown")({ key: "Enter", shiftKey: false, preventDefault() {} });
    assert.deepEqual(sent.pop(), ["Lighter", "", ["", ""]]);

    island.compose(browser, "button Test", [], "");
    assert.equal(rows().length, 0, "a single pick keeps only today's field");
    general.value = "Change it";
    sendButton.listeners.get("click")();
    assert.deepEqual(sent.pop(), ["Change it", "", []]);
    island.destroy();
  } finally {
    globalThis.Services = originalServices;
    globalThis.ChromeUtils = originalChromeUtils;
  }
});
