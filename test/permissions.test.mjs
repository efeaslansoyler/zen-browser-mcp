import test from "node:test";
import assert from "node:assert/strict";
import { siteRule, normalizeConfig } from "../browser/SiteRules.sys.mjs";
import { permissions } from "../browser/Permissions.sys.mjs";
import { Ownership } from "../browser/Ownership.sys.mjs";
import { bridgeContext } from "./support/bridge.mjs";

// Gecko globals the real site checks and navigation use.
globalThis.Services = {
  uriFixup: { getFixupURIInfo: (url) => ({ preferredURI: { spec: new URL(url).href } }) },
  io: { newURI: (url) => ({ host: new URL(url).hostname }) },
};

function harness({ mode = "auto", sensitive = [], sites = {}, site = "https://ordinary.test", answer } = {}) {
  const settings = normalizeConfig({ mode, sensitive, sites });
  const prompts = [],
    effects = [];
  const browser = { browserId: 1, browsingContext: {} };
  const navigate = (url, document = {}) => {
    const parsed = new URL(url);
    browser.currentURI = { host: parsed.hostname, prePath: parsed.origin, spec: parsed.href };
    browser.browsingContext.currentWindowGlobal = document;
  };
  navigate(site);
  const ownership = new Ownership();
  ownership.assign(1, "test-session");
  const context = bridgeContext({
    framesOf: () => [],
    ownership,
    activeSession: "test-session",
    browserFor: (id) => {
      ownership.check(id, "test-session");
      return browser;
    },
    readConfig: () => settings,
    state: { paused: false, tabs: new Set([1]) },
    activeAgent: { name: "Codex" },
    findTab: () => ({ linkedBrowser: browser }),
    paintTab() {},
    describeAction: () => "",
    logActivity() {},
    shortRefs: (x) => x,
    askIsland: async (...args) => {
      prompts.push({ host: browser.currentURI.host, message: args[2] });
      return answer ? answer({ prompts, browser, navigate, settings }) : "done";
    },
    text: (value) => [{ type: "text", text: value }],
    tools: {
      react: async () => {
        effects.push("react");
        return [];
      },
      accessibility: async () => {
        effects.push("axe");
        return [];
      },
      navigate: async (args) => {
        navigate(args.url);
        return [];
      },
      javascript_tool: async (args) => {
        effects.push(args.text);
        return [];
      },
      extensions: async (args) => {
        effects.push(args.action);
        return [];
      },
      read_page: async () => [],
      get_page_text: async () => [],
      computer: async () => [],
      redirect: async (args) => {
        navigate(args.url);
        return [];
      },
      changePolicy: async (args) => {
        Object.assign(settings, args.settings);
        return [];
      },
    },
  });
  const action = (name, input = {}) => ({ name, input: { tabId: 1, ...input } });
  const batch = (actions) => context.tools.browser_batch({ actions });
  return { context, browser, prompts, effects, settings, navigate, batch, action };
}

test("auto-mode batch rechecks a sensitive destination after navigation", async () => {
  const h = harness({ sensitive: ["sensitive.test"] });
  const result = await h.batch([
    h.action("javascript_tool", { text: "before" }),
    h.action("navigate", { url: "https://sensitive.test/" }),
    h.action("javascript_tool", { text: "after" }),
  ]);
  assert(!result.isError);
  assert.deepEqual(h.effects, ["before", "after"]);
  assert.equal(h.prompts.length, 1);
  assert.equal(h.prompts[0].host, "sensitive.test");
});

test("denying redirected destination prevents its write and all remaining steps", async () => {
  const h = harness({ sensitive: ["sensitive.test"], answer: () => "cancelled" });
  const result = await h.batch([
    h.action("redirect", { url: "https://sub.sensitive.test/" }),
    h.action("javascript_tool", { text: "must not run" }),
    h.action("javascript_tool", { text: "also blocked" }),
  ]);
  assert(result.isError);
  assert.deepEqual(h.effects, []);
  assert.equal(h.prompts.length, 1);
  assert.match(result[0].text, /remaining 1 step/);
});

test("ask mode groups unchanged-page actions but asks again after navigation", async () => {
  const h = harness({ mode: "ask" });
  await h.batch([
    h.action("javascript_tool", { text: "one" }),
    h.action("javascript_tool", { text: "two" }),
    h.action("navigate", { url: "https://other.test/" }),
    h.action("javascript_tool", { text: "three" }),
    h.action("javascript_tool", { text: "four" }),
  ]);
  assert.deepEqual(h.effects, ["one", "two", "three", "four"]);
  assert.equal(h.prompts.length, 2);
  assert(!h.prompts[0].message.includes("three"), "Destination actions must not be preapproved");
  assert(h.prompts[1].message.includes("three"));
});

