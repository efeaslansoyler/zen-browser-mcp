// Permissions: each tool call is an operation (Policy.sys.mjs) whose rule in the current mode
// is allow, ask (approved on the island first) or deny. A click that submits a form, or typing
// into a secret field, also takes the submit or secret_field rule, whichever is stricter. An
// approval belongs to one document, origin, settings and ownership version; if any of them
// changes, the user is asked again. The tool call (who asks) is passed in.
export function permissions(ctx) {
  const { L, DialogOpen, Stopped } = ctx;

  const actionVerb = (action) =>
    ({
      left_click: L("click", "tıklamak"),
      right_click: L("right-click", "sağ tıklamak"),
      double_click: L("double-click", "çift tıklamak"),
      triple_click: L("triple-click", "üç kez tıklamak"),
      key_down: L("hold key", "tuşu basılı tutmak"),
      key_up: L("release key", "tuşu bırakmak"),
      mouse_move: L("move mouse", "fareyi hareket ettirmek"),
      mouse_down: L("hold mouse button", "fare düğmesini basılı tutmak"),
      mouse_up: L("release mouse button", "fare düğmesini bırakmak"),
      left_click_drag: L("drag", "sürüklemek"),
      type: L("type", "yazmak"),
      key: L("press keys", "tuşa basmak"),
    })[action];

  // A short description if the action needs permission ('button "Send": click'), otherwise null.
  async function describeWrite(tool, args, browser) {
    const target = async () => {
      try {
        if (args.ref) return (await ctx.queryRef(browser, "describe", { ref: ctx.longRef(args.ref) })).value;
        if (args.coordinate) {
          const [x, y] = ctx.toPagePoint(browser, args.coordinate);
          const inner = await ctx.deepest(browser, x, y);
          return (await ctx.query(browser, "describe", { x: inner.x, y: inner.y }, 30000, inner.frame)).value;
        }
      } catch (e) {
        if (e instanceof DialogOpen || e instanceof Stopped) throw e;
      }
      return args.ref ?? L("an element", "bir öğe");
    };
    const quote = (t, n = 80) => `"${String(t).length > n ? String(t).slice(0, n - 1) + "…" : t}"`;
    switch (tool) {
      case "react":
        return L(
          "inspect React components" + (args.include_props ? " and props" : ""),
          "React bileşenlerini" + (args.include_props ? " ve props verilerini" : "") + " okumak",
        );
      case "accessibility":
        return L("run local axe accessibility checks", "yerel axe erişilebilirlik denetimi çalıştırmak");
      case "extensions":
        if (args.action === "open")
          return L(
            `open extension ${args.extensionId} for this tab`,
            `bu sekme için ${args.extensionId} eklentisini açmak`,
          );
        if (args.action === "computer")
          return describeWrite(
            "computer",
            { ...args, action: args.computerAction, ref: undefined, coordinate: undefined },
            browser,
          );
        if (args.action === "form_input")
          return L(`fill extension field ${args.ref}`, `eklenti alanını doldurmak: ${args.ref}`);
        return null;
      case "computer": {
        if (args.action === "hover" && ctx.holdsButtons(browser))
          return L("move a held mouse button", "basılı fare düğmesiyle hareket etmek");
        const verb = actionVerb(args.action);
        if (!verb) return null;
        if (args.action === "type") return L(`type ${quote(args.text ?? "")}`, `${quote(args.text ?? "")} yazmak`);
        if (["key", "key_down", "key_up"].includes(args.action))
          return L(`press ${args.text}`, `${args.text} tuşuna basmak`);
        return `${await target()}: ${verb}`;
      }
      case "form_input":
        return `${await target()}: ${
          typeof args.value === "boolean"
            ? args.value
              ? L("check", "işaretlemek")
              : L("uncheck", "işareti kaldırmak")
            : L(`type ${quote(args.value)}`, `${quote(args.value)} yazmak`)
        }`;
      case "file_upload":
        return `${await target()}: ${L("upload", "dosya yüklemek")} (${args.paths?.map((p) => p.split("/").pop()).join(", ")})`;
      case "javascript_tool":
        return `${L("run code on the page", "sayfada kod çalıştırmak")}: ${quote(args.text ?? "", 120)}`;
      case "handle_dialog":
        return args.accept
          ? L("accept the page's dialog", "sayfanın diyaloğunu kabul etmek")
          : L("dismiss the page's dialog", "sayfanın diyaloğunu iptal etmek");
      case "navigate":
        if (args.url === "back") return L("go back", "geri gitmek");
        if (args.url === "forward") return L("go forward", "ileri gitmek");
        return L(`go to ${quote(args.url, 100)}`, `${quote(args.url, 100)} adresine gitmek`);
    }
    return null;
  }

  // Operations that ask in their own prompt (clipboard, tab requests…) with gate() below.
  const OWN_PROMPT = new Set([
    "clipboard.read",
    "clipboard.write",
    "clipboard.copy",
    "clipboard.paste",
    "browser_settings.change",
    "extensions.switch_tab",
    "request_tab",
    "recipes.delete",
    "tab_work.handoff",
  ]);

  const deniedMessage = (key) =>
    `Your permission settings don't allow this (${key}); nothing was done. Don't try to reach the same result another way: tell the user what you need.`;

  // For the operations with their own prompt: true to go on without asking, false to ask;
  // throws when the rule denies it.
  function gate(key) {
    const rule = ctx.rule(key);
    if (rule === "deny") throw new Error(deniedMessage(key));
    return rule === "allow";
  }

  // Keys that submit a focused form control or button.
  const keyList = (text = "") =>
    String(text)
      .toLowerCase()
      .split(/[\s+]+/);
  const pressesEnter = (text) => keyList(text).some((k) => ["enter", "return", "kp_enter"].includes(k));
  const pressesSpace = (text) => keyList(text).includes("space") || text === " ";

  // Does this call submit a form or type into a secret field (only asked when it matters).
  async function riskOf(tool, args, browser) {
    const ask = async (data, frame) => {
      try {
        return (await ctx.query(browser, "risk", data, 30000, frame)).value ?? {};
      } catch (e) {
        if (e instanceof DialogOpen || e instanceof Stopped) throw e;
        return {};
      }
    };
    const at = async () => {
      if (args.ref) return ask({ ref: ctx.longRef(args.ref) }, ctx.frameOf(browser, args.ref));
      if (!args.coordinate) return {};
      const [x, y] = ctx.toPagePoint(browser, args.coordinate);
      const inner = await ctx.deepest(browser, x, y);
      return ask({ x: inner.x, y: inner.y }, inner.frame);
    };
    const focused = async (keys) =>
      ask({ focused: true, ...keys }, ctx.heldFrame(browser) || (await ctx.focusedFrame(browser)));
    // filling a field can only be secret, clicking can only submit
    if (tool === "form_input") return args.ref ? { secret: (await at()).secret } : {};
    if (tool !== "computer") return {};
    switch (args.action) {
      case "left_click":
      case "double_click":
      case "triple_click":
      case "mouse_down":
        return { submit: (await at()).submit };
      case "type":
        return focused({ enter: /[\r\n]/.test(args.text ?? "") });
      case "key":
      case "key_down":
        return focused({ enter: pressesEnter(args.text), space: pressesSpace(args.text) });
    }
    return {};
  }

  // The rule of one tool call on this page, and the operation it comes from ("submit" when a
  // click submits a form): { key, rule } with rule "allow", "ask" or "deny".
  async function callRule(tool, args, browser) {
    const key = ctx.policy.operationOf(tool, args);
    if (!key || OWN_PROMPT.has(key)) return { key, rule: "allow" };
    const { strictest } = ctx.policy;
    let rule = ctx.rule(key);
    if (rule === "deny" || !browser) return { key, rule };
    const submit = ctx.rule("submit");
    const secret = ctx.rule("secret_field");
    // look at the page only when a submit or secret rule would make this stricter
    if (strictest(rule, submit, secret) === rule) return { key, rule };
    const risk = await riskOf(tool, args, browser);
    let because = key;
    if (risk.submit && strictest(rule, submit) !== rule) [rule, because] = [submit, "submit"];
    if (risk.secret && strictest(rule, secret) !== rule) [rule, because] = [secret, "secret_field"];
    return { key: because, rule };
  }

  // Approval belongs to one document, origin and permission configuration.
  // A redirect, reload or settings change invalidates it, even on the same host.
  function permissionContext(browser) {
    const settings = ctx.readConfig();
    return {
      document: browser.browsingContext?.currentWindowGlobal,
      origin: browser.currentURI?.prePath || browser.currentURI?.spec,
      policy: JSON.stringify([
        settings.mode,
        settings.sites,
        settings.mode === "custom" ? ctx.readPermissions() : null,
      ]),
      ownerVersion: ctx.ownership.version(browser.browserId),
    };
  }

  function samePermissionContext(a, b) {
    return (
      a?.document === b.document &&
      a?.origin === b.origin &&
      a?.policy === b.policy &&
      a?.ownerVersion === b.ownerVersion
    );
  }

  // Rebuild the request if the page changes while describing actions or awaiting
  // the user's answer. An answer for the old page must never authorize the new one.
  async function requirePermission(call, browser, steps) {
    for (;;) {
      call.check();
      ctx.assertSiteAccess(browser);
      const context = permissionContext(browser);
      const lines = [];
      const reasons = new Set();
      for (const { tool, args } of steps) {
        const { key, rule } = await callRule(tool, args, browser);
        if (rule === "deny") throw new Error(deniedMessage(key));
        if (rule !== "ask") continue;
        if (key === "submit") reasons.add(L("submits a form", "form gönderir"));
        if (key === "secret_field") reasons.add(L("secret field", "gizli alan"));
        lines.push((await describeWrite(tool, args, browser)) ?? ctx.describeAction(tool, args, browser, false));
      }
      if (!samePermissionContext(context, permissionContext(browser))) continue;
      if (!lines.length) return { context, asked: false };
      const host = ctx.hostOf(browser);
      const agent = call.agent.name;
      const why = reasons.size ? ` (${[...reasons].join(", ")})` : "";
      const message =
        lines.length === 1
          ? L(`${agent} wants to: ${lines[0]}`, `${agent} şunu yapmak istiyor: ${lines[0]}`)
          : L(`${agent} wants to:`, `${agent} şunları yapmak istiyor:`) + `\n${lines.map((l) => `• ${l}`).join("\n")}`;
      const result = await ctx.askIsland(
        call,
        browser,
        `${host ? host + " — " : ""}${L("asks for permission", "izin istiyor")}${why}`,
        message,
        { ok: L("Allow", "İzin ver"), cancel: L("Deny", "Verme") },
      );
      if (result !== "done") {
        throw new Error(
          result === "timeout"
            ? "The user did not answer the permission request; nothing was done."
            : "The user denied this action; nothing was done. Ask the user what they want.",
        );
      }
      if (samePermissionContext(context, permissionContext(browser))) return { context, asked: true };
    }
  }

  // A call without a page (tabs_context_mcp, recipes, downloads…): its rule, asked on the island.
  async function requireToolPermission(call, tool, args) {
    const key = ctx.policy.operationOf(tool, args);
    if (!key || OWN_PROMPT.has(key)) return;
    const rule = ctx.rule(key);
    if (rule === "deny") throw new Error(deniedMessage(key));
    if (rule !== "ask") return;
    const agent = call.agent.name;
    const what = ctx.describeAction(tool, args, null, false);
    const result = await ctx.askIsland(
      call,
      null,
      L("asks for permission", "izin istiyor"),
      L(`${agent} wants to: ${what}`, `${agent} şunu yapmak istiyor: ${what}`),
      { ok: L("Allow", "İzin ver"), cancel: L("Deny", "Verme") },
    );
    if (result !== "done")
      throw new Error(
        result === "timeout"
          ? "The user did not answer the permission request; nothing was done."
          : "The user denied this action; nothing was done. Ask the user what they want.",
      );
  }

  return {
    describeWrite,
    gate,
    callRule,
    permissionContext,
    samePermissionContext,
    requirePermission,
    requireToolPermission,
  };
}
