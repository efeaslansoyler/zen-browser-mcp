import test from "node:test";
import { loadActor } from "./support/actor.mjs";
import assert from "node:assert/strict";
import * as themes from "../browser/Agent.sys.mjs";
import { Picks } from "../browser/Picks.sys.mjs";
import { Inbox, sendTargets, sentNotice } from "../browser/Inbox.sys.mjs";

function harness() {
  class Node {
    children = [];
    attrs = new Map();
    isConnected = true;
    nodeType = 1;
    classList = [];
    style = { setProperty() {} };
    offsetWidth = 80;
    constructor(name = "div", id = "") {
      this.localName = name;
      this.tagName = name.toUpperCase();
      this.id = id;
      this.textContent = this.innerText = id;
      this.outerHTML = `<${name} id="${id}">${id}</${name}>`;
    }
    append(...nodes) {
      for (const child of nodes) {
        child.parentElement = this;
        this.children.push(child);
      }
    }
    attachShadow() {
      return (this.shadow = new Node());
    }
    setAttribute(key, value) {
      this.attrs.set(key, value);
    }
    getAttribute(key) {
      return this.attrs.get(key) || "";
    }
    hasAttribute(key) {
      return this.attrs.has(key);
    }
    getBoundingClientRect() {
      return { left: 20, top: 40, width: 100, height: 30 };
    }
    remove() {
      this.isConnected = false;
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((n) => n !== this);
    }
  }
  const listeners = new Map();
  let nextFrame;
  const document = {
    URL: "https://fixture.test",
    title: "Fixture",
    createElement: (name) => new Node(name),
    documentElement: new Node("html"),
    querySelectorAll: () => [],
    elementFromPoint: () => hit,
  };
  const nodes = Array.from({ length: 10 }, (_, i) => new Node("button", `element-${i}`));
  document.querySelectorAll = (selector) => nodes.filter((node) => selector === `#${node.id}`);
  for (const node of nodes) node.ownerDocument = document;
  let hit = nodes[0];
  const window = {
    innerWidth: 800,
    innerHeight: 600,
    scrollX: 0,
    scrollY: 0,
    devicePixelRatio: 1,
    CSS: { escape: (value) => value },
    getComputedStyle: () => ({
      display: "block",
      position: "static",
      fontWeight: "400",
      fontSize: "14px",
      lineHeight: "20px",
      fontFamily: "sans-serif",
      backgroundColor: "rgba(0, 0, 0, 0)",
      backgroundImage: "none",
      opacity: "1",
      boxShadow: "none",
    }),
    requestAnimationFrame: (callback) => {
      nextFrame = callback;
      return 1;
    },
    cancelAnimationFrame() {
      nextFrame = null;
    },
    addEventListener(type, callback) {
      listeners.set(type, callback);
    },
    removeEventListener(type, callback) {
      if (listeners.get(type) === callback) listeners.delete(type);
    },
  };
  const Actor = loadActor({
    Services: { locale: { appLocaleAsBCP47: "en" } },
    Cu: { waiveXrays: (value) => value },
  });
  const actor = new Actor();
  actor.document = document;
  actor.contentWindow = window;
  const send = (name, data = {}) => actor.receiveMessage({ name, data });
  const emit = (type, args = {}) => {
    const event = {
      type,
      isTrusted: true,
      preventDefault() {
        this.prevented = true;
      },
      stopImmediatePropagation() {
        this.stopped = true;
      },
      ...args,
    };
    listeners.get(type)?.(event);
    return event;
  };
  const hover = (index) => {
    hit = nodes[index];
    emit("mousemove", { clientX: 30, clientY: 45 });
  };
  const click = (index, shiftKey = false) => {
    hover(index);
    return emit("click", { button: 0, shiftKey });
  };
  return { actor, nodes, document, listeners, send, emit, hover, click, frame: () => nextFrame?.() };
}

test("single click stays compatible; picker consumes page events and removes listeners", async () => {
  const h = harness(),
    pending = h.send("pick_start");
  const event = h.click(0);
  const result = await pending;
  assert.equal(result.selector, "#element-0");
  assert.equal(result.items, undefined);
  assert(event.prevented && event.stopped);
  assert.equal(h.listeners.size, 0);
  await h.send("pick_end");
  assert.equal(h.document.documentElement.children.length, 0);
});

test("Shift-click collects distinct nodes, toggles them off, and Enter preserves order", async () => {
  const h = harness(),
    pending = h.send("pick_start");
  h.click(0, true);
  h.click(1, true);
  h.click(0, true);
  h.click(2, true);
  h.hover(3);
  h.emit("keydown", { key: "Enter" });
  const result = await pending;
  assert.deepEqual(
    Array.from(result.items, (item) => item.selector),
    ["#element-1", "#element-2"],
  );
  assert.equal(h.listeners.size, 0);
});

test("Backspace removes the last item; normal click completes without duplicate items", async () => {
  const h = harness(),
    pending = h.send("pick_start");
  h.click(0, true);
  h.click(1, true);
  h.emit("keydown", { key: "Backspace" });
  h.click(0);
  assert.equal((await pending).selector, "#element-0");
});

