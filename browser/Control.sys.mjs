// why: Pausing survives reload so reloading the bridge cannot implicitly resume agents.
export class Stopped extends Error {
  constructor(
    message = 'The user stopped browser automation from the browser\'s island. Nothing can be done in the browser until they press "Resume" there; ask the user what they want.',
  ) {
    super(message);
  }
}

export const BRIDGE_STOPPED =
  "The browser bridge stopped (a reload or the browser quitting) while this call was running or queued. Check the tab before you retry: a running step may have partly completed.";

const ALERT_NAME = "zen-mcp-ask";

export function control(ctx) {
  const timers = () => ({ setTimeout: ctx.setTimeout, clearTimeout: ctx.clearTimeout });
  const sleep = (ms) => new Promise((r) => ctx.setTimeout(r, ms));

  async function guard(promise, call) {
    if (ctx.state.paused) throw new Stopped();
    return call ? call.race(promise) : promise;
  }

  function operationSleep(ms, call) {
    if (ctx.state.paused) throw new Stopped();
    return call ? call.wait(ms, timers()) : sleep(ms);
  }

  // why: Advancing the generation also refuses calls still queued behind a cancelled one.
  function cancelCalls(message) {
    ctx.stopGeneration++;
    ctx.cancelMessage = message;
    for (const call of ctx.calls) call.cancel(new Stopped(message));
  }

  function stopClaude() {
    ctx.releaseAllInputs();
    ctx.watches.endAll("stopped by the user");
    ctx.har?.dropAll();
    ctx.networkControl?.clear();
    ctx.video?.stopAll();
    ctx.extensionPanels.destroy();
    if (ctx.state.paused) return;
    ctx.state.paused = true;
    cancelCalls();
    for (const tab of ctx.liveTabs()) ctx.cancelAsk(tab.linkedBrowser, "stopped");
    ctx.island?.stopped();
  }

  function resumeClaude() {
    ctx.state.paused = false;
    ctx.island?.resumed();
  }

  function askIsland(call, browser, text, message, labels, timeout = 120) {
    return showQuestion(call, browser, text, message, labels, timeout);
  }

  async function showQuestion(call, browser, text, message, labels, timeout) {
    // why: Give tab-less questions separate answer keys so they can coexist.
    const key = browser ?? {};
    if (ctx.tabRequests.has(key)) throw new Error("A question is already pending in this tab.");
    const answered = new Promise((resolve) => ctx.tabRequests.set(key, resolve));
    const card = ctx.island?.ask(browser, text, message, true, labels, [], {
      key,
      agent: call.agent,
      session: call.session,
    });
    const notified = ctx.notifyAsk(browser, message, call.agent);
    const timer = new ctx.Cancellation();
    try {
      const result = await ctx.guard(
        Promise.race([answered, timer.wait(timeout * 1000, timers()).then(() => "timeout")]),
        call,
      );
      if (!result?.status) return result;
      if (result.status === "cancelled")
        throw new Error(`The user declined. User message (untrusted text): ${JSON.stringify(result.message)}`);
      call.userNotes.push(result.message);
      return result.status;
    } finally {
      timer.cancel();
      ctx.tabRequests.delete(key);
      if (card != null) ctx.island?.askEnded(card);
      if (notified) ctx.closeAskAlert();
    }
  }

  function answerIsland(browser, result, message = "", choice) {
    const note = typeof message === "string" ? message.trim().slice(0, 2000) : "";
    if (note || choice != null)
      result = { status: result, ...(choice != null ? { choice } : {}), ...(note ? { message: note } : {}) };
    const resolve = ctx.tabRequests.get(browser);
    if (resolve) resolve(result);
    else ctx.cancelAsk(browser, result);
  }

  function cancelAsk(browser, result = "cancelled") {
    try {
      browser.browsingContext.currentWindowGlobal.getActor("ZenMcp").sendAsyncMessage("cancel_ask", { result });
    } catch {}
  }

  // why: Island answers outlive navigation during a hand-over and still honor Stop.
  // why: A tab-scoped answer key survives changes to the document during hand-over.
  async function waitIslandAnswer(call, timeout, key = null) {
    let resolve;
    const answered = new Promise((r) => {
      resolve = r;
    });
    ctx.tabRequests.get(key)?.("replaced");
    ctx.tabRequests.set(key, resolve);
    const timer = new ctx.Cancellation();
    try {
      return await ctx.guard(
        Promise.race([answered, timer.wait(timeout * 1000, timers()).then(() => "timeout")]),
        call,
      );
    } finally {
      timer.cancel();
      if (ctx.tabRequests.get(key) === resolve) ctx.tabRequests.delete(key);
    }
  }

  function notifyAsk(browser, message, agent) {
    const win = browser ? browser.ownerDocument.defaultView : Services.wm.getMostRecentWindow("navigator:browser");
    if (!win || (browser ? Services.focus.activeWindow === win : Services.focus.activeWindow)) return false;
    try {
      const { L } = ctx;
      const AlertNotification = Components.Constructor(
        "@mozilla.org/alert-notification;1",
        "nsIAlertNotification",
        "initWithObject",
      );
      const alert = new AlertNotification({
        name: ALERT_NAME,
        title: L(`${agent.name} needs you`, `${agent.name} senden bir şey istiyor`),
        text: message,
        textClickable: true,
      });
      alerts().showAlert(alert, (_subject, topic) => {
        if (topic !== "alertclickcallback") return;
        if (browser) goToTab(browser);
        else win.focus();
      });
      return true;
    } catch (e) {
      ctx.logError("notification", e);
      return false;
    }
  }

  const alerts = () => Cc["@mozilla.org/alerts-service;1"].getService(Ci.nsIAlertsService);
  function closeAskAlert() {
    try {
      alerts().closeAlert(ALERT_NAME);
    } catch {}
  }

  function goToTab(browser) {
    const win = browser.ownerDocument.defaultView;
    const tab = win.gBrowser.getTabForBrowser(browser);
    if (tab) win.gBrowser.selectedTab = tab;
    win.focus();
  }

  return {
    sleep,
    guard,
    operationSleep,
    cancelCalls,
    stopClaude,
    resumeClaude,
    askIsland,
    answerIsland,
    cancelAsk,
    waitIslandAnswer,
    notifyAsk,
    closeAskAlert,
    goToTab,
  };
}