test("same-origin document replacement invalidates a grant", async () => {
  const h = harness({ mode: "ask" });
  await h.batch([
    h.action("javascript_tool", { text: "one" }),
    h.action("redirect", { url: "https://ordinary.test/new-page" }),
    h.action("javascript_tool", { text: "two" }),
  ]);
  assert.equal(h.prompts.length, 2);
  assert.deepEqual(h.effects, ["one", "two"]);
});

test("navigation during the permission question requires a fresh answer", async () => {
  const h = harness({
    mode: "ask",
    answer: ({ prompts, navigate }) => {
      if (prompts.length === 1) {
        navigate("https://other.test/");
        return "done";
      }
      return "cancelled";
    },
  });
  const result = await h.batch([h.action("javascript_tool", { text: "blocked" })]);
  assert(result.isError);
  assert.equal(h.prompts.length, 2);
  assert.deepEqual(h.effects, []);
  assert.equal(h.prompts[1].host, "other.test");
});

test("a config change is checked even if the page did not change", async () => {
  const h = harness();
  await h.batch([
    h.action("javascript_tool", { text: "auto" }),
    h.action("changePolicy", { settings: { mode: "ask" } }),
    h.action("javascript_tool", { text: "needs permission" }),
  ]);
  assert.equal(h.prompts.length, 1);
  assert.deepEqual(h.effects, ["auto", "needs permission"]);
});

test("approved grants are invalidated by policy edits and do not leak across batches", async () => {
  const h = harness({ mode: "ask" });
  await h.batch([
    h.action("javascript_tool", { text: "one" }),
    h.action("changePolicy", { settings: { sites: { "ordinary.test": "ask" } } }),
    h.action("javascript_tool", { text: "two" }),
  ]);
  assert.equal(h.prompts.length, 2);
  await h.batch([h.action("javascript_tool", { text: "three" })]);
  assert.equal(h.prompts.length, 3);
});

test("automatic ordinary-site actions remain prompt free", async () => {
  const h = harness();
  await h.batch([
    h.action("javascript_tool", { text: "one" }),
    h.action("navigate", { url: "https://other.test/" }),
    h.action("javascript_tool", { text: "two" }),
  ]);
  assert.equal(h.prompts.length, 0);
  assert.deepEqual(h.effects, ["one", "two"]);
});

test("an origin change invalidates approval even before the document identity changes", async () => {
  const h = harness({ mode: "ask" });
  h.context.tools.changeOrigin = async () => {
    h.navigate("https://other.test/", h.browser.browsingContext.currentWindowGlobal);
    return [];
  };
  await h.batch([
    h.action("javascript_tool", { text: "one" }),
    h.action("changeOrigin"),
    h.action("javascript_tool", { text: "two" }),
  ]);
  assert.equal(h.prompts.length, 2);
  assert.equal(h.prompts[1].host, "other.test");
});

test("navigation while describing a target discards the old permission description", async () => {
  const h = harness({ mode: "ask" });
  let descriptions = 0;
  h.context.longRef = (x) => x;
  h.context.queryRef = async () => {
    if (++descriptions === 2) h.navigate("https://other.test/");
    return { value: `target on ${h.browser.currentURI.host}` };
  };
  h.context.tools.form_input = async () => {
    h.effects.push("typed");
    return [];
  };
  await h.batch([h.action("form_input", { ref: "ref_1", value: "hello" })]);
  assert.equal(h.prompts.length, 1);
  assert.equal(h.prompts[0].host, "other.test");
  assert(!h.prompts[0].message.includes("ordinary.test"));
  assert.deepEqual(h.effects, ["typed"]);
});

test("block overrides auto and ask, denying reads and writes without a prompt", async () => {
  for (const mode of ["auto", "ask"]) {
    const h = harness({ mode, sites: { "ordinary.test": "block" } });
    for (const name of ["javascript_tool", "read_page", "computer", "get_page_text"]) {
      const result = await h.batch([h.action(name, { action: "screenshot", text: "forbidden" })]);
      assert(result.isError);
      assert.match(result[0].text, /blocked/);
    }
    assert.deepEqual(h.effects, []);
    assert.equal(h.prompts.length, 0);
  }
});

test("blocked destination stops navigation before effect or permission prompt", async () => {
  const h = harness({ mode: "ask", sites: { "blocked.test": "block" } });
  const result = await h.batch([
    h.action("navigate", { url: "https://sub.blocked.test/path" }),
    h.action("javascript_tool", { text: "never" }),
  ]);
  assert(result.isError);
  assert.equal(h.browser.currentURI.host, "ordinary.test");
  assert.equal(h.prompts.length, 0);
});

