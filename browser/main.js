// The browser side of zen-mcp. The autoconfig loader runs this file with system privileges
// through loadSubScript; its scope has zenMcpDir (this folder's real path) and zenMcpName (the
// package name, used in paths).
//
// It listens on $XDG_RUNTIME_DIR/<name>.sock: one JSON request line per connection, answered
// with one JSON line before the connection closes. Mouse and keyboard events come from each
// frame's actor, as Zen's own WebDriver code does: the page sees trusted input and, since the
// remote agent never starts, navigator.webdriver stays false.
//
// The work happens in the .sys.mjs modules next to this file. They share one `ctx` object:
// each module's factory adds its functions to it and calls the others through it, so a module
// can be tested with fakes for everything else. This file wires them together, owns the
// socket and handles start, stop and "reload" (which reads this file again without
// restarting the browser).
"use strict";

// Zen's stderr usually goes to /dev/null and autoconfig runs before the console is ready, so
// errors are also written to $XDG_RUNTIME_DIR/<name>.log.
const zenMcpApp = typeof zenMcpName === "string" ? zenMcpName : "zen-mcp";
// macOS has no XDG_RUNTIME_DIR; TMPDIR is per user there.
const zenMcpRuntimeDir = () => Services.env.get("XDG_RUNTIME_DIR") || Services.env.get("TMPDIR") || "/tmp";

function logError(where, e) {
  const msg = `${new Date().toISOString()} ${where}: ${e}\n${e?.stack ?? ""}\n`;
  try {
    const f = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
    f.initWithPath(`${zenMcpRuntimeDir()}/${zenMcpApp}.log`);
    const out = Components.classes["@mozilla.org/network/file-output-stream;1"].createInstance(
      Components.interfaces.nsIFileOutputStream,
    );
    out.init(f, 0x02 | 0x08 | 0x10, 0o600, 0); // write | create | append
    const bytes = unescape(encodeURIComponent(msg));
    out.write(bytes, bytes.length);
    out.close();
  } catch {}
  // A failed reload shouldn't stay only in the log: zenctl ping shows the first setup error.
  if (where === "setup" || where === "start" || where === "reload") globalThis.zenMcpStartError ??= `${where}: ${e}`;
  Components.utils.reportError(e);
}

