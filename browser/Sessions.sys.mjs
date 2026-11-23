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

  // why: One-off clients never disconnect through a lifecycle transport and would leave ghost menu entries.
  function* liveSessions() {
    for (const info of ctx.sessions.values()) {
      // why: Codex conversations own their tabs independently of the MCP process session.
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
    ctx.screenshots.clearSession(id);
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

  function updateOwnerSession(id, transport, cwd, title) {
    const info = ctx.sessions.get(id);
    if (!info || !ctx.ownerConnections.get(id)?.has(transport)) return undefined;
    return sessionInfo(id, info.agent, cwd, title).name;
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
    // why: The grace period lets clients reconnect across reloads and brief outages.
    endAfterGrace(id);
  }

  function awaitReconnects() {
    for (const info of ctx.sessions.values()) {
      if (!info.lifecycle) continue;
      info.disconnected = true;
      endAfterGrace(info.id);
    }
  }

  function sweepSessions() {
    for (const info of ctx.sessions.values()) {
      if (ctx.ownerConnections.has(info.id)) continue;
      const idle = Date.now() - info.seen;
      const hasTabs = ctx.access.tabsOf(info.id).length > 0;
      if (idle > 24 * 60 * 60 * 1000 || (!info.lifecycle && !hasTabs && idle > 10 * 60 * 1000))
        endOwnerSession(info.id);
    }
  }

  // why: Close transports on shutdown while retaining access for clients that reconnect after reload.
  function closeConnections() {
    for (const connections of ctx.ownerConnections.values()) {
      for (const transport of connections) {
        try {
          // why: Zero is Gecko's NS_OK status for a clean transport close.
          transport.close(0);
        } catch {}
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
    updateOwnerSession,
    disconnectOwnerSession,
    awaitReconnects,
    sweepSessions,
    closeConnections,
  };
}
