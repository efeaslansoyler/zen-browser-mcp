const measured = (value, status = "measured") => ({ value, status });
const missing = (supported) => ({ status: supported ? "insufficient-data" : "unsupported" });

export class WebVitals {
  constructor(win, restoredAt) {
    this.win = win;
    this.restoredAt = restoredAt;
    this.support = new Set(win.PerformanceObserver?.supportedEntryTypes ?? []);
    this.interactions = new Map();
    this.observers = new Map();
    this.dropped = false;
    this.layoutShifts = [];
    for (const type of ["largest-contentful-paint", "event", "layout-shift"]) {
      if (!this.support.has(type)) continue;
      try {
        const observer = new win.PerformanceObserver((entries, _, options) => {
          if (options?.droppedEntriesCount) this.dropped = true;
          this.consume(type, entries.getEntries());
        });
        observer.observe({ type, buffered: true, ...(type === "event" ? { durationThreshold: 16 } : {}) });
        this.observers.set(type, observer);
      } catch {
        this.support.delete(type);
      }
    }
  }

  consume(type, entries) {
    for (const entry of entries) {
      if (entry.startTime < this.restoredAt) continue;
      if (type === "largest-contentful-paint") this.lcp = entry.startTime;
      if (type === "layout-shift" && !entry.hadRecentInput) {
        if (this.layoutShifts.length < 500) this.layoutShifts.push(entry);
        else this.dropped = true;
      }
      if (type === "event" && entry.interactionId > 0) {
        if (!this.interactions.has(entry.interactionId) && this.interactions.size >= 1000) {
          this.dropped = true;
          continue;
        }
        this.interactions.set(
          entry.interactionId,
          Math.max(this.interactions.get(entry.interactionId) ?? 0, entry.duration),
        );
      }
    }
  }

  read() {
    for (const [type, observer] of this.observers) this.consume(type, observer.takeRecords());
    const { performance, document } = this.win;
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint", "paint")[0];
    const usable = !this.restoredAt;
    const events = this.support.has("event") && "interactionId" in (this.win.PerformanceEventTiming?.prototype ?? {});
    const count = performance.interactionCount;
    const interactions = [...this.interactions.values()].sort((a, b) => b - a);
    const rank = Math.floor(count / 50);
    const inp =
      events && usable && Number.isFinite(count) && rank < interactions.length && !this.dropped
        ? measured(interactions[rank], "provisional")
        : missing(events);
    let windowStart = -Infinity,
      previous = -Infinity,
      total = 0,
      max = 0;
    for (const entry of this.layoutShifts) {
      if (entry.startTime - previous >= 1000 || entry.startTime - windowStart >= 5000) {
        total = 0;
        windowStart = entry.startTime;
      }
      previous = entry.startTime;
      total += entry.value;
      max = Math.max(max, total);
    }
    return {
      scope: "top-level document",
      visibility: document.visibilityState,
      navigationType: this.restoredAt ? "back-forward-cache" : nav?.type,
      metrics: {
        ttfb: usable && nav?.responseStart > 0 ? measured(nav.responseStart) : missing(this.support.has("navigation")),
        fcp: usable && fcp ? measured(fcp.startTime) : missing(this.support.has("paint")),
        lcp:
          usable && this.lcp != null
            ? measured(this.lcp, "provisional")
            : missing(this.support.has("largest-contentful-paint")),
        inp,
        cls:
          this.support.has("layout-shift") && !this.dropped
            ? measured(max, "provisional")
            : missing(this.support.has("layout-shift")),
      },
      navigation:
        usable && nav
          ? {
              domContentLoadedMs: nav.domContentLoadedEventEnd || null,
              loadMs: nav.loadEventEnd || null,
            }
          : null,
      ...(Number.isFinite(count) ? { interactionCount: count } : {}),
    };
  }

  destroy() {
    for (const observer of this.observers.values()) observer.disconnect();
  }
}
