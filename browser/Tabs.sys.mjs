export const MARK = "zen-mcp";

export const MARK_CSS = `
  .tabbrowser-tab[${MARK}] > .tab-stack > .tab-background > .tab-context-line {
    /* Firefox hides this element on tabs without a container */
    display: block !important;
    background-color: var(--zen-agent-accent, #d97757) !important;
    height: 2px;
    border-radius: var(--border-radius-xsmall);
    margin: 0 calc(var(--tab-border-radius) / 2);
    position: relative;
  }
  #tabbrowser-tabs[orient="vertical"] .tabbrowser-tab[${MARK}] > .tab-stack > .tab-background > .tab-context-line {
    height: auto;
    width: 2px;
    margin: calc(var(--tab-border-radius) / 2) 0;
  }
`;

export function tabs(ctx) {
  function browserWindows() {
    return [...Services.wm.getEnumerator("navigator:browser")].filter((w) => !w.closed && w.gBrowser);
  }

  function windowTabs(win) {
    return [...(win.gZenWorkspaces?.workspaceEnabled ? win.gZenWorkspaces.allStoredTabs : win.gBrowser.tabs)];
  }

  const pendingOpens = new Map();
  const allTabs = () => ctx.browserWindows().flatMap(ctx.windowTabs);

  function watchTabOpens(tabId, session, waitMs = 0) {
    const now = Date.now();
    for (const [key, watches] of pendingOpens) {
      const live = watches.filter((watch) => watch.until > now);
      if (live.length) pendingOpens.set(key, live);
      else pendingOpens.delete(key);
    }
    const watches = pendingOpens.get(session) ?? [];
    watches.push({
      tabId,
      opener: ctx.findTab(tabId)?.linkedBrowser.browsingContext?.top,
      ticket: ctx.access.ticket([tabId], session),
      known: new Set(allTabs().map((tab) => tab.linkedBrowser?.browserId)),
      until: now + waitMs + 10_000,
    });
    pendingOpens.set(session, watches.slice(-8));
  }

  function openedTabs(session) {
    const watches = pendingOpens.get(session) ?? [];
    const candidates = watches.filter((watch) => watch.opener && watch.until > Date.now());
    if (!candidates.length) {
      pendingOpens.delete(session);
      return [];
    }
    const result = [];
    const tabs = allTabs();
    for (const watch of candidates) {
      try {
        ctx.access.checkTicket(watch.ticket, session);
        ctx.assertSiteAccess(ctx.findTab(watch.tabId).linkedBrowser);
      } catch {
        continue;
      }
      for (const tab of tabs) {
        const browser = tab.linkedBrowser;
        if (
          !browser ||
          watch.known.has(browser.browserId) ||
          browser.browsingContext?.top?.opener?.top !== watch.opener
        )
          continue;
        for (const candidate of candidates) candidate.known.add(browser.browserId);
        result.push({
          sourceTabId: watch.tabId,
          tabId: browser.browserId,
          ...(!ctx.siteAllowed(ctx.hostOf(browser)) ? { blocked: true } : {}),
        });
      }
    }
    pendingOpens.set(session, candidates);
    return result;
  }

  function findTab(tabId) {
    for (const win of ctx.browserWindows()) {
      for (const tab of ctx.windowTabs(win)) {
        if (tab.linkedBrowser?.browserId === tabId) return tab;
      }
    }
    return null;
  }

  function liveTabs() {
    ctx.restoreMarks();
    const tabs = [];
    for (const id of ctx.state.tabs) {
      const tab = ctx.findTab(id);
      if (tab) tabs.push(tab);
      else {
        ctx.access.clear(id);
        ctx.state.tabs.delete(id);
      }
    }
    return tabs;
  }

  // why: A known tab ID must never substitute for authorization.
  function browserFor(call, tabId) {
    const tab = ctx.findTab(tabId);
    if (tab) restoreMark(tab);
    if (!tab || !ctx.state.tabs.has(tabId)) {
      throw new Error(
        `Tab ${tabId} is not assigned to an agent (closed, or the user took it back). Use tabs_context_mcp for current tabs.`,
      );
    }
    ctx.access.check(tabId, call.session);
    call.tabs.add(tabId);
    if (call.extensionSurface?.tabId === tabId) {
      const surface = call.extensionSurface;
      ctx.extensionPanels.get(tab.linkedBrowser, call.session, tabId, surface.extensionId);
      return surface.browser;
    }
    return tab.linkedBrowser;
  }

  function userTabs() {
    return ctx
      .browserWindows()
      .flatMap(ctx.windowTabs)
      .filter(
        (tab) =>
          tab.linkedBrowser && !tab.hasAttribute("zen-empty-tab") && !ctx.access.shared(tab.linkedBrowser.browserId),
      );
  }

  function userTabsOn(host) {
    if (!host || !ctx.siteAllowed(host)) return [];
    return userTabs()
      .filter((tab) => ctx.hostOf(tab.linkedBrowser) === host)
      .slice(0, 3)
      .map((tab) => ({ tabId: tab.linkedBrowser.browserId, title: tab.linkedBrowser.contentTitle || tab.label }));
  }

  function describeTab(tab, viewer) {
    const b = tab.linkedBrowser;
    if (!ctx.siteAllowed(ctx.hostOf(b))) return { tabId: b.browserId, blocked: true };
    const info = { tabId: b.browserId, title: b.contentTitle || tab.label, url: b.currentURI?.spec };
    const members = ctx.access.members(b.browserId);
    if (members.length && !(members.length === 1 && members[0] === viewer))
      info.members = members.map((session) => ({
        session,
        name: ctx.sessions.get(session)?.name || session.slice(-6),
      }));
    if (tab.getAttribute(MARK) === "user") info.givenByUser = true;
    if (tab.userContextId) {
      try {
        info.container = containers().getUserContextLabel(tab.userContextId);
      } catch {}
    }
    return info;
  }

  // why: Open in the background to preserve the user's view; page-process input does not need selection.
  async function createTab(session, { clean } = {}) {
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    if (!win) throw new Error("No browser window is open.");
    await windowReady(win);
    const together = !ctx.browserMode || ctx.browserMode === "together";
    const userContextId = together && (clean ?? !!ctx.readConfig().container) ? agentContainerId() : 0;
    const tab = win.gBrowser.addTrustedTab("about:blank", { inBackground: true, userContextId });
    mark(tab, "true", session);
    await placeInWorkspace(win, tab).catch((e) => ctx.logError("workspace", e));
    return tab;
  }

  // why: A just-opened window lacks gBrowser, gZenWorkspaces and even delayedStartupPromise until startup.
  function windowReady(win) {
    if (win.gBrowserInit?.delayedStartupFinished) return;
    return new Promise((resolve) => {
      const observer = (subject) => {
        if (subject !== win) return;
        Services.obs.removeObserver(observer, "browser-delayed-startup-finished");
        resolve();
      };
      Services.obs.addObserver(observer, "browser-delayed-startup-finished");
    });
  }

  // why: A clean tab needs a separate cookie jar without a separate window or profile.
  function containers() {
    for (const url of [
      "moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs",
      "resource://gre/modules/ContextualIdentityService.sys.mjs",
    ]) {
      try {
        return ChromeUtils.importESModule(url).ContextualIdentityService;
      } catch {}
    }
    throw new Error("This browser has no containers, so clean tabs aren't available.");
  }

  const containerName = (service, identity) => identity.name ?? service.getUserContextLabel(identity.userContextId);

  function agentContainerId() {
    const service = containers();
    const name = ctx.readConfig().container || "Agent";
    const found = service.getPublicIdentities().find((identity) => containerName(service, identity) === name);
    return (found ?? service.create(name, "fingerprint", "orange")).userContextId;
  }

  async function placeInWorkspace(win, tab) {
    const name = ctx.readConfig().workspace;
    const spaces = win.gZenWorkspaces;
    if (!name || !spaces?.workspaceEnabled) return;
    await spaces.promiseInitialized;
    let space = spaces.getWorkspaces().find((w) => w.name === name);
    space ??= await spaces.createAndSaveWorkspace(name, undefined, true);
    if (space && tab.getAttribute("zen-workspace-id") !== space.uuid) await spaces.moveTabToWorkspace(tab, space.uuid);
  }

  function workspaceNames(win) {
    return win.gZenWorkspaces?.workspaceEnabled ? win.gZenWorkspaces.getWorkspaces().map((w) => w.name) : null;
  }

  function paintTab(tab, agent) {
    const theme = ctx.applyTheme(tab, agent);
    tab.setAttribute("zen-mcp-agent-name", theme.name);
    try {
      ctx.SessionStore.setCustomTabValue(tab, "zen-mcp-agent", JSON.stringify({ id: theme.id, name: theme.name }));
    } catch {}
  }

  // why: Preserve the original source of access so a later close knows whether the tab belongs to the user.
  function mark(tab, origin, session) {
    const target = ctx.sessions.get(session);
    if (!target || target.disconnected)
      throw new Error("The selected browser session is no longer connected. Choose a session again.");
    const id = tab.linkedBrowser.browserId;
    ctx.access.join(id, session);
    tab.setAttribute(MARK, tab.getAttribute(MARK) || origin);
    ctx.state.tabs.add(id);
    ctx.paintTab(tab, target.agent);
    try {
      ctx.SessionStore.setCustomTabValue(tab, MARK, tab.getAttribute(MARK));
    } catch {}
  }

  // why: Revoke the departing member's state while preserving other members' access.
  function leaveTab(tab, session, { cancel = true } = {}) {
    const browser = tab.linkedBrowser;
    const id = browser.browserId;
    if (!ctx.access.has(id, session)) return;
    if (ctx.access.members(id).length === 1) return unmark(tab, { cancel });
    ctx.access.leave(id, session);
    ctx.visualBaselines?.clear(id, session);
    ctx.har?.dropTab(id, session);
    ctx.networkControl?.dropTab(id, session);
    ctx.video?.dropTab(id, session);
    if (ctx.heldInputFrames.get(id)?.session === session) ctx.releaseInputs(id);
    ctx.browserSettings.restoreTab(id, session);
    ctx.extensionPanels.releaseTab(id, session);
    if (cancel)
      for (const call of ctx.calls)
        if (call.session === session && call.tabs.has(id))
          call.cancel(new Error(`This session left tab ${id}; this operation was cancelled.`));
  }

  function releaseTabState(browser, { cancel = true } = {}) {
    const id = browser.browserId;
    ctx.releaseInputs(id);
    ctx.browserSettings.restoreTab(id);
    ctx.extensionPanels.releaseTab(id);
    ctx.readSnapshots.clearTab(id);
    ctx.visualBaselines?.clear(id);
    ctx.har?.dropTab(id);
    ctx.networkControl?.dropTab(id);
    ctx.video?.dropTab(id);
    if (cancel) ctx.cancelTabWork(id);
    ctx.state.scale.delete(id);
    ctx.network.delete(id);
    ctx.cancelAsk(browser, "taken_back");
    ctx.tabRequests.get(browser)?.("cancelled");
  }

  function unmark(tab, { cancel = true } = {}) {
    const browser = tab.linkedBrowser;
    const id = browser.browserId;
    ctx.access.clear(id);
    ctx.tabActivity.forget(id);
    ctx.tabWake.forget(browser);
    releaseTabState(browser, { cancel });
    tab.removeAttribute(MARK);
    tab.removeAttribute("data-zen-agent");
    tab.removeAttribute("zen-mcp-agent-name");
    for (const key of ["accent", "hover", "rgb", "foreground"]) tab.style.removeProperty(`--zen-agent-${key}`);
    try {
      ctx.SessionStore.deleteCustomTabValue(tab, "zen-mcp-agent");
    } catch {}
    ctx.state.tabs.delete(id);
    try {
      ctx.SessionStore.deleteCustomTabValue(tab, MARK);
    } catch {}
    ctx.island?.release(browser);
  }

  function restoreMark(tab) {
    let origin = "";
    try {
      origin = ctx.SessionStore.getCustomTabValue(tab, MARK);
    } catch {}
    if (origin !== "true" && origin !== "user") return;
    const id = tab.linkedBrowser.browserId;
    const live = ctx.access.members(id).filter((session) => ctx.sessions.has(session));
    // why: SessionStore marks can outlive live membership (ADR 0003).
    if (!live.length) {
      unmark(tab);
      return;
    }
    if (tab.hasAttribute(MARK)) return;
    tab.setAttribute(MARK, origin);
    ctx.state.tabs.add(id);
    ctx.paintTab(tab, ctx.sessions.get(live[0]).agent);
  }

  function restoreMarks() {
    for (const win of ctx.browserWindows()) {
      for (const tab of ctx.windowTabs(win)) restoreMark(tab);
    }
  }

  const onTabRestoring = (event) => {
    try {
      restoreMark(event.target);
    } catch (e) {
      ctx.logError("restoreMark", e);
    }
  };

  const onTabClose = (event) => {
    const tab = event.target;
    const id = tab.linkedBrowser?.browserId;
    if (ctx.state.tabs.has(id)) unmark(tab);
    ctx.state.pickedTabs.delete(id);
  };

  function watchWindow(win) {
    win.addEventListener("SSTabRestoring", onTabRestoring);
    win.gBrowser.tabContainer.addEventListener("TabClose", onTabClose);
  }

  function unwatchWindow(win) {
    win.removeEventListener("SSTabRestoring", onTabRestoring);
    win.gBrowser.tabContainer.removeEventListener("TabClose", onTabClose);
  }

  return {
    browserWindows,
    windowTabs,
    findTab,
    watchTabOpens,
    openedTabs,
    liveTabs,
    userTabs,
    userTabsOn,
    browserFor,
    describeTab,
    createTab,
    workspaceNames,
    paintTab,
    mark,
    leaveTab,
    unmark,
    restoreMark,
    restoreMarks,
    onTabClose,
    watchWindow,
    unwatchWindow,
  };
}
