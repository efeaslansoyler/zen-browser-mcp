import test from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig, normalizeSites } from "../browser/SiteRules.sys.mjs";
import { permissions } from "../browser/Permissions.sys.mjs";
import * as policy from "../browser/Policy.sys.mjs";
import { TabAccess } from "../browser/TabAccess.sys.mjs";
import { bridgeContext, testCall, uri } from "./support/bridge.mjs";

globalThis.Services = {
  uriFixup: { getFixupURIInfo: (url) => ({ preferredURI: uri(url) }) },
  io: { newURI: (url) => ({ host: new URL(url).hostname }) },
};

function harness({ mode = "auto", sites = {}, site = "https://ordinary.test", answer, autonomous, custom } = {}) {
  const settings = normalizeConfig({ mode, sites });
  const prompts = [],
    effects = [];
  const browser = { browserId: 1, browsingContext: {} };
  const navigate = (url, document = {}) => {
    const parsed = new URL(url);
    browser.currentURI = { ...uri(url), host: parsed.hostname, prePath: parsed.origin };
    browser.browsingContext.currentWindowGlobal = document;
  };
  navigate(site);
  const access = new TabAccess();
  access.join(1, "test-session");
  const context = bridgeContext({
    autonomous,
    readPermissions: () => custom,
    framesOf: () => [],
    access,
    browserFor: (_call, id) => {
      access.check(id, "test-session");
      return browser;
    },
    readConfig: () => settings,
    state: { paused: false, tabs: new Set([1]) },
    findTab: () => ({ linkedBrowser: browser }),
    paintTab() {},
    describeAction: () => "",
    logActivity() {},
    shortRefs: (x) => x,
    askIsland: async (...args) => {
      prompts.push({ host: browser.currentURI.host, message: args[3] });
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
      form_input: async (args) => {
        effects.push(args.value);
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
  const batch = (actions) =>
    context.tools.browser_batch({ actions }, testCall(context, { session: "test-session", agent: { name: "Codex" } }));
  return { context, browser, prompts, effects, settings, navigate, batch, action };
}

test("an auto-mode batch asks only the risky step, on the page it runs on", async () => {
  const h = harness();
  const result = await h.batch([
    h.action("form_input", { value: "before" }),
    h.action("navigate", { url: "https://other.test/" }),
    h.action("javascript_tool", { text: "after" }),
  ]);
  assert(!result.isError);
  assert.deepEqual(h.effects, ["before", "after"]);
  assert.equal(h.prompts.length, 1);
  assert.equal(h.prompts[0].host, "other.test");
});

test("denying a batch's risky steps stops the batch before it runs", async () => {
  const h = harness({ answer: () => "cancelled" });
  const result = await h.batch([
    h.action("redirect", { url: "https://sub.other.test/" }),
    h.action("javascript_tool", { text: "must not run" }),
    h.action("javascript_tool", { text: "also blocked" }),
  ]);
  assert(result.isError);
  assert.deepEqual(h.effects, []);
  assert.equal(h.prompts.length, 1);
  assert.match(result[0].text, /remaining 2 step/);
});

test("ask mode groups unchanged-page actions but asks again after navigation", async () => {
  const h = harness({ mode: "ask" });
  await h.batch([
    h.action("form_input", { value: "one" }),
    h.action("form_input", { value: "two" }),
    h.action("navigate", { url: "https://other.test/" }),
    h.action("form_input", { value: "three" }),
    h.action("form_input", { value: "four" }),
  ]);
  assert.deepEqual(h.effects, ["one", "two", "three", "four"]);
  assert.equal(h.prompts.length, 2);
  assert(!h.prompts[0].message.includes("three"), "Destination actions must not be preapproved");
  assert(h.prompts[1].message.includes("three"));
});

test("same-origin document replacement invalidates a grant", async () => {
  const h = harness({ mode: "ask" });
  await h.batch([
    h.action("form_input", { value: "one" }),
    h.action("redirect", { url: "https://ordinary.test/new-page" }),
    h.action("form_input", { value: "two" }),
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
  const result = await h.batch([h.action("form_input", { value: "blocked" })]);
  assert(result.isError);
  assert.equal(h.prompts.length, 2);
  assert.deepEqual(h.effects, []);
  assert.equal(h.prompts[1].host, "other.test");
});

test("a config change is checked even if the page did not change", async () => {
  const h = harness();
  await h.batch([
    h.action("form_input", { value: "auto" }),
    h.action("changePolicy", { settings: { mode: "ask" } }),
    h.action("form_input", { value: "needs permission" }),
  ]);
  assert.equal(h.prompts.length, 1);
  assert.deepEqual(h.effects, ["auto", "needs permission"]);
});

test("approved grants are invalidated by policy edits and do not leak across batches", async () => {
  const h = harness({ mode: "ask" });
  await h.batch([
    h.action("form_input", { value: "one" }),
    h.action("changePolicy", { settings: { sites: normalizeSites({ blocklist: ["elsewhere.test"] }) } }),
    h.action("form_input", { value: "two" }),
  ]);
  assert.equal(h.prompts.length, 2);
  await h.batch([h.action("form_input", { value: "three" })]);
  assert.equal(h.prompts.length, 3);
});

test("automatic ordinary-site actions remain prompt free", async () => {
  const h = harness();
  await h.batch([
    h.action("form_input", { value: "one" }),
    h.action("navigate", { url: "https://other.test/" }),
    h.action("form_input", { value: "two" }),
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
    h.action("form_input", { value: "one" }),
    h.action("changeOrigin"),
    h.action("form_input", { value: "two" }),
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
    const h = harness({ mode, sites: { blocklist: ["ordinary.test"] } });
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
  const h = harness({ mode: "ask", sites: { blocklist: ["blocked.test"] } });
  const result = await h.batch([
    h.action("navigate", { url: "https://sub.blocked.test/path" }),
    h.action("form_input", { value: "never" }),
  ]);
  assert(result.isError);
  assert.equal(h.browser.currentURI.host, "ordinary.test");
  assert.equal(h.prompts.length, 0);
});

test("blocking a site midway through a batch stops remaining steps", async () => {
  const h = harness();
  const result = await h.batch([
    h.action("form_input", { value: "before" }),
    h.action("changePolicy", { settings: { sites: normalizeSites({ blocklist: ["ordinary.test"] }) } }),
    h.action("form_input", { value: "never" }),
  ]);
  assert(result.isError);
  assert.deepEqual(h.effects, ["before"]);
});

test("blocked iframe prevents parent reads and screenshots", async () => {
  const h = harness({ sites: { blocklist: ["blocked.test"] } });
  h.context.framesOf = () => [{ currentWindowGlobal: { documentURI: { spec: "https://blocked.test/embed" } } }];
  const result = await h.batch([h.action("form_input", { value: "never" })]);
  assert(result.isError);
  assert.match(result[0].text, /blocked/);
  assert.deepEqual(h.effects, []);
});

test("extension UI writes use source-site approvals; reads are free and block denies opening", async () => {
  const h = harness({ mode: "ask" });
  for (const input of [
    { action: "open", extensionId: "fixture" },
    { action: "read" },
    { action: "computer", computerAction: "screenshot" },
    { action: "computer", computerAction: "left_click", ref: "panel_1:ref_1" },
  ]) {
    await h.batch([h.action("extensions", input)]);
  }
  assert.equal(h.prompts.length, 2, "Open and click ask; panel read/screenshot do not");
  const denied = harness({ sites: { blocklist: ["ordinary.test"] } });
  const result = await denied.batch([denied.action("extensions", { action: "open", extensionId: "fixture" })]);
  assert(result.isError);
  assert.deepEqual(denied.effects, []);
  assert.equal(denied.prompts.length, 0);
});

test("React props and axe scans ask in ask mode and respect the blocklist, in batches too", async () => {
  for (const tool of ["react", "accessibility"]) {
    {
      const h = harness({ mode: "ask", answer: () => "denied" });
      const result = await h.batch([h.action(tool, { action: "tree", include_props: true })]);
      assert.equal(result.isError, true);
      assert.equal(h.prompts.length, 1);
      assert.deepEqual(h.effects, []);
    }
    const h = harness({ sites: { blocklist: ["ordinary.test"] } });
    assert.equal((await h.batch([h.action(tool)])).isError, true);
    assert.deepEqual(h.effects, []);
  }
});

test("permission module describes actions and scopes approvals without slicing main.js", async () => {
  const settings = normalizeConfig({ mode: "ask" });
  const access = new TabAccess();
  access.join(1, "s");
  const asked = [];
  const p = permissions({
    L: (en) => en,
    DialogOpen: class extends Error {},
    Stopped: class extends Error {},
    access,
    queryRef: async () => ({ value: 'button "Pay"' }),
    longRef: (x) => x,
    readConfig: () => settings,
    policy,
    rule: (key) => policy.ruleOf(key, settings.mode),
    hostOf: (b) => b.currentURI.host,
    assertSiteAccess() {},
    holdsButtons: () => false,
    askIsland: async (...args) => {
      asked.push(args[3]);
      return "done";
    },
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
  assert.equal((await p.callRule("navigate", { url: "back" }, browser)).rule, "ask");
  assert.equal((await p.callRule("read_page", {}, browser)).rule, "allow");
  assert.equal((await p.callRule("computer", { action: "type", text: "x" }, browser)).rule, "ask");
  const { context, asked: prompted } = await p.requirePermission({ check() {}, agent: { name: "Claude" } }, browser, [
    { tool: "computer", args: { action: "left_click", ref: "ref_1" } },
  ]);
  assert.equal(prompted, true);
  assert.equal(asked[0], 'Claude wants to: button "Pay": click');
  // why: Simulate both document and membership changes to verify neither can inherit a grant.
  assert(p.samePermissionContext(context, p.permissionContext(browser)));
  access.leave(1, "s");
  assert(!p.samePermissionContext(context, p.permissionContext(browser)));
});

test("an allowlist keeps agents on the listed sites", async () => {
  const h = harness({ sites: { mode: "allowlist", allowlist: ["ordinary.test"] } });
  const result = await h.batch([
    h.action("form_input", { value: "here" }),
    h.action("navigate", { url: "https://elsewhere.test/" }),
    h.action("form_input", { value: "there" }),
  ]);
  assert(result.isError);
  assert.match(result[0].text, /elsewhere\.test is not on the user's allowlist/);
  assert.deepEqual(h.effects, ["here"]);
  assert.equal(h.browser.currentURI.host, "ordinary.test");
});

test("autonomous permissions preserve deny rules and site restrictions", async () => {
  for (const mode of ["auto", "ask", "custom"]) {
    const custom = policy.parsePermissions(
      JSON.stringify({
        base: "ask",
        rules: { javascript_tool: "ask", submit: "deny", "clipboard.read": "allow" },
      }),
    );
    const h = harness({ mode, autonomous: true, custom });
    assert.equal(h.context.rule("javascript_tool"), "allow");
    assert.equal(h.context.rule("submit"), mode === "custom" ? "deny" : "allow");
    assert.throws(() => h.context.gate("clipboard.read"), /clipboard.read/);
    assert(!(await h.batch([h.action("javascript_tool", { text: "runs" })])).isError);
    h.context.query = async () => ({ value: { submit: true } });
    h.context.frameOf = () => null;
    const submit = await h.batch([h.action("computer", { action: "mouse_down", ref: "ref_1" })]);
    assert.equal(!!submit.isError, mode === "custom", submit[0]?.text);
    if (mode === "custom") assert.match(submit[0].text, /settings don't allow this \(submit\)/);
    assert.deepEqual(h.prompts, []);
    for (const tool of ["hand_to_user", "ask_user", "show_me"]) {
      let reply;
      h.context.tools[tool] ??= () => assert.fail("user-only tool must not run");
      h.context.reply = (_transport, _output, value) => (reply = value);
      await h.context.handle(JSON.stringify({ tool, args: { tabId: 999 }, session: "test-session" }));
      assert.deepEqual(reply, { ok: false, error: "no user is present (autonomous browser mode)" });
      const batch = await h.batch([h.action(tool)]);
      assert(batch.isError);
      assert.match(batch[0].text, /no user is present/);
    }
  }
  for (const sites of [{ blocklist: ["ordinary.test"] }, { mode: "allowlist", allowlist: ["other.test"] }]) {
    const h = harness({ mode: "ask", autonomous: true, sites });
    assert((await h.batch([h.action("javascript_tool")])).isError);
    assert.deepEqual(h.effects, []);
    assert.deepEqual(h.prompts, []);
  }
});

test("custom rules apply to browser_settings reads and tab_work", async () => {
  for (const rule of ["deny", "ask", "allow"]) {
    const custom = policy.parsePermissions(
      JSON.stringify({ base: "auto", rules: { "browser_settings.read": rule, tab_work: rule } }),
    );
    const h = harness({ mode: "custom", custom });
    h.context.tools.browser_settings = async () => {
      h.effects.push("settings");
      return [];
    };
    const request = async (tool, args) => {
      let reply;
      h.context.reply = (_transport, _output, value) => (reply = value);
      await h.context.handle(JSON.stringify({ tool, args, session: "test-session" }));
      return reply;
    };
    const settings = await request("browser_settings", { action: "get", tabId: 1 });
    const work = await request("tab_work", { action: "status", tabId: 1 });
    if (rule === "deny") {
      assert.match(settings.error, /settings don't allow this \(browser_settings.read\)/);
      assert.match(work.error, /settings don't allow this \(tab_work\)/);
      assert.deepEqual(h.effects, []);
    } else {
      assert.equal(settings.ok, true, settings.error);
      assert.equal(work.ok, true, work.error);
      assert.deepEqual(h.effects, ["settings"]);
    }
    assert.equal(h.prompts.length, rule === "ask" ? 2 : 0);
  }
});

test("browser-internal pages are closed to agents and local files need the user's approval", async () => {
  for (const url of ["about:config", "about:preferences", "chrome://browser/content/browser.xhtml", "javascript:1"]) {
    const h = harness();
    const result = await h.batch([h.action("navigate", { url })]);
    assert(result.isError, url);
    assert.match(result[0].text, /browser-internal pages/);
    assert.equal(h.browser.currentURI.host, "ordinary.test");
  }
  const h = harness({ answer: () => "cancelled" });
  const denied = await h.batch([h.action("navigate", { url: "file:///etc/passwd" })]);
  assert(denied.isError);
  assert.match(h.prompts[0].message, /go to "file:\/\/\/etc\/passwd"/);
  assert.equal(h.browser.currentURI.host, "ordinary.test");

  h.navigate("about:preferences", {});
  const read = await h.batch([h.action("read_page")]);
  assert.match(read[0].text, /browser-internal page/);
});

test("local files follow custom rules and are denied unattended unless allowed", () => {
  assert.equal(policy.operationOf("navigate", { url: "file:///home/u/notes.html" }), "navigate.local_file");
  assert.equal(policy.operationOf("navigate", { url: "https://example.test/" }), "navigate");
  assert.equal(policy.autonomousRule("navigate.local_file", "ask"), "deny");
  assert.equal(policy.autonomousRule("navigate.local_file", "allow"), "allow");
  assert.equal(policy.autonomousRule("navigate", "ask"), "allow");
});

test("a custom rule can stop agents from closing tabs", async () => {
  const custom = policy.parsePermissions(JSON.stringify({ base: "auto", rules: { tabs_close_mcp: "deny" } }));
  const h = harness({ mode: "custom", custom });
  h.context.tools.tabs_close_mcp = async () => (h.effects.push("closed"), []);
  const result = await h.batch([h.action("tabs_close_mcp")]);
  assert.match(result[0].text, /settings don't allow this \(tabs_close_mcp\)/);
  assert.deepEqual(h.effects, []);
});