(function () {
  try {
    const { classes: Cc, interfaces: Ci, utils: Cu, results: Cr } = Components;
    const { NetUtil } = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");
    // A bare nsITimer without a reference may be garbage collected before it fires.
    const { setTimeout, clearTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");

    const dir = zenMcpDir;
    // UI language: Turkish if the browser is Turkish, English otherwise. Messages to agents
    // (errors, tool results) are always English.
    const L = (en, tr) => (Services.locale.appLocaleAsBCP47.startsWith("tr") ? tr : en);
    const dirURI = Services.io.newFileURI(localFile(dir)).spec.replace(/\/?$/, "/");
    const version = (globalThis.zenMcpVersion = (globalThis.zenMcpVersion || 0) + 1);
    // ZEN_MCP_SOCKET: a second browser of the same user (demo, tests) listens on its own socket
    const socketPath = Services.env.get("ZEN_MCP_SOCKET") || `${zenMcpRuntimeDir()}/${zenMcpApp}.sock`;
    const configHome = Services.env.get("XDG_CONFIG_HOME") || Services.env.get("HOME") + "/.config";
    const stateHome = Services.env.get("XDG_STATE_HOME") || Services.env.get("HOME") + "/.local/state";

    function localFile(path) {
      const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      f.initWithPath(path);
      return f;
    }

    function readTextFile(file) {
      const stream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
      stream.init(file, 0x01, 0, 0);
      try {
        return NetUtil.readInputStreamToString(stream, stream.available(), { charset: "UTF-8" });
      } finally {
        stream.close();
      }
    }

    // Private (0600) file in a private (0700) folder; replaces the file unless append is set.
    function writeTextFile(file, text, { append = false } = {}) {
      if (!file.parent.exists()) file.parent.create(Ci.nsIFile.DIRECTORY_TYPE, 0o700);
      const out = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
      out.init(file, 0x02 | 0x08 | (append ? 0x10 : 0x20), 0o600, 0); // write | create | append or truncate
      const bytes = unescape(encodeURIComponent(text));
      out.write(bytes, bytes.length);
      out.close();
    }

    // ---- setup: zen.cfg already mapped resource://zenmcp/ (loadSubScript rejects file://);
    // doing it again here covers reloads and manual loading ----

    Services.io
      .getProtocolHandler("resource")
      .QueryInterface(Ci.nsIResProtocolHandler)
      .setSubstitution("zenmcp", Services.io.newURI(dirURI));

    // Content processes are sandboxed; allow them to read the actor module. Set on the default
    // branch (not written to prefs.js), before the first content process starts.
    {
      const pref = "security.sandbox.content.read_path_whitelist";
      const entries = Services.prefs.getStringPref(pref, "").split(",").filter(Boolean);
      if (!entries.includes(dir + "/")) {
        Services.prefs.getDefaultBranch("").setStringPref(pref, [...entries, dir + "/"].join(","));
      }
    }

    // ?v= makes a reload load the new module versions instead of the cached ones.
    const load = (name) => ChromeUtils.importESModule(`resource://zenmcp/${name}.sys.mjs?v=${version}`);
    const { agentTheme, applyTheme, agentIcon, commonAgent } = load("Agent");
    const { TabAccess } = load("TabAccess");
    const { normalizeConfig, siteAllowed, siteEntry } = load("SiteRules");
    const { ScreenshotCache } = load("ScreenshotCache");
    const { BrowserSettings, DEVICE_PRESETS } = load("BrowserSettings");
    const { clipboardShortcut, systemClipboard } = load("Clipboard");
    const { ExtensionPanels } = load("ExtensionPanels");
    const { ReadSnapshots, sameReadContext } = load("ReadSnapshots");
    const { Cancellation } = load("Cancellation");
    const { Locks } = load("Locks");
    const { TabActivity } = load("TabActivity");
    const { config } = load("Config");
    const policy = load("Policy");
    const { sessionManager } = load("Sessions");
    const { tabWork } = load("TabWork");
    const { tabs, MARK, MARK_CSS } = load("Tabs");
    const { pageQueries, DialogOpen, PageGone } = load("PageQuery");
    const { pageInput, keyName, MAX_EDGE } = load("PageInput");
    const { control, Stopped } = load("Control");
    const { activity } = load("Activity");
    const activityView = load("ActivityView");
    const { toolRunner, batchTool } = load("ToolRunner");
    const { tabTools } = load("TabTools");
    const { permissions } = load("Permissions");
    const { TabMenu } = load("TabMenu");
    const { Channels, ascii } = load("Channels");
    const { Inbox, inboxText, sendTargets, sentNotice } = load("Inbox");
    const { Picks } = load("Picks");
    const { Recordings, RECORDING_KEY, STEP_TOPIC, captureStep } = load("Recordings");
    const { Recipes, recipeTools, geckoIO, originOf } = load("Recipes");
    const { ReviewModel } = load("RecordingReview");
    const { Demonstrations, demonstrationTools } = load("Demonstrations");
    const { NetworkLog } = load("NetworkLog");
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
    const { SessionStore } = ChromeUtils.importESModule(
      "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
    );

    // ---- state that survives reloads (kept on this scope's global) ----

    const state = (globalThis.zenMcpState ||= { tabs: new Set(), scale: new Map() });
    // Tabs where the user picked an element for an agent: agents may ask only for these.
    state.pickedTabs ||= new Set();
    // A bridge from before shared tabs had one owner per tab: each owner becomes a member.
    if (state.owners && !state.tabMembers) {
      state.tabMembers = new Map();
      for (const [tabId, session] of state.owners) state.tabMembers.set(tabId, new Map([[session, 0]]));
    }
    for (const old of ["owners", "ownerVersions", "tabWork", "tabQueues", "tabHandoffs"]) delete state[old];
    const access = new TabAccess(
      (state.tabMembers ||= new Map()),
      (state.tabVersions ||= new Map()),
      (state.tabTasks ||= new Map()),
      (state.tabMemberships ||= { next: 1 }),
      (state.tabHolds ||= new Map()),
    );
    globalThis.zenMcpBrowserStart ||= Date.now();

    const ctx = {
      // environment
      L,
      version,
      app: zenMcpApp,
      runtimeDir: zenMcpRuntimeDir(),
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

      // shared state
      state,
      access,
      sessions: (state.sessions ||= new Map()),
      sessionVersions: (state.sessionVersions ||= new Map()),
      lastUse: (globalThis.zenMcpLastUse ||= new Map()), // session → last tool call
      frameNumbers: (globalThis.zenMcpFrames ||= { byId: new Map(), byNumber: new Map(), next: 1 }),
      ownerConnections: new Map(),
      disconnectTimers: new Map(),
      heldInputFrames: new Map(),
      tabRequests: new Map(), // browser → resolve of the pending island question
      screenshotCache: new ScreenshotCache(),
      readSnapshots: new ReadSnapshots(), // A reload deliberately invalidates previous snapshot IDs.
      tools: {},
      commands: {},

      // The agent the island and menus show: the one that made the latest tool call. Never the
      // identity of a call; each call carries its own (see ToolRunner.sys.mjs).
      lastAgent: agentTheme(globalThis.zenMcpActiveAgent ?? { id: "generic" }),
      locks: new Locks(), // per-tab, exclusive and recording locks (ToolRunner.sys.mjs)
      tabActivity: new TabActivity(), // what each session did in shared tabs (meanwhile)
      calls: new Set(), // running tool calls: Cancellation scopes with session, agent and tabs
      stopGeneration: 0,
      island: null,
      shuttingDown: false,

      setLastAgent(theme) {
        ctx.lastAgent = theme;
        globalThis.zenMcpActiveAgent = { id: theme.id, name: theme.name };
        ctx.island?.setAgent(theme); // only where no agent of its own applies (cards and rows have theirs)
      },

      // The tool call working in this tab or in its extension popup. Helpers that get a browser
      // find their call here instead of taking it as a parameter.
      callOf(browser) {
        for (const call of ctx.calls)
          if (call.extensionSurface?.browser === browser || call.tabs.has(browser?.browserId)) return call;
        return null;
      },

      // While an extension popup is the call's surface, its tab is the source of truth for
      // access and site checks.
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
      tabs(ctx),
      pageQueries(ctx),
      pageInput(ctx),
      control(ctx),
      activity(ctx),
      systemClipboard(ctx),
      toolRunner(ctx),
    );
    Object.assign(ctx, permissions(ctx));

    // ---- browser components ----

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
      context: (source) => JSON.stringify([source.currentURI.spec, access.version(source.browserId), ctx.readConfig()]),
      wait: (ms, source) => ctx.operationSleep(ms, ctx.callOf(source)),
      geckoVersion: Services.appinfo.platformVersion.split(".").slice(0, 2).join("."),
      ask: async (source, args, value) => {
        if (ctx.gate("browser_settings.change")) return true;
        const target = source.contentTitle || ctx.hostOf(source) || source.currentURI.spec;
        const details =
          args.action === "reset"
            ? L("restore this tab's original settings", "bu sekmenin önceki ayarlarını geri yüklemek")
            : args.action === "media"
              ? L(`set color scheme to ${value.color_scheme}`, `renk temasını ${value.color_scheme} yapmak`)
              : L(
                  `set the viewport to ${value.width}×${value.height}${args.action === "device" ? ` (${args.device}, Gecko emulation)` : ""}`,
                  `görünüm alanını ${value.width}×${value.height} yapmak${args.action === "device" ? ` (${args.device}, Gecko benzetimi)` : ""}`,
                );
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

    // The agent shown on menu items that choose a session: the pick's target, the agent all
    // connected sessions share ("multi" when they differ), the channel target, or the active agent.
    const menuAgent = () =>
      ctx.picks.current?.agent ??
      commonAgent(ctx.sendTargets().map((t) => t.agent)) ??
      ctx.channels.target()?.agent ??
      ctx.lastAgent;

    // Also used by the page menu's "Show to agent…" item.
    function paintMenuIcon(item, agent) {
      const theme = agentTheme(agent);
      item.setAttribute("image", agentIcon(theme));
      item.setAttribute("data-zen-agent", theme.id);
      item.setAttribute("tooltiptext", theme.name);
    }

    // "Take back from agent / Give to session" and agent permissions in the tab context menu.
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

    // Pushing events to agent sessions.
    ctx.channels = new Channels(ctx.lastUse, {
      theme: agentTheme,
      connectOwner: (...args) => ctx.connectOwnerSession(...args),
      sessionName: (...args) => ctx.sessionName(...args),
      disconnectOwner: (session, transport) => {
        if (!ctx.shuttingDown) ctx.disconnectOwnerSession(session, transport);
      },
      logError,
      setTimeout,
      clearTimeout,
      uuid: () => Services.uuid.generateUUID().toString(),
    });

    // What the user sends to a session: pushed now when its MCP process can, otherwise with the
    // session's next tool result.
    ctx.inbox = new Inbox({
      endpoint: (session) => {
        const sub = ctx.channels.subscribers.get(session);
        return sub?.ack && sub.push ? sub : null;
      },
      deliver: (sub, event) => ctx.channels.deliver(sub, event),
      known: (session) => ctx.sessions.has(session) && !ctx.sessions.get(session).disconnected,
      // the session ended before it could get them: the clipboard, so nothing is lost
      expired: (_session, items) =>
        Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(inboxText(items)),
      now: () => Date.now(),
    });
    ctx.inboxText = inboxText;

    ctx.sendTargets = () => sendTargets(ctx.liveSessions(), ctx.channels.subscribers.values(), L);
    ctx.sentNotice = (status, target) => sentNotice(status, target, L);

    // Picking elements and sending them to an agent: Ctrl+Shift+F or the page context menu.
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
      shotsDir: `${zenMcpRuntimeDir()}/${zenMcpApp}-picks`,
      hasAccess: (browserId, session) => access.has(browserId, session),
      assertSiteAccess: (browser) => ctx.assertSiteAccess(browser),
      logError,
      sleep: (ms) => ctx.sleep(ms),
      copy: (value) => Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(value),
      paintIcon: paintMenuIcon,
      menuAgent,
    });

    // "Show me once": the user's steps in a recorded tab, saved as recipes.
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

    // Recordings the user starts from the page menu ("Record steps for an agent…").
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

    // HTTP requests of agent tabs.
    ctx.network = new NetworkLog((globalThis.zenMcpNetwork ||= new Map()), {
      tracked: (browserId) => state.tabs.has(browserId),
      // an allowlist only checks pages and frames: allowed sites load from other hosts (CDNs)
      blocked: (browserId, host, document) => {
        const call = [...ctx.calls].find((c) => c.tabs.has(browserId));
        if (!call || ctx.siteAllowed(host)) return false;
        if (!document && ctx.readConfig().sites.mode === "allowlist") return false;
        try {
          ctx.assertSiteHost(host); // throws the error that says which list blocks it
        } catch (e) {
          call.cancel(e);
        }
        return true;
      },
    });

    const eventFiles = (name) =>
      new EventFiles({
        dir: `${zenMcpRuntimeDir()}/${zenMcpApp}-${name}`,
        setTimeout,
        logError,
      });

    // Downloads started from agent tabs.
    ctx.downloads = new DownloadLog((globalThis.zenMcpDownloads ||= {}), {
      tracked: (browserId) => state.tabs.has(browserId),
      events: eventFiles("downloads"),
    });

    // Page watches: report conditions and changes to an events file.
    ctx.watches = new Watches({
      events: eventFiles("watch"),
      owned: (tabId, session) => {
        const tab = ctx.findTab(tabId);
        return tab && state.tabs.has(tabId) && access.has(tabId, session) ? tab.linkedBrowser : null;
      },
      check: async (browser, condition) => !!(await ctx.acrossFrames(browser, "check", condition, (value) => value)),
      sample: (browser, selector) => ctx.acrossFrames(browser, "sample", { selector }, (value) => value != null),
      assertSite: (browser) => ctx.assertSiteAccess(browser),
      held: (tabId, session) => {
        if (!access.shared(tabId) || !ctx.findTab(tabId)) return "gone";
        const hold = ctx.holdOf(tabId);
        return hold && hold.session !== session ? "held" : "free";
      },
      setTimeout,
      clearTimeout,
    });

    // ---- tools (MCP content arrays) and development commands ----

    Object.assign(
      ctx.tools,
      tabTools(ctx),
      batchTool(ctx),
      readTools(ctx),
      inputTools(ctx),
      browserTools(ctx),
      recipeTools(ctx),
      demonstrationTools(ctx),
    );

    // The version of the installed browser files (install writes .version; a dev symlink has none).
    function fileVersion() {
      try {
        const f = localFile(dir + "/.version");
        return f.exists() ? readTextFile(f).trim() : "dev";
      } catch {
        return "?";
      }
    }
    const loadedVersion = fileVersion();

    // Not exposed over MCP; used by the CLI (doctor, updates) and scripts/zenctl.ts.
    Object.assign(ctx.commands, {
      // A prompt hook (src/hooks.ts) asks for what waits for its conversation: the client's own
      // conversation ID maps to the zen session.
      inbox_take({ client, clientSession, pids }) {
        let session = null;
        if (client === "codex") session = clientSession ? `codex:${clientSession}` : null;
        else {
          const ancestors = new Set(Array.isArray(pids) ? pids : []);
          for (const sub of ctx.channels.subscribers.values())
            if (clientSession && sub.clientSession === clientSession) session = sub.id;
          // no conversation ID in the MCP process (Antigravity CLI): the hook's ancestor client
          if (!session)
            for (const sub of ctx.channels.subscribers.values())
              if (!sub.clientSession && sub.clientPid && ancestors.has(sub.clientPid)) session = sub.id;
        }
        return ctx.text(session ? ctx.inboxText(ctx.inbox.take(session)) : "");
      },
      ping() {
        return ctx.text({
          app: zenMcpApp,
          version: loadedVersion,
          bridge: version,
          startError: globalThis.zenMcpStartError,
          onDisk: fileVersion(),
          browser: Services.appinfo.name,
          browserVersion: Services.appinfo.version,
        });
      },
      reload() {
        // reload after the reply is written
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
          // If the new version didn't start there is no socket either: rather than leaving the
          // bridge dead until the browser restarts, clean up the half setup and restart this one.
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
      // eval() is forbidden in the system scope; use a system-principal sandbox like Marionette.
      // code must be an expression; helpers are on h: h.browserFor(id), h.query(browser, ...), h.state...
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

    // ---- socket ----

    // JSON is sent as pure ASCII so neither side has to deal with encodings.
    ctx.reply = (transport, output, message) => {
      const stream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
      stream.setByteStringData(ascii(JSON.stringify(message)) + "\n");
      // One reply per connection, then close the socket (closing the output stream isn't
      // enough: the connection stays open while the read pump is open).
      NetUtil.asyncCopy(stream, output, () => transport.close(Cr.NS_OK));
    };

    function onConnection(transport) {
      const input = transport.openInputStream(0, 0, 0);
      // Unbuffered: asyncCopy finishes only once the data is on the socket, so closing after it
      // is safe (closing a buffered stream cut off what hadn't been flushed).
      const output = transport.openOutputStream(Ci.nsITransport.OPEN_UNBUFFERED, 0, 0);
      const pump = Cc["@mozilla.org/network/input-stream-pump;1"].createInstance(Ci.nsIInputStreamPump);
      pump.init(input, 0, 0, false);
      let buffer = "";
      let handled = false;
      let session = null; // set for a subscription connection
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
            if (session) {
              ctx.channels.acknowledge(session, transport, request);
              continue;
            }
            if (handled) return;
            handled = true;
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
          if (session) ctx.channels.unsubscribe(session, transport);
        },
      });
    }

    // ---- windows ----

    const markSheet = Services.io.newURI("data:text/css;charset=utf-8," + encodeURIComponent(MARK_CSS));
    const sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);

    function attachWindow(win) {
      ctx.island?.attach(win);
      ctx.tabMenu.attach(win);
      ctx.picks.attachPageMenu(win);
      ctx.demonstrations.attachPageMenu(win);
    }

    // Saved values of lazy tabs become readable only a while after the window opens (neither at
    // SSTabRestoring nor at delayed startup), so scan a few more times. liveTabs scans again
    // whenever an agent asks for a tab; this is only to show the tab line early.
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

    // ---- start and stop ----

    let server = null;
    let sessionSweep = null;

    function start() {
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
          send: (note, targetId) => ctx.picks.send(note, targetId).catch((e) => logError("send", e)),
          selectTarget: (target) => ctx.picks.selectTarget(target),
          cancelPick: () => ctx.picks.end(),
          toggleMode: () => ctx.toggleMode(),
          holdOf: (browser) => {
            const hold = ctx.holdOf(browser.browserId);
            return hold ? { session: hold.session, ...ctx.describeHold(browser.browserId, hold, null) } : null;
          },
          releaseHold: (browser) => ctx.access.release(browser.browserId),
        },
        { setTimeout, clearTimeout },
      );
      for (const win of ctx.browserWindows()) attachWindow(win);
      if (state.paused) ctx.island.stopped();
      ctx.island.setMode(ctx.readConfig().mode);
      ctx.network.start();
      // images of recordings that a reload or restart cut off (running ones stopped with stop())
      Promise.resolve()
        .then(() => ctx.recipes.io.remove(`${zenMcpRuntimeDir()}/${zenMcpApp}-recordings`))
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
      // A previous version that vanished without stop() (e.g. loaded from another scope) left
      // its registration behind.
      try {
        ChromeUtils.unregisterWindowActor("ZenMcp");
      } catch {}
      ChromeUtils.registerWindowActor("ZenMcp", {
        parent: { esModuleURI: `resource://zenmcp/actors/ZenMcpParent.sys.mjs?v=${version}` },
        child: {
          esModuleURI: `resource://zenmcp/actors/ZenMcpChild.sys.mjs?v=${version}`,
          // the right-clicked element for "Show to agent…"; the others feed recordings
          events: {
            contextmenu: { capture: true, mozSystemGroup: true },
            pagehide: { capture: true, mozSystemGroup: true },
            click: { capture: true, mozSystemGroup: true },
            change: { capture: true, mozSystemGroup: true },
            keydown: { capture: true, mozSystemGroup: true },
            input: { capture: true, mozSystemGroup: true },
          },
        },
        // Entering web content processes needs explicit consent (Marionette does the same);
        // the child answers the parent's queries and sends only recorded steps, which the
        // parent accepts from recorded tabs alone and treats as untrusted data.
        safeForUntrustedWebProcess: true,
        // iframes too (including out-of-process cross-site frames)
        allFrames: true,
      });

      const file = localFile(socketPath);
      if (file.exists()) file.remove(false);
      server = Cc["@mozilla.org/network/server-socket;1"].createInstance(Ci.nsIServerSocket);
      server.initWithFilename(file, 0o600, -1);
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
    }

    function stop() {
      ctx.shuttingDown = true;
      ctx.releaseAllInputs();
      ctx.browserSettings.destroy();
      ctx.extensionPanels.destroy();
      clearTimeout(sessionSweep);
      for (const call of ctx.calls) call.cancel(new Stopped());
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
        server?.close();
      } catch {}
      try {
        ChromeUtils.unregisterWindowActor("ZenMcp");
      } catch {}
      try {
        localFile(socketPath).remove(false);
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
    // Autoconfig runs while the profile is read, before the network and windows are ready; a
    // reload starts at once.
    if (ctx.browserWindows().length) safeStart();
    else {
      const observer = () => {
        Services.obs.removeObserver(observer, "final-ui-startup");
        safeStart();
      };
      Services.obs.addObserver(observer, "final-ui-startup");
    }
  } catch (e) {
    logError("setup", e);
  }
})();
