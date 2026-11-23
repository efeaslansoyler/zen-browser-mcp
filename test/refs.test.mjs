import test from "node:test";
import assert from "node:assert/strict";
import { bridgeContext } from "./support/bridge.mjs";
import { h, page } from "./support/dom.mjs";

function tab() {
  const queries = [];
  const load = () => ({
    getActor: () => ({
      sendAsyncMessage() {},
      sendQuery: async (name, data) => {
        queries.push(data.documentNumber);
        return { value: "done" };
      },
    }),
  });
  const frame = (frames = []) => ({
    frames,
    currentWindowGlobal: load(),
    getAllBrowsingContextsInSubtree() {
      return [this, ...frames];
    },
  });
  const child = frame();
  const top = frame([child]);
  const browser = { browsingContext: top, ownerDocument: { defaultView: { gBrowser: { getTabDialogBox() {} } } } };
  return { browser, top, child, load, queries };
}

function bridge(refDocuments) {
  const ctx = bridgeContext({ assertSiteAccess() {}, ...(refDocuments && { refDocuments }) });
  ctx.access.check = () => {};
  const refIn = async (t, frame) => {
    await ctx.query(t.browser, "find", {}, 1000, frame);
    return `ref_${t.queries.at(-1)}b`;
  };
  return { ctx, refIn };
}

test("a ref finds its frame until that frame loads another document", async () => {
  const t = tab();
  const { ctx, refIn } = bridge();
  const [inTop, inChild] = [await refIn(t, t.top), await refIn(t, t.child)];
  assert.equal(ctx.frameOf(t.browser, inTop), t.top);
  assert.equal(ctx.frameOf(t.browser, inChild), t.child);

  t.child.currentWindowGlobal = t.load();
  assert.throws(() => ctx.frameOf(t.browser, inChild), /not found/);
  const fresh = await refIn(t, t.child);
  assert.notEqual(fresh, inChild);
  assert.throws(() => ctx.frameOf(t.browser, inChild), /not found/);
  assert.equal(ctx.frameOf(t.browser, inTop), t.top);

  const cached = t.top.currentWindowGlobal;
  t.top.currentWindowGlobal = t.load();
  await refIn(t, t.top);
  assert.throws(() => ctx.frameOf(t.browser, inTop), /not found/);
  t.top.currentWindowGlobal = cached;
  assert.equal(ctx.frameOf(t.browser, inTop), t.top);
});

test("a ref from another tab, from before a bridge reload or with another shape is not found", async () => {
  const [a, b] = [tab(), tab()];
  const first = bridge();
  const ref = await first.refIn(a, a.top);
  await first.refIn(b, b.top);
  assert.throws(() => first.ctx.frameOf(b.browser, ref), /not found/);
  for (const other of ["ref_1", "ref_1_f2", "1b", "ref_b", `panel_1_2:${ref}`])
    assert.throws(() => first.ctx.frameOf(a.browser, other), /not found/);

  const reloaded = bridge(first.ctx.refDocuments);
  await reloaded.refIn(a, a.top);
  assert.throws(() => reloaded.ctx.frameOf(a.browser, ref), /not found/);
});

test("refs of a document are distinct and short, and a ref of another document is not an element", async () => {
  const p = page(...Array.from({ length: 450 }, (_, i) => h("button", {}, `Item ${i}`)));
  const lines = (await p.send("read_page", { bare: true, documentNumber: 7 })).split("\n");
  const refs = lines.map((line) => line.match(/\[(ref_\w+)\]/)[1]);
  assert.equal(new Set(refs).size, 450);
  assert.deepEqual(
    [refs[0], refs[19], refs[20], refs[419], refs[420]],
    ["ref_7b", "ref_7z", "ref_7bb", "ref_7zz", "ref_7bbb"],
  );
  await assert.rejects(p.send("locate", { ref: "ref_6b", documentNumber: 7 }), /ref_6b not found/);
});
