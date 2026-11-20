// Network log: HTTP requests of agent tabs since the tab opened. Headers, request bodies and
// fetch/XHR/document response bodies; cookie and authorization headers are hidden.
const { NetUtil } = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");

const MAX_REQUESTS = 500;
const BODY_TYPES = new Set(["xmlhttprequest", "fetch", "document"]);
const MAX_BODY = 256 * 1024; // per request
const MAX_TAB_BODIES = 8 * 1048576; // per tab; the oldest are dropped
const MAX_UPLOAD_TEXT = 64 * 1024;
// never shown to agents: session and credential headers
const SECRET_HEADERS = new Set(["cookie", "set-cookie", "authorization", "proxy-authorization"]);
const TOPICS = [
  "http-on-modify-request",
  "http-on-before-connect",
  "http-on-examine-response",
  "http-on-examine-cached-response",
  "http-on-examine-merged-response",
  "http-on-stop-request",
  "http-on-failed-opening-request",
];
// XPCOM constants don't show up in Object.entries; iterate with for...in
const CONTENT_TYPES = {};
for (const key in Ci.nsIContentPolicy) {
  if (key.startsWith("TYPE_") && !key.startsWith("TYPE_INTERNAL")) {
    CONTENT_TYPES[Ci.nsIContentPolicy[key]] ??= key.slice(5).toLowerCase();
  }
}

export class NetworkLog {
  // logs: browserId → { list, byChannel, host, nextId }; passed in so it survives reloads
  // env.tracked(browserId): whether the tab is recorded
  // env.blocked(browserId, host, document): true cancels the request (site list); document: a
  // page or frame load rather than a resource it uses
  constructor(logs, env) {
    this.logs = logs;
    this.env = env;
    this.observer = { observe: (subject, topic) => this.#observe(subject, topic) };
  }

  start() {
    for (const topic of TOPICS) Services.obs.addObserver(this.observer, topic);
  }
  stop() {
    for (const topic of TOPICS) {
      try {
        Services.obs.removeObserver(this.observer, topic);
      } catch {}
    }
  }

  get(browserId) {
    return this.logs.get(browserId);
  }
  delete(browserId) {
    this.logs.delete(browserId);
  }

  // requests longer than 10 s (long polling, streams) don't count
  busy(browserId, now = Date.now()) {
    return (this.logs.get(browserId)?.list ?? []).some((r) => r.duration == null && !r.error && now - r.start < 10000);
  }

  #observe(subject, topic) {
    let channel;
    try {
      channel = subject.QueryInterface(Ci.nsIHttpChannel);
    } catch {
      return;
    }
    const bc = channel.loadInfo?.browsingContext;
    const browserId = bc?.browserId;
    if (!browserId || !this.env.tracked(browserId)) return;
    const type = CONTENT_TYPES[channel.loadInfo?.externalContentPolicyType];
    const document = type === "document" || type === "subdocument";
    if (topic === "http-on-modify-request" && this.env.blocked(browserId, channel.URI.host, document)) {
      channel.cancel(Cr.NS_ERROR_ABORT);
      return;
    }
    // The native response override runs before the cache/network connection, preserving
    // the HTTP URL, principal and status. No response-stream or redirect shims are needed.
    if (topic === "http-on-modify-request" || topic === "http-on-before-connect") {
      const rule = this.env.control?.(channel, browserId, type === "document" && !bc.parent);
      if (topic === "http-on-before-connect") {
        if (rule?.action === "mock") {
          try {
            const response = Cc["@mozilla.org/network/replaced-http-response;1"].createInstance(
              Ci.nsIReplacedHttpResponse,
            );
            const bytes = new TextEncoder().encode(rule.body);
            let body = "";
            for (let i = 0; i < bytes.length; i += 8192) body += String.fromCharCode(...bytes.subarray(i, i + 8192));
            response.responseBody = body;
            response.responseStatus = rule.status;
            response.responseStatusText = rule.status < 300 ? "OK" : "Mocked";
            response.setResponseHeader("Content-Type", `${rule.content_type}; charset=utf-8`, false);
            for (const [name, value] of rule.headers) response.setResponseHeader(name, value, false);
            channel.QueryInterface(Ci.nsIHttpChannelInternal).setResponseOverride(response);
          } catch {
            // A configured mock must never fall through and send the real request.
            channel.cancel(Cr.NS_ERROR_ABORT);
          }
        }
        return;
      }
      if (rule?.action === "block") channel.cancel(Cr.NS_ERROR_ABORT);
      if (rule?.action === "offline") channel.cancel(Cr.NS_ERROR_OFFLINE);
    }
    this.env.capture?.(channel, browserId, type, topic);
    let log = this.logs.get(browserId);
    if (!log) this.logs.set(browserId, (log = { list: [], byChannel: new Map(), host: "", nextId: 1 }));
    // a log from the version before a reload: entries without IDs
    if (!log.nextId) {
      log.nextId = 1;
      for (const r of log.list) r.id = log.nextId++;
    }

    if (
      topic === "http-on-modify-request" ||
      (topic === "http-on-failed-opening-request" && !log.byChannel.has(channel.channelId))
    ) {
      const type = CONTENT_TYPES[channel.loadInfo.externalContentPolicyType] ?? "other";
      // Like Claude in Chrome: old entries are cleared when the main document goes to another site
      if (type === "document" && bc.top === bc) {
        const host = channel.URI.host;
        if (log.host && host !== log.host) {
          log.list.length = 0;
          log.byChannel.clear();
          log.nextId = 1;
        }
        log.host = host;
      }
      const entry = {
        id: log.nextId++,
        method: channel.requestMethod,
        url: channel.URI.spec,
        type,
        status: null,
        start: Date.now(),
      };
      entry.requestHeaders = headersOf(channel, "visitRequestHeaders");
      if (BODY_TYPES.has(type)) entry.requestBody = uploadText(channel);
      log.list.push(entry);
      log.byChannel.set(channel.channelId, entry);
      if (log.list.length > MAX_REQUESTS) log.byChannel.delete(log.list.shift().channelId);
      entry.channelId = channel.channelId;
      if (topic === "http-on-modify-request") return;
    }
    const entry = log.byChannel.get(channel.channelId);
    if (!entry) return;
    // a request refused before opening (e.g. banned port, CSP) gets no stop-request
    if (topic === "http-on-failed-opening-request") {
      entry.error = ChromeUtils.getXPCOMErrorName(channel.status);
      entry.duration = 0;
      log.byChannel.delete(channel.channelId);
      return;
    }
    if (topic === "http-on-stop-request") {
      entry.duration = Date.now() - entry.start;
      if (!Components.isSuccessCode(channel.status)) entry.error = ChromeUtils.getXPCOMErrorName(channel.status);
      log.byChannel.delete(channel.channelId);
      return;
    }
    // examine-*: response headers arrived
    try {
      entry.status = channel.responseStatus;
      entry.mime = channel.contentType || undefined;
      if (topic === "http-on-examine-cached-response") entry.cached = true;
      entry.responseHeaders = headersOf(channel, "visitResponseHeaders");
      // headers added while sending (such as cookies) are complete here
      entry.requestHeaders = headersOf(channel, "visitRequestHeaders");
    } catch {}
    if (BODY_TYPES.has(entry.type) && entry.body === undefined)
      captureBody(channel, entry, log, () => this.env.projectBody?.(channel, browserId, entry));
  }

