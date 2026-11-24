import { networkFilter } from "./NetworkFilters.sys.mjs";

const DURATION = 10 * 60_000;
const RETENTION = 15 * 60_000;
const MAX_ENTRIES = 2000;
const MAX_BYTES = 4 * 1024 * 1024;
const SENSITIVE =
  /auth|login|logout|session|token|passw|secret|credential|cookie|csrf|xsrf|otp|pin(?:$|[-_])|reset|verify|invite|(?:^|[-_])code(?:$|[-_])/i;
const safeHeaders = {
  "content-type": /^[\w.+-]+\/[\w.+-]+(?:;\s*charset=[\w-]+)?$/i,
  "content-length": /^\d{1,16}$/,
  "content-encoding": /^(?:gzip|br|deflate|identity|zstd)(?:,\s*(?:gzip|br|deflate|identity|zstd))*$/i,
  "cache-control":
    /^(?:(?:public|private|no-cache|no-store|immutable|must-revalidate|proxy-revalidate|no-transform|(?:s-maxage|max-age|stale-while-revalidate|stale-if-error)=\d+)(?:,\s*|$))+$/i,
};

// why: A marker segment can arrive percent-encoded and must still redact the value after it.
function decodedSegment(segment = "") {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function sanitizeHarURL(value, base) {
  const url = new URL(value, base);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Unsupported request URL.");
  url.username = "";
  url.password = "";
  url.hash = "";
  const path = url.pathname.split("/");
  url.pathname = path
    .map((segment, index) => {
      let decoded;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        return "redacted";
      }
      return /^(?:token|password|secret|session|reset|verify|invite|code)$/i.test(decodedSegment(path[index - 1])) ||
        /@|[\w-]{24,}|^\d{6,}$|%/.test(decoded)
        ? "redacted"
        : segment;
    })
    .join("/");
  const keys = [...new Set(url.searchParams.keys())];
  url.search = "";
  for (const key of keys) if (/^[a-z_][a-z0-9_-]{0,39}$/i.test(key)) url.searchParams.append(key, "redacted");
  return url.href;
}

function headersOf(channel, method) {
  const headers = [];
  try {
    channel[method]((name, value) => {
      const rule = Object.hasOwn(safeHeaders, name.toLowerCase()) && safeHeaders[name.toLowerCase()];
      if (rule && value.length <= 160 && rule.test(value)) headers.push({ name, value });
    });
  } catch {}
  return headers;
}

function channelInfo(channel) {
  const result = {};
  try {
    const timed = channel.QueryInterface(Ci.nsITimedChannel);
    const asyncOpen = timed.asyncOpenTime;
    const requestStart = timed.requestStartTime;
    const responseStart = timed.responseStartTime;
    const responseEnd = timed.responseEndTime;
    const cacheStart = timed.cacheReadStartTime;
    const cacheEnd = timed.cacheReadEndTime;
    const millis = (start, end) => Math.max(0, end - start) / 1000;
    if (requestStart > 0 && responseStart >= requestStart && responseEnd >= responseStart) {
      result.timings = {
        blocked: asyncOpen > 0 ? millis(asyncOpen, requestStart) : -1,
        send: 0,
        wait: millis(requestStart, responseStart),
        receive: millis(responseStart, responseEnd),
      };
      result.source = "gecko-channel; send time is included in wait";
    } else if (cacheStart > 0 && cacheEnd >= cacheStart) {
      result.timings = { send: 0, wait: 0, receive: millis(cacheStart, cacheEnd) };
      result.source = "gecko-cache";
    }
  } catch {}
  try {
    const http = channel.QueryInterface(Ci.nsIHttpChannelInternal);
    const version = (method) => {
      const major = {},
        minor = {};
      http[method](major, minor);
      return Number.isInteger(major.value) && major.value > 0 ? `HTTP/${major.value}.${minor.value}` : "";
    };
    result.requestVersion = version("getRequestVersion");
    result.responseVersion = version("getResponseVersion");
  } catch {}
  try {
    const http = channel.QueryInterface(Ci.nsIHttpChannel);
    result.responseSize = Number.isSafeInteger(http.encodedBodySize) ? http.encodedBodySize : -1;
    result.decodedSize = Number.isSafeInteger(http.decodedBodySize) ? http.decodedBodySize : -1;
    result.transferSize = Number.isSafeInteger(http.transferSize) ? http.transferSize : -1;
  } catch {}
  return result;
}

export function validateHarProjection(input, origin) {
  const url = new URL(input.url);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.origin !== origin ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    SENSITIVE.test(decodeURIComponent(url.pathname))
  )
    throw new Error("Choose a same-origin HTTPS or localhost JSON endpoint without credentials, query, or fragment.");
  if (
    !Array.isArray(input.fields) ||
    !input.fields.length ||
    input.fields.length > 12 ||
    input.fields.some(
      ({ name, values }) =>
        !/^[a-z][a-z0-9_]{0,39}$/i.test(name) ||
        SENSITIVE.test(name) ||
        ["constructor", "prototype"].includes(name) ||
        (values !== undefined &&
          (!Array.isArray(values) ||
            !values.length ||
            values.length > 12 ||
            values.some((value) => !/^[a-z][a-z_-]{0,31}$/i.test(value) || SENSITIVE.test(value)))),
    )
  )
    throw new Error("Choose up to 12 known-safe boolean or enumerated fields.");
  return { url: url.href, fields: input.fields };
}

