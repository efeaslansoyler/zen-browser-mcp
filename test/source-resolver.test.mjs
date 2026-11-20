import test from "node:test";
import assert from "node:assert/strict";
import { SourceResolver } from "../browser/SourceResolver.sys.mjs";
import { sourceMap, inlineMapComment } from "./support/source-maps.mjs";

const ORIGIN = "http://localhost:5173";
const RUNTIME = `${ORIGIN}/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1a2b`;
const DOM = `${ORIGIN}/node_modules/.vite/deps/react-dom_client.js?v=1a2b`;

const CARD_SOURCE = Array.from({ length: 20 }, (_, i) => `// card line ${i + 1}`);
CARD_SOURCE[11] = '    <button className="buy">Satın al</button>';
const APP_SOURCE = Array.from({ length: 10 }, (_, i) => `// app line ${i + 1}`);
const PAGE_SOURCE = Array.from({ length: 10 }, (_, i) => `// page line ${i + 1}`);

// A Vite dev server: transformed modules with inline maps (sources relative to the module),
// one external map, and one map with an absolute file system source.
const files = {
  [`${ORIGIN}/src/Card.tsx`]: `export function Card() {}\n${inlineMapComment(
    sourceMap({
      sources: ["Card.tsx"],
      sourcesContent: [CARD_SOURCE.join("\n")],
      // generated line 5, column 20 (1-based) → Card.tsx line 12, column 5
      lines: [
        [],
        [],
        [],
        [],
        [
          [0, 0, 10, 0],
          [19, 0, 11, 4],
          [40, 0, 12, 0],
        ],
      ],
    }),
  )}\n`,
  [`${ORIGIN}/src/App.tsx?t=17`]: `export function App() {}\n//# sourceMappingURL=App.tsx.map\n`,
  [`${ORIGIN}/src/App.tsx.map`]: sourceMap({
    sources: ["App.tsx"],
    sourcesContent: [APP_SOURCE.join("\n")],
    // generated line 7, column 9 → App.tsx line 4, column 7
    lines: [[], [], [], [], [], [], [[8, 0, 3, 6]]],
  }),
  [`${ORIGIN}/src/Page.tsx`]: `export function Page() {}\n${inlineMapComment(
    sourceMap({
      sources: ["/home/dev/shop/src/Page.tsx"],
      sourcesContent: [PAGE_SOURCE.join("\n")],
      // generated line 2, column 3 → line 6, column 3
      lines: [[], [[2, 0, 5, 2]]],
    }),
  )}\n`,
};

const frame = (name, url, line, column) => `${name}@${url}:${line}:${column}`;
const stack = (...frames) =>
  [
    frame("jsxDEV", RUNTIME, 250, 33),
    ...frames,
    frame("react_stack_bottom_frame", DOM, 17424, 20),
    frame("renderWithHooks", DOM, 4206, 24),
    // after React's bottom frame: the app's own render call, never part of the location
    frame("", `${ORIGIN}/src/main.tsx`, 9, 1),
  ].join("\n");

const hints = {
  react19: {
    element: stack(frame("Card", `${ORIGIN}/src/Card.tsx`, 5, 20)),
    owners: [
      { name: "Card", stack: stack(frame("App", `${ORIGIN}/src/App.tsx?t=17`, 7, 9)) },
      { name: "Route", stack: stack(frame("Routes", `${ORIGIN}/node_modules/.vite/deps/router.js?v=1a2b`, 80, 12)) },
      { name: "App", stack: stack(frame("Page", `${ORIGIN}/src/Page.tsx`, 2, 3)) },
      { name: "Page", stack: stack(frame("Shell", `${ORIGIN}/src/App.tsx?t=17`, 7, 9)) },
      { name: "Shell", stack: stack(frame("", `${ORIGIN}/src/App.tsx?t=17`, 7, 9)) },
    ],
  },
};

