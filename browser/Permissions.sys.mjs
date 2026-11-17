// Permissions: in ask mode, or on a site with an "ask" rule, actions are approved on the island
// first. An approval belongs to one document, origin, settings and ownership version; if any of
// them changes, the user is asked again. Changing state (operation, activeAgent) is read from ctx.
export function permissions(ctx) {
  const { L, DialogOpen, Stopped } = ctx;

  const actionVerb = action => ({
    left_click: L("click", "tıklamak"), right_click: L("right-click", "sağ tıklamak"),
    double_click: L("double-click", "çift tıklamak"), triple_click: L("triple-click", "üç kez tıklamak"),
    key_down: L("hold key", "tuşu basılı tutmak"), key_up: L("release key", "tuşu bırakmak"),
    mouse_move: L("move mouse", "fareyi hareket ettirmek"),
    mouse_down: L("hold mouse button", "fare düğmesini basılı tutmak"), mouse_up: L("release mouse button", "fare düğmesini bırakmak"),
    left_click_drag: L("drag", "sürüklemek"), type: L("type", "yazmak"), key: L("press keys", "tuşa basmak"),
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
        return L("inspect React components" + (args.include_props ? " and props" : ""), "React bileşenlerini" + (args.include_props ? " ve props verilerini" : "") + " okumak");
      case "accessibility":
        return L("run local axe accessibility checks", "yerel axe erişilebilirlik denetimi çalıştırmak");
      case "extensions":
        if (args.action === "open") return L(`open extension ${args.extensionId} for this tab`, `bu sekme için ${args.extensionId} eklentisini açmak`);
        if (args.action === "computer") return describeWrite("computer", { ...args, action: args.computerAction, ref: undefined, coordinate: undefined }, browser);
        if (args.action === "form_input") return L(`fill extension field ${args.ref}`, `eklenti alanını doldurmak: ${args.ref}`);
        return null;
      case "computer": {
        if (args.action === "hover" && ctx.holdsButtons(browser)) return L("move a held mouse button", "basılı fare düğmesiyle hareket etmek");
        const verb = actionVerb(args.action);
        if (!verb) return null;
        if (args.action === "type") return L(`type ${quote(args.text ?? "")}`, `${quote(args.text ?? "")} yazmak`);
        if (["key", "key_down", "key_up"].includes(args.action)) return L(`press ${args.text}`, `${args.text} tuşuna basmak`);
        return `${await target()}: ${verb}`;
      }
      case "form_input":
        return `${await target()}: ${typeof args.value === "boolean"
          ? (args.value ? L("check", "işaretlemek") : L("uncheck", "işareti kaldırmak"))
          : L(`type ${quote(args.value)}`, `${quote(args.value)} yazmak`)}`;
      case "file_upload":
        return `${await target()}: ${L("upload", "dosya yüklemek")} (${args.paths?.map(p => p.split("/").pop()).join(", ")})`;
      case "javascript_tool":
        return `${L("run code on the page", "sayfada kod çalıştırmak")}: ${quote(args.text ?? "", 120)}`;
      case "handle_dialog":
        return args.accept ? L("accept the page's dialog", "sayfanın diyaloğunu kabul etmek") : L("dismiss the page's dialog", "sayfanın diyaloğunu iptal etmek");
      case "navigate":
        if (args.url === "back") return L("go back", "geri gitmek");
        if (args.url === "forward") return L("go forward", "ileri gitmek");
        return L(`go to ${quote(args.url, 100)}`, `${quote(args.url, 100)} adresine gitmek`);
    }
    return null;
  }

  // Does this call need permission: every action in ask mode; on an "ask" site, all but navigation.
  function needsPermission(tool, browser) {
    if (ctx.readConfig().mode === "ask") return true;
    return tool !== "navigate" && ctx.isSensitive(ctx.hostOf(browser));
  }

  // Approval belongs to one document, origin and permission configuration.
  // A redirect, reload or settings change invalidates it, even on the same host.
  function permissionContext(browser) {
    const settings = ctx.readConfig();
    return {
      document: browser.browsingContext?.currentWindowGlobal,
      origin: browser.currentURI?.prePath || browser.currentURI?.spec,
      policy: JSON.stringify([settings.mode, settings.sites]),
      ownerVersion: ctx.ownership.version(browser.browserId),
    };
  }

  function samePermissionContext(a, b) {
    return a?.document === b.document && a?.origin === b.origin && a?.policy === b.policy && a?.ownerVersion === b.ownerVersion;
  }

  // Rebuild the request if the page changes while describing actions or awaiting
  // the user's answer. An answer for the old page must never authorize the new one.
  async function requirePermission(browser, steps) {
    for (;;) {
      ctx.operation?.check();
      ctx.assertSiteAccess(browser);
      const context = permissionContext(browser);
      const lines = [];
      for (const { tool, args } of steps) {
        if (!needsPermission(tool, browser)) continue;
        const what = await describeWrite(tool, args, browser);
        if (what) lines.push(what);
      }
      if (!samePermissionContext(context, permissionContext(browser))) continue;
      if (!lines.length) return { context, asked: false };
      const host = ctx.hostOf(browser);
      const agent = ctx.activeAgent.name;
      const why = ctx.isSensitive(host) ? L(" (sensitive site)", " (hassas site)") : "";
      const message = lines.length === 1
        ? L(`${agent} wants to: ${lines[0]}`, `${agent} şunu yapmak istiyor: ${lines[0]}`)
        : L(`${agent} wants to:`, `${agent} şunları yapmak istiyor:`) + `\n${lines.map(l => `• ${l}`).join("\n")}`;
      const result = await ctx.askIsland(browser, `${host ? host + " — " : ""}${L("asks for permission", "izin istiyor")}${why}`, message,
        { ok: L("Allow", "İzin ver"), cancel: L("Deny", "Verme") });
      if (result !== "done") {
        throw new Error(result === "timeout"
          ? "The user did not answer the permission request; nothing was done."
          : "The user denied this action; nothing was done. Ask the user what they want.");
      }
      if (samePermissionContext(context, permissionContext(browser))) return { context, asked: true };
    }
  }

  return { describeWrite, needsPermission, permissionContext, samePermissionContext, requirePermission };
}
