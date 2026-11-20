import assert from "node:assert/strict";
import test from "node:test";
import { agentDataTools, assertAgentDataMode, validateCookie, validateStorage } from "../browser/AgentData.sys.mjs";
import { inputTools } from "../browser/InputTools.sys.mjs";
import { NetworkControl, networkControlTool, networkRule } from "../browser/NetworkControl.sys.mjs";
import { FPS, MAX_BYTES, TabVideo, recordTool } from "../browser/TabVideo.sys.mjs";
import { ruleOf, operationOf } from "../browser/Policy.sys.mjs";

test("reload waits for the current document, uses optional cache bypass and can read it", async (t) => {
  globalThis.Ci = { nsIWebNavigation: { LOAD_FLAGS_BYPASS_CACHE: 256 } };
  t.after(() => delete globalThis.Ci);
  const events = [];
  const tab = { getAttribute: () => "true" };
  const browser = {
    reload: () => events.push("reload"),
    reloadWithFlags: (flags) => events.push(flags),
    ownerDocument: { defaultView: { gBrowser: { getTabForBrowser: () => tab } } },
  };
  const context = {
    browserFor: () => browser,
    releaseInputs() {},
    hostOf: () => "fixture.test",
    waitForLoad: (_, __, destination) => events.push(["wait", destination]),
    guard: async () => events.push("loaded"),
    assertSiteAccess() {},
    describeTab: () => "tab",
    text: (value) => [value],
    runTool: async (_, name, args) => [name, args.filter],
  };
  const { navigate } = inputTools(context);
  await assert.rejects(navigate({ url: "https://fixture.test", bypass_cache: true }, {}), /reload only/);
  await assert.rejects(navigate({ url: "reload", bypass_cache: "false" }, {}), /boolean/);
  assert.deepEqual(await navigate({ url: "reload", tabId: 1, read: "interactive" }, {}), [
    "tab",
    "read_page",
    "interactive",
  ]);
  await navigate({ url: "reload", tabId: 1, bypass_cache: true }, {});
  assert.deepEqual(events, [["wait", null], "reload", "loaded", ["wait", null], 256, "loaded"]);
});

test("cookie and storage operations fail early in together and validate batch arguments", () => {
  const tools = agentDataTools({ browserMode: "together" });
  assert.throws(() => tools.cookies({ action: "set", tabId: 1 }, {}), /agent browser mode/);
  for (const mode of ["agent", "scratch", "autonomous", "autonomous-agent"]) {
    assert.doesNotThrow(() => assertAgentDataMode(mode, "cookies"));
    assert.doesNotThrow(() => assertAgentDataMode(mode, "storage"));
  }
  assert.doesNotThrow(() => validateCookie({ action: "set", name: "a", value: "", expires: 12345 }));
  assert.throws(() => validateCookie({ action: "set", name: "name;other", value: "x" }), /cookie name/);
  assert.throws(() => validateCookie({ action: "set", name: "name", value: "a;b" }), /cookie value/);
  assert.throws(() => validateCookie({ action: "delete", name: "name", path: "relative" }), /Cookie path/);
  assert.throws(() => validateCookie({ action: "set", name: "a", value: "b", expires: 1.5 }), /expires/);
  assert.throws(() => validateStorage({ action: "get", area: "indexeddb", key: "a" }), /Storage area/);
  assert.throws(() => validateStorage({ action: "set", area: "local", key: "a" }), /storage value/);
  assert.doesNotThrow(() => validateStorage({ action: "set", area: "session", key: "", value: "" }));
});

test("storage rejects together and explicit cookie URLs are checked against site rules", async (t) => {
  await assert.rejects(agentDataTools({ browserMode: "together" }).storage({}, {}), /agent browser mode/);
  const uri = { host: "blocked.example", schemeIs: (scheme) => scheme === "https", spec: "https://blocked.example" };
  globalThis.Services = { io: { newURI: () => uri } };
  t.after(() => delete globalThis.Services);
  const { cookies } = agentDataTools({
    browserMode: "agent",
    browserFor: () => ({}),
    assertSiteURL: (url) => {
      assert.equal(url, uri.spec);
      throw new Error("blocked fixture");
    },
  });
  assert.throws(() => cookies({ action: "list", tabId: 1, url: uri.spec }, {}), /blocked fixture/);
});

