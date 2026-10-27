// Olay dosyaları: uzun süren işler (indirme, sayfa izleme) için JSON satırları. Shell'den
// izleyebilen ajanlar (Claude Code Monitor gibi) beklemeden işine devam eder. Dosyayı biz
// sileriz, ajana bırakmayız: iş bittikten TTL sonra, reload'da kalanlar start'ta süpürülür.
const TTL = 5 * 60_000;

export class EventFiles {
  // env: { dir, setTimeout, logError }
  constructor(env) {
    this.env = env;
    this.queues = new Map(); // dosya → yazma sırası (satırlar karışmasın)
  }

  async start() {
    await IOUtils.makeDirectory(this.env.dir, { permissions: 0o700 });
    for (const file of await IOUtils.getChildren(this.env.dir)) {
      const { lastModified } = await IOUtils.stat(file).catch(() => ({ lastModified: 0 }));
      if (Date.now() - lastModified > TTL) await IOUtils.remove(file).catch(() => {});
    }
  }

  // numaralar reload ya da tarayıcı yeniden başlayınca 1'den başlar: önceki dosyaya eklenmesin diye zaman eki
  path(name) { return PathUtils.join(this.env.dir, `${name}-${Date.now().toString(36)}.jsonl`); }

  // value bir fonksiyon olabilir: sıra gelince hesaplanır (ör. sha256 gibi yavaş alanlar)
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
