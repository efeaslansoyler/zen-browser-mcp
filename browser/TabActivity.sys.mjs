// What the sessions in a shared tab did, so each one can be told what the others did since its
// own last call ("meanwhile"), and whether the page may have changed since it last read it.
// Only which session acted, when, and whether the action could change the page are kept: no
// values, no page contents. Kept in memory; a bridge reload starts empty.
const MAX_EVENTS = 200; // per tab
const MAX_AGE = 60 * 60 * 1000;

export class TabActivity {
  #events = new Map(); // tabId → [{ session, n, t, write }]
  #seen = new Map(); // tabId → Map(session → { call, read }): event numbers at its last call and read
  #next = 1; // orders events (several can share a millisecond)

  // A call of session acted in the tab; write: it could have changed the page.
  record(tabId, session, write, now = Date.now()) {
    const events = (this.#events.get(tabId) ?? []).filter((event) => now - event.t < MAX_AGE);
    events.push({ session, n: this.#next++, t: now, write });
    this.#events.set(tabId, events.slice(-MAX_EVENTS));
  }

  // What the other sessions did since session's last call in the tab: for each, how many
  // actions and when the last one was; changed: one of them may have changed the page since
  // session last read it (null when it never read it, so it has no old refs).
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

  // session's call in the tab ended; read: it read the page in this call.
  seen(tabId, session, read) {
    if (!this.#seen.has(tabId)) this.#seen.set(tabId, new Map());
    const previous = this.#seen.get(tabId).get(session);
    const now = this.#next - 1;
    this.#seen.get(tabId).set(session, { call: now, read: read ? now : (previous?.read ?? null) });
  }

  // The tab went back to the user or closed.
  forget(tabId) {
    this.#events.delete(tabId);
    this.#seen.delete(tabId);
  }
}
