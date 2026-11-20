// Store access is separate from arbitrary page evaluation and only available in agent profiles.
export function assertAgentDataMode(mode, tool) {
  if ((tool === "cookies" || tool === "storage") && (!mode || mode === "together"))
    throw new Error("This tool requires an agent browser mode.");
}

const token = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
export function validateCookie(args) {
  const { action, name, path = "/", value, http_only, expires } = args;
  if (!["list", "set", "delete"].includes(action)) throw new Error("Unknown cookie action.");
  if (action !== "list" && (typeof name !== "string" || name.length > 256 || !token.test(name)))
    throw new Error("A valid cookie name is required.");
  if (typeof path !== "string" || path.length > 1024 || !/^\/[\x20-\x3a\x3c-\x7e]*$/.test(path))
    throw new Error("Cookie path must start with / and contain no semicolons or control characters.");
  if (action === "set") {
    if (
      typeof value !== "string" ||
      !/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/.test(value) ||
      name.length + value.length > 4096
    )
      throw new Error("A valid cookie value is required (name and value at most 4096 bytes combined).");
    if (http_only !== undefined && typeof http_only !== "boolean") throw new Error("http_only must be a boolean.");
    if (expires !== undefined && (!Number.isSafeInteger(expires) || expires < 1 || expires > 253402300799))
      throw new Error("expires must be a positive Unix timestamp in seconds.");
  }
}

export function validateStorage({ action, area, key, value }) {
  if (!["local", "session"].includes(area)) throw new Error('Storage area must be "local" or "session".');
  if (!["get", "set", "remove", "clear"].includes(action)) throw new Error("Unknown storage action.");
  if (action !== "clear" && (typeof key !== "string" || key.length > 1024))
    throw new Error("A storage key of at most 1024 characters is required.");
  if (action === "set" && (typeof value !== "string" || value.length > 65536))
    throw new Error("A storage value of at most 65536 characters is required.");
}

function httpURI(uri) {
  if (!uri || (!uri.schemeIs("http") && !uri.schemeIs("https")) || !uri.host || uri.userPass)
    throw new Error("An HTTP(S) URL without credentials is required.");
  return uri;
}

export function agentDataTools(ctx) {
  // ctx.text normalizes element refs. Cookie and storage values must round-trip verbatim.
  const data = (value) => [{ type: "text", text: JSON.stringify(value) }];
  return {
    cookies(args, call) {
      assertAgentDataMode(ctx.browserMode, "cookies");
      validateCookie(args);
      const browser = ctx.browserFor(call, args.tabId);
      const uri = httpURI(args.url === undefined ? browser.currentURI : Services.io.newURI(args.url));
      ctx.assertSiteURL(uri.spec);
      const principal = browser.browsingContext?.currentWindowGlobal?.documentPrincipal;
      if (!principal || !principal.isContentPrincipal)
        throw new Error("Open an HTTP(S) page before accessing cookies.");
      const { partitionKey, ...attrs } = principal.originAttributes;
      if (partitionKey) throw new Error("Partitioned cookie jars are unavailable.");
      const manager = Services.cookies;
      // Firefox 142 moved the native cookie timestamp from seconds to milliseconds.
      const expiryScale = Number.parseInt(Services.appinfo.platformVersion, 10) >= 142 ? 1000 : 1;
      const host = uri.asciiHost;
      const { action, name, value, path = "/", http_only = false, expires } = args;
      if (action === "list") {
        const cookies = manager
          .getCookiesFromHost(host, attrs)
          .filter(
            (cookie) =>
              (cookie.isDomain
                ? host === cookie.rawHost || host.endsWith("." + cookie.rawHost)
                : host === cookie.rawHost) &&
              (!cookie.isSecure || uri.schemeIs("https")),
          );
        return data({
          untrusted: true,
          cookies: cookies.slice(0, 100).map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
            host: cookie.host,
            path: cookie.path,
            secure: cookie.isSecure,
            http_only: cookie.isHttpOnly,
            session: cookie.isSession,
            expires: cookie.isSession ? undefined : Math.floor(cookie.expiry / expiryScale),
          })),
          truncated: cookies.length > 100,
        });
      }
      if (
        !uri.schemeIs("https") &&
        manager
          .getCookiesFromHost(host, attrs)
          .some(
            (cookie) =>
              !cookie.isDomain &&
              cookie.rawHost === host &&
              cookie.isSecure &&
              cookie.name === name &&
              cookie.path === path,
          )
      )
        throw new Error("Use HTTPS to change a secure cookie.");
      if (action === "delete") {
        manager.remove(host, name, path, attrs);
      } else {
        const secure = uri.schemeIs("https");
        const validation = manager.add(
          host,
          path,
          name,
          value,
          secure,
          http_only,
          expires === undefined,
          (expires ?? 253402300799) * expiryScale,
          attrs,
          Ci.nsICookie.SAMESITE_LAX,
          secure ? Ci.nsICookie.SCHEME_HTTPS : Ci.nsICookie.SCHEME_HTTP,
        );
        if (validation && validation.result !== Ci.nsICookieValidation.eOK)
          throw new Error("Gecko rejected the cookie.");
      }
      return data({ ok: true });
    },

    async storage(args, call) {
      assertAgentDataMode(ctx.browserMode, "storage");
      validateStorage(args);
      const browser = ctx.browserFor(call, args.tabId);
      const origin = httpURI(browser.currentURI).prePath;
      const { value } = await ctx.query(browser, "agent_storage", { ...args, origin });
      return data(args.action === "get" ? { untrusted: true, value } : { ok: true });
    },
  };
}