const rowBytes = (url) => url.length * 2 + 2048;

export class HarCapture {
  constructor(env) {
    this.env = env;
    this.roots = new Map();
    this.tabs = new Map();
  }

  start(tabId, session, projection) {
    if (this.tabs.has(tabId) || this.roots.has(tabId)) throw new Error("This tab already has a HAR capture.");
    if (this.roots.size >= 8) throw new Error("Too many HAR captures.");
    const capture = {
      tabId,
      session,
      projection,
      start: Date.now(),
      tabs: new Set([tabId]),
      rows: new Map(),
      bytes: 0,
      omitted: 0,
    };
    this.roots.set(tabId, capture);
    this.tabs.set(tabId, capture);
    capture.timer = this.env.setTimeout(() => this.freeze(capture, "duration limit"), DURATION);
    return this.status(capture);
  }

  owned(tabId, session) {
    const capture = this.roots.get(tabId);
    if (!capture || capture.session !== session) throw new Error("No HAR capture owned by this session in this tab.");
    return capture;
  }

  attach(capture, tabId) {
    if (capture.reason) throw new Error("This HAR capture is already stopped.");
    if (capture.tabs.has(tabId)) return this.status(capture);
    if (this.tabs.has(tabId) || this.roots.has(tabId)) throw new Error("This tab already has a HAR capture.");
    capture.tabs.add(tabId);
    this.tabs.set(tabId, capture);
    return this.status(capture);
  }

  status(capture) {
    return {
      state: capture.reason ? "stopped" : "capturing",
      reason: capture.reason,
      tabId: capture.tabId,
      tabs: [...capture.tabs],
      entries: capture.rows.size,
      omitted: capture.omitted,
      elapsedMs: (capture.ended ?? Date.now()) - capture.start,
    };
  }

  freeze(capture, reason) {
    if (capture.reason) return;
    capture.reason = reason;
    capture.ended = Date.now();
    this.env.clearTimeout(capture.timer);
    for (const tabId of capture.tabs) this.tabs.delete(tabId);
    capture.timer = this.env.setTimeout(() => this.drop(capture), RETENTION);
  }

  drop(capture) {
    this.env.clearTimeout(capture.timer);
    this.roots.delete(capture.tabId);
    for (const tabId of capture.tabs) if (this.tabs.get(tabId) === capture) this.tabs.delete(tabId);
    capture.rows.clear();
  }

  dropTab(tabId, session) {
    for (const capture of this.roots.values()) {
      if (!capture.tabs.has(tabId) || (session && capture.session !== session)) continue;
      if (capture.tabId === tabId) this.drop(capture);
      else {
        capture.tabs.delete(tabId);
        if (this.tabs.get(tabId) === capture) this.tabs.delete(tabId);
        for (const [key, row] of capture.rows) if (row.tabId === tabId) capture.rows.delete(key);
      }
    }
  }

  dropSession(session) {
    for (const capture of this.roots.values()) if (capture.session === session) this.drop(capture);
  }

  dropAll() {
    for (const capture of this.roots.values()) this.drop(capture);
  }

  projectionFor(tabId, channel) {
    const capture = this.tabs.get(tabId);
    const projection = capture?.projection;
    return projection &&
      channel.requestMethod === "GET" &&
      channel.URI.spec === projection.url &&
      this.env.allowed(tabId, capture.session, channel.URI.host)
      ? { capture, projection }
      : null;
  }