test("selection is bounded at eight items", async () => {
  const h = harness(),
    pending = h.send("pick_start");
  for (let i = 0; i < 10; i++) h.click(i, true);
  h.emit("keydown", { key: "Enter" });
  const result = await pending;
  assert.equal(result.items.length, 8);
  assert.equal(result.items[7].selector, "#element-7");
});

test("untrusted events do not add elements or finalize a selection", async () => {
  const h = harness(),
    pending = h.send("pick_start");
  h.hover(0);
  h.emit("click", { isTrusted: false, button: 0 });
  assert(h.listeners.has("click"));
  h.click(1, true);
  h.emit("keydown", { key: "Enter", isTrusted: false });
  assert(h.listeners.has("click"));
  h.emit("keydown", { key: "Enter" });
  assert.equal((await pending).selector, "#element-1");
});

test("Escape, explicit pick_end and actor destruction discard all pending selections", async () => {
  for (const end of ["Escape", "pick_end", "destroy"]) {
    const h = harness(),
      pending = h.send("pick_start");
    h.click(0, true);
    h.click(1, true);
    if (end === "Escape") h.emit("keydown", { key: "Escape" });
    else if (end === "destroy") h.actor.didDestroy();
    else await h.send("pick_end");
    assert.equal((await pending).cancelled, true);
    assert.equal(h.listeners.size, 0);
    assert.equal(h.document.documentElement.children.length, 0);
  }
});

test("a disappeared selected node cannot silently become a smaller selection", async () => {
  const h = harness(),
    pending = h.send("pick_start");
  h.click(0, true);
  h.click(1, true);
  h.nodes[0].isConnected = false;
  h.emit("keydown", { key: "Enter" });
  assert.match((await pending).error, /disappeared/);
  assert.equal(h.document.documentElement.children.length, 0);
});

// Picks with inert defaults; tests override what they exercise.
function picks(env = {}) {
  const channels = env.channels ?? { subscribers: new Map(), target: () => null, deliver: async () => false };
  return new Picks({
    L: (en) => en,
    theme: themes.agentTheme,
    hasAccess: (_tabId, session) => session === "owner-A",
    pickedTabs: new Set(),
    channels,
    // the real inbox: a session's subscriber pushes; nothing waits in these tests
    inbox: new Inbox({
      endpoint: (session) => channels.subscribers.get(session) ?? null,
      deliver: (sub, event) => channels.deliver(sub, event),
      known: (session) => channels.subscribers.has(session),
      expired() {},
      now: () => 0,
    }),
    targets: () =>
      sendTargets(
        [],
        [...channels.subscribers].map(([id, sub]) => ({ id, ack: true, push: "codex", ...sub })),
        (en) => en,
      ),
    sentNotice: (status, target) => sentNotice(status, target, (en) => en),
    island: null,
    assertSiteAccess() {},
    logError() {},
    copy() {},
    ...env,
  });
}
function messageHarness() {
  const context = picks();
  const info = (index) => ({
    title: "Fixture",
    url: "https://fixture.test",
    selector: `#item-${index}`,
    role: "button",
    name: `Button ${index}`,
    rect: { x: 1, y: 2, width: 30, height: 40 },
    viewport: { width: 800, height: 600 },
    styles: {},
    text: `Text ${index}`,
    html: `<button>${index}</button>`,
  });
  const current = {
    browser: { browserId: 42 },
    info: info(1),
    shot: "/tmp/one.png",
    items: [
      { info: info(1), shot: "/tmp/one.png" },
      { info: info(2), shot: "/tmp/two.png" },
    ],
  };
  return { context, current };
}

