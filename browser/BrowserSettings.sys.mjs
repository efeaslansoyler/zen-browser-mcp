// Per-tab layout and Gecko overrides. No window resize, global prefs, or WebDriver.
export const DEVICE_PRESETS = {
  mobile: { width: 390, height: 844, dpr: 3, touch: true, platform: "Android 15; Mobile" },
  tablet: { width: 820, height: 1180, dpr: 2, touch: true, platform: "Android 15; Tablet" },
  desktop: { width: 1280, height: 800, dpr: 1, touch: false },
};
export class BrowserSettings {
  constructor(env) {
    this.env = env;
    this.entries = new Map();
  }
  validate(args) {
    const value = args.action === "device" ? { ...DEVICE_PRESETS[args.device], ...args } : { ...args };
    // Mobile/tablet: the Android Firefox UA of the same Gecko version (so servers send the mobile page)
    if (value.platform && value.userAgent == null && this.env.geckoVersion) {
      const v = this.env.geckoVersion;
      value.userAgent = `Mozilla/5.0 (${value.platform}; rv:${v}) Gecko/${v} Firefox/${v}`;
    }
    delete value.platform;
    if (args.action === "device" && !DEVICE_PRESETS[args.device])
      throw new Error("Unknown device preset; use devices.");
    if (args.action === "viewport" || args.action === "device") {
      for (const key of ["width", "height"])
        if (!Number.isInteger(value[key]) || value[key] < 200 || value[key] > 4000)
          throw new Error(`${key} must be an integer from 200 to 4000.`);
    }
    if (args.action === "media" && value.color_scheme == null) throw new Error("color_scheme is required for media.");
    if (value.dpr != null && (!Number.isFinite(value.dpr) || value.dpr < 0.5 || value.dpr > 4))
      throw new Error("dpr must be 0.5..4.");
    if (value.touch != null && typeof value.touch !== "boolean") throw new Error("touch must be boolean.");
    if (
      value.userAgent != null &&
      (typeof value.userAgent !== "string" || value.userAgent.length > 1000 || /[\r\n]/.test(value.userAgent))
    )
      throw new Error("Invalid userAgent.");
    if (value.color_scheme != null && !["dark", "light", "no-preference"].includes(value.color_scheme))
      throw new Error("Invalid color scheme.");
    return value;
  }
  // target can be a function: cross-site navigation replaces the browsingContext (Fission) and
  // overrides move to the new one, so restoring must find the current object
  remember(entry, at, key, value, css = false) {
    const target = typeof at === "function" ? at() : at;
    let property = entry.properties.find((p) => p.at === at && p.key === key && p.css === css);
    if (!property) {
      property = {
        at,
        key,
        css,
        original: css ? target.style.getPropertyValue(key) : target[key],
        priority: css ? target.style.getPropertyPriority(key) : "",
      };
      entry.properties.push(property);
    }
    if (css) target.style.setProperty(key, value, "important");
    else target[key] = value;
    property.applied = css ? target.style.getPropertyValue(key) : target[key];
  }
  restore(source) {
    const entry = this.entries.get(source);
    if (!entry) return;
    for (const p of [...entry.properties].reverse()) {
      try {
        const target = typeof p.at === "function" ? p.at() : p.at;
        const current = p.css ? target.style.getPropertyValue(p.key) : target[p.key];
        if (current !== p.applied) continue; // Preserve manual edits made since our change.
        if (p.css) {
          if (p.original) target.style.setProperty(p.key, p.original, p.priority);
          else target.style.removeProperty(p.key);
        } else target[p.key] = p.original;
      } catch {}
    }
    this.entries.delete(source);
  }
  restoreTab(tabId) {
    for (const source of this.entries.keys()) if (source.browserId === tabId) this.restore(source);
  }
  destroy() {
    for (const source of this.entries.keys()) this.restore(source);
  }
  async change(source, session, args) {
    if (!["viewport", "device", "media", "reset"].includes(args.action))
      throw new Error("Unknown browser setting action.");
    const value = this.validate(args);
    this.env.check(source, session);
    const win = source.ownerDocument.defaultView,
      selected = win.gBrowser.selectedBrowser;
    const context = this.env.context(source);
    const document = source.browsingContext.currentWindowGlobal;
    if (!(await this.env.ask(source, args, value)))
      throw new Error("The user denied or did not answer the browser settings request; nothing was changed.");
    this.env.check(source, session);
    if (
      this.env.context(source) !== context ||
      source.browsingContext.currentWindowGlobal !== document ||
      win.gBrowser.selectedBrowser !== selected
    )
      throw new Error(
        "The target or selected tab changed while awaiting browser settings approval; nothing was changed.",
      );
    if (args.action === "reset") {
      this.restore(source);
      await this.env.wait(100);
      return;
    }
    // A background browser's layout is suspended; select it only after explicit approval.
    win.gBrowser.selectedTab = win.gBrowser.getTabForBrowser(source);
    await this.env.wait(50);
    this.env.check(source, session);
    if (win.gBrowser.selectedBrowser !== source || source.browsingContext.currentWindowGlobal !== document)
      throw new Error("Target changed after the approved switch; settings were not changed.");
    let entry = this.entries.get(source);
    if (!entry) {
      entry = { session, properties: [] };
      this.entries.set(source, entry);
    }
    if (entry.session !== session) throw new Error("Settings belong to another session.");
    try {
      if (value.width != null) {
        const zoom = source.fullZoom || 1;
        for (const [key, content] of Object.entries({
          width: `${value.width * zoom}px`,
          height: `${value.height * zoom}px`,
          "min-width": `${value.width * zoom}px`,
          "max-width": `${value.width * zoom}px`,
          "min-height": `${value.height * zoom}px`,
          "max-height": `${value.height * zoom}px`,
          flex: "none",
          "justify-self": "start",
          "align-self": "start",
        }))
          this.remember(entry, source, key, content, true);
      }
      const bc = () => source.browsingContext;
      if (value.dpr != null) this.remember(entry, bc, "overrideDPPX", value.dpr);
      if (value.touch != null) this.remember(entry, bc, "touchEventsOverride", value.touch ? "enabled" : "disabled");
      if (value.userAgent != null) this.remember(entry, bc, "customUserAgent", value.userAgent);
      if (value.color_scheme != null)
        this.remember(
          entry,
          bc,
          "prefersColorSchemeOverride",
          value.color_scheme === "no-preference" ? "none" : value.color_scheme,
        );
      entry.requested = {
        ...entry.requested,
        ...Object.fromEntries(
          ["width", "height", "dpr", "touch", "userAgent", "color_scheme"]
            .filter((key) => value[key] != null)
            .map((key) => [key, value[key]]),
        ),
      };
      await this.env.wait(100);
      this.env.check(source, session);
    } catch (error) {
      this.restore(source);
      throw error;
    }
  }
}
