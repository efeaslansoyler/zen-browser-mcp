// Agent tabs: finding tabs across windows and Zen workspaces, creating agent tabs, and the
// mark that gives a session access to a tab (several sessions can share one, TabAccess.sys.mjs).
//
// The mark draws a container-like line on the tab, but it is not a container: a container
// would separate cookies and hide the user's logins. The visual mark is saved in SessionStore;
// access comes only from the access record in this browser process.
export const MARK = "zen-mcp";

// Zen draws the container line as a 3 px strip on the tab's edge in the vertical sidebar
// (zen-tabs/vertical-tabs.css). Same as Firefox's [usercontextid] rule, in the agent's color.
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

  // In Zen, gBrowser.tabs holds only the open workspace's tabs; count the other spaces too.
  function windowTabs(win) {
    return [...(win.gZenWorkspaces?.workspaceEnabled ? win.gZenWorkspaces.allStoredTabs : win.gBrowser.tabs)];
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

  // Only agent tabs (opened by an agent or given by the user) are reachable; a user tab is
  // never touched even if its ID is known. The tab joins the call's tabs.
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

  function describeTab(tab) {
    const b = tab.linkedBrowser;
    if (!ctx.siteAllowed(ctx.hostOf(b))) return { tabId: b.browserId, blocked: true };
    const info = { tabId: b.browserId, title: b.contentTitle || tab.label, url: b.currentURI?.spec };
    const members = ctx.access.members(b.browserId);
    if (members.length)
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

  // Opened in the background of the user's window, like Claude in Chrome: input comes from the
  // page process, so the tab doesn't need to be selected and the user's view doesn't change.
  // clean: in the agent container instead of with the user's cookies (default from the config).
  async function createTab(session, { clean } = {}) {
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    if (!win) throw new Error("No browser window is open.");
    const userContextId = (clean ?? !!ctx.readConfig().container) ? agentContainerId() : 0;
    const tab = win.gBrowser.addTrustedTab("about:blank", { inBackground: true, userContextId });
    mark(tab, "true", session);
    await placeInWorkspace(win, tab).catch((e) => ctx.logError("workspace", e));
    return tab;
  }

  // Containers keep cookies, logins and site data apart within the same profile and window.
  // Agents use one (configured by name, "Agent" by default, created on first use) so a clean
  // tab doesn't browse with the user's accounts. History and extensions stay shared.
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

  // Zen: if a workspace is configured, agent tabs move there (it is created without switching
  // the user to it). Input, reading and screenshots work in a hidden space too.
  async function placeInWorkspace(win, tab) {
    const name = ctx.readConfig().workspace;
    const spaces = win.gZenWorkspaces;
    if (!name || !spaces?.workspaceEnabled) return;
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

  // Gives session access to the tab; sessions already in it keep theirs. origin: "true" when an
  // agent opened the tab, "user" when the user gave it from the tab menu (kept once set).
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

  // A session leaves a shared tab: what it held there goes (held input, its browser settings,
  // its extension panels, its running calls). The last one to leave gives the tab back.
  function leaveTab(tab, session, { cancel = true } = {}) {
    const browser = tab.linkedBrowser;
    const id = browser.browserId;
    if (!ctx.access.has(id, session)) return;
    if (ctx.access.members(id).length === 1) return unmark(tab, { cancel });
    ctx.access.leave(id, session);
    if (ctx.heldInputFrames.get(id)?.session === session) ctx.releaseInputs(id);
    ctx.browserSettings.restoreTab(id, session);
    ctx.extensionPanels.releaseTab(id, session);
    if (cancel)
      for (const call of ctx.calls)
        if (call.session === session && call.tabs.has(id))
          call.cancel(new Error(`This session left tab ${id}; this operation was cancelled.`));
  }

  // When the user takes the tab back, drop held input, settings, panels, read and network
  // records and pending questions; cancel also stops the running calls.
  function releaseTabState(browser, { cancel = true } = {}) {
    const id = browser.browserId;
    ctx.releaseInputs(id);
    ctx.browserSettings.restoreTab(id);
    ctx.extensionPanels.releaseTab(id);
    ctx.readSnapshots.clearTab(id);
    if (cancel) ctx.cancelTabWork(id);
    ctx.state.scale.delete(id);
    ctx.network.delete(id);
    ctx.cancelAsk(browser, "taken_back");
    ctx.tabRequests.get(browser)?.("cancelled");
  }

  // The user took the tab back: the mark, tracking and records go; running work is cancelled.
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
    // Persisted visual marks are not authorization after a browser restart.
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

  // Zen restores the session with its own manager after windows open; catch each tab with the
  // SSTabRestoring event fired while its state is applied.
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
    liveTabs,
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
