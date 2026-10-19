// Autoconfig yükleyicisi bunu sistem yetkisiyle loadSubScript ile yükler (kapsamda zenMcpDir:
// bu klasörün gerçek yolu, zenMcpName: paketin adı, yollarda kullanılır).
// $XDG_RUNTIME_DIR/<ad>.sock üzerinde bağlantı başına tek satırlık JSON istek
// alır, tek satırlık JSON cevap yazıp kapatır. Fare/klavye olayları Zen'in kendi WebDriver
// kodunun yaptığı gibi parent süreçten EventUtils ile gönderilir: sayfa bunları gerçek
// (isTrusted) girdi olarak görür, remote agent açılmadığı için navigator.webdriver false kalır.
// "reload" isteği bu dosyayı yeniden okur; tarayıcıyı yeniden başlatmak gerekmez.
"use strict";

// Zen'in stderr'i genelde /dev/null'a gider ve autoconfig konsolu hazır olmadan çalışır;
// hatalar $XDG_RUNTIME_DIR/<ad>.log dosyasına da yazılır
const zenMcpApp = typeof zenMcpName === "string" ? zenMcpName : "zen-mcp";
// macOS'ta XDG_RUNTIME_DIR yok; TMPDIR kullanıcıya özel
const zenMcpRuntimeDir = () => Services.env.get("XDG_RUNTIME_DIR") || Services.env.get("TMPDIR") || "/tmp";

function logError(where, e) {
  const msg = `${new Date().toISOString()} ${where}: ${e}\n${e?.stack ?? ""}\n`;
  try {
    const f = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
    f.initWithPath(`${zenMcpRuntimeDir()}/${zenMcpApp}.log`);
    const out = Components.classes["@mozilla.org/network/file-output-stream;1"]
      .createInstance(Components.interfaces.nsIFileOutputStream);
    out.init(f, 0x02 | 0x08 | 0x10, 0o600, 0); // yaz | oluştur | sona ekle
    const bytes = unescape(encodeURIComponent(msg));
    out.write(bytes, bytes.length);
    out.close();
  } catch {}
  Components.utils.reportError(e);
}

