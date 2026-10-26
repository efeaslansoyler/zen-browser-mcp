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
