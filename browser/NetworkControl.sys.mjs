const MAX_RULES = 32;

export function networkRule({ action, urlPattern, body, content_type = "text/plain", status = 200, headers = {} }) {
  if (!["block", "mock", "offline", "clear"].includes(action)) throw new Error("Unknown network action.");
  if (action === "offline" || action === "clear") return null;
  if (typeof urlPattern !== "string" || !urlPattern.trim() || urlPattern.length > 2048)
    throw new Error("urlPattern must be a non-empty URL substring of at most 2048 characters.");
  if (action === "block") return { action, urlPattern };

  if (typeof body !== "string" || body.length > 65536)
    throw new Error("Mock requires a body of at most 65536 characters.");
  if (typeof content_type !== "string" || content_type.length > 128 || !/^[\w.+-]+\/[\w.+-]+$/.test(content_type))
    throw new Error("content_type must be a MIME type without parameters.");
  if (!Number.isInteger(status) || status < 200 || status > 599 || Math.floor(status / 100) === 3)
    throw new Error("Mock status must be 200–299 or 400–599.");
  if ((status === 204 || status === 205) && body) throw new Error("This status requires an empty body.");
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) throw new Error("headers must be an object.");
  const entries = Object.entries(headers);
  if (
    entries.length > 16 ||
    entries.some(
      ([name, value]) =>
        !/^x-[a-z0-9-]{1,62}$/i.test(name) || typeof value !== "string" || !/^[\x20-\x7e]{0,512}$/.test(value),
    )
  )
    throw new Error("Use at most 16 X-* headers with ASCII values of at most 512 characters.");
  return { action, urlPattern, body, content_type, status, headers: entries };
}

export class NetworkControl {
  #tabs = new Map();

  has(tabId) {
    return this.#tabs.has(tabId);
  }

  update(tabId, session, origin, args) {
    const rule = networkRule(args);
    let tab = this.#tabs.get(tabId);
    if (tab && tab.origin !== origin) {
      this.#tabs.delete(tabId);
      tab = null;
    }
    if (args.action === "clear") {
      this.#tabs.delete(tabId);
      return { rules: 0, offline: false };
    }
    if (tab && tab.session !== session)
      throw new Error("Clear the other session's network rules before replacing them.");
    if (!tab) this.#tabs.set(tabId, (tab = { session, origin, rules: [], offline: false }));
    if (rule) {
      const index = tab.rules.findIndex((other) => other.urlPattern === rule.urlPattern);
      if (index >= 0) tab.rules.splice(index, 1);
      else if (tab.rules.length >= MAX_RULES) throw new Error("This tab already has 32 network rules.");
      tab.rules.push(rule);
    } else tab.offline = true;
    return { rules: tab.rules.length, offline: tab.offline };
  }

  dropTab(tabId, session) {
    if (session === undefined || this.#tabs.get(tabId)?.session === session) this.#tabs.delete(tabId);
  }

  dropSession(session) {
    for (const id of this.#tabs.keys()) this.dropTab(id, session);
  }

  clear() {
    this.#tabs.clear();
  }

  match(tabId, url, origin, currentOrigin, topDocument) {
    const tab = this.#tabs.get(tabId);
    if (!tab) return null;
    if ((topDocument && origin !== tab.origin) || currentOrigin !== tab.origin) {
      this.dropTab(tabId);
      return null;
    }
    if (tab.offline) return { action: "offline" };
    return tab.rules.findLast((rule) => url.includes(rule.urlPattern)) ?? null;
  }
}

export function networkControlTool(ctx) {
  return (args, call) => {
    const browser = ctx.browserFor(call, args.tabId);
    if (ctx.findTab(args.tabId)?.getAttribute(ctx.MARK) !== "true")
      throw new Error("Network control requires an agent-opened tab.");
    const uri = browser.currentURI;
    if (args.action !== "clear" && !uri.schemeIs("http") && !uri.schemeIs("https"))
      throw new Error("Open an HTTP(S) page before setting network rules.");
    if (args.action === "mock" && !Cc["@mozilla.org/network/replaced-http-response;1"])
      throw new Error("This Gecko build does not support HTTP response overrides.");
    return ctx.text(ctx.networkControl.update(browser.browserId, call.session, uri.prePath, args));
  };
}
