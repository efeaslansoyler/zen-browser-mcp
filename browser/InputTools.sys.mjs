export function inputTools(ctx) {
  const {
    MAX_UPLOAD,
    access,
    assertSiteAccess,
    browserFor,
    click,
    clipboardShortcut,
    controlledSource,
    describeDialog,
    dialogData,
    describeTab,
    focusedFrame,
    guard,
    heldFrame,
    heldModifiers,
    input,
    keyName,
    localFile,
    openDialog,
    operationSleep,
    pressKeys,
    query,
    queryRef,
    releaseInputs,
    rememberInputs,
    screenshot,
    screenshotCache,
    visualBaselines,
    framesOf,
    assertSiteURL,
    scroll,
    target,
    text,
    typeInFocus,
    waitForLoad,
  } = ctx;
  return {
    async navigate({ url, tabId, read, bypass_cache }, call) {
      if (bypass_cache !== undefined && (url !== "reload" || typeof bypass_cache !== "boolean"))
        throw new Error("bypass_cache is a boolean for reload only.");
      if (read != null && read !== "all" && read !== "interactive")
        throw new Error('read must be "all" or "interactive".');
      const browser = browserFor(call, tabId);
      releaseInputs(browser);
      const from = ctx.hostOf(browser);
      const loaded = waitForLoad(browser, 20000, ["back", "forward", "reload"].includes(url) ? null : url);
      if (url === "back") browser.goBack();
      else if (url === "forward") browser.goForward();
      else if (url === "reload") {
        if (bypass_cache) browser.reloadWithFlags(Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE);
        else browser.reload();
      } else {
        browser.fixupAndLoadURIString(url, {
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        });
      }
      await guard(loaded, call);
      assertSiteAccess(browser);
      const tab = browser.ownerDocument.defaultView.gBrowser.getTabForBrowser(browser);
      const result = text(describeTab(tab, call.session));
      // why: An open tab on the same site may hold the user's existing task context.
      const host = ctx.hostOf(browser);
      const sameSite = host !== from && tab.getAttribute(ctx.MARK) !== "user" ? ctx.userTabsOn(host) : [];
      if (sameSite.length)
        result.push(
          ...text({
            userTabsOnThisSite: sameSite,
            note: "The user already has this site open. If the task is about one of these pages, call request_tab on it instead of working here.",
          }),
        );
      if (read != null) {
        // why: Navigation approval does not grant read access to the destination document.
        try {
          result.push(...(await ctx.runTool(call, "read_page", { tabId, filter: read, max_chars: 8000 })));
        } catch (e) {
          if (!(e instanceof ctx.DialogOpen)) throw e;
          ctx.showDialog(e.browser);
          result.push(...text(e.message));
        }
      }
      return result;
    },

    async computer(args, call) {
      const browser = browserFor(call, args.tabId);
      const need = (key) => {
        if (args[key] == null) throw new Error(`${args.action} needs ${key}.`);
        return args[key];
      };
      let hit;
      switch (args.action) {
        case "screenshot": {
          if ((args.since || args.baseline_scope) && !args.diff)
            throw new Error("Visual baseline options require diff.");
          if (args.diff && (args.if_changed || args.annotate))
            throw new Error("Visual diff requires an unannotated screenshot.");
          if (args.full_page && (args.diff || args.if_changed || args.annotate))
            throw new Error("Full-page screenshots require a separate capture.");
          const frames = () => [...framesOf(browser)].map((frame) => frame.currentWindowGlobal);
          const before = args.diff ? frames() : [];
          const geometry = async () => (await query(browser, "capture_geometry", {})).value;
          const position = args.diff ? await geometry() : [];
          let shot, labels;
          try {
            if (args.annotate) labels = (await query(browser, "annotate", { enabled: true })).value;
            shot = await screenshot(browser, args.scale, args.diff, args.full_page);
          } finally {
            if (args.annotate) await query(browser, "annotate", { enabled: false }).catch(() => {});
          }
          if (args.if_changed) {
            const source = controlledSource(browser);
            const context = [
              browser.browsingContext.currentWindowGlobal,
              access.version(source.browserId),
              args.scale ?? 1,
              !!args.annotate,
            ];
            if (screenshotCache.unchanged(`${call.session}:${browser.browserId}`, context, shot.data)) {
              return text({
                unchanged: true,
                tabId: args.tabId,
                screenshot: shot.id,
                width: shot.width,
                height: shot.height,
              });
            }
          }
          let comparison = [];
          let mimeType = "image/jpeg";
          if (args.diff) {
            const currentPosition = await geometry();
            const after = frames();
            if (
              before.length !== after.length ||
              before.some((frame, i) => frame !== after[i]) ||
              position.some((value, i) => value !== currentPosition[i])
            )
              throw new Error("Page changed during capture.");
            call.check();
            const tabId = args.tabId;
            const ticket = access.ticket([tabId], call.session);
            const sites = after.map((frame) => frame?.documentURI?.spec).filter(Boolean);
            const capture = { tabId, origin: ctx.originOf(browser.currentURI?.spec ?? ""), time: Date.now() };
            const dimensions = [shot.width, shot.height, shot.scale, ...position];
            if (!args.since) {
              const baseline = visualBaselines.save({
                session: call.session,
                ticket,
                tabId,
                sites,
                capture,
                dimensions,
                pixels: shot.pixels.data,
                frames: args.baseline_scope === "deploy" ? null : after,
              });
              comparison = text({ baseline, ...capture, width: shot.width, height: shot.height });
            } else {
              const baseline = visualBaselines.get(args.since, call.session);
              let reason;
              if (!baseline) reason = "Baseline unavailable or expired.";
              else {
                try {
                  access.checkTicket(baseline.ticket, call.session);
                  baseline.sites.forEach(assertSiteURL);
                } catch {
                  reason = "Baseline access changed.";
                }
                if (
                  baseline.frames &&
                  (tabId !== baseline.tabId ||
                    baseline.frames.length !== after.length ||
                    baseline.frames.some((frame, i) => frame !== after[i]))
                )
                  reason ??= "Baseline document changed.";
                if (dimensions.some((value, i) => value !== baseline.dimensions[i]))
                  reason ??= "Capture geometry changed.";
              }
              if (reason) comparison = text({ compared: false, reason });
              else {
                const changed = visualBaselines.diff(baseline.pixels, shot.pixels.data);
                comparison = text({
                  baseline: baseline.capture,
                  current: capture,
                  width: shot.width,
                  height: shot.height,
                  changed,
                  ratio: changed / (shot.width * shot.height),
                  ...(changed ? {} : { screenshot: shot.id }),
                });
                if (!changed) return comparison;
                shot.painter.putImageData(shot.pixels, 0, 0);
                shot.data = shot.canvas.toDataURL("image/png").split(",")[1];
                mimeType = "image/png";
              }
            }
          }
          if (args.full_page)
            comparison = text({
              fullPage: true,
              documentWidth: shot.bounds[0],
              documentHeight: shot.bounds[1],
              width: shot.width,
              height: shot.height,
              downsampled: shot.nativeScale < 1,
              note: "Use refs or a viewport screenshot for coordinates.",
            });
          // why: A page capture cannot include a dialog drawn by the browser UI.
          const dialog = openDialog(browser);
          return [
            { type: "image", data: shot.data, mimeType },
            ...comparison,
            {
              type: "text",
              text: `${shot.id ? `${shot.id}: ` : ""}${shot.width}x${shot.height}, tabId ${args.tabId}${labels ? `\nAnnotated refs: ${labels.join(", ")}` : ""}${dialog ? `\n${describeDialog(dialog)}` : ""}`,
            },
          ];
        }
        case "left_click":
          hit = await click(browser, await target(browser, { ...args, forClick: true }), {
            ...args,
            ref: args.ref,
            modifiers: args.text,
          });
          break;
        case "right_click":
          hit = await click(browser, await target(browser, { ...args, forClick: true }), {
            ref: args.ref,
            button: 2,
            modifiers: args.text,
          });
          break;
        case "double_click":
          hit = await click(browser, await target(browser, { ...args, forClick: true }), {
            ref: args.ref,
            count: 2,
            modifiers: args.text,
          });
          break;
        case "triple_click":
          hit = await click(browser, await target(browser, { ...args, forClick: true }), {
            ref: args.ref,
            count: 3,
            modifiers: args.text,
          });
          break;
        case "hover": {
          const [x, y] = await target(browser, args);
          await input(browser, { ...args, kind: "hover", x, y });
          break;
        }
        case "left_click_drag": {
          const [x, y] = await target(browser, args, "start_coordinate");
          await input(browser, { ...args, kind: "drag", x, y, to: await target(browser, args) });
          break;
        }
        case "scroll":
          await scroll(browser, await target(browser, args), need("scroll_direction"), args.scroll_amount);
          break;
        case "scroll_to":
          await target(browser, { ...args, ref: need("ref") });
          break;
        case "type":
          await typeInFocus(browser, { ...args, kind: "text", text: need("text") });
          break;
        case "key_down":
        case "key_up": {
          const key = need("text");
          if (key.includes("+") || /\s/.test(key))
            throw new Error("key_down/key_up accept a single key; hold modifiers separately.");
          if (args.action === "key_down" && clipboardShortcut({ key: keyName(key), mods: heldModifiers(browser) }))
            throw new Error("Use clipboard or key for clipboard shortcuts so consent can be requested.");
          const frame = heldFrame(browser) || (await focusedFrame(browser));
          const result = await query(
            browser,
            "input",
            { kind: args.action, keys: [{ key: keyName(key), mods: {} }], hold_ms: args.hold_ms },
            30000,
            frame,
          );
          rememberInputs(browser, frame, result.value, args.hold_ms);
          break;
        }
        case "mouse_move": {
          const [x, y] = await target(browser, args);
          await input(browser, { ...args, kind: "mouse_move", x, y });
          break;
        }
        case "mouse_down": {
          const [x, y] = await target(browser, { ...args, forClick: true });
          const result = await input(browser, {
            ...args,
            kind: "mouse_down",
            x,
            y,
            ref: args.ref,
            button: { left: 0, middle: 1, right: 2 }[args.button || "left"],
          });
          ({ hit } = result.value);
          break;
        }
        case "mouse_up": {
          const frame = heldFrame(browser) || (await focusedFrame(browser));
          const result = await query(
            browser,
            "input",
            { kind: "mouse_up", button: { left: 0, middle: 1, right: 2 }[args.button || "left"] },
            30000,
            frame,
          );
          rememberInputs(browser, frame, result.value);
          break;
        }
        case "key":
          for (let i = 0; i < (args.repeat || 1); i++) await pressKeys(browser, need("text"));
          break;
        case "wait":
          await operationSleep(Math.min(need("duration"), 30) * 1000, call);
          break;
        default:
          throw new Error(`Unsupported action: ${args.action}`);
      }
      return text(`${args.action} done${hit ? `: ${hit}` : ""}.`);
    },

    async form_input({ tabId, ref, value }, call) {
      const { value: result } = await queryRef(browserFor(call, tabId), "form_input", { ref, value });
      return text(result);
    },

    async file_upload({ tabId, ref, paths }, call) {
      const browser = browserFor(call, tabId);
      const mime = Cc["@mozilla.org/mime;1"].getService(Ci.nsIMIMEService);
      const { IOUtils } = browser.ownerDocument.defaultView;
      let total = 0;
      const files = [];
      for (const path of paths) {
        const file = localFile(path);
        if (!file.exists() || !file.isFile()) throw new Error(`No such file: ${path}`);
        total += file.fileSize;
        if (total > MAX_UPLOAD) throw new Error(`Files exceed ${MAX_UPLOAD / 1048576} MB in total.`);
        let type = "application/octet-stream";
        try {
          type = mime.getTypeFromFile(file);
        } catch {}
        files.push({ name: file.leafName, type, lastModified: file.lastModifiedTime, bytes: await IOUtils.read(path) });
      }
      const { value } = await queryRef(browser, "file_upload", { ref, files }, 60000);
      return text(value);
    },

    async handle_dialog({ tabId, accept, text: answer }, call) {
      const browser = browserFor(call, tabId);
      const win = openDialog(browser);
      if (!win) return text("No dialog is open.");
      const { promptType } = win.Dialog.args;
      const data = dialogData(win);
      if (answer != null && accept) {
        const box = promptType === "promptPassword" ? win.Dialog.ui.password1Textbox : win.Dialog.ui.loginTextbox;
        box.value = String(answer);
      }
      const dialog = win.document.querySelector("dialog");
      if (accept) dialog.acceptDialog();
      else dialog.cancelDialog();
      // why: A dialog outlives its answer (docs/gecko-pitfalls.md, Input and frames).
      for (let waited = 0; openDialog(browser) === win; waited += 50) {
        if (waited >= 5000) throw new Error(`${promptType} is still open after the answer.\n${data}`);
        await operationSleep(50, call);
      }
      return text(
        `${promptType} ${accept ? "accepted" : "dismissed"}${answer != null && accept ? ` (text: "${answer}")` : ""}.\n${data}`,
      );
    },
  };
}
