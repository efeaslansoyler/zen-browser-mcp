// Browser tools: per-tab emulation, downloads, the system clipboard, extension panels.
// Built last by main.js: helpers are taken from ctx once. Tools get their call as the second argument.
export function browserTools(ctx) {
  const {
    DEVICE_PRESETS,
    DownloadLog,
    assertSiteURL,
    browserFor,
    browserSettings,
    downloads,
    extensionPanels,
    operationSleep,
    performClipboard,
    query,
    text,
    tools,
  } = ctx;

  // an address blocked by a site rule is not shown to the agent
  const describeDownload = (record) => {
    const info = DownloadLog.describe(record);
    try {
      assertSiteURL(info.url);
    } catch {
      delete info.url;
    }
    if (!record.closed) info.events = record.events;
    return info;
  };
  const pendingDownload = {
    state: "waiting_for_user",
    message: "Choose Save or Cancel in the browser download dialog. After saving, call downloads wait again.",
  };
  return {
    async browser_settings(args, call) {
      if (args.action === "devices")
        return text({
          engine: "Gecko",
          presets: DEVICE_PRESETS,
          note: "Generic layout/DPR/touch presets, not a different browser engine or a full physical device fingerprint. Mobile/tablet presets use the matching Android Firefox user agent; desktop keeps the current one unless userAgent is supplied. Reload for server-side UA detection.",
        });
      const browser = browserFor(call, args.tabId);
      await ctx.exclusive(call); // a change selects the tab
      if (args.action !== "get") await browserSettings.change(browser, call.session, args);
      const { value } = await query(browser, "browser_metrics");
      return text({
        ...value,
        requested: browserSettings.entries.get(browser)?.requested,
        emulated: browserSettings.entries.has(browser),
        note: "Actual metrics may differ from requested overrides due to native layout/privacy behavior. Overrides are tab-local and restored on reset, take-back, transfer, disconnect or bridge reload. Navigation may be needed for UA-dependent server responses.",
      });
    },

    // list: downloads started from the tab. cancel: stops a download and deletes the partial file.
    // wait: waits until the oldest unreported download (or the next to start), or the one with id,
    // finishes; called right after the click. until: "start" returns with the events file once the
    // download starts (for agents that can follow it).
    async downloads({ tabId, action = "list", id, until = "end", timeout = 120 }, call) {
      const { browserId } = browserFor(call, tabId);
      if (action === "list") {
        const list = downloads.forTab(browserId);
        for (const r of list) if (DownloadLog.finished(r)) r.reported = true;
        const pending = downloads.hasPendingDialog(browserId) ? pendingDownload : undefined;
        return text(
          list.length || pending
            ? { downloads: list.map(describeDownload), pending }
            : "No downloads from this tab yet. If a click should have started one, the site may still be preparing it: use action wait.",
        );
      }
      if (action === "cancel") {
        if (id == null) throw new Error("id is required for cancel; take it from action list.");
        const record = downloads.forTab(browserId).find((r) => r.id === id);
        if (!record) throw new Error(`No download #${id} from this tab; take ids from action list.`);
        if (record.download.succeeded)
          throw new Error(`Download #${id} already finished; the file is at ${record.download.target.path}.`);
        // finalize(true): stops and deletes the partial file; works on paused ones too
        record.canceling = true;
        await record.download.finalize(true);
        record.reported = true;
        return text(describeDownload(record));
      }
      const limit = Math.min(timeout, 600) * 1000;
      const start = Date.now();
      for (;;) {
        const list = downloads.forTab(browserId);
        const record = id != null ? list.find((r) => r.id === id) : list.find((r) => !r.reported);
        if (id != null && !record) throw new Error(`No download #${id} from this tab; take ids from action list.`);
        if (record && until === "start") return text(describeDownload(record));
        if (record && DownloadLog.finished(record)) {
          record.reported = true;
          if (record.download.succeeded) await DownloadLog.sha256(record);
          return text(describeDownload(record));
        }
        if (!record && downloads.hasPendingDialog(browserId)) return text(pendingDownload);
        if (Date.now() - start >= limit) {
          throw new Error(
            record
              ? `Still not finished after ${limit / 1000} s: ${JSON.stringify(describeDownload(record))}`
              : `No download started within ${limit / 1000} s. A save dialog may be waiting for the user, or the page needs another click.`,
          );
        }
        await operationSleep(250, call);
      }
    },

    async clipboard(args, call) {
      const source = browserFor(call, args.tabId);
      await ctx.exclusive(call);
      if (!args.extensionId) return text(await performClipboard(source, args));
      if (!["copy", "paste"].includes(args.action))
        throw new Error("extensionId is only needed for panel copy/paste; read/write use the system clipboard.");
      const entry = extensionPanels.get(source, call.session, args.tabId, args.extensionId);
      const bc = entry.popup.browser.browsingContext;
      const prefix = `panel_${bc.id}_${bc.currentWindowGlobal.innerWindowId}:`;
      let ref = args.ref;
      if (ref) {
        if (!ref.startsWith(prefix)) throw new Error("Use a ref from the current extension panel.");
        ref = ref.slice(prefix.length);
      }
      call.extensionSurface = {
        source,
        browser: entry.popup.browser,
        tabId: args.tabId,
        extensionId: args.extensionId,
      };
      try {
        return text(await performClipboard(entry.popup.browser, { ...args, ref }));
      } finally {
        delete call.extensionSurface;
      }
    },

    async extensions(args, call) {
      if (args.action === "list") return text({ extensions: await extensionPanels.list() });
      if (args.tabId == null || !args.extensionId)
        throw new Error("tabId and extensionId are required except for list.");
      const source = browserFor(call, args.tabId);
      await ctx.exclusive(call); // one popup and selected tab per window
      if (args.action === "close") {
        extensionPanels.close(source, call.session, args.tabId, args.extensionId);
        return text(
          "Extension panel closed. Temporary setting changes must be restored through the extension UI before closing.",
        );
      }
      if (args.action === "open") {
        const entry = await extensionPanels.open(source, call.session, args.tabId, args.extensionId);
        return text({
          extensionId: args.extensionId,
          tabId: args.tabId,
          opened: !!entry.popup,
          invoked: !!entry.invoked,
          note: entry.popup
            ? "Read the panel with extensions read; its refs are separate from the page. The target tab is now selected."
            : "Toolbar action invoked; this extension has no popup. Inspect the target page or extension output.",
        });
      }
      const entry = extensionPanels.get(source, call.session, args.tabId, args.extensionId);
      call.extensionSurface = {
        source,
        browser: entry.popup.browser,
        tabId: args.tabId,
        extensionId: args.extensionId,
      };
      const panelContext = entry.popup.browser.browsingContext;
      const prefix = `panel_${panelContext.id}_${panelContext.currentWindowGlobal.innerWindowId}:`;
      try {
        const handlers = {
          read: "read_page",
          text: "get_page_text",
          find: "find",
          computer: "computer",
          form_input: "form_input",
        };
        const name = handlers[args.action];
        if (!name) throw new Error("Unknown extension action.");
        if (name === "computer" && !args.computerAction) throw new Error("computerAction is required.");
        let ref = args.ref;
        if (ref) {
          if (!ref.startsWith(prefix))
            throw new Error(
              "This ref is not from the current extension panel. Use extensions read/find for fresh panel refs.",
            );
          ref = ref.slice(prefix.length);
        }
        const result = await tools[name]({ ...args, ref, action: args.computerAction }, call);
        return result.map((item) =>
          item.type === "text"
            ? { ...item, text: item.text.replace(/\bref_\d+(?:_f\d+)?\b/g, (ref) => prefix + ref) }
            : item,
        );
      } finally {
        delete call.extensionSurface;
      }
    },
  };
}
