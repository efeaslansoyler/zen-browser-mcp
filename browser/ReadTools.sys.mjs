import { networkFilter } from "./NetworkFilters.sys.mjs";

export function readTools(ctx) {
  const {
    DialogOpen,
    MAX_PAGE_TEXT,
    Stopped,
    Watches,
    assertSiteAccess,
    assertSiteURL,
    browserFor,
    expandFrames,
    frameLine,
    frameOf,
    framesOf,
    isLoading,
    network,
    operationSleep,
    permissionContext,
    query,
    readContext,
    readOutput,
    samePermissionContext,
    sameReadContext,
    text,
    watches,
  } = ctx;
  return {
    async get_page_text({ tabId, diff = false, since }, call) {
      const browser = browserFor(call, tabId);
      const context = readContext(browser);
      const page = await query(browser, "text");
      let out = `${page.title}\n${page.url}\n\n${page.text}`;
      for (const bc of framesOf(browser).slice(1)) {
        if (out.length > MAX_PAGE_TEXT) break;
        try {
          const frame = await query(browser, "text", {}, 30000, bc);
          if (frame.text.trim()) out += `\n\n${frameLine(frame.url)}\n${frame.text}`;
        } catch (e) {
          if (e instanceof DialogOpen) throw e;
        }
      }
      if (out.length > MAX_PAGE_TEXT) out = out.slice(0, MAX_PAGE_TEXT) + "\n…(truncated)";
      return readOutput(browser, ["get_page_text"], context, out, diff, since);
    },

    async read_page({ tabId, filter, depth, ref_id, max_chars = 50000, diff = false, since }, call) {
      const browser = browserFor(call, tabId);
      const context = readContext(browser);
      const frame = frameOf(browser, ref_id);
      const opts = { filter, depth, max_chars };
      let { value } = await query(
        browser,
        "read_page",
        { ...opts, ref_id, bare: frame !== browser.browsingContext, loading: isLoading(frame) },
        30000,
        frame,
      );
      // why: A title can look like the marker of a frame.
      const start = frame === browser.browsingContext ? value.indexOf("\n\n") + 2 : 0;
      value = value.slice(0, start) + (await expandFrames(browser, value.slice(start), opts));
      if (value.length > max_chars) {
        const end = value.lastIndexOf("\n", max_chars);
        value =
          value.slice(0, end < 0 ? max_chars : end) +
          `\n…(truncated at ${max_chars} characters; focus on a subtree with ref_id)`;
      }
      return readOutput(
        browser,
        ["read_page", filter || "all", depth ?? null, ref_id || null, max_chars],
        context,
        value,
        diff,
        since,
      );
    },

    async find({ tabId, query: q }, call) {
      const browser = browserFor(call, tabId);
      const results = [];
      for (const bc of framesOf(browser)) {
        try {
          const { value } = await query(browser, "find", { query: q }, 30000, bc);
          results.push(...value);
        } catch (e) {
          if (e instanceof DialogOpen || bc === browser.browsingContext) throw e;
        }
      }
      if (!results.length) return text(`Nothing matches "${q}". Look at the page structure with read_page.`);
      results.sort((a, b) => b.score - a.score);
      return text(
        results
          .slice(0, 20)
          .map((r) => r.line)
          .join("\n"),
      );
    },

    // why: Poll across document changes so a submitting form cannot end the wait prematurely.
    async wait_for({ tabId, text: wanted, selector, gone = false, network_idle = false, timeout = 10 }, call) {
      const browser = browserFor(call, tabId);
      if (!wanted && !selector && !network_idle) throw new Error("text, selector or network_idle is required.");
      if (selector) {
        try {
          browser.ownerDocument.createDocumentFragment().querySelector(selector);
        } catch {
          throw new Error(`Invalid CSS selector: ${selector}`);
        }
      }
      const start = Date.now();
      const limit = Math.min(timeout, 60) * 1000;
      let quietSince = null;
      for (;;) {
        let ok = true;
        if (wanted || selector) {
          let found = false;
          for (const bc of framesOf(browser)) {
            try {
              if ((await query(browser, "check", { text: wanted, selector }, 5000, bc)).value) {
                found = true;
                break;
              }
            } catch (e) {
              // why: Frames may change during navigation, so retry the next poll.
              if (e instanceof DialogOpen || e instanceof Stopped) throw e;
            }
          }
          ok = gone ? !found : found;
        }
        if (ok && network_idle) {
          // why: Long polling and streams would otherwise keep the network from reaching idle.
          const now = Date.now();
          const busy = network.busy(browser.browserId, now);
          if (busy) quietSince = null;
          else quietSince ??= now;
          ok = !busy && now - quietSince >= 500;
        }
        const elapsed = Date.now() - start;
        if (ok) return text(`Done (${(elapsed / 1000).toFixed(1)} s).`);
        if (elapsed >= limit)
          throw new Error(
            `Not met within ${Math.min(timeout, 60)} s. For longer waits use the watch tool and monitor its events file.`,
          );
        await operationSleep(250, call);
      }
    },

    watch({ tabId, action = "start", id, ...spec }, call) {
      const session = call.session;
      if (action === "list") return text({ watches: watches.forSession(session).map(Watches.summary) });
      if (action === "stop") {
        const own = watches.forSession(session).find((w) => w.id === id);
        if (!own) throw new Error(`No watch #${id} in this session; take ids from action list.`);
        watches.end(id, "stopped by the agent");
        return text(`Watch #${id} stopped.`);
      }
      // why: A hold watch must run without the tab lock so it can respond while the holder works.
      if (spec.hold) {
        if (!ctx.access.shared(tabId) || !ctx.findTab(tabId)) throw new Error(`Tab ${tabId} is not an agent tab.`);
        const hold = ctx.holdOf(tabId);
        const user = ctx.takenOver(tabId);
        if (!user && (!hold || hold.session === session))
          throw new Error(`Nobody else holds tab ${tabId} now; go ahead.`);
        return text({
          ...Watches.summary(watches.start(session, tabId, null, spec)),
          hold: user ? { tabId, by: "the user" } : ctx.describeHold(tabId, hold, session),
          next: "The events file gets a released line when the tab is free. Do other work meanwhile.",
        });
      }
      const browser = browserFor(call, tabId);
      assertSiteAccess(browser);
      if (spec.selector) {
        try {
          browser.ownerDocument.createDocumentFragment().querySelector(spec.selector);
        } catch {
          throw new Error(`Invalid CSS selector: ${spec.selector}`);
        }
      }
      return text(Watches.summary(watches.start(session, tabId, browser, spec)));
    },

    async web_vitals({ tabId }, call) {
      const browser = browserFor(call, tabId);
      const { value } = await query(browser, "web_vitals", {});
      return text(value);
    },

    async network_capture(args, call) {
      const { tabId, action, childTabId } = args;
      const browser = browserFor(call, tabId);
      const har = ctx.har;
      if (action === "start") {
        const projection =
          args.response_projection &&
          ctx.validateHarProjection(args.response_projection, ctx.originOf(browser.currentURI.spec));
        return text(har.start(tabId, call.session, projection));
      }
      const capture = har.owned(tabId, call.session);
      if (action === "status") return text(har.status(capture));
      if (action === "attach") {
        const child = ctx.findTab(childTabId)?.linkedBrowser;
        ctx.access.check(childTabId, call.session);
        if (!child) throw new Error("Child tab is unavailable.");
        ctx.assertSiteAccess(child);
        ctx.assertNotHeld(childTabId, call.session);
        return text(har.attach(capture, childTabId));
      }
      if (action === "cancel") {
        har.drop(capture);
        return text({ state: "cancelled" });
      }
      if (action === "stop") return text(await har.export(capture, args, call));
      throw new Error("Unknown network capture action.");
    },

    read_network_requests(args, call) {
      const { tabId, limit = 100, clear, id, max_chars = 20000 } = args;
      const browser = browserFor(call, tabId);
      const log = network.get(browser.browserId);
      if (id != null) {
        const r = log?.list.find((r) => r.id === id);
        if (!r)
          return text(
            `No request #${id} (the log is cleared when the page moves to another site); take ids from the list.`,
          );
        assertSiteURL(r.url);
        return network.details(browser, r, max_chars).then(text);
      }
      let list = (log?.list ?? []).filter((r) => {
        try {
          assertSiteURL(r.url);
          return true;
        } catch {
          return false;
        }
      });
      list = list.filter(networkFilter(args));
      const lines = list.slice(-limit).map((r) => {
        const status = r.error ?? r.status ?? (r.duration == null ? "pending" : "no response");
        const extra = [r.type, r.mime, r.cached && "cached", r.duration != null && `${r.duration} ms`]
          .filter(Boolean)
          .join(", ");
        return `#${r.id} ${r.method} ${status} ${r.url}${extra ? `  (${extra})` : ""}`;
      });
      if (clear && log) {
        log.list.length = 0;
        log.byChannel.clear();
      }
      if (!lines.length) return text("No matching requests recorded (since the agent opened the tab).");
      const hidden = list.length - lines.length;
      return text((hidden > 0 ? `…${hidden} earlier request(s) not shown\n` : "") + lines.join("\n"));
    },

    async read_console_messages({ tabId, onlyErrors, pattern, limit, clear }, call) {
      const { value } = await query(browserFor(call, tabId), "console", { onlyErrors, pattern, limit, clear });
      return text(value);
    },

    async javascript_tool({ text: code, tabId }, call) {
      const { value } = await query(browserFor(call, tabId), "eval", { code });
      return text(value);
    },

    async react({ tabId, ref, ...options }, call) {
      const browser = browserFor(call, tabId);
      if (options.action === "inspect" && !ref) throw new Error("React inspect requires an element ref.");
      const context = permissionContext(browser);
      const document = readContext(browser);
      const frames = ref ? [frameOf(browser, ref)] : framesOf(browser);
      const results = [];
      for (const frame of frames) {
        call.check();
        assertSiteAccess(browser);
        try {
          const { value } = await query(browser, "react", { ...options, ref }, 30000, frame);
          results.push({ frame: frame.id, ...value });
        } catch (error) {
          call.check();
          if (error instanceof DialogOpen || error instanceof Stopped || ref || frame === browser.browsingContext)
            throw error;
          results.push({ frame: frame.id, error: String(error.message || error), inspected: false });
        }
        if (
          !samePermissionContext(context, permissionContext(browser)) ||
          !sameReadContext(document, readContext(browser))
        )
          throw new Error("Page or permissions changed during React inspection; retry.");
      }
      return text({ frames: results, untrusted: true });
    },

    async accessibility({ tabId, ref, ...options }, call) {
      const browser = browserFor(call, tabId);
      const context = permissionContext(browser);
      const document = readContext(browser);
      const deadline = Date.now() + 45000;
      const frames = ref ? [frameOf(browser, ref)] : framesOf(browser);
      const results = [];
      for (const frame of frames) {
        call.check();
        assertSiteAccess(browser);
        if (Date.now() >= deadline) {
          results.push({ frame: frame.id, scanned: false, error: "Total scan time budget exhausted." });
          continue;
        }
        try {
          const { value } = await query(
            browser,
            "axe",
            { ...options, ref, timeout_ms: Math.min(20000, deadline - Date.now()) },
            Math.min(25000, deadline - Date.now() + 2000),
            frame,
          );
          results.push({ frame: frame.id, ...value });
        } catch (error) {
          call.check();
          if (error instanceof DialogOpen || error instanceof Stopped || ref || frame === browser.browsingContext)
            throw error;
          results.push({ frame: frame.id, error: String(error.message || error), scanned: false });
        }
        if (
          !samePermissionContext(context, permissionContext(browser)) ||
          !sameReadContext(document, readContext(browser))
        )
          throw new Error("Page or permissions changed during accessibility scan; retry.");
      }
      return text({
        frames: results,
        untrusted: true,
        coverage: ref
          ? "Referenced subtree in its frame; nested frames are not scanned."
          : "Each accessible frame scanned independently; cross-frame relationships are not evaluated.",
      });
    },
  };
}
