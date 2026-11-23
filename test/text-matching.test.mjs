import test from "node:test";
import assert from "node:assert/strict";
import { h, page } from "./support/dom.mjs";

test("a text condition treats every form of the letter i alike and keeps other letters apart", async () => {
  const { send } = page("Cell WIFI, İSTANBUL, ISPARTA, Günlük");
  for (const text of ["cell wifi", "Cell WIFI", "istanbul", "Isparta", "ısparta", "günlük"])
    assert.equal(await send("check", { text }), true, text);
  assert.equal(await send("check", { text: "gunluk" }), false);
});

test("find matches capital I in a control's name", async () => {
  const { find } = page(h("button", {}, "WIFI"));
  assert.match((await find("wifi"))[0], /^button "WIFI"/);
});

test("a select option is chosen by its exact text before one that only matches folded", async () => {
  const select = h("select", { "aria-label": "Temperature" });
  select.selectedOptions = [];
  select.options = [
    { value: "1", text: "ILIK" },
    { value: "2", text: "ılık" },
  ];
  const { send } = page(select);
  const ref = (await send("find", { query: "temperature" }))[0].line.match(/ref_\w+/)[0];
  await send("form_input", { ref, value: "ılık" });
  assert.equal(select.value, "2");
  await send("form_input", { ref, value: "ilik" });
  assert.equal(select.value, "1");
});
