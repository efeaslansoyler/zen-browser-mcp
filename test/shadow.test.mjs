import test from "node:test";
import assert from "node:assert/strict";
import { h, page, shadow } from "./support/dom.mjs";

const trimmed = (lines) => lines.map((line) => line.trim().replace(" [ref]", ""));

test("controls and text in shadow roots are read in the order in which they show", async () => {
  const { read, find } = page(
    h("p", {}, "Before"),
    shadow(
      h("x-card", {}, h("b", { slot: "title" }, "Title"), "loose", h("button", {}, "Slotted"), h("p", { slot: "no" })),
      h("slot"),
      h("h2", {}, "Card: ", h("slot", { name: "title" })),
      shadow(h("x-inner"), h("button", {}, "Deep")),
      h("slot", { name: "empty" }, "Fallback"),
    ),
    h("p", {}, "After"),
  );
  assert.deepEqual(trimmed(await read()), [
    "paragraph",
    'text "Before"',
    'text "loose"',
    'button "Slotted"',
    'heading "Card: Title" level=2',
    'text "Title"',
    'button "Deep"',
    'text "Fallback"',
    "paragraph",
    'text "After"',
  ]);
  assert.deepEqual(trimmed(await read({ filter: "interactive" })), ['button "Slotted"', 'button "Deep"']);
  assert.match((await find("deep"))[0], /^button "Deep"/);
  assert.match((await find("fallback"))[0], /"Fallback"/);
});

test("light children without a slot, and browser-internal roots, are left out", async () => {
  const details = shadow(h("details", { open: "" }, h("summary", {}, "More")), h("slot"), h("button", {}, "Internal"));
  details.openOrClosedShadowRoot.isUAWidget = () => true;
  const { read, find } = page(shadow(h("x-gone", {}, h("button", {}, "Gone")), h("p", {}, "Shown")), details);
  const lines = trimmed(await read());
  assert(lines.includes('text "Shown"'));
  assert(lines.includes('button "More"'), lines.join("\n"));
  assert.doesNotMatch(lines.join(), /Gone|Internal/);
  assert.deepEqual(await find("gone"), []);
});

test("names and text of elements around a shadow root include what it shows", async () => {
  const { read } = page(
    h("button", {}, "Save ", shadow(h("x-icon", {}, "old"), h("style", {}, "p{}"), h("span", {}, "draft"))),
    shadow(h("x-button", {}, "Send"), h("button", {}, h("slot"))),
    shadow(h("x-column", { role: "columnheader" }, "Whole"), h("slot")),
    h("p", {}, shadow(h("x-time", {}, "Nov 3"), "3 days ago")),
  );
  assert.deepEqual(trimmed(await read()), [
    'button "Save draft"',
    'button "Send"',
    'columnheader "Whole"',
    "paragraph",
    'text "3 days ago"',
  ]);
});

test("aria-labelledby resolves in the element's own root", async () => {
  const { read } = page(
    h("p", { id: "name" }, "Outer"),
    shadow(h("x-field"), h("p", { id: "name" }, "Inner"), h("input", { "aria-labelledby": "name" })),
  );
  assert.deepEqual(trimmed(await read({ filter: "interactive" })), ['textbox "Inner"']);
});

test("text and selector conditions see shadow roots", async () => {
  const { send } = page(shadow(h("x-app"), h("p", { role: "status" }, "Build passed")));
  assert.equal(await send("check", { text: "build passed" }), true);
  assert.equal(await send("check", { selector: "p[role=status]" }), true);
  assert.equal(await send("check", { selector: "p[role=status]", text: "build passed" }), true);
  assert.equal(await send("check", { selector: "p[role=alert]" }), false);
  assert.equal(await send("sample", { selector: "p[role=status]" }), "Build passed");
});

test("a submit button around slotted content, in a closed root too, is a submit", async () => {
  const label = h("span", {}, "Pay");
  const button = h("button", { type: "submit" }, h("slot"));
  button.form = {};
  const { actor, send } = page(shadow(h("x-pay", {}, label), button));
  actor.document.elementFromPoint = () => label;
  assert.equal((await send("risk", { x: 5, y: 5 })).submit, true);
});

test("a click on a slotted part names the shadow control around it", async () => {
  const label = h("span", {}, "Pay");
  const { click } = page(shadow(h("x-pay", {}, label), h("button", { on: "click" }, h("slot"))));
  assert.equal(await click(label), 'button "Pay" [ref]');
});

test("a hit test descends into nested closed roots", async () => {
  const button = h("button", { on: "click" }, "Deep");
  const inner = shadow(h("x-inner"), button);
  const outer = shadow(h("x-outer"), inner);
  outer.openOrClosedShadowRoot.elementFromPoint = () => inner;
  inner.openOrClosedShadowRoot.elementFromPoint = () => button;
  const { click } = page(outer);
  assert.equal(await click(outer), 'button "Deep" [ref]');
});

test("a component that looks clickable isn't a second target beside its one control", async () => {
  const pointer = { style: { cursor: "pointer" } };
  const { read } = page(
    shadow(h("x-button", pointer, "Send"), h("button", {}, h("slot"))),
    shadow(h("x-row", pointer, "Open row"), h("span", {}, h("slot")), h("button", {}, "Delete")),
  );
  assert.deepEqual(trimmed(await read({ filter: "interactive" })), [
    'button "Send"',
    'clickable "Open row Delete"',
    'button "Delete"',
  ]);
});
