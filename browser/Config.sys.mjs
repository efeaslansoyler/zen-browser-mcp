// User settings in ~/.config/<app>/config.json and the per-site access rules built on them.
//
// mode: "auto" (the agent acts without asking) or "ask" (each action is approved on the island).
// sites: domain → "ask" (approve each action) or "block" (no agent access); a rule also covers
// subdomains. The file is read again whenever it changes on disk.
export function config(ctx) {
  const DEFAULT = { mode: "auto", sites: {} };
  let current = { ...DEFAULT };
  let modified = -1;
  let error = null;

  function readConfig() {
    const file = ctx.localFile(ctx.configPath);
    if (!file.exists()) {
      current = { ...DEFAULT };
      modified = 0;
      error = null;
      return current;
    }
    if (file.lastModifiedTime === modified) {
      if (error) throw error;
      return current;
    }
    modified = file.lastModifiedTime;
    try {
      current = ctx.normalizeConfig(JSON.parse(ctx.readTextFile(file)));
      error = null;
      ctx.island?.setMode(current.mode);
    } catch (e) {
      error = e;
      ctx.logError("config", e);
      throw e;
    }
    return current;
  }

  function writeConfig(changes) {
    const next = { ...readConfig(), ...changes };
    const file = ctx.localFile(ctx.configPath);
    ctx.writeTextFile(file, JSON.stringify(next, null, 2) + "\n");
    current = next;
    modified = file.lastModifiedTime;
  }

  function toggleMode() {
    writeConfig({ mode: readConfig().mode === "ask" ? "auto" : "ask" });
    ctx.island?.setMode(current.mode);
  }

  const hostOf = (browser) => {
    try {
      return browser.currentURI.host;
    } catch {
      return "";
    }
  };
  const ruleFor = (host) => ctx.siteRule(host, ctx.readConfig().sites);
  const isSensitive = (host) => ctx.ruleFor(host) === "ask";

  function assertSiteHost(host) {
    if (ctx.ruleFor(host) === "block") throw new Error(`Site access blocked by user rule: ${host}`);
  }

  function assertSiteURL(url) {
    let host = "";
    try {
      host = Services.io.newURI(url).host;
    } catch {}
    assertSiteHost(host);
  }

  function assertSiteAccess(browser) {
    const source = ctx.controlledSource(browser);
    assertSiteHost(ctx.hostOf(source));
    // Both the source page and extension UI may embed remote content.
    for (const root of source === browser ? [source] : [source, browser]) {
      for (const frame of ctx.framesOf(root)) {
        const uri = frame.currentWindowGlobal?.documentURI;
        if (uri) assertSiteURL(uri.spec);
      }
    }
  }

  return {
    readConfig,
    writeConfig,
    toggleMode,
    hostOf,
    ruleFor,
    isSensitive,
    assertSiteHost,
    assertSiteURL,
    assertSiteAccess,
  };
}
