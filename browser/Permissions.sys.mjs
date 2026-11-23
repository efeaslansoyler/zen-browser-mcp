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

  // why: The activity log is kept on disk, so it gets the description without typed values.
  async function describeWrite(tool, args, browser, { values = true } = {}) {
    const target = async () => {
      // why: Nobody should be asked about a coordinate that can't be placed, so its error goes to the agent.
      const point = args.ref || !args.coordinate ? null : ctx.toPagePoint(browser, args.coordinate, args.screenshot);
      try {
        if (args.ref) return (await ctx.queryRef(browser, "describe", { ref: ctx.longRef(args.ref) })).value;
        if (point) {
          const inner = await ctx.deepest(browser, ...point);
          return (await ctx.query(browser, "describe", { x: inner.x, y: inner.y }, 30000, inner.frame)).value;
        }
      } catch (e) {
        if (e instanceof DialogOpen || e instanceof Stopped) throw e;
      }
      return args.ref ?? L("an element", "bir öğe");
    };
    const quote = (t, n = 80) => `"${String(t).length > n ? String(t).slice(0, n - 1) + "…" : t}"`;
    const typed = (t) => (values ? quote(t) : '"…"');
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
        if (args.action === "computer") {
          const what = await describeWrite(
            "computer",
            { ...args, action: args.computerAction, ref: undefined, coordinate: undefined },
            browser,
            { values },
          );
          const where = args.ref ?? (args.coordinate ? `(${args.coordinate.join(", ")})` : null);
          return what && `${L("in extension", "eklentide")} ${args.extensionId}${where ? ` ${where}` : ""}: ${what}`;
        }
        if (args.action === "form_input")
          return L(
            `fill extension ${args.extensionId} field ${args.ref} with ${typed(args.value ?? "")}`,
            `${args.extensionId} eklentisinin ${args.ref} alanına ${typed(args.value ?? "")} yazmak`,
          );
        return null;
      case "cookies":
        if (args.action !== "set" && args.action !== "delete") return null;
        try {
          const uri = args.url === undefined ? browser.currentURI : Services.io.newURI(args.url);
          return `${args.action} a host-only cookie for ${uri.host}`;
        } catch {
          return `${args.action} a host-only cookie`;
        }
      case "network_capture":
        if (args.action === "start" && args.response_projection)
          return "start a HAR capture with selected response fields from one endpoint";
        return null;
      case "computer": {
        if (args.action === "hover" && ctx.holdsButtons(browser))
          return L("move a held mouse button", "basılı fare düğmesiyle hareket etmek");
        const verb = actionVerb(args.action);
        if (!verb) return null;
        if (args.action === "type") return L(`type ${typed(args.text ?? "")}`, `${typed(args.text ?? "")} yazmak`);
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
            : L(`type ${typed(args.value)}`, `${typed(args.value)} yazmak`)
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

  const OWN_PROMPT = new Set([
    "clipboard.read",
    "clipboard.write",
    "clipboard.copy",
    "clipboard.paste",
    "browser_settings.change",
    "extensions.switch_tab",
    "request_tab",
    "recipes.delete",
    "request_tab.agent_tab",
  ]);

  const deniedMessage = (key) =>
    `Your permission settings don't allow this (${key}); nothing was done. Don't try to reach the same result another way: tell the user what you need.`;

  function gate(key) {
    const rule = ctx.rule(key);
    if (rule === "deny") throw new Error(deniedMessage(key));
    return rule === "allow";
  }

  const keyList = (text = "") =>
    String(text)
      .toLowerCase()
      .split(/[\s+]+/);
  const pressesEnter = (text) => keyList(text).some((k) => ["enter", "return", "kp_enter"].includes(k));
  const pressesSpace = (text) => keyList(text).includes("space") || text === " ";

  async function riskOf(tool, args, browser) {
    const ask = async (data, frame) => {
      try {
        return (await ctx.query(browser, "risk", data, 30000, frame)).value ?? {};
      } catch (e) {
        if (e instanceof DialogOpen || e instanceof Stopped) throw e;
        return {};
      }
    };
    const at = async (coordinate = args.coordinate, ref = args.ref) => {
      if (ref) return ask({ ref: ctx.longRef(ref) }, ctx.frameOf(browser, ref));
      if (!coordinate) return {};
      const [x, y] = ctx.toPagePoint(browser, coordinate, args.screenshot);
      const inner = await ctx.deepest(browser, x, y);
      return ask({ x: inner.x, y: inner.y }, inner.frame);
    };
    const focused = async (keys) =>
      ask({ focused: true, ...keys }, ctx.heldFrame(browser) || (await ctx.focusedFrame(browser)));
    if (tool === "form_input") return args.ref ? { secret: (await at()).secret } : {};
    if (tool !== "computer") return {};
    switch (args.action) {
      case "left_click":
      case "double_click":
      case "triple_click":
      case "mouse_down":
        return { submit: (await at()).submit };
      // why: A drag that starts and ends on a submit button clicks it.
      case "left_click_drag":
        return { submit: (await at(args.start_coordinate, null)).submit || (await at()).submit };
      case "type":
        return focused({ enter: /[\r\n]/.test(args.text ?? "") });
      case "key":
      case "key_down": {
        // why: Earlier keys in a sequence can move focus onto a submit control before Enter or Space lands.
        const later = String(args.text ?? "")
          .trim()
          .split(/\s+/)
          .slice(1);
        if (later.some((combo) => pressesEnter(combo) || pressesSpace(combo))) return { submit: true };
        return focused({ enter: pressesEnter(args.text), space: pressesSpace(args.text) });
      }
    }
    return {};
  }

  async function callRule(tool, args, browser) {
    const key = ctx.policy.operationOf(tool, args);
    if (!key || OWN_PROMPT.has(key)) return { key, rule: "allow" };
    const { strictest } = ctx.policy;
    let rule = ctx.rule(key);
    if (rule === "deny" || !browser) return { key, rule };
    const submit = ctx.rule("submit");
    const secret = ctx.rule("secret_field");
    // why: Skip the risk query when submit and secret rules would not change the decision.
    if (strictest(rule, submit, secret) === rule) return { key, rule };
    const risk = await riskOf(tool, args, browser);
    let because = key;
    if (risk.submit && strictest(rule, submit) !== rule) [rule, because] = [submit, "submit"];
    if (risk.secret && strictest(rule, secret) !== rule) [rule, because] = [secret, "secret_field"];
    return { key: because, rule };
  }

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
      ownerVersion: ctx.access.version(browser.browserId),
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

  // why: Navigation or policy updates while awaiting an answer must invalidate approval for the old request.
  async function requirePermission(call, browser, steps, promptBudget = { asked: 0 }) {
    while (promptBudget.asked < 3) {
      call.check();
      ctx.assertSiteAccess(browser);
      const context = permissionContext(browser);
      const lines = [];
      const reasons = new Set();
      const approved = new Map();
      for (const { tool, args } of steps) {
        const { key, rule } = await callRule(tool, args, browser);
        if (rule === "deny") throw new Error(deniedMessage(key));
        if (rule !== "ask") continue;
        approved.set(args, key);
        if (key === "submit") reasons.add(L("submits a form", "form gönderir"));
        if (key === "secret_field") reasons.add(L("secret field", "gizli alan"));
        lines.push((await describeWrite(tool, args, browser)) ?? ctx.describeAction(tool, args, browser, false));
      }
      if (!samePermissionContext(context, permissionContext(browser))) continue;
      if (!lines.length) return { context, approved };
      const host = ctx.hostOf(browser);
      const agent = call.agent.name;
      const why = reasons.size ? ` (${[...reasons].join(", ")})` : "";
      const message =
        lines.length === 1
          ? L(`${agent} wants to: ${lines[0]}`, `${agent} şunu yapmak istiyor: ${lines[0]}`)
          : L(`${agent} wants to:`, `${agent} şunları yapmak istiyor:`) + `\n${lines.map((l) => `• ${l}`).join("\n")}`;
      promptBudget.asked++;
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
      if (samePermissionContext(context, permissionContext(browser))) return { context, approved };
    }
    throw new Error("The page kept changing while permission was asked; nothing more was done. Read it again.");
  }

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
