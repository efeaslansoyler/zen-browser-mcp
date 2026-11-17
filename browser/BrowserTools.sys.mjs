// Browser tools: per-tab emulation, downloads, the system clipboard, extension panels.
// Built last by main.js: helpers are taken from ctx once; changing state (operation, activeSession…) is read from ctx at call time.
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
  return {
    async browser_settings(args) {
      if (args.action === "devices")
        return text({
          engine: "Gecko",
          presets: DEVICE_PRESETS,
          note: "Generic layout/DPR/touch presets, not a different browser engine or a full physical device fingerprint. Mobile/tablet presets use the matching Android Firefox user agent; desktop keeps the current one unless userAgent is supplied. Reload for server-side UA detection.",
        });
      const browser = browserFor(args.tabId);
      if (args.action !== "get") await browserSettings.change(browser, ctx.activeSession, args);
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
    async downloads({ tabId, action = "list", id, until = "end", timeout = 120 }) {
      const { browserId } = browserFor(tabId);
      if (action === "list") {
        const list = downloads.forTab(browserId);
        for (const r of list) if (DownloadLog.finished(r)) r.reported = true;
        return text(
          list.length
            ? { downloads: list.map(describeDownload) }
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
        if (Date.now() - start >= limit) {
          throw new Error(
            record
              ? `Still not finished after ${limit / 1000} s: ${JSON.stringify(describeDownload(record))}`
              : `No download started within ${limit / 1000} s. A save dialog may be waiting for the user, or the page needs another click.`,
          );
        }
        await operationSleep(250);
      }
    },

    async clipboard(args) {
      const source = browserFor(args.tabId);
      if (!args.extensionId) return text(await performClipboard(source, args));
      if (!["copy", "paste"].includes(args.action))
        throw new Error("extensionId is only needed for panel copy/paste; read/write use the system clipboard.");
      const entry = extensionPanels.get(source, ctx.activeSession, args.tabId, args.extensionId);
      const bc = entry.popup.browser.browsingContext;
      const prefix = `panel_${bc.id}_${bc.currentWindowGlobal.innerWindowId}:`;
      let ref = args.ref;
      if (ref) {
        if (!ref.startsWith(prefix)) throw new Error("Use a ref from the current extension panel.");
        ref = ref.slice(prefix.length);
      }
      ctx.operation.extensionSurface = {
        source,
        browser: entry.popup.browser,
        tabId: args.tabId,
        extensionId: args.extensionId,
      };
      try {
        return text(await performClipboard(entry.popup.browser, { ...args, ref }));
      } finally {
        delete ctx.operation.extensionSurface;
      }
    },

    async extensions(args) {
      if (args.action === "list") return text({ extensions: await extensionPanels.list() });
      if (args.tabId == null || !args.extensionId)
        throw new Error("tabId and extensionId are required except for list.");
      const source = browserFor(args.tabId);
      if (args.action === "close") {
        extensionPanels.close(source, ctx.activeSession, args.tabId, args.extensionId);
        return text(
          "Extension panel closed. Temporary setting changes must be restored through the extension UI before closing.",
        );
      }
      if (args.action === "open") {
        const entry = await extensionPanels.open(source, ctx.activeSession, args.tabId, args.extensionId);
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
      const entry = extensionPanels.get(source, ctx.activeSession, args.tabId, args.extensionId);
      ctx.operation.extensionSurface = {
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
        const result = await tools[name]({ ...args, ref, action: args.computerAction });
        return result.map((item) =>
          item.type === "text"
            ? { ...item, text: item.text.replace(/\bref_\d+(?:_f\d+)?\b/g, (ref) => prefix + ref) }
            : item,
        );
      } finally {
        delete ctx.operation.extensionSurface;
      }
    },
  };
}
