"use strict";

const zenMcpApp = typeof zenMcpName === "string" ? zenMcpName : "zen-mcp";
const zenMcpRuntimeDir = () =>
  Services.env.get("XDG_RUNTIME_DIR") || globalThis.zenMcpRuntime || Services.env.get("TMPDIR") || "/tmp";
const zenMcpSharedTemp = () => /\/(?:var\/)?tmp\/?$/.test(zenMcpRuntimeDir());
// why: Other users can plant symlinks at fixed names in a shared temp directory; use the private instance folder there.
const zenMcpFilesDir = () => {
  if (!zenMcpSharedTemp()) return zenMcpRuntimeDir();
  const home = Services.env.get("HOME");
  return `${zenMcpRuntimeDir()}/${zenMcpApp}-${[...home].reduce((hash, c) => (Math.imul(hash, 31) + c.codePointAt(0)) >>> 0, 0).toString(16)}`;
};

function logError(where, e) {
  const msg = `${new Date().toISOString()} ${where}: ${e}\n${e?.stack ?? ""}\n`;
  try {
    const f = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
    f.initWithPath(`${zenMcpFilesDir()}/${zenMcpApp}.log`);
    const out = Components.classes["@mozilla.org/network/file-output-stream;1"].createInstance(
      Components.interfaces.nsIFileOutputStream,
    );
    out.init(f, 0x02 | 0x08 | 0x10, 0o600, 0);
    const bytes = unescape(encodeURIComponent(msg));
    out.write(bytes, bytes.length);
    out.close();
  } catch {}
  // why: Surface startup errors in zenctl so a failed reload is immediately visible.
  if (where === "setup" || where === "start" || where === "reload") globalThis.zenMcpStartError ??= `${where}: ${e}`;
  Components.utils.reportError(e);
}

