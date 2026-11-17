import test from "node:test";
import assert from "node:assert/strict";
import { ExtensionPanels } from "../browser/ExtensionPanels.sys.mjs";

function fixture({ noPopup = false, busy = false, wait } = {}) {
  const win = { gBrowser: { getTabForBrowser: (browser) => ({ linkedBrowser: browser }) } };
  Object.defineProperty(win.gBrowser, "selectedTab", {
    set(tab) {
      this.selectedBrowser = tab.linkedBrowser;
    },
  });
  const source = { browserId: 1, ownerDocument: { defaultView: win }, browsingContext: { currentWindowGlobal: {} } };
  let version = 1,
    owner = "A",
    denied = false,
    clicks = 0,
    closes = 0;
  let popup;
  const env = {
    list: async () => [{ id: "fixture", name: "Fixture" }],
    extension: (id) => (id === "fixture" ? {} : null),
    action: () => ({
      action: { getPopupUrl: () => (noPopup ? "" : "moz-extension://fixture/popup.html") },
      triggerAction() {
        clicks++;
        popup = {
          shown: true,
          browser: { isConnected: true, browsingContext: { currentWindowGlobal: {} } },
          closePopup() {
            closes++;
            this.destroyed = true;
            this.shown = false;
          },
        };
      },
    }),
    confirmSwitch: async () => true,
    panelAllowed: () => true,
    popup: () => popup,
    busy: () => busy,
    check: (_, session) => {
      if (denied || owner !== session) throw new Error("access denied");
    },
    version: () => version,
    wait: wait || (async () => {}),
  };
  const panels = new ExtensionPanels(env);
  const open = (session = "A") => panels.open(source, session, 1, "fixture");
  const get = (session = "A") => panels.get(source, session, 1, "fixture");
  return {
    panels,
    source,
    win,
    open,
    get,
    env,
    get clicks() {
      return clicks;
    },
    get closes() {
      return closes;
    },
    transfer: (value) => {
      owner = value;
      version++;
    },
    deny: () => {
      denied = true;
    },
  };
}

test("opening uses real action on selected source tab and repeated open is idempotent", async () => {
  const h = fixture();
  assert.equal((await h.panels.list())[0].id, "fixture");
  const entry = await h.open();
  assert.equal(h.win.gBrowser.selectedBrowser, h.source);
  assert.equal(await h.open(), entry);
  assert.equal(h.clicks, 1);
});

test("panel handles belong to exact session, tab and extension", async () => {
  const h = fixture();
  await h.open();
  assert.throws(() => h.get("B"), /belongs|belongs to|No extension/);
  assert.throws(() => h.panels.get(h.source, "A", 2, "fixture"), /No extension/);
  assert.throws(() => h.panels.get(h.source, "A", 1, "different"), /No extension/);
  h.transfer("B");
  await assert.rejects(h.open("B"), /Another session/);
  assert.throws(() => h.panels.close(h.source, "B", 1, "fixture"), /another session/);
});

test("tab switch, navigation, popup dismissal and ownership round-trip invalidate refs", async () => {
  for (const mutate of [
    (h) => {
      h.win.gBrowser.selectedBrowser = {};
    },
    (h) => {
      h.source.browsingContext.currentWindowGlobal = {};
    },
    (h) => {
      h.get().popup.shown = false;
    },
    (h) => {
      h.transfer("B");
      h.transfer("A");
    },
  ]) {
    const h = fixture();
    await h.open();
    mutate(h);
    assert.throws(() => h.get(), /closed|changed/);
    assert.equal(h.panels.entries.size, 0);
    assert.equal(h.closes, 1);
  }
});

test("site denial is checked before invocation and on every subsequent access", async () => {
  const h = fixture();
  h.deny();
  await assert.rejects(h.open(), /denied/);
  assert.equal(h.clicks, 0);
  const allowed = fixture();
  await allowed.open();
  allowed.deny();
  assert.throws(() => allowed.get(), /denied/);
  allowed.panels.close(allowed.source, "A", 1, "fixture");
  assert.equal(allowed.closes, 1, "Cleanup remains possible after policy blocks access");
});

test("existing user UI and missing extensions do not cause side effects", async () => {
  const h = fixture({ busy: true });
  await assert.rejects(h.open(), /already open/);
  assert.equal(h.clicks, 0);
  const missing = fixture();
  await assert.rejects(missing.panels.open(missing.source, "A", 1, "missing"), /not found/);
});

test("toolbar-only extension executes once and reports that no popup exists", async () => {
  const h = fixture({ noPopup: true });
  assert.deepEqual(await h.open(), { invoked: true, hasPopup: false, extensionId: "fixture", tabId: 1 });
  assert.equal(h.clicks, 1);
  assert.equal(h.panels.entries.size, 0);
});

test("session end and bridge shutdown close only tracked panels", async () => {
  const h = fixture();
  await h.open();
  h.panels.releaseSession("B");
  assert.equal(h.closes, 0);
  h.panels.releaseSession("A");
  assert.equal(h.closes, 1);
  await h.open();
  h.panels.destroy();
  assert.equal(h.closes, 2);
});

test("panel navigation outside its own extension invalidates access", async () => {
  const h = fixture();
  await h.open();
  h.env.panelAllowed = () => false;
  assert.throws(() => h.get(), /closed|changed/);
  assert.equal(h.closes, 1);
});

test("switching tabs always requires approval, including toolbar-only actions", async () => {
  for (const noPopup of [false, true]) {
    const h = fixture({ noPopup });
    const previous = {};
    h.win.gBrowser.selectedBrowser = previous;
    let prompts = 0;
    h.env.confirmSwitch = async () => {
      prompts++;
      return false;
    };
    await assert.rejects(h.open(), /denied switching/);
    assert.equal(prompts, 1);
    assert.equal(h.clicks, 0);
    assert.equal(h.win.gBrowser.selectedBrowser, previous);
    h.env.confirmSwitch = async () => {
      prompts++;
      return true;
    };
    await h.open();
    assert.equal(prompts, 2);
    assert.equal(h.win.gBrowser.selectedBrowser, h.source);
  }
});

test("already selected target does not request a tab switch", async () => {
  const h = fixture();
  h.win.gBrowser.selectedBrowser = h.source;
  h.env.confirmSwitch = async () => {
    assert.fail("No switch is needed");
  };
  await h.open();
  assert.equal(h.clicks, 1);
});

test("changes while waiting cannot reuse tab-switch approval", async () => {
  for (const mutate of [
    (h) => {
      h.win.gBrowser.selectedBrowser = {};
    },
    (h) => {
      h.source.browsingContext.currentWindowGlobal = {};
    },
    (h) => {
      h.transfer("B");
      h.transfer("A");
    },
    (h) => {
      h.deny();
    },
  ]) {
    const h = fixture();
    h.env.confirmSwitch = async () => {
      mutate(h);
      return true;
    };
    await assert.rejects(h.open(), /changed|denied/);
    assert.equal(h.clicks, 0);
  }
});
