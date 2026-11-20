// why: Shared activity needs only who acted, when, and whether they might have changed the page.
const MAX_EVENTS = 200;
const MAX_AGE = 60 * 60 * 1000;

export class TabActivity {
  #events = new Map();
  #seen = new Map();
  #next = 1; // why: Multiple actions can share a timestamp, so a sequence number supplies a total order.

  record(tabId, session, write, now = Date.now()) {
    const events = (this.#events.get(tabId) ?? []).filter((event) => now - event.t < MAX_AGE);
    events.push({ session, n: this.#next++, t: now, write });
    this.#events.set(tabId, events.slice(-MAX_EVENTS));
  }

  // why: A session that never read the page has no stale reference context to invalidate.
  since(tabId, session) {
    const seen = this.#seen.get(tabId)?.get(session);
    const others = new Map();
    let changed = false;
    for (const event of this.#events.get(tabId) ?? []) {
      if (event.session === session) continue;
      if (event.n > (seen?.call ?? 0)) {
        const other = others.get(event.session) ?? { actions: 0, last: 0 };
        other.actions++;
        other.last = event.t;
        others.set(event.session, other);
      }
      if (event.write && seen?.read != null && event.n > seen.read) changed = true;
    }
    return { others, changed };
  }

  seen(tabId, session, read) {
    if (!this.#seen.has(tabId)) this.#seen.set(tabId, new Map());
    const previous = this.#seen.get(tabId).get(session);
    const now = this.#next - 1;
    this.#seen.get(tabId).set(session, { call: now, read: read ? now : (previous?.read ?? null) });
  }

  forget(tabId) {
    this.#events.delete(tabId);
    this.#seen.delete(tabId);
  }
}
