// Input tools: mouse/keyboard/screenshots, forms, file upload, page dialogs, navigation.
// Built last by main.js: helpers are taken from ctx once; changing state (operation, activeSession…) is read from ctx at call time.
export function inputTools(ctx) {
  const {
    MAX_UPLOAD,
    assertSiteAccess,
    browserFor,
    click,
    clipboardShortcut,
    controlledSource,
    describeDialog,
    describeTab,
    focusedFrame,
    guard,
    heldFrame,
    heldModifiers,
    input,
    keyName,
    localFile,
    longRef,
    openDialog,
    operationSleep,
    ownership,
    pressKeys,
    query,
    queryRef,
    releaseInputs,
    rememberInputs,
    screenshot,
    screenshotCache,
    scroll,
    shortRefs,
    target,
    text,
    typeInFocus,
    waitForLoad,
  } = ctx;
  return {
    async navigate({ url, tabId }) {
      const browser = browserFor(tabId);
      releaseInputs(browser);
      const loaded = waitForLoad(browser, 20000, url === "back" || url === "forward" ? null : url);
      if (url === "back") browser.goBack();
      else if (url === "forward") browser.goForward();
      else {
        browser.fixupAndLoadURIString(url, {
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        });
      }
      await guard(loaded);
      assertSiteAccess(browser);
      const tab = browser.ownerDocument.defaultView.gBrowser.getTabForBrowser(browser);
      return text(describeTab(tab));
    },

    async computer(args) {
      const browser = browserFor(args.tabId);
      const need = (key) => {
        if (args[key] == null) throw new Error(`${args.action} needs ${key}.`);
        return args[key];
      };
      switch (args.action) {
        case "screenshot": {
          let shot, labels;
          try {
            if (args.annotate) labels = (await query(browser, "annotate", { enabled: true })).value;
            shot = await screenshot(browser, args.scale);
          } finally {
            if (args.annotate) await query(browser, "annotate", { enabled: false }).catch(() => {});
          }
          if (args.if_changed) {
            const source = controlledSource(browser);
            const context = [
              browser.browsingContext.currentWindowGlobal,
              ownership.version(source.browserId),
              args.scale ?? 1,
              !!args.annotate,
            ];
            if (screenshotCache.unchanged(`${ctx.activeSession}:${browser.browserId}`, context, shot.data)) {
              return text({ unchanged: true, tabId: args.tabId, width: shot.width, height: shot.height });
            }
          }
          // the dialog is drawn in the browser UI, so it isn't in the page image
          const dialog = openDialog(browser);
          return [
            { type: "image", data: shot.data, mimeType: "image/jpeg" },
            {
              type: "text",
              text: `${shot.width}x${shot.height}, tabId ${args.tabId}${labels ? `\nAnnotated refs: ${shortRefs(labels.join(", "))}` : ""}${dialog ? `\n${describeDialog(dialog)}` : ""}`,
            },
          ];
        }
        case "left_click":
          await click(browser, await target(browser, { ...args, forClick: true }), {
            ...args,
            ref: args.ref,
            modifiers: args.text,
          });
          break;
        case "right_click":
          await click(browser, await target(browser, { ...args, forClick: true }), {
            ref: args.ref,
            button: 2,
            modifiers: args.text,
          });
          break;
        case "double_click":
          await click(browser, await target(browser, { ...args, forClick: true }), {
            ref: args.ref,
            count: 2,
            modifiers: args.text,
          });
          break;
        case "triple_click":
          await click(browser, await target(browser, { ...args, forClick: true }), {
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
          await input(browser, {
            ...args,
            kind: "mouse_down",
            x,
            y,
            ref: args.ref && longRef(args.ref),
            button: { left: 0, middle: 1, right: 2 }[args.button || "left"],
          });
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
          await operationSleep(Math.min(need("duration"), 30) * 1000);
          break;
        default:
          throw new Error(`Unsupported action: ${args.action}`);
      }
      // give the page a moment to handle the events
      await operationSleep(100);
      return text(`${args.action} done.`);
    },

    async form_input({ tabId, ref, value }) {
      const { value: result } = await queryRef(browserFor(tabId), "form_input", { ref: longRef(ref), value });
      return text(result);
    },

    async file_upload({ tabId, ref, paths }) {
      const browser = browserFor(tabId);
      const mime = Cc["@mozilla.org/mime;1"].getService(Ci.nsIMIMEService);
      // the browser window's IOUtils (the autoconfig scope has none)
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
      const { value } = await queryRef(browser, "file_upload", { ref: longRef(ref), files }, 60000);
      return text(value);
    },

    async handle_dialog({ tabId, accept, text: answer }) {
      const browser = browserFor(tabId);
      const win = openDialog(browser);
      if (!win) return text("No dialog is open.");
      const { promptType, text: message } = win.Dialog.args;
      if (answer != null && accept) {
        const box = promptType === "promptPassword" ? win.Dialog.ui.password1Textbox : win.Dialog.ui.loginTextbox;
        box.value = String(answer);
      }
      const dialog = win.document.querySelector("dialog");
      if (accept) dialog.acceptDialog();
      else dialog.cancelDialog();
      await operationSleep(200);
      return text(
        `${promptType} "${message}" ${accept ? "kabul edildi" : "iptal edildi"}${answer != null && accept ? ` (metin: "${answer}")` : ""}.`,
      );
    },
  };
}
