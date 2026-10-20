// Best-effort inspection of committed DOM-backed React fibers. No hook installation,
// renderer calls, component invocation or writes to the application's objects.
const own = (object, key) => {
  if (!object || !['object', 'function'].includes(typeof object)) return undefined;
  try { return Object.getOwnPropertyDescriptor(object, key)?.value; } catch { return undefined; }
};
const keys = object => { try { return Object.keys(object); } catch { return []; } };

export function safePreview(value, depth = 0, seen = new Set(), budget = { left: 200 }) {
  if (--budget.left < 0) return '[Truncated]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length > 300 ? value.slice(0, 300) + '…' : value;
  if (typeof value === 'function') return '[Function]';
  if (typeof value !== 'object') return `[${typeof value}]`;
  if (seen.has(value)) return '[Circular]';
  if (depth >= 3) return '[Object]';
  seen.add(value);
  const result = Object.create(null);
  for (const key of keys(value).slice(0, 20)) {
    if (key === 'children') { result[key] = '[React children]'; continue; }
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch { continue; }
    result[key] = descriptor && 'value' in descriptor
      ? safePreview(descriptor.value, depth + 1, seen, budget) : '[Getter]';
  }
  if (keys(value).length > 20) result['…'] = '[More properties]';
  seen.delete(value);
  return result;
}

function fiberAt(element, unwrap) {
  for (let el = element, count = 0; el && count++ < 100; el = el.parentElement || el.getRootNode?.().host) {
    const raw = unwrap(el);
    const key = keys(raw).find(key => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'));
    if (key) return own(raw, key);
  }
  return null;
}

function component(fiber, includeProps) {
  const type = own(fiber, 'type');
  if (!type || typeof type === 'string') return null;
  const inner = own(type, 'render') || own(type, 'type');
  const name = own(type, 'displayName') || own(type, 'name') || own(inner, 'displayName') || own(inner, 'name');
  // Fragment, root and other structural fibers are not user components.
  if (typeof type !== 'function' && typeof type !== 'object') return null;
  const out = { name: typeof name === 'string' ? name.slice(0, 200) : 'Anonymous', tag: own(fiber, 'tag') };
  const source = own(fiber, '_debugSource');
  if (source) out.source = safePreview(source);
  if (includeProps) out.props = safePreview(own(fiber, 'memoizedProps'));
  return out;
}

function committedFiber(fiber) {
  const ancestors = new Set();
  let root = fiber;
  while (root && own(root, 'return') && ancestors.size < 1000 && !ancestors.has(root)) {
    ancestors.add(root); root = own(root, 'return');
  }
  const current = own(own(root, 'stateNode'), 'current');
  if (!current) return fiber;
  const alternate = own(fiber, 'alternate'), stack = [current], visited = new Set();
  while (stack.length && visited.size < 20000) {
    const node = stack.pop();
    if (!node || visited.has(node)) continue;
    if (node === fiber || node === alternate) return node;
    visited.add(node);
    stack.push(own(node, 'sibling'), own(node, 'child'));
  }
  return null;
}

export function inspectReact({ document, element, unwrap = value => value, refFor = () => undefined,
  action = 'tree', max_depth = 12, max_nodes = 100, include_props = false }) {
  if (!['tree', 'inspect'].includes(action)) throw new Error('Unknown React action.');
  const limit = Math.max(1, Math.min(300, max_nodes));
  const depthLimit = Math.max(1, Math.min(30, max_depth));
  const roots = [], seenRoots = new Set();
  let scanned = 0, scanTruncated = false;
  const add = fiber => {
    const visited = new Set();
    while (fiber && own(fiber, 'return') && visited.size < 1000 && !visited.has(fiber)) {
      visited.add(fiber); fiber = own(fiber, 'return');
    }
    // React keeps alternate trees; always prefer the committed root when available.
    fiber = own(own(fiber, 'stateNode'), 'current') || fiber;
    if (fiber && !seenRoots.has(fiber)) { roots.push(fiber); seenRoots.add(fiber); }
  };
  if (action === 'inspect') {
    if (!element) throw new Error('React inspect requires an element ref.');
    let fiber = committedFiber(fiberAt(element, unwrap));
    const chain = [], visited = new Set();
    while (fiber && visited.size < 1000 && !visited.has(fiber)) {
      visited.add(fiber);
      const item = component(fiber, include_props);
      if (item) chain.push(item);
      fiber = own(fiber, 'return');
    }
    return { detected: chain.length > 0, action, ref: refFor(element),
      components: chain.slice(0, limit).reverse(), truncated: chain.length > limit,
      note: 'Best-effort private React fiber data; names may be minified, server-only components are unavailable.' };
  }
  const scan = root => {
    const walker = document.createTreeWalker(root, 1);
    let el = root;
    do {
      if (++scanned > 20000) { scanTruncated = true; break; }
      const raw = unwrap(el);
      for (const key of keys(raw)) {
        if (key.startsWith('__reactContainer$')) add(own(raw, key));
        if (key.startsWith('__reactFiber$')) add(own(raw, key));
      }
      if (el.shadowRoot) scan(el.shadowRoot);
    } while ((el = walker.nextNode()));
  };
  if (!document.documentElement) throw new Error('Document is still loading; retry React inspection.');
  scan(document.documentElement);
  const nodes = [], visited = new Set(), stack = roots.map(fiber => ({ fiber, depth: 0, parent: null })).reverse();
  let truncated = scanTruncated;
  while (stack.length) {
    if (visited.size >= 20000 || nodes.length >= limit) { truncated = true; break; }
    const { fiber, depth, parent } = stack.pop();
    if (!fiber || visited.has(fiber)) continue;
    visited.add(fiber);
    const sibling = own(fiber, 'sibling');
    if (sibling) stack.push({ fiber: sibling, depth, parent });
    const item = component(fiber, include_props);
    let childParent = parent, childDepth = depth;
    if (item) {
      item.id = nodes.length + 1; item.parent = parent; item.depth = depth;
      nodes.push(item); childParent = item.id; childDepth++;
    }
    const child = own(fiber, 'child');
    if (child && childDepth < depthLimit) stack.push({ fiber: child, depth: childDepth, parent: childParent });
    else if (child) truncated = true;
  }
  return { detected: roots.length > 0, action, roots: roots.length, components: nodes, truncated,
    note: 'Committed DOM-backed React tree only. Private fiber format is version-dependent; server-only components and render history are unavailable.' };
}
