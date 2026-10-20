import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectReact, safePreview } from '../browser/ReactInspect.sys.mjs';

function fixture() {
  const root = { tag: 3 }, host = { tag: 5, type: 'button', return: null };
  const app = { tag: 0, type: function App() {}, memoizedProps: { title: 'Hello' }, return: root, child: host };
  root.child = app; host.return = app; root.stateNode = { current: root };
  const element = { '__reactFiber$fixture': host };
  const document = { documentElement: element, createTreeWalker: () => ({ nextNode: () => null }) };
  return { root, app, host, element, document };
}
test('React tree reads the committed root and props only when requested', () => {
  const h = fixture();
  const alternate = { ...h.root, child: { type: function Stale() {} } };
  h.app.return = alternate;
  const result = inspectReact(h);
  assert.equal(result.detected, true);
  assert.equal(result.components[0].name, 'App');
  assert.equal(result.components[0].props, undefined);
  assert.equal(inspectReact({ ...h, include_props: true }).components[0].props.title, 'Hello');
});
test('React inspect follows ancestors, supports memo/forwardRef and never calls getters', () => {
  const h = fixture(); let calls = 0;
  h.app.type = { render: function Forwarded() {} };
  Object.defineProperty(h.app.memoizedProps, 'danger', { enumerable: true, get() { calls++; throw Error(); } });
  const result = inspectReact({ ...h, action: 'inspect', include_props: true, refFor: () => 'ref_1' });
  assert.equal(result.ref, 'ref_1');
  assert.equal(result.components[0].name, 'Forwarded');
  assert.equal(result.components[0].props.danger, '[Getter]');
  assert.equal(calls, 0);
});
test('React traversal handles cyclic fibers, depth and node limits', () => {
  const h = fixture();
  h.app.sibling = { type: function Second() {}, return: h.root, child: null };
  h.host.child = h.app;
  const result = inspectReact({ ...h, max_nodes: 1 });
  assert.equal(result.components.length, 1); assert(result.truncated);
  assert(inspectReact({ ...h, max_depth: 1 }).truncated);
});
test('Missing React and stale inspect inputs do not fabricate components', () => {
  const document = { documentElement: {}, createTreeWalker: () => ({ nextNode: () => null }) };
  assert.equal(inspectReact({ document }).detected, false);
  assert.throws(() => inspectReact({ document, action: 'inspect' }), /requires/);
});
test('Props previews bound cycles, nesting, strings and functions', () => {
  const props = { text: 'x'.repeat(1000), fn() {}, children: {}, nested: {} }; props.self = props;
  const result = safePreview(props);
  assert.equal(result.self, '[Circular]'); assert.equal(result.fn, '[Function]');
  assert.equal(result.children, '[React children]'); assert.equal(result.text.length, 301);
});