  // read_network_requests with id: one request's details
  async details(browser, r, maxChars) {
    const win = browser.ownerDocument.defaultView;
    const lines = [`#${r.id} ${r.method} ${r.error ?? r.status ?? "pending"} ${r.url}`];
    const extra = [r.type, r.mime, r.cached && "cached", r.duration != null && `${r.duration} ms`]
      .filter(Boolean)
      .join(", ");
    if (extra) lines[0] += `  (${extra})`;
    const headers = (list) => (list?.length ? list.map(([k, v]) => `  ${k}: ${v}`).join("\n") : "  (none)");
    lines.push("", "Request headers:", headers(r.requestHeaders));
    if (r.requestBody) lines.push("", "Request body:", decode(win, r.requestBody, maxChars));
    lines.push("", "Response headers:", headers(r.responseHeaders));
    if (r.body === undefined) lines.push("", "Response body: not recorded (only for fetch/XHR and documents).");
    else if (r.body === null) lines.push("", "Response body: dropped (memory limit).");
    else if (!/json|text|xml|javascript|html|csv|graphql|x-www-form-urlencoded/i.test(r.mime ?? "")) {
      lines.push("", `Response body: binary (${r.mime ?? "unknown type"}, ${r.bodySize} bytes).`);
    } else {
      const cut = r.bodySize > r.body.length ? `, first ${r.body.length} bytes kept` : "";
      const encoding = r.responseHeaders?.find(([k]) => k === "content-encoding")?.[1];
      let raw = r.body;
      let note = "";
      if (encoding && encoding !== "identity") {
        try {
          raw = await decompress(win, raw, encoding);
          note = `, ${encoding} decoded`;
        } catch (e) {
          note = `, ${encoding} could not be decoded${cut ? " (truncated)" : ""}: ${e?.message ?? e}`;
        }
      }
      lines.push("", `Response body (${r.bodySize} bytes${cut}${note}):`, decode(win, raw, maxChars));
    }
    return lines.join("\n");
  }
}

