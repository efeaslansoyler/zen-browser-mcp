// The tab context menu: "Take back from agent", "Give/transfer to session…" and "Agent
// settings" (global mode, this site's rule and, in Zen, the workspace for agent tabs). UI only;
// the work goes through env:
//   env.L(en, tr), env.mark: the mark attribute,
//   env.sessions(): connected sessions, env.ownerName(tab), env.menuAgent(),
//   env.paintIcon(item, agent): the agent's icon and color,
//   env.give(tab, sessionId), env.takeBack(tab),
//   env.readConfig(), env.writeConfig(patch), env.setMode(mode), env.hostOf(browser), env.ruleFor(host),
//   env.workspaces(win): Zen workspace names (null outside Zen),
//   env.history(tabId): the latest agent actions in that tab (lines), env.openHistory(win): the full history page
const MENU_ID = "zen-mcp-context-give";

export class TabMenu {
  constructor(env) {
    this.env = env;
    this.builders = new WeakMap(); // win → build(tabs)
    this.cleanups = new Set();
  }

  // Builds the menu for given tabs (tests and scripts; the native contextTab may change).
  prepare(win, tabs) {
    const build = this.builders.get(win);
    if (!build) throw new Error("The session handoff menu is not attached to this window.");
    if (tabs.some((tab) => tab.ownerDocument.defaultView !== win))
      throw new Error("Menu tabs must belong to the same window.");
    build(tabs);
  }

  destroy() {
    for (const cleanup of this.cleanups) {
      try {
        cleanup();
      } catch {}
    }
    this.cleanups.clear();
  }

