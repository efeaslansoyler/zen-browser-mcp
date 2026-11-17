import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { Cancellation } from '../browser/Cancellation.sys.mjs';
const source = fs.readFileSync(new URL('../browser/main.js', import.meta.url), 'utf8');
const start = source.indexOf('    async function askIsland(');
const end = source.indexOf('    // bekleyen ask_user', start);

test('shared island permission rejects with denial notes, records approval notes and always cleans up', async () => {
  let answer, ended = 0;
  const operation = { userNotes: [] };
  const context = vm.createContext({ Cancellation, operation, setTimeout, clearTimeout,
    guard: promise => promise, notifyAsk: () => false,
    island: { ask: () => answer(), askEnded: () => ended++ }, cancelAsk() {},
  });
  vm.runInContext(source.slice(start, end), context);
  const browser = {};
  answer = () => context.answerIsland(browser, 'cancelled', 'Use a different tab');
  await assert.rejects(context.askIsland(browser, '', '', {}, 1), /User message .*"Use a different tab"/);
  answer = () => context.answerIsland(browser, 'cancelled');
  assert.equal(await context.askIsland(browser, '', '', {}, 1), 'cancelled');
  answer = () => context.answerIsland(browser, 'done', ' Only the title ');
  assert.equal(await context.askIsland(browser, '', '', {}, 1), 'done');
  assert.deepEqual(operation.userNotes, ['Only the title']);
  assert.equal(ended, 3);
});

test('tab-less ask_user answers carry the choice and end on answer, replacement and timeout', async () => {
  const context = vm.createContext({ Cancellation, operation: null, setTimeout, clearTimeout,
    guard: promise => promise, notifyAsk: () => false,
    island: { ask() {}, askEnded() {} }, cancelAsk() { throw new Error('no page to cancel'); },
  });
  vm.runInContext(source.slice(start, end), context);
  const helperStart = source.indexOf('    async function waitIslandAnswer(');
  vm.runInContext(source.slice(helperStart, source.indexOf('    // ask_user gelince', helperStart)), context);

  let pending = context.waitIslandAnswer(5);
  context.answerIsland(null, 'done', ' bigger ', 'Blue');
  assert.deepEqual({ ...await pending }, { status: 'done', choice: 'Blue', message: 'bigger' });

  pending = context.waitIslandAnswer(5);
  context.answerIsland(null, 'cancelled');
  assert.equal(await pending, 'cancelled');

  const first = context.waitIslandAnswer(5);
  const second = context.waitIslandAnswer(5);
  assert.equal(await first, 'replaced');
  context.answerIsland(null, 'done', '', 'A');
  assert.deepEqual({ ...await second }, { status: 'done', choice: 'A' });

  assert.equal(await context.waitIslandAnswer(0.01), 'timeout');
});
