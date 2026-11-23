import test from "node:test";
import assert from "node:assert/strict";
import { h, page } from "./support/dom.mjs";

const nest = (levels, inner) => (levels ? h("div", {}, nest(levels - 1, inner)) : inner);

test("elements at any depth are read unless a depth is given, which says what it did", async () => {
  const { read } = page(h("p", {}, "Near"), nest(40, h("button", {}, "Deep")));
  assert.deepEqual(await read({ filter: "interactive" }), ['button "Deep" [ref]']);
  assert.deepEqual(await read({ filter: "interactive", depth: 41 }), ['button "Deep" [ref]']);
  const [notice, ...rest] = await read({ depth: 40 });
  assert.match(notice, /^\(depth 40: deeper elements are left out/);
  assert.deepEqual(rest, ["paragraph [ref]", '  text "Near"']);
});

test("a depth that leaves out nothing to read says nothing", async () => {
  const { read } = page(h("p", {}, "Near"), nest(5, h("span", { hidden: "" }, "Hidden")));
  assert.deepEqual(await read({ depth: 2 }), ["paragraph [ref]", '  text "Near"']);
});