function headersOf(channel, visit) {
  const out = [];
  try {
    channel[visit]({
      visitHeader(name, value) {
        out.push([name.toLowerCase(), SECRET_HEADERS.has(name.toLowerCase()) ? "[hidden]" : value]);
      },
    });
  } catch {}
  return out;
}

// The POST body (if small); the stream is rewound after reading so the request is unaffected.
function uploadText(channel) {
  try {
    const stream = channel.QueryInterface(Ci.nsIUploadChannel).uploadStream;
    if (!stream || !(stream instanceof Ci.nsISeekableStream)) return undefined;
    const size = stream.available();
    if (!size || size > MAX_UPLOAD_TEXT) return size ? `(${size} bytes, not shown)` : undefined;
    const pos = stream.tell();
    stream.seek(Ci.nsISeekableStream.NS_SEEK_SET, 0);
    const raw = NetUtil.readInputStreamToString(stream, size);
    stream.seek(Ci.nsISeekableStream.NS_SEEK_SET, pos);
    return raw;
  } catch {
    return undefined;
  }
}

// Sits in front of the channel's listener and copies the incoming data (with the content
// encoding decoded); the page receives the data unchanged.
function captureBody(channel, entry, log, projectBody) {
  let traceable;
  try {
    traceable = channel.QueryInterface(Ci.nsITraceableChannel);
  } catch {
    return;
  }
  entry.body = "";
  entry.bodySize = 0;
  const tee = {
    QueryInterface: ChromeUtils.generateQI(["nsIStreamListener", "nsIRequestObserver"]),
    onStartRequest(request) {
      original.onStartRequest(request);
    },
    onDataAvailable(request, stream, offset, count) {
      const bin = Cc["@mozilla.org/binaryinputstream;1"].createInstance(Ci.nsIBinaryInputStream);
      bin.setInputStream(stream);
      const data = bin.readBytes(count);
      try {
        entry.bodySize += count;
        if (entry.body.length < MAX_BODY) entry.body += data.slice(0, MAX_BODY - entry.body.length);
      } catch {}
      const copy = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
      copy.setByteStringData(data);
      original.onDataAvailable(request, copy, offset, count);
    },
    onStopRequest(request, status) {
      try {
        projectBody();
        trimBodies(log);
      } catch {}
      original.onStopRequest(request, status);
    },
  };
  let original;
  try {
    original = traceable.setNewListener(tee);
  } catch {
    delete entry.body;
  }
}

function trimBodies(log) {
  let total = log.list.reduce((sum, r) => sum + (r.body?.length ?? 0), 0);
  for (const r of log.list) {
    if (total <= MAX_TAB_BODIES) break;
    if (!r.body) continue;
    total -= r.body.length;
    r.body = null; // silindi
  }
}

// Recording happens before decompression, so content-encoding is decoded here.
const DECOMPRESS_FORMATS = { gzip: "gzip", "x-gzip": "gzip", deflate: "deflate", br: "brotli", zstd: "zstd" };
async function decompress(win, raw, encoding) {
  const format = DECOMPRESS_FORMATS[encoding.trim().toLowerCase()];
  if (!format) throw new Error("bilinmeyen kodlama");
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  const stream = new win.Blob([bytes]).stream().pipeThrough(new win.DecompressionStream(format));
  const out = new Uint8Array(await new win.Response(stream).arrayBuffer());
  let binary = "";
  for (let i = 0; i < out.length; i += 0x8000) binary += String.fromCharCode(...out.subarray(i, i + 0x8000));
  return binary;
}

// ikili dize → UTF-8 metin, uzunsa kesilir
function decode(win, raw, maxChars) {
  let t;
  try {
    t = new win.TextDecoder().decode(Uint8Array.from(raw, (c) => c.charCodeAt(0)));
  } catch {
    t = raw;
  }
  return t.length > maxChars ? t.slice(0, maxChars) + `\n…(truncated, ${t.length} characters)` : t;
}
