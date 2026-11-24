export class DialogOpen extends Error {}
export class PageGone extends Error {}

const MAX_DIALOG_TEXT = 2000;
const MAX_FRAME_URL = 200;
const FRAME_SIZE_WAIT = 1000;

export function pageQueries(ctx) {
  let querySequence = 0;
  const pendingListeners = new Set();

  // why: Autoconfig has no BrowsingContext global (docs/gecko-pitfalls.md, Loading and scopes).
  const bcById = (browser, id) => browser.ownerDocument.defaultView.BrowsingContext.get(id);

  const framesOf = (browser) =>
    browser.browsingContext.getAllBrowsingContextsInSubtree().filter((bc) => bc.currentWindowGlobal);

  // why: A ref names its document, so it can't resolve to an element of a later one.
  const documents = new WeakMap();
  function documentNumber(wg) {
    if (!documents.has(wg)) documents.set(wg, ctx.refDocuments.next++);
    return documents.get(wg);
  }

  function frameOf(browser, ref) {
    if (!ref) return browser.browsingContext;
    const number = Number(/^ref_(\d+)[a-z]+$/.exec(ref)?.[1]);
    const frame = ctx.framesOf(browser).find((bc) => documents.get(bc.currentWindowGlobal) === number);
    if (!frame) throw new Error(`${ref} not found (the page may have changed); get refs again with read_page or find.`);
    return frame;
  }

  const queryRef = (browser, name, data, timeout) =>
    ctx.query(browser, name, data, timeout, ctx.frameOf(browser, data.ref));

  function toPagePoint(browser, [x, y], screenshot) {
    const call = ctx.callOf(browser);
    const s = (call?.screenshots ?? ctx.screenshots).scale(call?.session, browser.browserId, screenshot);
    return [x / s, y / s];
  }

  // why: A new frame in another process has its default size until the page around it tells it the real one.
  const isSized = (size, shown) => size.every((n, i) => Math.abs(n - shown[i]) <= 1 + shown[i] * 0.03);

  async function toTop(browser, frame, at, { forClick = false, sizedOnly = false } = {}) {
    for (let bc = frame; bc.parent; bc = bc.parent) {
      const { size } = at;
      at = await ctx.query(browser, "frame_point", { bcId: bc.id, point: [at.x, at.y] }, 30000, bc.parent);
      if (sizedOnly && size && !isSized(size, at.frameSize)) return null;
      if (forClick) await ctx.query(browser, "frame_hit", { bcId: bc.id, x: at.x, y: at.y }, 30000, bc.parent);
    }
    return [at.x, at.y];
  }

  async function toFrame(browser, frame, x, y) {
    if (!frame.parent) return [x, y];
    const at = await toFrame(browser, frame.parent, x, y);
    const data = { bcId: frame.id, x: at[0], y: at[1] };
    const { value } = await ctx.query(browser, "frame_at", data, 30000, frame.parent);
    if (!value) throw new Error("iframe not found (the page may have changed).");
    return [value.x, value.y];
  }

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

  // why: An iframe's own actor can't scroll the pages around it. Best effort: the outline is there without it.
  async function reveal(browser, ref) {
    const frame = ref && ctx.frameOf(browser, ref);
    if (!frame?.parent) return;
    try {
      await ctx.toTop(browser, frame, await ctx.query(browser, "locate", { ref }, 5000, frame));
    } catch {}
  }

  async function target(browser, args, key = "coordinate") {
    if (args.ref && key === "coordinate") {
      const frame = ctx.frameOf(browser, args.ref);
      const forClick = !!args.forClick;
      for (let waited = 0; ; waited += 50) {
        const at = await ctx.query(browser, "locate", { ref: args.ref, forClick }, 30000, frame);
        const point = await ctx.toTop(browser, frame, at, { forClick, sizedOnly: waited < FRAME_SIZE_WAIT });
        if (point) return point;
        await ctx.operationSleep(50, ctx.callOf(browser));
      }
    }
    if (args[key] == null) throw new Error(`${args.action} needs ${key}${key === "coordinate" ? " or ref" : ""}.`);
    return ctx.toPagePoint(browser, args[key], args.screenshot);
  }

  function openDialog(browser) {
    const gBrowser = browser.ownerDocument.defaultView.gBrowser;
    let dialogs;
    try {
      dialogs = gBrowser.getTabDialogBox(browser).getContentDialogManager()._dialogs;
    } catch {
      return null;
    }
    for (const dialog of dialogs ?? []) {
      const win = dialog._frame?.contentWindow;
      if (win?.Dialog?.args) return win;
    }
    return null;
  }

  // why: A page could otherwise write lines that look like the bridge's or the user's.
  function dialogData(win) {
    const { promptType, text, value } = win.Dialog.args;
    const short = (s) =>
      (s.length > MAX_DIALOG_TEXT ? s.slice(0, MAX_DIALOG_TEXT - 1) + "…" : s).replace(/[\u0085\u2028\u2029]/g, "\n");
    return JSON.stringify({
      pageText: short(String(text ?? "")),
      ...(promptType.startsWith("prompt") && value ? { defaultValue: short(String(value)) } : {}),
      untrusted: true,
    });
  }

  function describeDialog(win) {
    const { promptType } = win.Dialog.args;
    return `The page has an open ${promptType} dialog. Accept or dismiss it with handle_dialog.\n${dialogData(win)}`;
  }

  function throwIfDialog(browser) {
    const win = openDialog(browser);
    if (!win) return;
    const error = new DialogOpen(describeDialog(win));
    error.browser = browser;
    throw error;
  }

  async function showDialog(browser) {
    const { L } = ctx;
    const dialog = openDialog(browser);
    if (!dialog || !ctx.island) return;
    const { promptType, text: message } = dialog.Dialog.args;
    const kind =
      {
        alert: L("shows an alert", "uyarı gösteriyor"),
        prompt: L("asks you for text", "senden bir metin istiyor"),
      }[promptType.replace(/Check$/, "")] ?? L("asks for confirmation", "onay istiyor");
    let host = "";
    try {
      host = browser.currentURI.host;
    } catch {}
    ctx.island.dialog(browser, `${host} — ${L("the page", "sayfa")} ${kind}`, message);
    while (openDialog(browser) && ctx.island?.state === "dialog") await ctx.sleep(500);
    ctx.island?.dialogEnded();
  }

  async function query(browser, name, data, timeout = 30000, frame = browser.browsingContext) {
    const { access } = ctx;
    const timers = { setTimeout: ctx.setTimeout, clearTimeout: ctx.clearTimeout };
    if (ctx.state.paused) throw new ctx.Stopped();
    const scope = ctx.callOf(browser);
    scope?.check();
    access.check(ctx.controlledSource(browser).browserId, scope?.session);
    ctx.assertSiteAccess(browser);
    const wg = frame?.currentWindowGlobal;
    if (!wg) throw new Error("The page has not loaded yet.");
    throwIfDialog(browser);
    let done = false;
    const actor = wg.getActor("ZenMcp");
    const requestId = ++querySequence;
    const watcher = new ctx.Cancellation();
    const cancelActor = () => {
      try {
        actor.sendAsyncMessage("cancel_operation", { requestId });
      } catch {}
    };
    const off = scope?.onCancel(cancelActor);
    const watchDialog = (async () => {
      while (!done) {
        await watcher.wait(250, timers);
        if (done) return;
        throwIfDialog(browser);
        // why: A bfcache entry can retain its original actor (docs/gecko-pitfalls.md, Input and frames).
        if (frame.currentWindowGlobal !== wg || frame.isDiscarded || frame.top?.isInBFCache)
          throw new PageGone("The page changed.");
        access.check(ctx.controlledSource(browser).browserId, scope?.session);
        ctx.assertSiteAccess(browser);
      }
    })();
    try {
      const result = await ctx.guard(
        Promise.race([
          actor.sendQuery(name, {
            ...data,
            agent: scope?.agent ?? ctx.lastAgent,
            session: scope?.session,
            documentNumber: documentNumber(wg),
            requestId,
          }),
          watchDialog,
          watcher.wait(timeout, timers).then(() => {
            throw new Error(`The page did not respond within ${timeout / 1000} s.`);
          }),
        ]),
        scope,
      );
      scope?.check();
      if (result?.error) throw new Error(result.error);
      return result;
    } finally {
      done = true;
      off?.();
      cancelActor();
      watcher.cancel();
    }
  }

  // why: Watches outlive individual tool calls and therefore check access and cancellation independently.
  async function backgroundQuery(browser, name, data, frame) {
    const wg = frame?.currentWindowGlobal;
    if (!wg) throw new Error("The page has not loaded yet.");
    throwIfDialog(browser);
    let timer;
    try {
      return await Promise.race([
        wg.getActor("ZenMcp").sendQuery(name, { ...data, requestId: ++querySequence }),
        new Promise((_, reject) => {
          timer = ctx.setTimeout(() => reject(new Error("The page did not answer.")), 5000);
        }),
      ]);
    } finally {
      ctx.clearTimeout(timer);
    }
  }

  async function acrossFrames(browser, name, data, accept) {
    for (const bc of ctx.framesOf(browser)) {
      try {
        const { value } = await backgroundQuery(browser, name, data, bc);
        if (accept(value)) return value;
      } catch {}
    }
    return null;
  }

  // why: A page chooses its frames' URLs, and data: URLs keep spaces, quotes and brackets.
  const frameLine = (url) => {
    const safe = url.replace(/[\s"[\]]/g, encodeURIComponent);
    return `[iframe ${safe.length > MAX_FRAME_URL ? safe.slice(0, MAX_FRAME_URL - 1) + "…" : safe}]`;
  };

  const isLoading = (bc) => !!bc.webProgress?.isLoadingDocument;

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
        ({ value: inner } = await ctx.query(
          browser,
          "read_page",
          { ...opts, bare: true, loading: isLoading(bc) },
          30000,
          bc,
        ));
        inner = await expandFrames(browser, inner, opts, level + 1);
      } catch (e) {
        if (e instanceof DialogOpen) throw e;
        inner = `(could not read: ${e?.message ?? e})`;
      }
      const body = inner
        ? inner
            .split("\n")
            .map((line) => indent + line)
            .join("\n")
        : `${indent}(no visible elements)`;
      parts.push(`${indent}${frameLine(wg.documentURI?.spec ?? "")}\n${body}`);
    }
    parts.push(value.slice(last));
    return parts.join("");
  }

  function waitForLoad(browser, timeout = 20000, destination = null) {
    return new Promise((resolve) => {
      const listener = {
        QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"]),
        onStateChange(webProgress, _request, flags) {
          const done = Ci.nsIWebProgressListener.STATE_STOP | Ci.nsIWebProgressListener.STATE_IS_WINDOW;
          // why: A new tab can still report STOP for about:blank after the requested navigation starts.
          const initialBlank =
            destination && destination !== "about:blank" && browser.currentURI?.spec === "about:blank";
          if (webProgress.isTopLevel && (flags & done) === done && !initialBlank) finish();
        },
      };
      // why: The progress service holds the listener weakly (docs/gecko-pitfalls.md, Input and frames).
      pendingListeners.add(listener);
      const off = ctx.callOf(browser)?.onCancel(() => {
        try {
          browser.stop();
        } finally {
          finish();
        }
      });
      function finish() {
        off?.();
        ctx.clearTimeout(timer);
        pendingListeners.delete(listener);
        try {
          browser.removeProgressListener(listener);
        } catch {}
        resolve();
      }
      browser.addProgressListener(listener, Ci.nsIWebProgress.NOTIFY_STATE_WINDOW);
      const timer = ctx.setTimeout(finish, timeout);
    });
  }

  // why: The baseline needs the read's document and owner to prevent reuse in a different context.
  function readContext(browser) {
    return {
      url: browser.currentURI?.spec,
      ownerVersion: ctx.access.version(browser.browserId),
      frames: ctx.framesOf(browser).map((frame) => [frame.id, frame.currentWindowGlobal]),
    };
  }

  function readOutput(browser, scope, context, value, diff, since) {
    ctx.assertSiteAccess(browser);
    const call = ctx.callOf(browser);
    call?.check();
    ctx.access.check(ctx.controlledSource(browser).browserId, call?.session);
    return ctx.text(
      ctx.readSnapshots.render({
        session: call?.session,
        tabId: browser.browserId,
        scope,
        context,
        currentContext: readContext(browser),
        text: value,
        diff,
        since,
      }),
    );
  }

  // why: JSON indentation adds token cost to every call.
  const text = (t) => [{ type: "text", text: typeof t === "string" ? t : JSON.stringify(t) }];

  return {
    pendingListeners,
    bcById,
    framesOf,
    frameOf,
    queryRef,
    toPagePoint,
    toTop,
    toFrame,
    reveal,
    deepest,
    focusedFrame,
    target,
    openDialog,
    describeDialog,
    dialogData,
    throwIfDialog,
    showDialog,
    query,
    backgroundQuery,
    acrossFrames,
    isLoading,
    expandFrames,
    frameLine,
    waitForLoad,
    readContext,
    readOutput,
    text,
  };
}
