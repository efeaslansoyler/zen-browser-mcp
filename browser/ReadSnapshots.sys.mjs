// Deltas refer to the exact text previously returned, never to a hidden DOM snapshot.
export function sameReadContext(a, b) {
  return !!a && !!b && a.url === b.url && a.ownerVersion === b.ownerVersion &&
    a.frames.length === b.frames.length && a.frames.every(([id, document], i) =>
      id === b.frames[i][0] && document === b.frames[i][1]);
}

// Bounded Myers line diff. Exhausting the budget returns null (caller sends full text).
export function linePatch(before, after, budget = 200_000) {
  const a = before.split('\n'), b = after.split('\n');
  let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - suffix - 1] === b[b.length - suffix - 1]) suffix++;
  const left = a.slice(prefix, a.length - suffix), right = b.slice(prefix, b.length - suffix);
  const v = new Map([[1, 0]]), trace = [];
  let edits;
  search: for (let d = 0; d <= left.length + right.length; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      if (--budget < 0) return null;
      let x = k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1)) ? v.get(k + 1) : v.get(k - 1) + 1;
      let y = x - k;
      while (x < left.length && y < right.length && left[x] === right[y]) {
        if (--budget < 0) return null;
        x++; y++;
      }
      v.set(k, x);
      if (x >= left.length && y >= right.length) {
        edits = [];
        for (let depth = d; depth >= 0; depth--) {
          const previous = trace[depth], diagonal = x - y;
          const from = diagonal === -depth || (diagonal !== depth && (previous.get(diagonal - 1) ?? -1) < (previous.get(diagonal + 1) ?? -1)) ? diagonal + 1 : diagonal - 1;
          const oldX = previous.get(from) ?? 0, oldY = oldX - from;
          while (x > oldX && y > oldY) { edits.push([' ', left[--x]]); y--; }
          if (depth > 0) {
            if (x === oldX) edits.push(['+', right[--y]]);
            else edits.push(['-', left[--x]]);
          }
        }
        edits.reverse();
        break search;
      }
    }
  }
  const operations = [
    ...a.slice(0, prefix).map(line => [' ', line]), ...edits,
    ...a.slice(a.length - suffix).map(line => [' ', line]),
  ];
  const hunks = [];
  for (let i = 0; i < operations.length; i++) {
    if (operations[i][0] === ' ') continue;
    const start = Math.max(0, i - 1), end = Math.min(operations.length, i + 2);
    const last = hunks.at(-1);
    if (last && start <= last[1]) last[1] = end;
    else hunks.push([start, end]);
  }
  const lines = [];
  let oldLine = 1, newLine = 1, cursor = 0;
  for (const [start, end] of hunks) {
    for (; cursor < start; cursor++) {
      if (operations[cursor][0] !== '+') oldLine++;
      if (operations[cursor][0] !== '-') newLine++;
    }
    const chunk = operations.slice(start, end);
    const oldCount = chunk.filter(([kind]) => kind !== '+').length;
    const newCount = chunk.filter(([kind]) => kind !== '-').length;
    lines.push(`@@ -${oldCount ? oldLine : oldLine - 1},${oldCount} +${newCount ? newLine : newLine - 1},${newCount} @@`,
      ...chunk.map(([kind, line]) => kind + line));
    for (; cursor < end; cursor++) {
      if (operations[cursor][0] !== '+') oldLine++;
      if (operations[cursor][0] !== '-') newLine++;
    }
  }
  return lines.join('\n');
}

export class ReadSnapshots {
  constructor({ maxEntries = 32, maxChars = 2_000_000, maxSnapshotChars = 200_000, budget = 200_000 } = {}) {
    this.entries = new Map();
    this.chars = 0;
    this.maxEntries = maxEntries;
    this.maxChars = maxChars;
    this.maxSnapshotChars = maxSnapshotChars;
    this.budget = budget;
    this.prefix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    this.next = 0;
  }
  delete(key) {
    const entry = this.entries.get(key);
    if (entry) this.chars -= entry.text.length;
    this.entries.delete(key);
  }
  clearTab(tabId) {
    for (const [key, entry] of this.entries) if (entry.tabId === tabId) this.delete(key);
  }
  clearSession(session) {
    for (const [key, entry] of this.entries) if (entry.session === session) this.delete(key);
  }
  render({ session, tabId, scope, context, currentContext = context, text, diff = false, since }) {
    if (!sameReadContext(context, currentContext)) {
      this.clearTab(tabId);
      throw new Error('The page or one of its frames changed while reading. Retry the read; no snapshot was saved.');
    }
    if (!diff) return text; // Existing clients keep their original response format.
    const key = JSON.stringify([session, tabId, scope]);
    const previous = this.entries.get(key);
    let reason = !previous ? 'no-baseline' : !sameReadContext(previous.context, context) ? 'document-or-owner-changed' :
      !since ? 'no-base-id' : since !== previous.id ? 'base-unavailable' : null;
    if (!reason && previous.text === text) {
      this.entries.delete(key); this.entries.set(key, previous);
      return `snapshot: ${previous.id}\nmode: unchanged\nNo changes in this read scope.`;
    }
    if (text.length > this.maxSnapshotChars || text.length > this.maxChars || context.frames.length > 256 || this.maxEntries < 1) reason = 'not-cached; use a smaller read scope';
    const id = `${this.prefix}-${++this.next}`;
    const full = why => `snapshot: ${id}\nmode: full (${why})\n\n${text}`;
    let result;
    if (!reason) {
      const patch = linePatch(previous.text, text, this.budget);
      const delta = patch == null ? null : `snapshot: ${id}\nbase: ${previous.id}\nmode: diff (unified lines)\n\n${patch}`;
      if (delta != null && delta.length < full('diff-larger').length) result = delta;
      else reason = patch == null ? 'diff-budget' : 'diff-larger';
    }
    this.delete(key);
    if (text.length > this.maxSnapshotChars || text.length > this.maxChars || context.frames.length > 256 || this.maxEntries < 1) {
      return full('not-cached; use a smaller read scope');
    }
    this.entries.set(key, { session, tabId, context, text, id });
    this.chars += text.length;
    while (this.entries.size > this.maxEntries || this.chars > this.maxChars) this.delete(this.entries.keys().next().value);
    return result || full(reason);
  }
}
