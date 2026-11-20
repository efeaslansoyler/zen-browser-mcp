// Agent sessions: one per MCP server process (or per Codex conversation). A session works in tabs;
// it stays alive while a lifecycle connection is open and ends after a short grace period once
// the last one closes, which takes it out of its tabs.
export function sessionManager(ctx) {
  const GRACE = 5000;

  function sessionInfo(id, agent, cwd = "", title) {
    if (typeof id !== "string" || !id.trim())
      throw new Error("A browser session ID is required. Reconnect the MCP server.");
    let info = ctx.sessions.get(id);
    if (!info) {
      info = { id };
      ctx.sessions.set(id, info);
    }
    if (cwd) info.project = String(cwd).split("/").filter(Boolean).pop();
    if (title !== undefined) info.title = title || undefined;
    info.agent = ctx.agentTheme(agent);
    info.name = sessionName(info.agent, info.project, info.title, id);
    info.seen = Date.now();
    return info;
  }

  // Name shown in menus: the conversation title if there is one (the icon shows the agent),
  // otherwise the agent name and a short ID.
  function sessionName(theme, cwd, title, id) {
    const project = String(cwd || "")
      .split("/")
      .filter(Boolean)
      .pop();
    if (title) {
      const short = title.length > 40 ? title.slice(0, 39).trimEnd() + "…" : title;
      return project ? `${short} · ${project}` : short;
    }
    return `${theme.name}${project ? " · " + project : ""} · ${String(id).slice(-6)}`;
  }

  // Menus list only sessions with a live lifecycle connection: one-off callers such as zenctl
  // never "disconnect", so listing them would leave ghosts behind.
  function* liveSessions() {
    for (const info of ctx.sessions.values()) {
      // Codex tabs belong to a conversation (codex:<thread>); the MCP process session belongs to none.
      if (info.agent?.id === "codex" && !info.id.startsWith("codex:")) continue;
      if (info.lifecycle && !info.disconnected) yield info;
    }
  }

  function cancelTabWork(tabId) {
    ctx.releaseInputs(tabId);
    ctx.browserSettings.restoreTab(tabId);
    ctx.extensionPanels.releaseTab(tabId);
    for (const call of ctx.calls)
      if (call.tabs.has(tabId))
        call.cancel(new Error(`The user revoked or transferred tab ${tabId}; this operation was cancelled.`));
  }

  function endOwnerSession(id) {
    ctx.inbox?.end(id);
    ctx.extensionPanels.releaseSession(id);
    ctx.watches.endSession(id, "session ended");
    ctx.har?.dropSession(id);
    ctx.networkControl?.dropSession(id);
    ctx.video?.dropSession(id);
    clearTimer(id);
    ctx.sessionVersions.set(id, (ctx.sessionVersions.get(id) || 0) + 1);
    ctx.sessions.delete(id);
    ctx.readSnapshots.clearSession(id);
    for (const call of ctx.calls)
      if (call.session === id) call.cancel(new Error("The browser session disconnected; its operation was cancelled."));
    for (const tabId of ctx.access.tabsOf(id)) {
      const tab = ctx.findTab(tabId);
      if (tab) ctx.leaveTab(tab, id);
      else {
        ctx.access.clear(tabId);
        ctx.state.tabs.delete(tabId);
      }
    }
  }

  function clearTimer(id) {
    ctx.clearTimeout(ctx.disconnectTimers.get(id));
    ctx.disconnectTimers.delete(id);
  }

  // Ends the session after the grace period unless it reconnected meanwhile.
  function endAfterGrace(id) {
    ctx.disconnectTimers.set(
      id,
      ctx.setTimeout(() => {
        ctx.disconnectTimers.delete(id);
        if (!ctx.ownerConnections.has(id)) endOwnerSession(id);
      }, GRACE),
    );
  }

  function connectOwnerSession(id, transport, agent, cwd, title) {
    const info = sessionInfo(id, agent, cwd, title);
    info.disconnected = false;
    info.lifecycle = true;
    clearTimer(id);
    if (!ctx.ownerConnections.has(id)) ctx.ownerConnections.set(id, new Set());
    ctx.ownerConnections.get(id).add(transport);
  }

  function disconnectOwnerSession(id, transport) {
    const connections = ctx.ownerConnections.get(id);
    if (!connections?.delete(transport) || connections.size) return;
    ctx.ownerConnections.delete(id);
    const info = ctx.sessions.get(id);
    if (info) info.disconnected = true;
    ctx.sessionVersions.set(id, (ctx.sessionVersions.get(id) || 0) + 1);
    for (const tabId of ctx.access.holdsOf(id)) ctx.access.release(tabId, id);
    for (const call of ctx.calls)
      if (call.session === id) call.cancel(new Error("The browser session disconnected; its operation was cancelled."));
    // Allow the same MCP process to reconnect after a bridge reload or brief outage.
    endAfterGrace(id);
  }

  // After a bridge reload, lifecycle sessions get the usual grace period to reconnect.
  function awaitReconnects() {
    for (const info of ctx.sessions.values()) {
      if (!info.lifecycle) continue;
      info.disconnected = true;
      endAfterGrace(info.id);
    }
  }

  // Sessions without a lifecycle connection or tabs end after 10 minutes idle, others after a day.
  function sweepSessions() {
    for (const info of ctx.sessions.values()) {
      if (ctx.ownerConnections.has(info.id)) continue;
      const idle = Date.now() - info.seen;
      const hasTabs = ctx.access.tabsOf(info.id).length > 0;
      if (idle > 24 * 60 * 60 * 1000 || (!info.lifecycle && !hasTabs && idle > 10 * 60 * 1000))
        endOwnerSession(info.id);
    }
  }

  // On bridge shutdown: close lifecycle transports but keep sessions and tab access, so the
  // reloaded bridge can hand them back when the clients reconnect.
  function closeConnections() {
    for (const connections of ctx.ownerConnections.values()) {
      for (const transport of connections) {
        try {
          transport.close(0);
        } catch {} // NS_OK
      }
    }
    ctx.ownerConnections.clear();
    for (const timer of ctx.disconnectTimers.values()) ctx.clearTimeout(timer);
    ctx.disconnectTimers.clear();
  }

  return {
    sessionInfo,
    sessionName,
    liveSessions,
    cancelTabWork,
    endOwnerSession,
    connectOwnerSession,
    disconnectOwnerSession,
    awaitReconnects,
    sweepSessions,
    closeConnections,
  };
}
