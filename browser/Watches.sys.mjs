// why: A hold watch lets an agent wait for another member without reading or locking the page.
const MAX_PER_SESSION = 10;

export class Watches {
  constructor(env) {
    this.env = env;
    this.list = new Map();
    this.nextId = 1;
  }

  start(session, tabId, browser, spec) {
    const { text, selector, gone = false, change = false, repeat = false, hold = false, live = false } = spec;
    if (hold && (text || selector || change || gone || repeat || live))
      throw new Error("hold watches the tab's hold only; leave out text, selector, gone, change, repeat and live.");
    if (change && !selector) throw new Error("change needs a selector whose text to watch.");
    if (!hold && !change && !text && !selector) throw new Error("text, selector, change or hold is required.");
    if ([...this.list.values()].filter((w) => w.session === session).length >= MAX_PER_SESSION) {
      throw new Error(`At most ${MAX_PER_SESSION} watches per session; stop one first.`);
    }
    const interval = Math.min(Math.max(spec.interval ?? 2, 0.5), 60) * 1000;
    const timeout = Math.min(Math.max(spec.timeout ?? 3600, 10), 86400) * 1000;
    const id = this.nextId++;
    const watch = {
      id,
      session,
      tabId,
      interval,
      until: Date.now() + timeout,
      spec: { text, selector, gone, change, repeat, hold, live },
      events: this.env.events.path(`${id}`),
      matched: false,
      last: undefined,
      cuts: 0,
      started: Date.now(),
    };
    this.list.set(id, watch);
    // why: Foreground-speed watches need timers and animation frames that background Gecko throttles.
    if (live && browser) watch.release = this.env.wake(browser);
    this.#write(watch, {
      event: "started",
      ...(browser ? { url: browser.currentURI?.spec } : {}),
      ...this.#describe(watch),
    });
    this.#schedule(watch, 0);
    return watch;
  }

  #describe({ spec }) {
    const what = {};
    for (const key of ["text", "selector", "gone", "change", "repeat", "hold", "live"])
      if (spec[key]) what[key] = spec[key];
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
    if (watch.spec.hold) {
      const state = this.env.held(watch.tabId, watch.session);
      if (state === "free") return this.end(watch.id, "released");
      if (state === "gone") return this.end(watch.id, "tab closed or no longer an agent tab");
      if (Date.now() >= watch.until) return this.end(watch.id, "timeout");
      return this.#schedule(watch, watch.interval);
    }
    const browser = this.env.owned(watch.tabId, watch.session);
    if (!browser) return this.end(watch.id, "tab closed, or this session no longer works in it");
    if (this.env.paused?.(watch.tabId)) {
      if (Date.now() >= watch.until) return this.end(watch.id, "timeout");
      return this.#schedule(watch, watch.interval);
    }
    try {
      this.env.assertSite(browser);
    } catch (e) {
      return this.end(watch.id, e.message);
    }
    const { spec, cuts } = watch;
    const url = browser.currentURI?.spec;
    try {
      if (spec.change) {
        const value = await this.env.sample(browser, spec.selector);
        if (watch.cuts !== cuts) return this.#schedule(watch, watch.interval);
        if (watch.last === undefined) watch.last = value;
        else if (value !== watch.last) {
          this.#write(watch, { event: "changed", url, value, previous: watch.last });
          watch.last = value;
        }
      } else {
        const found = await this.env.check(browser, { text: spec.text, selector: spec.selector });
        if (watch.cuts !== cuts) return this.#schedule(watch, watch.interval);
        const ok = spec.gone ? !found : found;
        // why: Emit transitions so an unchanged match does not fill the events file.
        if (ok && !watch.matched) {
          if (!spec.repeat) return this.end(watch.id, "matched", { url });
          this.#write(watch, { event: "matched", url });
        }
        watch.matched = ok;
      }
    } catch {
      // why: A loading frame or modal dialog may clear on the next poll.
    }
    if (!this.list.has(watch.id)) return;
    if (Date.now() >= watch.until) return this.end(watch.id, "timeout");
    this.#schedule(watch, watch.interval);
  }

  // why: A read that is still running may see the page as the user leaves it.
  cut(tabId) {
    for (const watch of this.list.values()) if (watch.tabId === tabId) watch.cuts++;
  }

  end(id, reason, extra = {}) {
    const watch = this.list.get(id);
    if (!watch) return null;
    this.env.clearTimeout(watch.timer);
    watch.release?.();
    this.list.delete(id);
    this.#write(
      watch,
      reason === "matched" || reason === "released"
        ? { event: reason, ...extra, final: true }
        : { event: "ended", reason, ...extra },
      true,
    );
    return watch;
  }

  forSession(session) {
    return [...this.list.values()].filter((w) => w.session === session);
  }

  endSession(session, reason) {
    for (const w of this.forSession(session)) this.end(w.id, reason);
  }

  endAll(reason) {
    for (const id of [...this.list.keys()]) this.end(id, reason);
  }

  static summary(watch) {
    const spec = Object.fromEntries(Object.entries(watch.spec).filter(([, value]) => value));
    return {
      id: watch.id,
      tabId: watch.tabId,
      events: watch.events,
      ...spec,
      interval: watch.interval / 1000,
      endsAt: new Date(watch.until).toISOString(),
    };
  }
}
