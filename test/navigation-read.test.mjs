import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { inputTools } from "../browser/InputTools.sys.mjs";
import { readTools } from "../browser/ReadTools.sys.mjs";
import { normalizeConfig } from "../browser/SiteRules.sys.mjs";
import { bridgeContext } from "./support/bridge.mjs";

function harness({ sites, rules = {}, redirect, waitForLoad = async () => {}, userTabs = [] } = {}) {
  const loads = [];
  const reads = [];
  const prompts = [];
  const settings = normalizeConfig({ mode: "auto", sites });
  const tabs = new Map();
  const services = (globalThis.Services = {
    uriFixup: {
      getFixupURIInfo: (url) => ({ preferredURI: { spec: new URL(url.includes(":") ? url : "https://" + url).href } }),
    },
    io: { newURI: (url) => ({ host: new URL(url).hostname }) },
    scriptSecurityManager: { getSystemPrincipal: () => ({}) },
  });
  const ctx = bridgeContext({
    createTab: async (session, { clean }) => {
      const browserId = tabs.size + 1;
      const tab = { clean, getAttribute: () => "true", hasAttribute: () => false };
      const load = (url) => {
        loads.push(url);
        setDocument(redirect ?? url);
      };
      const frame = { id: browserId, getAllBrowsingContextsInSubtree: () => [frame] };
      const browser = {
        browserId,
        browsingContext: frame,
        ownerDocument: { defaultView: { gBrowser: { getTabForBrowser: () => tab } } },
        fixupAndLoadURIString: load,
        goBack: () => load("https://example.test/back"),
        goForward: () => load("https://example.test/forward"),
      };
      function setDocument(url) {
        browser.currentURI = services.uriFixup.getFixupURIInfo(url).preferredURI;
        frame.currentWindowGlobal = { documentURI: browser.currentURI };
      }
      setDocument("about:blank");
      tab.linkedBrowser = browser;
      tabs.set(browserId, tab);
      ctx.state.tabs.add(browserId);
      ctx.access.join(browserId, session);
      return tab;
    },
    restoreMark() {},
    browserWindows: () => [{ gBrowser: { tabs: [...tabs.values(), ...userTabs] } }],
    windowTabs: (win) => win.gBrowser.tabs,
    findTab: (id) => tabs.get(id),
    describeTab: ({ linkedBrowser }) => ({ tabId: linkedBrowser.browserId, url: linkedBrowser.currentURI.spec }),
    describeAction: (tool) => tool,
    readConfig: () => settings,
    rule: (key) => rules[key] ?? "allow",
    hostOf: (browser) => new URL(browser.currentURI.spec).hostname,
    paintTab() {},
    logActivity() {},
    releaseInputs() {},
    waitForLoad,
    query: async (browser, tool, options) => {
      assert.equal(tool, "read_page");
      reads.push({ url: browser.currentURI.spec, options });
      return { value: 'button "Continue" [ref_1]' };
    },
    reply: (reply, _output, result) => reply(result),
  });
  Object.assign(ctx.tools, inputTools(ctx), readTools(ctx));
  const tool = (name, args = {}) => {
    let result;
    return ctx
      .handle(JSON.stringify({ tool: name, args, session: "test" }), (reply) => (result = reply))
      .then(() => result);
  };
  return { tool, loads, reads, prompts, tabs, ctx };
}

test("creating a tab keeps the metadata-only default and can append a bounded read of the loaded page", async () => {
  const h = harness();
  const empty = await h.tool("tabs_create_mcp");
  assert.deepEqual(
    empty.content.map((part) => JSON.parse(part.text)),
    [{ tabId: 1, url: "about:blank" }],
  );
  const metadata = await h.tool("tabs_create_mcp", { url: "example.test" });
  assert.deepEqual(
    metadata.content.map((part) => JSON.parse(part.text)),
    [{ tabId: 2, url: "https://example.test/" }],
  );
  const page = await h.tool("tabs_create_mcp", { url: "example.test/form", read: "all", clean: true });
  assert.deepEqual(JSON.parse(page.content[0].text), { tabId: 3, url: "https://example.test/form" });
  assert.equal(h.tabs.get(3).clean, true);
  assert.deepEqual(h.loads, ["example.test", "example.test/form"]);
  assert.equal(page.content[1].text, 'button "Continue" [ref_1]');
  assert.equal(h.reads.length, 1);
  assert.equal(h.reads[0].url, "https://example.test/form");
  assert.equal(h.reads[0].options.filter, "all");
  assert.equal(h.reads[0].options.max_chars, 8000);
});

test("navigation reads history destinations and leaves explicit diff baselines intact", async () => {
  const h = harness();
  await h.tool("tabs_create_mcp", { url: "example.test" });
  const read = { tabId: 1, filter: "interactive", max_chars: 8000, diff: true };
  const baseline = (await h.tool("read_page", read)).content[0].text;
  const snapshotId = /^snapshot: (\S+)/.exec(baseline)[1];
  for (const url of ["back", "forward"]) {
    const result = await h.tool("navigate", { tabId: 1, url, read: "interactive" });
    assert.equal(result.content[1].text, 'button "Continue" [ref_1]');
    assert.equal(h.reads.at(-1).url, "https://example.test/" + url);
    assert.equal(h.reads.at(-1).options.filter, "interactive");
  }
  const diff = await h.tool("read_page", { ...read, since: snapshotId });
  assert.match(diff.content[0].text, /mode: full \(document-or-owner-changed\)/);
  const fresh = await h.tool("read_page", { ...read, filter: "all" });
  assert.match(fresh.content[0].text, /mode: full \(no-baseline\)/);
});

