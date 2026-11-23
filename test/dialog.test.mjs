import test from "node:test";
import assert from "node:assert/strict";
import { inputTools } from "../browser/InputTools.sys.mjs";

function answer(promptType, args, after = [null]) {
  const win = {
    Dialog: { args: { promptType, text: "Delete this?" }, ui: { loginTextbox: {} } },
    document: { querySelector: () => ({ acceptDialog() {}, cancelDialog() {} }) },
  };
  let open = win;
  let sleeps = 0;
  const tools = inputTools({
    L: (en, tr) => tr,
    browserFor: () => ({}),
    openDialog: () => open,
    operationSleep: async () => {
      const next = after[Math.min(sleeps++, after.length - 1)];
      open = next === "same" ? win : next;
    },
    text: (value) => value,
  });
  return tools.handle_dialog({ tabId: 1, ...args }, {}).then((result) => {
    assert.notEqual(open, win, "returned while the dialog was open");
    return result;
  });
}

test("handle_dialog tells the agent in English what it did, whatever the browser's language", async () => {
  assert.equal(await answer("confirm", { accept: true }), 'confirm "Delete this?" accepted.');
  assert.equal(await answer("confirm", { accept: false }), 'confirm "Delete this?" dismissed.');
  assert.equal(await answer("prompt", { accept: true, text: "x" }), 'prompt "Delete this?" accepted (text: "x").');
  assert.equal(await answer("prompt", { accept: false, text: "x" }), 'prompt "Delete this?" dismissed.');
});

test("handle_dialog waits until the dialog it answered is gone, not one opened after it", async () => {
  const slow = Array(10).fill("same");
  assert.equal(await answer("alert", { accept: true }, [...slow, null]), 'alert "Delete this?" accepted.');
  const another = { Dialog: { args: { promptType: "prompt", text: "Name?" } } };
  assert.equal(await answer("alert", { accept: true }, [...slow, another]), 'alert "Delete this?" accepted.');
});

test("handle_dialog doesn't claim success when the dialog stays open", async () => {
  await assert.rejects(answer("confirm", { accept: true }, ["same"]), /confirm "Delete this\?" is still open/);
});
