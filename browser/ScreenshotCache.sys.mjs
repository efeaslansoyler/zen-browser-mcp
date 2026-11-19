export class ScreenshotCache {
  constructor(maxBytes = 8 * 1024 * 1024) {
    this.entries = new Map();
    this.bytes = 0;
    this.maxBytes = maxBytes;
  }
  unchanged(key, context, data) {
    const previous = this.entries.get(key);
    const same =
      previous &&
      previous.context.length === context.length &&
      previous.context.every((v, i) => v === context[i]) &&
      previous.data === data;
    if (previous) {
      this.bytes -= previous.data.length;
      this.entries.delete(key);
    }
    if (data.length <= this.maxBytes) {
      this.entries.set(key, { context, data });
      this.bytes += data.length;
      while (this.bytes > this.maxBytes || this.entries.size > 32) {
        const oldest = this.entries.keys().next().value;
        this.bytes -= this.entries.get(oldest).data.length;
        this.entries.delete(oldest);
      }
    }
    return !!same;
  }
}

const BASELINE_TTL = 60 * 60_000;

export class VisualBaselines {
  constructor() {
    this.entries = new Map();
    this.bytes = 0;
    this.nextId = 0;
  }

  remove(id) {
    this.bytes -= this.entries.get(id).pixels.byteLength;
    this.entries.delete(id);
  }

  clear(tabId, session) {
    for (const [id, entry] of this.entries)
      if (entry.tabId === tabId && (!session || session === entry.session)) this.remove(id);
  }

  save(entry) {
    const id = `${Date.now().toString(36)}-${++this.nextId}`;
    this.entries.set(id, entry);
    this.bytes += entry.pixels.byteLength;
    while (this.bytes > 32 * 1024 * 1024 || this.entries.size > 32) this.remove(this.entries.keys().next().value);
    return id;
  }

  get(id, session) {
    const entry = this.entries.get(id);
    if (!entry || entry.session !== session) return null;
    if (Date.now() - entry.capture.time >= BASELINE_TTL) {
      this.remove(id);
      return null;
    }
    return entry;
  }

  diff(before, after) {
    let changed = 0;
    for (let i = 0; i < after.length; i += 4) {
      const r = after[i],
        g = after[i + 1],
        b = after[i + 2];
      if (Math.max(Math.abs(r - before[i]), Math.abs(g - before[i + 1]), Math.abs(b - before[i + 2])) > 12) {
        changed++;
        after[i] = 255;
        after[i + 1] = 40;
        after[i + 2] = 85;
      } else {
        after[i] = r * 0.45;
        after[i + 1] = g * 0.45;
        after[i + 2] = b * 0.45;
      }
    }
    return changed;
  }
}
