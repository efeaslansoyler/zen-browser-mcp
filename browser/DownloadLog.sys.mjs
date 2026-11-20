const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");

const MAX_RECORDS = 100;
const STEP_BYTES = 10 * 1048576;
const HASH_CHUNK = 4 * 1048576; // why: Bound hashing work per chunk to keep the browser main thread responsive.

export class DownloadLog {
  // why: Keep download state across bridge reloads to avoid reporting old downloads again.
  constructor(records, env) {
    this.records = records;
    this.records.list ??= [];
    this.records.nextId ??= 1;
    this.env = env;
    this.view = {
      onDownloadAdded: (download) => this.#added(download),
      onDownloadChanged: (download) => this.#changed(download),
    };
  }

  async start() {
    await this.env.events.start();
    this.list = await Downloads.getList(Downloads.ALL);
    await this.list.addView(this.view);
  }

  stop() {
    this.list?.removeView(this.view);
  }

  #added(download) {
    if (this.records.list.some((r) => r.download === download)) return;
    const browserId = this.#sourceTab(download.source.browsingContextId);
    if (browserId == null) return;
    const record = { id: this.records.nextId++, browserId, download, reported: false };
    record.events = this.env.events.path(record.id);
    this.records.list.push(record);
    if (this.records.list.length > MAX_RECORDS) this.records.list.shift();
    this.#changed(download);
  }

  #changed(download) {
    const record = this.records.list.find((r) => r.download === download);
    if (!record?.events || record.closed) return;
    const info = DownloadLog.describe(record);
    const step =
      info.state !== "downloading"
        ? -1
        : download.hasProgress
          ? Math.floor(download.progress / 10)
          : Math.floor(download.currentBytes / STEP_BYTES);
    if (info.state === record.lastState && step === record.lastStep) return;
    record.lastState = info.state;
    record.lastStep = step;
    const finished = DownloadLog.finished(record);
    if (finished) record.closed = true;
    this.env.events.append(
      record.events,
      async () => {
        if (finished && info.state === "done") info.sha256 = await DownloadLog.sha256(record);
        return info;
      },
      { last: finished },
    );
  }

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
      record.sha256 = Array.from(binary, (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    } catch {}
    return record.sha256;
  }

  #sourceTab(contextId) {
    const bc = contextId && BrowsingContext.get(contextId);
    if (!bc) return null;
    for (let top = bc.top; top; top = top.opener?.top) {
      if (this.env.tracked(top.browserId)) return top.browserId;
    }
    return null;
  }

  forTab(browserId) {
    return this.records.list.filter((r) => r.browserId === browserId);
  }

  hasPendingDialog(browserId) {
    // why: The dialog can predate the download entry, so use its launcher to find the source tab.
    for (const win of Services.wm.getEnumerator(null)) {
      if (win.closed || win.document.documentURI !== "chrome://mozapps/content/downloads/unknownContentType.xhtml")
        continue;
      if (this.#sourceTab(win.dialog?.mLauncher?.browsingContextId) === browserId) return true;
    }
    return false;
  }

  static finished({ download: d }) {
    return d.succeeded || !!d.error || (d.canceled && !d.hasPartialData);
  }

  static describe(record) {
    const d = record.download;
    const state = d.succeeded
      ? "done"
      : d.error
        ? "failed"
        : d.canceled
          ? d.hasPartialData && !record.canceling
            ? "paused"
            : "canceled"
          : "downloading";
    const info = {
      id: record.id,
      state,
      url: d.source.url,
      filename: PathUtils.filename(d.target.path),
      path: d.target.path,
    };
    if (d.contentType) info.contentType = d.contentType;
    if (d.succeeded) info.size = d.target.size ?? d.currentBytes;
    else if (state === "downloading" || state === "paused") {
      info.receivedBytes = d.currentBytes;
      if (d.hasProgress) {
        info.totalBytes = d.totalBytes;
        info.progress = d.progress;
      }
    }
    if (d.error) {
      info.error = d.error.becauseBlocked ? `blocked (${d.error.reputationCheckVerdict || "policy"})` : d.error.message;
    }
    if (record.sha256) info.sha256 = record.sha256;
    return info;
  }
}
