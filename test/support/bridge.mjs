// Builds the bridge's shared ctx the way browser/main.js does, from the real modules, with
// neutral defaults for the browser-specific parts. Tests pass fakes for whatever they don't
// exercise; a fake replaces the real module function because modules call each other through
// ctx. `tools` fakes are added to (and override) the real tab and batch tools.
import { agentTheme, applyTheme } from "../../browser/Agent.sys.mjs";
import { Cancellation } from "../../browser/Cancellation.sys.mjs";
import { Ownership } from "../../browser/Ownership.sys.mjs";
import { ReadSnapshots, sameReadContext } from "../../browser/ReadSnapshots.sys.mjs";
import { siteRule, normalizeConfig } from "../../browser/SiteRules.sys.mjs";
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
    siteRule,
    normalizeConfig,
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
    activeAgent: agentTheme({ id: "codex" }),
    activeSession: null,
    operation: null,
    toolQueue: Promise.resolve(),
    stopGeneration: 0,
    activeCalls: 0,
    island: null,
    setActiveAgent(theme) {
      ctx.activeAgent = theme;
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
