// Session identity is supplied by the MCP transport, never inferred from agent branding.
export class Ownership {
  constructor(owners = new Map(), versions = new Map()) {
    this.owners = owners;
    this.versions = versions;
  }
  owner(tabId) { return this.owners.get(tabId); }
  version(tabId) { return this.versions.get(tabId) || 0; }
  assign(tabId, session) {
    if (typeof session !== 'string' || !session.trim()) throw new Error('A browser session ID is required.');
    if (this.owner(tabId) === session) return false;
    this.owners.set(tabId, session);
    this.versions.set(tabId, this.version(tabId) + 1);
    return true;
  }
  release(tabId) {
    this.owners.delete(tabId);
    this.versions.set(tabId, this.version(tabId) + 1);
  }
  check(tabId, session) {
    const owner = this.owner(tabId);
    if (!owner) throw new Error(`Tab ${tabId} is not assigned to this session (closed, or the user took it back).`);
    if (!session || owner !== session) throw new Error(`Tab ${tabId} belongs to another session. Ask the user to transfer it explicitly; agent identity does not grant access.`);
  }
  ticket(tabIds) { return [...new Set(tabIds)].map(id => [id, this.version(id)]); }
  checkTicket(ticket) {
    for (const [id, version] of ticket) {
      if (version !== this.version(id)) throw new Error(`Ownership of tab ${id} changed after this request was queued. Submit a new request after the user transfers it.`);
    }
  }
}
