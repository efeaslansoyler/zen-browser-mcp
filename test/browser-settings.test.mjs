import test from "node:test";
import assert from "node:assert/strict";
import { BrowserSettings } from "../browser/BrowserSettings.sys.mjs";
function fixture(answer = true, modalOpen = () => false) {
  const properties = new Map(),
    priority = new Map();
  const source = {
    browserId: 1,
    fullZoom: 1,
    style: {
      getPropertyValue: (k) => properties.get(k) || "",
      getPropertyPriority: (k) => priority.get(k) || "",
      setProperty(k, v, p) {
        properties.set(k, v);
        priority.set(k, p);
      },
      removeProperty(k) {
        properties.delete(k);
        priority.delete(k);
      },
    },
    browsingContext: {
      currentWindowGlobal: {},
      overrideDPPX: 0,
      customUserAgent: "",
      touchEventsOverride: "none",
      prefersColorSchemeOverride: "none",
    },
  };
  const win = {
    gBrowser: { selectedBrowser: {}, getTabForBrowser: (b) => ({ linkedBrowser: b }) },
    document: { documentElement: { hasAttribute: (name) => name === "window-modal-open" && modalOpen() } },
  };
  Object.defineProperty(win.gBrowser, "selectedTab", {
    set(t) {
      this.selectedBrowser = t.linkedBrowser;
    },
  });
  source.ownerDocument = { defaultView: win };
  let version = 1;
  const env = {
    check() {},
    context: () => String(version),
    ask: async () => (typeof answer === "function" ? answer() : answer),
    wait: async () => {},
    geckoVersion: "158.0",
  };
  return { settings: new BrowserSettings(env), source, win, env, properties, change: () => version++ };
}
test("a browser modal blocks settings that need a tab switch, including after approval", async () => {
  for (const alreadyOpen of [true, false]) {
    let modalOpen = alreadyOpen;
    let prompts = 0;
    const h = fixture(
      () => {
        prompts++;
        modalOpen = true;
        return true;
      },
      () => modalOpen,
    );
    const selected = h.win.gBrowser.selectedBrowser;
    await assert.rejects(h.settings.change(h.source, "A", { action: "device", device: "mobile" }), /close.*dialog/i);
    assert.equal(prompts, alreadyOpen ? 0 : 1);
    assert.equal(h.win.gBrowser.selectedBrowser, selected);
    assert.equal(h.properties.size, 0);
  }
});
test("settings mutations always ask and denial preserves selected tab and overrides", async () => {
  const h = fixture(false),
    selected = h.win.gBrowser.selectedBrowser;
  await assert.rejects(h.settings.change(h.source, "A", { action: "device", device: "mobile" }), /denied/);
  assert.equal(h.win.gBrowser.selectedBrowser, selected);
  assert.equal(h.source.browsingContext.overrideDPPX, 0);
  assert.equal(h.properties.size, 0);
});
test("tab-local device settings can be restored without overwriting later manual edits", async () => {
  const h = fixture();
  await h.settings.change(h.source, "A", { action: "device", device: "mobile" });
  assert.equal(h.properties.get("width"), "390px");
  assert.equal(h.source.browsingContext.overrideDPPX, 3);
  assert.equal(
    h.source.browsingContext.customUserAgent,
    "Mozilla/5.0 (Android 15; Mobile; rv:158.0) Gecko/158.0 Firefox/158.0",
  );
  h.source.browsingContext = { ...h.source.browsingContext }; // why: Model Gecko's emulation override surviving a Fission context replacement.
  h.source.browsingContext.touchEventsOverride = "manually changed";
  h.settings.restoreTab(1);
  assert.equal(h.properties.size, 0);
  assert.equal(h.source.browsingContext.overrideDPPX, 0);
  assert.equal(h.source.browsingContext.customUserAgent, "");
  assert.equal(h.source.browsingContext.touchEventsOverride, "manually changed");
});
test("changed approval contexts and invalid settings never mutate a tab", async () => {
  const h = fixture(() => {
    h.change();
    return true;
  });
  await assert.rejects(h.settings.change(h.source, "A", { action: "viewport", width: 400, height: 700 }), /changed/);
  assert.equal(h.properties.size, 0);
  for (const args of [
    { action: "viewport", width: 0, height: 700 },
    { action: "device", device: "invalid" },
    { action: "media" },
  ])
    assert.throws(() => h.settings.validate(args));
});
