// FIFO locks by key. Tool calls take the locks of the tabs they touch, so calls on one tab run
// in order while calls on different tabs run side by side. A request queues on all its keys in
// one synchronous step: every lane sees requests in arrival order, so two requests can never
// wait for each other.
export class Locks {
  #tails = new Map(); // key → promise that resolves when the last queued holder releases

  // Queues on every key at once. ready resolves when all are held; release frees them and may be
  // called at any time (also before ready, when the waiter gives up).
  acquire(keys) {
    const waits = [];
    const releases = [];
    for (const key of new Set(keys)) {
      const previous = this.#tails.get(key) ?? Promise.resolve();
      let release;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      const tail = previous.then(() => held);
      this.#tails.set(key, tail);
      waits.push(previous);
      releases.push(() => {
        release();
        tail.then(() => {
          if (this.#tails.get(key) === tail) this.#tails.delete(key);
        });
      });
    }
    let released = false;
    return {
      ready: Promise.all(waits).then(() => {}),
      release: () => {
        if (released) return;
        released = true;
        for (const free of releases) free();
      },
    };
  }

  // Whether anyone holds or waits for key.
  busy(key) {
    return this.#tails.has(key);
  }
}
