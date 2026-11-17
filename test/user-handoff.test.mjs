import test from "node:test";
import assert from "node:assert/strict";
import { bridgeContext } from "./support/bridge.mjs";

// ask_user asks; hand_to_user leaves a step in a tab to the user and tells the agent to check.
function harness(answer) {
  const asks = [],
    queries = [];
  const browser = { browserId: 1, browsingContext: {} };
  const ctx = bridgeContext({
    browserFor: () => browser,
    frameOf: () => browser.browsingContext,
    notifyAsk: () => false,
    island: { ask: (...args) => asks.push(args), askEnded() {} },
    query: async (_, name, data) => {
      queries.push({ name, data });
      return { value: answer };
    },
    waitIslandAnswer: async () => answer,
    text: (value) => [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
  });
  const call = async (tool, args) => (await ctx.tools[tool](args))[0].text;
  return { call, asks, queries };
}

test("hand_to_user needs a tab, shows Done and tells the agent to check the page", async () => {
  const h = harness("done");
  await assert.rejects(h.call("hand_to_user", { message: "Log in" }), /needs the tabId/);
  const result = await h.call("hand_to_user", { tabId: 1, message: "Log in, then press Done" });
  assert.match(result, /says the step is done.*Check the page/);
  const [, , message, done, labels] = h.asks[0];
  assert.equal(message, "Log in, then press Done");
  assert.equal(done, true);
  assert.equal(labels.ok, "Done");
  assert.equal(h.queries[0].data.timeout, 600);
});

test("hand_to_user with wait click returns when the outlined element is clicked", async () => {
  const h = harness("clicked");
  assert.match(
    await h.call("hand_to_user", { tabId: 1, message: "Press Pay", ref: "ref_1", wait: "click" }),
    /clicked.*Check the page/,
  );
  assert.equal(h.asks[0][3], false);
});

test("ask_user is a question: no Done label, and an outline needs a tab", async () => {
  const h = harness("done");
  assert.equal(await h.call("ask_user", { tabId: 1, message: "Proceed?" }), "The user pressed OK.");
  assert.deepEqual(h.asks[0][4], {});
  await assert.rejects(h.call("ask_user", { message: "This one?", ref: "ref_1" }), /need a tabId/);
  const choice = harness({ status: "done", choice: "Blue" });
  assert.deepEqual(JSON.parse(await choice.call("ask_user", { message: "Which?", options: ["Red", "Blue"] })), {
    status: "done",
    choice: "Blue",
  });
});
