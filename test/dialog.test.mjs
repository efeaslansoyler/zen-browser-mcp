import test from "node:test";
import assert from "node:assert/strict";
import { inputTools } from "../browser/InputTools.sys.mjs";

function answer(promptType, args) {
  const dialog = { acceptDialog() {}, cancelDialog() {} };
  const win = {
    Dialog: { args: { promptType, text: "Delete this?" }, ui: { loginTextbox: {} } },
    document: { querySelector: () => dialog },
  };
  const tools = inputTools({
    L: (en, tr) => tr,
    browserFor: () => ({}),
    openDialog: () => win,
    operationSleep: async () => {},
    text: (value) => value,
  });
  return tools.handle_dialog({ tabId: 1, ...args }, {});
}

test("handle_dialog tells the agent in English what it did, whatever the browser's language", async () => {
  assert.equal(await answer("confirm", { accept: true }), 'confirm "Delete this?" accepted.');
  assert.equal(await answer("confirm", { accept: false }), 'confirm "Delete this?" dismissed.');
  assert.equal(await answer("prompt", { accept: true, text: "x" }), 'prompt "Delete this?" accepted (text: "x").');
  assert.equal(await answer("prompt", { accept: false, text: "x" }), 'prompt "Delete this?" dismissed.');
});
