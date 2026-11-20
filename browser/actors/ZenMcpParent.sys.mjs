// why: The actor module cannot reach autoconfig state; rederive the recorded step's attribution in the trusted parent.
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
