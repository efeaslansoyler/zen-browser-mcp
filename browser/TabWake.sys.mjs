// Keeps agent tabs awake while agents work in them. Firefox puts background tabs to sleep: their
// timers run about once a second, animation frames are throttled and the page reports itself as
// hidden. Agent tabs live in the background of the user's window, so a menu that opens on
// requestAnimationFrame, a debounced search box or lazy-loaded content would stall under the
// agent. Marking the tab's browsing context active (what the tab switcher does for the selected
// tab) makes it run like a foreground tab.
//
// A tab is awake while someone holds it (a tool call, a live watch) and for GRACE ms after the
// last hold ends, so what a click started can finish. A tab the user looks at is left alone.
const GRACE = 5000;
const REASSERT = 2000; // the tab switcher puts a tab back to sleep when the user leaves it

export class TabWake {
  // env: { setTimeout, clearTimeout, setInterval, clearInterval, selected(browser) → bool }
  constructor(env) {
    this.env = env;
    this.tabs = new Map(); // browser → { holds, timer, interval }
  }

  // Keeps browser awake until the returned function is called (once).
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

  // The tab closed or went back to the user: no waiting for its holds.
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

  // Bridge shutdown: every tab goes back to how the browser runs it.
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
