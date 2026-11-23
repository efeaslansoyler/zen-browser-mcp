import test from "node:test";
import assert from "node:assert/strict";
import { h, page } from "./support/dom.mjs";

const pointer = { style: { cursor: "pointer" } };
const td = (...children) => h("td", {}, ...children);
const row = (...cells) => h("table", {}, h("tr", {}, ...cells));
const fields = async (...children) =>
  (await page(...children).read({ filter: "interactive" })).map((line) => line.replace(" [ref]", ""));

test("a field without a name takes the only text before it in its row", async () => {
  assert.deepEqual(
    await fields(
      row(td("DHCP Server"), td(h("input", { type: "checkbox" }))),
      row(td(h("b", {}, "Lease time")), td(h("div", {}, h("input", {}), " seconds"))),
      row(td("Mode"), td(":"), td(), td(h("input", {}))),
      row(td("Firmware"), td(h("input", { type: "file" }))),
      row(td("Guest"), td(h("div", { role: "switch" }))),
      row(td("Hidden beside"), td(h("input", {}), h("input", { hidden: "" }))),
    ),
    [
      'checkbox "DHCP Server" (from row) unchecked',
      'textbox "Lease time" (from row)',
      'textbox "Mode" (from row)',
      'button "Firmware" (from row)',
      'switch "Guest" (from row)',
      'textbox "Hidden beside" (from row)',
    ],
  );
});

test("a declared name stays", async () => {
  assert.deepEqual(
    await fields(
      row(td("Row"), td(h("input", { "aria-label": "Aria" }))),
      row(td("Row"), td(h("input", { placeholder: "Example" }))),
      row(td("Row"), td(h("input", { title: "Tip" }))),
      row(td("Row"), td(h("button", {}, "Apply"))),
    ),
    ['textbox "Aria"', 'textbox "Example"', 'textbox "Tip"', 'button "Apply"'],
  );
});

test("several fields, records and layout cells give no name", async () => {
  const lines = await fields(
    row(td("Address"), td(h("input", {})), td(h("input", {}))),
    row(td("Band"), td(h("input", { type: "radio" }), h("input", { type: "radio" }))),
    row(td(h("input", {}), "Name"), td(h("input", {}))),
    row(td("phone"), td("192.168.1.5"), td(h("input", {}))),
    row(td(h("input", {})), td("After")),
    row(td(h("div", {}, "Home"), h("div", {}, "About")), td(h("input", {}))),
    row(td("x".repeat(101)), td(h("input", {}))),
    row(td("Sidebar"), td(h("h2", {}, "Content"), h("input", {}))),
    row(td("Outer"), td(row(td(h("input", {}))))),
    row(td("Icon"), td(h("button", {}))),
  );
  assert.equal(lines.length, 13);
  for (const line of lines) assert.doesNotMatch(line, /"/);
  assert.deepEqual(await fields(row(td(h("a", { href: "/" }, "Logo")), td(h("input", {})))), [
    'link "Logo" href="/"',
    "textbox",
  ]);
});

test("find returns a field by the label in its row", async () => {
  const { find } = page(row(td("Lease time"), td(h("input", { value: "3600" }))));
  assert.equal((await find("lease time"))[0], 'textbox "Lease time" (from row) [ref]');
});

test("a click result names the field by its row", async () => {
  const input = h("input", {});
  const { click } = page(row(td("Lease time"), td(input)));
  assert.equal(await click(input), 'textbox "Lease time" (from row) [ref]');
});

test("a control or clickable without shown text takes its title, then its own hidden text", async () => {
  const hidden = (text) => h("span", { hidden: "" }, text);
  assert.deepEqual(
    await fields(
      h("div", pointer, hidden("Ana Sayfa")),
      h("div", { ...pointer, title: "Tip" }, hidden("Hidden")),
      h("button", {}, h("svg", {}), hidden("Save")),
      h("div", pointer, "Shown", hidden("Hidden")),
    ),
    ['clickable "Ana Sayfa" (hidden text)', 'clickable "Tip"', 'button "Save" (hidden text)', 'clickable "Shown"'],
  );
});

test("hidden text of a submenu, an inner control or a script names nothing", async () => {
  const lines = await fields(
    h("div", pointer, h("div", { hidden: "" }, h("div", {}, "One"), h("div", {}, "Two"))),
    h("div", pointer, h("div", { hidden: "" }, h("a", { href: "/" }, "Delete"))),
    h("div", pointer, h("div", { hidden: "" }, h("div", { on: "click" }, "Open"))),
    h("div", pointer, h("div", { hidden: "" }, "x".repeat(101))),
    h("div", pointer, h("script", { hidden: "" }, "run()")),
    h("div", {}, h("div", { hidden: "" }, "Plain")),
  );
  assert.deepEqual(lines, Array(5).fill("clickable div"));
});