  projectBody(tabId, channel, entry) {
    const match = this.projectionFor(tabId, channel);
    if (
      !match ||
      entry.body?.length !== entry.bodySize ||
      entry.bodySize > 65536 ||
      !/^application\/(?:[\w.+-]+\+)?json(?:;|$)/i.test(entry.mime ?? "") ||
      entry.responseHeaders?.some(([name, value]) => name === "content-encoding" && value !== "identity")
    )
      return;
    const row = match.capture.rows.get(`${tabId}:${channel.channelId}`);
    if (!row) return;
    try {
      const payload = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          Uint8Array.from(entry.body, (character) => character.charCodeAt(0)),
        ),
      );
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
      const safe = {};
      for (const { name, values } of match.projection.fields) {
        if (!Object.hasOwn(payload, name)) continue;
        const value = payload[name];
        if (values ? values.includes(value) : typeof value === "boolean") safe[name] = value;
      }
      if (Object.keys(safe).length) row.projected = JSON.stringify(safe);
    } catch {}
  }

  observe(channel, tabId, type, topic) {
    const capture = this.tabs.get(tabId);
    if (!capture) return;
    if (!this.env.allowed(tabId, capture.session, channel.URI.host)) return;
    const key = `${tabId}:${channel.channelId}`;
    let row = capture.rows.get(key);
    if (topic === "http-on-modify-request") {
      if (row) return;
      const url = sanitizeHarURL(channel.URI.spec);
      capture.bytes += rowBytes(url);
      if (capture.rows.size >= MAX_ENTRIES || capture.bytes > MAX_BYTES) {
        capture.omitted++;
        this.freeze(capture, "capacity limit");
        return;
      }
      row = {
        tabId,
        url,
        method: channel.requestMethod,
        type: type ?? "other",
        start: Date.now(),
        requestHeaders: headersOf(channel, "visitRequestHeaders"),
      };
      capture.rows.set(key, row);
      return;
    }
    if (!row) return;
    if (topic.startsWith("http-on-examine-")) {
      row.responseHeaders = headersOf(channel, "visitResponseHeaders");
      row.cached ||= topic === "http-on-examine-cached-response";
      try {
        row.status = channel.responseStatus;
        row.mime = row.responseHeaders.find(({ name }) => name.toLowerCase() === "content-type")?.value ?? "";
        const url = sanitizeHarURL(channel.getResponseHeader("Location"), channel.URI.spec);
        if (this.env.allowed(tabId, capture.session, new URL(url).hostname)) row.redirect = url;
      } catch {}
      Object.assign(row, channelInfo(channel));
    }
    if (topic === "http-on-stop-request" || topic === "http-on-failed-opening-request") {
      row.done = true;
      Object.assign(row, channelInfo(channel));
    }
  }

  // why: Nothing of a request that is still running may be recorded once the user has the tab.
  cut(tabId) {
    const capture = this.tabs.get(tabId);
    for (const [key, row] of capture?.rows ?? [])
      if (row.tabId === tabId && !row.done) {
        capture.rows.delete(key);
        capture.bytes -= rowBytes(row.url);
        capture.omitted++;
      }
  }

  async write(data) {
    await IOUtils.makeDirectory(this.env.dir, { permissions: 0o700 });
    const name = Services.uuid.generateUUID().toString().slice(1, -1);
    const path = PathUtils.join(this.env.dir, `capture-${name}.har`);
    await IOUtils.writeUTF8(path, JSON.stringify(data), { tmpPath: path + ".tmp", mode: "create" });
    await IOUtils.setPermissions(path, 0o600);
    this.env.setTimeout(() => IOUtils.remove(path).catch(() => {}), RETENTION);
    return path;
  }

  async export(capture, filters, call) {
    this.freeze(capture, "requested");
    const match = networkFilter(filters);
    const entries = [];
    let inFlight = 0,
      unsupported = 0;
    for (const row of capture.rows.values()) {
      if (!this.env.allowed(row.tabId, capture.session, new URL(row.url).hostname) || !match(row)) continue;
      if (!row.done && !row.timings) {
        inFlight++;
        continue;
      }
      if (!row.timings || !row.status) {
        unsupported++;
        continue;
      }
      const responseSize = row.responseSize ?? -1;
      const contentLength = row.requestHeaders.find(({ name }) => name.toLowerCase() === "content-length")?.value;
      entries.push({
        startedDateTime: new Date(row.start).toISOString(),
        time: Object.values(row.timings).reduce((sum, time) => sum + Math.max(0, time), 0),
        request: {
          method: row.method,
          url: row.url,
          httpVersion: row.requestVersion ?? "",
          cookies: [],
          headers: row.requestHeaders,
          queryString: [...new URL(row.url).searchParams].map(([name, value]) => ({ name, value })),
          headersSize: -1,
          bodySize: contentLength ? Number(contentLength) : -1,
        },
        response: {
          status: row.status,
          statusText: "",
          httpVersion: row.responseVersion ?? "",
          cookies: [],
          headers: row.responseHeaders ?? [],
          content: {
            size: row.decodedSize ?? -1,
            mimeType: row.mime ?? "",
            ...(row.projected ? { text: row.projected, comment: "Selected response fields only" } : {}),
          },
          redirectURL:
            row.redirect && this.env.allowed(row.tabId, capture.session, new URL(row.redirect).hostname)
              ? row.redirect
              : "",
          headersSize: -1,
          bodySize: responseSize,
        },
        cache: {},
        timings: row.timings,
        _timingSource: row.source,
        _resourceType: row.type,
        _fromCache: !!row.cached,
        _transferSize: row.transferSize ?? -1,
        _tabId: row.tabId,
      });
    }
    const file = await this.write({
      log: { version: "1.2", creator: { name: "zen-browser-mcp", version: "1" }, pages: [], entries },
    });
    try {
      call.check();
      if (this.roots.get(capture.tabId) !== capture) throw new Error("HAR capture access changed during export.");
    } catch (error) {
      await IOUtils.remove(file).catch(() => {});
      throw error;
    }
    const summary = { ...this.status(capture), entries: entries.length, inFlight, unsupported, path: file };
    this.drop(capture);
    return summary;
  }
}
