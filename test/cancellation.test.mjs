import test from "node:test";
import { loadActor } from "./support/actor.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { setImmediate as nextTurn } from "node:timers/promises";
import { Cancellation } from "../browser/Cancellation.sys.mjs";
import { bridgeContext, testCall } from "./support/bridge.mjs";
const timers = { setTimeout, clearTimeout };

test("cancel clears outstanding timers and cannot be undone by starting new work", async () => {
  const handles = new Set();
  const clock = {
    setTimeout(fn) {
      handles.add(fn);
      return fn;
    },
    clearTimeout(fn) {
      handles.delete(fn);
    },
  };
  const old = new Cancellation();
  const waiting = old.wait(30000, clock);
  const rejected = assert.rejects(waiting, /stopped/);
  old.cancel(new Error("stopped"));
  await rejected;
  assert.equal(handles.size, 0);
  const fresh = new Cancellation();
  fresh.check();
  assert.throws(() => old.check(), /stopped/);
});

test("cancel wins even when a response resolved before its continuation runs", async () => {
  const scope = new Cancellation();
  const result = scope.race(Promise.resolve("old result"));
  scope.cancel(new Error("stopped"));
  await assert.rejects(result, /stopped/);
});

function actorHarness(actorTimers = timers) {
  const events = [];
  let firstEvent;
  const first = new Promise((resolve) => {
    firstEvent = resolve;
  });
  const emit = (value) => {
    events.push(value);
    firstEvent();
  };
  const Actor = loadActor(
    {
      Ci: {},
      Cc: {},
      Services: {
        locale: { appLocaleAsBCP47: "en" },
        scriptloader: {
          loadSubScript(_, eu) {
            eu.sendString = (text) => emit(["text", text]);
            eu.synthesizeKey = (key, options = {}) => emit(["key", key, options.type || "press", !!options.shiftKey]);
            eu.synthesizeMouseAtPoint = (x, y, event) => emit(["mouse", event.type, x, y]);
            eu.synthesizeWheelAtPoint = () => emit(["wheel"]);
          },
        },
      },
    },
    { timers: actorTimers },
  );
  const actor = new Actor();
  actor.contentWindow = { innerWidth: 100, innerHeight: 100, devicePixelRatio: 1 };
  const node = () => ({
    isConnected: true,
    style: { setProperty() {} },
    setAttribute() {},
    classList: { add() {}, remove() {} },
    append() {},
    attachShadow() {
      return node();
    },
  });
  actor.document = Object.assign(new EventTarget(), {
    activeElement: null,
    hidden: true,
    createElement: node,
    documentElement: node(),
    elementFromPoint: () => null,
    scrollingElement: { scrollLeft: 0, scrollTop: 0, scrollBy: () => emit(["fallback-scroll"]) },
  });
  return { actor, events, first };
}

test("wheel acknowledges a scroll position change before the fallback deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { actor, events, first } = actorHarness({ setTimeout, clearTimeout });
  let result;
  const pending = actor
    .receiveMessage({ name: "input", data: { requestId: 1, kind: "wheel", x: 10, y: 10, dy: 100 } })
    .then((reply) => (result = reply));
  await first;
  actor.document.dispatchEvent(new Event("scroll"));
  await nextTurn();
  assert.equal(result, undefined, "An event without a position change acknowledged the wheel");
  actor.document.scrollingElement.scrollTop = 100;
  actor.document.dispatchEvent(new Event("scroll"));
  await nextTurn();
  assert.equal(result?.value, "done");
  t.mock.timers.tick(150);
  await pending;
  assert.deepEqual(events, [["wheel"]]);
  actor.didDestroy();
});

test("wheel falls back within a bounded wait when native scrolling does not move", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { actor, events, first } = actorHarness({ setTimeout, clearTimeout });
  const pending = actor.receiveMessage({ name: "input", data: { requestId: 1, kind: "wheel", x: 10, y: 10, dy: 100 } });
  await first;
  t.mock.timers.tick(150);
  assert.equal((await pending).value, "done");
  assert.deepEqual(events, [["wheel"], ["fallback-scroll"]]);
  actor.didDestroy();
});

for (const kind of ["text", "keys"]) {
  test(`actor cancels ${kind} midway; fresh request works without resuming old input`, async () => {
    const { actor, events, first } = actorHarness();
    const data = {
      requestId: 1,
      kind,
      text: "x".repeat(500),
      keys: Array.from({ length: 500 }, () => ({ key: "a", mods: {} })),
    };
    const pending = actor.receiveMessage({ name: "input", data });
    await first;
    await actor.receiveMessage({ name: "cancel_operation", data: { requestId: 1 } });
    const result = await pending;
    assert.match(result.error, /cancelled/);
    const count = events.length;
    assert(count > 0 && count < 500);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(events.length, count);
    const next = await actor.receiveMessage({ name: "input", data: { requestId: 2, kind: "text", text: "OK" } });
    assert.equal(next.value, "done");
    assert.equal(
      events
        .slice(count)
        .map((e) => e[1])
        .join(""),
      "OK",
    );
  });
}