(function () {
  try {
    const { classes: Cc, interfaces: Ci, utils: Cu, results: Cr } = Components;
    const { NetUtil } = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");
    // çıplak nsITimer'a referans tutulmazsa GC onu tetiklenmeden toplayabilir
    const { setTimeout, clearTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");

    const dir = zenMcpDir;
    // Arayüz dili: tarayıcı Türkçeyse Türkçe, değilse İngilizce. Claude'a giden mesajlar
    // (hatalar, tool sonuçları) hep İngilizce.
    const L = (en, tr) => (Services.locale.appLocaleAsBCP47.startsWith("tr") ? tr : en);
    const dirURI = Services.io.newFileURI(localFile(dir)).spec.replace(/\/?$/, "/");
    const version = (globalThis.zenMcpVersion = (globalThis.zenMcpVersion || 0) + 1);
    // ZEN_MCP_SOCKET: aynı kullanıcıda ikinci bir tarayıcı (demo, test) ayrı sokette dinlesin
    const socketPath = Services.env.get("ZEN_MCP_SOCKET") || `${zenMcpRuntimeDir()}/${zenMcpApp}.sock`;

    function localFile(path) {
      const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      f.initWithPath(path);
      return f;
    }

    // ---- kurulum: zen.cfg resource://zenmcp/ eşlemesini zaten yaptı (loadSubScript file:// kabul
    // etmiyor); burada tekrarı reload ve elle yükleme için ----

    Services.io
      .getProtocolHandler("resource")
      .QueryInterface(Ci.nsIResProtocolHandler)
      .setSubstitution("zenmcp", Services.io.newURI(dirURI));

    // içerik süreçleri sandbox'ta; actor modülünü okuyabilmeleri için klasörü izinli listeye ekle
    // (varsayılan dalda: prefs.js'e yazılmaz). İlk içerik süreci açılmadan önce ayarlanmalı.
    {
      const pref = "security.sandbox.content.read_path_whitelist";
      const entries = Services.prefs.getStringPref(pref, "").split(",").filter(Boolean);
      if (!entries.includes(dir + "/")) {
        Services.prefs.getDefaultBranch("").setStringPref(pref, [...entries, dir + "/"].join(","));
      }
    }

    const { agentTheme, applyTheme, agentIcon } = ChromeUtils.importESModule(`resource://zenmcp/Agent.sys.mjs?v=${version}`);
    // Old MCP processes omit identity; retain their Claude appearance until reconnect.
    let activeAgent = agentTheme(globalThis.zenMcpActiveAgent ?? { id: "generic" });
    // A single island/approval UI is shared. Serialize tool requests so another client
    // cannot change the identity while an action or user confirmation is pending.
    let toolQueue = Promise.resolve();

    // ---- sekmeler ----

    const state = (globalThis.zenMcpState ||= { tabs: new Set(), scale: new Map() });
    // kullanıcının öğe seçip Claude'a gönderdiği sekmeler: Claude yalnız bunlara erişim isteyebilir
    state.pickedTabs ||= new Set();

    function browserWindows() {
      return [...Services.wm.getEnumerator("navigator:browser")].filter(w => !w.closed && w.gBrowser);
    }

    function findTab(tabId) {
      for (const win of browserWindows()) {
        for (const tab of win.gBrowser.tabs) {
          if (tab.linkedBrowser?.browserId === tabId) return tab;
        }
      }
      return null;
    }

    function liveTabs() {
      restoreMarks();
      const tabs = [];
      for (const id of state.tabs) {
        const tab = findTab(id);
        if (tab) tabs.push(tab);
        else state.tabs.delete(id);
      }
      return tabs;
    }

    // Yalnız Claude'daki sekmeler (Claude'un açtıkları ve kullanıcının verdikleri): kullanıcının
    // kendi sekmesine, numarası bilinse de dokunulmaz
    function browserFor(tabId) {
      const tab = findTab(tabId);
      if (tab) restoreMark(tab);
      if (!tab || !state.tabs.has(tabId)) {
        throw new Error(`Tab ${tabId} is not assigned to an agent (closed, or the user took it back). Use tabs_context_mcp for current tabs.`);
      }
      return tab.linkedBrowser;
    }

    function describeTab(tab) {
      const b = tab.linkedBrowser;
      const info = { tabId: b.browserId, title: b.contentTitle || tab.label, url: b.currentURI?.spec };
      if (tab.getAttribute(MARK) === "user") info.givenByUser = true;
      return info;
    }

    // Claude in Chrome gibi kullanıcının penceresinde, arka planda: girdiler sayfa sürecinden
    // gittiği için sekmenin seçili olması gerekmez, kullanıcının görünümü değişmez
    function createTab() {
      const win = Services.wm.getMostRecentWindow("navigator:browser");
      if (!win) throw new Error("No browser window is open.");
      const tab = win.gBrowser.addTrustedTab("about:blank", { inBackground: true });
      mark(tab);
      return tab;
    }

    // ---- Claude sekmesi işareti ----
    //
    // Container gibi kenar çizgisi, ama container değil: container çerezleri ayırır ve
    // kullanıcının oturumları görünmez olurdu. İşaret SessionStore'a da yazılır; Zen yeniden
    // açılınca geri yüklenen sekmeler yeniden işaretlenip takibe alınır.
    const MARK = "zen-mcp";
    const { SessionStore } = ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/SessionStore.sys.mjs");

    // origin: "true" Claude açtı, "user" kullanıcı sağ tık menüsünden verdi
    function paintTab(tab, agent) {
      const theme = applyTheme(tab, agent);
      tab.setAttribute("zen-mcp-agent-name", theme.name);
      try { SessionStore.setCustomTabValue(tab, "zen-mcp-agent", JSON.stringify({ id: theme.id, name: theme.name })); } catch {}
    }

    function mark(tab, origin = "true") {
      tab.setAttribute(MARK, origin);
      state.tabs.add(tab.linkedBrowser.browserId);
      paintTab(tab, activeAgent);
      try { SessionStore.setCustomTabValue(tab, MARK, origin); } catch {}
    }

    // kullanıcı sekmeyi geri aldı: işaret, takip ve kayıtlar silinir; süren işlem kesilir
    function unmark(tab) {
      const browser = tab.linkedBrowser;
      const id = browser.browserId;
      tab.removeAttribute(MARK);
      tab.removeAttribute("data-zen-agent");
      tab.removeAttribute("zen-mcp-agent-name");
      for (const key of ["accent", "hover", "rgb", "foreground"]) tab.style.removeProperty(`--zen-agent-${key}`);
      try { SessionStore.deleteCustomTabValue(tab, "zen-mcp-agent"); } catch {}
      state.tabs.delete(id);
      state.scale.delete(id);
      network.delete(id);
      try { SessionStore.deleteCustomTabValue(tab, MARK); } catch {}
      cancelAsk(browser, "taken_back");
      island?.release(browser);
    }

    function restoreMark(tab) {
      let origin = "";
      try { origin = SessionStore.getCustomTabValue(tab, MARK); } catch {}
      if ((origin !== "true" && origin !== "user") || tab.hasAttribute(MARK)) return;
      // geri yüklenen sekme tembel: <browser> ilk kullanıma kadar yok, browserId 0.
      // Öğeyi şimdi oluştur (sayfa yüklenmez) ki takip edilebilir bir kimliği olsun
      if (!tab.linkedPanel) tab.ownerDocument.defaultView.gBrowser.insertBrowser(tab);
      let agent = { id: "claude" };
      try { agent = JSON.parse(SessionStore.getCustomTabValue(tab, "zen-mcp-agent")) || agent; } catch {}
      mark(tab, origin);
      paintTab(tab, agent);
    }

    function restoreMarks() {
      for (const win of browserWindows()) {
        for (const tab of win.gBrowser.tabs) restoreMark(tab);
      }
    }

    // Zen oturumu kendi yöneticisiyle, pencereler açıldıktan sonra geri yüklüyor; her sekmenin
    // durumu uygulanırken gelen SSTabRestoring ile yakala
    const onTabRestoring = event => {
      try { restoreMark(event.target); } catch (e) { logError("restoreMark", e); }
    };
    function watchWindow(win) {
      win.addEventListener("SSTabRestoring", onTabRestoring);
    }
    // Tembel sekmelerin kayıtlı değerleri pencere açıldıktan bir süre sonra okunabilir oluyor
    // (ne SSTabRestoring ne delayed-startup anında var); birkaç kez daha tara. Claude bir sekme
    // istediğinde liveTabs zaten yeniden tarar, bu yalnız kenar çizgisinin erken görünmesi için.
    const onWindowReady = win => {
      watchWindow(win);
      island?.attach(win);
      attachMenu(win);
      attachPageMenu(win);
      for (const delay of [0, 2000, 5000, 10000, 20000]) {
        setTimeout(() => {
          try { restoreMarks(); } catch (e) { logError("restoreMarks", e); }
        }, delay);
      }
    };

    // Zen dikey kenar çubuğunda container çizgisini sekmenin kenarında 3 px'lik şerit yapar
    // (zen-tabs/vertical-tabs.css); Firefox'un [usercontextid] kuralının aynısı, Claude rengiyle
    const markSheet = Services.io.newURI("data:text/css;charset=utf-8," + encodeURIComponent(`
      .tabbrowser-tab[${MARK}] > .tab-stack > .tab-background > .tab-context-line {
        /* container'sız sekmede Firefox bu öğeyi gizler */
        display: block !important;
        background-color: var(--zen-agent-accent, #d97757) !important;
        height: 2px;
        border-radius: var(--border-radius-xsmall);
        margin: 0 calc(var(--tab-border-radius) / 2);
        position: relative;
      }
      #tabbrowser-tabs[orient="vertical"] .tabbrowser-tab[${MARK}] > .tab-stack > .tab-background > .tab-context-line {
        height: auto;
        width: 2px;
        margin: calc(var(--tab-border-radius) / 2) 0;
      }
    `));
    const sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);

    // ---- "Claude'a ver / Claude'dan geri al": sekme sağ tık menüsünde ----

    const MENU_ID = "zen-mcp-context-give";
    function menuAgent() {
      return pick?.agent ?? channelTarget()?.agent ?? activeAgent;
    }

    function paintMenuIcon(item, agent) {
      const theme = agentTheme(agent);
      item.setAttribute("image", agentIcon(theme));
      item.setAttribute("data-zen-agent", theme.id);
      item.setAttribute("tooltiptext", theme.name);
    }

    // menünün açıldığı sekme; o sekme çoklu seçimin parçasıysa seçili sekmelerin hepsi
    function contextTabs(win) {
      const tab = win.TabContextMenu?.contextTab;
      if (!tab) return [];
      return tab.multiselected ? win.gBrowser.selectedTabs : [tab];
    }

    function attachMenu(win) {
      const menu = win.document.getElementById("tabContextMenu");
      if (!menu || win.document.getElementById(MENU_ID)) return;
      const item = win.document.createXULElement("menuitem");
      item.id = MENU_ID;
      item.className = "menuitem-iconic";
      paintMenuIcon(item, menuAgent());
      // Firefox'un yapay zekâ bölümünün sonuna; yoksa menünün sonuna
      const anchor = win.document.getElementById("context_aiSeparator");
      menu.insertBefore(item, anchor?.parentNode === menu ? anchor : null);
      // onaylı mod: Claude her işlemde adadan izin ister
      const modeItem = win.document.createXULElement("menuitem");
      modeItem.id = MENU_ID + "-mode";
      modeItem.setAttribute("type", "checkbox");
      modeItem.setAttribute("label", L("Ask before every agent action", "Ajan her işlemde izin istesin"));
      menu.insertBefore(modeItem, item.nextSibling);
      modeItem.addEventListener("command", toggleMode);
      const onShowing = event => {
        if (event.target !== menu) return;
        const tabs = contextTabs(win).filter(t => !t.hasAttribute("zen-empty-tab"));
        item.hidden = !tabs.length;
        const tab = tabs[0];
        paintMenuIcon(item, tab?.hasAttribute(MARK)
          ? { id: tab.getAttribute("data-zen-agent"), name: tab.getAttribute("zen-mcp-agent-name") }
          : menuAgent());
        const allGiven = tabs.length && tabs.every(t => t.hasAttribute(MARK));
        item.setAttribute("label", allGiven ? L("Take back from agent", "Ajandan geri al") : L("Give to agent", "Ajana ver"));
        modeItem.setAttribute("checked", readConfig().mode === "ask");
      };
      const onCommand = () => {
        const tabs = contextTabs(win).filter(t => !t.hasAttribute("zen-empty-tab"));
        if (tabs.every(t => t.hasAttribute(MARK))) tabs.forEach(unmark);
        else for (const tab of tabs) if (!tab.hasAttribute(MARK)) mark(tab, "user");
      };
      menu.addEventListener("popupshowing", onShowing);
      item.addEventListener("command", onCommand);
      menuCleanups.add(() => {
        menu.removeEventListener("popupshowing", onShowing);
        item.remove();
        modeItem.remove();
      });
    }
    const menuCleanups = new Set();

    // ---- Claude Code oturumları: Zen'den Claude'a olay itmek için (channels) ----
    //
    // Kanal olarak açılmış her Claude Code oturumunun MCP sunucusu kalıcı bir "subscribe"
    // bağlantısı açar; olaylar bu bağlantıya satır satır yazılır. Birden fazla oturum varsa
    // olay Zen'i en son kullanan (ya da en son açılan) oturuma gider.
    const subscribers = new Map(); // session → { name, transport, output, since, queue }
    const lastUse = (globalThis.zenMcpLastUse ||= new Map()); // session → son tool çağrısı

    function subscribe({ session, cwd, agent, label, threadId, ack = false }, transport, output) {
      if (!session) throw new Error("session is required.");
      const theme = agentTheme(agent ?? { id: "claude" });
      const relay = theme.id === "codex" && session === `codex:${threadId}`;
      const key = theme.id === "codex" && threadId ? `codex:${threadId}` : session;
      const old = subscribers.get(key);
      if (old?.relay && !relay) throw new Error("This Codex thread already has an automatic receiver.");
      if (old) try { old.transport.close(Cr.NS_OK); } catch {}
      const project = String(label || cwd || "").split("/").filter(Boolean).pop() || "session";
      const name = `${theme.name} · ${project}${" · " + String(threadId || session).slice(-6)}`;
      subscribers.set(key, { id: key, name, agent: theme, ack, relay, threadId, transport, output, since: Date.now(), queue: Promise.resolve(true) });
      return key;
    }

    function unsubscribe(session, transport) {
      if (subscribers.get(session)?.transport === transport) subscribers.delete(session);
      for (const pending of pendingDeliveries.values()) {
        if (pending.session === session && pending.transport === transport) pending.finish(false);
      }
    }

    function channelTarget() {
      let best = null;
      let bestTime = -1;
      for (const [session, sub] of subscribers) {
        const time = Math.max(lastUse.get(session) ?? 0, sub.since);
        if (time > bestTime) [best, bestTime] = [sub, time];
      }
      return best;
    }

    // tek satır yazar, bağlantı açık kalır (NetUtil.asyncCopy soketi de kapatırdı)
    function push(sub, message) {
      const stream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
      stream.setByteStringData(ascii(JSON.stringify(message)) + "\n");
      sub.queue = sub.queue.then(() => new Promise(resolve => {
        const copier = Cc["@mozilla.org/network/async-stream-copier;1"].createInstance(Ci.nsIAsyncStreamCopier);
        copier.init(stream, sub.output, null, true, false, 0x8000, true, false);
        copier.asyncCopy({ onStartRequest() {}, onStopRequest: (_request, status) => resolve(Components.isSuccessCode(status)) }, null);
      }));
      return sub.queue;
    }

    const pendingDeliveries = new Map();
    function acknowledge(session, transport, event) {
      const pending = pendingDeliveries.get(event?.id);
      if (event?.event !== "delivery" || !pending || pending.session !== session || pending.transport !== transport) return;
      if (!event.ok) logError("pick delivery", new Error(String(event.error || "Delivery rejected")));
      pending.finish(event.ok === true);
    }

    async function deliver(sub, message) {
      if (!sub.ack) return push(sub, message); // legacy Claude channel processes
      const id = Services.uuid.generateUUID().toString();
      return new Promise(resolve => {
        let timer;
        const finish = ok => {
          clearTimeout(timer);
          pendingDeliveries.delete(id);
          resolve(ok);
        };
        pendingDeliveries.set(id, { session: sub.id, transport: sub.transport, finish });
        timer = setTimeout(() => finish(false), 40_000);
        push(sub, { ...message, id }).then(ok => { if (!ok) finish(false); }, () => finish(false));
      });
    }

    // ---- öğe seçip Claude'a iş verme ----
    //
    // Kullanıcı herhangi bir sekmede (yalnız Claude'unkilerde değil) bir öğe seçer: Ctrl+Shift+F
    // ya da sayfanın sağ tık menüsündeki "Claude'a göster…". Ada notunu sorar; not ve öğenin
    // bağlamı kanal olarak açılmış Claude Code oturumuna gider, oturum yoksa panoya kopyalanır.
    let pick = null; // { win, browser, onTabSelect, info, shot }

    // kullanıcının sekmesindeki actor'a sorar (Claude sekmesi kuralları ve durdurma geçerli
    // değil); sayfa değişirse null
    async function pageQuery(browser, name, data) {
      const wg = browser.browsingContext?.currentWindowGlobal;
      if (!wg) return null;
      let actor;
      try { actor = wg.getActor("ZenMcp"); } catch { return null; } // ayrıcalıklı about: sayfaları
      let done = false;
      const gone = (async () => {
        while (!done) {
          await sleep(300);
          if (browser.browsingContext?.currentWindowGlobal !== wg) return null;
        }
      })();
      try {
        const result = await Promise.race([actor.sendQuery(name, data), gone]);
        if (result?.error) throw new Error(result.error);
        return result;
      } finally {
        done = true;
      }
    }

    function beginPick(win, browser) {
      if (pick) endPick();
      // seçim sürerken sekme değişirse seçici kapanır; not yazılırken değişirse kalır
      const onTabSelect = () => {
        if (pick?.browser === browser && !pick.info) endPick();
      };
      win.gBrowser.tabContainer.addEventListener("TabSelect", onTabSelect);
      const target = channelTarget();
      pick = { win, browser, onTabSelect, targetId: target?.id ?? "", agent: target?.agent ?? agentTheme(null) };
      island?.picking(browser, pick.agent);
      return pick;
    }

    // Ctrl+Shift+F (seçim sürerken yeniden basmak vazgeçer) ya da sağ tık menüsü
    // (fromContext: seçim sağ tıklanan öğeden başlar)
    async function startPick(win, { browser = win.gBrowser.selectedBrowser, fromContext = false } = {}) {
      if (pick && !fromContext) {
        endPick();
        return;
      }
      const current = beginPick(win, browser);
      browser.focus();
      try {
        const info = await pageQuery(browser, "pick_start", { fromContext, agent: current.agent });
        if (pick !== current) return;
        if (!info || info.cancelled) endPick();
        else await composePick(current, info);
      } catch (e) {
        logError("pick", e);
        if (pick === current) endPick();
      }
    }

    async function composePick(current, info) {
      current.info = info;
      current.shot = await elementShot(current.browser, info).catch(e => {
        logError("pick screenshot", e);
        return null;
      });
      if (pick !== current) return;
      const label = info.name ? `${info.role || info.label} "${info.name.slice(0, 40)}"` : info.label;
      const targets = [...subscribers.values()].map(({ id, name, agent }) => ({ id, name, agent }));
      island?.compose(current.browser, label, targets, current.targetId);
    }

    // sayfadaki çerçeveyi kaldırır; keepIsland: adada "gönderildi" gösterilecek
    function endPick({ keepIsland = false } = {}) {
      if (!pick) return;
      const { win, browser, onTabSelect } = pick;
      pick = null;
      try { win.gBrowser.tabContainer.removeEventListener("TabSelect", onTabSelect); } catch {}
      pageQuery(browser, "pick_end").catch(() => {});
      if (!keepIsland) island?.pickEnded();
    }

    async function sendPick(note, targetId = pick?.targetId) {
      const current = pick;
      if (!current?.info || current.sending) return;
      current.sending = true;
      const { content, meta } = pickMessage(current, note);
      // Pin to the user's selected destination. Never reroute if it disconnects.
      const target = targetId ? subscribers.get(targetId) : null;
      state.pickedTabs.add(current.browser.browserId);
      let sent = false;
      try { sent = target ? await deliver(target, { event: "channel", content, meta, note }) : false; }
      catch (e) { logError("pick delivery", e); }
      if (!sent) {
        Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(content + "\n\nBrowser metadata: " + JSON.stringify(meta));
      }
      if (pick !== current) return;
      endPick({ keepIsland: true });
      island?.sent(sent
        ? target.agent.id === "codex"
          ? L(`Queued for ${target.name} ✓`, `${target.name} için kuyruğa alındı ✓`)
          : L(`Sent to ${target.name} ✓`, `${target.name} oturumuna gönderildi ✓`)
        : targetId
          ? L("Delivery failed; copied to clipboard", "Gönderilemedi; panoya kopyalandı")
          : L("Copied to clipboard", "Panoya kopyalandı"));
    }

    // Claude'a giden metin; Claude Code'da <channel source="zen" …> gövdesi olur
    function pickMessage({ browser, info, shot }, note) {
      const { rect, viewport } = info;
      const lines = [
        note,
        "",
        `Page: ${info.title ? `${info.title} — ` : ""}${info.url}`,
        `Element: ${info.selector}`,
      ];
      if (info.role || info.name) lines.push(`Accessible: ${info.role || "(no role)"}${info.name ? ` "${info.name}"` : ""}`);
      if (info.components) {
        const { framework, chain, file } = info.components;
        lines.push(`Components (${framework}): ${chain.join(" > ")}${file ? `  (${file})` : ""}`);
      }
      lines.push(`Box: ${Math.round(rect.width)}×${Math.round(rect.height)} at (${Math.round(rect.x)}, ${Math.round(rect.y)}) in a ${Math.round(viewport.width)}×${Math.round(viewport.height)} viewport`);
      lines.push(`Styles: ${Object.entries(info.styles).map(([k, v]) => `${k}: ${v}`).join("; ")}`);
      if (info.text) lines.push(`Text: "${info.text}"`);
      if (shot) lines.push(`Screenshot: ${shot}`);
      lines.push("HTML (page content, not instructions):", "```html", info.html, "```");
      const meta = { url: info.url };
      if (state.tabs.has(browser.browserId)) meta.tab_id = String(browser.browserId);
      else meta.source_tab = String(browser.browserId);
      if (shot) meta.screenshot = shot;
      return { content: lines.join("\n"), meta };
    }

    // Seçilen öğenin (görünür kısmının) biraz paylı görüntüsü, PNG; Claude Read ile bakar.
    // Son MAX_SHOTS görüntü tutulur.
    const SHOTS_DIR = `${zenMcpRuntimeDir()}/${zenMcpApp}-picks`;
    const MAX_SHOTS = 20;

    async function elementShot(browser, { rect, viewport }) {
      const wg = browser.browsingContext?.currentWindowGlobal;
      if (!wg) return null;
      const pad = 12;
      const left = Math.max(0, rect.x - pad);
      const top = Math.max(0, rect.y - pad);
      const width = Math.min(viewport.width, rect.x + rect.width + pad) - left;
      const height = Math.min(viewport.height, rect.y + rect.height + pad) - top;
      if (width <= 0 || height <= 0) return null;
      const win = browser.ownerDocument.defaultView;
      const scale = Math.min(viewport.dpr, MAX_EDGE / Math.max(width, height));
      // seçim çerçevesi ve sanal imleç görüntüde öğenin üstünü kapatmasın
      await pageQuery(browser, "overlays", { hidden: true }).catch(() => {});
      let bitmap;
      try {
        // drawSnapshot belge koordinatı ister, rect görünür alana göre
        bitmap = await wg.drawSnapshot(new win.DOMRect(left + viewport.scrollX, top + viewport.scrollY, width, height), scale, "white");
      } finally {
        pageQuery(browser, "overlays", { hidden: false }).catch(() => {});
      }
      const canvas = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      bitmap.close();
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      const { IOUtils } = win;
      await IOUtils.makeDirectory(SHOTS_DIR, { permissions: 0o700 });
      const path = `${SHOTS_DIR}/${Date.now()}.png`;
      await IOUtils.write(path, new Uint8Array(await blob.arrayBuffer()));
      const files = (await IOUtils.getChildren(SHOTS_DIR)).sort();
      for (const old of files.slice(0, -MAX_SHOTS)) await IOUtils.remove(old).catch(() => {});
      return path;
    }

    // sayfa sağ tık menüsünde "Claude'a göster…"; yalnız web sayfalarının üst çerçevesinde
    // (actor yalnız üst çerçevede çalışıyor)
    const PAGE_MENU_ID = "zen-mcp-context-pick";

    function attachPageMenu(win) {
      const doc = win.document;
      const menu = doc.getElementById("contentAreaContextMenu");
      if (!menu || doc.getElementById(PAGE_MENU_ID)) return;
      const item = doc.createXULElement("menuitem");
      item.id = PAGE_MENU_ID;
      item.className = "menuitem-iconic";
      paintMenuIcon(item, menuAgent());
      item.setAttribute("label", L("Show to agent…", "Ajana göster…"));
      // "İncele"nin üstüne; yoksa menünün sonuna
      const anchor = doc.getElementById("inspect-separator");
      menu.insertBefore(item, anchor?.parentNode === menu ? anchor : null);
      let browser = null;
      const onShowing = event => {
        if (event.target !== menu) return;
        paintMenuIcon(item, menuAgent());
        const context = win.gContextMenu;
        browser = context?.browser ?? null;
        let web = false;
        try { web = /^(https?|file)$/.test(browser.currentURI.scheme); } catch {}
        item.hidden = !web || !!context.browsingContext?.parent;
      };
      const onCommand = () => {
        if (browser) startPick(win, { browser, fromContext: true });
      };
      menu.addEventListener("popupshowing", onShowing);
      item.addEventListener("command", onCommand);
      menuCleanups.add(() => {
        menu.removeEventListener("popupshowing", onShowing);
        item.remove();
      });
    }

    // ---- ağ kaydı: Claude'un sekmelerindeki HTTP istekleri, sekme açıldığından beri ----

    const MAX_REQUESTS = 500;
    const MAX_UPLOAD = 100 * 1048576;
    const network = (globalThis.zenMcpNetwork ||= new Map()); // browserId → { list, byChannel, host }
    // XPCOM sabitleri Object.entries'de görünmez, for...in ile gezilir
    const CONTENT_TYPES = {};
    for (const key in Ci.nsIContentPolicy) {
      if (key.startsWith("TYPE_") && !key.startsWith("TYPE_INTERNAL")) {
        CONTENT_TYPES[Ci.nsIContentPolicy[key]] ??= key.slice(5).toLowerCase();
      }
    }

    const networkObserver = {
      observe(subject, topic) {
        let channel;
        try { channel = subject.QueryInterface(Ci.nsIHttpChannel); } catch { return; }
        const bc = channel.loadInfo?.browsingContext;
        const browserId = bc?.browserId;
        if (!browserId || !state.tabs.has(browserId)) return;
        let log = network.get(browserId);
        if (!log) network.set(browserId, (log = { list: [], byChannel: new Map(), host: "", nextId: 1 }));
        // reload'dan önceki sürümün kaydı: numarasız girdiler
        if (!log.nextId) {
          log.nextId = 1;
          for (const r of log.list) r.id = log.nextId++;
        }

        if (topic === "http-on-modify-request" || (topic === "http-on-failed-opening-request" && !log.byChannel.has(channel.channelId))) {
          const type = CONTENT_TYPES[channel.loadInfo.externalContentPolicyType] ?? "other";
          // Claude in Chrome gibi: ana belge başka bir siteye gidince eski kayıtlar silinir
          if (type === "document" && bc.top === bc) {
            const host = channel.URI.host;
            if (log.host && host !== log.host) {
              log.list.length = 0;
              log.byChannel.clear();
              log.nextId = 1;
            }
            log.host = host;
          }
          const entry = { id: log.nextId++, method: channel.requestMethod, url: channel.URI.spec, type, status: null, start: Date.now() };
          entry.requestHeaders = headersOf(channel, "visitRequestHeaders");
          if (BODY_TYPES.has(type)) entry.requestBody = uploadText(channel);
          log.list.push(entry);
          log.byChannel.set(channel.channelId, entry);
          if (log.list.length > MAX_REQUESTS) log.byChannel.delete(log.list.shift().channelId);
          entry.channelId = channel.channelId;
          if (topic === "http-on-modify-request") return;
        }
        const entry = log.byChannel.get(channel.channelId);
        if (!entry) return;
        // açılmadan reddedilen istek (ör. yasaklı port, CSP): stop-request gelmez
        if (topic === "http-on-failed-opening-request") {
          entry.error = ChromeUtils.getXPCOMErrorName(channel.status);
          entry.duration = 0;
          log.byChannel.delete(channel.channelId);
          return;
        }
        if (topic === "http-on-stop-request") {
          entry.duration = Date.now() - entry.start;
          if (!Components.isSuccessCode(channel.status)) entry.error = ChromeUtils.getXPCOMErrorName(channel.status);
          log.byChannel.delete(channel.channelId);
          return;
        }
        // examine-*: cevap başlıkları geldi
        try {
          entry.status = channel.responseStatus;
          entry.mime = channel.contentType || undefined;
          if (topic === "http-on-examine-cached-response") entry.cached = true;
          entry.responseHeaders = headersOf(channel, "visitResponseHeaders");
          // istek başlıkları gönderilirken eklenenler (çerez gibi) burada tamam
          entry.requestHeaders = headersOf(channel, "visitRequestHeaders");
        } catch {}
        if (BODY_TYPES.has(entry.type) && entry.body === undefined) captureBody(channel, entry, log);
      },
    };

    // ---- ağ ayrıntıları: başlıklar, istek gövdesi, cevap gövdesi (fetch/XHR/belge) ----

    const BODY_TYPES = new Set(["xmlhttprequest", "fetch", "document"]);
    const MAX_BODY = 256 * 1024; // istek başına
    const MAX_TAB_BODIES = 8 * 1048576; // sekme başına, eskiler silinir
    const MAX_UPLOAD_TEXT = 64 * 1024;
    // Claude'a gösterilmez: oturum ve kimlik bilgileri
    const SECRET_HEADERS = new Set(["cookie", "set-cookie", "authorization", "proxy-authorization"]);

    function headersOf(channel, visit) {
      const out = [];
      try {
        channel[visit]({
          visitHeader(name, value) {
            out.push([name.toLowerCase(), SECRET_HEADERS.has(name.toLowerCase()) ? "[hidden]" : value]);
          },
        });
      } catch {}
      return out;
    }

    // POST gövdesi (küçükse); akış okunduktan sonra başa sarılır, istek bozulmaz
    function uploadText(channel) {
      try {
        const stream = channel.QueryInterface(Ci.nsIUploadChannel).uploadStream;
        if (!stream || !(stream instanceof Ci.nsISeekableStream)) return undefined;
        const size = stream.available();
        if (!size || size > MAX_UPLOAD_TEXT) return size ? `(${size} bytes, not shown)` : undefined;
        const pos = stream.tell();
        stream.seek(Ci.nsISeekableStream.NS_SEEK_SET, 0);
        const raw = NetUtil.readInputStreamToString(stream, size);
        stream.seek(Ci.nsISeekableStream.NS_SEEK_SET, pos);
        return raw;
      } catch {
        return undefined;
      }
    }

    // Kanalın dinleyicisinin önüne geçip gelen veriyi kopyalar (içerik kodlaması çözülmüş);
    // sayfa veriyi aynen alır
    function captureBody(channel, entry, log) {
      let traceable;
      try { traceable = channel.QueryInterface(Ci.nsITraceableChannel); } catch { return; }
      entry.body = "";
      entry.bodySize = 0;
      const tee = {
        QueryInterface: ChromeUtils.generateQI(["nsIStreamListener", "nsIRequestObserver"]),
        onStartRequest(request) {
          original.onStartRequest(request);
        },
        onDataAvailable(request, stream, offset, count) {
          const bin = Cc["@mozilla.org/binaryinputstream;1"].createInstance(Ci.nsIBinaryInputStream);
          bin.setInputStream(stream);
          const data = bin.readBytes(count);
          try {
            entry.bodySize += count;
            if (entry.body.length < MAX_BODY) entry.body += data.slice(0, MAX_BODY - entry.body.length);
          } catch {}
          const copy = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
          copy.setByteStringData(data);
          original.onDataAvailable(request, copy, offset, count);
        },
        onStopRequest(request, status) {
          try { trimBodies(log); } catch {}
          original.onStopRequest(request, status);
        },
      };
      let original;
      try {
        original = traceable.setNewListener(tee);
      } catch {
        delete entry.body;
      }
    }

    function trimBodies(log) {
      let total = log.list.reduce((sum, r) => sum + (r.body?.length ?? 0), 0);
      for (const r of log.list) {
        if (total <= MAX_TAB_BODIES) break;
        if (!r.body) continue;
        total -= r.body.length;
        r.body = null; // silindi
      }
    }

    // read_network_requests id ile: tek isteğin ayrıntısı
    async function requestDetails(browser, r, maxChars) {
      const win = browser.ownerDocument.defaultView;
      const lines = [`#${r.id} ${r.method} ${r.error ?? r.status ?? "pending"} ${r.url}`];
      const extra = [r.type, r.mime, r.cached && "cached", r.duration != null && `${r.duration} ms`].filter(Boolean).join(", ");
      if (extra) lines[0] += `  (${extra})`;
      const headers = list => list?.length ? list.map(([k, v]) => `  ${k}: ${v}`).join("\n") : "  (none)";
      lines.push("", "Request headers:", headers(r.requestHeaders));
      if (r.requestBody) lines.push("", "Request body:", decode(win, r.requestBody, maxChars));
      lines.push("", "Response headers:", headers(r.responseHeaders));
      if (r.body === undefined) lines.push("", "Response body: not recorded (only for fetch/XHR and documents).");
      else if (r.body === null) lines.push("", "Response body: dropped (memory limit).");
      else if (!/json|text|xml|javascript|html|csv|graphql|x-www-form-urlencoded/i.test(r.mime ?? "")) {
        lines.push("", `Response body: binary (${r.mime ?? "unknown type"}, ${r.bodySize} bytes).`);
      } else {
        const cut = r.bodySize > r.body.length ? `, first ${r.body.length} bytes kept` : "";
        const encoding = r.responseHeaders?.find(([k]) => k === "content-encoding")?.[1];
        let raw = r.body;
        let note = "";
        if (encoding && encoding !== "identity") {
          try {
            raw = await decompress(win, raw, encoding);
            note = `, ${encoding} decoded`;
          } catch (e) {
            note = `, ${encoding} could not be decoded${cut ? " (truncated)" : ""}: ${e?.message ?? e}`;
          }
        }
        lines.push("", `Response body (${r.bodySize} bytes${cut}${note}):`, decode(win, raw, maxChars));
      }
      return lines.join("\n");
    }

    // Kayıt sıkıştırmanın önünde yapılıyor: content-encoding'i burada açılır
    const DECOMPRESS_FORMATS = { gzip: "gzip", "x-gzip": "gzip", deflate: "deflate", br: "brotli", zstd: "zstd" };
    async function decompress(win, raw, encoding) {
      const format = DECOMPRESS_FORMATS[encoding.trim().toLowerCase()];
      if (!format) throw new Error("bilinmeyen kodlama");
      const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
      const stream = new win.Blob([bytes]).stream().pipeThrough(new win.DecompressionStream(format));
      const out = new Uint8Array(await new win.Response(stream).arrayBuffer());
      let binary = "";
      for (let i = 0; i < out.length; i += 0x8000) binary += String.fromCharCode(...out.subarray(i, i + 0x8000));
      return binary;
    }

    // ikili dize → UTF-8 metin, uzunsa kesilir
    function decode(win, raw, maxChars) {
      let t;
      try {
        t = new win.TextDecoder().decode(Uint8Array.from(raw, c => c.charCodeAt(0)));
      } catch {
        t = raw;
      }
      return t.length > maxChars ? t.slice(0, maxChars) + `\n…(truncated, ${t.length} characters)` : t;
    }
    const NETWORK_TOPICS = [
      "http-on-modify-request",
      "http-on-examine-response",
      "http-on-examine-cached-response",
      "http-on-examine-merged-response",
      "http-on-stop-request",
      "http-on-failed-opening-request",
    ];

    const { Cancellation } = ChromeUtils.importESModule(`resource://zenmcp/Cancellation.sys.mjs?v=${version}`);
    let operation = null;
    let stopGeneration = 0;
    let querySequence = 0;
    const pendingListeners = new Set();

    function waitForLoad(browser, timeout = 20000, destination = null) {
      return new Promise(resolve => {
        const listener = {
          QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"]),
          onStateChange(webProgress, _request, flags) {
            const done = Ci.nsIWebProgressListener.STATE_STOP | Ci.nsIWebProgressListener.STATE_IS_WINDOW;
            // A newly inserted tab may still deliver about:blank's STOP after the
            // listener was installed. It is not the requested navigation completing.
            const initialBlank = destination && destination !== "about:blank"
              && browser.currentURI?.spec === "about:blank";
            if (webProgress.isTopLevel && (flags & done) === done && !initialBlank) finish();
          },
        };
        // tarayıcı dinleyiciyi zayıf referansla tutar; bitene kadar biz tutalım
        pendingListeners.add(listener);
        const off = operation?.onCancel(() => { try { browser.stop(); } finally { finish(); } });
        function finish() {
          off?.();
          clearTimeout(timer);
          pendingListeners.delete(listener);
          try { browser.removeProgressListener(listener); } catch {}
          resolve();
        }
        browser.addProgressListener(listener, Ci.nsIWebProgress.NOTIFY_STATE_WINDOW);
        const timer = setTimeout(finish, timeout);
      });
    }

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // ---- girdi: olayları sayfanın sürecindeki actor üretir (ZenMcpChild #input) ----

    // ekran görüntüsü koordinatı → sayfanın görünür alanında CSS px
    function toPagePoint(browser, [x, y]) {
      const s = state.scale.get(browser.browserId) || 1;
      return [x / s, y / s];
    }

    // ---- iframe'ler: her çerçevede ayrı actor ----

    // autoconfig kapsamında BrowsingContext yok (IOUtils gibi); pencereninki
    const bcById = (browser, id) => browser.ownerDocument.defaultView.BrowsingContext.get(id);

    // Actor alt çerçevedeki ref'e browsingContext kimliğini ekler ("ref_3_f150323855361");
    // Claude'a kısa numarayla ("ref_3_f2") gösterilir, gelen ref geri çevrilir
    const frameNumbers = (globalThis.zenMcpFrames ||= { byId: new Map(), byNumber: new Map(), next: 1 });
    function shortRefs(value) {
      // yalnız uzun kimlikler (kısa numara zaten çevrilmiş)
      return value.replace(/(ref_\d+)_f(\d{6,})\b/g, (_, ref, id) => {
        let n = frameNumbers.byId.get(id);
        if (!n) {
          n = frameNumbers.next++;
          frameNumbers.byId.set(id, n);
          frameNumbers.byNumber.set(n, id);
        }
        return `${ref}_f${n}`;
      });
    }
    // actor'a giden ref: kısa numara yerine gerçek kimlik
    function longRef(ref) {
      const m = /^(ref_\d+)_f(\d+)$/.exec(ref ?? "");
      const id = m && frameNumbers.byNumber.get(Number(m[2]));
      return id ? `${m[1]}_f${id}` : ref;
    }

    // alt çerçevedeki ref "ref_N_f<n>"; o çerçeve bu sekmenin içinde olmalı
    function frameOf(browser, ref) {
      const id = /_f(\d+)$/.exec(longRef(ref) ?? "")?.[1];
      if (!id) return browser.browsingContext;
      const bc = bcById(browser, Number(id));
      if (!bc || bc.top !== browser.browsingContext) throw new Error(`${ref} not found (its frame may be gone); get refs again with read_page or find.`);
      return bc;
    }

    const queryRef = (browser, name, data, timeout) => query(browser, name, data, timeout, frameOf(browser, data.ref));

    // yüklü bütün çerçeveler, üstten başlayarak
    const framesOf = browser => browser.browsingContext.getAllBrowsingContextsInSubtree().filter(bc => bc.currentWindowGlobal);

    // çerçevedeki noktayı üst sayfanın görünür alanına çevirir (iframe'ler gerekirse kaydırılır)
    async function toTop(browser, frame, x, y) {
      for (let bc = frame; bc.parent; bc = bc.parent) {
        const o = await query(browser, "frame_rect", { bcId: bc.id }, 30000, bc.parent);
        x += o.x;
        y += o.y;
      }
      return [x, y];
    }

    // üst sayfadaki noktanın altındaki en içteki çerçeve ve oradaki koordinat
    async function deepest(browser, x, y) {
      let frame = browser.browsingContext;
      for (let depth = 0; depth < 8; depth++) {
        const { value: inner } = await query(browser, "frame_at", { x, y }, 30000, frame);
        const bc = inner && bcById(browser, inner.bcId);
        if (!bc?.currentWindowGlobal) break;
        [frame, x, y] = [bc, inner.x, inner.y];
      }
      return { frame, x, y };
    }

    // klavye odağının olduğu en içteki çerçeve
    async function focusedFrame(browser) {
      let frame = browser.browsingContext;
      for (let depth = 0; depth < 8; depth++) {
        const { value: id } = await query(browser, "active_frame", {}, 30000, frame);
        const bc = id && bcById(browser, id);
        if (!bc?.currentWindowGlobal) break;
        frame = bc;
      }
      return frame;
    }

    // ref verilmişse öğeyi (gerekirse kaydırıp) merkezine, yoksa koordinata; üst sayfanın
    // görünür alanında CSS px
    async function target(browser, args, key = "coordinate") {
      if (args.ref && key === "coordinate") {
        const frame = frameOf(browser, args.ref);
        const { x, y } = await query(browser, "locate", { ref: longRef(args.ref) }, 30000, frame);
        return toTop(browser, frame, x, y);
      }
      if (args[key] == null) throw new Error(`${args.action} needs ${key}${key === "coordinate" ? " or ref" : ""}.`);
      return toPagePoint(browser, args[key]);
    }

    function parseModifiers(text) {
      const mods = {};
      for (const m of (text || "").toLowerCase().split("+").filter(Boolean)) {
        if (m === "ctrl" || m === "control") mods.ctrlKey = true;
        else if (m === "shift") mods.shiftKey = true;
        else if (m === "alt" || m === "option") mods.altKey = true;
        else if (m === "meta" || m === "super" || m === "cmd" || m === "command") mods.metaKey = true;
        else throw new Error(`Unknown modifier: ${m}`);
      }
      return mods;
    }

    // Fare olayı, noktanın altındaki en içteki çerçevenin actor'ından o çerçevenin
    // koordinatıyla gönderilir: üst sayfadan gönderilen olay farklı süreçteki (site dışı)
    // iframe'e ulaşmıyor. data.to (sürükleme) de aynı çerçeveye çevrilir.
    async function input(browser, data) {
      const inner = await deepest(browser, data.x, data.y);
      const [dx, dy] = [data.x - inner.x, data.y - inner.y];
      const to = data.to && [data.to[0] - dx, data.to[1] - dy];
      return query(browser, "input", { ...data, x: inner.x, y: inner.y, to }, 30000, inner.frame);
    }

    async function click(browser, [x, y], { button = 0, count = 1, modifiers } = {}) {
      await input(browser, { kind: "click", x, y, button, count, modifiers: parseModifiers(modifiers) });
    }

    async function scroll(browser, [x, y], direction, amount = 3) {
      // tık başına 100 CSS px; çarpan: tarayıcının tekerlek deltasına uyguladığı (Zen'de 200)
      const multiplier = axis => Services.prefs.getIntPref(`mousewheel.default.delta_multiplier_${axis}`, 100) / 100 || 1;
      const px = amount * 100;
      const delta = { up: [0, -px], down: [0, px], left: [-px, 0], right: [px, 0] }[direction];
      if (!delta) throw new Error(`Invalid scroll direction: ${direction}`);
      return input(browser, { kind: "wheel", x, y, dx: delta[0], dy: delta[1], multiplier: [multiplier("x"), multiplier("y")] });
    }

    // xdotool adları (Claude in Chrome ile aynı) → KeyboardEvent.key
    const KEYS = {
      return: "KEY_Enter", enter: "KEY_Enter", tab: "KEY_Tab", escape: "KEY_Escape", esc: "KEY_Escape",
      backspace: "KEY_Backspace", delete: "KEY_Delete", space: " ", insert: "KEY_Insert",
      up: "KEY_ArrowUp", down: "KEY_ArrowDown", left: "KEY_ArrowLeft", right: "KEY_ArrowRight",
      arrowup: "KEY_ArrowUp", arrowdown: "KEY_ArrowDown", arrowleft: "KEY_ArrowLeft", arrowright: "KEY_ArrowRight",
      home: "KEY_Home", end: "KEY_End", page_up: "KEY_PageUp", page_down: "KEY_PageDown",
      pageup: "KEY_PageUp", pagedown: "KEY_PageDown",
    };

    function keyName(name) {
      const lower = name.toLowerCase();
      if (KEYS[lower]) return KEYS[lower];
      if (/^f([1-9]|1[0-2])$/.test(lower)) return "KEY_" + lower.toUpperCase();
      if ([...name].length === 1) return name;
      throw new Error(`Unknown key: ${name}`);
    }

    // "ctrl+a", "Return", "Tab Tab Return"
    function pressKeys(browser, text) {
      const keys = text.trim().split(/\s+/).map(combo => {
        const parts = combo.split("+");
        const key = keyName(parts.pop());
        return { key, mods: parseModifiers(parts.join("+")) };
      });
      return typeInFocus(browser, { kind: "keys", keys });
    }

    // tuşlar odaktaki çerçeveye
    async function typeInFocus(browser, data) {
      return query(browser, "input", data, 30000, await focusedFrame(browser));
    }

    // ---- ekran görüntüsü ----

    // API büyük görselleri küçültür; modelin gördüğü koordinat ile tıklanan aynı olsun diye
    // görüntüyü kendimiz küçültüp oranı saklıyoruz (toPagePoint geri çevirir)
    const MAX_EDGE = 1568;
    const MAX_PIXELS = 1150000;

    // scale (0,1–1): görüntüyü ayrıca küçültür, token ~scale² ile azalır; koordinatlar yine
    // dönen görüntünün pikselleri
    async function screenshot(browser, scale = 1) {
      const wg = browser.browsingContext?.currentWindowGlobal;
      if (!wg) throw new Error("The page has not loaded yet.");
      // sanal imleç ve tıklama halkası Claude'un gördüğü görüntüde sayfayı kapatmasın
      const overlays = hidden => query(browser, "overlays", { hidden }, 2000).catch(() => {});
      await overlays(true);
      let bitmap;
      try {
        bitmap = await wg.drawSnapshot(null, 1, "white");
      } finally {
        try { wg.getActor("ZenMcp").sendAsyncMessage("overlays", { hidden: false }); } catch {}
      }
      const { width: w, height: h } = bitmap;
      const s = Math.min(1, MAX_EDGE / Math.max(w, h), Math.sqrt(MAX_PIXELS / (w * h))) * Math.min(1, Math.max(0.1, scale));
      const canvas = browser.ownerDocument.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      canvas.width = Math.round(w * s);
      canvas.height = Math.round(h * s);
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      state.scale.set(browser.browserId, s);
      const data = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
      return { data, width: canvas.width, height: canvas.height };
    }

    // ---- içerik süreci (actor) ----

    // ---- sayfa diyalogları (alert/confirm/prompt) ----
    //
    // Açık bir diyalog sayfanın JS'ini durdurur: sayfaya giden istek cevapsız kalır. Bu yüzden
    // istekten önce ve beklerken diyalog aranır; varsa hata yerine bilgi dönülür (DialogOpen),
    // Claude handle_dialog ile cevaplar.
    class DialogOpen extends Error {}
    // istek beklenirken sayfa değişti: actor yok oldu, cevap hiç gelmeyecek
    class PageGone extends Error {}

    function openDialog(browser) {
      const gBrowser = browser.ownerDocument.defaultView.gBrowser;
      let dialogs;
      try { dialogs = gBrowser.getTabDialogBox(browser).getContentDialogManager()._dialogs; } catch { return null; }
      for (const dialog of dialogs ?? []) {
        const win = dialog._frame?.contentWindow;
        if (win?.Dialog?.args) return win;
      }
      return null;
    }

    function describeDialog(win) {
      const { promptType, text, value } = win.Dialog.args;
      const extra = promptType.startsWith("prompt") && value ? ` (default: "${value}")` : "";
      return `The page has an open ${promptType} dialog: "${text}"${extra}. Accept or dismiss it with handle_dialog.`;
    }

    function throwIfDialog(browser) {
      const win = openDialog(browser);
      if (!win) return;
      const error = new DialogOpen(describeDialog(win));
      error.browser = browser;
      throw error;
    }

    // adada "sayfa onay istiyor"; diyalog kapanınca (Claude ya da kullanıcı cevaplayınca) kalkar
    async function showDialog(browser) {
      const dialog = openDialog(browser);
      if (!dialog || !island) return;
      const { promptType, text: message } = dialog.Dialog.args;
      const kind = {
        alert: L("shows an alert", "uyarı gösteriyor"),
        prompt: L("asks you for text", "senden bir metin istiyor"),
      }[promptType.replace(/Check$/, "")] ?? L("asks for confirmation", "onay istiyor");
      let host = "";
      try { host = browser.currentURI.host; } catch {}
      island.dialog(browser, `${host} — ${L("the page", "sayfa")} ${kind}`, message);
      while (openDialog(browser) && island?.state === "dialog") await sleep(500);
      island?.dialogEnded();
    }

    // ---- durdurma: kullanıcı adadan (ya da Ctrl+Shift+Esc ile) Claude'u durdurur ----
    //
    // Süren beklemeler (sayfa cevabı, yükleme, ask_user) hemen kesilir; "Devam et"e basılana
    // kadar sekmelere dokunan her tool reddedilir. Durum reload'da korunur.
    class Stopped extends Error {
      constructor() {
        super("The user stopped browser automation from the browser's island. Nothing can be done in the browser until they press \"Resume\" there; ask the user what they want.");
      }
    }
    async function guard(promise) {
      if (state.paused) throw new Stopped();
      return operation ? operation.race(promise) : promise;
    }

    function operationSleep(ms) {
      if (state.paused) throw new Stopped();
      return operation ? operation.wait(ms, { setTimeout, clearTimeout }) : sleep(ms);
    }

    function stopClaude() {
      if (state.paused) return;
      state.paused = true;
      stopGeneration++;
      operation?.cancel(new Stopped());
      // sayfada bekleyen ask_user çizimini kaldır
      for (const tab of liveTabs()) {
        cancelAsk(tab.linkedBrowser, "stopped");
      }
      island?.stopped();
    }

    function resumeClaude() {
      state.paused = false;
      island?.resumed();
    }

    // Adada evet/hayır sorusu (sekme isteği, işlem izni); "done", "cancelled" ya da "timeout"
    async function askIsland(browser, text, message, labels, timeout = 120) {
      if (tabRequests.has(browser)) throw new Error("Bu sekmede zaten bekleyen bir soru var.");
      const answered = new Promise(resolve => tabRequests.set(browser, resolve));
      island?.ask(browser, text, message, true, labels);
      const notified = notifyAsk(browser, message);
      const timer = new Cancellation();
      try {
        return await guard(Promise.race([answered, timer.wait(timeout * 1000, { setTimeout, clearTimeout }).then(() => "timeout")]));
      } finally {
        timer.cancel();
        tabRequests.delete(browser);
        island?.askEnded();
        if (notified) {
          try { alerts.closeAlert(ALERT_NAME); } catch {}
        }
      }
    }

    // adadaki Tamam/Vazgeç: bekleyen soruya ya da ask_user'a
    const tabRequests = new Map(); // browser → resolve
    function answerIsland(browser, result) {
      const resolve = tabRequests.get(browser);
      if (resolve) resolve(result);
      else cancelAsk(browser, result);
    }

    // bekleyen ask_user'ı bu sonuçla bitirir (adadaki Tamam/Vazgeç, durdurma) ve çerçeveyi kaldırır
    function cancelAsk(browser, result = "cancelled") {
      try {
        browser.browsingContext.currentWindowGlobal.getActor("ZenMcp").sendAsyncMessage("cancel_ask", { result });
      } catch {}
    }

    // ask_user gelince Zen odakta değilse masaüstü bildirimi; tıklayınca sekmeye gider
    const AlertNotification = Components.Constructor("@mozilla.org/alert-notification;1", "nsIAlertNotification", "initWithObject");
    const alerts = Cc["@mozilla.org/alerts-service;1"].getService(Ci.nsIAlertsService);
    const ALERT_NAME = "zen-mcp-ask";

    function notifyAsk(browser, message) {
      const win = browser.ownerDocument.defaultView;
      if (Services.focus.activeWindow === win) return false;
      try {
        const alert = new AlertNotification({ name: ALERT_NAME, title: L(`${activeAgent.name} needs you`, `${activeAgent.name} senden bir şey istiyor`), text: message, textClickable: true });
        alerts.showAlert(alert, (_subject, topic) => {
          if (topic === "alertclickcallback") goToTab(browser);
        });
        return true;
      } catch (e) {
        logError("bildirim", e);
        return false;
      }
    }

    function goToTab(browser) {
      const win = browser.ownerDocument.defaultView;
      const tab = win.gBrowser.getTabForBrowser(browser);
      if (tab) win.gBrowser.selectedTab = tab;
      win.focus();
    }

    let island = null;
    let activeCalls = 0; // adayı gösteren, sürmekte olan tool çağrıları

    // adada görünen kısa açıklama: "seaskablo.com — tıklıyor"
    function describeAction(tool, args, browser) {
      let host = "";
      try { host = browser.currentURI.host; } catch {}
      const what = {
        navigate: () => {
          if (args.url === "back") return L("going back", "geri gidiyor");
          if (args.url === "forward") return L("going forward", "ileri gidiyor");
          try { host = Services.uriFixup.getFixupURIInfo(args.url).preferredURI.host; } catch {}
          return L("opening the page", "sayfayı açıyor");
        },
        computer: () => ({
          screenshot: L("looking at the page", "ekrana bakıyor"), left_click: L("clicking", "tıklıyor"),
          right_click: L("right-clicking", "sağ tıklıyor"), double_click: L("double-clicking", "çift tıklıyor"),
          triple_click: L("clicking", "tıklıyor"), hover: L("hovering", "fareyi gezdiriyor"),
          left_click_drag: L("dragging", "sürüklüyor"), scroll: L("scrolling", "kaydırıyor"),
          scroll_to: L("scrolling", "kaydırıyor"), type: L("typing", "yazıyor"), key: L("pressing keys", "tuşa basıyor"),
          wait: L("waiting", "bekliyor"),
        })[args.action] ?? L("working", "çalışıyor"),
        read_page: () => L("reading the page", "sayfayı okuyor"),
        get_page_text: () => L("reading the page", "sayfayı okuyor"),
        find: () => L(`looking for "${args.query}"`, `"${args.query}" arıyor`),
        form_input: () => "formu dolduruyor",
        file_upload: () => L("uploading a file", "dosya yüklüyor"),
        javascript_tool: () => L("running code on the page", "sayfada kod çalıştırıyor"),
        read_console_messages: () => "konsolu okuyor",
        read_network_requests: () => L("checking network requests", "ağ isteklerine bakıyor"),
        handle_dialog: () => L("answering a dialog", "diyaloğu cevaplıyor"),
        ask_user: () => L("needs you", "senden bir şey istiyor"),
        request_tab: () => L("asks for this tab", "sekmeye erişmek istiyor"),
        tabs_close_mcp: () => L("closing the tab", "sekmeyi kapatıyor"),
        wait_for: () => L("waiting", "bekliyor"),
      }[tool]?.() ?? L("working", "çalışıyor");
      return host ? `${host} — ${what}` : what;
    }

    // frame: sekmedeki bir alt çerçevenin BrowsingContext'i (varsayılan üst çerçeve)
    async function query(browser, name, data, timeout = 30000, frame = browser.browsingContext) {
      if (state.paused) throw new Stopped();
      operation?.check();
      const scope = operation;
      const wg = frame?.currentWindowGlobal;
      if (!wg) throw new Error("The page has not loaded yet.");
      throwIfDialog(browser);
      let done = false;
      const actor = wg.getActor("ZenMcp");
      const requestId = ++querySequence;
      const watcher = new Cancellation();
      const cancelActor = () => {
        try { actor.sendAsyncMessage("cancel_operation", { requestId }); } catch {}
      };
      const off = scope?.onCancel(cancelActor);
      const watchDialog = (async () => {
        while (!done) {
          await watcher.wait(250, { setTimeout, clearTimeout });
          if (done) return;
          throwIfDialog(browser);
          if (frame.currentWindowGlobal !== wg) throw new PageGone("The page changed.");
          if (!state.tabs.has(browser.browserId)) throw new Error("The user took this tab back from the agent; you can't use it anymore.");
        }
      })();
      try {
        const result = await guard(Promise.race([
          actor.sendQuery(name, { ...data, agent: activeAgent, requestId }),
          watchDialog,
          watcher.wait(timeout, { setTimeout, clearTimeout }).then(() => { throw new Error(`The page did not respond within ${timeout / 1000} s.`); }),
        ]));
        scope?.check();
        if (result?.error) throw new Error(shortRefs(result.error));
        return result;
      } finally {
        done = true;
        off?.();
        cancelActor();
        watcher.cancel();
      }
    }

    // read_page'in "{{frame:<id>}}" satırlarını o çerçevenin ağacıyla değiştirir (iç içe de)
    async function expandFrames(browser, value, opts, level = 0) {
      const parts = [];
      let last = 0;
      for (const m of value.matchAll(/^( *)\{\{frame:(\d+)\}\}$/gm)) {
        parts.push(value.slice(last, m.index));
        last = m.index + m[0].length;
        const indent = m[1];
        const bc = bcById(browser, Number(m[2]));
        const wg = bc?.currentWindowGlobal;
        if (!wg || bc.top !== browser.browsingContext || level > 6) {
          parts.push(`${indent}(iframe not loaded)`);
          continue;
        }
        let inner;
        try {
          ({ value: inner } = await query(browser, "read_page", { ...opts, bare: true }, 30000, bc));
          inner = await expandFrames(browser, inner, opts, level + 1);
        } catch (e) {
          if (e instanceof DialogOpen) throw e;
          inner = `(could not read: ${e?.message ?? e})`;
        }
        const body = inner ? inner.split("\n").map(line => indent + line).join("\n") : `${indent}(no visible elements)`;
        parts.push(`${indent}[iframe ${wg.documentURI?.spec ?? ""}]\n${body}`);
      }
      parts.push(value.slice(last));
      return parts.join("");
    }

    const MAX_PAGE_TEXT = 100000;

    // ---- ayarlar: ~/.config/<ad>/config.json ----
    //
    // mode: "auto" (Claude sormadan işlem yapar) ya da "ask" (her işlemde adadan izin ister).
    // sensitive: alan adları; bu sitelerde mod ne olursa olsun her işlemde izin istenir
    // ("garanti.com.tr" alt alan adlarını da kapsar). Dosya değişince kendiliğinden okunur.
    const CONFIG_PATH = `${Services.env.get("XDG_CONFIG_HOME") || Services.env.get("HOME") + "/.config"}/${zenMcpApp}/config.json`;
    const DEFAULT_CONFIG = { mode: "auto", sensitive: [] };
    let config = { ...DEFAULT_CONFIG };
    let configTime = -1;

    function readConfig() {
      const file = localFile(CONFIG_PATH);
      if (!file.exists()) {
        config = { ...DEFAULT_CONFIG };
        configTime = 0;
        return config;
      }
      if (file.lastModifiedTime === configTime) return config;
      configTime = file.lastModifiedTime;
      try {
        const stream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
        stream.init(file, 0x01, 0, 0);
        const raw = NetUtil.readInputStreamToString(stream, stream.available(), { charset: "UTF-8" });
        stream.close();
        const parsed = JSON.parse(raw);
        config = {
          mode: parsed.mode === "ask" ? "ask" : "auto",
          sensitive: Array.isArray(parsed.sensitive) ? parsed.sensitive.map(s => String(s).toLowerCase().replace(/^\*?\./, "")) : [],
        };
        island?.setMode(config.mode);
      } catch (e) {
        logError("ayarlar", e);
      }
      return config;
    }

    function writeConfig(changes) {
      const next = { ...readConfig(), ...changes };
      const file = localFile(CONFIG_PATH);
      if (!file.parent.exists()) file.parent.create(Ci.nsIFile.DIRECTORY_TYPE, 0o700);
      const out = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
      out.init(file, 0x02 | 0x08 | 0x20, 0o600, 0); // yaz | oluştur | sıfırla
      const bytes = unescape(encodeURIComponent(JSON.stringify(next, null, 2) + "\n"));
      out.write(bytes, bytes.length);
      out.close();
      config = next;
      configTime = file.lastModifiedTime;
    }

    function toggleMode() {
      writeConfig({ mode: readConfig().mode === "ask" ? "auto" : "ask" });
      island?.setMode(config.mode);
    }

    const hostOf = browser => {
      try { return browser.currentURI.host; } catch { return ""; }
    };
    const isSensitive = host => !!host && readConfig().sensitive.some(d => host === d || host.endsWith("." + d));

    // ---- izin: onaylı modda ya da hassas sitede işlem öncesi adadan sorulur ----

    const actionVerb = action => ({
      left_click: L("click", "tıklamak"), right_click: L("right-click", "sağ tıklamak"),
      double_click: L("double-click", "çift tıklamak"), triple_click: L("triple-click", "üç kez tıklamak"),
      left_click_drag: L("drag", "sürüklemek"), type: L("type", "yazmak"), key: L("press keys", "tuşa basmak"),
    })[action];

    // izin gerektiren işlemse kısa tarif ("button "Gönder"'e tıklamak"), değilse null
    async function describeWrite(tool, args, browser) {
      const target = async () => {
        try {
          if (args.ref) return (await queryRef(browser, "describe", { ref: longRef(args.ref) })).value;
          if (args.coordinate) {
            const [x, y] = toPagePoint(browser, args.coordinate);
            const inner = await deepest(browser, x, y);
            return (await query(browser, "describe", { x: inner.x, y: inner.y }, 30000, inner.frame)).value;
          }
        } catch (e) {
          if (e instanceof DialogOpen || e instanceof Stopped) throw e;
        }
        return args.ref ?? L("an element", "bir öğe");
      };
      const quote = (t, n = 80) => `"${String(t).length > n ? String(t).slice(0, n - 1) + "…" : t}"`;
      switch (tool) {
        case "computer": {
          const verb = actionVerb(args.action);
          if (!verb) return null;
          if (args.action === "type") return L(`type ${quote(args.text ?? "")}`, `${quote(args.text ?? "")} yazmak`);
          if (args.action === "key") return L(`press ${args.text}`, `${args.text} tuşuna basmak`);
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

    // Bu çağrı izin ister mi: onaylı modda her işlem, hassas sitede gezinme dışındaki işlemler
    function needsPermission(tool, browser) {
      if (readConfig().mode === "ask") return true;
      return tool !== "navigate" && isSensitive(hostOf(browser));
    }

    // izin verilmezse hata; steps: [{ tool, args, what? }] (toplu çağrı tek soruda; what
    // verilmişse yeniden tarif edilmez)
    async function requirePermission(browser, steps) {
      const lines = [];
      for (const { tool, args, what: known } of steps) {
        if (!needsPermission(tool, browser)) continue;
        const what = known === undefined ? await describeWrite(tool, args, browser) : known;
        if (what) lines.push(what);
      }
      if (!lines.length) return;
      const host = hostOf(browser);
      const why = isSensitive(host) ? L(" (sensitive site)", " (hassas site)") : "";
      const message = lines.length === 1
        ? L(`${activeAgent.name} wants to: ${lines[0]}`, `${activeAgent.name} şunu yapmak istiyor: ${lines[0]}`)
        : L(`${activeAgent.name} wants to:`, `${activeAgent.name} şunları yapmak istiyor:`) + `\n${lines.map(l => `• ${l}`).join("\n")}`;
      const result = await askIsland(browser, `${host ? host + " — " : ""}${L("asks for permission", "izin istiyor")}${why}`, message,
        { ok: L("Allow", "İzin ver"), cancel: L("Deny", "Verme") });
      if (result !== "done") {
        throw new Error(result === "timeout"
          ? "The user did not answer the permission request; nothing was done."
          : "The user denied this action; nothing was done. Ask the user what they want.");
      }
    }

    // ---- tool'lar: hepsi MCP içerik dizisi döner ----

    // tek satır JSON: girinti her çağrıda boşuna token
    const text = t => [{ type: "text", text: shortRefs(typeof t === "string" ? t : JSON.stringify(t)) }];

    const tools = {
      async tabs_context_mcp({ createIfEmpty }) {
        let tabs = liveTabs();
        if (!tabs.length && createIfEmpty) tabs = [await createTab()];
        if (!tabs.length) return text("The agent has no tabs. Open one with createIfEmpty: true or tabs_create_mcp.");
        return text({ tabs: tabs.map(describeTab) });
      },

      async tabs_create_mcp() {
        return text(describeTab(await createTab()));
      },

      // Claude'un açtığı sekme kapanır; kullanıcının verdiği sekme kapanmaz, kullanıcıya geri verilir
      async tabs_close_mcp({ tabId }) {
        const tab = browserFor(tabId) && findTab(tabId);
        const given = tab.getAttribute(MARK) === "user";
        unmark(tab);
        if (given) return text(`Tab ${tabId} belongs to the user; not closed, given back to them.`);
        tab.ownerDocument.defaultView.gBrowser.removeTab(tab, { animate: false, skipPermitUnload: true });
        return text(`Tab ${tabId} closed.`);
      },

      // Birkaç tool çağrısı tek seferde, sırayla; ilk hatada durur. Metin cevapları tek blokta
      // birleşir (her biri ayrı içerik olmasın), görüntüler sırasıyla araya girer.
      async browser_batch({ actions }) {
        if (!Array.isArray(actions) || !actions.length) throw new Error("actions is empty.");
        // izin gereken adımlar sekme başına tek soruda
        const byTab = new Map();
        for (const { name, input = {} } of actions) {
          if (!tools[name] || !state.tabs.has(input.tabId)) continue;
          if (!byTab.has(input.tabId)) byTab.set(input.tabId, []);
          byTab.get(input.tabId).push({ tool: name, args: input });
        }
        for (const [tabId, steps] of byTab) {
          const browser = findTab(tabId)?.linkedBrowser;
          if (browser) await requirePermission(browser, steps);
        }
        const content = [];
        let lines = [];
        const flush = () => {
          if (lines.length) content.push({ type: "text", text: lines.join("\n") });
          lines = [];
        };
        for (const [i, { name, input = {} }] of actions.entries()) {
          const label = `[${i + 1}] ${name}`;
          const left = actions.length - i - 1;
          const rest = left ? ` The remaining ${left} step(s) did not run.` : "";
          if (name === "browser_batch" || !tools[name]) {
            content.isError = true;
            lines.push(`${label}: ${name === "browser_batch" ? "browser_batch cannot be nested" : "unknown tool"}.${rest}`);
            break;
          }
          try {
            for (const c of await runTool(name, input, { approved: true })) {
              if (c.type === "text") lines.push(`${label}: ${c.text}`);
              else {
                lines.push(`${label}:`);
                flush();
                content.push(c);
              }
            }
          } catch (e) {
            content.isError = true;
            if (e instanceof DialogOpen) {
              lines.push(`${label}: ${e.message}${rest}`);
              if (e.browser) showDialog(e.browser);
            } else {
              lines.push(`${label}: HATA: ${e?.message ?? e}${rest}`);
            }
            break;
          }
        }
        flush();
        return content;
      },

      async navigate({ url, tabId }) {
        const browser = browserFor(tabId);
        const loaded = waitForLoad(browser, 20000, url === "back" || url === "forward" ? null : url);
        if (url === "back") browser.goBack();
        else if (url === "forward") browser.goForward();
        else {
          browser.fixupAndLoadURIString(url, {
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
          });
        }
        await guard(loaded);
        const tab = browser.ownerDocument.defaultView.gBrowser.getTabForBrowser(browser);
        return text(describeTab(tab));
      },

      async computer(args) {
        const browser = browserFor(args.tabId);
        const need = key => {
          if (args[key] == null) throw new Error(`${args.action} needs ${key}.`);
          return args[key];
        };
        switch (args.action) {
          case "screenshot": {
            const shot = await screenshot(browser, args.scale);
            // diyalog tarayıcı arayüzünde çizilir, sayfanın görüntüsünde çıkmaz
            const dialog = openDialog(browser);
            return [
              { type: "image", data: shot.data, mimeType: "image/jpeg" },
              { type: "text", text: `${shot.width}x${shot.height}, tabId ${browser.browserId}${dialog ? `\n${describeDialog(dialog)}` : ""}` },
            ];
          }
          case "left_click":
            await click(browser, await target(browser, args), { modifiers: args.text });
            break;
          case "right_click":
            await click(browser, await target(browser, args), { button: 2, modifiers: args.text });
            break;
          case "double_click":
            await click(browser, await target(browser, args), { count: 2, modifiers: args.text });
            break;
          case "triple_click":
            await click(browser, await target(browser, args), { count: 3, modifiers: args.text });
            break;
          case "hover": {
            const [x, y] = await target(browser, args);
            await input(browser, { kind: "hover", x, y });
            break;
          }
          case "left_click_drag": {
            const [x, y] = await target(browser, args, "start_coordinate");
            await input(browser, { kind: "drag", x, y, to: await target(browser, args) });
            break;
          }
          case "scroll":
            await scroll(browser, await target(browser, args), need("scroll_direction"), args.scroll_amount);
            break;
          case "scroll_to":
            await target(browser, { ...args, ref: need("ref") });
            break;
          case "type":
            await typeInFocus(browser, { kind: "text", text: need("text") });
            break;
          case "key":
            for (let i = 0; i < (args.repeat || 1); i++) await pressKeys(browser, need("text"));
            break;
          case "wait":
            await operationSleep(Math.min(need("duration"), 30) * 1000);
            break;
          default:
            throw new Error(`Unsupported action: ${args.action}`);
        }
        // olayların sayfada işlenmesine kısa süre tanı
        await operationSleep(100);
        return text(`${args.action} done.`);
      },

      // iframe'lerin metni sayfanın metninin ardından, kaynağıyla
      async get_page_text({ tabId }) {
        const browser = browserFor(tabId);
        const page = await query(browser, "text");
        let out = `${page.title}\n${page.url}\n\n${page.text}`;
        for (const bc of framesOf(browser).slice(1)) {
          if (out.length > MAX_PAGE_TEXT) break;
          try {
            const frame = await query(browser, "text", {}, 30000, bc);
            if (frame.text.trim()) out += `\n\n[iframe ${frame.url}]\n${frame.text}`;
          } catch (e) {
            if (e instanceof DialogOpen) throw e;
          }
        }
        if (out.length > MAX_PAGE_TEXT) out = out.slice(0, MAX_PAGE_TEXT) + "\n…(truncated)";
        return text(out);
      },

      async read_page({ tabId, filter, depth, ref_id, max_chars = 50000 }) {
        const browser = browserFor(tabId);
        const frame = frameOf(browser, ref_id);
        const opts = { filter, depth, max_chars };
        let { value } = await query(browser, "read_page", { ...opts, ref_id: longRef(ref_id), bare: frame !== browser.browsingContext }, 30000, frame);
        value = shortRefs(await expandFrames(browser, value, opts));
        if (value.length > max_chars) {
          value = value.slice(0, value.lastIndexOf("\n", max_chars)) + `\n…(truncated at ${max_chars} characters; focus on a subtree with ref_id)`;
        }
        return text(value);
      },

      // bütün çerçevelerde arar, sonuçları puana göre birleştirir
      async find({ tabId, query: q }) {
        const browser = browserFor(tabId);
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
        return text(shortRefs(results.slice(0, 20).map(r => r.line).join("\n")));
      },

      // Metin/seçici görünene (gone: kaybolana) ve/veya ağ durulana kadar bekler. Yoklamayla
      // çalışır: beklerken sayfa değişse (ör. form gönderildi) de sürer. Bütün çerçevelere bakar.
      async wait_for({ tabId, text: wanted, selector, gone = false, network_idle = false, timeout = 10 }) {
        const browser = browserFor(tabId);
        if (!wanted && !selector && !network_idle) throw new Error("text, selector or network_idle is required.");
        if (selector) {
          try { browser.ownerDocument.createDocumentFragment().querySelector(selector); } catch {
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
                // sayfa yüklenirken çerçeve yok ya da değişti: sonraki turda yeniden
                if (e instanceof DialogOpen || e instanceof Stopped) throw e;
              }
            }
            ok = gone ? !found : found;
          }
          if (ok && network_idle) {
            // 10 sn'den uzun süren istekler (uzun yoklama, akış) sayılmaz
            const now = Date.now();
            const busy = (network.get(browser.browserId)?.list ?? []).some(r => r.duration == null && !r.error && now - r.start < 10000);
            if (busy) quietSince = null;
            else quietSince ??= now;
            ok = !busy && now - quietSince >= 500;
          }
          const elapsed = Date.now() - start;
          if (ok) return text(`Done (${(elapsed / 1000).toFixed(1)} s).`);
          if (elapsed >= limit) throw new Error(`Not met within ${Math.min(timeout, 60)} s.`);
          await operationSleep(250);
        }
      },

      async form_input({ tabId, ref, value }) {
        const { value: result } = await queryRef(browserFor(tabId), "form_input", { ref: longRef(ref), value });
        return text(result);
      },

      // Claude'un kullanıcıya bırakması gereken adımlar (onay, captcha, giriş...): öğeyi
      // çerçevele, mesajı göster, sekmeyi öne getir (kullanıcının orada bir şey yapması
      // gerekiyor), cevabı bekle
      // Sekme öne getirilmez: ada genişleyip mesajı ve "Sekmeye git"i gösterir, Zen odakta
      // değilse masaüstü bildirimi de gider. Sayfadaki çerçeve ve baloncuk sekmede hazır bekler.
      async ask_user({ tabId, ref, coordinate, message, wait = "done", timeout = 300 }) {
        const browser = browserFor(tabId);
        const [x, y] = coordinate ? toPagePoint(browser, coordinate) : [];
        island?.ask(browser, describeAction("ask_user", {}, browser), message, wait !== "click");
        const notified = notifyAsk(browser, message);
        let result;
        try {
          ({ value: result } = await query(browser, "ask_user", { ref: longRef(ref), x, y, message, wait, timeout }, (timeout + 10) * 1000, frameOf(browser, ref)));
        } catch (e) {
          if (!(e instanceof PageGone)) throw e;
          result = "navigated";
        } finally {
          island?.askEnded();
          if (notified) {
            try { alerts.closeAlert(ALERT_NAME); } catch {}
          }
        }
        return text({
          clicked: "The user clicked the outlined element.",
          done: "The user pressed OK.",
          cancelled: "The user cancelled.",
          timeout: `The user did not answer within ${timeout} s.`,
          navigated: "The page changed (the user may have done something); check with a screenshot.",
          replaced: "A newer ask_user replaced this one.",
          taken_back: "The user took this tab back from the agent; you can't use it anymore.",
        }[result] ?? String(result));
      },

      // Kullanıcının öğe seçip gönderdiği, Claude'da olmayan sekmeye erişim ister: adada "Ver /
      // Verme", Zen odakta değilse masaüstü bildirimi. Ver denirse sekme sağ tık menüsünden
      // verilmiş gibi işaretlenir.
      async request_tab({ tabId, reason, timeout = 120 }) {
        if (state.tabs.has(tabId)) return text({ ...describeTab(findTab(tabId)), note: "The tab is already assigned to an agent." });
        const tab = findTab(tabId);
        if (!tab) throw new Error(`Tab ${tabId} is closed.`);
        if (!state.pickedTabs.has(tabId)) {
          throw new Error(`Tab ${tabId} can't be requested: only tabs the user picked an element from (source_tab in a channel event).`);
        }
        const browser = tab.linkedBrowser;
        const result = await askIsland(browser, describeAction("request_tab", {}, browser),
          L(`${activeAgent.name} wants access to this tab: ${reason}`, `${activeAgent.name} bu sekmeye erişmek istiyor: ${reason}`),
          { ok: L("Allow", "Ver"), cancel: L("Deny", "Verme") }, timeout);
        if (result !== "done") {
          return text(result === "timeout" ? `The user did not answer within ${timeout} s.` : "The user declined.");
        }
        if (!tab.isConnected) throw new Error("The tab was closed meanwhile.");
        mark(tab, "user");
        return text({ ...describeTab(tab), note: "The user granted the tab." });
      },

      async file_upload({ tabId, ref, paths }) {
        const browser = browserFor(tabId);
        const mime = Cc["@mozilla.org/mime;1"].getService(Ci.nsIMIMEService);
        // autoconfig bağlamında IOUtils yok; tarayıcı penceresininki kullanılır
        const { IOUtils } = browser.ownerDocument.defaultView;
        let total = 0;
        const files = [];
        for (const path of paths) {
          const file = localFile(path);
          if (!file.exists() || !file.isFile()) throw new Error(`No such file: ${path}`);
          total += file.fileSize;
          if (total > MAX_UPLOAD) throw new Error(`Files exceed ${MAX_UPLOAD / 1048576} MB in total.`);
          let type = "application/octet-stream";
          try { type = mime.getTypeFromFile(file); } catch {}
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
        return text(`${promptType} "${message}" ${accept ? "kabul edildi" : "iptal edildi"}${answer != null && accept ? ` (metin: "${answer}")` : ""}.`);
      },

      read_network_requests({ tabId, urlPattern, limit = 100, clear, id, max_chars = 20000 }) {
        const browser = browserFor(tabId);
        const log = network.get(browser.browserId);
        if (id != null) {
          const r = log?.list.find(r => r.id === id);
          if (!r) return text(`No request #${id} (the log is cleared when the page moves to another site); take ids from the list.`);
          return requestDetails(browser, r, max_chars).then(text);
        }
        let list = log?.list ?? [];
        if (urlPattern) list = list.filter(r => r.url.includes(urlPattern));
        const lines = list.slice(-limit).map(r => {
          const status = r.error ?? (r.status ?? (r.duration == null ? "pending" : "no response"));
          const extra = [r.type, r.mime, r.cached && "cached", r.duration != null && `${r.duration} ms`].filter(Boolean).join(", ");
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

      async read_console_messages({ tabId, onlyErrors, pattern, limit, clear }) {
        const { value } = await query(browserFor(tabId), "console", { onlyErrors, pattern, limit, clear });
        return text(value);
      },

      async javascript_tool({ text: code, tabId }) {
        const { value } = await query(browserFor(tabId), "eval", { code });
        return text(value);
      },
    };

    // geliştirme komutları: MCP'ye açılmaz, scripts/zenctl.ts kullanır
    // yüklü tarayıcı dosyalarının sürümü (kurulum .version yazar; geliştirmede bağ, dosya yok)
    function fileVersion() {
      try {
        const f = localFile(dir + "/.version");
        if (!f.exists()) return "dev";
        const stream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
        stream.init(f, 0x01, 0, 0);
        const v = NetUtil.readInputStreamToString(stream, stream.available()).trim();
        stream.close();
        return v;
      } catch {
        return "?";
      }
    }
    const loadedVersion = fileVersion();

    const commands = {
      // CLI (doctor, güncelleme) için: hangi dosya sürümü yüklü, hangi tarayıcı
      ping() {
        return text({ app: zenMcpApp, version: loadedVersion, onDisk: fileVersion(), browser: Services.appinfo.name, browserVersion: Services.appinfo.version });
      },
      reload() {
        // cevap yazıldıktan sonra yeniden yükle
        Services.tm.dispatchToMainThread(() => {
          stop();
          try {
            Services.scriptloader.loadSubScript("resource://zenmcp/main.js?" + Date.now(), { zenMcpDir: dir, zenMcpName: zenMcpApp });
          } catch (e) {
            logError("reload", e);
          }
          // yeni sürüm başlamadıysa soket de yok: köprü tarayıcı yeniden başlayana kadar
          // ölü kalmasın, yarım kurulumu temizleyip bu sürümü yeniden başlat
          if (!(globalThis.zenMcpRunning > version)) {
            logError("reload", new Error(`new version did not start, staying on v${version}`));
            try { globalThis.zenMcpStop?.(); } catch {}
            start();
            globalThis.zenMcpStop = stop;
            globalThis.zenMcpRunning = version;
          }
        });
        return text(`v${version} stopping, reloading.`);
      },
      // sistem bağlamında eval() yasak; Marionette gibi sistem principal'lı sandbox kullan.
      // code bir ifade olmalı; yardımcılar h üzerinden: h.browserFor(id), h.query(browser, ...), h.state...
      async chrome_eval({ code }) {
        const sandbox = Cu.Sandbox(Services.scriptSecurityManager.getSystemPrincipal(), {
          sandboxName: "zen-mcp chrome_eval",
          wantComponents: true,
          wantGlobalProperties: ["ChromeUtils"],
        });
        sandbox.Services = Services;
        sandbox.h = {
          version, state, tools, browserFor, findTab, liveTabs, toPagePoint, screenshot, query,
          stopClaude, resumeClaude,
          island, subscribers, channelTarget, startPick, sendPick, endPick, pageQuery, target, mark, input,
          get pick() { return pick; },
        };
        const value = await Cu.evalInSandbox(`(async () => (${code}))()`, sandbox, null, "chrome_eval", 1);
        return text(value === undefined ? "undefined" : value);
      },
    };

    // ---- soket ----

    // JSON'u saf ASCII'ye çevir: iki uçta da karakter kodlamasıyla uğraşmayalım
    const ascii = s => s.replace(/[\u007f-￿]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

    function reply(transport, output, message) {
      const stream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
      stream.setByteStringData(ascii(JSON.stringify(message)) + "\n");
      // bağlantı başına tek cevap: yazılınca soketi kapat (çıkış akışını kapatmak yetmiyor,
      // okuma pompası açık kaldıkça bağlantı kapanmaz)
      NetUtil.asyncCopy(stream, output, () => transport.close(Cr.NS_OK));
    }

    // durdurulmuşsa reddeder, sürerken adada ne yapıldığını gösterir
    // approved: toplu çağrıda izin baştan alındı
    async function runTool(tool, args, { approved = false } = {}) {
      if (state.paused) throw new Stopped();
      const browser = state.tabs.has(args.tabId) ? findTab(args.tabId)?.linkedBrowser : null;
      const entry = { t: new Date().toISOString(), tool };
      if (args.action && tool === "computer") entry.action = args.action;
      if (browser) {
        paintTab(findTab(args.tabId), activeAgent);
        entry.agent = activeAgent.name;
        entry.tab = args.tabId;
        entry.host = hostOf(browser);
        island?.working(browser, describeAction(tool, args, browser));
        activeCalls++;
      }
      try {
        if (browser && tool !== "browser_batch") {
          const what = await describeWrite(tool, args, browser);
          if (what) entry.what = what;
          if (!approved) await requirePermission(browser, [{ tool, args, what }]);
        }
        operation?.check();
        const result = await tools[tool](args);
        // Preserve completed steps and the cancellation error from a partial batch.
        if (!result?.isError) operation?.check();
        if (tool === "navigate" && browser) entry.to = browser.currentURI?.spec;
        return result;
      } catch (e) {
        entry.error = String(e?.message ?? e).slice(0, 200);
        throw e;
      } finally {
        if (browser && --activeCalls === 0) island?.idle();
        if (tool !== "browser_batch") logActivity(entry);
      }
    }

    // ---- etkinlik günlüğü: ~/.local/state/<ad>/activity.jsonl, satır başına bir çağrı ----
    // (5 MB'ı geçince activity.1.jsonl'e taşınır)
    const ACTIVITY_PATH = `${Services.env.get("XDG_STATE_HOME") || Services.env.get("HOME") + "/.local/state"}/${zenMcpApp}/activity.jsonl`;
    const MAX_ACTIVITY = 5 * 1048576;

    function logActivity(entry) {
      try {
        const file = localFile(ACTIVITY_PATH);
        if (!file.parent.exists()) file.parent.create(Ci.nsIFile.DIRECTORY_TYPE, 0o700);
        if (file.exists() && file.fileSize > MAX_ACTIVITY) file.moveTo(null, "activity.1.jsonl");
        const out = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
        out.init(localFile(ACTIVITY_PATH), 0x02 | 0x08 | 0x10, 0o600, 0); // yaz | oluştur | sona ekle
        const bytes = unescape(encodeURIComponent(JSON.stringify(entry) + "\n"));
        out.write(bytes, bytes.length);
        out.close();
      } catch (e) {
        logError("activity log", e);
      }
    }

    async function handle(line, transport, output) {
      let message;
      try {
        const { tool, args = {}, session, agent } = JSON.parse(line);
        const fn = tools[tool] || commands[tool];
        if (!fn) throw new Error(`Bilinmeyen tool: ${tool}`);
        if (session && tools[tool]) lastUse.set(session, Date.now());
        if (tools[tool]) {
          if (state.paused) throw new Stopped();
          const generation = stopGeneration;
          const pending = toolQueue.then(async () => {
            if (generation !== stopGeneration || state.paused) throw new Stopped();
            const scope = operation = new Cancellation();
            activeAgent = agentTheme(agent ?? { id: "claude" });
            globalThis.zenMcpActiveAgent = { id: activeAgent.id, name: activeAgent.name };
            island?.setAgent(activeAgent);
            try { return await runTool(tool, args); }
            finally { scope.cancel(); if (operation === scope) operation = null; }
          });
          toolQueue = pending.catch(() => {});
          const content = await pending;
          message = { ok: true, content, ...(content.isError ? { isError: true } : {}) };
        } else message = { ok: true, content: await fn(args) };
      } catch (e) {
        // diyalog bir hata değil, Claude'un bilmesi gereken durum
        if (e instanceof DialogOpen) {
          message = { ok: true, content: text(e.message) };
          if (e.browser) showDialog(e.browser);
        } else {
          message = { ok: false, error: String(e?.message ?? e) };
        }
      }
      try { reply(transport, output, message); } catch (e) { logError("reply", e); }
    }

    function onConnection(transport) {
      const input = transport.openInputStream(0, 0, 0);
      // tamponsuz: asyncCopy ancak veri sokete yazılınca biter, ardından kapatmak güvenli
      // (tamponluyken kapatma, boşalmamış kısmı kesiyordu)
      const output = transport.openOutputStream(Ci.nsITransport.OPEN_UNBUFFERED, 0, 0);
      const pump = Cc["@mozilla.org/network/input-stream-pump;1"].createInstance(Ci.nsIInputStreamPump);
      pump.init(input, 0, 0, false);
      let buffer = "";
      let handled = false;
      let session = null; // abone bağlantısıysa
      pump.asyncRead({
        onStartRequest() {},
        onDataAvailable(_request, stream, _offset, count) {
          buffer += NetUtil.readInputStreamToString(stream, count);
          let end;
          while ((end = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, end);
            buffer = buffer.slice(end + 1);
            let request = null;
            try { request = JSON.parse(line); } catch {}
            if (session) { acknowledge(session, transport, request); continue; }
            if (handled) return;
            handled = true;
            if (request?.tool !== "subscribe") { handle(line, transport, output); return; }
            try {
              session = subscribe(request.args ?? {}, transport, output);
            } catch (e) {
              reply(transport, output, { ok: false, error: String(e?.message ?? e) });
            }
          }
        },
        onStopRequest() {
          if (session) unsubscribe(session, transport);
        },
      });
    }

    let server = null;

    function start() {
      sss.loadAndRegisterSheet(markSheet, sss.USER_SHEET);
      const { Island } = ChromeUtils.importESModule(`resource://zenmcp/Island.sys.mjs?v=${version}`);
      island = new Island(
        {
          stop: stopClaude,
          resume: resumeClaude,
          goTo: goToTab,
          answer: answerIsland,
          pick: startPick,
          send: (note, targetId) => sendPick(note, targetId).catch(e => logError("send", e)),
          selectTarget: target => {
            if (!pick) return;
            pick.targetId = target?.id ?? "";
            pick.agent = target?.agent ?? agentTheme(null);
            pageQuery(pick.browser, "pick_theme", { agent: pick.agent }).catch(() => {});
          },
          cancelPick: () => endPick(),
          toggleMode,
        },
        { setTimeout, clearTimeout }
      );
      for (const win of browserWindows()) {
        island.attach(win);
        attachMenu(win);
        attachPageMenu(win);
      }
      if (state.paused) island.stopped();
      island.setMode(readConfig().mode);
      for (const topic of NETWORK_TOPICS) Services.obs.addObserver(networkObserver, topic);
      restoreMarks();
      for (const win of browserWindows()) watchWindow(win);
      Services.obs.addObserver(onWindowReady, "browser-delayed-startup-finished");
      // önceki sürüm stop() çağrılmadan kaybolduysa (ör. farklı kapsamdan yüklendiyse) kaydı kalır
      try { ChromeUtils.unregisterWindowActor("ZenMcp"); } catch {}
      ChromeUtils.registerWindowActor("ZenMcp", {
        parent: { esModuleURI: `resource://zenmcp/actors/ZenMcpParent.sys.mjs?v=${version}` },
        child: {
          esModuleURI: `resource://zenmcp/actors/ZenMcpChild.sys.mjs?v=${version}`,
          // "Claude'a göster…" için sağ tıklanan öğe
          events: { contextmenu: { capture: true, mozSystemGroup: true } },
        },
        // web sayfası süreçlerine girmesi için açık izin gerekiyor (Marionette de böyle yapıyor);
        // child yalnız parent'tan gelen mesajlara cevap verir
        safeForUntrustedWebProcess: true,
        // iframe'ler de (farklı süreçteki site dışı çerçeveler dahil)
        allFrames: true,
      });

      const file = localFile(socketPath);
      if (file.exists()) file.remove(false);
      server = Cc["@mozilla.org/network/server-socket;1"].createInstance(Ci.nsIServerSocket);
      server.initWithFilename(file, 0o600, -1);
      server.asyncListen({
        onSocketAccepted(_server, transport) {
          try { onConnection(transport); } catch (e) { logError("connection", e); }
        },
        onStopListening() {},
      });
    }

    function stop() {
      operation?.cancel(new Stopped());
      try { endPick(); } catch {}
      // aboneler yeni sürüme yeniden bağlansın
      for (const sub of subscribers.values()) {
        try { sub.transport.close(Cr.NS_OK); } catch {}
      }
      subscribers.clear();
      for (const pending of pendingDeliveries.values()) pending.finish(false);
      try { sss.unregisterSheet(markSheet, sss.USER_SHEET); } catch {}
      try { island?.destroy(); } catch {}
      island = null;
      for (const cleanup of menuCleanups) {
        try { cleanup(); } catch {}
      }
      menuCleanups.clear();
      for (const topic of NETWORK_TOPICS) {
        try { Services.obs.removeObserver(networkObserver, topic); } catch {}
      }
      try { Services.obs.removeObserver(onWindowReady, "browser-delayed-startup-finished"); } catch {}
      for (const win of browserWindows()) win.removeEventListener("SSTabRestoring", onTabRestoring);
      try { server?.close(); } catch {}
      try { ChromeUtils.unregisterWindowActor("ZenMcp"); } catch {}
      try { localFile(socketPath).remove(false); } catch {}
      delete globalThis.zenMcpStop;
    }

    globalThis.zenMcpStop?.();
    globalThis.zenMcpStop = stop;

    const safeStart = () => {
      try {
        start();
        globalThis.zenMcpRunning = version;
      } catch (e) {
        logError("start", e);
      }
    };
    // autoconfig profil okunurken, ağ ve pencereler hazır olmadan çalışır; reload'da hemen başla
    if (browserWindows().length) safeStart();
    else {
      const observer = () => {
        Services.obs.removeObserver(observer, "final-ui-startup");
        safeStart();
      };
      Services.obs.addObserver(observer, "final-ui-startup");
    }
  } catch (e) {
    logError("kurulum", e);
  }
})();
