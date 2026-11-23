const KEPT_PER_TAB = 10;

// why: A coordinate means nothing without the image it was read from; each session sees only its own images.
export class ScreenshotHistory {
  constructor(entries = new Map(), counter = { next: 1 }) {
    this.entries = entries;
    this.counter = counter;
  }

  // why: A call reads coordinates against the images it could have seen, not ones taken while it runs.
  snapshot() {
    return new ScreenshotHistory(new Map(this.entries));
  }

  add(session, tabId, { scale, width, height }) {
    const key = `${tabId}:${session}`;
    const shot = { id: `shot_${this.counter.next++}`, scale, size: `${width}x${height}` };
    const shots = [...(this.entries.get(key)?.shots ?? []), shot].slice(-KEPT_PER_TAB);
    this.entries.set(key, { session, tabId, shots });
    return shot.id;
  }

  scale(session, tabId, id) {
    const shots = this.entries.get(`${tabId}:${session}`)?.shots ?? [];
    if (id != null) {
      const named = shots.find((shot) => shot.id === id);
      if (!named)
        throw new Error(
          `${id} is not one of your recent viewport screenshots of this tab from before this call. Take a new screenshot.`,
        );
      return named.scale;
    }
    const [previous, last] = shots.length > 1 ? shots.slice(-2) : [null, shots[0]];
    if (previous && previous.scale !== last.scale)
      throw new Error(
        `Your last two screenshots of this tab have different scales (${previous.id} ${previous.size}, ${last.id} ${last.size}), so the coordinate is ambiguous. Pass screenshot with the ID of the image it comes from. No input was sent.`,
      );
    return last?.scale ?? 1;
  }

  #clear(drop) {
    for (const [key, entry] of this.entries) if (drop(entry)) this.entries.delete(key);
  }
  clearTab(tabId) {
    this.#clear((entry) => entry.tabId === tabId);
  }
  clearSession(session) {
    this.#clear((entry) => entry.session === session);
  }
}