test("one shared note contains numbered independent element contexts and screenshot metadata", () => {
  const { context, current } = messageHarness();
  const result = context.message(current, "Align these controls", "owner-A");
  assert.equal(result.content.match(/Align these controls/g).length, 1);
  assert.match(result.content, /Selected elements: 2/);
  assert.match(result.content, /Selected element 1[\s\S]*#item-1[\s\S]*Selected element 2[\s\S]*#item-2/);
  assert.equal(result.meta.element_count, "2");
  assert.deepEqual(JSON.parse(result.meta.screenshots), ["/tmp/one.png", "/tmp/two.png"]);
  assert.equal(result.meta.tab_id, "42");
  const foreign = context.message(current, "Align these controls", "another-session");
  assert.equal(foreign.meta.source_tab, "42");
  assert.equal(foreign.meta.tab_id, undefined);
});

test("normal click at the selection limit does not silently omit the clicked ninth item", async () => {
  const h = harness(),
    pending = h.send("pick_start");
  for (let i = 0; i < 8; i++) h.click(i, true);
  h.click(8);
  assert(h.listeners.has("click"));
  h.emit("keydown", { key: "Escape" });
  assert.equal((await pending).cancelled, true);
});

test("compose captures one screenshot per item and keeps the selected destination pinned", async () => {
  const document = {},
    browser = { browsingContext: { currentWindowGlobal: document } };
  const current = { browser, document, targetId: "chosen" };
  const composed = [];
  const context = picks({
    channels: {
      subscribers: new Map([
        ["chosen", { id: "chosen", name: "Destination", agent: themes.agentTheme({ id: "codex" }) }],
      ]),
    },
    island: { compose: (...args) => composed.push(args) },
  });
  context.current = current;
  context.shot = async (_, info) => `/tmp/${info.selector}.png`;
  await context.compose(current, { items: [{ selector: "one" }, { selector: "two" }] });
  assert.equal(current.items.length, 2);
  assert.equal(current.items[1].shot, "/tmp/two.png");
  assert.equal(current.targetId, "chosen");
  assert.equal(composed[0][3], "chosen");
  assert.equal(current.preparing, false);
  browser.browsingContext.currentWindowGlobal = {};
  await assert.rejects(context.compose(current, { selector: "stale" }), /page changed/);
});

test("send guards navigation and preparation; successful delivery waits for receipt and is single-shot", async () => {
  const document = {},
    current = { info: {}, document, browser: { browserId: 4, browsingContext: { currentWindowGlobal: document } } };
  const deliveries = [],
    notifications = [],
    clipboard = [];
  let receipt;
  const acknowledged = new Promise((resolve) => {
    receipt = resolve;
  });
  const context = picks({
    channels: {
      subscribers: new Map([["chosen", { name: "Chosen session", agent: { id: "codex" } }]]),
      deliver: async (target, event) => {
        deliveries.push({ target, event });
        return acknowledged;
      },
    },
    island: { sent: (message) => notifications.push(message) },
    copy: (value) => clipboard.push(value),
  });
  context.current = current;
  context.message = () => ({ content: "two contexts and one note", meta: { element_count: "2" } });
  context.end = () => {
    context.current = null;
  };
  current.preparing = true;
  await context.send("note", "chosen");
  assert.equal(deliveries.length, 0);
  current.preparing = false;
  const sending = context.send("note", "chosen");
  await context.send("other note", "chosen");
  assert.equal(deliveries.length, 1);
  assert.equal(notifications.length, 0);
  receipt(true);
  await sending;
  assert.match(notifications[0], /Queued for Chosen session/);
  assert.deepEqual(clipboard, []);
  current.sending = false;
  context.current = current;
  current.browser.browsingContext.currentWindowGlobal = {};
  await assert.rejects(context.send("stale note", "chosen"), /page changed/);
  assert.equal(deliveries.length, 1);
});

test("all selected outline boxes follow geometry on animation frames and remain frozen at compose", async () => {
  const h = harness(),
    pending = h.send("pick_start");
  h.click(0, true);
  h.click(1, true);
  h.frame();
  const root = h.document.documentElement.children[0].shadow;
  let boxes = root.children.filter((node) => node.className === "box picked");
  assert.equal(boxes.length, 2);
  assert(boxes.every((box) => box.style.left === "20px" && box.style.width === "100px"));
  h.nodes[1].getBoundingClientRect = () => ({ left: 50, top: 60, width: 80, height: 25 });
  h.emit("keydown", { key: "Enter" });
  await pending;
  h.frame();
  boxes = root.children.filter((node) => node.className === "box picked");
  assert.equal(boxes[1].style.left, "50px");
  assert.equal(root.children.find((node) => node.className === "box").hidden, true);
  await h.send("pick_end");
  assert.equal(h.document.documentElement.children.length, 0);
});

test("per-element notes lead their element's section; the general note leads the message", () => {
  const { context, current } = messageHarness();
  const both = context.message(current, "Make the pricing lighter", "owner-A", ["Bigger", ""]).content;
  assert(both.startsWith("Make the pricing lighter\n"));
  assert.match(both, /--- Selected element 1 ---\nUser note for element 1: Bigger\nPage: /);
  assert.match(both, /--- Selected element 2 ---\nPage: /);
  assert.doesNotMatch(both, /User note for element 2/);

  const onlyElements = context.message(current, "", "owner-A", ["", " Remove it "]).content;
  assert(onlyElements.startsWith("Selected elements: 2"));
  assert.match(onlyElements, /--- Selected element 2 ---\nUser note for element 2: Remove it\nPage: [\s\S]*#item-2/);
  assert.doesNotMatch(onlyElements, /User note for element 1/);

  const generalOnly = context.message(current, "Align these controls", "owner-A", ["", ""]);
  assert.deepEqual(generalOnly, context.message(current, "Align these controls", "owner-A"));
  assert.doesNotMatch(generalOnly.content, /User note for/);
});

test("send carries per-element notes to delivery and the clipboard alike", async () => {
  const { context, current } = messageHarness();
  const document = {};
  Object.assign(current.browser, { browsingContext: { currentWindowGlobal: document } });
  current.document = document;
  const clipboard = [];
  context.env.copy = (text) => clipboard.push(text);
  context.current = current;
  await context.send("", "", ["Bigger", ""]);
  assert.match(clipboard[0], /^Selected elements: 2[\s\S]*User note for element 1: Bigger\nPage: /);
});
