import test from "node:test";
import assert from "node:assert/strict";
import { Locks } from "../browser/Locks.sys.mjs";
import { bridgeContext, testCall } from "./support/bridge.mjs";

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("locks: one holder per key in arrival order, other keys run alongside", async () => {
  const locks = new Locks();
  const order = [];
  const first = locks.acquire(["a"]);
  const second = locks.acquire(["a"]);
  const other = locks.acquire(["b"]);
  second.ready.then(() => order.push("second"));
  other.ready.then(() => order.push("other"));
  await first.ready;
  await tick();
  assert.deepEqual(order, ["other"]);
  first.release();
  await tick();
  assert.deepEqual(order, ["other", "second"]);
  second.release();
  other.release();
  await tick();
  assert.equal(locks.busy("a"), false);
  assert.equal(locks.busy("b"), false);
});

test("locks: a waiter that gives up doesn't block the ones behind it", async () => {
  const locks = new Locks();
  const holder = locks.acquire(["a"]);
  const quitter = locks.acquire(["a"]);
  const next = locks.acquire(["a"]);
  let done = false;
  next.ready.then(() => (done = true));
  quitter.release();
  holder.release();
  await tick();
  await tick();
  assert.equal(done, true);
});

test("locks: requests over several keys can't wait for each other", async () => {
  const locks = new Locks();
  const ab = locks.acquire(["a", "b"]);
  const ba = locks.acquire(["b", "a"]);
  await ab.ready;
  ab.release();
  await ba.ready; // why: The reversed key order would deadlock if the two requests queued independently.
  ba.release();
});

// why: Gate fake tools on test-controlled promises to exercise the real dispatcher's queue.
function harness() {
  const replies = [];
  const running = new Map();
  const started = [];
  const context = bridgeContext({
    browserFor: (call, tabId) => call.tabs.add(tabId),
    logActivity() {},
    findTab() {},
    describeWrite() {},
    requirePermission() {},
    text: (value) => [{ type: "text", text: value }],
    reply: (_, __, result) => replies.push(result),
    tools: {
      work: (args) =>
        new Promise((resolve) => {
          started.push(args.name);
          running.set(args.name, () => resolve([{ type: "text", text: args.name }]));
        }),
    },
  });
  const request = (session, args) =>
    context.handle(JSON.stringify({ session, agent: { id: session }, tool: "work", args }), null, {});
  const finish = async (name) => {
    running.get(name)();
    await tick();
    await tick();
  };
  return { context, request, finish, started, replies };
}

test("calls on different tabs run side by side; calls on one tab wait their turn", async () => {
  const h = harness();
  const calls = [
    h.request("claude", { tabId: 1, name: "claude-1" }),
    h.request("codex", { tabId: 2, name: "codex-2" }),
    h.request("codex", { tabId: 1, name: "codex-1" }),
    h.request("claude", { name: "no-tab" }),
  ];
  await tick();
  await tick();
  assert.deepEqual([...h.started].sort(), ["claude-1", "codex-2", "no-tab"]);
  await h.finish("claude-1");
  assert.equal(h.started.at(-1), "codex-1");
  for (const name of ["codex-2", "codex-1", "no-tab"]) await h.finish(name);
  await Promise.all(calls);
  assert.equal(h.replies.length, 4);
  assert(h.replies.every((reply) => reply.ok));
  assert.equal(h.context.calls.size, 0);
});

test("a batch holds every tab it names until it ends", async () => {
  const h = harness();
  const batch = h.context.handle(
    JSON.stringify({
      session: "claude",
      tool: "browser_batch",
      args: {
        actions: [
          { name: "work", input: { tabId: 1, name: "batch-1" } },
          { name: "work", input: { tabId: 2, name: "batch-2" } },
        ],
      },
    }),
    null,
    {},
  );
  const other = h.request("codex", { tabId: 2, name: "codex-2" });
  await tick();
  await tick();
  assert.deepEqual(h.started, ["batch-1"]);
  await h.finish("batch-1");
  assert.deepEqual(h.started, ["batch-1", "batch-2"]);
  await h.finish("batch-2");
  assert.deepEqual(h.started, ["batch-1", "batch-2", "codex-2"]);
  await h.finish("codex-2");
  await Promise.all([batch, other]);
});

test("questions don't wait for each other: each is a card with the agent that asks it", async () => {
  const cards = new Map();
  let next = 1;
  const context = bridgeContext({
    notifyAsk: () => false,
    cancelAsk() {},
    island: {
      ask: (_browser, _title, message, _done, _labels, _options, { key, agent }) => {
        cards.set(next, [message, agent.name, key]);
        return next++;
      },
      askEnded: (id) => cards.delete(id),
      setAgent() {},
    },
  });
  const call = (id) => testCall(context, { session: id, agent: { id } });
  const a = { browserId: 1 };
  const first = context.askIsland(call("claude"), a, "", "Claude asks", {});
  const second = context.askIsland(call("codex"), null, "", "Codex asks without a tab", {});
  const third = context.askIsland(call("opencode"), null, "", "OpenCode asks without a tab", {});
  await tick();
  assert.deepEqual(
    [...cards.values()].map(([message, agent]) => [message, agent]),
    [
      ["Claude asks", "Claude"],
      ["Codex asks without a tab", "Codex"],
      ["OpenCode asks without a tab", "OpenCode"],
    ],
  );
  // why: Give tab-less questions independent keys so their answers cannot cross.
  const [, , keySecond] = cards.get(2);
  const [, , keyThird] = cards.get(3);
  assert.notEqual(keySecond, keyThird);
  context.answerIsland(keyThird, "done");
  assert.equal(await third, "done");
  context.answerIsland(keySecond, "cancelled");
  assert.equal(await second, "cancelled");
  context.answerIsland(a, "done");
  assert.equal(await first, "done");
  assert.equal(cards.size, 0);
});

test("clipboard, browser settings and extensions take the exclusive lock until the call ends", async () => {
  const context = bridgeContext({});
  const first = { tabs: new Set(), check() {}, race: (p) => p };
  const second = { tabs: new Set(), check() {}, race: (p) => p };
  await context.exclusive(first);
  await context.exclusive(first);
  let entered = false;
  const waiting = context.exclusive(second).then(() => (entered = true));
  await tick();
  assert.equal(entered, false);
  first.exclusive.release();
  await waiting;
  second.exclusive.release();
});
