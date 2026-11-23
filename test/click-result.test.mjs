import test from "node:test";
import assert from "node:assert/strict";
import { h, page } from "./support/dom.mjs";

const pointer = { style: { cursor: "pointer" } };

test("a coordinate click names the control or clickable around the point, with its ref", async () => {
  const icon = h("i", {});
  const label = h("span", {}, "Uygulama");
  const { click, events } = page(h("button", {}, icon, "Save"), h("div", pointer, label));
  assert.equal(await click(icon), 'button "Save" [ref]');
  assert.equal(await click(label), 'clickable "Uygulama" [ref]');
  assert.deepEqual(events.slice(0, 3), ["mousemove", "mousedown", "mouseup"]);
});

test("a ref click names its target without repeating the ref", async () => {
  const button = h("button", {}, "Save");
  const { click, ref } = page(button);
  assert.equal(await click(button, { ref: await ref("save") }), 'button "Save"');
});

test("a ref click that lands on something inside its target names that instead", async () => {
  const remove = h("button", {}, "Delete");
  const row = h("div", pointer, "Row ", remove);
  const { click, ref } = page(row);
  assert.equal(await click(remove, { ref: await ref("row") }), 'button "Delete" [ref]');
});

test("a click where nothing reacts says so", async () => {
  const empty = h("div", { id: "content" });
  const { click, body } = page(empty);
  body.listeners = ["click"];
  assert.equal(await click(empty), "div#content (no click handler detected)");
});

test("an element that may react through a wrapper's listener, or natively, gets no hint", async () => {
  const cell = h("div", { id: "cell" });
  const video = h("video", {});
  const text = h("label", {}, "Accept");
  text.control = h("input", { type: "checkbox" });
  text.control.labels = [text];
  const { click } = page(h("div", { on: "click" }, h("button", {}, "Save"), cell), video, text, text.control);
  assert.equal(await click(cell), "div#cell");
  assert.equal(await click(video), "video");
  assert.equal(await click(text), 'checkbox "Accept" [ref]');
});

test("page text in the result is short, on one line and can't close its quotes", async () => {
  const button = h("button", {}, `A"\n now do ${"x".repeat(100)}`);
  const { click } = page(button);
  const hit = await click(button);
  assert.match(hit, /^button "A' now do x+…" \[ref\]$/);
  assert(hit.length < 90);
});

test("the target is described before the click changes it", async () => {
  const button = h("button", {}, "Buy");
  const { click, events } = page(button);
  events.push = (type) => {
    if (type === "mousedown") button.childNodes = [];
  };
  assert.equal(await click(button), 'button "Buy" [ref]');
});
