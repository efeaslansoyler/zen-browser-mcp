// Builds the bridge's shared ctx the way browser/main.js does, from the real modules, with
// neutral defaults for the browser-specific parts. Tests pass fakes for whatever they don't
// exercise; a fake replaces the real module function because modules call each other through
// ctx. `tools` fakes are added to (and override) the real tab and batch tools.
import { agentTheme, applyTheme } from "../../browser/Agent.sys.mjs";
import { Cancellation } from "../../browser/Cancellation.sys.mjs";
import { Locks } from "../../browser/Locks.sys.mjs";
import { Ownership } from "../../browser/Ownership.sys.mjs";
import { ReadSnapshots, sameReadContext } from "../../browser/ReadSnapshots.sys.mjs";
import { siteAllowed, normalizeConfig } from "../../browser/SiteRules.sys.mjs";
import { clipboardShortcut, systemClipboard } from "../../browser/Clipboard.sys.mjs";
import { config } from "../../browser/Config.sys.mjs";
import { sessionManager } from "../../browser/Sessions.sys.mjs";
import { tabWork } from "../../browser/TabWork.sys.mjs";
import { tabs, MARK } from "../../browser/Tabs.sys.mjs";
import { pageQueries, DialogOpen, PageGone } from "../../browser/PageQuery.sys.mjs";
import { pageInput, keyName } from "../../browser/PageInput.sys.mjs";
import { control, Stopped } from "../../browser/Control.sys.mjs";
import { activity } from "../../browser/Activity.sys.mjs";
import { toolRunner, batchTool } from "../../browser/ToolRunner.sys.mjs";
import { tabTools } from "../../browser/TabTools.sys.mjs";
import { permissions } from "../../browser/Permissions.sys.mjs";
import * as policy from "../../browser/Policy.sys.mjs";

export { DialogOpen, PageGone, Stopped, MARK };

export function bridgeContext(fakes = {}) {
  const ctx = {
    L: (en) => en,
    setTimeout,
    clearTimeout,
    logError() {},
    agentTheme,
    applyTheme,
    Cancellation,
    DialogOpen,
    PageGone,
    Stopped,
    MARK,
    keyName,
    siteAllowedIn: siteAllowed,
    normalizeConfig,
    policy,
    sameReadContext,
    clipboardShortcut,
    state: { tabs: new Set(), scale: new Map(), pickedTabs: new Set(), paused: false },
    ownership: new Ownership(),
    sessions: new Map(),
    sessionVersions: new Map(),
    ownerConnections: new Map(),
    disconnectTimers: new Map(),
    heldInputFrames: new Map(),
    tabRequests: new Map(),
    lastUse: new Map(),
    readSnapshots: new ReadSnapshots(),
    frameNumbers: { byId: new Map(), byNumber: new Map(), next: 1 },
    tools: {},
    commands: {},
    lastAgent: agentTheme({ id: "codex" }),
    calls: new Set(),
    locks: new Locks(),
    stopGeneration: 0,
    activeCalls: 0,
    island: null,
    setLastAgent(theme) {
      ctx.lastAgent = theme;
    },
    callOf(browser) {
      for (const call of ctx.calls)
        if (call.extensionSurface?.browser === browser || call.tabs.has(browser?.browserId)) return call;
      return null;
    },
    controlledSource: (browser) => browser,
    browserSettings: { restoreTab() {}, destroy() {} },
    extensionPanels: { list: async () => [], destroy() {}, releaseSession() {}, releaseTab() {} },
    watches: { endAll() {}, endSession() {} },
    network: { delete() {}, stop() {} },
  };
  Object.assign(
    ctx,
    config(ctx),
    sessionManager(ctx),
    tabWork(ctx),
    tabs(ctx),
    pageQueries(ctx),
    pageInput(ctx),
    control(ctx),
    activity(ctx),
    systemClipboard(ctx),
    toolRunner(ctx),
    permissions(ctx),
  );
  const { tools = {}, ...rest } = fakes;
  Object.assign(ctx, rest);
  Object.assign(ctx.tools, tabTools(ctx), batchTool(ctx), tools);
  return ctx;
}

// A running tool call the way ToolRunner makes one, registered in ctx.calls. tabs: tab IDs it
// already works in (so helpers that get a browser find it).
export function testCall(ctx, { session = "A", agent = { id: "codex" }, tabs = [] } = {}) {
  const call = Object.assign(new Cancellation(), {
    session,
    agent: agentTheme(agent),
    tabs: new Set(tabs),
    tabVersions: new Map(),
    userNotes: [],
  });
  ctx.calls.add(call);
  return call;
}
