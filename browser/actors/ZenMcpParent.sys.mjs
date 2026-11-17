// Requests go from the parent with sendQuery. The only message from the child is a recorded
// step; it goes to Recordings.sys.mjs through an observer topic, since this module can't reach
// main.js's ctx. The tab (browserId) and page URL are taken here, not from the (untrusted) child.
export class ZenMcpParent extends JSWindowActorParent {
  receiveMessage({ name, data }) {
    if (name !== "record_step") return;
    const context = this.browsingContext;
    const message = {
      browserId: context.browserId,
      frameId: context.id,
      isTop: context === context.top,
      pageUrl: context.top.currentWindowGlobal?.documentURI?.spec ?? "",
      step: data,
    };
    Services.obs.notifyObservers(null, "zen-mcp-record-step", JSON.stringify(message));
  }
}