test("new tools map to the expected permission rules", () => {
  const expect = (tool, action, ask, auto) => {
    const key = operationOf(tool, { action });
    assert.equal(ruleOf(key, "ask"), ask);
    assert.equal(ruleOf(key, "auto"), auto);
  };
  expect("navigate", undefined, "ask", "allow");
  expect("save_pdf", undefined, "allow", "allow");
  for (const [tool, action] of [
    ["record", "start"],
    ["record", "stop"],
    ["cookies", "list"],
    ["storage", "get"],
  ])
    expect(tool, action, "allow", "allow");
  for (const [tool, action] of [
    ["cookies", "set"],
    ["cookies", "delete"],
    ["storage", "set"],
    ["storage", "remove"],
    ["storage", "clear"],
  ])
    expect(tool, action, "ask", "allow");
  for (const action of ["block", "mock", "offline", "clear"]) expect("network_control", action, "ask", "ask");
});

test("network rules match in their tab and origin, with deterministic priority and cleanup", () => {
  const control = new NetworkControl();
  const origin = "https://fixture.test";
  const other = "https://other.test";
  const match = (tab, url, destination = origin, current = origin, top = false) =>
    control.match(tab, url, destination, current, top);
  control.update(1, "one", origin, { action: "block", urlPattern: "/api/" });
  control.update(1, "one", origin, { action: "mock", urlPattern: "/api/one", body: "fixture" });
  assert.equal(match(1, origin + "/api/one").action, "mock");
  assert.equal(match(1, other + "/api/two", other).action, "block");
  assert.equal(match(2, origin + "/api/one"), null);
  assert.throws(() => control.update(1, "two", origin, { action: "offline" }), /other session/);
  control.update(1, "one", origin, { action: "offline" });
  assert.equal(match(1, origin + "/api/one").action, "offline");
  assert.equal(match(1, other + "/", other, origin, true), null);
  assert(!control.has(1));

  control.update(1, "one", origin, { action: "offline" });
  control.update(2, "two", origin, { action: "offline" });
  control.dropTab(1, "two");
  assert(control.has(1));
  control.dropSession("one");
  assert(!control.has(1));
  assert(control.has(2));
  control.dropTab(2);
  assert(!control.has(2));
  control.update(3, "one", origin, { action: "offline" });
  control.update(3, "one", origin, { action: "clear" });
  assert(!control.has(3));
});

test("network validates bounds and refuses a tab handed over by the user", () => {
  assert.throws(() => networkRule({ action: "block", urlPattern: "" }), /urlPattern/);
  assert.throws(() => networkRule({ action: "mock", urlPattern: "x", body: "x", status: 302 }), /status/);
  assert.throws(() => networkRule({ action: "mock", urlPattern: "x", body: "x", status: 204 }), /empty body/);
  assert.throws(() => networkRule({ action: "mock", urlPattern: "x", body: "x", content_type: "HTML" }), /MIME/);
  assert.throws(() => networkRule({ action: "mock", urlPattern: "x", body: "a".repeat(65537) }), /65536/);
  assert.throws(() => networkRule({ action: "mock", urlPattern: "x", body: "", headers: { Location: "x" } }), /X-\*/);
  const tool = networkControlTool({ browserFor: () => ({}), findTab: () => ({ getAttribute: () => "user" }) });
  assert.throws(() => tool({ action: "offline", tabId: 1 }, {}), /agent-opened tab/);
});

function videoFixture({ size = 3, encoder = async () => "/ffmpeg" } = {}) {
  const timers = new Map();
  const encodes = [];
  let now = 0;
  let wakes = 0;
  const video = new TabVideo({
    now: () => now,
    setTimeout(fn, delay) {
      const key = Symbol();
      timers.set(key, { fn, time: now + delay });
      return key;
    },
    clearTimeout: (key) => timers.delete(key),
    wake() {
      wakes++;
      return () => wakes--;
    },
    encoder,
    path: async () => "/video.webm",
    frame: async () => new ArrayBuffer(size),
    check() {},
    async encode(path, output, frames) {
      encodes.push([path, output, frames.length]);
      return 789;
    },
  });
  async function tick(ms) {
    const end = now + ms;
    for (;;) {
      const next = [...timers].sort(([, a], [, b]) => a.time - b.time)[0];
      if (!next || next[1].time > end) break;
      const [key, { fn, time }] = next;
      now = time;
      timers.delete(key);
      await fn();
    }
    now = end;
  }
  return { video, encodes, tick, wakes: () => wakes };
}

test("video validates arguments and stops at a bounded frame rate and duration", async () => {
  const { video, encodes, tick, wakes } = videoFixture();
  const browser = { browserId: 1 };
  await assert.rejects(video.start(browser, "s", 31), /1–30 seconds/);
  const tool = recordTool({ browserFor: () => browser, video });
  await assert.rejects(tool({ action: "stop", duration: 1 }, {}), /optional duration/);
  assert.deepEqual(await video.start(browser, "s", 1), { path: "/video.webm", fps: FPS, maxDuration: 1 });
  await assert.rejects(video.stop(1, "other"), /no recording/);
  await tick(1000);
  assert.equal(wakes(), 0);
  assert.deepEqual(await video.stop(1, "s"), {
    path: "/video.webm",
    bytes: 789,
    frames: 4,
    fps: 4,
    durationMs: 1000,
    captureMs: 0,
    reason: "duration limit",
  });
  assert.deepEqual(encodes, [["/ffmpeg", "/video.webm", 4]]);
});

