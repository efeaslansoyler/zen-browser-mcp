import test from "node:test";
import assert from "node:assert/strict";
import { TabWake } from "../browser/TabWake.sys.mjs";
import { bridgeContext, testCall } from "./support/bridge.mjs";

function harness(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  return new TabWake({ setTimeout, clearTimeout, setInterval, clearInterval, selected: (browser) => browser.selected });
}

const background = () => ({ isConnected: true, docShellIsActive: false });

test("overlapping holds keep the tab awake and the last release starts a five-second grace", (t) => {
  const wake = harness(t);
  const browser = background();
  const first = wake.hold(browser);
  const second = wake.hold(browser);
  assert.equal(browser.docShellIsActive, true);
  first();
  first();
  t.mock.timers.tick(6000);
  assert.equal(browser.docShellIsActive, true);
  second();
  t.mock.timers.tick(4999);
  assert.equal(browser.docShellIsActive, true);

  const third = wake.hold(browser);
  t.mock.timers.tick(1);
  assert.equal(browser.docShellIsActive, true);
  third();
  t.mock.timers.tick(5000);
  assert.equal(browser.docShellIsActive, false);
  assert.equal(wake.awake(browser), false);
});

test("a hold reasserts activity every two seconds after the tab switcher deactivates it", (t) => {
  const wake = harness(t);
  const browser = background();
  const release = wake.hold(browser);
  for (let i = 0; i < 2; i++) {
    browser.docShellIsActive = false;
    t.mock.timers.tick(1999);
    assert.equal(browser.docShellIsActive, false);
    t.mock.timers.tick(1);
    assert.equal(browser.docShellIsActive, true);
  }
  release();
  browser.docShellIsActive = false;
  t.mock.timers.tick(2000);
  assert.equal(browser.docShellIsActive, false);
});

test("a selected tab is left alone even when its hold expires or is forgotten", (t) => {
  const wake = harness(t);
  const browser = {
    isConnected: true,
    selected: true,
    get docShellIsActive() {
      return false;
    },
    set docShellIsActive(value) {
      assert.fail(`Changed selected tab activity to ${value}`);
    },
  };
  // Count writes outside the setter because the bridge tolerates Gecko setter failures.
  const set = t.mock.setter(browser, "docShellIsActive");
  const release = wake.hold(browser);
  t.mock.timers.tick(2000);
  release();
  t.mock.timers.tick(5000);
  wake.hold(browser);
  wake.forget(browser);
  assert.equal(set.mock.callCount(), 0);
});

test("forget deactivates immediately and releases from old holds cannot affect a new hold", (t) => {
  const wake = harness(t);
  const browser = background();
  const old = wake.hold(browser);
  wake.forget(browser);
  assert.equal(browser.docShellIsActive, false);
  assert.equal(wake.awake(browser), false);
  const release = wake.hold(browser);
  old();
  t.mock.timers.tick(6000);
  assert.equal(browser.docShellIsActive, true);
  release();
  t.mock.timers.tick(5000);
  assert.equal(browser.docShellIsActive, false);
});

test("destroy clears tab activity and timers for held tabs and tabs in grace", (t) => {
  const wake = harness(t);
  const held = background();
  const inGrace = background();
  const release = wake.hold(held);
  wake.hold(inGrace)();
  wake.destroy();
  assert.equal(held.docShellIsActive, false);
  assert.equal(inGrace.docShellIsActive, false);
  assert.equal(wake.awake(held), false);
  assert.equal(wake.awake(inGrace), false);
  release();
  t.mock.timers.tick(6000);
  assert.equal(held.docShellIsActive, false);
  assert.equal(inGrace.docShellIsActive, false);
});

test("runTool holds the tab through the tool and releases after success or failure", async () => {
  const browser = { browserId: 1 };
  const tab = { linkedBrowser: browser };
  const activity = [];
  const ctx = bridgeContext({
    findTab: () => tab,
    paintTab() {},
    hostOf: () => null,
    describeAction() {},
    describeWrite() {},
    assertSiteAccess() {},
    permissionContext: () => null,
    requirePermission: async () => ({ context: null }),
    samePermissionContext: () => true,
    releaseInputs() {},
    logActivity() {},
    tabWake: {
      hold(tabBrowser) {
        assert.equal(tabBrowser, browser);
        activity.push("held");
        return () => activity.push("released");
      },
    },
    tools: {
      async computer({ fail }) {
        await Promise.resolve();
        assert.equal(activity.at(-1), "held");
        activity.push("ran");
        if (fail) throw new Error("tool failed");
        return [];
      },
      watch: () => [],
      downloads: () => [],
      tabs_close_mcp: () => [],
      extensions: () => [],
    },
  });
  ctx.state.tabs.add(1);
  ctx.access.join(1, "A");
  const call = testCall(ctx);
  await ctx.runTool(call, "computer", { tabId: 1, action: "wait" });
  await assert.rejects(ctx.runTool(call, "computer", { tabId: 1, action: "wait", fail: true }), /tool failed/);
  await ctx.runTool(call, "watch", { tabId: 1, text: "Ready" });
  await ctx.runTool(call, "downloads", { tabId: 1, action: "wait" });
  await ctx.runTool(call, "tabs_close_mcp", { tabId: 1 });
  await ctx.runTool(call, "extensions", { tabId: 1, action: "close" });
  assert.deepEqual(activity, ["held", "ran", "released", "held", "ran", "released"]);
});
