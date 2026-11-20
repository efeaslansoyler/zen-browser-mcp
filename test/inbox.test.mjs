import test from "node:test";
import assert from "node:assert/strict";
import { Inbox, inboxText, sendTargets, sentNotice } from "../browser/Inbox.sys.mjs";

function inbox({ endpoints = {}, live = ["a", "b"] } = {}) {
  const pushed = [];
  const expired = [];
  const box = new Inbox({
    endpoint: (session) => endpoints[session] ?? null,
    deliver: async (sub, event) => {
      pushed.push([sub.id, event]);
      return sub.ok;
    },
    known: (session) => live.includes(session),
    expired: (session, items) => expired.push([session, items.map((i) => i.content)]),
    now: () => 1,
  });
  return { box, pushed, expired };
}

test("a session that can push gets the item at once; nothing waits", async () => {
  const { box, pushed } = inbox({ endpoints: { a: { id: "a", ok: true } } });
  assert.equal(await box.send("a", { kind: "pick", content: "fix the button", meta: { url: "u" } }), "sent");
  assert.deepEqual(pushed, [["a", { event: "channel", content: "fix the button", meta: { url: "u" }, note: "" }]]);
  assert.equal(box.waiting("a"), 0);
});

test("without a push path (or when it fails) the item waits for the next tool result, once", async () => {
  const { box } = inbox({ endpoints: { b: { id: "b", ok: false } } });
  assert.equal(await box.send("a", { kind: "pick", content: "one" }), "waiting");
  assert.equal(await box.send("a", { kind: "recipe", content: "two", meta: { recipe: "r" } }), "waiting");
  assert.equal(await box.send("b", { kind: "pick", content: "three" }), "waiting");
  const items = box.take("a");
  assert.deepEqual(
    items.map((i) => i.content),
    ["one", "two"],
  );
  assert.deepEqual(box.take("a"), []);
  const text = inboxText(items);
  assert.match(text, /^The user sent you these 2 messages from the browser/);
  assert.match(text, /--- 2 ---\ntwo\nBrowser metadata: \{"recipe":"r"\}/);
  assert.equal(inboxText([]), "");
});

test("an unknown session gets nothing; a session that ends hands its items to the clipboard", async () => {
  const { box, expired } = inbox();
  assert.equal(await box.send("gone", { kind: "pick", content: "x" }), "missing");
  await box.send("a", { kind: "pick", content: "late" });
  box.end("a");
  assert.deepEqual(expired, [["a", ["late"]]]);
  box.end("a");
  assert.equal(expired.length, 1);
});

test("the send list is every connected session, labelled with how it receives", () => {
  const L = (en) => en;
  const live = [
    { id: "old", name: "Old process", agent: { id: "claude" } },
    { id: "t3", name: "T3 thread", agent: { id: "claude" } },
  ];
  const subs = [
    { id: "t3", name: "T3 thread", agent: { id: "claude" }, ack: true, push: "t3" },
    { id: "term", name: "Terminal", agent: { id: "claude" }, ack: true, push: null, hook: true },
    { id: "codex:1", name: "Codex chat", agent: { id: "codex" }, ack: true, push: "codex" },
    { id: "oc", name: "OpenCode", agent: { id: "generic" }, ack: true, push: "opencode", hook: true },
  ];
  const targets = sendTargets(live, subs, L);
  assert.deepEqual(
    targets.map((t) => [t.id, t.how, t.label]),
    [
      ["old", "next", "Old process · on its next action"],
      ["t3", "now", "T3 thread · now"],
      ["term", "prompt", "Terminal · when you write"],
      ["codex:1", "now", "Codex chat · now"],
      ["oc", "now", "OpenCode · now"],
    ],
  );
  const by = Object.fromEntries(targets.map((t) => [t.id, t]));
  assert.equal(sentNotice("sent", by.t3, L), "Sent to T3 thread ✓");
  assert.equal(sentNotice("sent", by["codex:1"], L), "Queued for Codex chat ✓");
  assert.equal(sentNotice("waiting", by.term, L), "Terminal sees it when you write to it");
  // why: Use a push before OpenCode's first message to exercise prompt-hook delivery.
  assert.equal(sentNotice("waiting", by.oc, L), "OpenCode sees it when you write to it");
  assert.equal(sentNotice("waiting", by.old, L), "Old process gets it with its next browser action");
  assert.equal(sentNotice("missing", undefined, L), "Delivery failed; copied to clipboard");
});
