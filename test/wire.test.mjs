import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { call } from '../dist/zen.js';

test('wire carries identity and preserves partial batch failures', async (t) => {
  let request;
  const socket = new EventEmitter();
  socket.setTimeout = () => socket;
  socket.end = () => socket.emit('close');
  socket.write = packet => {
    request = JSON.parse(packet);
    queueMicrotask(() => socket.emit('data', Buffer.from(JSON.stringify({ ok: true, content: [{ type: 'text', text: 'partial results' }], isError: true }) + '\n')));
  };
  t.mock.method(net, 'createConnection', () => {
    queueMicrotask(() => socket.emit('connect'));
    return socket;
  });
  const result = await call('browser_batch', { actions: [] }, 1000, { id: 'codex', name: 'Codex' });
  assert.deepEqual(request.agent, { id: 'codex', name: 'Codex' });
  assert.equal(typeof request.session, 'string');
  assert.equal(result.isError, true);
  assert.equal(result[0].text, 'partial results');
});

test('an empty closed browser connection rejects instead of hanging', async (t) => {
  const socket = new EventEmitter();
  socket.setTimeout = () => socket;
  socket.write = () => queueMicrotask(() => socket.emit('close'));
  t.mock.method(net, 'createConnection', () => {
    queueMicrotask(() => socket.emit('connect'));
    return socket;
  });
  await assert.rejects(call('ping'), /closed the connection without a reply/);
});

for (const fail of [false, true]) {
  test(`subscription acknowledges delivery only after handler settles (failure=${fail})`, async (t) => {
    const { subscribe } = await import('../dist/zen.js');
    const writes = [];
    const socket = new EventEmitter();
    socket.destroyed = false;
    socket.write = packet => writes.push(JSON.parse(packet));
    socket.destroy = () => { socket.destroyed = true; socket.emit('close'); };
    t.mock.method(net, 'createConnection', () => {
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    });
    let complete, reject;
    const delivery = new Promise((resolve, fail) => { complete = resolve; reject = fail; });
    const sub = subscribe(() => delivery, { cwd: '/project', ack: true, agent: { id: 'codex', name: 'Codex' } });
    try {
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(writes[0].args.ack, true);
      socket.emit('data', Buffer.from('{"event":"channel","id":"receipt","content":"test"}\n'));
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(writes.length, 1, 'no premature acknowledgement');
      if (fail) reject(new Error('queue denied')); else complete();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(writes[1].event, 'delivery');
      assert.equal(writes[1].id, 'receipt');
      assert.equal(writes[1].ok, !fail);
      if (fail) assert.equal(writes[1].error, 'queue denied');
    } finally { sub.close(); }
  });
}
