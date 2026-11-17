// Page watches: write a line to an events file when a condition holds in an agent tab (text or
// element appears or disappears) or an element's text changes. Unlike wait_for they don't block
// the agent and can run for hours. They end when the owner changes, the tab closes, the time
// runs out or on Stop.
const MAX_PER_SESSION = 10;

export class Watches {
  // env: { events: EventFiles, owned(tabId, session) → browser|null, check(browser, {text, selector}),
  //        sample(browser, selector), assertSite(browser), setTimeout, clearTimeout }
  constructor(env) {
    this.env = env;
    this.list = new Map(); // id → record
    this.nextId = 1;
  }

  start(session, tabId, browser, spec) {
    const { text, selector, gone = false, change = false, repeat = false } = spec;
    if (change && !selector) throw new Error("change needs a selector whose text to watch.");
    if (!change && !text && !selector) throw new Error("text, selector or change is required.");
    if ([...this.list.values()].filter(w => w.session === session).length >= MAX_PER_SESSION) {
      throw new Error(`At most ${MAX_PER_SESSION} watches per session; stop one first.`);
    }
    const interval = Math.min(Math.max(spec.interval ?? 2, 0.5), 60) * 1000;
    const timeout = Math.min(Math.max(spec.timeout ?? 3600, 10), 86400) * 1000;
    const id = this.nextId++;
    const watch = {
      id, session, tabId, interval, until: Date.now() + timeout,
      spec: { text, selector, gone, change, repeat }, events: this.env.events.path(`${id}`),
      matched: false, last: undefined, started: Date.now(),
    };
    this.list.set(id, watch);
    this.#write(watch, { event: "started", url: browser.currentURI?.spec, ...this.#describe(watch) });
    this.#schedule(watch, 0);
    return watch;
  }

  #describe({ spec }) {
    const what = {};
    for (const key of ["text", "selector", "gone", "change", "repeat"]) if (spec[key]) what[key] = spec[key];
    return what;
  }

  #write(watch, line, last = false) {
    this.env.events.append(watch.events, { id: watch.id, t: new Date().toISOString(), ...line }, { last });
  }

  #schedule(watch, delay) {
    watch.timer = this.env.setTimeout(() => this.#tick(watch).catch(() => {}), delay);
  }

  async #tick(watch) {
    if (!this.list.has(watch.id)) return;
    const browser = this.env.owned(watch.tabId, watch.session);
    if (!browser) return this.end(watch.id, "tab closed or no longer owned by this session");
    try { this.env.assertSite(browser); } catch (e) { return this.end(watch.id, e.message); }
    const { spec } = watch;
    const url = browser.currentURI?.spec;
    try {
      if (spec.change) {
        const value = await this.env.sample(browser, spec.selector);
        if (watch.last === undefined) watch.last = value;
        else if (value !== watch.last) {
          this.#write(watch, { event: "changed", url, value, previous: watch.last });
          watch.last = value;
        }
      } else {
        const found = await this.env.check(browser, { text: spec.text, selector: spec.selector });
        const ok = spec.gone ? !found : found;
        // write on transitions only, not every round while the condition stays true
        if (ok && !watch.matched) {
          if (!spec.repeat) return this.end(watch.id, "matched", { url });
          this.#write(watch, { event: "matched", url });
        }
        watch.matched = ok;
      }
    } catch {
      // no frame while loading, a dialog open…: try again next round
    }
    if (!this.list.has(watch.id)) return;
    if (Date.now() >= watch.until) return this.end(watch.id, "timeout");
    this.#schedule(watch, watch.interval);
  }

  // the final line; reason "matched" means the condition held
  end(id, reason, extra = {}) {
    const watch = this.list.get(id);
    if (!watch) return null;
    this.env.clearTimeout(watch.timer);
    this.list.delete(id);
    this.#write(watch, reason === "matched" ? { event: "matched", ...extra, final: true } : { event: "ended", reason, ...extra }, true);
    return watch;
  }

  forSession(session) { return [...this.list.values()].filter(w => w.session === session); }

  endSession(session, reason) { for (const w of this.forSession(session)) this.end(w.id, reason); }

  endAll(reason) { for (const id of [...this.list.keys()]) this.end(id, reason); }

  static summary(watch) {
    const spec = Object.fromEntries(Object.entries(watch.spec).filter(([, value]) => value));
    return { id: watch.id, tabId: watch.tabId, events: watch.events, ...spec, interval: watch.interval / 1000,
      endsAt: new Date(watch.until).toISOString() };
  }
}
