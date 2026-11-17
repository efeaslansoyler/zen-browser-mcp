// Events files: JSON lines for long-running work (downloads, page watches). Agents that can
// follow a file from the shell (like Claude Code's Monitor) keep working instead of waiting.
// We delete the files, not the agent: TTL after the work ends; leftovers from a reload are swept on start.
const TTL = 5 * 60_000;

export class EventFiles {
  // env: { dir, setTimeout, logError }
  constructor(env) {
    this.env = env;
    this.queues = new Map(); // file → write queue (so lines don't interleave)
  }

  async start() {
    await IOUtils.makeDirectory(this.env.dir, { permissions: 0o700 });
    for (const file of await IOUtils.getChildren(this.env.dir)) {
      const { lastModified } = await IOUtils.stat(file).catch(() => ({ lastModified: 0 }));
      if (Date.now() - lastModified > TTL) await IOUtils.remove(file).catch(() => {});
    }
  }

  // IDs restart at 1 after a reload or browser restart: a time suffix keeps them from appending to an old file
  path(name) { return PathUtils.join(this.env.dir, `${name}-${Date.now().toString(36)}.jsonl`); }

  // value can be a function, computed when its turn comes (slow fields such as sha256)
  append(file, value, { last = false } = {}) {
    const queue = (this.queues.get(file) ?? Promise.resolve()).then(async () => {
      const line = typeof value === "function" ? await value() : value;
      await IOUtils.writeUTF8(file, JSON.stringify(line) + "\n", { mode: "appendOrCreate" });
      if (last) {
        this.queues.delete(file);
        this.env.setTimeout(() => IOUtils.remove(file).catch(() => {}), TTL);
      }
    }).catch(e => this.env.logError?.("event file", e));
    if (!last) this.queues.set(file, queue);
    return queue;
  }
}
