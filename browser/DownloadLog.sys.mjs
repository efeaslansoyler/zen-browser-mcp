// İndirme kaydı: ajan sekmelerinden (ya da onların açtığı açılır pencerelerden) başlayan
// indirmeler. Gecko'nun Downloads listesini dinler; durum, yol, boyut ve ilerleme verir.
const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");

const MAX_RECORDS = 100;

export class DownloadLog {
  // records: { list: [{ id, browserId, download, reported }], nextId }; reload'dan sağ çıksın diye dışarıdan gelir
  // env.tracked(browserId): kaydedilecek sekme mi
  constructor(records, env) {
    this.records = records;
    this.records.list ??= [];
    this.records.nextId ??= 1;
    this.env = env;
    this.view = { onDownloadAdded: download => this.#added(download) };
  }

  async start() {
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
    this.records.list.push({ id: this.records.nextId++, browserId, download, reported: false });
    if (this.records.list.length > MAX_RECORDS) this.records.list.shift();
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
    const state = d.succeeded ? "done" : d.error ? "failed" : d.canceled ? (d.hasPartialData ? "paused" : "canceled") : "downloading";
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
    return info;
  }
}
