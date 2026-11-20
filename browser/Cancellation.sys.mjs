// why: A cancellation scope cannot resume after cancellation.
export class Cancellation {
  #error = null;
  #listeners = new Set();
  check() {
    if (this.#error) throw this.#error;
  }
  onCancel(callback) {
    if (this.#error) {
      callback(this.#error);
      return () => {};
    }
    this.#listeners.add(callback);
    return () => this.#listeners.delete(callback);
  }
  cancel(error = new Error("Browser operation cancelled.")) {
    if (this.#error) return;
    this.#error = error;
    for (const callback of this.#listeners) {
      try {
        callback(error);
      } catch {}
    }
    this.#listeners.clear();
  }
  async race(promise) {
    this.check();
    let off;
    try {
      const value = await Promise.race([
        promise,
        new Promise((_, reject) => {
          off = this.onCancel(reject);
        }),
      ]);
      this.check();
      return value;
    } finally {
      off?.();
    }
  }
  wait(ms, { setTimeout, clearTimeout }) {
    this.check();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        resolve();
      }, ms);
      const off = this.onCancel((error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }
}
