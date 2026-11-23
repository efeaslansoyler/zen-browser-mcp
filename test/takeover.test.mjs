import test from "node:test";
import assert from "node:assert/strict";
import { Inbox, inboxText } from "../browser/Inbox.sys.mjs";
import { Watches } from "../browser/Watches.sys.mjs";
import { bridgeContext } from "./support/bridge.mjs";

const ticks = async (n = 6) => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve));
};

// why: Fake tools wait on the call scope as the page tools do; everything else is the real dispatcher.
function harness({ now = 0 } = {}) {
  const started = [];
  const timers = [];
  const sent = [];
  const browsers = new Map(
    [1, 2].map((id) => [
      id,
      {
        browserId: id,
        currentURI: { spec: `https://site${id}.test/`, host: `site${id}.test` },
        contentTitle: `T${id}`,
      },
    ]),
  );
  const tabsById = new Map(
    [...browsers].map(([id, linkedBrowser]) => [
      id,
      { linkedBrowser, isConnected: true, getAttribute: () => "true", setAttribute() {}, hasAttribute: () => true },
    ]),
  );
  const running = new Map();
  const run = (tool) => (args, call) => {
    started.push(args.name ?? tool);
    if (!args.name) return Promise.resolve([{ type: "text", text: tool }]);
    return call.race(
      new Promise((resolve) => running.set(args.name, () => resolve([{ type: "text", text: args.name }]))),
    );
  };
  const released = [];
  const ended = [];
  const ctx = bridgeContext({
    now: () => now,
    logActivity() {},
    describeWrite() {},
    describeAction: () => "",
    requirePermission: async () => ({ approved: new Map(), context: {} }),
    requireToolPermission() {},
    permissionContext: () => ({}),
    samePermissionContext: () => true,
    assertSiteAccess() {},
    watchTabOpens() {},
    openedTabs: () => [],
    hostOf: (browser) => browser.currentURI.host,
    siteAllowed: () => true,
    paintTab() {},
    restoreMarks() {},
    findTab: (id) => tabsById.get(id) ?? null,
    browserFor: (call, id) => {
      ctx.access.check(id, call.session);
      call.tabs.add(id);
      return browsers.get(id);
    },
    releaseInputs: (browser) => released.push(browser.browserId ?? browser),
    video: { endTab: (id, reason) => ended.push([id, reason]), dropTab() {} },
    setTimeout: (fn, ms) => {
      const timer = { fn, at: now + ms };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => timers.splice(timers.indexOf(timer) >>> 0, 1),
    text: (value) => [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
    tools: {
      computer: run("computer"),
      read_page: run("read_page"),
      javascript_tool: run("javascript_tool"),
      navigate: run("navigate"),
      handle_dialog: run("handle_dialog"),
      tabs_close_mcp: run("tabs_close_mcp"),
      downloads: run("downloads"),
    },
  });
  ctx.inboxText = inboxText;
  const pushable = new Set();
  ctx.inbox = new Inbox({
    endpoint: (session) => (pushable.has(session) ? { id: session } : null),
    deliver: async (sub, event) => !!sent.push({ session: sub.id, ...event }),
    known: () => true,
    expired() {},
    now: () => 0,
  });
  for (const [tabId, sessions] of [
    [1, ["A", "B"]],
    [2, ["A"]],
  ])
    for (const session of sessions) {
      ctx.sessionInfo(session, ctx.agentTheme({ id: "claude" }));
      ctx.access.join(tabId, session);
      ctx.state.tabs.add(tabId);
    }
  // why: Each request gets its own reply through the transport it was sent on.
  const ask = async (session, tool, args = {}) => {
    const transport = {};
    await ctx.handle(JSON.stringify({ session, agent: { id: "claude" }, tool, args }), transport, {});
    const { message } = transport;
    return { ...message, text: message.error ?? message.content.map((c) => c.text).join("\n") };
  };
  ctx.reply = (transport, _output, message) => (transport.message = message);
  return {
    ctx,
    ask,
    started,
    sent,
    pushable,
    released,
    ended,
    browser: (id) => browsers.get(id),
    finish: async (name) => {
      running.get(name)();
      await ticks();
    },
    async pass(ms) {
      now += ms;
      for (const timer of timers.filter((t) => t.at <= now)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.fn();
      }
      await ticks();
    },
  };
}

test("taking over interrupts the calls in that tab only and releases held input", async () => {
  const h = harness();
  const here = h.ask("A", "computer", { tabId: 1, action: "type", name: "typing" });
  const there = h.ask("A", "computer", { tabId: 2, action: "type", name: "elsewhere" });
  await ticks();
  assert.equal(h.ctx.takeOver(h.browser(1)), true);
  const result = await here;
  assert.equal(result.ok, false);
  assert.match(result.text, /user took over tab 1.*may have partly happened/s);
  assert(h.released.includes(1));
  assert.deepEqual(h.ended, [[1, "the user took over"]]);
  await h.finish("elsewhere");
  assert.equal((await there).text, "elsewhere");
});

test("a batch returns its finished steps and never continues", async () => {
  const h = harness();
  const batch = h.ask("A", "browser_batch", {
    actions: [
      { name: "read_page", input: { tabId: 1 } },
      { name: "computer", input: { tabId: 1, action: "type", name: "typing" } },
      { name: "computer", input: { tabId: 1, action: "key" } },
    ],
  });
  await ticks();
  h.ctx.takeOver(h.browser(1));
  const { text, isError } = await batch;
  assert.equal(isError, true);
  assert.match(text, /\[1\] read_page: read_page\n\[2\] computer: ERROR: .*took over.*remaining 1 step/s);
  h.ctx.giveBack(h.browser(1));
  await ticks();
  assert.deepEqual(h.started, ["read_page", "typing"]);
});

test("a batch that reaches a tab taken over meanwhile stops there", async () => {
  const h = harness();
  const batch = h.ask("A", "browser_batch", {
    actions: [
      { name: "computer", input: { tabId: 2, action: "type", name: "first" } },
      { name: "read_page", input: { tabId: 1 } },
    ],
  });
  await ticks();
  h.ctx.takeOver(h.browser(1));
  await h.finish("first");
  assert.match((await batch).text, /\[1\] computer: first\n\[2\] read_page: ERROR: .*control of tab 1/s);
  assert.deepEqual(h.started, ["first"]);
});

test("calls wait for the tab and go on in order once it is given back", async () => {
  const h = harness();
  h.ctx.takeOver(h.browser(1));
  const waiting = [
    h.ask("A", "read_page", { tabId: 1, name: "a" }),
    h.ask("B", "read_page", { tabId: 1, name: "b" }),
    h.ask("A", "read_page", { tabId: 1, name: "c" }),
  ];
  const elsewhere = await h.ask("A", "read_page", { tabId: 2 });
  assert.equal(elsewhere.text, "read_page");
  await ticks();
  assert.deepEqual(h.started, ["read_page"]);
  h.ctx.giveBack(h.browser(1), "Use the second address");
  await ticks();
  for (const name of ["a", "b", "c"]) {
    assert.equal(h.started.at(-1), name);
    await h.finish(name);
  }
  const results = await Promise.all(waiting);
  const notes = results.map((r) => /Use the second address/.test(r.text));
  assert.deepEqual(notes, [true, true, false], "one note per session");
  assert.match(results[0].text, /"userMessage":"Use the second address"/);
  assert.deepEqual(h.sent, []);
});

test("a call queued behind an interrupted one waits too", async () => {
  const h = harness();
  const first = h.ask("A", "computer", { tabId: 1, action: "type", name: "typing" });
  const second = h.ask("B", "read_page", { tabId: 1 });
  await ticks();
  h.ctx.takeOver(h.browser(1));
  await first;
  await ticks();
  assert.deepEqual(h.started, ["typing"]);
  h.ctx.giveBack(h.browser(1));
  assert.match((await second).text, /^read_page/);
});

test("after 45 seconds a waiting call returns a status, and giving back wakes its session", async () => {
  const h = harness();
  h.pushable.add("A");
  h.ctx.takeOver(h.browser(1));
  const waiting = h.ask("A", "read_page", { tabId: 1 });
  await ticks();
  await h.pass(44_000);
  await h.pass(1_000);
  const result = await waiting;
  assert.equal(result.isError, true);
  assert.equal(JSON.parse(result.text).status, "user_control");
  assert.deepEqual(h.started, []);
  h.ctx.giveBack(h.browser(1));
  await ticks();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].session, "A");
  assert.match(h.sent[0].content, /gave tab 1 back/);
});

