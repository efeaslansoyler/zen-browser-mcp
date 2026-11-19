// Explicit per-operation consent, independent of site/auto/batch approvals.
export class ClipboardAccess {
  constructor(env) {
    this.env = env;
  }
  async run(args) {
    if (!["read", "write", "copy", "paste", "cut"].includes(args.action)) throw new Error("Unknown clipboard action.");
    if (args.action === "write" && (typeof args.text !== "string" || args.text.length > 1000000))
      throw new Error("Clipboard write requires text (at most 1,000,000 characters).");
    const max = args.max_chars ?? 20000;
    if (!Number.isInteger(max) || max < 1 || max > 100000)
      throw new Error("max_chars must be an integer from 1 to 100000.");
    this.env.check();
    const context = await this.env.prepare(args);
    if (!(await this.env.ask(args, context)))
      throw new Error("The user denied or did not answer the system clipboard request; nothing was done.");
    this.env.check(context);
    if (args.action === "read") {
      const value = await this.env.read();
      this.env.check(context);
      return {
        source: "system clipboard",
        untrusted: true,
        text: value.slice(0, max),
        characters: value.length,
        truncated: value.length > max,
      };
    }
    if (args.action === "write") {
      await this.env.write(args.text);
      return { written: true, characters: args.text.length };
    }
    await this.env.command(args, context);
    return { [args.action === "paste" ? "pasted" : args.action === "cut" ? "cut" : "copied"]: true };
  }
}

export function clipboardShortcut({ key, mods }) {
  const name = key.toLowerCase();
  if ((mods.ctrlKey || mods.metaKey) && !mods.altKey) {
    if (!mods.shiftKey && (name === "c" || name === "key_insert")) return "copy";
    if (name === "v") return "paste";
    if (!mods.shiftKey && name === "x") return "cut";
  }
  if (mods.shiftKey && !mods.ctrlKey && !mods.metaKey && !mods.altKey) {
    if (name === "key_insert") return "paste";
    if (name === "key_delete") return "cut";
  }
  return null;
}

// The system clipboard for agents: every operation needs the user's approval on the island,
// even in auto mode, and the target must not change while the prompt is open.
export function systemClipboard(ctx) {
  function readClipboardText() {
    const clipboard = Cc["@mozilla.org/widget/clipboard;1"].getService(Ci.nsIClipboard);
    if (!clipboard.hasDataMatchingFlavors(["text/plain"], clipboard.kGlobalClipboard)) return "";
    const transfer = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
    transfer.init(null);
    transfer.addDataFlavor("text/plain");
    clipboard.getData(transfer, clipboard.kGlobalClipboard);
    const value = {};
    transfer.getTransferData("text/plain", value);
    return value.value.QueryInterface(Ci.nsISupportsString).data;
  }

  async function performClipboard(browser, args) {
    const { L } = ctx;
    const source = ctx.controlledSource(browser);
    const call = ctx.callOf(browser);
    const check = (context) => {
      call.check();
      ctx.ownership.check(source.browserId, call.session);
      ctx.assertSiteAccess(browser);
      if (
        context &&
        (!ctx.samePermissionContext(context.policy, ctx.permissionContext(source)) ||
          browser.browsingContext.currentWindowGlobal !== context.document)
      ) {
        throw new Error(
          "The clipboard target or permission settings changed while awaiting approval; nothing was done.",
        );
      }
    };
    const surface = call.extensionSurface;
    const panel =
      surface?.browser === browser
        ? ctx.extensionPanels.get(source, call.session, surface.tabId, surface.extensionId).popup.panel
        : null;
    const noAutoHide = panel?.getAttribute("noautohide");
    if (panel) panel.setAttribute("noautohide", "true");
    const access = new ClipboardAccess({
      check,
      prepare: async (input) => {
        const context = {
          policy: ctx.permissionContext(source),
          document: browser.browsingContext.currentWindowGlobal,
        };
        if (["copy", "paste", "cut"].includes(input.action)) {
          context.frame = input.ref ? ctx.frameOf(browser, input.ref) : await ctx.focusedFrame(browser);
          context.frameDocument = context.frame.currentWindowGlobal;
          context.target = (
            await ctx.query(
              browser,
              "clipboard_prepare",
              { action: input.action, ref: input.ref && ctx.longRef(input.ref) },
              5000,
              context.frame,
            )
          ).value;
        }
        check(context);
        return context;
      },
      ask: async (input) => {
        if (ctx.gate(ctx.policy.operationOf("clipboard", input))) return true;
        const what = {
          read: L("read text from your system clipboard", "sistem panondaki metni okumak"),
          write: L(
            `replace your system clipboard with ${input.text?.length ?? 0} characters`,
            `sistem panonun üzerine ${input.text?.length ?? 0} karakter yazmak`,
          ),
          copy: L("copy the target selection to your system clipboard", "hedefteki seçimi sistem panona kopyalamak"),
          paste: L("paste your system clipboard into the target", "sistem panondakini hedefe yapıştırmak"),
          cut: L("cut the target selection to your system clipboard", "hedefteki seçimi kesip sistem panona almak"),
        }[input.action];
        const name = call.agent.name;
        const result = await ctx.askIsland(
          call,
          source,
          L("System clipboard permission", "Sistem panosu izni") +
            ` · ${ctx.hostOf(source) || source.contentTitle || source.currentURI.spec}`,
          L(
            `${name} wants to ${what}. This clipboard is shared with your other applications.`,
            `${name} şunu yapmak istiyor: ${what}. Bu pano diğer uygulamalarınla ortaktır.`,
          ),
          { ok: L("Allow once", "Bir kez izin ver"), cancel: L("Deny", "Verme") },
        );
        return result === "done";
      },
      read: readClipboardText,
      write: (value) => Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(value),
      command: async (input, context) => {
        if (context.frame.currentWindowGlobal !== context.frameDocument)
          throw new Error("The clipboard target frame changed; nothing was done.");
        await ctx.query(
          browser,
          "clipboard_execute",
          { token: context.target.token, action: input.action },
          5000,
          context.frame,
        );
      },
    });
    try {
      return await access.run(args);
    } finally {
      if (panel) {
        if (noAutoHide === null) panel.removeAttribute("noautohide");
        else panel.setAttribute("noautohide", noAutoHide);
      }
    }
  }

  return { performClipboard };
}