test("real parent batch and a call queued on its tab stay cancelled across immediate Stop/Resume", async () => {
  const replies = [];
  const effects = [];
  let started;
  const first = new Promise((resolve) => {
    started = resolve;
  });
  const context = bridgeContext({
    ...timers,
    state: { paused: false, tabs: new Map() },
    sessions: new Map([["test-session", {}]]),
    sessionInfo() {
      return {};
    },
    liveTabs: () => [],
    browserFor: (call, tabId) => call.tabs.add(tabId),
    cancelAsk() {},
    logActivity() {},
    findTab() {},
    paintTab() {},
    describeWrite() {},
    requirePermission() {},
    agentTheme: () => ({ id: "codex" }),
    text: (value) => [{ type: "text", text: value }],
    reply: (_, __, result) => replies.push(result),
    shortRefs: (x) => x,
    tools: {
      wait: async (_args, call) => {
        started();
        await call.wait(30000, timers);
        return [];
      },
      effect: async () => {
        effects.push("ran");
        return [];
      },
    },
  });
  const batch = context.handle(
    JSON.stringify({
      session: "test-session",
      tool: "browser_batch",
      args: {
        actions: [
          { name: "wait", input: { tabId: 1 } },
          { name: "effect", input: { tabId: 1 } },
        ],
      },
    }),
  );
  await first;
  const queued = context.handle(JSON.stringify({ session: "test-session", tool: "effect", args: { tabId: 1 } }));
  context.stopClaude();
  context.resumeClaude();
  await Promise.all([batch, queued]);
  assert.equal(effects.length, 0);
  assert.equal(replies[0].isError, true);
  assert.match(replies[0].content[0].text, /remaining 1 step/);
  assert.equal(replies[1].ok, false);
  assert.match(replies[1].error, /stopped/);
  await context.handle(JSON.stringify({ session: "test-session", tool: "effect" }));
  assert.equal(effects.length, 1);
  assert.equal(replies.at(-1).ok, true);
});

test("cancel navigation stops loading and removes its listener and timeout", async () => {
  const handles = new Set();
  let stopped = 0,
    removed = 0;
  const browser = {
    browserId: 1,
    addProgressListener() {},
    removeProgressListener() {
      removed++;
    },
    stop() {
      stopped++;
    },
  };
  globalThis.ChromeUtils = { generateQI() {} };
  globalThis.Ci = { nsIWebProgress: { NOTIFY_STATE_WINDOW: 1 }, nsIWebProgressListener: {} };
  const context = bridgeContext({
    setTimeout: (fn) => {
      handles.add(fn);
      return fn;
    },
    clearTimeout: (fn) => handles.delete(fn),
  });
  const scope = testCall(context, { tabs: [1] });
  const loaded = context.waitForLoad(browser);
  scope.cancel();
  await loaded;
  assert.equal(stopped, 1);
  assert.equal(removed, 1);
  assert.equal(handles.size, 0);
  assert.equal(context.pendingListeners.size, 0);
  delete globalThis.ChromeUtils;
  delete globalThis.Ci;
});

for (const kind of ["drag", "wheel", "click"]) {
  test(`actor cancellation cleans up ${kind} without subsequent input`, async () => {
    const { actor, events, first } = actorHarness();
    if (kind === "click") {
      actor.document.hidden = false;
      const hit = { isConnected: true, localName: "body", tagName: "BODY", classList: [] };
      actor.document.elementFromPoint = () => hit;
    }
    const pending = actor.receiveMessage({
      name: "input",
      data: {
        requestId: 7,
        kind,
        x: 10,
        y: 10,
        to: [80, 80],
        dx: 0,
        dy: 100,
      },
    });
    if (kind === "click") await new Promise((resolve) => setTimeout(resolve, 10));
    else await first;
    await actor.receiveMessage({ name: "cancel_operation", data: { requestId: 7 } });
    const result = await pending;
    assert.match(result.error, /cancelled/);
    if (kind === "drag") {
      assert.equal(events.filter((e) => e[1] === "mousedown").length, 1);
      assert.equal(events.filter((e) => e[1] === "mouseup").length, 1);
      assert.equal(events.filter((e) => e[1] === "mousemove").length, 1);
    } else if (kind === "wheel") assert.deepEqual(events, [["wheel"]]);
    else assert.deepEqual(events, []);
  });
}

test("parent modules load through the trusted resource scheme", () => {
  const source = fs.readFileSync(new URL("../browser/main.js", import.meta.url), "utf8");
  const loader = source.split("\n").find((line) => line.includes("const load = (name) =>"));
  assert(loader, "module loader missing");
  let loaded;
  vm.runInNewContext(loader + '\nload("Cancellation");', {
    dirURI: "file:///home/example/browser/",
    version: 12,
    ChromeUtils: {
      importESModule(uri) {
        assert(uri.startsWith("resource://"), "Firefox rejects untrusted module schemes");
        loaded = uri;
        return { Cancellation };
      },
    },
  });
  assert.equal(loaded, "resource://zenmcp/Cancellation.sys.mjs?v=12");
});

test("held keys survive completed requests and are released by actor destruction", async () => {
  const { actor, events } = actorHarness();
  const result = await actor.receiveMessage({
    name: "input",
    data: { requestId: 1, kind: "key_down", keys: [{ key: "KEY_Shift" }], session: "A" },
  });
  assert.deepEqual([...result.value.keys], ["KEY_Shift"]);
  await actor.receiveMessage({
    name: "input",
    data: { requestId: 2, kind: "keys", keys: [{ key: "a", mods: {} }], session: "A" },
  });
  assert(events.some((e) => e[1] === "A" && e[3]));
  actor.didDestroy();
  assert(events.some((e) => e[1] === "KEY_Shift" && e[2] === "keyup"));
});
test("held input rejects foreign sessions and the watchdog releases it", async () => {
  const { actor, events } = actorHarness();
  await actor.receiveMessage({
    name: "input",
    data: { requestId: 1, kind: "key_down", keys: [{ key: "KEY_Control" }], session: "A", hold_ms: 100 },
  });
  const foreign = await actor.receiveMessage({
    name: "input",
    data: { requestId: 2, kind: "keys", keys: [{ key: "a", mods: {} }], session: "B" },
  });
  assert.match(foreign.error, /another session/);
  await new Promise((r) => setTimeout(r, 130));
  assert(events.some((e) => e[1] === "KEY_Control" && e[2] === "keyup"));
  actor.didDestroy();
});