test("video enforces a memory cap, ends on release and handles a missing encoder", async () => {
  const { video, tick, wakes, encodes } = videoFixture({ size: MAX_BYTES });
  await video.start({ browserId: 1 }, "session");
  await tick(250);
  assert.equal((await video.stop(1, "session")).reason, "size limit");
  assert.equal(encodes[0][2], 1);
  await video.start({ browserId: 2 }, "session");
  video.dropSession("session");
  assert.equal(wakes(), 0);
  await assert.rejects(video.stop(2, "session"), /no recording/);
  assert.equal(encodes.length, 2);

  const missing = videoFixture({
    encoder: async () => {
      throw new Error("requires ffmpeg");
    },
  });
  await assert.rejects(missing.video.start({ browserId: 1 }, "s"), /requires ffmpeg/);
  assert.equal(missing.wakes(), 0);
});

test("PDF uses the tab's silent print-to-file settings and returns the private artifact", async (t) => {
  const { pagePDF } = await import("../browser/Artifacts.sys.mjs");
  const settings = {};
  globalThis.Ci = {
    nsIPrintSettingsService: {},
    nsIPrintSettings: { kOutputFormatPDF: 2, kOutputDestinationFile: 1 },
  };
  globalThis.Cc = {
    "@mozilla.org/gfx/printsettings-service;1": {
      getService: () => ({ createNewPrintSettings: () => settings }),
    },
  };
  t.after(() => {
    delete globalThis.Ci;
    delete globalThis.Cc;
  });
  const path = "/runtime/page.pdf";
  const bc = {
    currentWindowGlobal: {},
    async print(actual) {
      assert.equal(actual.toFileName, path);
      assert.equal(actual.printSilent, true);
      assert.equal(actual.outputFormat, 2);
      assert.equal(actual.outputDestination, 1);
      assert.equal(actual.headerStrLeft, "");
    },
  };
  const removed = [];
  const pdf = pagePDF({
    browserFor: (_, tabId) => {
      assert.equal(tabId, 42);
      return { browsingContext: bc };
    },
    artifacts: {
      path: async () => path,
      save: async () => 800,
      remove: async (path) => removed.push(path),
    },
    text: (value) => value,
    setTimeout,
    clearTimeout,
    guard: (promise) => promise,
    assertSiteAccess() {},
  });
  assert.deepEqual(await pdf({ tabId: 42 }, { check() {} }), { path, bytes: 800 });
  bc.print = async () => {
    throw new Error("print failure");
  };
  await assert.rejects(pdf({ tabId: 42 }, { check() {} }), /print failure/);
  assert.deepEqual(removed, [path]);
});

test("cookie expiry uses the Gecko platform units and returns Unix seconds in either version", (t) => {
  const expires = 1795179623;
  const uri = {
    schemeIs: (scheme) => scheme === "https",
    host: "fixture.test",
    asciiHost: "fixture.test",
    spec: "https://fixture.test/",
  };
  const browser = {
    currentURI: uri,
    browsingContext: { currentWindowGlobal: { documentPrincipal: { isContentPrincipal: true, originAttributes: {} } } },
  };
  const tools = agentDataTools({ browserMode: "agent", browserFor: () => browser, assertSiteURL() {} });
  const appinfo = {};
  let stored;
  globalThis.Services = {
    appinfo,
    cookies: {
      add(host, path, name, value, isSecure, isHttpOnly, isSession, expiry) {
        stored = { host, rawHost: host, path, name, value, isSecure, isHttpOnly, isSession, expiry };
      },
      getCookiesFromHost: () => [stored],
    },
  };
  globalThis.Ci = { nsICookie: { SAMESITE_LAX: 1, SCHEME_HTTPS: 2 } };
  t.after(() => {
    delete globalThis.Services;
    delete globalThis.Ci;
  });
  for (const [version, scale] of [
    ["140.8.0", 1],
    ["160.0.1", 1000],
  ]) {
    appinfo.platformVersion = version;
    tools.cookies({ action: "set", name: "fixture", value: "test", expires }, {});
    assert.equal(stored.expiry, expires * scale);
    assert.equal(JSON.parse(tools.cookies({ action: "list" }, {})[0].text).cookies[0].expires, expires);
  }
});
