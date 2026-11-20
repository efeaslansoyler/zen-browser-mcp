// Dedicated browsers follow MCP process connections, including clients without pick delivery.
export function profileLifecycle({ temporary, owner, setTimeout, clearTimeout, quit }) {
  const leases = new Set();
  let timer;

  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!leases.size) quit();
    }, delay);
  }

  return {
    start() {
      schedule(temporary ? 30_000 : 120_000);
    },
    connect(lease, profileOwner) {
      if (temporary && profileOwner !== owner)
        throw new Error("This temporary browser belongs to another MCP process.");
      leases.add(lease);
      clearTimeout(timer);
    },
    disconnect(lease) {
      if (leases.delete(lease) && !leases.size) schedule(temporary ? 8_000 : 120_000);
    },
    release(lease) {
      if (temporary && leases.has(lease)) quit();
    },
    stop() {
      clearTimeout(timer);
      for (const lease of leases) lease.close(0);
      leases.clear();
    },
  };
}
