import test from "node:test";
import assert from "node:assert/strict";
import { bridgeContext } from "./support/bridge.mjs";

function harness(config = {}) {
  const created = [],
    identities = [];
  const service = {
    getPublicIdentities: () => identities,
    getUserContextLabel: (id) => identities.find((i) => i.userContextId === id)?.name ?? "",
    create(name, icon, color) {
      const identity = { userContextId: identities.length + 5, name, icon, color };
      identities.push(identity);
      return identity;
    },
  };
  globalThis.ChromeUtils = { importESModule: () => ({ ContextualIdentityService: service }) };
  const win = {
    gBrowser: {
      addTrustedTab(url, options) {
        created.push(options);
        const attrs = new Map();
        return {
          userContextId: options.userContextId,
          linkedBrowser: { browserId: created.length, currentURI: { spec: url } },
          style: { removeProperty() {} },
          getAttribute: (key) => attrs.get(key) ?? null,
          setAttribute: (key, value) => attrs.set(key, value),
        };
      },
    },
  };
  globalThis.Services = { wm: { getMostRecentWindow: () => win } };
  const ctx = bridgeContext({
    readConfig: () => ({ mode: "auto", sites: { mode: "blocklist", blocklist: [], allowlist: [] }, ...config }),
    paintTab() {},
    SessionStore: { setCustomTabValue() {} },
    hostOf: () => "",
  });
  ctx.sessionInfo("A");
  return { ctx, created, identities, win };
}

test("clean tabs share one Agent container, created on first use", async () => {
  const h = harness();
  const first = await h.ctx.createTab("A", { clean: true });
  await h.ctx.createTab("A", { clean: true });
  assert.equal(h.identities.length, 1);
  assert.equal(h.identities[0].name, "Agent");
  assert.deepEqual(
    h.created.map((o) => o.userContextId),
    [5, 5],
  );
  assert.equal(h.ctx.describeTab(first).container, "Agent");
  const plain = await h.ctx.createTab("A");
  assert.equal(h.created.at(-1).userContextId, 0);
  assert.equal(h.ctx.describeTab(plain).container, undefined);
});

test("a configured container is the default; clean: false still uses the user's logins", async () => {
  const h = harness({ container: "Research" });
  await h.ctx.createTab("A");
  await h.ctx.createTab("A", { clean: false });
  assert.deepEqual(
    h.identities.map((i) => i.name),
    ["Research"],
  );
  assert.deepEqual(
    h.created.map((o) => o.userContextId),
    [5, 0],
  );
});

test("a tab opened while the window starts is placed once Zen's workspaces are ready", async () => {
  const h = harness({ workspace: "Agents" });
  let startupDone, initDone;
  const moved = [];
  h.win.delayedStartupPromise = new Promise((resolve) => (startupDone = resolve));
  const spaces = {
    workspaceEnabled: true,
    promiseInitialized: new Promise((resolve) => (initDone = resolve)),
    workspaces: [],
    getWorkspaces: () => spaces.workspaces,
    async createAndSaveWorkspace(name) {
      const space = { name, uuid: "{agents}" };
      spaces.workspaces.push(space);
      return space;
    },
    async moveTabToWorkspace(tab, uuid) {
      moved.push(uuid);
      tab.setAttribute("zen-workspace-id", uuid);
    },
  };
  let done = false;
  const created = h.ctx.createTab("A").then((tab) => ((done = true), tab));
  await new Promise(setImmediate);
  assert.equal(h.created.length, 0);
  h.win.gZenWorkspaces = spaces;
  startupDone();
  await new Promise(setImmediate);
  assert.equal(done, false);
  assert.deepEqual(spaces.workspaces, []);
  initDone();
  const tab = await created;
  assert.deepEqual(moved, ["{agents}"]);
  assert.equal(tab.getAttribute("zen-workspace-id"), "{agents}");
});