function resolver(overrides = {}) {
  const fetched = [];
  const sources = new SourceResolver({
    fetchText: async (url) => {
      fetched.push(url);
      if (!(url in files)) throw new Error(`404 ${url}`);
      return files[url];
    },
    siteAllowed: () => true,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    budgetMs: 1000,
    ...overrides,
  });
  return { sources, fetched };
}

test("a Vite React 19 client stack resolves to the element and three user component call sites", async () => {
  const { sources } = resolver();
  const result = await sources.resolve(hints, { pageUrl: `${ORIGIN}/products`, document: {} });
  assert.equal(result.framework, "React");
  assert.equal(result.precision, "element");
  assert.deepEqual(result.chain, [
    { role: "element", file: "src/Card.tsx", original: "Card.tsx", line: 12, column: 5 },
    { role: "component", name: "Card", file: "src/App.tsx", original: "App.tsx", line: 4, column: 7 },
    {
      role: "component",
      name: "App",
      file: "src/Page.tsx",
      original: "/home/dev/shop/src/Page.tsx",
      line: 6,
      column: 3,
    },
    { role: "component", name: "Page", file: "src/App.tsx", original: "App.tsx", line: 4, column: 7 },
  ]);
});

test("the snippet comes from the map's original source around the element's line", async () => {
  const { sources } = resolver();
  const { snippet } = await sources.resolve(hints, { pageUrl: `${ORIGIN}/`, document: {} });
  assert.deepEqual(snippet, {
    file: "src/Card.tsx",
    line: 12,
    start: 9,
    lines: CARD_SOURCE.slice(8, 16),
  });
});

test("the snippet is cut at the start of a short file", async () => {
  const { sources } = resolver();
  const result = await sources.resolve(
    { react19: { element: stack(frame("App", `${ORIGIN}/src/App.tsx?t=17`, 7, 9)), owners: [] } },
    { pageUrl: `${ORIGIN}/`, document: {} },
  );
  assert.equal(result.snippet.start, 1);
  assert.deepEqual(result.snippet.lines, APP_SOURCE.slice(0, 8));
});

test("maps are cached per document", async () => {
  const { sources, fetched } = resolver();
  const document = {};
  await sources.resolve(hints, { pageUrl: `${ORIGIN}/`, document });
  const first = fetched.length;
  await sources.resolve(hints, { pageUrl: `${ORIGIN}/`, document });
  assert.equal(fetched.length, first);
  await sources.resolve(hints, { pageUrl: `${ORIGIN}/`, document: {} });
  assert.equal(fetched.length, first * 2);
  assert.equal(new Set(fetched).size, first);
});

test("missing, unreachable, cross-origin and disallowed sources yield unknown", async () => {
  const pageUrl = `${ORIGIN}/`;
  const only = (url, line = 1, column = 1) => ({
    react19: { element: stack(frame("Card", url, line, column)), owners: [] },
  });
  // a module without a sourceMappingURL comment
  files[`${ORIGIN}/src/plain.js`] = "export const x = 1;\n";
  assert.equal(await resolver().sources.resolve(only(`${ORIGIN}/src/plain.js`), { pageUrl, document: {} }), "unknown");
  // the module itself is unreachable
  assert.equal(await resolver().sources.resolve(only(`${ORIGIN}/src/gone.js`), { pageUrl, document: {} }), "unknown");
  // a map on another origin is never fetched
  files[`${ORIGIN}/src/far.js`] = "//# sourceMappingURL=https://maps.example/far.js.map\n";
  const far = resolver();
  assert.equal(await far.sources.resolve(only(`${ORIGIN}/src/far.js`), { pageUrl, document: {} }), "unknown");
  assert.deepEqual(far.fetched, [`${ORIGIN}/src/far.js`]);
  // a module from another origin is never fetched
  const cdn = resolver();
  assert.equal(await cdn.sources.resolve(only("https://cdn.example/Card.js"), { pageUrl, document: {} }), "unknown");
  assert.deepEqual(cdn.fetched, []);
  // the site rules block the page's host
  const blocked = resolver({ siteAllowed: (host) => host !== "localhost" });
  assert.equal(await blocked.sources.resolve(hints, { pageUrl, document: {} }), "unknown");
  assert.deepEqual(blocked.fetched, []);
  // stacks with only library frames
  assert.equal(
    await resolver().sources.resolve(
      { react19: { element: stack(frame("Lib", `${ORIGIN}/node_modules/.vite/deps/lib.js`, 3, 3)), owners: [] } },
      { pageUrl, document: {} },
    ),
    "unknown",
  );
});

