// User settings in ~/.config/<app>/config.json and the per-site access rules built on them.
//
// mode: the permission template, "ask", "auto" or "custom" (Policy.sys.mjs); custom's rules are
// in permissions.jsonc next to config.json, which only the user edits.
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

  // The island's mode button: ask → auto → custom (when permissions.jsonc exists) → ask.
  function toggleMode() {
    const modes = ctx.localFile(ctx.permissionsPath).exists() ? ["ask", "auto", "custom"] : ["ask", "auto"];
    writeConfig({ mode: modes[(modes.indexOf(readConfig().mode) + 1) % modes.length] });
    ctx.island?.setMode(current.mode);
  }

  // The custom template, read again when the file changes. A broken or missing file is an
  // error for every call that needs it: it never falls back to looser rules.
  let custom = null;
  let customModified = -1;
  let customError = null;
  function readPermissions() {
    const file = ctx.localFile(ctx.permissionsPath);
    if (!file.exists()) {
      customModified = -1;
      throw new Error(
        `The permission mode is custom, but ${ctx.permissionsPath} doesn't exist. Ask the user to create it (npx zen-browser-mcp config permissions init) or switch the mode.`,
      );
    }
    if (file.lastModifiedTime !== customModified) {
      customModified = file.lastModifiedTime;
      try {
        custom = ctx.policy.parsePermissions(ctx.readTextFile(file));
        customError = null;
      } catch (e) {
        customError = e;
        ctx.logError("permissions", e);
      }
    }
    if (customError) throw customError;
    return custom;
  }

  // The rule ("allow", "ask" or "deny") of an operation (Policy.sys.mjs) in the current mode.
  function rule(key) {
    const { mode } = ctx.readConfig();
    return ctx.policy.ruleOf(key, mode, mode === "custom" ? ctx.readPermissions() : null);
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
    readPermissions,
    rule,
    hostOf,
    ruleFor,
    isSensitive,
    assertSiteHost,
    assertSiteURL,
    assertSiteAccess,
  };
}
