import test from "node:test";
import assert from "node:assert/strict";
import { TabAccess } from "../browser/TabAccess.sys.mjs";
import { TabActivity } from "../browser/TabActivity.sys.mjs";
import { agentTheme } from "../browser/Agent.sys.mjs";
import { TabMenu } from "../browser/TabMenu.sys.mjs";
import { Channels } from "../browser/Channels.sys.mjs";
import { Picks } from "../browser/Picks.sys.mjs";
import { bridgeContext } from "./support/bridge.mjs";
const timers = { setTimeout, clearTimeout };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const askMode = () => ({ mode: "ask", sites: { mode: "blocklist", blocklist: [], allowlist: [] } });

test("members are session IDs; the same agent type grants no access", () => {
  const access = new TabAccess();
  access.join(1, "codex-A");
  access.check(1, "codex-A");
  assert.throws(() => access.check(1, "codex-B"), /Join it with request_tab/);
  assert.throws(() => access.check(1, null), /Join it with request_tab/);
  assert.throws(() => access.check(2, "codex-A"), /not an agent tab/);
  assert.throws(() => access.join(2, ""), /session ID/);
});

test("a session that leaves and comes back can't run requests queued before it left", () => {
  const access = new TabAccess();
  access.join(1, "A");
  const ticket = access.ticket([1, 1], "A");
  access.join(1, "B"); // someone else joining changes nothing for A
  access.checkTicket(ticket, "A");
  access.leave(1, "A");
  access.join(1, "A");
  assert.throws(() => access.checkTicket(ticket, "A"), /changed after this request was queued/);
  access.checkTicket(access.ticket([1], "A"), "A");
});

test("the last member leaving gives the tab back; notes and versions follow membership", () => {
  const access = new TabAccess();
  access.join(1, "A");
  access.join(1, "B");
  access.report(1, "A", "start", "Filling the form");
  const version = access.version(1);
  assert.equal(access.leave(1, "A"), 1);
  assert.equal(access.task(1, "A"), null);
  assert.notEqual(access.version(1), version);
  assert.equal(access.leave(1, "B"), 0);
  assert.equal(access.shared(1), false);
  assert.throws(() => access.report(1, "B", "start", "x"), /not an agent tab/);
});

test("access and notes survive a bridge module reconstruction", () => {
  const maps = [new Map(), new Map(), new Map(), { next: 1 }];
  const before = new TabAccess(...maps);
  before.join(1, "A");
  before.report(1, "A", "start", "Waiting for validation");
  const after = new TabAccess(...maps);
  assert.equal(after.task(1, "A").summary, "Waiting for validation");
  assert(after.has(1, "A"));
  after.join(1, "B");
  assert.notEqual(after.membersByTab.get(1).get("B"), after.membersByTab.get(1).get("A"));
});