(function () {
  try {
    const { classes: Cc, interfaces: Ci, utils: Cu, results: Cr } = Components;
    const { NetUtil } = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");
    const { setTimeout, clearTimeout, setInterval, clearInterval } = ChromeUtils.importESModule(
      "resource://gre/modules/Timer.sys.mjs",
    );

    const dir = zenMcpDir;
    // why: The browser locale is for UI, while agent-visible errors and results use English.
    const L = (en, tr) => (Services.locale.appLocaleAsBCP47.startsWith("tr") ? tr : en);
    const dirURI = Services.io.newFileURI(localFile(dir)).spec.replace(/\/?$/, "/");
    const version = (globalThis.zenMcpVersion = (globalThis.zenMcpVersion || 0) + 1);
    const socketOverride = Services.env.get("ZEN_MCP_SOCKET");
    const configHome = Services.env.get("XDG_CONFIG_HOME") || Services.env.get("HOME") + "/.config";
    const stateHome = Services.env.get("XDG_STATE_HOME") || Services.env.get("HOME") + "/.local/state";

    function localFile(path) {
      const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      f.initWithPath(path);
      return f;
    }

    function readTextFile(file, length) {
      const stream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
      stream.init(file, 0x01, 0, 0);
      try {
        return NetUtil.readInputStreamToString(stream, length ?? stream.available(), { charset: "UTF-8" });
      } finally {
        stream.close();
      }
    }

    function writeTextFile(file, text, { append = false, atomic = false } = {}) {
      if (!file.parent.exists()) file.parent.create(Ci.nsIFile.DIRECTORY_TYPE, 0o700);
      const contract = atomic
        ? "@mozilla.org/network/safe-file-output-stream;1"
        : "@mozilla.org/network/file-output-stream;1";
      const out = Cc[contract].createInstance(Ci.nsIFileOutputStream);
      out.init(file, 0x02 | 0x08 | (append ? 0x10 : 0x20), 0o600, 0);
      const bytes = unescape(encodeURIComponent(text));
      out.write(bytes, bytes.length);
      if (atomic) out.QueryInterface(Ci.nsISafeOutputStream).finish();
      else out.close();
    }

    // why: Use the same fallback as Node so the client can discover the listener.
    if (!Services.env.get("XDG_RUNTIME_DIR") && Services.appinfo.OS === "Linux") {
      try {
        const uid = /^Uid:\s+\d+\s+(\d+)/m.exec(readTextFile(localFile("/proc/self/status"), 512))?.[1];
        if (uid && localFile(`/run/user/${uid}`).exists()) globalThis.zenMcpRuntime = `/run/user/${uid}`;
      } catch {}
    }

    Services.io
      .getProtocolHandler("resource")
      .QueryInterface(Ci.nsIResProtocolHandler)
      .setSubstitution("zenmcp", Services.io.newURI(dirURI));

    // why: The sandbox preference must be set before the first content process starts.
    {
      const pref = "security.sandbox.content.read_path_whitelist";
      const entries = Services.prefs.getStringPref(pref, "").split(",").filter(Boolean);
      if (!entries.includes(dir + "/")) {
        Services.prefs.getDefaultBranch("").setStringPref(pref, [...entries, dir + "/"].join(","));
      }
    }

    const load = (name) => ChromeUtils.importESModule(`resource://zenmcp/${name}.sys.mjs?v=${version}`);
    globalThis.zenMcpBrowserStart ||= Date.now();
    const { instanceSocket, browserIdentity } = load("Instances");
    const { profileLifecycle } = load("ProfileLifecycle");
    const listener = instanceSocket({
      socketOverride,
      runtime: zenMcpRuntimeDir(),
      app: zenMcpApp,
      localFile,
      writeTextFile,
      logError,
      setTimeout,
      clearTimeout,
      lifetime: (globalThis.zenMcpInstanceLifetime ??= {
        startedAt: globalThis.zenMcpBrowserStart,
        focusedAt: 0,
      }),
    });
    const { agentTheme, applyTheme, agentIcon, commonAgent } = load("Agent");
    const { TabAccess } = load("TabAccess");
    const { normalizeConfig, siteAllowed, siteEntry, isAutonomousMode, isTemporaryMode } = load("SiteRules");
    const { ScreenshotCache, VisualBaselines } = load("ScreenshotCache");
    const { ScreenshotHistory } = load("ScreenshotHistory");
    const { BrowserSettings, DEVICE_PRESETS } = load("BrowserSettings");
    const { clipboardShortcut, systemClipboard } = load("Clipboard");
    const { ExtensionPanels } = load("ExtensionPanels");
    const { ReadSnapshots, sameReadContext } = load("ReadSnapshots");
    const { Cancellation } = load("Cancellation");
    const { Locks } = load("Locks");
    const { TabActivity } = load("TabActivity");
    const { TabWake } = load("TabWake");
    const { config } = load("Config");
    const policy = load("Policy");
    const { sessionManager } = load("Sessions");
    const { tabWork } = load("TabWork");
    const { takeover } = load("Takeover");
    const { tabs, MARK, MARK_CSS } = load("Tabs");
    const { pageQueries, DialogOpen, PageGone } = load("PageQuery");
    const { pageInput, keyName, MAX_EDGE } = load("PageInput");
    const { control, Stopped, BRIDGE_STOPPED } = load("Control");
    const { activity } = load("Activity");
    const activityView = load("ActivityView");
    const { toolRunner, batchTool } = load("ToolRunner");
    const { tabTools } = load("TabTools");
    const { permissions } = load("Permissions");
    const { TabMenu } = load("TabMenu");
    const { Channels, ascii } = load("Channels");
    const { Inbox, inboxText, sendTargets, sentNotice } = load("Inbox");
    const { Picks } = load("Picks");
    const { SourceResolver } = load("SourceResolver");
    const { Recordings, RECORDING_KEY, STEP_TOPIC, captureStep } = load("Recordings");
    const { Recipes, recipeTools, geckoIO, originOf } = load("Recipes");
    const { ReviewModel } = load("RecordingReview");
    const { Demonstrations, demonstrationTools } = load("Demonstrations");
    const { NetworkLog } = load("NetworkLog");
    const { NetworkControl, networkControlTool } = load("NetworkControl");
    const { agentDataTools, assertAgentDataMode } = load("AgentData");
    const { Artifacts, pagePDF } = load("Artifacts");
    const { TabVideo, videoEnvironment, recordTool } = load("TabVideo");
    const { EventFiles } = load("EventFiles");
    const { DownloadLog } = load("DownloadLog");
    const { Watches } = load("Watches");
    const { readTools } = load("ReadTools");
    const { inputTools } = load("InputTools");
    const { browserTools } = load("BrowserTools");
    const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
    const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
    const { ViewPopup, isGloballyBlockingOpenPopup } = ChromeUtils.importESModule(
      "resource:///modules/ExtensionPopups.sys.mjs",
    );
    let SessionStore;
    try {
      ({ SessionStore } = ChromeUtils.importESModule(
        "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
      ));
    } catch {
      ({ SessionStore } = ChromeUtils.importESModule("resource:///modules/sessionstore/SessionStore.sys.mjs"));
    }

    const state = (globalThis.zenMcpState ||= { tabs: new Set() });
    state.pickedTabs ||= new Set();
    // why: Migrate old single-owner state on reload so existing access still works with shared tabs.
    if (state.owners && !state.tabMembers) {
      state.tabMembers = new Map();
      for (const [tabId, session] of state.owners) state.tabMembers.set(tabId, new Map([[session, 0]]));
    }
    for (const old of ["owners", "ownerVersions", "tabWork", "tabQueues", "tabHandoffs", "scale"]) delete state[old];
    const access = new TabAccess(
      (state.tabMembers ||= new Map()),
      (state.tabVersions ||= new Map()),
      (state.tabTasks ||= new Map()),
      (state.tabMemberships ||= { next: 1 }),
      (state.tabHolds ||= new Map()),
    );

    const ctx = {
      L,
      version,
      app: zenMcpApp,
      runtimeDir: zenMcpFilesDir(),
      logError,
      localFile,
      readTextFile,
      writeTextFile,
      setTimeout,
      clearTimeout,
      SessionStore,
      applyTheme,
      agentTheme,
      normalizeConfig,
      siteAllowedIn: siteAllowed,
      clipboardShortcut,
      Cancellation,
      DialogOpen,
      PageGone,
      Stopped,
      DownloadLog,
      Watches,
      DEVICE_PRESETS,
      MARK,
      keyName,
      sameReadContext,
      activityView,
      configPath: `${configHome}/${zenMcpApp}/config.json`,
      permissionsPath: `${configHome}/${zenMcpApp}/permissions.jsonc`,
      policy,
      activityPath: `${stateHome}/${zenMcpApp}/activity.jsonl`,
      browserStart: globalThis.zenMcpBrowserStart,
      MAX_PAGE_TEXT: 100000,
      MAX_UPLOAD: 100 * 1048576,

      state,
      access,
      sessions: (state.sessions ||= new Map()),
      sessionVersions: (state.sessionVersions ||= new Map()),
      lastUse: (globalThis.zenMcpLastUse ||= new Map()),
      refDocuments: (globalThis.zenMcpRefDocuments ||= { next: 1 }),
      ownerConnections: new Map(),
      disconnectTimers: new Map(),
      heldInputFrames: new Map(),
      tabRequests: new Map(),
      screenshots: new ScreenshotHistory((state.screenshots ||= new Map()), (state.screenshotIds ||= { next: 1 })),
      screenshotCache: new ScreenshotCache(),
      visualBaselines: new VisualBaselines(),
      readSnapshots: new ReadSnapshots(), // why: A snapshot taken by the old bridge is no longer a valid baseline after reload.
      tools: {},
      commands: {},

      // why: UI branding follows recent activity, while call identity comes from the call scope.
      lastAgent: agentTheme(globalThis.zenMcpActiveAgent ?? { id: "generic" }),
      locks: new Locks(),
      tabActivity: new TabActivity(),
      tabWake: new TabWake({
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        selected: (browser) => browser.ownerDocument?.defaultView?.gBrowser?.selectedBrowser === browser,
      }),
      calls: new Set(),
      stopGeneration: 0,
      island: null,
      shuttingDown: false,

      setLastAgent(theme) {
        ctx.lastAgent = theme;
        globalThis.zenMcpActiveAgent = { id: theme.id, name: theme.name };
        ctx.island?.setAgent(theme);
      },

      // why: A tab or its extension surface can recover the active scope when a helper has only a browser reference.
      callOf(browser) {
        for (const call of ctx.calls)
          if (call.extensionSurface?.browser === browser || call.tabs.has(browser?.browserId)) return call;
        return null;
      },

      // why: An extension surface inherits the source tab's permission and site checks.
      controlledSource(browser) {
        const call = ctx.callOf(browser);
        const surface = call?.extensionSurface;
        if (surface?.browser !== browser) return browser;
        ctx.extensionPanels.get(surface.source, call.session, surface.tabId, surface.extensionId);
        return surface.source;
      },
    };

    Object.assign(
      ctx,
      config(ctx),
      sessionManager(ctx),
      tabWork(ctx),
      takeover(ctx),
      tabs(ctx),
      pageQueries(ctx),
      pageInput(ctx),
      control(ctx),
      activity(ctx),
      systemClipboard(ctx),
      toolRunner(ctx),
    );
    Object.assign(ctx, permissions(ctx));

    ctx.extensionPanels = new ExtensionPanels({
      list: async () =>
        (await AddonManager.getAddonsByTypes(["extension"]))
          .filter((addon) => !addon.isSystem && !addon.hidden)
          .map((addon) => ({
            id: addon.id,
            name: addon.name,
            enabled: addon.isActive,
            hasToolbarAction: !!ExtensionParent.apiManager.global.browserActionFor?.(
              ExtensionParent.GlobalManager.extensionMap.get(addon.id),
            ),
          })),
      extension: (id) => ExtensionParent.GlobalManager.extensionMap.get(id),
      action: (extension) => ExtensionParent.apiManager.global.browserActionFor?.(extension),
      popup: (extension, win) => ViewPopup.for(extension, win),
      panelAllowed: (popup, id) =>
        popup.browser?.currentURI?.scheme === "moz-extension" &&
        ExtensionParent.WebExtensionPolicy.getByURI(popup.browser.currentURI)?.id === id,
      busy: (win) => isGloballyBlockingOpenPopup(win),
      check: (source, session) => {
        ctx.callOf(source)?.check();
        access.check(source.browserId, session);
        ctx.assertSiteAccess(source);
      },
      version: (source) => access.version(source.browserId),
      confirmSwitch: async (source, extension) => {
        if (ctx.gate("extensions.switch_tab")) return true;
        const context = ctx.permissionContext(source);
        const title = source.contentTitle || ctx.hostOf(source) || source.currentURI.spec;
        const call = ctx.callOf(source);
        const result = await ctx.askIsland(
          call,
          source,
          L("Switch tab for extension?", "Eklenti için sekme değiştirilsin mi?"),
          L(
            `${call.agent.name} needs to select “${title}” to use ${extension.name}. This will change the tab you are viewing.`,
            `${call.agent.name}, ${extension.name} eklentisini kullanmak için “${title}” sekmesine geçmek istiyor. Baktığın sekme değişecek.`,
          ),
          { ok: L("Switch tab", "Sekmeye geç"), cancel: L("Stay here", "Burada kal") },
        );
        call.check();
        if (!ctx.samePermissionContext(context, ctx.permissionContext(source)))
          throw new Error("The target or permission settings changed during the switch request; nothing was switched.");
        return result === "done";
      },
      wait: (ms, source) => ctx.operationSleep(ms, ctx.callOf(source)),
    });

    ctx.browserSettings = new BrowserSettings({
      check: (source, session) => {
        ctx.callOf(source)?.check();
        access.check(source.browserId, session);
        ctx.assertSiteAccess(source);
      },
      context: (source) =>
        JSON.stringify([
          source.currentURI.spec,
          access.version(source.browserId),
          ctx.readConfig(),
          ctx.permissionContext(source).policy,
        ]),
      wait: (ms, source) => ctx.operationSleep(ms, ctx.callOf(source)),
      geckoVersion: Services.appinfo.platformVersion.split(".").slice(0, 2).join("."),
      ask: async (source, args, value) => {
        if (ctx.gate("browser_settings.change")) return true;
        const target = source.contentTitle || ctx.hostOf(source) || source.currentURI.spec;
        // why: Name every field that change() will apply, not only the ones the action is named after.
        const parts = [
          value.width != null &&
            L(
              `the viewport to ${value.width}×${value.height}${args.action === "device" ? ` (${args.device}, Gecko emulation)` : ""}`,
              `görünüm alanını ${value.width}×${value.height}${args.action === "device" ? ` (${args.device}, Gecko benzetimi)` : ""}`,
            ),
          value.dpr != null && L(`pixel ratio ${value.dpr}`, `piksel oranını ${value.dpr}`),
          value.touch != null &&
            L(`touch ${value.touch ? "on" : "off"}`, `dokunmayı ${value.touch ? "açık" : "kapalı"}`),
          value.userAgent != null &&
            L(`user agent “${value.userAgent.slice(0, 160)}”`, `user agent'ı “${value.userAgent.slice(0, 160)}”`),
          value.color_scheme != null && L(`color scheme ${value.color_scheme}`, `renk temasını ${value.color_scheme}`),
        ].filter(Boolean);
        const details =
          args.action === "reset"
            ? L("restore this tab's original settings", "bu sekmenin önceki ayarlarını geri yüklemek")
            : L(`set ${parts.join(", ")}`, `${parts.join(", ")} yapmak`);
        const switching =
          source.ownerDocument.defaultView.gBrowser.selectedBrowser !== source && args.action !== "reset";
        const call = ctx.callOf(source);
        const name = call.agent.name;
        return (
          (await ctx.askIsland(
            call,
            source,
            L("Browser settings permission", "Tarayıcı ayarı izni"),
            L(
              `${name} wants to ${details} for “${target}”.${switching ? " This will select that tab." : ""}`,
              `${name}, “${target}” için ${details} istiyor.${switching ? " Bu sekmeye geçilecek." : ""}`,
            ),
            { ok: L("Apply once", "Bir kez uygula"), cancel: L("Deny", "Verme") },
          )) === "done"
        );
      },
    });

    const menuAgent = () =>
      ctx.picks.current?.agent ??
      commonAgent(ctx.sendTargets().map((t) => t.agent)) ??
      ctx.channels.target()?.agent ??
      ctx.lastAgent;

    function paintMenuIcon(item, agent) {
      const theme = agentTheme(agent);
      item.setAttribute("image", agentIcon(theme));
      item.setAttribute("data-zen-agent", theme.id);
      item.setAttribute("tooltiptext", theme.name);
    }

    ctx.tabMenu = new TabMenu({
      history: (tabId) => ctx.tabHistory(tabId),
      openHistory: (win) => ctx.openHistory(win),
      workspaces: (win) => ctx.workspaceNames(win),
      L,
      mark: MARK,
      menuAgent,
      paintIcon: paintMenuIcon,
      sessions: () => ctx.liveSessions(),
      memberNames: (tab) =>
        access
          .members(tab.linkedBrowser.browserId)
          .map((session) => ctx.sessions.get(session)?.name)
          .filter(Boolean)
          .join(", "),
      give: (tab, session) => {
        if (!ctx.sessions.has(session) || ctx.sessions.get(session).disconnected) return;
        ctx.mark(tab, tab.getAttribute(MARK) || "user", session);
      },
      takeBack: (tab) => ctx.unmark(tab),
      holdLabel: (tab) => {
        const hold = ctx.holdOf(tab.linkedBrowser.browserId);
        if (!hold) return null;
        const who = ctx.sessions.get(hold.session)?.name || hold.session.slice(-6);
        return `${who}: ${hold.reason.length > 60 ? hold.reason.slice(0, 59) + "…" : hold.reason}`;
      },
      releaseHold: (tab) => {
        ctx.access.release(tab.linkedBrowser.browserId);
        ctx.island?.refresh();
      },
      readConfig: () => ctx.readConfig(),
      writeConfig: (changes) => ctx.writeConfig(changes),
      setMode: (mode) => ctx.island?.setMode(mode),
      hasCustomPermissions: () => ctx.localFile(ctx.permissionsPath).exists(),
      hostOf: (browser) => ctx.hostOf(browser),
      siteEntry: (host) => siteEntry(host, ctx.readConfig().sites),
    });

    ctx.channels = new Channels(ctx.lastUse, {
      theme: agentTheme,
      connectOwner: (...args) => ctx.connectOwnerSession(...args),
      updateOwner: (...args) => ctx.updateOwnerSession(...args),
      sessionName: (...args) => ctx.sessionName(...args),
      disconnectOwner: (session, transport) => {
        if (!ctx.shuttingDown) ctx.disconnectOwnerSession(session, transport);
      },
      logError,
      setTimeout,
      clearTimeout,
      uuid: () => Services.uuid.generateUUID().toString(),
    });

    ctx.inbox = new Inbox({
      endpoint: (session) => {
        const sub = ctx.channels.subscribers.get(session);
        return sub?.ack && sub.push ? sub : null;
      },
      deliver: (sub, event) => ctx.channels.deliver(sub, event),
      known: (session) => ctx.sessions.has(session) && !ctx.sessions.get(session).disconnected,
      // why: When the session disappears, fall back to the clipboard so the user's pick survives.
      expired: (_session, items) =>
        Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(inboxText(items)),
      now: () => Date.now(),
    });
    ctx.inboxText = inboxText;

    ctx.sendTargets = () => sendTargets(ctx.liveSessions(), ctx.channels.subscribers.values(), L);
    ctx.sentNotice = (status, target) => sentNotice(status, target, L);

    ctx.picks = new Picks({
      L,
      channels: ctx.channels,
      inbox: ctx.inbox,
      targets: () => ctx.sendTargets(),
      sentNotice: (status, target) => ctx.sentNotice(status, target),
      theme: agentTheme,
      pickedTabs: state.pickedTabs,
      get island() {
        return ctx.island;
      },
      maxEdge: MAX_EDGE,
      shotsDir: `${zenMcpFilesDir()}/${zenMcpApp}-picks`,
      hasAccess: (browserId, session) => access.has(browserId, session),
      assertSiteAccess: (browser) => ctx.assertSiteAccess(browser),
      logError,
      sleep: (ms) => ctx.sleep(ms),
      copy: (value) => Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(value),
      paintIcon: paintMenuIcon,
      menuAgent,
      // why: Limit source map fetches to the origin of the picked page.
      sources: new SourceResolver({
        siteAllowed: (host) => ctx.siteAllowed(host),
        sleep: (ms) => ctx.sleep(ms),
        budgetMs: 2000,
        fetchText: async (url) => {
          const win = Services.wm.getMostRecentWindow("navigator:browser");
          const response = await win.fetch(url, { credentials: "omit", redirect: "error" });
          const max = 50e6;
          if (!response.ok || Number(response.headers.get("content-length")) > max)
            throw new Error(`HTTP ${response.status}`);
          const reader = response.body.getReader();
          const decoder = new win.TextDecoder();
          let text = "",
            size = 0;
          for (let chunk; !(chunk = await reader.read()).done;) {
            size += chunk.value.byteLength;
            if (size > max) {
              reader.cancel().catch(() => {});
              throw new Error("Response too large");
            }
            text += decoder.decode(chunk.value, { stream: true });
          }
          return text + decoder.decode();
        },
      }),
    });

    ctx.recordings = new Recordings({
      setShared: (browserIds) => {
        Services.ppmm.sharedData.set(RECORDING_KEY, browserIds);
        Services.ppmm.sharedData.flush();
      },
      now: () => Date.now(),
      capture: (step) => captureStep({ ...step, color: ctx.lastAgent.accent }),
    });
    ctx.recipes = new Recipes({ dir: `${stateHome}/${zenMcpApp}/recipes`, io: geckoIO });
    ctx.ReviewModel = ReviewModel;
    ctx.originOf = originOf;
    ctx.fileURL = (path) => Services.io.newFileURI(localFile(path)).spec;
    const onRecordStep = (_subject, _topic, data) => {
      try {
        ctx.recordings.accept(JSON.parse(data));
      } catch (e) {
        logError("record", e);
      }
    };

    ctx.demonstrations = new Demonstrations({
      L,
      ctx,
      channels: ctx.channels,
      assertSiteAccess: (browser) => ctx.assertSiteAccess(browser),
      copy: (value) => Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(value),
      logError,
      paintIcon: paintMenuIcon,
      menuAgent,
    });

    ctx.assertAgentDataMode = assertAgentDataMode;
    ctx.artifacts = new Artifacts(`${zenMcpFilesDir()}/${zenMcpApp}-artifacts`, { setTimeout });
    ctx.video = new TabVideo(videoEnvironment(ctx));
    ctx.networkControl = new NetworkControl();
    const { HarCapture, validateHarProjection } = load("HarCapture");
    ctx.validateHarProjection = validateHarProjection;
    const harDir = `${zenMcpFilesDir()}/zen-mcp-har`;
    ctx.har = new HarCapture({
      allowed: (tabId, session, host) => !state.paused && access.has(tabId, session) && ctx.siteAllowed(host),
      setTimeout,
      clearTimeout,
      dir: harDir,
    });
    ctx.network = new NetworkLog((globalThis.zenMcpNetwork ||= new Map()), {
      projectBody: (channel, tabId, entry) => ctx.har.projectBody(tabId, channel, entry),
      capture: (channel, browserId, type, topic) => {
        try {
          ctx.har.observe(channel, browserId, type, topic);
        } catch (error) {
          logError("HAR capture", error);
        }
      },
      tracked: (browserId) => state.tabs.has(browserId),
      unrecorded: (browserId) => ctx.takenOver(browserId),
      control: (channel, id, topDocument) => {
        if (!ctx.networkControl.has(id)) return null;
        const tab = ctx.findTab(id);
        if (tab?.getAttribute(MARK) !== "true") return null;
        // why: Match first, because matching also drops rules left from another origin.
        const decision = ctx.networkControl.match(
          id,
          channel.URI.spec,
          channel.URI.prePath,
          tab.linkedBrowser.currentURI.prePath,
          topDocument,
        );
        // why: Rules approved for a site stop applying once the user blocks that site.
        return ctx.siteAllowed(ctx.hostOf(tab.linkedBrowser)) ? decision : null;
      },
      // why: Allowlisted pages need third-party resources such as CDNs, so only document loads are filtered.
      blocked: (browserId, host, document) => {
        const call = [...ctx.calls].find((c) => c.tabs.has(browserId));
        if (!call || ctx.siteAllowed(host)) return false;
        if (!document && ctx.readConfig().sites.mode === "allowlist") return false;
        try {
          ctx.assertSiteHost(host);
        } catch (e) {
          call.cancel(e);
        }
        return true;
      },
    });

    const eventFiles = (name) =>
      new EventFiles({
        dir: `${zenMcpFilesDir()}/${zenMcpApp}-${name}`,
        setTimeout,
        logError,
      });

    ctx.downloads = new DownloadLog((globalThis.zenMcpDownloads ||= {}), {
      tracked: (browserId) => state.tabs.has(browserId),
      events: eventFiles("downloads"),
    });

    ctx.watches = new Watches({
      events: eventFiles("watch"),
      owned: (tabId, session) => {
        const tab = ctx.findTab(tabId);
        return tab && state.tabs.has(tabId) && access.has(tabId, session) ? tab.linkedBrowser : null;
      },
      check: async (browser, condition) => !!(await ctx.acrossFrames(browser, "check", condition, (value) => value)),
      sample: (browser, selector) => ctx.acrossFrames(browser, "sample", { selector }, (value) => value != null),
      paused: (tabId) => ctx.takenOver(tabId),
      assertSite: (browser) => ctx.assertSiteAccess(browser),
      wake: (browser) => ctx.tabWake.hold(browser),
      held: (tabId, session) => {
        if (!access.shared(tabId) || !ctx.findTab(tabId)) return "gone";
        const hold = ctx.holdOf(tabId);
        return ctx.takenOver(tabId) || (hold && hold.session !== session) ? "held" : "free";
      },
      setTimeout,
      clearTimeout,
    });

    Object.assign(
      ctx.tools,
      tabTools(ctx),
      batchTool(ctx),
      readTools(ctx),
      inputTools(ctx),
      browserTools(ctx),
      agentDataTools(ctx),
      { save_pdf: pagePDF(ctx), record: recordTool(ctx), network_control: networkControlTool(ctx) },
      recipeTools(ctx),
      demonstrationTools(ctx),
    );

    function fileVersion() {
      try {
        const f = localFile(dir + "/.version");
        return f.exists() ? readTextFile(f).trim() : "dev";
      } catch {
        return "?";
      }
    }
    const loadedVersion = fileVersion();

    // why: Keep development commands out of the MCP tool surface.
    Object.assign(ctx.commands, {
      // why: Use the client's conversation ID because the prompt hook does not know the bridge session ID.
      inbox_take({ client, clientSession, pids }) {
        let session = null;
        if (client === "codex") session = clientSession ? `codex:${clientSession}` : null;
        else {
          const ancestors = new Set(Array.isArray(pids) ? pids : []);
          for (const sub of ctx.channels.subscribers.values())
            if (clientSession && sub.clientSession === clientSession) session = sub.id;
          // why: Use the Antigravity ancestor PID because it supplies no conversation ID to its MCP process.
          if (!session)
            for (const sub of ctx.channels.subscribers.values())
              if (!sub.clientSession && sub.clientPid && ancestors.has(sub.clientPid)) session = sub.id;
        }
        return ctx.text(session ? ctx.inboxText(ctx.inbox.take(session)) : "");
      },
      ping() {
        return ctx.text({
          app: zenMcpApp,
          dir,
          version: loadedVersion,
          bridge: version,
          startError: globalThis.zenMcpStartError,
          onDisk: fileVersion(),
          browser: Services.appinfo.name,
          browserVersion: Services.appinfo.version,
        });
      },
      reload() {
        // why: Reload closes this connection, so send the reply first.
        Services.tm.dispatchToMainThread(() => {
          stop();
          delete globalThis.zenMcpStartError;
          try {
            Services.scriptloader.loadSubScript("resource://zenmcp/main.js?" + Date.now(), {
              zenMcpDir: dir,
              zenMcpName: zenMcpApp,
            });
          } catch (e) {
            logError("reload", e);
          }
          // why: Recover the previous bridge after a failed reload so the browser remains reachable.
          if (!(globalThis.zenMcpRunning > version)) {
            logError("reload", new Error(`new version did not start, staying on v${version}`));
            try {
              globalThis.zenMcpStop?.();
            } catch {}
            start();
            globalThis.zenMcpStop = stop;
            globalThis.zenMcpRunning = version;
          }
        });
        return ctx.text(`v${version} stopping, reloading.`);
      },
      // why: Treat development eval input as an expression so results can be returned directly.
      async chrome_eval({ code }) {
        const sandbox = Cu.Sandbox(Services.scriptSecurityManager.getSystemPrincipal(), {
          sandboxName: "zen-mcp chrome_eval",
          wantComponents: true,
          wantGlobalProperties: ["ChromeUtils"],
        });
        sandbox.Services = Services;
        sandbox.h = {
          __proto__: ctx,
          prepareTabMenu: (win, tabs) => ctx.tabMenu.prepare(win, tabs),
          subscribers: ctx.channels.subscribers,
          channelTarget: () => ctx.channels.target(),
          startPick: (...args) => ctx.picks.start(...args),
          sendPick: (...args) => ctx.picks.send(...args),
          endPick: () => ctx.picks.end(),
          pageQuery: (...args) => ctx.picks.pageQuery(...args),
          get pick() {
            return ctx.picks.current;
          },
        };
        const value = await Cu.evalInSandbox(`(async () => (${code}))()`, sandbox, null, "chrome_eval", 1);
        return ctx.text(value === undefined ? "undefined" : value);
      },
    });

    ctx.reply = (transport, output, message) => {
      const stream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
      stream.setByteStringData(ascii(JSON.stringify(message)) + "\n");
      NetUtil.asyncCopy(stream, output, () => transport.close(Cr.NS_OK));
    };

    let lifecycle;
    function onConnection(transport) {
      const input = transport.openInputStream(0, 0, 0);
      // why: Buffered output could be truncated on close (docs/gecko-pitfalls.md, Sockets and streams).
      const output = transport.openOutputStream(Ci.nsITransport.OPEN_UNBUFFERED, 0, 0);
      const pump = Cc["@mozilla.org/network/input-stream-pump;1"].createInstance(Ci.nsIInputStreamPump);
      pump.init(input, 0, 0, false);
      let buffer = "";
      let handled = false;
      let session = null;
      let leased = false;
      pump.asyncRead({
        onStartRequest() {},
        onDataAvailable(_request, stream, _offset, count) {
          buffer += NetUtil.readInputStreamToString(stream, count);
          let end;
          while ((end = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, end);
            buffer = buffer.slice(end + 1);
            let request = null;
            try {
              request = JSON.parse(line);
            } catch {}
            if (leased) {
              if (request?.event === "release") lifecycle?.release(transport);
              continue;
            }
            if (session) {
              if (request?.event === "update") ctx.channels.update(session, transport, request);
              else ctx.channels.acknowledge(session, transport, request);
              continue;
            }
            if (handled) return;
            handled = true;
            if (request?.tool === "profile_lease") {
              try {
                if (!lifecycle) throw new Error("This browser is not managed by the MCP launcher.");
                lifecycle.connect(transport, request.owner);
                leased = true;
                const reply = '{"ok":true}\n';
                output.write(reply, reply.length);
              } catch (e) {
                ctx.reply(transport, output, { ok: false, error: String(e?.message ?? e) });
              }
              continue;
            }
            if (request?.tool !== "subscribe") {
              ctx.handle(line, transport, output);
              return;
            }
            try {
              session = ctx.channels.subscribe(request.args ?? {}, transport, output);
            } catch (e) {
              ctx.reply(transport, output, { ok: false, error: String(e?.message ?? e) });
            }
          }
        },
        onStopRequest() {
          if (leased) lifecycle?.disconnect(transport);
          if (session) ctx.channels.unsubscribe(session, transport);
        },
      });
    }

    const markSheet = Services.io.newURI("data:text/css;charset=utf-8," + encodeURIComponent(MARK_CSS));
    const sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);

    function attachWindow(win) {
      listener.attach(win);
      ctx.island?.attach(win);
      ctx.tabMenu.attach(win);
      ctx.picks.attachPageMenu(win);
      ctx.demonstrations.attachPageMenu(win);
    }

    // why: Lazy tab data can arrive after Gecko startup events (docs/gecko-pitfalls.md, Browser UI and session store).
    const onWindowReady = (win) => {
      ctx.watchWindow(win);
      attachWindow(win);
      for (const delay of [0, 2000, 5000, 10000, 20000]) {
        setTimeout(() => {
          try {
            ctx.restoreMarks();
          } catch (e) {
            logError("restoreMarks", e);
          }
        }, delay);
      }
    };

    let server = null;
    let sessionSweep = null;

    function start() {
      const file = listener.prepare();
      if (zenMcpSharedTemp()) {
        const files = localFile(zenMcpFilesDir());
        if (!files.exists()) files.create(Ci.nsIFile.DIRECTORY_TYPE, 0o700);
        if (files.isSymlink() || !files.isDirectory() || files.permissions & 0o077)
          throw new Error(`Private runtime folder must be a 0700 directory: ${files.path}`);
      }
      ctx.shuttingDown = false;
      sss.loadAndRegisterSheet(markSheet, sss.USER_SHEET);
      const { Island } = load("Island");
      ctx.island = new Island(
        {
          stop: () => ctx.stopClaude(),
          resume: () => ctx.resumeClaude(),
          goTo: (browser) => ctx.goToTab(browser),
          answer: (...args) => ctx.answerIsland(...args),
          pick: (win, options) => ctx.picks.start(win, options),
          send: (note, targetId, elementNotes) =>
            ctx.picks.send(note, targetId, elementNotes).catch((e) => logError("send", e)),
          selectTarget: (target) => ctx.picks.selectTarget(target),
          cancelPick: () => ctx.picks.end(),
          toggleMode: () => ctx.toggleMode(),
          holdOf: (browser) => {
            const hold = ctx.holdOf(browser.browserId);
            return hold ? { session: hold.session, ...ctx.describeHold(browser.browserId, hold, null) } : null;
          },
          releaseHold: (browser) => ctx.access.release(browser.browserId),
          takeover: (browser) => ctx.takeoverOf(browser),
          takeOver: (browser) => ctx.takeOver(browser),
          giveBack: (browser, note) => ctx.giveBack(browser, note),
        },
        { setTimeout, clearTimeout },
      );
      for (const win of ctx.browserWindows()) attachWindow(win);
      if (state.paused) ctx.island.stopped();
      ctx.island.setMode(ctx.readConfig().mode);
      ctx.network.start();
      ctx.artifacts.sweep().catch((e) => logError("exported files", e));
      // why: Sweep temporary captures left by a reload or restart that interrupted recording.
      Promise.resolve()
        .then(() => ctx.recipes.io.remove(`${zenMcpFilesDir()}/${zenMcpApp}-recordings`))
        .catch(() => {});
      ctx.downloads.start().catch((e) => logError("downloads", e));
      ctx.watches.env.events.start().catch((e) => logError("watch", e));
      ctx.restoreMarks();
      ctx.awaitReconnects();
      const sweep = () => {
        ctx.sweepSessions();
        sessionSweep = setTimeout(sweep, 60_000);
      };
      sweep();
      for (const win of ctx.browserWindows()) ctx.watchWindow(win);
      Services.obs.addObserver(onWindowReady, "browser-delayed-startup-finished");
      Services.obs.addObserver(onRecordStep, STEP_TOPIC);
      try {
        ChromeUtils.unregisterWindowActor("ZenMcp");
      } catch {}
      ChromeUtils.registerWindowActor("ZenMcp", {
        parent: { esModuleURI: `resource://zenmcp/actors/ZenMcpParent.sys.mjs?v=${version}` },
        child: {
          esModuleURI: `resource://zenmcp/actors/ZenMcpChild.sys.mjs?v=${version}`,
          events: {
            contextmenu: { capture: true, mozSystemGroup: true },
            DOMContentLoaded: { capture: true, mozSystemGroup: true },
            pageshow: { capture: true, mozSystemGroup: true },
            pagehide: { capture: true, mozSystemGroup: true },
            click: { capture: true, mozSystemGroup: true },
            change: { capture: true, mozSystemGroup: true },
            keydown: { capture: true, mozSystemGroup: true },
            input: { capture: true, mozSystemGroup: true },
          },
        },
        // why: The actor's only outbound message is an untrusted recorded step; accept it only for a recorded tab.
        safeForUntrustedWebProcess: true,
        allFrames: true,
      });

      const socket = Cc["@mozilla.org/network/server-socket;1"].createInstance(Ci.nsIServerSocket);
      socket.initWithFilename(file, 0o600, -1);
      server = socket;
      try {
        server.asyncListen({
          onSocketAccepted(_server, transport) {
            try {
              onConnection(transport);
            } catch (e) {
              logError("connection", e);
            }
          },
          onStopListening() {},
        });
        const identity = browserIdentity(`${stateHome}/${zenMcpApp}/profiles`, localFile);
        ctx.browserMode = identity.browserMode;
        ctx.autonomous = isAutonomousMode(identity.browserMode);
        if (identity.launchedByMcp && identity.browserMode !== "together") {
          lifecycle = profileLifecycle({
            temporary: isTemporaryMode(identity.browserMode),
            owner: identity.profileOwner,
            setTimeout,
            clearTimeout,
            quit: () => Services.startup.quit(Ci.nsIAppStartup.eForceQuit),
          });
          lifecycle.start();
        }
        listener.publish(loadedVersion, version, identity);
        Services.obs.addObserver(stop, "quit-application");
      } catch (e) {
        lifecycle?.stop();
        lifecycle = null;
        listener.stop(true);
        server.close();
        server = null;
        throw e;
      }
    }

    function stop() {
      try {
        Services.obs.removeObserver(stop, "quit-application");
      } catch {}
      lifecycle?.stop();
      lifecycle = null;
      listener.stop(!!server);
      try {
        server?.close();
      } catch {}
      server = null;
      ctx.shuttingDown = true;
      ctx.releaseAllInputs();
      ctx.browserSettings.destroy();
      ctx.extensionPanels.destroy();
      ctx.tabWake.destroy();
      clearTimeout(sessionSweep);
      ctx.cancelCalls(BRIDGE_STOPPED);
      ctx.picks.destroy();
      ctx.demonstrations.destroy();
      ctx.channels.closeAll();
      ctx.closeConnections();
      try {
        sss.unregisterSheet(markSheet, sss.USER_SHEET);
      } catch {}
      try {
        ctx.island?.destroy();
      } catch {}
      ctx.island = null;
      ctx.tabMenu.destroy();
      ctx.network.stop();
      ctx.networkControl.clear();
      ctx.video.stopAll();
      ctx.har.dropAll();
      ctx.downloads.stop();
      ctx.watches.endAll("bridge reloaded");
      try {
        Services.obs.removeObserver(onWindowReady, "browser-delayed-startup-finished");
      } catch {}
      try {
        Services.obs.removeObserver(onRecordStep, STEP_TOPIC);
      } catch {}
      ctx.recordings.stopAll();
      for (const win of ctx.browserWindows()) ctx.unwatchWindow(win);
      try {
        ChromeUtils.unregisterWindowActor("ZenMcp");
      } catch {}
      delete globalThis.zenMcpStop;
    }

    globalThis.zenMcpStop?.();
    globalThis.zenMcpStop = stop;

    const safeStart = () => {
      try {
        start();
        globalThis.zenMcpRunning = version;
      } catch (e) {
        logError("start", e);
      }
    };
    // why: On a reload the startup topics have already fired, so waiting for them would never start.
    if (ctx.browserWindows().length || globalThis.zenMcpRunning !== undefined) safeStart();
    else {
      // why: A dedicated bridge must have a usable window before clients discover it.
      const dedicated = Services.env.get("ZEN_MCP_LAUNCHED") === "1" && Services.env.get("ZEN_MCP_LAUNCHED_PROFILE");
      const topic = dedicated ? "browser-delayed-startup-finished" : "final-ui-startup";
      const observer = () => {
        Services.obs.removeObserver(observer, topic);
        safeStart();
      };
      Services.obs.addObserver(observer, topic);
    }
  } catch (e) {
    logError("setup", e);
  }
})();