test("a slow source map yields unknown within the time budget", async () => {
  const { sources } = resolver({ fetchText: () => new Promise(() => {}), budgetMs: 40 });
  const started = Date.now();
  assert.equal(await sources.resolve(hints, { pageUrl: `${ORIGIN}/`, document: {} }), "unknown");
  assert(Date.now() - started < 500);
});

test("hints without a known framework yield unknown", async () => {
  const { sources, fetched } = resolver();
  assert.equal(await sources.resolve({}, { pageUrl: `${ORIGIN}/`, document: {} }), "unknown");
  assert.deepEqual(fetched, []);
});

// CSS: a Vite dev style with and without a CSS source map, linked sheets, inline and script-made rules.
const CARD_CSS = Array.from({ length: 30 }, (_, i) => `/* card.css line ${i + 1} */`);
const cardCssMap = (sources) =>
  `data:application/json;base64,${Buffer.from(
    sourceMap({
      sources,
      sourcesContent: [CARD_CSS.join("\n")],
      // injected line 3 → line 18; injected line 8, column 3 → line 25, column 1
      lines: [[], [], [[0, 0, 17, 0]], [], [], [], [], [[2, 0, 24, 0]]],
    }),
  ).toString("base64")}`;
files[`${ORIGIN}/assets/site.css`] = ".a{}\n.b{}\n/*# sourceMappingURL=site.css.map */\n";
files[`${ORIGIN}/assets/site.css.map`] = sourceMap({
  sources: ["../src/styles/site.scss"],
  sourcesContent: ["// scss"],
  lines: [[], [[0, 0, 40, 0]]],
});
files[`${ORIGIN}/assets/plain.css`] = ".a{}\n";

const css = (sheets, rules) => ({ css: { sheets, rules } });
const rule = (sheet, selector, line, column = 1) => ({ sheet, selector, line, column });

test("Vite dev styles resolve to their original file, and to original lines with a CSS source map", async () => {
  const devId = "/home/dev/shop/src/Card.css";
  const { sources, fetched } = resolver();
  const result = await sources.resolve(
    css(
      [
        { kind: "style", devId, map: cardCssMap(["Card.css"]) },
        { kind: "style", devId: "/home/dev/shop/src/Plain.css", map: null },
        { kind: "style", devId: "/home/dev/shop/src/Abs.css", map: cardCssMap(["/home/dev/shop/src/theme/Abs.scss"]) },
      ],
      [rule(0, ".buy:hover", 8, 3), rule(0, ".buy", 3), rule(1, ".plain", 12), rule(2, ".abs", 3)],
    ),
    { pageUrl: `${ORIGIN}/`, document: {} },
  );
  assert.equal(result.chain, undefined);
  assert.deepEqual(result.cssRules, [
    { selector: ".buy:hover", kind: "file", file: devId, original: "Card.css", line: 25 },
    { selector: ".buy", kind: "file", file: devId, original: "Card.css", line: 18 },
    { selector: ".plain", kind: "unmapped", file: "/home/dev/shop/src/Plain.css", line: 12 },
    {
      selector: ".abs",
      kind: "file",
      file: "/home/dev/shop/src/theme/Abs.scss",
      original: "/home/dev/shop/src/theme/Abs.scss",
      line: 18,
    },
  ]);
  assert.deepEqual(fetched, []);
});

