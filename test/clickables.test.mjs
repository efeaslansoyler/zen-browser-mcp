import test from "node:test";
import assert from "node:assert/strict";
import { h, page } from "./support/dom.mjs";

const pointer = { style: { cursor: "pointer" } };

test("a roleless element with a pointer cursor or a click listener is listed with a ref in both filters", async () => {
  const { read } = page(
    h("div", pointer, h("span", {}, "WLAN")),
    h("div", { on: "click" }, "LAN"),
    h("div", {}, "Plain"),
  );
  assert.deepEqual(await read(), ['clickable "WLAN" [ref]', 'clickable "LAN" [ref]', 'text "Plain"']);
  assert.deepEqual(await read({ filter: "interactive" }), ['clickable "WLAN" [ref]', 'clickable "LAN" [ref]']);
});

test("only the element where the pointer cursor starts is clickable", async () => {
  const { read } = page(h("div", pointer, h("div", {}, h("span", {}, "Deep"))));
  assert.deepEqual(await read({ filter: "interactive" }), ['clickable "Deep" [ref]']);
});

test("a pointer container of separate lines keeps them readable and its listening children get refs", async () => {
  const { read } = page(
    h(
      "div",
      pointer,
      h("div", { on: "click" }, "First"),
      h("div", { on: "mousedown" }, "Second"),
      h("div", {}, "Third"),
    ),
  );
  assert.deepEqual(await read(), [
    "clickable div [ref]",
    '  clickable "First" [ref]',
    '  clickable "Second" [ref]',
    '  text "Third"',
  ]);
});

test("listeners on page roots, long blocks and wrappers of controls don't make them clickable", async () => {
  const { body, read } = page(
    h("div", { on: "click" }, h("button", {}, "Save")),
    h("div", { on: "click" }, "x".repeat(101)),
    h("div", { on: "click" }, h("div", { on: "click" }, "Inner")),
    h("div", { on: "click", box: { width: 0, height: 0 } }),
    h("div", { on: "keydown" }, "Keys"),
  );
  body.listeners = ["click"];
  body.style = { cursor: "pointer" };
  assert.deepEqual(await read({ filter: "interactive" }), ['button "Save" [ref]', 'clickable "Inner" [ref]']);
});

test("controls inside a clickable are still listed, and nothing inside a control is listed twice", async () => {
  const { read } = page(
    h("div", pointer, "Row ", h("button", {}, "Delete")),
    h("button", pointer, h("span", { on: "click" }, "Go")),
  );
  assert.deepEqual(await read({ filter: "interactive" }), [
    'clickable "Row Delete" [ref]',
    'button "Delete" [ref]',
    'button "Go" [ref]',
  ]);
});

test("an element with its own role keeps it and is marked clickable", async () => {
  const { read } = page(
    h("ul", {}, h("li", pointer, "Item")),
    h("div", { tabindex: "0", on: "click" }, "Tile"),
    h("p", {}, "Read ", h("span", pointer, "more")),
  );
  assert.deepEqual(await read(), [
    "list [ref]",
    '  listitem "Item" [ref] clickable',
    'focusable "Tile" [ref] clickable',
    "paragraph [ref]",
    '  text "Read"',
    '  clickable "more" [ref]',
  ]);
  assert.deepEqual(await read({ filter: "interactive" }), [
    'listitem "Item" [ref] clickable',
    'focusable "Tile" [ref] clickable',
    'clickable "more" [ref]',
  ]);
});

test("a label is clickable only when its own control can't be seen", async () => {
  const shown = h("input", { type: "checkbox" });
  const hidden = h("input", { type: "checkbox", hidden: "" });
  const labels = [h("label", pointer, "Shown"), h("label", pointer, "Custom")];
  labels[0].control = shown;
  labels[1].control = hidden;
  const { read } = page(shown, hidden, ...labels);
  assert.deepEqual(await read({ filter: "interactive" }), [
    "checkbox [ref] unchecked",
    'label "Custom" [ref] clickable',
  ]);
});

test("a clickable whose parts have their own listener or role keeps them all readable", async () => {
  const frame = h("iframe", {});
  frame.browsingContext = { id: 77 };
  const { read } = page(
    h("div", pointer, "main.js ", h("span", { on: "click" }, "x")),
    h("div", pointer, h("span", { on: "click" }, "Same")),
    h("div", pointer, h("h2", {}, "Title")),
    h("div", pointer, "y".repeat(120)),
    h("div", pointer, frame),
  );
  assert.deepEqual(await read(), [
    "clickable div [ref]",
    '  text "main.js"',
    '  clickable "x" [ref]',
    'clickable "Same" [ref]',
    "clickable div [ref]",
    '  heading "Title" [ref] level=2',
    "clickable div [ref]",
    `  text "${"y".repeat(120)}"`,
    "clickable div [ref]",
    "  iframe [ref]",
    "    {{frame:77}}",
  ]);
});

