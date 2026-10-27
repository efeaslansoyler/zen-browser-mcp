// İndirme kaydı: ajan sekmelerinden (ya da onların açtığı açılır pencerelerden) başlayan
// indirmeler. Gecko'nun Downloads listesini dinler; durum, yol, boyut ve ilerleme verir.
// Her indirme için bir olay dosyası (JSON satırları) yazar: shell'den izleyebilen ajanlar
// (Claude Code Monitor gibi) beklemeden işine devam eder. Dosyayı biz sileriz, ajana bırakmayız.
const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");

const MAX_RECORDS = 100;
const EVENT_TTL = 5 * 60_000; // bittikten sonra olay dosyası bu kadar kalır
const STEP_BYTES = 10 * 1048576; // boyutu bilinmeyen indirmede bu kadar baytta bir satır
const HASH_CHUNK = 4 * 1048576; // ana iş parçacığını uzun süre tutmasın diye parça parça

export class DownloadLog {
  // records: { list: [{ id, browserId, download, reported }], nextId }; reload'dan sağ çıksın diye dışarıdan gelir
  // env.tracked(browserId): kaydedilecek sekme mi; env.dir: olay dosyalarının klasörü
  constructor(records, env) {
    this.records = records;
    this.records.list ??= [];
    this.records.nextId ??= 1;
    this.env = env;
    this.view = {
      onDownloadAdded: download => this.#added(download),
      onDownloadChanged: download => this.#changed(download),
    };
  }

  async start() {
    // reload'da silme zamanlayıcıları kaybolur: kalan eski dosyaları süpür
    await IOUtils.makeDirectory(this.env.dir, { permissions: 0o700 });
    for (const file of await IOUtils.getChildren(this.env.dir)) {
      const { lastModified } = await IOUtils.stat(file).catch(() => ({ lastModified: 0 }));
      if (Date.now() - lastModified > EVENT_TTL) await IOUtils.remove(file).catch(() => {});
    }
    this.list = await Downloads.getList(Downloads.ALL);
    // addView mevcut indirmeler için de onDownloadAdded çağırır; kayıtlılar tekrar eklenmez
    await this.list.addView(this.view);
  }

  stop() {
    this.list?.removeView(this.view);
  }

  #added(download) {
    if (this.records.list.some(r => r.download === download)) return;
    const browserId = this.#sourceTab(download);
    if (browserId == null) return;
    const record = { id: this.records.nextId++, browserId, download, reported: false };
    record.events = PathUtils.join(this.env.dir, `${record.id}.jsonl`);
    this.records.list.push(record);
    if (this.records.list.length > MAX_RECORDS) this.records.list.shift();
    this.#changed(download);
  }

  // olay satırı: durum değişince ve her %10'da (boyut bilinmiyorsa her 10 MB'da)
  #changed(download) {
    const record = this.records.list.find(r => r.download === download);
    if (!record?.events || record.closed) return;
    const info = DownloadLog.describe(record);
    const step = info.state !== "downloading" ? -1
      : download.hasProgress ? Math.floor(download.progress / 10) : Math.floor(download.currentBytes / STEP_BYTES);
    if (info.state === record.lastState && step === record.lastStep) return;
    record.lastState = info.state;
    record.lastStep = step;
    const finished = DownloadLog.finished(record);
    if (finished) record.closed = true;
    record.writing = (record.writing ?? Promise.resolve()).then(async () => {
      if (finished && info.state === "done") info.sha256 = await DownloadLog.sha256(record);
      await IOUtils.writeUTF8(record.events, JSON.stringify(info) + "\n", { mode: "appendOrCreate" });
      if (finished) this.env.setTimeout(() => IOUtils.remove(record.events).catch(() => {}), EVENT_TTL);
    }).catch(e => this.env.logError?.("download events", e));
  }

  // sha256 bir kez hesaplanır; dosya taşınmış/silinmişse undefined
  static async sha256(record) {
    if (record.sha256) return record.sha256;
    try {
      const path = record.download.target.path;
      const hash = Cc["@mozilla.org/security/hash;1"].createInstance(Ci.nsICryptoHash);
      hash.init(Ci.nsICryptoHash.SHA256);
      const { size } = await IOUtils.stat(path);
      for (let offset = 0; offset < size; offset += HASH_CHUNK) {
        const bytes = await IOUtils.read(path, { offset, maxBytes: HASH_CHUNK });
        hash.update(bytes, bytes.length);
      }
      const binary = hash.finish(false);
      record.sha256 = Array.from(binary, c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    } catch {}
    return record.sha256;
  }

  // indirmeyi başlatan çerçevenin sekmesi; yeni açılan bir pencereden geldiyse açan sekme
  #sourceTab(download) {
    const bc = download.source.browsingContextId && BrowsingContext.get(download.source.browsingContextId);
    if (!bc) return null;
    for (let top = bc.top; top; top = top.opener?.top) {
      if (this.env.tracked(top.browserId)) return top.browserId;
    }
    return null;
  }

  forTab(browserId) { return this.records.list.filter(r => r.browserId === browserId); }

  // duraklatılmış (kısmi veriyle iptal) indirme bitmiş sayılmaz
  static finished({ download: d }) { return d.succeeded || !!d.error || (d.canceled && !d.hasPartialData); }

  static describe(record) {
    const d = record.download;
    // cancel sırasında Gecko bir an kısmi veriyi tutar: o ara "paused" görünmesin
    const state = d.succeeded ? "done" : d.error ? "failed"
      : d.canceled ? (d.hasPartialData && !record.canceling ? "paused" : "canceled") : "downloading";
    const info = { id: record.id, state, url: d.source.url, filename: PathUtils.filename(d.target.path), path: d.target.path };
    if (d.contentType) info.contentType = d.contentType;
    if (d.succeeded) info.size = d.target.size ?? d.currentBytes;
    else if (state === "downloading" || state === "paused") {
      info.receivedBytes = d.currentBytes;
      if (d.hasProgress) { info.totalBytes = d.totalBytes; info.progress = d.progress; }
    }
    if (d.error) {
      info.error = d.error.becauseBlocked ? `blocked (${d.error.reputationCheckVerdict || "policy"})` : d.error.message;
    }
    if (record.sha256) info.sha256 = record.sha256;
    return info;
  }
}
