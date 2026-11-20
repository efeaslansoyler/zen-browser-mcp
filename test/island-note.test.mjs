import test from "node:test";
import assert from "node:assert/strict";
import { bridgeContext } from "./support/bridge.mjs";

test("shared island permission rejects with denial notes, records approval notes and always cleans up", async () => {
  let answer,
    ended = 0;
  const call = { userNotes: [], agent: { name: "Claude" } };
  const context = bridgeContext({
    guard: (promise) => promise,
    notifyAsk: () => false,
    island: {
      ask: () => {
        answer();
        return 1;
      },
      askEnded: () => ended++,
      setAgent() {},
    },
    cancelAsk() {},
  });
  const browser = {};
  answer = () => context.answerIsland(browser, "cancelled", "Use a different tab");
  await assert.rejects(context.askIsland(call, browser, "", "", {}, 1), /User message .*"Use a different tab"/);
  answer = () => context.answerIsland(browser, "cancelled");
  assert.equal(await context.askIsland(call, browser, "", "", {}, 1), "cancelled");
  answer = () => context.answerIsland(browser, "done", " Only the title ");
  assert.equal(await context.askIsland(call, browser, "", "", {}, 1), "done");
  assert.deepEqual(call.userNotes, ["Only the title"]);
  assert.equal(ended, 3);
});

test("tab-less ask_user answers carry the choice and end on answer, replacement and timeout", async () => {
  const context = bridgeContext({
    guard: (promise) => promise,
    notifyAsk: () => false,
    island: { ask() {}, askEnded() {} },
    cancelAsk() {
      throw new Error("no page to cancel");
    },
  });

  let pending = context.waitIslandAnswer(null, 5);
  context.answerIsland(null, "done", " bigger ", "Blue");
  assert.deepEqual({ ...(await pending) }, { status: "done", choice: "Blue", message: "bigger" });

  pending = context.waitIslandAnswer(null, 5);
  context.answerIsland(null, "cancelled");
  assert.equal(await pending, "cancelled");

  const first = context.waitIslandAnswer(null, 5);
  const second = context.waitIslandAnswer(null, 5);
  assert.equal(await first, "replaced");
  context.answerIsland(null, "done", "", "A");
  assert.deepEqual({ ...(await second) }, { status: "done", choice: "A" });

  assert.equal(await context.waitIslandAnswer(null, 0.01), "timeout");
});
