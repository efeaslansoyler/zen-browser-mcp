// why: Event files let agents monitor work asynchronously and expire without agent cleanup.
const TTL = 5 * 60_000;

export class EventFiles {
  constructor(env) {
    this.env = env;
    this.queues = new Map(); // why: Serialize writes to keep JSON lines from interleaving.
  }

  async start() {
    await IOUtils.makeDirectory(this.env.dir, { permissions: 0o700 });
    for (const file of await IOUtils.getChildren(this.env.dir)) {
      const { lastModified } = await IOUtils.stat(file).catch(() => ({ lastModified: 0 }));
      if (Date.now() - lastModified > TTL) await IOUtils.remove(file).catch(() => {});
    }
  }

  // why: IDs are reused after reload or restart, so a timestamp prevents appending to old files.
  path(name) {
    return PathUtils.join(this.env.dir, `${name}-${Date.now().toString(36)}.jsonl`);
  }

  // why: Defer expensive event fields until their write reaches the front of the queue.
  append(file, value, { last = false } = {}) {
    const queue = (this.queues.get(file) ?? Promise.resolve())
      .then(async () => {
        const line = typeof value === "function" ? await value() : value;
        await IOUtils.writeUTF8(file, JSON.stringify(line) + "\n", { mode: "appendOrCreate" });
        if (last) {
          this.queues.delete(file);
          this.env.setTimeout(() => IOUtils.remove(file).catch(() => {}), TTL);
        }
      })
      .catch((e) => this.env.logError?.("event file", e));
    if (!last) this.queues.set(file, queue);
    return queue;
  }
}
