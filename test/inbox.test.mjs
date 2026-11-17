import test from "node:test";
import assert from "node:assert/strict";
import { Inbox, inboxText } from "../browser/Inbox.sys.mjs";

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
