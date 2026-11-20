import test from "node:test";
import assert from "node:assert/strict";
import { SourceResolver } from "../browser/SourceResolver.sys.mjs";

function resolve(hints, { siteAllowed = () => true } = {}) {
  const fetched = [];
  const sources = new SourceResolver({
    fetchText: async (url) => {
      fetched.push(url);
      throw new Error("404");
    },
    siteAllowed,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    budgetMs: 1000,
  });
  return sources.resolve(hints, { pageUrl: "http://localhost:5173/", document: {} }).then((result) => {
    assert.deepEqual(fetched, []);
    return result;
  });
}

test("React 18 debug sources give the element and its user owners' call sites", async () => {
  const at = (fileName, lineNumber, columnNumber) => ({ fileName, lineNumber, columnNumber });
  const result = await resolve({
    react18: {
      element: at("/home/dev/shop/src/Card.tsx", 12, 5),
      owners: [
        { name: "Card", source: at("/home/dev/shop/src/App.tsx", 4, 7) },
        { name: "Route", source: at("/home/dev/shop/node_modules/router/index.js", 80, 1) },
        { name: "App", source: at("/home/dev/shop/src/main.tsx", 9, 3) },
        { name: "Root", source: null },
        { name: "Page", source: at("/home/dev/shop/src/Page.tsx", 2, 1) },
        { name: "Shell", source: at("/home/dev/shop/src/Shell.tsx", 2, 1) },
      ],
    },
  });
  assert.deepEqual(result, {
    framework: "React",
    precision: "element",
    chain: [
      { role: "element", file: "/home/dev/shop/src/Card.tsx", line: 12, column: 5 },
      { role: "component", name: "Card", file: "/home/dev/shop/src/App.tsx", line: 4, column: 7 },
      { role: "component", name: "App", file: "/home/dev/shop/src/main.tsx", line: 9, column: 3 },
      { role: "component", name: "Page", file: "/home/dev/shop/src/Page.tsx", line: 2, column: 1 },
    ],
    snippet: null,
  });
});

test("Svelte element metadata gives the element and the component call sites above it", async () => {
  const result = await resolve({
    svelte: {
      element: { file: "src/lib/Card.svelte", line: 12, column: 4 },
      parents: [
        { name: "Card", file: "src/routes/+page.svelte", line: 8, column: 2 },
        { name: "Layout", file: "src/routes/+layout.svelte", line: 3, column: 0 },
      ],
    },
  });
  assert.deepEqual(result, {
    framework: "Svelte",
    precision: "element",
    chain: [
      { role: "element", file: "src/lib/Card.svelte", line: 12, column: 5 },
      { role: "component", name: "Card", file: "src/routes/+page.svelte", line: 8, column: 3 },
      { role: "component", name: "Layout", file: "src/routes/+layout.svelte", line: 3, column: 1 },
    ],
    snippet: null,
  });
});

test("Svelte metadata without a column keeps the line only", async () => {
  const result = await resolve({
    svelte: {
      element: { file: "src/lib/Card.svelte", line: 12, column: null },
      parents: [{ name: "Card", file: "src/routes/+page.svelte", line: 8, column: null }],
    },
  });
  assert.deepEqual(result.chain, [
    { role: "element", file: "src/lib/Card.svelte", line: 12 },
    { role: "component", name: "Card", file: "src/routes/+page.svelte", line: 8 },
  ]);
});

test("Astro dev source attributes give the element's file and line", async () => {
  assert.deepEqual(await resolve({ astro: { file: "/home/dev/site/src/pages/index.astro", loc: "5:17" } }), {
    framework: "Astro",
    precision: "element",
    chain: [{ role: "element", file: "/home/dev/site/src/pages/index.astro", line: 5 }],
    snippet: null,
  });
});

test("Vue gives the nearest user component's file without a line", async () => {
  const result = await resolve({
    vue: {
      components: [
        { name: "RouterLink", file: "/home/dev/app/node_modules/vue-router/dist/RouterLink.vue" },
        { name: "Card", file: "/home/dev/app/src/components/Card.vue" },
        { name: "App", file: "/home/dev/app/src/App.vue" },
      ],
    },
  });
  assert.deepEqual(result, {
    framework: "Vue",
    precision: "component",
    chain: [{ role: "definition", name: "Card", file: "/home/dev/app/src/components/Card.vue" }],
    snippet: null,
  });
});

test("Angular gives the component class's file and line", async () => {
  assert.deepEqual(
    await resolve({ angular: { name: "CardComponent", file: "src/app/card/card.component.ts", line: 9 } }),
    {
      framework: "Angular",
      precision: "component",
      chain: [{ role: "definition", name: "CardComponent", file: "src/app/card/card.component.ts", line: 9 }],
      snippet: null,
    },
  );
});

test("framework metadata that is missing, library-only or blocked yields unknown", async () => {
  for (const hints of [
    { react18: { element: { fileName: "/app/node_modules/ui/Button.js", lineNumber: 3 }, owners: [] } },
    { react18: { element: null, owners: [] } },
    { svelte: { element: { file: "", line: 1, column: 0 }, parents: [] } },
    { astro: { file: "", loc: "" } },
    { vue: { components: [{ name: "Lib", file: "/app/node_modules/lib/Lib.vue" }] } },
    { angular: { name: "AppComponent", file: null, line: null } },
  ])
    assert.equal(await resolve(hints), "unknown", JSON.stringify(hints));
  assert.equal(
    await resolve({ astro: { file: "/site/src/pages/index.astro", loc: "1:1" } }, { siteAllowed: () => false }),
    "unknown",
  );
});
