// Talking to pages: every frame has its own ZenMcp actor (actors/ZenMcpChild.sys.mjs). This
// module sends queries to the right frame, translates refs and coordinates between frames,
// waits for loads and handles page dialogs.

// An open alert/confirm/prompt blocks the page's JS, so a query would never get an answer.
// Dialogs are looked for before and during each query; one is reported as information
// (DialogOpen), not as a failure, and the agent answers it with handle_dialog.
export class DialogOpen extends Error {}
// The page changed while a query was pending: its actor is gone and no answer will come.
export class PageGone extends Error {}

export function pageQueries(ctx) {
  let querySequence = 0;
  const pendingListeners = new Set();

  // The autoconfig scope has no BrowsingContext global (like IOUtils); use the window's.
  const bcById = (browser, id) => browser.ownerDocument.defaultView.BrowsingContext.get(id);

  // All loaded frames, top first.
  const framesOf = browser => browser.browsingContext.getAllBrowsingContextsInSubtree().filter(bc => bc.currentWindowGlobal);

  // The actor appends the browsing context ID to refs in subframes ("ref_3_f150323855361").
  // Agents see a short number instead ("ref_3_f2"); incoming refs are translated back.
  const frameNumbers = ctx.frameNumbers;
  function shortRefs(value) {
    // only long IDs (short numbers are already translated)
    return value.replace(/(ref_\d+)_f(\d{6,})\b/g, (_, ref, id) => {
      let n = frameNumbers.byId.get(id);
      if (!n) {
        n = frameNumbers.next++;
        frameNumbers.byId.set(id, n);
        frameNumbers.byNumber.set(n, id);
      }
      return `${ref}_f${n}`;
    });
  }

  // The ref sent to the actor: the real ID instead of the short number.
  function longRef(ref) {
    const m = /^(ref_\d+)_f(\d+)$/.exec(ref ?? "");
    const id = m && frameNumbers.byNumber.get(Number(m[2]));
    return id ? `${m[1]}_f${id}` : ref;
  }

  // A subframe ref is "ref_N_f<n>"; that frame must be inside this tab.
  function frameOf(browser, ref) {
    const id = /_f(\d+)$/.exec(ctx.longRef(ref) ?? "")?.[1];
    if (!id) return browser.browsingContext;
    const bc = bcById(browser, Number(id));
    if (!bc || bc.top !== browser.browsingContext) throw new Error(`${ref} not found (its frame may be gone); get refs again with read_page or find.`);
    return bc;
  }

  const queryRef = (browser, name, data, timeout) => ctx.query(browser, name, data, timeout, ctx.frameOf(browser, data.ref));

  // A screenshot coordinate → CSS px in the page's viewport.
  function toPagePoint(browser, [x, y]) {
    const s = ctx.state.scale.get(browser.browserId) || 1;
    return [x / s, y / s];
  }

  // Converts a point in a frame to the top page's viewport (scrolling iframes into view if needed).
  async function toTop(browser, frame, x, y, forClick = false) {
    for (let bc = frame; bc.parent; bc = bc.parent) {
      const o = await ctx.query(browser, "frame_rect", { bcId: bc.id }, 30000, bc.parent);
      x += o.x;
      y += o.y;
      if (forClick) await ctx.query(browser, "frame_hit", { bcId: bc.id, x, y }, 30000, bc.parent);
    }
    return [x, y];
  }

  // The innermost frame under a top-page point, and the point in its coordinates.
  async function deepest(browser, x, y) {
    let frame = browser.browsingContext;
    for (let depth = 0; depth < 8; depth++) {
      const { value: inner } = await ctx.query(browser, "frame_at", { x, y }, 30000, frame);
      const bc = inner && bcById(browser, inner.bcId);
      if (!bc?.currentWindowGlobal) break;
      [frame, x, y] = [bc, inner.x, inner.y];
    }
    return { frame, x, y };
  }

  // The innermost frame that has keyboard focus.
  async function focusedFrame(browser) {
    let frame = browser.browsingContext;
    for (let depth = 0; depth < 8; depth++) {
      const { value: id } = await ctx.query(browser, "active_frame", {}, 30000, frame);
      const bc = id && bcById(browser, id);
      if (!bc?.currentWindowGlobal) break;
      frame = bc;
    }
    return frame;
  }

  // The element's center if a ref is given (scrolled into view if needed), otherwise the
  // coordinate; in CSS px of the top page's viewport.
  async function target(browser, args, key = "coordinate") {
    if (args.ref && key === "coordinate") {
      const frame = ctx.frameOf(browser, args.ref);
      const { x, y } = await ctx.query(browser, "locate", { ref: ctx.longRef(args.ref), forClick: !!args.forClick }, 30000, frame);
      return ctx.toTop(browser, frame, x, y, !!args.forClick);
    }
    if (args[key] == null) throw new Error(`${args.action} needs ${key}${key === "coordinate" ? " or ref" : ""}.`);
    return ctx.toPagePoint(browser, args[key]);
  }

  function openDialog(browser) {
    const gBrowser = browser.ownerDocument.defaultView.gBrowser;
    let dialogs;
    try { dialogs = gBrowser.getTabDialogBox(browser).getContentDialogManager()._dialogs; } catch { return null; }
    for (const dialog of dialogs ?? []) {
      const win = dialog._frame?.contentWindow;
      if (win?.Dialog?.args) return win;
    }
    return null;
  }

  function describeDialog(win) {
    const { promptType, text, value } = win.Dialog.args;
    const extra = promptType.startsWith("prompt") && value ? ` (default: "${value}")` : "";
    return `The page has an open ${promptType} dialog: "${text}"${extra}. Accept or dismiss it with handle_dialog.`;
  }

  function throwIfDialog(browser) {
    const win = openDialog(browser);
    if (!win) return;
    const error = new DialogOpen(describeDialog(win));
    error.browser = browser;
    throw error;
  }

  // Shows "the page asks for confirmation" on the island until the dialog closes (answered by
  // the agent or the user).
  async function showDialog(browser) {
    const { L } = ctx;
    const dialog = openDialog(browser);
    if (!dialog || !ctx.island) return;
    const { promptType, text: message } = dialog.Dialog.args;
    const kind = {
      alert: L("shows an alert", "uyarı gösteriyor"),
      prompt: L("asks you for text", "senden bir metin istiyor"),
    }[promptType.replace(/Check$/, "")] ?? L("asks for confirmation", "onay istiyor");
    let host = "";
    try { host = browser.currentURI.host; } catch {}
    ctx.island.dialog(browser, `${host} — ${L("the page", "sayfa")} ${kind}`, message);
    while (openDialog(browser) && ctx.island?.state === "dialog") await ctx.sleep(500);
    ctx.island?.dialogEnded();
  }

  // frame: the BrowsingContext of a frame in the tab (the top frame by default)
  async function query(browser, name, data, timeout = 30000, frame = browser.browsingContext) {
    const { ownership } = ctx;
    const timers = { setTimeout: ctx.setTimeout, clearTimeout: ctx.clearTimeout };
    if (ctx.state.paused) throw new ctx.Stopped();
    ctx.operation?.check();
    ownership.check(ctx.controlledSource(browser).browserId, ctx.activeSession);
    ctx.assertSiteAccess(browser);
    const scope = ctx.operation;
    const wg = frame?.currentWindowGlobal;
    if (!wg) throw new Error("The page has not loaded yet.");
    throwIfDialog(browser);
    let done = false;
    const actor = wg.getActor("ZenMcp");
    const requestId = ++querySequence;
    const watcher = new ctx.Cancellation();
    const cancelActor = () => {
      try { actor.sendAsyncMessage("cancel_operation", { requestId }); } catch {}
    };
    const off = scope?.onCancel(cancelActor);
    const watchDialog = (async () => {
      while (!done) {
        await watcher.wait(250, timers);
        if (done) return;
        throwIfDialog(browser);
        if (frame.currentWindowGlobal !== wg) throw new PageGone("The page changed.");
        ownership.check(ctx.controlledSource(browser).browserId, scope?.session || ctx.activeSession);
        ctx.assertSiteAccess(browser);
      }
    })();
    try {
      const result = await ctx.guard(Promise.race([
        actor.sendQuery(name, { ...data, agent: ctx.activeAgent, session: ctx.activeSession, requestId }),
        watchDialog,
        watcher.wait(timeout, timers).then(() => { throw new Error(`The page did not respond within ${timeout / 1000} s.`); }),
      ]));
      scope?.check();
      if (result?.error) throw new Error(ctx.shortRefs(result.error));
      return result;
    } finally {
      done = true;
      off?.();
      cancelActor();
      watcher.cancel();
    }
  }

  // A query for page watches. query() depends on the active session's ownership and the
  // current operation (it would be cancelled when another session's work is stopped); a watch
  // checks ownership and site rules itself on every round.
  async function backgroundQuery(browser, name, data, frame) {
    const wg = frame?.currentWindowGlobal;
    if (!wg) throw new Error("The page has not loaded yet.");
    throwIfDialog(browser);
    let timer;
    try {
      return await Promise.race([
        wg.getActor("ZenMcp").sendQuery(name, { ...data, requestId: ++querySequence }),
        new Promise((_, reject) => { timer = ctx.setTimeout(() => reject(new Error("The page did not answer.")), 5000); }),
      ]);
    } finally { ctx.clearTimeout(timer); }
  }

  // Across all frames: the first accepted value wins; frames that vanish while loading are skipped.
  async function acrossFrames(browser, name, data, accept) {
    for (const bc of ctx.framesOf(browser)) {
      try {
        const { value } = await backgroundQuery(browser, name, data, bc);
        if (accept(value)) return value;
      } catch {}
    }
    return null;
  }

  // Replaces read_page's "{{frame:<id>}}" lines with that frame's tree (nested frames too).
  async function expandFrames(browser, value, opts, level = 0) {
    const parts = [];
    let last = 0;
    for (const m of value.matchAll(/^( *)\{\{frame:(\d+)\}\}$/gm)) {
      parts.push(value.slice(last, m.index));
      last = m.index + m[0].length;
      const indent = m[1];
      const bc = bcById(browser, Number(m[2]));
      const wg = bc?.currentWindowGlobal;
      if (!wg || bc.top !== browser.browsingContext || level > 6) {
        parts.push(`${indent}(iframe not loaded)`);
        continue;
      }
      let inner;
      try {
        ({ value: inner } = await ctx.query(browser, "read_page", { ...opts, bare: true }, 30000, bc));
        inner = await expandFrames(browser, inner, opts, level + 1);
      } catch (e) {
        if (e instanceof DialogOpen) throw e;
        inner = `(could not read: ${e?.message ?? e})`;
      }
      const body = inner ? inner.split("\n").map(line => indent + line).join("\n") : `${indent}(no visible elements)`;
      parts.push(`${indent}[iframe ${wg.documentURI?.spec ?? ""}]\n${body}`);
    }
    parts.push(value.slice(last));
    return parts.join("");
  }

  function waitForLoad(browser, timeout = 20000, destination = null) {
    return new Promise(resolve => {
      const listener = {
        QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"]),
        onStateChange(webProgress, _request, flags) {
          const done = Ci.nsIWebProgressListener.STATE_STOP | Ci.nsIWebProgressListener.STATE_IS_WINDOW;
          // A newly inserted tab may still deliver about:blank's STOP after the
          // listener was installed. It is not the requested navigation completing.
          const initialBlank = destination && destination !== "about:blank"
            && browser.currentURI?.spec === "about:blank";
          if (webProgress.isTopLevel && (flags & done) === done && !initialBlank) finish();
        },
      };
      // The browser holds the listener weakly; keep it alive until it finishes.
      pendingListeners.add(listener);
      const off = ctx.operation?.onCancel(() => { try { browser.stop(); } finally { finish(); } });
      function finish() {
        off?.();
        ctx.clearTimeout(timer);
        pendingListeners.delete(listener);
        try { browser.removeProgressListener(listener); } catch {}
        resolve();
      }
      browser.addProgressListener(listener, Ci.nsIWebProgress.NOTIFY_STATE_WINDOW);
      const timer = ctx.setTimeout(finish, timeout);
    });
  }

  // Read snapshots: the document and owner a read came from, so a later diff can tell whether
  // its baseline still applies.
  function readContext(browser) {
    return {
      url: browser.currentURI?.spec,
      ownerVersion: ctx.ownership.version(browser.browserId),
      frames: ctx.framesOf(browser).map(frame => [frame.id, frame.currentWindowGlobal]),
    };
  }

  function readOutput(browser, scope, context, value, diff, since) {
    ctx.assertSiteAccess(browser);
    ctx.operation?.check();
    ctx.ownership.check(ctx.controlledSource(browser).browserId, ctx.activeSession);
    return ctx.text(ctx.readSnapshots.render({ session: ctx.activeSession, tabId: browser.browserId,
      scope, context, currentContext: readContext(browser), text: value, diff, since }));
  }

  // Single-line JSON: indentation costs tokens on every call.
  const text = t => [{ type: "text", text: ctx.shortRefs(typeof t === "string" ? t : JSON.stringify(t)) }];

  return {
    pendingListeners, bcById, framesOf, shortRefs, longRef, frameOf, queryRef, toPagePoint, toTop, deepest,
    focusedFrame, target, openDialog, describeDialog, throwIfDialog, showDialog, query, backgroundQuery,
    acrossFrames, expandFrames, waitForLoad, readContext, readOutput, text,
  };
}
