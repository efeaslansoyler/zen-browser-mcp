export function config(ctx) {
  const DEFAULT = ctx.normalizeConfig({});
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
    const modes = ctx.localFile(ctx.permissionsPath).exists() ? ["ask", "auto", "custom"] : ["ask", "auto"];
    writeConfig({ mode: modes[(modes.indexOf(readConfig().mode) + 1) % modes.length] });
    ctx.island?.setMode(current.mode);
  }

  // why: Fail closed when custom permissions are missing or invalid.
  let custom = null;
  let customModified = -1;
  let customError = null;
  function readPermissions() {
    const file = ctx.localFile(ctx.permissionsPath);
    if (!file.exists()) {
      customModified = -1;
      throw new Error(
        `The permission mode is custom, but ${ctx.permissionsPath} doesn't exist. Ask the user to create it (zen-browser-mcp config permissions init) or switch the mode.`,
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

  function rule(key) {
    const { mode } = ctx.readConfig();
    const rule = ctx.policy.ruleOf(key, mode, mode === "custom" ? ctx.readPermissions() : null);
    return ctx.autonomous ? ctx.policy.autonomousRule(key, rule) : rule;
  }

  const hostOf = (browser) => {
    try {
      return browser.currentURI.host;
    } catch {
      return "";
    }
  };
  const siteAllowed = (host) => ctx.siteAllowedIn(host, ctx.readConfig().sites);

  function assertSiteHost(host) {
    if (ctx.siteAllowed(host)) return;
    throw new Error(
      ctx.readConfig().sites.mode === "allowlist"
        ? `Site access blocked: ${host} is not on the user's allowlist`
        : `Site access blocked by user rule: ${host}`,
    );
  }

  function assertSiteURL(url) {
    let host = "";
    try {
      host = Services.io.newURI(url).host;
    } catch {}
    assertSiteHost(host);
  }

  // why: Browser-internal pages run with chrome privilege; an agent there could act as the browser.
  const AGENT_SCHEMES = new Set(["http", "https", "file", "data"]);
  function agentPage(uri) {
    if (!uri) return true;
    if (uri.scheme === "about") return ["blank", "srcdoc"].includes(uri.filePath);
    return AGENT_SCHEMES.has(uri.scheme);
  }

  function assertAgentURL(uri) {
    if (!agentPage(uri))
      throw new Error(
        `Agents can't open browser-internal pages (${uri.scheme}:). Use http, https, data or, with the user's approval, file URLs.`,
      );
  }

  function assertSiteAccess(browser) {
    const source = ctx.controlledSource(browser);
    if (!agentPage(source.currentURI) || source.contentPrincipal?.isSystemPrincipal)
      throw new Error("This tab shows a browser-internal page, which agents can't use.");
    assertSiteHost(ctx.hostOf(source));
    // why: Apply the same site checks to embedded remote content from extension UI.
    for (const root of source === browser ? [source] : [source, browser]) {
      for (const frame of ctx.framesOf(root)) {
        const uri = frame.currentWindowGlobal?.documentURI;
        if (uri) assertSiteURL(uri.spec);
      }
    }
  }

  return {
    assertAgentURL,
    readConfig,
    writeConfig,
    toggleMode,
    readPermissions,
    rule,
    hostOf,
    siteAllowed,
    assertSiteHost,
    assertSiteURL,
    assertSiteAccess,
  };
}
