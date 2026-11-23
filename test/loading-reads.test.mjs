import test from "node:test";
import assert from "node:assert/strict";
import { h, page } from "./support/dom.mjs";

test("a document that shows nothing is still loading only while it loads", async () => {
  const empty = page();
  assert.deepEqual(await empty.read({ loading: true }), ["(still loading)"]);
  assert.deepEqual(await empty.read(), []);
  empty.actor.document.body = null;
  assert.deepEqual(await empty.read({ loading: true }), ["(still loading)"]);
  assert.deepEqual(await empty.read(), ["(empty page)"]);
});

test("content that is there is read as usual while the rest loads", async () => {
  const { read } = page(h("p", {}, "Ready"));
  assert.deepEqual(await read({ loading: true }), await read());
});