test("blocking a site midway through a batch stops remaining steps", async () => {
  const h = harness();
  const result = await h.batch([
    h.action("javascript_tool", { text: "before" }),
    h.action("changePolicy", { settings: { sites: { "ordinary.test": "block" } } }),
    h.action("javascript_tool", { text: "never" }),
  ]);
  assert(result.isError);
  assert.deepEqual(h.effects, ["before"]);
});

test("blocked iframe prevents parent reads and screenshots", async () => {
  const h = harness({ sites: { "blocked.test": "block" } });
  h.context.framesOf = () => [{ currentWindowGlobal: { documentURI: { spec: "https://blocked.test/embed" } } }];
  const result = await h.batch([h.action("javascript_tool", { text: "never" })]);
  assert(result.isError);
  assert.match(result[0].text, /blocked/);
  assert.deepEqual(h.effects, []);
});

test("extension UI writes use source-site approvals; reads are free and block denies opening", async () => {
  const h = harness({ sites: { "ordinary.test": "ask" } });
  for (const input of [
    { action: "open", extensionId: "fixture" },
    { action: "read" },
    { action: "computer", computerAction: "screenshot" },
    { action: "computer", computerAction: "left_click", ref: "panel_1:ref_1" },
  ]) {
    await h.batch([h.action("extensions", input)]);
  }
  assert.equal(h.prompts.length, 2, "Open and click ask; panel read/screenshot do not");
  const denied = harness({ sites: { "ordinary.test": "block" } });
  const result = await denied.batch([denied.action("extensions", { action: "open", extensionId: "fixture" })]);
  assert(result.isError);
  assert.deepEqual(denied.effects, []);
  assert.equal(denied.prompts.length, 0);
});

test("React props and axe scans respect ask/site approval and block including batches", async () => {
  for (const tool of ["react", "accessibility"]) {
    for (const settings of [{ mode: "ask" }, { sites: { "ordinary.test": "ask" } }]) {
      const h = harness({ ...settings, answer: () => "denied" });
      const result = await h.batch([h.action(tool, { action: "tree", include_props: true })]);
      assert.equal(result.isError, true);
      assert.equal(h.prompts.length, 1);
      assert.deepEqual(h.effects, []);
    }
    const h = harness({ sites: { "ordinary.test": "block" } });
    assert.equal((await h.batch([h.action(tool)])).isError, true);
    assert.deepEqual(h.effects, []);
  }
});

test("permission module describes actions and scopes approvals without slicing main.js", async () => {
  const settings = normalizeConfig({ mode: "auto", sites: { "bank.test": "ask" } });
  const ownership = new Ownership();
  ownership.assign(1, "s");
  const asked = [];
  const p = permissions({
    L: (en) => en,
    DialogOpen: class extends Error {},
    Stopped: class extends Error {},
    ownership,
    queryRef: async () => ({ value: 'button "Pay"' }),
    longRef: (x) => x,
    readConfig: () => settings,
    isSensitive: (host) => siteRule(host, settings.sites) === "ask",
    hostOf: (b) => b.currentURI.host,
    assertSiteAccess() {},
    holdsButtons: () => false,
    askIsland: async (...args) => {
      asked.push(args[2]);
      return "done";
    },
    operation: null,
    activeAgent: { name: "Claude" },
  });
  const browser = {
    browserId: 1,
    browsingContext: { currentWindowGlobal: {} },
    currentURI: { host: "bank.test", prePath: "https://bank.test" },
  };
  assert.equal(
    await p.describeWrite("computer", { action: "left_click", ref: "ref_1" }, browser),
    'button "Pay": click',
  );
  assert.equal(await p.describeWrite("computer", { action: "screenshot" }, browser), null);
  assert.equal(await p.describeWrite("navigate", { url: "back" }, browser), "go back");
  // On an "ask" site navigation is free; actions are asked
  assert.equal(p.needsPermission("navigate", browser), false);
  assert.equal(p.needsPermission("computer", browser), true);
  const { context, asked: prompted } = await p.requirePermission(browser, [
    { tool: "computer", args: { action: "left_click", ref: "ref_1" } },
  ]);
  assert.equal(prompted, true);
  assert.equal(asked[0], 'Claude wants to: button "Pay": click');
  // An approval belongs to the document and the ownership version
  assert(p.samePermissionContext(context, p.permissionContext(browser)));
  ownership.assign(1, "other");
  assert(!p.samePermissionContext(context, p.permissionContext(browser)));
});