test("linked stylesheets map through their own source map or keep the served file's line", async () => {
  const { sources, fetched } = resolver();
  const result = await sources.resolve(
    css(
      [
        { kind: "link", href: `${ORIGIN}/assets/site.css` },
        { kind: "link", href: `${ORIGIN}/assets/plain.css` },
        { kind: "link", href: "https://cdn.example/lib.css" },
      ],
      [rule(0, ".b", 2), rule(1, ".a", 1), rule(2, ".lib", 7)],
    ),
    { pageUrl: `${ORIGIN}/`, document: {} },
  );
  assert.deepEqual(result.cssRules, [
    { selector: ".b", kind: "file", file: "src/styles/site.scss", original: "../src/styles/site.scss", line: 41 },
    { selector: ".a", kind: "file", file: "assets/plain.css", line: 1 },
    { selector: ".lib", kind: "file", file: "https://cdn.example/lib.css", line: 7 },
  ]);
  assert(!fetched.some((url) => url.startsWith("https://cdn.example")));
});

test("inline and script-made rules are reported without invented files or lines", async () => {
  const { sources } = resolver();
  const result = await sources.resolve(
    css(
      [{ kind: "style", devId: null, map: null }, { kind: "script", devId: null }, { kind: "constructed" }],
      [rule(0, "button", 3), rule(1, ".css-1x2y", 1), rule(2, ".adopted", 1)],
    ),
    { pageUrl: `${ORIGIN}/`, document: {} },
  );
  assert.deepEqual(result.cssRules, [
    { selector: "button", kind: "inline", line: 3 },
    { selector: ".css-1x2y", kind: "script" },
    { selector: ".adopted", kind: "script" },
  ]);
});

test("CSS rules accompany a resolved element location", async () => {
  const { sources } = resolver();
  const result = await sources.resolve(
    { ...hints, ...css([{ kind: "link", href: `${ORIGIN}/assets/plain.css` }], [rule(0, ".a", 1)]) },
    { pageUrl: `${ORIGIN}/`, document: {} },
  );
  assert.equal(result.chain[0].file, "src/Card.tsx");
  assert.deepEqual(result.cssRules, [{ selector: ".a", kind: "file", file: "assets/plain.css", line: 1 }]);
});

test("CSS rules survive an unresolved element location, and the site rules still apply", async () => {
  const hintsWithCss = {
    react19: { element: stack(frame("Card", `${ORIGIN}/src/gone.js`, 1, 1)), owners: [] },
    ...css([{ kind: "link", href: `${ORIGIN}/assets/plain.css` }], [rule(0, ".a", 1)]),
  };
  const result = await resolver().sources.resolve(hintsWithCss, { pageUrl: `${ORIGIN}/`, document: {} });
  assert.deepEqual(result, { cssRules: [{ selector: ".a", kind: "file", file: "assets/plain.css", line: 1 }] });
  const blocked = resolver({ siteAllowed: () => false });
  assert.equal(await blocked.sources.resolve(hintsWithCss, { pageUrl: `${ORIGIN}/`, document: {} }), "unknown");
});

// A Next.js app-router dev server (Turbopack). Server components reach the browser as React's fake
// "rsc://React/<env>/<server file>?<n>" frames at the server chunk's own line and column; their
// maps come from the dev endpoint, as index maps with sources under turbopack:///[project]/.
const NEXT = "http://localhost:3000";
const SERVER_CHUNK = "file:///home/dev/shop/.next/server/chunks/ssr/[root-of-the-server]__abc._.js";
const CLIENT_CHUNK = `${NEXT}/_next/static/chunks/app_counter_tsx_1f2e._.js`;
const NEXT_PAGE = Array.from({ length: 12 }, (_, i) => `// page.tsx line ${i + 1}`);
NEXT_PAGE[6] = '      <h1 className="title">Shop</h1>';
const NEXT_COUNTER = Array.from({ length: 12 }, (_, i) => `// counter.tsx line ${i + 1}`);
const indexMap = (offset, map) =>
  JSON.stringify({
    version: 3,
    sections: [
      {
        offset: { line: 0, column: 0 },
        map: JSON.parse(
          sourceMap({ sources: ["turbopack:///[project]/node_modules/next/x.js"], lines: [[[0, 0, 0, 0]]] }),
        ),
      },
      { offset, map: JSON.parse(map) },
    ],
  });
