export class Locks {
  #tails = new Map();

  // why: A canceled waiter must release its place in every lane even before acquiring the locks.
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

  busy(key) {
    return this.#tails.has(key);
  }
}