function harness() {
  const tabs = new Map(),
    effects = [],
    chromeTimers = new Map();
  const store = new Map();
  let next = 1,
    timerId = 0,
    started;
  const first = new Promise((resolve) => {
    started = resolve;
  });
  const context = bridgeContext({
    assertSiteAccess() {},
    siteEntry: () => null,
    findTab: (id) => tabs.get(id),
    browserWindows: () => [{ gBrowser: { tabs: [...tabs.values()] } }],
    windowTabs: (win) => win.gBrowser.tabs,
    restoreMarks() {},
    SessionStore: {
      setCustomTabValue(tab, key, value) {
        store.set(`${tab.linkedBrowser.browserId}:${key}`, value);
      },
      getCustomTabValue(tab, key) {
        return store.get(`${tab.linkedBrowser.browserId}:${key}`) || "";
      },
      deleteCustomTabValue(tab, key) {
        store.delete(`${tab.linkedBrowser.browserId}:${key}`);
      },
    },
    applyTheme(tab, theme) {
      tab.setAttribute("data-zen-agent", theme.id);
      return theme;
    },
    readConfig: () => ({ mode: "auto", sites: { mode: "blocklist", blocklist: [], allowlist: [] } }),
    cancelAsk() {},
    describeWrite: async () => undefined,
    requirePermission: async () => ({ context: {}, asked: false }),
    permissionContext: () => ({}),
    samePermissionContext: () => true,
    hostOf: () => "fixture.test",
    describeAction: () => "",
    logActivity() {},
    shortRefs: (x) => x,
    setTimeout(fn) {
      chromeTimers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout(id) {
      chromeTimers.delete(id);
    },
    text: (value) => [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
    reply(_, output, result) {
      output.result = result;
    },
    tools: {
      read: async (args, call) => {
        context.browserFor(call, args.tabId);
        effects.push("read");
        return [];
      },
      write: async (args, call) => {
        context.browserFor(call, args.tabId);
        effects.push("write");
        return [];
      },
      wait: async (args, call) => {
        context.browserFor(call, args.tabId);
        started();
        await call.wait(30000, timers);
        return [];
      },
    },
  });
  function addTab() {
    const id = next++;
    const attrs = new Map();
    const tab = {
      isConnected: true,
      linkedPanel: true,
      label: `tab-${id}`,
      linkedBrowser: { browserId: id, currentURI: { spec: "https://fixture.test/" } },
      style: { removeProperty() {}, setProperty() {} },
      getAttribute: (key) => attrs.get(key) || "",
      setAttribute: (key, value) => attrs.set(key, value),
      hasAttribute: (key) => attrs.has(key),
      removeAttribute: (key) => attrs.delete(key),
      ownerDocument: {
        defaultView: {
          gBrowser: {
            removeTab() {
              tabs.delete(id);
              tab.isConnected = false;
            },
          },
        },
      },
    };
    tabs.set(id, tab);
    return tab;
  }
  context.createTab = (session) => {
    const tab = addTab();
    context.mark(tab, "true", session);
    return tab;
  };
  const request = async (session, tool, args = {}, agent = "codex") => {
    const output = {};
    await context.handle(JSON.stringify({ session, agent: { id: agent }, tool, args }), null, output);
    return output.result;
  };
  const register = (id) => context.sessionInfo(id, agentTheme({ id: "codex" }));
  const own = (id = "A") => {
    register(id);
    const tab = addTab();
    context.mark(tab, "true", id);
    return tab.linkedBrowser.browserId;
  };
  return { context, tabs, effects, chromeTimers, first, request, register, own };
}

const text = (result) => {
  assert.equal(result.ok, true, result.error);
  return result.content[0].text;
};

const parsed = (result) => {
  assert.equal(result.ok, true, result.error);
  return JSON.parse(result.content[0].text);
};

test("real dispatcher keeps non-members out of reads, writes and closes", async () => {
  const h = harness();
  const a = h.own("A"),
    b = h.own("B");
  const listed = parsed(await h.request("A", "tabs_context_mcp"));
  assert.deepEqual(
    listed.tabs.map((tab) => tab.tabId),
    [a],
  );
  assert.deepEqual(
    listed.agentTabs.map((tab) => tab.tabId),
    [b],
  );
  assert.deepEqual(listed.userTabs, []);
  for (const tool of ["read", "write", "tabs_close_mcp"]) {
    const result = await h.request("A", tool, { tabId: b });
    assert.equal(result.ok, false);
    assert.match(result.error, /used by other sessions/);
  }
  assert.deepEqual(h.effects, []);
  assert(h.tabs.has(b));
  assert.equal((await h.request("A", "read", { tabId: a })).ok, true);
});

test("in automatic mode a session joins another agent's tab and both work in it", async () => {
  const h = harness();
  const tabId = h.own("A");
  h.register("B");
  let asked = 0;
  h.context.askIsland = async () => {
    asked++;
    return "done";
  };
  parsed(await h.request("A", "tab_work", { action: "start", tabId, summary: "Editing the form" }));
  const joined = parsed(await h.request("B", "request_tab", { tabId, reason: "Check the prices" }));
  assert.equal(asked, 0);
  assert.match(joined.note, /joined/);
  assert.deepEqual(
    joined.members.map((m) => m.session),
    ["A", "B"],
  );
  assert.equal((await h.request("A", "write", { tabId })).ok, true);
  assert.equal((await h.request("B", "write", { tabId })).ok, true);
  const forB = parsed(await h.request("B", "tabs_context_mcp"));
  assert.deepEqual(
    forB.tabs[0].sharedWith.map((m) => [m.session, m.task.summary]),
    [["A", "Editing the form"]],
  );
  assert.equal(forB.agentTabs, undefined);
});

test("in ask mode joining an agent tab asks the user; a denial keeps the session out", async () => {
  const h = harness();
  const tabId = h.own("A");
  h.register("B");
  h.context.readConfig = askMode;
  const prompts = [];
  h.context.askIsland = async (_call, _browser, _title, message) => {
    prompts.push(message);
    return "cancelled";
  };
  assert.match(text(await h.request("B", "request_tab", { tabId, reason: "Review" })), /declined/);
  assert.match(prompts[0], /wants to join the agents in this tab: Review/);
  assert.equal(h.context.access.has(tabId, "B"), false);
  h.context.askIsland = async () => "done";
  parsed(await h.request("B", "request_tab", { tabId, reason: "Review" }));
  assert.deepEqual(h.context.access.members(tabId), ["A", "B"]);
});

test("the user's own tabs always ask, even in automatic mode", async () => {
  const h = harness();
  const id = h.own("A");
  h.context.unmark(h.tabs.get(id));
  h.register("B");
  const list = parsed(await h.request("B", "tabs_context_mcp"));
  assert.equal(list.userTabs[0].tabId, id);
  assert.equal((await h.request("B", "read", { tabId: id })).ok, false);
  h.context.askIsland = async () => "cancelled";
  await h.request("B", "request_tab", { tabId: id, reason: "Look at YouTube" });
  assert.equal(h.context.access.shared(id), false);
  h.context.askIsland = async () => "done";
  parsed(await h.request("B", "request_tab", { tabId: id, reason: "Look at YouTube" }));
  assert.deepEqual(h.context.access.members(id), ["B"]);
  assert.equal(h.tabs.get(id).getAttribute("zen-mcp"), "user");
});

test("approval can't grant a tab whose access changed during the prompt", async () => {
  for (const change of ["take back", "leave"]) {
    const h = harness(),
      tabId = h.own("A");
    h.context.readConfig = askMode;
    h.context.askIsland = async () => {
      if (change === "take back") h.context.unmark(h.tabs.get(tabId));
      else h.context.leaveTab(h.tabs.get(tabId), "A");
      return "done";
    };
    const result = await h.request("B", "request_tab", { tabId, reason: "Review" });
    assert.equal(result.ok, false);
    assert.match(result.error, /changed while permission was pending/);
    assert.equal(h.context.access.has(tabId, "B"), false);
  }
});

test("taking a tab back cancels every member's work and leaves the tab open", async () => {
  const h = harness();
  const tabId = h.own("A");
  h.register("B");
  h.context.mark(h.tabs.get(tabId), "true", "B");
  const pending = h.request("A", "wait", { tabId });
  await h.first;
  h.context.unmark(h.tabs.get(tabId));
  assert.match((await pending).error, /revoked or transferred/);
  assert(h.tabs.has(tabId));
  assert.equal((await h.request("A", "read", { tabId })).ok, false);
  assert.equal((await h.request("B", "read", { tabId })).ok, false);
});

test("closing a shared tab only leaves it; the last member closes it", async () => {
  const h = harness();
  const tabId = h.own("A");
  h.register("B");
  h.context.mark(h.tabs.get(tabId), "true", "B");
  assert.match(text(await h.request("A", "tabs_close_mcp", { tabId })), /still work in tab/);
  assert(h.tabs.has(tabId));
  assert.deepEqual(h.context.access.members(tabId), ["B"]);
  assert.equal((await h.request("B", "write", { tabId })).ok, true);
  assert.equal((await h.request("B", "tabs_close_mcp", { tabId })).ok, true);
  assert(!h.tabs.has(tabId));
});

test("a session ending leaves its tabs; the others keep working and the last one gives the tab back", async () => {
  const h = harness();
  const shared = h.own("A");
  h.register("B");
  h.context.mark(h.tabs.get(shared), "true", "B");
  const alone = h.own("A");
  const pending = h.request("B", "wait", { tabId: shared });
  await h.first;
  const queued = h.request("A", "tabs_create_mcp");
  h.context.endOwnerSession("A");
  assert.match((await queued).error, /disconnected while the request was queued/);
  assert.deepEqual(h.context.access.members(shared), ["B"]);
  assert.equal(h.context.access.shared(alone), false);
  assert(h.tabs.has(alone));
  for (const call of h.context.calls) call.check(); // B's work goes on
  h.context.endOwnerSession("B");
  assert.match((await pending).error, /disconnected/);
  assert.equal(h.context.access.shared(shared), false);
  assert(h.tabs.has(shared));
});

test("final lifecycle connection closing cancels work; reconnect grace keeps access", async () => {
  const h = harness();
  const tabId = h.own("A");
  const one = {},
    two = {};
  const theme = agentTheme({ id: "codex" });
  h.context.connectOwnerSession("A", one, theme, "/project");
  h.context.connectOwnerSession("A", two, theme, "/project");
  const pending = h.request("A", "wait", { tabId });
  await h.first;
  h.context.disconnectOwnerSession("A", one);
  for (const call of h.context.calls) call.check();
  h.context.disconnectOwnerSession("A", two);
  assert.match((await pending).error, /disconnected/);
  assert(h.context.access.has(tabId, "A"));
  h.context.connectOwnerSession("A", {}, theme, "/project");
  assert.equal(h.chromeTimers.size, 0);
  assert(h.context.access.has(tabId, "A"));
});

test("expired disconnect grace ends access but leaves the tab open", () => {
  const h = harness();
  const tabId = h.own("A"),
    transport = {};
  h.context.connectOwnerSession("A", transport, agentTheme({ id: "codex" }), "/project");
  h.context.disconnectOwnerSession("A", transport);
  for (const callback of h.chromeTimers.values()) callback();
  assert.equal(h.context.access.shared(tabId), false);
  assert(h.tabs.has(tabId));
});

test("persisted marks without a live member cannot grant restored-tab access", () => {
  const h = harness();
  const tabId = h.own("A");
  h.context.sessions.delete("A");
  h.context.restoreMark(h.tabs.get(tabId));
  assert.equal(h.context.access.shared(tabId), false);
  assert.equal(h.tabs.get(tabId).hasAttribute("zen-mcp"), false);
});

test("tool lifecycle subscriptions never become element-delivery targets", () => {
  const h = harness();
  const c = h.context;
  const channels = new Channels(new Map(), {
    theme: agentTheme,
    connectOwner: (...args) => c.connectOwnerSession(...args),
    disconnectOwner: (...args) => c.disconnectOwnerSession(...args),
  });
  c.subscribers = channels.subscribers;
  c.subscribe = (...args) => channels.subscribe(...args);
  c.unsubscribe = (...args) => channels.unsubscribe(...args);
  const transport = {};
  const id = h.context.subscribe(
    { session: "A", toolsOnly: true, agent: { id: "codex" }, cwd: "/project" },
    transport,
    {},
  );
  assert.equal(id, "A");
  assert.equal(h.context.subscribers.size, 0);
  assert(h.context.ownerConnections.get("A").has(transport));
  h.context.unsubscribe(id, transport);
  assert.equal(h.context.sessions.get("A").disconnected, true);
});

test("pick access metadata is specific to the destination, not to agent branding", () => {
  const h = harness();
  const tabId = h.own("A");
  const picks = new Picks({ hasAccess: (id, session) => h.context.access.has(id, session) });
  h.context.pickMessage = (...args) => picks.message(...args);
  const current = {
    browser: h.tabs.get(tabId).linkedBrowser,
    info: {
      rect: { x: 0, y: 0, width: 10, height: 10 },
      viewport: { width: 100, height: 100 },
      styles: {},
      url: "https://fixture.test/",
      selector: "#element",
      html: "<div/>",
    },
  };
  assert.equal(h.context.pickMessage(current, "note", "A").meta.tab_id, String(tabId));
  assert.equal(h.context.pickMessage(current, "note", "B").meta.source_tab, String(tabId));
  h.context.unmark(h.tabs.get(tabId));
  assert.equal(h.context.pickMessage(current, "note").meta.source_tab, String(tabId));
});

test("native tab closure cancels a pending wait and removes pick eligibility", async () => {
  const h = harness();
  const tabId = h.own("A");
  h.context.state.pickedTabs.add(tabId);
  const pending = h.request("A", "wait", { tabId });
  await h.first;
  h.context.onTabClose({ target: h.tabs.get(tabId) });
  assert.match((await pending).error, /revoked or transferred/);
  assert.equal(h.context.state.pickedTabs.has(tabId), false);
});

test("session menu pins explicit fixture tabs even when native context points elsewhere", () => {
  const h = harness();
  const tabId = h.own("A");
  const other = h.own("B");
  let context = [h.tabs.get(tabId)];
  class Node {
    children = [];
    attrs = new Map();
    listeners = new Map();
    setAttribute(key, value) {
      this.attrs.set(key, value);
    }
    getAttribute(key) {
      return this.attrs.get(key);
    }
    removeAttribute(key) {
      this.attrs.delete(key);
    }
    append(...nodes) {
      this.children.push(...nodes);
    }
    insertBefore(node, before) {
      const i = this.children.indexOf(before);
      if (i < 0) this.children.push(node);
      else this.children.splice(i, 0, node);
    }
    replaceChildren(...nodes) {
      this.children = nodes;
    }
    addEventListener(event, callback) {
      this.listeners.set(event, callback);
    }
    removeEventListener() {}
    remove() {}
    find(check) {
      if (check(this)) return this;
      for (const child of this.children) {
        const found = child.find(check);
        if (found) return found;
      }
    }
  }
  const menu = new Node();
  menu.id = "tabContextMenu";
  const win = {
    document: { createXULElement: () => new Node(), getElementById: (id) => menu.find((node) => node.id === id) },
    get TabContextMenu() {
      return { contextTab: context[0] };
    },
  };
  const c = h.context;
  const tabMenu = new TabMenu({
    L: (en) => en,
    mark: c.MARK,
    menuAgent: () => agentTheme({ id: "codex" }),
    paintIcon() {},
    sessions: () => c.sessions.values(),
    memberNames: (tab) =>
      c.access
        .members(tab.linkedBrowser.browserId)
        .map((session) => c.sessions.get(session)?.name)
        .join(", "),
    give: (tab, session) => c.mark(tab, tab.getAttribute(c.MARK) || "user", session),
    takeBack: (tab) => c.unmark(tab),
    readConfig: () => ({ mode: "auto", sites: { mode: "blocklist", blocklist: [], allowlist: [] } }),
    writeConfig() {},
    setMode() {},
    hasCustomPermissions: () => false,
    hostOf: () => "fixture.test",
    siteEntry: () => null,
    workspaces: () => null,
  });
  h.context.attachMenu = (win) => tabMenu.attach(win);
  h.context.prepareTabMenu = (win, tabs) => tabMenu.prepare(win, tabs);
  h.tabs.get(tabId).ownerDocument.defaultView = win;
  h.context.attachMenu(win);
  menu.listeners.get("popupshowing")({ target: menu });
  const permissions = menu.find((node) => node.id === "zen-mcp-context-give-permissions");
  const choices = permissions.children[0].children;
  assert.equal(
    choices.filter((node) => node.getAttribute("name") === "zen-mcp-site-list" && node.attrs.has("checked")).length,
    1,
  );
  assert.equal(
    choices.find((node) => node.getAttribute("data-zen-site-list") === "blocklist").getAttribute("checked"),
    "true",
  );
  assert.equal(
    choices.find((node) => node.getAttribute("data-zen-site") === "fixture.test").getAttribute("label"),
    "Block fixture.test",
  );
  assert.equal(
    choices.filter((node) => node.getAttribute("name") === "zen-mcp-general-mode" && node.attrs.has("checked")).length,
    1,
  );
  assert.equal(choices.find((node) => node.getAttribute("data-zen-mode") === "auto").getAttribute("checked"), "true");
  context = [h.tabs.get(other)]; // Native popup setup may change contextTab.
  h.context.prepareTabMenu(win, [h.tabs.get(tabId)]);
  assert.throws(() => h.context.prepareTabMenu(win, [h.tabs.get(other)]), /same window/);
  const a = menu.find((node) => node.getAttribute("data-zen-session") === "A");
  const b = menu.find((node) => node.getAttribute("data-zen-session") === "B");
  assert(a && b);
  assert.notEqual(a.getAttribute("label"), b.getAttribute("label"));
  b.listeners.get("command")();
  assert.deepEqual(h.context.access.members(tabId), ["A", "B"], "Giving adds the session; A keeps working");
  menu.find((node) => node.id === "zen-mcp-context-give").listeners.get("command")();
  assert.equal(h.context.access.shared(tabId), false);
  assert.deepEqual(h.context.access.members(other), ["B"], "The unrelated selected tab must remain untouched");
});

test("a future batch tab left and joined again cannot reuse its old authorization", async () => {
  const h = harness();
  const first = h.own("A"),
    second = h.own("A");
  h.register("B");
  h.context.mark(h.tabs.get(second), "true", "B");
  let next;
  const released = new Promise((resolve) => {
    next = resolve;
  });
  h.context.tools.hold = async ({ tabId }, call) => {
    h.context.browserFor(call, tabId);
    await released;
    return [];
  };
  const pending = h.request("A", "browser_batch", {
    actions: [
      { name: "hold", input: { tabId: first } },
      { name: "write", input: { tabId: second } },
    ],
  });
  await tick();
  h.context.leaveTab(h.tabs.get(second), "A");
  h.context.mark(h.tabs.get(second), "true", "A");
  next();
  const result = await pending;
  assert(result.isError);
  assert.match(result.content[0].text, /changed after this request was queued/);
  assert.deepEqual(h.effects, []);
});

test("joining inside a batch lets the following steps use the tab", async () => {
  const h = harness();
  const tabId = h.own("A");
  h.context.readConfig = askMode;
  h.context.askIsland = async () => "done";
  const result = await h.request("B", "browser_batch", {
    actions: [
      { name: "request_tab", input: { tabId, reason: "explicit test grant" } },
      { name: "write", input: { tabId } },
    ],
  });
  assert.equal(result.ok, true);
  assert(!result.isError, result.content?.[0]?.text);
  assert.deepEqual(h.effects, ["write"]);
});

test("bridge reload closes lifecycle transports without discarding tab access", () => {
  const h = harness();
  const tabId = h.own("A");
  let closed = 0;
  h.context.connectOwnerSession(
    "A",
    {
      close() {
        closed++;
      },
    },
    agentTheme({ id: "codex" }),
    "/project",
  );
  h.context.closeConnections();
  assert.equal(closed, 1);
  assert(h.context.access.has(tabId, "A"));
  assert(h.context.sessions.has("A"));
});

test("tab_work answers at once while a call runs in the tab, and shows each member's note", async () => {
  const h = harness(),
    tabId = h.own("A");
  h.register("B");
  h.context.mark(h.tabs.get(tabId), "true", "B");
  parsed(await h.request("A", "tab_work", { action: "start", tabId, summary: "Fill form; not submitted" }));
  const pending = h.request("A", "wait", { tabId });
  await h.first;
  parsed(await h.request("B", "tab_work", { action: "start", tabId, summary: "Check prices afterwards" }));
  const status = parsed(await h.request("B", "tab_work", { action: "status", tabId }));
  assert.equal(status.executing, true);
  assert.equal(status.member, true);
  assert.deepEqual(
    status.members.map((m) => [m.session, m.task.summary, !!m.you]),
    [
      ["A", "Fill form; not submitted", false],
      ["B", "Check prices afterwards", true],
    ],
  );
  const [running] = h.context.calls;
  assert.equal(running.session, "A");
  running.cancel(new Error("fixture cleanup"));
  await pending;
});

test("only members publish notes; summaries are validated and tab_work can't hide in a batch", async () => {
  const h = harness(),
    tabId = h.own("A");
  assert.equal((await h.request("B", "tab_work", { action: "start", tabId, summary: "Not mine" })).ok, false);
  for (const summary of ["", " ", "x".repeat(2001)])
    assert.equal((await h.request("A", "tab_work", { action: "finish", tabId, summary })).ok, false);
  assert.equal((await h.request("A", "tab_work", { action: "status" })).ok, false);
  assert.equal((await h.request("A", "tab_work", { action: "request", tabId, summary: "x" })).ok, false);
  const batch = await h.request("A", "browser_batch", {
    actions: [
      { name: "tab_work", input: { action: "finish", tabId, summary: "Done" } },
      { name: "write", input: { tabId } },
    ],
  });
  assert(batch.isError);
  assert.deepEqual(h.effects, []);
  assert.equal(h.context.access.task(tabId, "A"), null);
});

test("tab_work list shows agent tabs only, without page contents", async () => {
  const h = harness(),
    tabId = h.own("A");
  const userTab = h.own("C");
  h.context.unmark(h.tabs.get(userTab));
  const status = parsed(await h.request("B", "tab_work", { action: "list" }));
  assert.equal(status.tabs.length, 1);
  assert.equal(status.tabs[0].tabId, tabId);
  assert.equal(status.tabs[0].member, false);
  assert(!JSON.stringify(status).includes("https://fixture.test"));
  assert(!JSON.stringify(status).includes("tab-1"));
});

for (const [first, second] of [
  ["codex", "codex"],
  ["claude", "claude"],
  ["codex", "claude"],
]) {
  test(`membership is session-specific with ${first} and ${second}`, async () => {
    const h = harness(),
      tabId = h.own("A");
    parsed(await h.request("A", "tab_work", { action: "start", tabId, summary: "First task" }, first));
    assert.equal((await h.request("B", "write", { tabId }, second)).ok, false);
    parsed(await h.request("B", "request_tab", { tabId, reason: "Second task" }, second));
    assert.equal((await h.request("B", "write", { tabId }, second)).ok, true);
    assert.equal(h.context.sessions.get("B").agent.id, second);
  });
}

test("what the user sent from the browser goes with the session's next tool result", async () => {
  const h = harness();
  h.own("A");
  const { Inbox, inboxText } = await import("../browser/Inbox.sys.mjs");
  h.context.inboxText = inboxText;
  h.context.inbox = new Inbox({
    endpoint: () => null,
    deliver: async () => false,
    known: () => true,
    expired() {},
    now: () => 0,
  });
  assert.equal(await h.context.inbox.send("A", { kind: "pick", content: "Make this button blue" }), "waiting");
  const forB = await h.request("B", "tabs_context_mcp");
  assert.doesNotMatch(JSON.stringify(forB), /button blue/);
  const forA = await h.request("A", "tabs_context_mcp");
  assert.match(forA.content.at(-1).text, /The user sent you this from the browser[\s\S]*Make this button blue/);
  const again = await h.request("A", "tabs_context_mcp");
  assert.doesNotMatch(JSON.stringify(again), /button blue/);
});

test("tabs_context_mcp lists recipes for the sites of open tabs", async () => {
  const h = harness();
  const id = h.own("A");
  const { originOf } = await import("../browser/Recipes.sys.mjs");
  h.context.originOf = originOf;
  const url = h.tabs.get(id).linkedBrowser.currentURI.spec;
  h.context.recipes = {
    list: async () => [
      { id: "here", name: "Here", steps: 3, startUrl: url, origin: originOf(url), note: "" },
      { id: "elsewhere", name: "Elsewhere", steps: 1, startUrl: "https://other.test/", origin: "https://other.test" },
    ],
  };
  const list = JSON.parse((await h.request("A", "tabs_context_mcp")).content[0].text);
  assert.deepEqual(list.recipes, [{ id: "here", name: "Here", steps: 3, startUrl: url }]);
  assert.match(list.recipesNote, /recipes action get/);
  h.context.recipes = { list: async () => [] };
  assert.equal("recipes" in JSON.parse((await h.request("A", "tabs_context_mcp")).content[0].text), false);
});

test("tab activity: what the others did since a session's last call, and whether its read is stale", () => {
  const activity = new TabActivity();
  activity.record(1, "A", false, 1000); // A reads
  activity.seen(1, "A", true);
  activity.record(1, "B", false, 1000); // B only looks, in the same millisecond: A's read is still good
  assert.deepEqual(activity.since(1, "A"), { others: new Map([["B", { actions: 1, last: 1000 }]]), changed: false });
  activity.record(1, "B", true, 3000); // B clicks
  const report = activity.since(1, "A");
  assert.deepEqual(report.others.get("B"), { actions: 2, last: 3000 });
  assert.equal(report.changed, true);
  activity.seen(1, "A", false); // A acts without reading again
  assert.equal(activity.since(1, "A").others.size, 0);
  assert.equal(activity.since(1, "A").changed, true, "still stale until A reads");
  activity.seen(1, "A", true);
  assert.equal(activity.since(1, "A").changed, false);
  // a session that never read has no old refs to warn about
  assert.equal(activity.since(1, "C").changed, false);
  assert.equal(activity.since(1, "C").others.size, 2);
  activity.forget(1);
  assert.equal(activity.since(1, "C").others.size, 0);
});

test("a call in a shared tab says what the others did meanwhile and when the page may have changed", async () => {
  const h = harness();
  const tabId = h.own("A");
  h.register("B");
  h.context.mark(h.tabs.get(tabId), "true", "B");
  Object.assign(h.context.tools, {
    get_page_text: async (args, call) => (h.context.browserFor(call, args.tabId), [{ type: "text", text: "page" }]),
    form_input: async (args, call) => (h.context.browserFor(call, args.tabId), [{ type: "text", text: "set" }]),
  });
  const extra = (result) => result.content.slice(1).map((item) => JSON.parse(item.text));
  assert.deepEqual(extra(await h.request("A", "get_page_text", { tabId })), []);
  parsed(await h.request("B", "tab_work", { action: "start", tabId, summary: "Adding a coupon" }));
  await h.request("B", "form_input", { tabId, ref: "ref_1", value: "x" });
  await h.request("B", "form_input", { tabId, ref: "ref_2", value: "y" });
  const [report] = extra(await h.request("A", "form_input", { tabId, ref: "ref_3", value: "z" }));
  assert.equal(report.meanwhile.length, 1);
  assert.equal(report.meanwhile[0].task, "Adding a coupon");
  assert.equal(report.meanwhile[0].actions, 2);
  assert.match(report.meanwhile[0].lastAction, /^\d+ s ago$/);
  assert.match(report.pageChanged, new RegExp(`tab ${tabId} since you last read`));
  assert(!JSON.stringify(report).includes('"x"'), "values never go to other sessions");
  // nothing new since: no meanwhile, but the warning stays until A reads the page again
  const [again] = extra(await h.request("A", "form_input", { tabId, ref: "ref_3", value: "z" }));
  assert.equal(again.meanwhile, undefined);
  assert.match(again.pageChanged, /read the page again/);
  await h.request("B", "form_input", { tabId, ref: "ref_1", value: "x" });
  const [afterRead] = extra(await h.request("A", "get_page_text", { tabId }));
  assert.equal(afterRead.pageChanged, undefined);
  assert.equal(afterRead.meanwhile[0].actions, 1);
  // B was last here before A's calls: it hears about them once
  const [forB] = extra(await h.request("B", "get_page_text", { tabId }));
  assert.equal(forB.meanwhile[0].agent, h.context.sessions.get("A").name);
});
