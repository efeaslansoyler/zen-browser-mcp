import test from "node:test";
import { loadActor } from "./support/actor.mjs";
import assert from "node:assert/strict";
import vm from "node:vm";
import { inputTools } from "../browser/InputTools.sys.mjs";
import { bridgeContext } from "./support/bridge.mjs";

// Execute the real actor with only the DOM/platform boundary substituted.
function harness() {
  const events = [],
    nodes = new Map();
  const rect = { left: 20, top: 20, right: 120, bottom: 60, width: 100, height: 40 };
  const node = (id, parentNode = null) => {
    const el = {
      id,
      nodeType: 1,
      localName: "button",
      tagName: "BUTTON",
      isConnected: true,
      parentNode,
      innerText: id,
      textContent: id,
      classList: [],
      rect: { ...rect },
      getAttribute: (key) => (key === "id" ? id : null),
      hasAttribute: () => false,
      checkVisibility: () => true,
      matches: () => false,
      getBoundingClientRect() {
        return this.rect;
      },
      querySelector: () => null,
      getRootNode: () => ({}),
      scrollIntoView() {
        this.scrolled = true;
      },
      closest: () => null,
    };
    nodes.set(id, el);
    return el;
  };
  const target = node("target"),
    blocker = node("modal");
  let hit = target,
    afterMove;
  const Actor = loadActor({
    Ci: {},
    Cc: {},
    Services: {
      locale: { appLocaleAsBCP47: "en" },
      scriptloader: {
        loadSubScript(_, eu) {
          eu.synthesizeMouseAtPoint = (x, y, event) => {
            events.push(event.type);
            if (event.type === "mousemove") afterMove?.();
          };
        },
      },
    },
  });
  const actor = new Actor();
  actor.contentWindow = {
    innerWidth: 800,
    innerHeight: 600,
    getComputedStyle: () => ({ paddingLeft: "0", paddingTop: "0" }),
  };
  actor.browsingContext = { id: 1 };
  actor.document = {
    activeElement: null,
    hidden: true,
    elementFromPoint: () => hit,
    body: { querySelectorAll: () => [...nodes.values()] },
    querySelectorAll: () => [...nodes.values()],
    getElementById: (id) => nodes.get(id),
    documentElement: { append() {} },
  };
  const send = (name, data = {}) => actor.receiveMessage({ name, data });
  const refFor = async (el) => {
    const result = await send("find", { query: el.id });
    assert(!result.error, result.error);
    const ref = result.value[0]?.line.match(/\[(ref_[^\]]+)\]/)?.[1];
    assert(ref, result.value);
    return ref;
  };
  const click = async (data = {}) => send("input", { kind: "click", x: 70, y: 40, silent: true, ...data });
  return {
    actor,
    target,
    blocker,
    events,
    node,
    send,
    refFor,
    click,
    hit: (el) => {
      hit = el;
    },
    afterMove: (fn) => {
      afterMove = fn;
    },
  };
}