test("a note reaches members that weren't waiting, without a push path with their next call", async () => {
  const h = harness();
  h.pushable.add("A");
  h.ctx.takeOver(h.browser(1));
  h.ctx.giveBack(h.browser(1), "Don't pay");
  await ticks();
  assert.deepEqual(
    h.sent.map((event) => [event.session, event.note]),
    [["A", "Don't pay"]],
  );
  assert.match((await h.ask("B", "read_page", { tabId: 1 })).text, /Don't pay/);
  assert.doesNotMatch((await h.ask("B", "read_page", { tabId: 1 })).text, /Don't pay/);
});

test("giving back without a note tells nobody who didn't notice", async () => {
  const h = harness();
  h.pushable.add("A");
  h.ctx.takeOver(h.browser(1));
  h.ctx.giveBack(h.browser(1));
  await ticks();
  assert.deepEqual(h.sent, []);
  assert.equal((await h.ask("B", "read_page", { tabId: 1 })).text, "read_page");
});

test("acting needs a read after the tab was given back, per session", async () => {
  const h = harness();
  h.ctx.takeOver(h.browser(1));
  h.ctx.giveBack(h.browser(1));
  for (const [tool, args] of [
    ["computer", { action: "left_click" }],
    ["javascript_tool", {}],
  ])
    assert.match((await h.ask("A", tool, { tabId: 1, ...args })).text, /read it again/i, tool);
  assert.equal((await h.ask("A", "handle_dialog", { tabId: 1 })).text, "handle_dialog");
  const batch = await h.ask("A", "browser_batch", {
    actions: [
      { name: "read_page", input: { tabId: 1 } },
      { name: "computer", input: { tabId: 1, action: "left_click" } },
    ],
  });
  assert.match(batch.text, /\[1\] read_page: read_page\n\[2\] computer: ERROR: .*read it again/is);
  assert.equal((await h.ask("A", "computer", { tabId: 1, action: "left_click" })).text, "computer");
  assert.match((await h.ask("B", "computer", { tabId: 1, action: "left_click" })).text, /read it again/i);
  assert.equal((await h.ask("B", "navigate", { tabId: 1, url: "reload" })).ok, true);
  assert.equal((await h.ask("B", "computer", { tabId: 1, action: "left_click" })).text, "computer");
});

test("a refused click still carries the note", async () => {
  const h = harness();
  h.ctx.takeOver(h.browser(1));
  const click = h.ask("A", "computer", { tabId: 1, action: "left_click" });
  await ticks();
  h.ctx.giveBack(h.browser(1), "Careful");
  assert.match((await click).text, /read it again.*Careful/is);
});

test("the tab can't be closed and its address stays hidden; notes and downloads still work", async () => {
  const h = harness();
  h.ctx.takeOver(h.browser(1));
  const close = h.ask("A", "tabs_close_mcp", { tabId: 1 });
  await ticks();
  assert.deepEqual(h.started, []);
  const listed = h.ctx.describeTab(h.ctx.findTab(1), "A");
  assert.equal(listed.userControl, true);
  assert.equal(listed.url, undefined);
  assert.equal(listed.title, undefined);
  assert.match((await h.ask("A", "tab_work", { action: "status", tabId: 1 })).text, /"userControl":true/);
  assert.equal((await h.ask("A", "downloads", { tabId: 1 })).text, "downloads");
  h.ctx.giveBack(h.browser(1));
  await close;
  assert.equal(h.ctx.describeTab(h.ctx.findTab(1), "A").url, "https://site1.test/");
});

test("taking the tab back ends the takeover for waiting calls", async () => {
  const h = harness();
  h.ctx.takeOver(h.browser(1));
  const waiting = h.ask("A", "read_page", { tabId: 1 });
  await ticks();
  h.ctx.access.clear(1);
  assert.match((await waiting).text, /access to tab 1 changed/);
  assert.equal(h.ctx.takenOver(1), false);
  assert.deepEqual(h.started, []);
});

test("it ends with the last member, not with another one", async () => {
  const h = harness();
  h.ctx.takeOver(h.browser(1));
  h.ctx.access.leave(1, "A");
  assert.equal(h.ctx.takenOver(1), true);
  h.ctx.access.leave(1, "B");
  assert.equal(h.ctx.takenOver(1), false);
});

test("Stop ends the wait but not the takeover; the stopped or autonomous browser starts none", async () => {
  const h = harness();
  h.ctx.takeOver(h.browser(1));
  const waiting = h.ask("A", "read_page", { tabId: 1 });
  await ticks();
  h.ctx.state.paused = true;
  h.ctx.cancelCalls();
  assert.match((await waiting).text, /stopped browser automation/);
  assert.equal(h.ctx.takenOver(1), true);
  assert.equal(h.ctx.takeOver(h.browser(2)), false);
  h.ctx.state.paused = false;
  h.ctx.autonomous = true;
  assert.equal(h.ctx.takeOver(h.browser(2)), false);
});

test("a hold doesn't prevent it, and its state survives a reload", async () => {
  const h = harness();
  h.ctx.access.hold(1, "B", { reason: "migrating" });
  assert.equal(h.ctx.takeOver(h.browser(1)), true);
  const { takeover } = await import("../browser/Takeover.sys.mjs");
  const reloaded = takeover({ ...h.ctx, state: h.ctx.state });
  assert.equal(reloaded.takenOver(1), true);
});

test("a watch reads nothing while the user has the tab", async () => {
  let reads = 0;
  let paused = true;
  const timers = [];
  const watches = new Watches({
    events: { path: () => "file", append() {} },
    owned: () => ({ currentURI: { spec: "https://a.test/" } }),
    paused: () => paused,
    assertSite() {},
    check: async () => !!++reads && false,
    setTimeout: (fn) => timers.push(fn),
    clearTimeout() {},
  });
  watches.start("A", 1, {}, { text: "x" });
  for (let i = 0; i < 3; i++) {
    timers.shift()();
    await ticks();
  }
  assert.equal(reads, 0);
  paused = false;
  timers.shift()();
  await ticks();
  assert.equal(reads, 1);
});
