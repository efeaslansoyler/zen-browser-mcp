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

test("the notice doesn't depend on max_chars", async () => {
  const deep = (inner) => [...Array.from({ length: 50 }, (_, i) => h("p", {}, `Paragraph ${i}`)), nest(5, inner)];
  const { read } = page(...deep(h("button", {}, "Deep")));
  for (const max_chars of [50, 200, 1000, 50_000])
    assert.match((await read({ depth: 3, max_chars }))[0], /^\(depth 3: deeper elements are left out/, `${max_chars}`);
  const cut = await read({ depth: 3, max_chars: 200 });
  assert.match(cut.at(-1), /^…\(truncated at 200 characters/);
  assert(cut.join("\n").length < 400);
  const nothing = page(...deep(h("span", { hidden: "" }, "Hidden")));
  assert.doesNotMatch((await nothing.read({ depth: 3, max_chars: 200 })).join("\n"), /depth 3/);
});