test("ref click reports the covering element and sends no mouse event", async () => {
  const h = harness(),
    ref = await h.refFor(h.target);
  h.hit(h.blocker);
  const result = await h.click({ ref });
  assert.match(result.error, /Click blocked.*covered or moved.*button#modal \[ref_/);
  assert.deepEqual(h.events, []);
});

test("locate checks coverage only for clicks; hover and scroll-to can still locate", async () => {
  const h = harness(),
    ref = await h.refFor(h.target);
  h.hit(h.blocker);
  assert.match((await h.send("locate", { ref, forClick: true })).error, /Click blocked/);
  assert.equal((await h.send("locate", { ref })).x, 70);
});

test("a child icon inside the target is hit-testable", async () => {
  const h = harness(),
    ref = await h.refFor(h.target);
  h.hit(h.node("icon", h.target));
  assert.equal((await h.click({ ref, button: 2 })).value, "done");
  assert.deepEqual(h.events, ["mousemove", "mousedown", "mouseup"]);
});

test("shadow descendants and slotted descendants belong to the target", async () => {
  for (const slotted of [false, true]) {
    const h = harness(),
      ref = await h.refFor(h.target);
    const root = {
      parentNode: null,
      host: h.target,
      getRootNode() {
        return this;
      },
    };
    const icon = h.node("icon", slotted ? null : root);
    if (slotted) icon.assignedSlot = h.node("slot", root);
    h.target.shadowRoot = { elementFromPoint: () => icon };
    assert.equal((await h.click({ ref, button: 2 })).value, "done");
  }
});

test("an overlay opened by mousemove blocks mouse-down", async () => {
  const h = harness(),
    ref = await h.refFor(h.target);
  h.afterMove(() => h.hit(h.blocker));
  assert.match((await h.click({ ref })).error, /covered or moved/);
  assert.deepEqual(h.events, ["mousemove"]);
});

test("coordinate clicks detect target replacement during mousemove", async () => {
  const h = harness();
  h.afterMove(() => h.hit(h.blocker));
  assert.match((await h.click()).error, /Coordinate target.*covered or moved/);
  assert.deepEqual(h.events, ["mousemove"]);
});

test("coordinate clicks can deliberately click the currently visible overlay", async () => {
  const h = harness();
  h.hit(h.blocker);
  assert.equal((await h.click({ button: 2 })).value, "done");
  assert.deepEqual(h.events, ["mousemove", "mousedown", "mouseup"]);
});

test("detached, disabled, empty and off-viewport targets do not receive clicks", async () => {
  for (const kind of ["detached", "disabled", "empty", "offscreen", "nan"]) {
    const h = harness(),
      ref = await h.refFor(h.target);
    if (kind === "detached") h.target.isConnected = false;
    if (kind === "disabled") h.target.matches = () => true;
    if (kind === "empty") h.hit(null);
    const result = await h.click({ ref, ...(kind === "offscreen" ? { x: 900 } : kind === "nan" ? { x: NaN } : {}) });
    assert(result.error, kind);
    assert.deepEqual(h.events, [], kind);
  }
});

test("multi-click stops before hitting a new element exposed by the first click", async () => {
  const h = harness(),
    ref = await h.refFor(h.target);
  let calls = 0;
  h.target.matches = () => {
    if (++calls === 3) h.hit(h.blocker);
    return false;
  };
  assert.match((await h.click({ ref, count: 3 })).error, /covered or moved/);
  assert.deepEqual(h.events, ["mousemove", "mousedown", "mouseup"]);
});

test("large ref targets use the center of the visible viewport intersection", async () => {
  const h = harness(),
    ref = await h.refFor(h.target);
  h.target.rect = { left: -100, top: -100, right: 1500, bottom: 1200, width: 1600, height: 1300 };
  const result = await h.send("locate", { ref, forClick: true });
  assert.equal(result.x, 400);
  assert.equal(result.y, 300);
  assert.equal(h.target.scrolled, true);
});

test("iframe boundary hit test rejects a covering parent overlay", async () => {
  const h = harness();
  h.target.localName = "iframe";
  h.target.browsingContext = { id: 42 };
  assert.equal((await h.send("frame_hit", { bcId: 42, x: 70, y: 40 })).value, true);
  h.hit(h.blocker);
  assert.match((await h.send("frame_hit", { bcId: 42, x: 70, y: 40 })).error, /Target iframe.*covered/);
});

test("ref coordinates check every enclosing iframe; hover coordinates skip the click guard", async () => {
  const calls = [];
  const root = { id: 1 },
    middle = { id: 2, parent: root },
    leaf = { id: 3, parent: middle };
  const context = bridgeContext({
    query: async (_, name, data, timeout, frame) => {
      calls.push({ name, data, frame: frame.id });
      return name === "locate" ? { x: 10, y: 20 } : name === "frame_rect" ? { x: 100, y: 50 } : { value: true };
    },
    frameOf: () => leaf,
    longRef: (ref) => ref,
    toPagePoint: (_, xy) => xy,
  });
  const result = await context.target({}, { ref: "ref_1_f3", forClick: true });
  assert.deepEqual(Array.from(result), [210, 120]);
  assert.deepEqual(
    calls.filter((c) => c.name === "frame_hit").map((c) => [c.frame, c.data.bcId, c.data.x, c.data.y]),
    [
      [2, 3, 110, 70],
      [1, 2, 210, 120],
    ],
  );
  calls.length = 0;
  await context.target({}, { ref: "ref_1_f3" });
  assert(!calls.some((c) => c.name === "frame_hit"));
});

test("routing refuses a ref click if the deepest hit frame changes", async () => {
  const expected = {},
    actual = {};
  let sent = false;
  const context = bridgeContext({
    heldFrame: () => null,
    deepest: async () => ({ frame: actual, x: 1, y: 2 }),
    frameOf: () => expected,
    query: async () => {
      sent = true;
    },
  });
  await assert.rejects(
    context.input({}, { kind: "click", ref: "ref_1_f2", x: 50, y: 50 }),
    /iframe is covered or changed/,
  );
  assert.equal(sent, false);
});

test("all four computer click actions request hit testing and forward the expected ref", async () => {
  const calls = [];
  const context = vm.createContext({
    heldFrame: () => null,
    releaseInputs() {},
    rememberInputs() {},
    browserFor: () => ({}),
    operationSleep: async () => {},
    text: (value) => value,
    target: async (_, args) => {
      assert.equal(args.forClick, true);
      return [10, 20];
    },
    click: async (_, point, options) => {
      calls.push(options);
    },
  });
  const tools = inputTools(context);
  for (const action of ["left_click", "right_click", "double_click", "triple_click"]) {
    await tools.computer({ action, ref: "ref_1", text: "ctrl", tabId: 1 });
  }
  assert(calls.every((options) => options.ref === "ref_1" && options.modifiers === "ctrl"));
  assert.equal(calls[1].button, 2);
  assert.equal(calls[2].count, 2);
  assert.equal(calls[3].count, 3);
});

test("scaled screenshot coordinates round-trip with size caps rather than the requested scale", async () => {
  const state = { scale: new Map() };
  const canvas = { getContext: () => ({ drawImage() {} }), toDataURL: () => "data:image/jpeg;base64,fixture" };
  const browser = {
    browserId: 7,
    ownerDocument: { createElementNS: () => canvas },
    browsingContext: {
      currentWindowGlobal: {
        drawSnapshot: async () => ({ width: 2400, height: 1600, close() {} }),
        getActor: () => ({ sendAsyncMessage() {} }),
      },
    },
  };
  const context = bridgeContext({ assertSiteAccess() {}, state, query: async () => {} });
  await context.screenshot(browser, 0.5);
  const scale = state.scale.get(7);
  assert(scale > 0 && scale < 0.5, "Large viewport should trigger the additional screenshot cap");
  const point = context.toPagePoint(browser, [100 * scale, 80 * scale]);
  assert(Math.abs(point[0] - 100) < 1e-9);
  assert(Math.abs(point[1] - 80) < 1e-9);
  assert(
    context.toPagePoint(browser, [100 * 0.5, 80 * 0.5])[0] > 100,
    "The old fixture assumption targeted the wrong point",
  );
});