test("the name shown for a nameless element can't break its line", async () => {
  const { read } = page(h("i", { id: 'a"]\nbutton "Pay', on: "click" }));
  assert.deepEqual(await read(), ["clickable i#a_button_Pay [ref]"]);
});

test("reading a list of many listening children measures the list once", async () => {
  const list = h("div", pointer, ...Array.from({ length: 300 }, (_, i) => h("div", { on: "click" }, `row ${i}`)));
  let measured = 0;
  const innerText = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(list), "innerText").get;
  Object.defineProperty(list, "innerText", {
    get() {
      measured++;
      return innerText.call(list);
    },
  });
  const { read } = page(list);
  assert.equal((await read()).length, 301);
  assert(measured <= 2, `measured ${measured} times`);
});

test("an icon without text is described by its markup", async () => {
  const { read } = page(h("svg", { class: "menu", ...pointer }), h("i", { class: "icon gear", on: "click" }));
  assert.deepEqual(await read({ filter: "interactive" }), ["clickable svg.menu [ref]", "clickable i.icon.gear [ref]"]);
});

test("find returns visible text of elements without a role, deepest first", async () => {
  const { find } = page(
    h("div", {}, h("div", {}, h("span", {}, "Uygulama"))),
    h("table", {}, h("tr", {}, h("td", {}, "Cell ", h("b", {}, "WIFI")))),
    h("div", { hidden: "" }, "Uygulama hidden"),
    h("script", {}, "Uygulama"),
  );
  assert.deepEqual(await find("uygulama"), ['text "Uygulama" [ref]']);
  assert.deepEqual((await find("cell wifi"))[0], 'cell "Cell WIFI" [ref]');
});

