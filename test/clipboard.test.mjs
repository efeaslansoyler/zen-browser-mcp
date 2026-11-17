import test from 'node:test';
import assert from 'node:assert/strict';
import { ClipboardAccess, clipboardShortcut } from '../browser/Clipboard.sys.mjs';

function fixture(answer = true) {
  let value = 'private initial text', version = 1;
  const calls = [];
  const env = {
    check: context => { if (context && version !== context.version) throw new Error('target changed'); },
    prepare: async () => ({ version }),
    ask: async args => { calls.push(`ask:${args.action}`); return typeof answer === 'function' ? answer() : answer; },
    read: () => { calls.push('read'); return value; },
    write: text => { calls.push('write'); value = text; },
    command: args => { calls.push(args.action); },
  };
  return { access: new ClipboardAccess(env), calls, env, change: () => version++, get value() { return value; } };
}

test('all clipboard operations need explicit consent before touching the native clipboard', async () => {
  for (const action of ['read', 'write', 'copy', 'paste', 'cut']) {
    const h = fixture(false);
    await assert.rejects(h.access.run({ action, text: 'replacement' }), /denied|did not answer/);
    assert.deepEqual(h.calls, [`ask:${action}`]); assert.equal(h.value, 'private initial text');
  }
});

test('read is bounded and untrusted; write reports length without echoing contents', async () => {
  const h = fixture();
  assert.deepEqual(await h.access.run({ action: 'read', max_chars: 7 }), { source: 'system clipboard', untrusted: true, text: 'private', characters: 20, truncated: true });
  assert.deepEqual(await h.access.run({ action: 'write', text: '' }), { written: true, characters: 0 });
  assert.equal(h.value, '');
  await h.access.run({ action: 'read' });
  assert.equal(h.calls.filter(c => c.startsWith('ask')).length, 3, 'There is no cached or batch-wide consent');
});

test('target changes during approval abort before clipboard effects', async () => {
  const h = fixture(() => { h.change(); return true; });
  await assert.rejects(h.access.run({ action: 'write', text: 'never' }), /changed/);
  assert.deepEqual(h.calls, ['ask:write']);
});

test('invalid requests fail before asking or accessing clipboard', async () => {
  for (const args of [{ action: 'unknown' }, { action: 'write' }, { action: 'read', max_chars: 0 }]) {
    const h = fixture(); await assert.rejects(h.access.run(args)); assert.deepEqual(h.calls, []);
  }
});

test('standard clipboard shortcuts are recognized without treating ordinary keys as clipboard access', () => {
  for (const [key, mods, action] of [['c', { ctrlKey: true }, 'copy'], ['V', { metaKey: true }, 'paste'],
    ['x', { ctrlKey: true }, 'cut'], ['KEY_Insert', { ctrlKey: true }, 'copy'],
    ['KEY_Insert', { shiftKey: true }, 'paste'], ['KEY_Delete', { shiftKey: true }, 'cut']]) {
    assert.equal(clipboardShortcut({ key, mods }), action);
  }
  for (const [key, mods] of [['c', {}], ['a', { ctrlKey: true }], ['c', { ctrlKey: true, altKey: true }]]) assert.equal(clipboardShortcut({ key, mods }), null);
});