  attach(win) {
    const { L, mark: MARK } = this.env;
    const env = this.env;
    const menu = win.document.getElementById("tabContextMenu");
    if (!menu || win.document.getElementById(MENU_ID)) return;
    const item = win.document.createXULElement("menuitem");
    item.id = MENU_ID;
    item.className = "menuitem-iconic";
    env.paintIcon(item, env.menuAgent());
    // at the end of Firefox's AI section, otherwise at the end of the menu
    const anchor = win.document.getElementById("context_aiSeparator");
    menu.insertBefore(item, anchor?.parentNode === menu ? anchor : null);
    const permissionsMenu = win.document.createXULElement("menu");
    permissionsMenu.id = MENU_ID + "-permissions";
    permissionsMenu.setAttribute("label", L("Agent settings", "Ajan ayarları"));
    const permissionsPopup = win.document.createXULElement("menupopup");
    permissionsMenu.append(permissionsPopup);
    menu.insertBefore(permissionsMenu, item.nextSibling);
    const give = win.document.createXULElement("menu");
    give.className = "menu-iconic";
    const targets = win.document.createXULElement("menupopup");
    give.append(targets);
    menu.insertBefore(give, permissionsMenu);
    const historyMenu = win.document.createXULElement("menu");
    historyMenu.id = MENU_ID + "-history";
    historyMenu.setAttribute("label", L("Agent history", "Ajan geçmişi"));
    const historyPopup = win.document.createXULElement("menupopup");
    historyMenu.append(historyPopup);
    menu.insertBefore(historyMenu, permissionsMenu.nextSibling);
    // filled when the submenu opens: the log file is read only when needed
    const onHistoryShowing = async (event) => {
      if (event.target !== historyPopup) return;
      const tab = shownTabs[0];
      historyPopup.replaceChildren();
      const line = (label, disabled = true) => {
        const item = win.document.createXULElement("menuitem");
        item.setAttribute("label", label);
        if (disabled) item.setAttribute("disabled", "true");
        historyPopup.append(item);
        return item;
      };
      const lines = tab && shownTabs.length === 1 ? await env.history(tab.linkedBrowser.browserId).catch(() => []) : [];
      if (!lines.length) line(L("No agent actions on this tab", "Bu sekmede ajan işlemi yok"));
      for (const text of lines) line(text);
      historyPopup.append(win.document.createXULElement("menuseparator"));
      line(L("Full history…", "Tüm geçmiş…"), false).addEventListener("command", () => env.openHistory(win));
    };
    historyPopup.addEventListener("popupshowing", onHistoryShowing);
    let shownTabs = [];
    const build = (inputTabs) => {
      const tabs = (shownTabs = inputTabs.filter((t) => t.isConnected && !t.hasAttribute("zen-empty-tab")));
      item.hidden = !tabs.some((t) => t.hasAttribute(MARK));
      give.hidden = !tabs.length;
      give.setAttribute(
        "label",
        tabs.some((t) => t.hasAttribute(MARK))
          ? L("Transfer to session…", "Oturuma devret…")
          : L("Give to session…", "Oturuma ver…"),
      );
      targets.replaceChildren();
      let targetCount = 0;
      for (const target of env.sessions()) {
        if (target.disconnected) continue;
        targetCount++;
        const choice = win.document.createXULElement("menuitem");
        choice.className = "menuitem-iconic";
        choice.setAttribute("label", target.name);
        choice.setAttribute("data-zen-session", target.id);
        env.paintIcon(choice, target.agent);
        choice.addEventListener("command", () => {
          for (const tab of tabs) if (tab.isConnected) env.give(tab, target.id);
        });
        targets.append(choice);
      }
      if (!targetCount) {
        const empty = win.document.createXULElement("menuitem");
        empty.setAttribute("label", L("No browser session connected", "Bağlı tarayıcı oturumu yok"));
        empty.setAttribute("disabled", "true");
        targets.append(empty);
      }
      const tab = tabs[0];
      env.paintIcon(
        item,
        tab?.hasAttribute(MARK)
          ? { id: tab.getAttribute("data-zen-agent"), name: tab.getAttribute("zen-mcp-agent-name") }
          : env.menuAgent(),
      );
      const owner = tab && env.ownerName(tab);
      item.setAttribute("label", L("Take back from agent", "Ajandan geri al") + (owner ? ` · ${owner}` : ""));
      permissionsPopup.replaceChildren();
      const heading = (label) => {
        const item = win.document.createXULElement("menuitem");
        item.setAttribute("label", label);
        item.setAttribute("disabled", "true");
        permissionsPopup.append(item);
        return item;
      };
      const config = env.readConfig();
      heading(L("General mode · all sites", "Genel mod · tüm siteler"));
      for (const [mode, label] of [
        ["auto", L("Automatic", "Otomatik")],
        ["ask", L("Ask before every action", "Her işlemde sor")],
      ]) {
        const choice = win.document.createXULElement("menuitem");
        choice.setAttribute("type", "radio");
        choice.setAttribute("name", "zen-mcp-general-mode");
        choice.setAttribute("data-zen-mode", mode);
        choice.setAttribute("label", label);
        if (config.mode === mode) choice.setAttribute("checked", "true");
        choice.addEventListener("command", () => {
          env.writeConfig({ mode });
          env.setMode(mode);
        });
        permissionsPopup.append(choice);
      }
      permissionsPopup.append(win.document.createXULElement("menuseparator"));
      const host = tab && env.hostOf(tab.linkedBrowser);
      const hasSite = tabs.length === 1 && !!host;
      let siteLabel = hasSite
        ? L(`This site · ${host}`, `Bu site · ${host}`)
        : L("This site · select one web tab", "Bu site · tek bir web sekmesi seç");
      const effectiveRule = env.ruleFor(host);
      const ownRule = hasSite ? config.sites[host] || "default" : "default";
      if (hasSite && ownRule !== effectiveRule) {
        siteLabel +=
          " · " +
          (effectiveRule === "block"
            ? L("blocked by parent domain", "üst alan adı engelliyor")
            : L("parent domain requires approval", "üst alan adı onay istiyor"));
      }
      heading(siteLabel);
      for (const [rule, label] of [
        ["default", L("Use general setting", "Genel ayarı kullan")],
        ["ask", L("Ask before every action", "Her işlemde sor")],
        ["block", L("Block agent access", "Ajan erişimini engelle")],
      ]) {
        const choice = win.document.createXULElement("menuitem");
        choice.setAttribute("type", "radio");
        choice.setAttribute("name", "zen-mcp-site-rule");
        choice.setAttribute("data-zen-site-rule", rule);
        if (!hasSite) choice.setAttribute("disabled", "true");
        choice.setAttribute("label", label);
        if (hasSite && ownRule === rule) choice.setAttribute("checked", "true");
        choice.addEventListener("command", () => {
          const sites = { ...env.readConfig().sites };
          if (rule === "default") delete sites[host];
          else sites[host] = rule;
          env.writeConfig({ sites });
        });
        permissionsPopup.append(choice);
      }
      const spaces = env.workspaces(win);
      if (!spaces) return;
      permissionsPopup.append(win.document.createXULElement("menuseparator"));
      heading(L("New agent tabs open in", "Yeni ajan sekmeleri şurada açılır"));
      const current = config.workspace ?? "";
      const AGENTS = L("Agents", "Ajanlar");
      const options = [["", L("The space you're in", "Bulunduğun alan")], ...spaces.map((name) => [name, name])];
      if (!spaces.includes(AGENTS)) options.push([AGENTS, L(`New space: ${AGENTS}`, `Yeni alan: ${AGENTS}`)]);
      if (current && !spaces.includes(current) && current !== AGENTS)
        options.push([current, L(`New space: ${current}`, `Yeni alan: ${current}`)]);
      for (const [value, label] of options) {
        const choice = win.document.createXULElement("menuitem");
        choice.setAttribute("type", "radio");
        choice.setAttribute("name", "zen-mcp-workspace");
        choice.setAttribute("data-zen-workspace", value);
        choice.setAttribute("label", label);
        if (value === current) choice.setAttribute("checked", "true");
        choice.addEventListener("command", () => env.writeConfig({ workspace: value || undefined }));
        permissionsPopup.append(choice);
      }
    };
    this.builders.set(win, build);
    // the tab the menu opened on; all selected tabs if it is part of a multi-selection
    const contextTabs = () => {
      const tab = win.TabContextMenu?.contextTab;
      if (!tab) return [];
      return tab.multiselected ? win.gBrowser.selectedTabs : [tab];
    };
    const onShowing = (event) => {
      if (event.target === menu) build(contextTabs());
    };
    const onCommand = () => {
      for (const tab of shownTabs) if (tab.isConnected && tab.hasAttribute(MARK)) env.takeBack(tab);
    };
    menu.addEventListener("popupshowing", onShowing);
    item.addEventListener("command", onCommand);
    this.cleanups.add(() => {
      this.builders.delete(win);
      menu.removeEventListener("popupshowing", onShowing);
      item.remove();
      give.remove();
      permissionsMenu.remove();
      historyMenu.remove();
    });
  }
}