test("find reads text across line breaks, controls and long blocks", async () => {
  const { find } = page(
    h("div", {}, "Kablosuz", h("br", {}), "Ag"),
    h("p", {}, "Read ", h("a", { href: "/t" }, "terms"), " carefully"),
    h("div", {}, h("button", {}, "Save")),
    h("pre", {}, `needle ${"z ".repeat(3000)}`),
  );
  assert.deepEqual(await find("ag"), ['text "Kablosuz Ag" [ref]']);
  assert((await find("read terms carefully")).includes('paragraph "Read terms carefully" [ref]'));
  assert.deepEqual(await find("save"), ['button "Save" [ref]']);
  assert.match((await find("needle"))[0], /^text "needle z/);
});

test("find ranks an element that holds every word above any that holds only some", async () => {
  const { find } = page(
    h("svg", { id: "wi-first", style: { cursor: "pointer" } }),
    h("div", { on: "click" }, "Wi-Fi settings"),
    h("a", { href: "/wi-fi" }, "Wi-Fi"),
    h("button", {}, "Wi-Fi"),
    h("div", {}, "Wi-Fi devices(13)"),
  );
  assert.equal((await find("wi-fi devices"))[0], 'text "Wi-Fi devices(13)" [ref]');
});

test("find ranks full matches as controls, clickables, named elements, then text", async () => {
  const { find } = page(
    h("p", {}, "Add item"),
    h("h2", {}, "Add item"),
    h("div", { on: "click" }, "Add item to the list"),
    h("button", {}, "Add an item"),
    h("button", {}, "Add"),
  );
  assert.deepEqual(await find("add item"), [
    'button "Add an item" [ref]',
    'clickable "Add item to the list" [ref]',
    'heading "Add item" [ref] level=2',
    'paragraph "Add item" [ref]',
    'button "Add" [ref]',
  ]);
});

test("a heading's level is its aria-level, then its tag's, then 2, as in Gecko's accessibility tree", async () => {
  const heading = { role: "heading" };
  const { read } = page(
    h("div", { ...heading, "aria-level": "4" }, "Div"),
    h("div", heading, "Default"),
    h("my-title", { ...heading, "aria-level": "0" }, "Invalid"),
    h("h3", {}, "Tag"),
    h("h3", { "aria-level": "5" }, "Override"),
    h("h3", { "aria-level": "none" }, "Kept"),
  );
  assert.deepEqual(await read(), [
    'heading "Div" [ref] level=4',
    'heading "Default" [ref] level=2',
    'heading "Invalid" [ref] level=2',
    'heading "Tag" [ref] level=3',
    'heading "Override" [ref] level=5',
    'heading "Kept" [ref] level=3',
  ]);
});

test("partial matches can't push a full match out of the result", async () => {
  const { find } = page(
    ...Array.from({ length: 25 }, () => h("button", {}, "Add")),
    h("p", { box: { top: 5000, bottom: 5010 } }, "Add some item"),
  );
  const found = await find("add item");
  assert.equal(found.length, 20);
  assert.equal(found[0], 'paragraph "Add some item" [ref] (off-screen)');
});

test("find sees the whole text of a control whose name is another or cut off", async () => {
  const { find } = page(
    h("button", { "aria-label": "Close" }, "Discard draft"),
    h("a", { href: "/card" }, `${"word ".repeat(30)}warranty terms`),
  );
  assert.deepEqual(await find("discard draft"), ['button "Close" [ref]']);
  assert.match((await find("warranty terms"))[0], /^link "word /);
});

test("find ranks controls and clickables above plain text, and full text above partial matches", async () => {
  const { find } = page(
    h("p", {}, "Open settings"),
    h("div", { on: "click" }, "Open settings"),
    h("button", {}, "Open settings"),
    ...Array.from({ length: 25 }, () => h("ul", {}, h("li", {}, "other"))),
    h("div", {}, "List of things"),
  );
  assert.deepEqual((await find("open settings")).slice(0, 3), [
    'button "Open settings" [ref]',
    'clickable "Open settings" [ref]',
    'paragraph "Open settings" [ref]',
  ]);
  assert.equal((await find("list things"))[0], 'text "List of things" [ref]');
});

test("what a scroller or a collapsed panel clips is off-screen and gets no label", async () => {
  const below = { top: 50, bottom: 60 };
  const clipped = (name, overflow, style = {}, around = {}) =>
    h(
      "div",
      { style: { overflow }, box: { bottom: 40 } },
      h("div", { style: around }, h("button", { style, box: below }, name)),
    );
  const nodes = [
    clipped("auto", "auto"),
    clipped("hidden", "hidden"),
    clipped("clip", "clip"),
    clipped("visible", "visible"),
    clipped("fixed", "auto", { position: "fixed" }),
    clipped("absolute", "hidden", { position: "absolute" }),
    clipped("inner", "hidden", { position: "absolute" }, { position: "relative" }),
    h("div", { style: { overflow: "auto" } }, h("button", {}, "inside")),
  ];
  const { send, read, actor } = page(...nodes);
  const shown = (await read()).filter((line) => /button/.test(line) && !/off-screen/.test(line));
  assert.deepEqual(
    shown.map((line) => line.match(/"(\w+)"/)[1]),
    ["visible", "fixed", "absolute", "inside"],
  );
  annotatable(actor);
  assert.equal((await send("annotate", { enabled: true })).length, 4);
});

test("a hit test counts before the boxes around", async () => {
  const button = h("button", { box: { top: 50, bottom: 60 } }, "Go");
  const { read, actor } = page(h("div", { style: { overflow: "auto" } }, button));
  assert.match((await read()).join(), /off-screen/);
  actor.document.elementFromPoint = () => button;
  assert.doesNotMatch((await read()).join(), /off-screen/);
});

test("annotated screenshots label clickables", async () => {
  const { actor, send } = page(h("div", pointer, "WLAN"), h("div", {}, "Plain"), h("button", {}, "Go"));
  annotatable(actor);
  assert.equal((await send("annotate", { enabled: true })).length, 2);
});

function annotatable(actor) {
  const shadow = { append() {} };
  actor.document.createElement = () => ({ style: {}, attachShadow: () => shadow, append() {}, remove() {} });
  actor.document.querySelectorAll = (selector) => actor.document.body.querySelectorAll(selector);
  actor.document.documentElement.append = () => {};
}

test("find keeps the space at the edge of an inline control", async () => {
  const inline = (tag, attrs, text) => h(tag, { style: { display: "inline" }, ...attrs }, text);
  const { find } = page(
    h("p", {}, "Read our", inline("a", { href: "/x" }, " privacy policy "), "today"),
    h("p", {}, "Hello", inline("span", { role: "button", "aria-label": "Switch" }, "\n world")),
    h("p", {}, "Over", inline("a", { href: "/y" }, "flow"), "ing"),
  );
  assert.match((await find("our privacy policy today"))[0], /^paragraph/);
  assert.match((await find("hello world"))[0], /^paragraph/);
  assert.match((await find("overflowing"))[0], /^paragraph/);
  assert.doesNotMatch((await find("over flow ing")).join("\n"), /^paragraph/m);
});

test("find sees the words of a labelled control that stand on separate lines", async () => {
  const lines = (tag, ...texts) => h(tag, {}, ...texts.map((text) => h("div", {}, text)));
  const twoLines = h("button", { "aria-label": "Setup" }, lines("span", "Connect", "Printer"));
  const deep = h("a", { href: "/x", "aria-label": "More" }, lines("div", "Scan", "Papers"), h("div", {}, "Queue"));
  const hidden = h("button", { "aria-label": "Close" }, h("div", {}, "Delete"), h("div", { hidden: "" }, "Account"));
  const row = h("div", {}, lines("button", "Wake", "Display"), h("div", {}, "tonight"));
  const { find } = page(twoLines, deep, hidden, row);
  assert.match((await find("connect printer"))[0], /^button "Setup"/);
  assert.match((await find("scan papers queue"))[0], /^link "More"/);
  assert.deepEqual(
    (await find("connectprinter")).filter((line) => /Setup/.test(line)),
    [],
  );
  assert((await find("wake display tonight")).length, "words inside and beside a control");
  assert.doesNotMatch((await find("delete account")).join("\n"), /Close/);
});
