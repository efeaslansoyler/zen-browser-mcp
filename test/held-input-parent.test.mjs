import test from "node:test";
import assert from "node:assert/strict";
import { bridgeContext, testCall } from "./support/bridge.mjs";

function fixture() {
  const sent = [],
    timers = new Set();
  const old = { getActor: () => ({ sendAsyncMessage: (name) => sent.push(name) }) };
  const frame = { currentWindowGlobal: old };
  const browser = { browserId: 1 };
  const c = bridgeContext({
    setTimeout(fn) {
      timers.add(fn);
      return fn;
    },
    clearTimeout(fn) {
      timers.delete(fn);
    },
  });
  const call = testCall(c, { session: "A", tabs: [1] });
  c.rememberInputs(browser, frame, { keys: ["KEY_Shift"], buttons: [] }, 30000);
  return { c, call, browser, frame, sent, timers };
}

test("parent releases all remembered actors and clears watchdogs", () => {
  const h = fixture();
  h.c.releaseAllInputs();
  assert.deepEqual(h.sent, ["release_inputs"]);
  assert.equal(h.timers.size, 0);
  assert.equal(h.c.heldFrame(h.browser), null);
});

test("document replacement and session changes cannot inherit held input", () => {
  for (const change of [
    (h) => {
      h.frame.currentWindowGlobal = {};
    },
    (h) => {
      h.call.session = "B";
    },
  ]) {
    const h = fixture();
    change(h);
    assert.equal(h.c.heldFrame(h.browser), null);
    assert.deepEqual(h.sent, ["release_inputs"]);
    assert.equal(h.timers.size, 0);
  }
});
