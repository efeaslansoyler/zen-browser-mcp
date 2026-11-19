// Which agent sessions may use which tabs. A tab can be shared: every member may work in it
// (calls on one tab still run in order, see Locks.sys.mjs). Members publish what they are doing
// with tab_work; the notes are shared with the other members, never page contents.
// Session identity is supplied by the MCP transport, never inferred from agent branding.
export class TabAccess {
  // The maps live in the bridge's reload-surviving state; a reloaded bridge keeps access.
  //   members: tabId → Map(session → membership number)
  //   versions: tabId → number, bumped when a session leaves or the tab returns to the user
  //   tasks: tabId → Map(session → { state: "busy" | "done", summary, updated })
  constructor(members = new Map(), versions = new Map(), tasks = new Map(), counter = { next: 1 }) {
    this.membersByTab = members;
    this.versions = versions;
    this.tasks = tasks;
    this.counter = counter;
  }

  members(tabId) {
    return [...(this.membersByTab.get(tabId)?.keys() ?? [])];
  }
  has(tabId, session) {
    return !!session && !!this.membersByTab.get(tabId)?.has(session);
  }
  // an agent tab: at least one session works in it
  shared(tabId) {
    return !!this.membersByTab.get(tabId)?.size;
  }
  tabsOf(session) {
    return [...this.membersByTab].filter(([, members]) => members.has(session)).map(([tabId]) => tabId);
  }
  version(tabId) {
    return this.versions.get(tabId) || 0;
  }

  // Returns false when the session was a member already.
  join(tabId, session) {
    if (typeof session !== "string" || !session.trim()) throw new Error("A browser session ID is required.");
    if (!this.membersByTab.has(tabId)) this.membersByTab.set(tabId, new Map());
    const members = this.membersByTab.get(tabId);
    if (members.has(session)) return false;
    members.set(session, this.counter.next++);
    return true;
  }
  // Returns how many members are left.
  leave(tabId, session) {
    const members = this.membersByTab.get(tabId);
    if (!members?.delete(session)) return members?.size ?? 0;
    this.tasks.get(tabId)?.delete(session);
    this.versions.set(tabId, this.version(tabId) + 1);
    if (!members.size) this.clear(tabId);
    return members.size;
  }
  // The tab goes back to the user: no members, no notes.
  clear(tabId) {
    this.membersByTab.delete(tabId);
    this.tasks.delete(tabId);
    this.versions.set(tabId, this.version(tabId) + 1);
  }

  check(tabId, session) {
    if (!this.shared(tabId)) throw new Error(`Tab ${tabId} is not an agent tab (closed, or the user took it back).`);
    if (!this.has(tabId, session))
      throw new Error(
        `Tab ${tabId} is used by other sessions. Join it with request_tab first; agent identity does not grant access.`,
      );
  }

  // tab_work start/update/finish: the member's note about its task in this tab.
  report(tabId, session, action, summary) {
    this.check(tabId, session);
    if (action === "update" && this.tasks.get(tabId)?.get(session)?.state !== "busy")
      throw new Error("Start a task before updating it.");
    if (!this.tasks.has(tabId)) this.tasks.set(tabId, new Map());
    this.tasks.get(tabId).set(session, { state: action === "finish" ? "done" : "busy", summary, updated: Date.now() });
  }
  task(tabId, session) {
    return this.tasks.get(tabId)?.get(session) ?? null;
  }

  // A request remembers the membership it was made with; if the session left the tab (or the
  // user took the tab back and gave it again) before the request ran, it must not run.
  ticket(tabIds, session) {
    return [...new Set(tabIds)].map((id) => [id, this.membersByTab.get(id)?.get(session)]);
  }
  checkTicket(ticket, session) {
    for (const [id, membership] of ticket) {
      if (membership !== undefined && this.membersByTab.get(id)?.get(session) !== membership)
        throw new Error(
          `This session's access to tab ${id} changed after this request was queued. Check tabs_context_mcp and send a new request.`,
        );
    }
  }
}