const nextEndpoint = (filename) => `${NEXT}/__nextjs_source-map?filename=${encodeURIComponent(filename)}`;
const nextFiles = {
  [nextEndpoint(SERVER_CHUNK)]: indexMap(
    { line: 40, column: 0 },
    // section line 3, column 7 (zero-based) → page.tsx line 7, column 7
    sourceMap({
      sources: ["turbopack:///[project]/app/page.tsx"],
      sourcesContent: [NEXT_PAGE.join("\n")],
      lines: [[], [], [], [[6, 0, 6, 6]]],
    }),
  ),
  [CLIENT_CHUNK]: "(globalThis.TURBOPACK = []).push([]);\n//# sourceMappingURL=app_counter_tsx_1f2e._.js.map\n",
  [`${CLIENT_CHUNK}.map`]: indexMap(
    { line: 10, column: 0 },
    // section line 2, column 4 → counter.tsx line 9, column 5
    sourceMap({
      sources: ["turbopack:///[project]/app/counter.tsx"],
      sourcesContent: [NEXT_COUNTER.join("\n")],
      lines: [[], [], [[4, 0, 8, 4]]],
    }),
  ),
};
const rsc = (name, line, column, scheme = "rsc") =>
  frame(name, `${scheme}://React/Server/${encodeURI(SERVER_CHUNK)}?7`, line, column);

function nextResolver(served = nextFiles) {
  return resolver({
    fetchText: async (url) => {
      if (!(url in served)) throw new Error(`404 ${url}`);
      return served[url];
    },
  }).sources;
}

test("a Next.js server component frame resolves through the dev source map endpoint", async () => {
  const result = await nextResolver().resolve(
    { react19: { element: stack(rsc("Page", 44, 8)), owners: [] } },
    { pageUrl: `${NEXT}/shop`, document: {} },
  );
  assert.equal(result.framework, "Next.js");
  assert.deepEqual(result.chain, [
    { role: "element", file: "app/page.tsx", original: "turbopack:///[project]/app/page.tsx", line: 7, column: 7 },
  ]);
  assert.deepEqual(result.snippet, { file: "app/page.tsx", line: 7, start: 4, lines: NEXT_PAGE.slice(3, 11) });
});

test("newer React's about://React/ server frames and Next.js client chunks resolve as well", async () => {
  const result = await nextResolver().resolve(
    {
      react19: {
        element: stack(frame("Counter", CLIENT_CHUNK, 13, 5)),
        owners: [{ name: "Counter", stack: stack(rsc("Page", 44, 8, "about")) }],
      },
    },
    { pageUrl: `${NEXT}/`, document: {} },
  );
  assert.equal(result.framework, "Next.js");
  assert.deepEqual(result.chain, [
    {
      role: "element",
      file: "app/counter.tsx",
      original: "turbopack:///[project]/app/counter.tsx",
      line: 9,
      column: 5,
    },
    {
      role: "component",
      name: "Counter",
      file: "app/page.tsx",
      original: "turbopack:///[project]/app/page.tsx",
      line: 7,
      column: 7,
    },
  ]);
});

test("a missing or failing Next.js dev endpoint yields unknown", async () => {
  const hintsOf = { react19: { element: stack(rsc("Page", 44, 8)), owners: [] } };
  for (const body of [undefined, "", "<!DOCTYPE html><h1>404</h1>", '{"error":"boom"}']) {
    const served = { ...nextFiles };
    if (body === undefined) delete served[nextEndpoint(SERVER_CHUNK)];
    else served[nextEndpoint(SERVER_CHUNK)] = body;
    assert.equal(await nextResolver(served).resolve(hintsOf, { pageUrl: `${NEXT}/`, document: {} }), "unknown");
  }
});
