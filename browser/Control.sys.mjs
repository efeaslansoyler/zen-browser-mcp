// The user's controls over agents: Stop/Resume from the island (or Ctrl+Shift+Esc), and
// questions on the island (tab requests, permission prompts, ask_user).

// After Stop, running waits (page answers, loads, ask_user) end at once and every tool that
// touches tabs is refused until the user presses Resume. The paused state survives reloads.
export class Stopped extends Error {
  constructor() {
    super(
      'The user stopped browser automation from the browser\'s island. Nothing can be done in the browser until they press "Resume" there; ask the user what they want.',
    );
  }
}

const ALERT_NAME = "zen-mcp-ask";

export function control(ctx) {
  const timers = () => ({ setTimeout: ctx.setTimeout, clearTimeout: ctx.clearTimeout });
  const sleep = (ms) => new Promise((r) => ctx.setTimeout(r, ms));

  // call: the tool call the wait belongs to (Stop and revocations cancel it), or null
  async function guard(promise, call) {
    if (ctx.state.paused) throw new Stopped();
    return call ? call.race(promise) : promise;
  }

  function operationSleep(ms, call) {
    if (ctx.state.paused) throw new Stopped();
    return call ? call.wait(ms, timers()) : sleep(ms);
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
    ctx.stopGeneration++;
    for (const call of ctx.calls) call.cancel(new Stopped());
    // remove ask_user overlays waiting on pages
    for (const tab of ctx.liveTabs()) ctx.cancelAsk(tab.linkedBrowser, "stopped");
    ctx.island?.stopped();
  }

  function resumeClaude() {
    ctx.state.paused = false;
    ctx.island?.resumed();
  }

  // A yes/no question on the island (tab request, action permission). Returns "done",
  // "timeout", or { status, message } when the user added a note; throws when the user
  // declined with a note.
  function askIsland(call, browser, text, message, labels, timeout = 120) {
    return showQuestion(call, browser, text, message, labels, timeout);
  }

  async function showQuestion(call, browser, text, message, labels, timeout) {
    // the answer comes back with this key: the tab, or for a question without one its own token
    const key = browser ?? {};
    if (ctx.tabRequests.has(key)) throw new Error("A question is already pending in this tab.");
    const answered = new Promise((resolve) => ctx.tabRequests.set(key, resolve));
    const card = ctx.island?.ask(browser, text, message, true, labels, [], { key, agent: call.agent });
    const notified = ctx.notifyAsk(browser, message, call.agent);
    const timer = new ctx.Cancellation();
    try {
      const result = await ctx.guard(
        Promise.race([answered, timer.wait(timeout * 1000, timers()).then(() => "timeout")]),
        call,
      );
      // The island note: an error on decline, appended to the tool result on approval.
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

  // The island's OK/Cancel: answers a pending question or ask_user. browser is the card's key:
  // its tab, or a token for a question that isn't tied to a tab; choice is the option button
  // the user pressed.
  function answerIsland(browser, result, message = "", choice) {
    const note = typeof message === "string" ? message.trim().slice(0, 2000) : "";
    if (note || choice != null)
      result = { status: result, ...(choice != null ? { choice } : {}), ...(note ? { message: note } : {}) };
    const resolve = ctx.tabRequests.get(browser);
    if (resolve) resolve(result);
    else ctx.cancelAsk(browser, result);
  }

  // Ends a pending ask_user with this result (island OK/Cancel, Stop) and removes its overlay.
  function cancelAsk(browser, result = "cancelled") {
    try {
      browser.browsingContext.currentWindowGlobal.getActor("ZenMcp").sendAsyncMessage("cancel_ask", { result });
    } catch {}
  }

  // Waits for the island's answer instead of a page: a tab-less ask_user has no page, and a
  // hand-over must outlive the pages the user goes through (login → 2FA → home). Stop cancels
  // it through guard().
  // key: the tab's browser for a hand-over that must survive navigations, null otherwise.
  // call: the tool call that waits, or null for the user's own flows.
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

  // A desktop notification when a question arrives while Zen isn't focused; clicking it goes
  // to the tab.
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
