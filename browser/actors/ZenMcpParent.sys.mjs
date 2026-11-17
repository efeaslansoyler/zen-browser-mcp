// Requests go from the parent with sendQuery; the parent side has nothing to do, but
// registering an actor needs both sides.
export class ZenMcpParent extends JSWindowActorParent {}
