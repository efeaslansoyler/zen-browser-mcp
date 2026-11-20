import assert from "node:assert/strict";
import test from "node:test";
import { profileLifecycle } from "../browser/ProfileLifecycle.sys.mjs";

function fixture(temporary) {
  const tasks = new Map();
  let quits = 0;
  const lifecycle = profileLifecycle({
    temporary,
    owner: "owner",
    setTimeout(fn, delay) {
      const id = Symbol();
      tasks.set(id, { fn, delay });
      return id;
    },
    clearTimeout: (id) => tasks.delete(id),
    quit: () => ++quits,
  });
  const tick = (expectedDelay) => {
    assert.equal(tasks.size, 1);
    const [[id, { fn, delay }]] = tasks;
    assert.equal(delay, expectedDelay);
    tasks.delete(id);
    fn();
  };
  return { lifecycle, tick, tasks, quits: () => quits };
}

test("persistent agent idle quit waits for the last lease and allows reconnects during the grace period", () => {
  const { lifecycle, tick, tasks, quits } = fixture(false);
  const a = { close() {} };
  const b = { close() {} };
  lifecycle.start();
  lifecycle.connect(a);
  lifecycle.connect(b);
  lifecycle.disconnect(a);
  assert.equal(tasks.size, 0);
  lifecycle.release(b);
  assert.equal(quits(), 0);
  lifecycle.disconnect(b);
  lifecycle.connect(a);
  assert.equal(tasks.size, 0);
  lifecycle.disconnect(a);
  tick(120_000);
  assert.equal(quits(), 1);
});

test("temporary browser accepts only its owner's lease and quits promptly on release", () => {
  const { lifecycle, tick, tasks, quits } = fixture(true);
  const transport = { close() {} };
  lifecycle.start();
  assert.throws(() => lifecycle.connect(transport, "another process"), /another MCP process/);
  lifecycle.connect(transport, "owner");
  assert.equal(tasks.size, 0);
  lifecycle.disconnect(transport);
  tick(8000);
  assert.equal(quits(), 1);
  lifecycle.connect(transport, "owner");
  lifecycle.release(transport);
  assert.equal(quits(), 2);
  lifecycle.stop();
  assert.equal(tasks.size, 0);
});

test("the bridge only trusts an autonomous launch identity for its actual dedicated profile", async () => {
  const { browserIdentity } = await import("../browser/Instances.sys.mjs");
  const root = "/state/zen-mcp/profiles";
  const profile = root + "/zen-installation/agent";
  const env = { ZEN_MCP_BROWSER_MODE: "autonomous-agent" };
  const { Services: original, Ci: interfaces } = globalThis;
  try {
    globalThis.Ci = { nsIFile: {} };
    globalThis.Services = {
      dirsvc: { get: () => ({ path: profile }) },
      env: { get: (key) => env[key] ?? "" },
    };
    const identity = () => browserIdentity(root, (path) => ({ path, exists: () => false }));
    assert.deepEqual(identity(), { browserMode: "agent", launchedByMcp: false });
    env.ZEN_MCP_LAUNCHED = "1";
    env.ZEN_MCP_LAUNCHED_PROFILE = root + "/other-installation/agent";
    assert.deepEqual(identity(), { browserMode: "agent", launchedByMcp: false });
    env.ZEN_MCP_LAUNCHED_PROFILE = profile;
    assert.deepEqual(identity(), { browserMode: "autonomous-agent", launchedByMcp: true });
  } finally {
    globalThis.Services = original;
    globalThis.Ci = interfaces;
  }
});
