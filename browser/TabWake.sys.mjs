// why: Keep the tab awake briefly for the work started by a click and leave selected tabs to Gecko.
const GRACE = 5000;
const REASSERT = 2000;

export class TabWake {
  constructor(env) {
    this.env = env;
    this.tabs = new Map();
  }

  hold(browser) {
    if (!browser) return () => {};
    let entry = this.tabs.get(browser);
    if (!entry) {
      entry = { holds: 0, timer: null, interval: null };
      this.tabs.set(browser, entry);
    }
    this.env.clearTimeout(entry.timer);
    entry.timer = null;
    entry.holds++;
    this.#wake(browser);
    entry.interval ??= this.env.setInterval(() => this.#wake(browser), REASSERT);
    let released = false;
    return () => {
      if (released || this.tabs.get(browser) !== entry) return;
      released = true;
      if (--entry.holds > 0) return;
      this.env.clearInterval(entry.interval);
      entry.interval = null;
      entry.timer = this.env.setTimeout(() => this.forget(browser), GRACE);
    };
  }

  awake(browser) {
    return this.tabs.has(browser);
  }

  forget(browser) {
    const entry = this.tabs.get(browser);
    if (!entry) return;
    this.env.clearTimeout(entry.timer);
    this.env.clearInterval(entry.interval);
    this.tabs.delete(browser);
    try {
      if (browser.isConnected && !this.env.selected(browser)) browser.docShellIsActive = false;
    } catch {}
  }

  destroy() {
    for (const browser of [...this.tabs.keys()]) this.forget(browser);
  }

  #wake(browser) {
    try {
      if (browser.isConnected && !browser.docShellIsActive && !this.env.selected(browser))
        browser.docShellIsActive = true;
    } catch {}
  }
}
