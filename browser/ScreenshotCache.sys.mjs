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
