import test from "node:test";
import assert from "node:assert/strict";
import { loadActor } from "./support/actor.mjs";

function page(innerText, elements = []) {
  const actor = new (loadActor())();
  const node = (tagName, props = {}) => ({
    nodeType: 1,
    tagName,
    localName: tagName.toLowerCase(),
    isConnected: true,
    getAttribute: (key) => props.attrs?.[key] ?? null,
    hasAttribute: (key) => key in (props.attrs ?? {}),
    checkVisibility: () => true,
    getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 10, right: 10 }),
    querySelector: () => null,
    dispatchEvent() {},
    ...props,
  });
  const nodes = elements.map(([tag, props]) => node(tag, props));
  actor.browsingContext = { id: 1 };
  actor.contentWindow = { innerWidth: 800, innerHeight: 600, Event: class {} };
  actor.document = {
    body: { ...node("BODY", { innerText }), querySelectorAll: () => nodes },
    getElementById: () => null,
  };
  const send = async (name, data) => {
    const result = await actor.receiveMessage({ name, data });
    assert(!result.error, result.error);
    return result.value;
  };
  return { nodes, send, find: async (query) => (await send("find", { query })).map((hit) => hit.line) };
}

test("a text condition treats every form of the letter i alike and keeps other letters apart", async () => {
  const { send } = page("Cell WIFI, İSTANBUL, ISPARTA, Günlük");
  for (const text of ["cell wifi", "Cell WIFI", "istanbul", "Isparta", "ısparta", "günlük"])
    assert.equal(await send("check", { text }), true, text);
  assert.equal(await send("check", { text: "gunluk" }), false);
});

test("find matches capital I in a control's name", async () => {
  const { find } = page("", [["BUTTON", { innerText: "WIFI" }]]);
  assert.match((await find("wifi"))[0], /^button "WIFI"/);
});

test("a select option is chosen by its exact text before one that only matches folded", async () => {
  const options = [
    { value: "1", text: "ILIK" },
    { value: "2", text: "ılık" },
  ];
  const { nodes, send, find } = page("", [
    ["SELECT", { options, selectedOptions: [], attrs: { "aria-label": "Temperature" } }],
  ]);
  const ref = (await find("temperature"))[0].match(/ref_\d+/)[0];
  await send("form_input", { ref, value: "ılık" });
  assert.equal(nodes[0].value, "2");
  await send("form_input", { ref, value: "ilik" });
  assert.equal(nodes[0].value, "1");
});
