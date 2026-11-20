import test from "node:test";
import assert from "node:assert/strict";
import { bridgeContext, testCall } from "./support/bridge.mjs";

function harness(answer) {
  const asks = [],
    queries = [];
  const browser = { browserId: 1, browsingContext: {} };
  const ctx = bridgeContext({
    browserFor: () => browser,
    frameOf: () => browser.browsingContext,
    notifyAsk: () => false,
    island: { ask: (...args) => asks.push(args), askEnded() {}, setAgent() {} },
    query: async (_, name, data) => {
      queries.push({ name, data });
      return { value: answer };
    },
    waitIslandAnswer: async () => answer,
    text: (value) => [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
  });
  const call = async (tool, args) => (await ctx.tools[tool](args, testCall(ctx)))[0].text;
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

test("a hand-over survives the pages the user goes through and ends on the island's Done", async () => {
  const browser = { browserId: 1, browsingContext: {} };
  const cancelled = [];
  let outlineEnded;
  const ctx = bridgeContext({
    browserFor: () => browser,
    frameOf: () => browser.browsingContext,
    notifyAsk: () => false,
    island: { ask() {}, askEnded() {}, setAgent() {} },
    guard: (promise) => promise,
    cancelAsk: (_, result) => cancelled.push(result),
    // why: Replace the outlined document to exercise hand-over across navigation.
    query: () =>
      new Promise((_, reject) => {
        outlineEnded = () => reject(new ctx.PageGone("The page changed."));
      }),
    text: (value) => [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
  });
  const pending = ctx.tools.hand_to_user({ tabId: 1, message: "Log in, then press Done" }, testCall(ctx));
  await new Promise((resolve) => setImmediate(resolve));
  outlineEnded();
  await new Promise((resolve) => setImmediate(resolve));
  ctx.answerIsland(browser, "done");
  assert.match((await pending)[0].text, /says the step is done/);
  assert.deepEqual(cancelled, ["done"], "the outline is removed if its page is still there");
  assert.equal(ctx.tabRequests.size, 0);
});

test("a query notices its page going into bfcache, where its own context stays unchanged", async () => {
  const wg = { getActor: () => ({ sendQuery: () => new Promise(() => {}), sendAsyncMessage() {} }) };
  const frame = { currentWindowGlobal: wg, top: { isInBFCache: false } };
  const browser = {
    browserId: 1,
    browsingContext: frame,
    ownerDocument: {
      defaultView: {
        gBrowser: {
          getTabDialogBox() {
            throw new Error("no dialogs");
          },
        },
      },
    },
  };
  frame.top = frame;
  frame.isInBFCache = false;
  const ctx = bridgeContext({ assertSiteAccess() {}, guard: (promise) => promise });
  ctx.access.join(1, "A");
  testCall(ctx, { session: "A", tabs: [1] });
  const pending = ctx.query(browser, "ask_user", {}, 30000, frame);
  frame.isInBFCache = true;
  await assert.rejects(pending, (e) => e instanceof ctx.PageGone);
});