test("creating with a URL applies blocklist and allowlist checks before loading", async () => {
  for (const sites of [{ blocklist: ["blocked.test"] }, { mode: "allowlist", allowlist: ["example.test"] }]) {
    const h = harness({ sites });
    const result = await h.tool("tabs_create_mcp", { url: "blocked.test", read: "all" });
    assert.equal(result.ok, false);
    assert.match(result.error, /Opened tab 1\. Site access blocked.*blocked\.test/);
    assert.deepEqual(h.loads, []);
    assert.deepEqual(h.reads, []);
  }
});

test("a blocked destination after redirect is never read", async () => {
  const h = harness({ sites: { blocklist: ["blocked.test"] }, redirect: "https://blocked.test/" });
  const result = await h.tool("tabs_create_mcp", { url: "example.test", read: "all" });
  assert.equal(result.ok, false);
  assert.match(result.error, /Site access blocked/);
  assert.deepEqual(h.loads, ["example.test"]);
  assert.deepEqual(h.reads, []);
});

test("creation, navigation and the destination read each enforce their own permission", async () => {
  for (const denied of ["tabs_create_mcp", "navigate", "read_page"]) {
    const h = harness({ rules: { [denied]: "deny" } });
    const result = await h.tool("tabs_create_mcp", { url: "example.test", read: "all" });
    assert.equal(result.ok, false);
    assert.match(result.error, new RegExp("permission settings.*" + denied));
    assert.equal(h.tabs.size, denied === "tabs_create_mcp" ? 0 : 1);
    assert.equal(h.loads.length, denied === "read_page" ? 1 : 0);
    assert.deepEqual(h.reads, []);
  }
  const h = harness({ rules: { navigate: "ask", read_page: "ask" } });
  h.ctx.askIsland = async (_call, browser, _label, message) => {
    h.prompts.push([browser.currentURI.spec, message]);
    return "done";
  };
  assert.equal((await h.tool("tabs_create_mcp", { url: "example.test", read: "all" })).ok, true);
  assert.deepEqual(h.prompts, [
    ["about:blank", 'Claude wants to: go to "example.test"'],
    ["https://example.test/", "Claude wants to: read_page"],
  ]);
});

test("a second navigation queues behind the new tab's load and read", async () => {
  const { promise, resolve } = Promise.withResolvers();
  const h = harness({ waitForLoad: () => promise });
  const first = h.tool("tabs_create_mcp", { url: "example.test/first", read: "all" });
  await setImmediate();
  const second = h.tool("navigate", { tabId: 1, url: "example.test/second" });
  await setImmediate();
  assert.deepEqual(h.loads, ["example.test/first"]);
  resolve();
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  assert.deepEqual(h.loads, ["example.test/first", "example.test/second"]);
  assert.equal(h.reads[0].url, "https://example.test/first");
});

test("an agent tab that opens a site the user has open points to the user's tab", async () => {
  const userTab = (browserId, url, title) => ({
    hasAttribute: () => false,
    linkedBrowser: { browserId, currentURI: { spec: url }, contentTitle: title },
  });
  const h = harness({
    userTabs: [userTab(90, "https://video.test/watch?v=1", "My video"), userTab(91, "https://other.test/", "Other")],
  });
  const opened = await h.tool("tabs_create_mcp", { url: "https://video.test/" });
  assert.equal(opened.ok, true, opened.error);
  const hint = JSON.parse(opened.content.at(-1).text);
  assert.deepEqual(hint.userTabsOnThisSite, [{ tabId: 90, title: "My video" }]);
  assert.match(hint.note, /request_tab/);
  const tabId = JSON.parse(opened.content[0].text).tabId;
  const again = await h.tool("navigate", { tabId, url: "https://video.test/other" });
  assert.equal(again.content.length, 1, "Moving within the same site does not repeat the hint");
  const elsewhere = await h.tool("navigate", { tabId, url: "https://news.test/" });
  assert.equal(elsewhere.content.length, 1, "No hint when the user has no tab on the site");
});

test("the same page read three times in a row suggests wait_for once", async () => {
  const h = harness();
  const { tabId } = JSON.parse((await h.tool("tabs_create_mcp", { url: "https://example.test/" })).content[0].text);
  const read = () => h.tool("read_page", { tabId, filter: "interactive" });
  const hinted = (result) => result.content.some((c) => /wait_for/.test(c.text));
  assert.equal(hinted(await read()), false);
  assert.equal(hinted(await read()), false);
  assert.equal(hinted(await read()), true);
  assert.equal(hinted(await read()), false, "The hint comes once per streak");
  await h.tool("navigate", { tabId, url: "https://example.test/next" });
  assert.equal(hinted(await read()), false, "Another call ends the streak");
});
