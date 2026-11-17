// Session identity is supplied by the MCP transport, never inferred from agent branding.
export class Ownership {
  constructor(owners = new Map(), versions = new Map(), work = new Map(), queues = new Map(), handoffs = new Map()) {
    this.owners = owners;
    this.versions = versions;
    this.work = work;
    this.queues = queues;
    this.handoffs = handoffs;
  }
  owner(tabId) {
    return this.owners.get(tabId);
  }
  version(tabId) {
    return this.versions.get(tabId) || 0;
  }
  assign(tabId, session) {
    if (typeof session !== "string" || !session.trim()) throw new Error("A browser session ID is required.");
    if (this.owner(tabId) === session) return false;
    this.clearWork(tabId);
    this.work.set(tabId, { state: "busy", summary: "Owner has not reported its task yet.", updated: Date.now() });
    this.owners.set(tabId, session);
    this.versions.set(tabId, this.version(tabId) + 1);
    return true;
  }
  release(tabId) {
    this.clearWork(tabId);
    this.owners.delete(tabId);
    this.versions.set(tabId, this.version(tabId) + 1);
  }
  check(tabId, session) {
    const owner = this.owner(tabId);
    if (!owner) throw new Error(`Tab ${tabId} is not assigned to this session (closed, or the user took it back).`);
    if (!session || owner !== session)
      throw new Error(
        `Tab ${tabId} belongs to another session. Use tab_work status/request to coordinate a handoff; agent identity does not grant access.`,
      );
  }
  clearWork(tabId) {
    this.work.delete(tabId);
    this.queues.delete(tabId);
    this.handoffs.delete(tabId);
  }
  queue(tabId, now = Date.now()) {
    const queue = (this.queues.get(tabId) || []).filter((item) => item.expires > now);
    this.queues.set(tabId, queue);
    return queue;
  }
  request(tabId, session, reason, now = Date.now()) {
    if (!this.owner(tabId))
      throw new Error("Only agent-owned tabs can be queued. User tabs still require request_tab approval.");
    if (this.owner(tabId) === session) throw new Error("This session already owns the tab.");
    const queue = this.queue(tabId, now);
    const existing = queue.find((item) => item.session === session);
    if (existing) {
      existing.reason = reason;
      existing.expires = now + 600_000;
    } else queue.push({ session, reason, requested: now, expires: now + 600_000 });
    return queue.findIndex((item) => item.session === session) + 1;
  }
  cancelRequest(tabId, session) {
    this.queues.set(
      tabId,
      this.queue(tabId).filter((item) => item.session !== session),
    );
  }
  removeRequester(session) {
    for (const tabId of this.queues.keys()) this.cancelRequest(tabId, session);
  }
  report(tabId, session, action, summary) {
    this.check(tabId, session);
    const previous = this.work.get(tabId);
    if (action === "update" && previous?.state !== "busy") throw new Error("Start a task before updating it.");
    this.work.set(tabId, { state: action === "finish" ? "ready" : "busy", summary, updated: Date.now() });
  }
  touch(tabId, session) {
    this.check(tabId, session);
    const previous = this.work.get(tabId);
    this.work.set(tabId, {
      state: "busy",
      summary: previous?.state === "busy" ? previous.summary : "Owner resumed browser work.",
      updated: Date.now(),
    });
  }
  ticket(tabIds) {
    return [...new Set(tabIds)].map((id) => [id, this.version(id)]);
  }
  checkTicket(ticket) {
    for (const [id, version] of ticket) {
      if (version !== this.version(id))
        throw new Error(
          `Ownership of tab ${id} changed after this request was queued. Submit a new request after the user transfers it.`,
        );
    }
  }
}
