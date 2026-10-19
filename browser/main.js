// zen.cfg bunu sistem yetkisiyle loadSubScript ile yükler (kapsamda zenMcpDir: bu klasörün
// gerçek yolu). $XDG_RUNTIME_DIR/zen-mcp.sock üzerinde bağlantı başına tek satırlık JSON istek
// alır, tek satırlık JSON cevap yazıp kapatır. Fare/klavye olayları Zen'in kendi WebDriver
// kodunun yaptığı gibi parent süreçten EventUtils ile gönderilir: sayfa bunları gerçek
// (isTrusted) girdi olarak görür, remote agent açılmadığı için navigator.webdriver false kalır.
// "reload" isteği bu dosyayı yeniden okur; tarayıcıyı yeniden başlatmak gerekmez.
"use strict";

// Zen'in stderr'i genelde /dev/null'a gider ve autoconfig konsolu hazır olmadan çalışır;
// hatalar $XDG_RUNTIME_DIR/zen-mcp.log dosyasına da yazılır
function logError(where, e) {
  const msg = `${new Date().toISOString()} ${where}: ${e}\n${e?.stack ?? ""}\n`;
  try {
    const f = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
    f.initWithPath((Services.env.get("XDG_RUNTIME_DIR") || "/tmp") + "/zen-mcp.log");
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
    const dirURI = Services.io.newFileURI(localFile(dir)).spec.replace(/\/?$/, "/");
    const version = (globalThis.zenMcpVersion = (globalThis.zenMcpVersion || 0) + 1);
    const socketPath = (Services.env.get("XDG_RUNTIME_DIR") || "/tmp") + "/zen-mcp.sock";

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

    // ---- sekmeler ----

    const state = (globalThis.zenMcpState ||= { tabs: new Set(), scale: new Map() });

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
        throw new Error(`Sekme ${tabId} Claude'da değil (kapanmış ya da kullanıcı geri almış olabilir). tabs_context_mcp ile güncel sekmeleri al.`);
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
      if (!win) throw new Error("Açık Zen penceresi yok.");
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
    function mark(tab, origin = "true") {
      tab.setAttribute(MARK, origin);
      state.tabs.add(tab.linkedBrowser.browserId);
      try { SessionStore.setCustomTabValue(tab, MARK, origin); } catch {}
    }

    // kullanıcı sekmeyi geri aldı: işaret, takip ve kayıtlar silinir; süren işlem kesilir
    function unmark(tab) {
      const browser = tab.linkedBrowser;
      const id = browser.browserId;
      tab.removeAttribute(MARK);
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
      mark(tab, origin);
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
        background-color: #d97757 !important;
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
    const MENU_ICON = "data:image/svg+xml," + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path stroke="#d97757" stroke-width="2" stroke-linecap="round" d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4M3.4 3.4l2.8 2.8M9.8 9.8l2.8 2.8M3.4 12.6l2.8-2.8M9.8 6.2l2.8-2.8"/></svg>`
    );

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
      item.setAttribute("image", MENU_ICON);
      // Firefox'un yapay zekâ bölümünün sonuna; yoksa menünün sonuna
      const anchor = win.document.getElementById("context_aiSeparator");
      menu.insertBefore(item, anchor?.parentNode === menu ? anchor : null);
      const onShowing = event => {
        if (event.target !== menu) return;
        const tabs = contextTabs(win).filter(t => !t.hasAttribute("zen-empty-tab"));
        item.hidden = !tabs.length;
        const allGiven = tabs.length && tabs.every(t => t.hasAttribute(MARK));
        item.setAttribute("label", allGiven ? "Claude'dan geri al" : "Claude'a ver");
      };
      const onCommand = () => {
        const tabs = contextTabs(win).filter(t => !t.hasAttribute("zen-empty-tab"));
        if (tabs.every(t => t.hasAttribute(MARK))) tabs.forEach(unmark);
        else for (const tab of tabs) if (!tab.hasAttribute(MARK)) mark(tab, "user");
      };
      menu.addEventListener("popupshowing", onShowing);
      item.addEventListener("command", onCommand);
      menuCleanups.set(win, () => {
        menu.removeEventListener("popupshowing", onShowing);
        item.remove();
      });
    }
    const menuCleanups = new Map();

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
        if (!log) network.set(browserId, (log = { list: [], byChannel: new Map(), host: "" }));

        if (topic === "http-on-modify-request" || (topic === "http-on-failed-opening-request" && !log.byChannel.has(channel.channelId))) {
          const type = CONTENT_TYPES[channel.loadInfo.externalContentPolicyType] ?? "other";
          // Claude in Chrome gibi: ana belge başka bir siteye gidince eski kayıtlar silinir
          if (type === "document" && bc.top === bc) {
            const host = channel.URI.host;
            if (log.host && host !== log.host) {
              log.list.length = 0;
              log.byChannel.clear();
            }
            log.host = host;
          }
          const entry = { method: channel.requestMethod, url: channel.URI.spec, type, status: null, start: Date.now() };
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
        } catch {}
      },
    };
    const NETWORK_TOPICS = [
      "http-on-modify-request",
      "http-on-examine-response",
      "http-on-examine-cached-response",
      "http-on-examine-merged-response",
      "http-on-stop-request",
      "http-on-failed-opening-request",
    ];

    const pendingListeners = new Set();

    function waitForLoad(browser, timeout = 20000) {
      return new Promise(resolve => {
        const listener = {
          QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"]),
          onStateChange(webProgress, _request, flags) {
            const done = Ci.nsIWebProgressListener.STATE_STOP | Ci.nsIWebProgressListener.STATE_IS_WINDOW;
            if (webProgress.isTopLevel && (flags & done) === done) finish();
          },
        };
        // tarayıcı dinleyiciyi zayıf referansla tutar; bitene kadar biz tutalım
        pendingListeners.add(listener);
        function finish() {
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

    // ref verilmişse öğeyi (gerekirse kaydırıp) merkezine, yoksa koordinata
    async function target(browser, args, key = "coordinate") {
      if (args.ref && key === "coordinate") {
        const { x, y } = await query(browser, "locate", { ref: args.ref });
        return [x, y];
      }
      if (args[key] == null) throw new Error(`${args.action} için ${key}${key === "coordinate" ? " veya ref" : ""} gerekli.`);
      return toPagePoint(browser, args[key]);
    }

    function parseModifiers(text) {
      const mods = {};
      for (const m of (text || "").toLowerCase().split("+").filter(Boolean)) {
        if (m === "ctrl" || m === "control") mods.ctrlKey = true;
        else if (m === "shift") mods.shiftKey = true;
        else if (m === "alt" || m === "option") mods.altKey = true;
        else if (m === "meta" || m === "super" || m === "cmd" || m === "command") mods.metaKey = true;
        else throw new Error(`Bilinmeyen değiştirici tuş: ${m}`);
      }
      return mods;
    }

    const input = (browser, data) => query(browser, "input", data);

    async function click(browser, [x, y], { button = 0, count = 1, modifiers } = {}) {
      await input(browser, { kind: "click", x, y, button, count, modifiers: parseModifiers(modifiers) });
    }

    function scroll(browser, [x, y], direction, amount = 3) {
      // tık başına 100 CSS px; çarpan: tarayıcının tekerlek deltasına uyguladığı (Zen'de 200)
      const multiplier = axis => Services.prefs.getIntPref(`mousewheel.default.delta_multiplier_${axis}`, 100) / 100 || 1;
      const px = amount * 100;
      const delta = { up: [0, -px], down: [0, px], left: [-px, 0], right: [px, 0] }[direction];
      if (!delta) throw new Error(`Geçersiz kaydırma yönü: ${direction}`);
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
      throw new Error(`Bilinmeyen tuş: ${name}`);
    }

    // "ctrl+a", "Return", "Tab Tab Return"
    function pressKeys(browser, text) {
      const keys = text.trim().split(/\s+/).map(combo => {
        const parts = combo.split("+");
        const key = keyName(parts.pop());
        return { key, mods: parseModifiers(parts.join("+")) };
      });
      return input(browser, { kind: "keys", keys });
    }

    // ---- ekran görüntüsü ----

    // API büyük görselleri küçültür; modelin gördüğü koordinat ile tıklanan aynı olsun diye
    // görüntüyü kendimiz küçültüp oranı saklıyoruz (toPagePoint geri çevirir)
    const MAX_EDGE = 1568;
    const MAX_PIXELS = 1150000;

    async function screenshot(browser) {
      const wg = browser.browsingContext?.currentWindowGlobal;
      if (!wg) throw new Error("Sayfa henüz yüklenmedi.");
      // sanal imleç ve tıklama halkası Claude'un gördüğü görüntüde sayfayı kapatmasın
      const overlays = hidden => query(browser, "overlays", { hidden }, 2000).catch(() => {});
      await overlays(true);
      let bitmap;
      try {
        bitmap = await wg.drawSnapshot(null, 1, "white");
      } finally {
        overlays(false);
      }
      const { width: w, height: h } = bitmap;
      const s = Math.min(1, MAX_EDGE / Math.max(w, h), Math.sqrt(MAX_PIXELS / (w * h)));
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
      const extra = promptType.startsWith("prompt") && value ? ` (varsayılan: "${value}")` : "";
      return `Sayfada açık ${promptType} diyaloğu: "${text}"${extra}. handle_dialog ile kabul et veya iptal et.`;
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
      const kind = { alert: "uyarı gösteriyor", prompt: "senden bir metin istiyor" }[promptType.replace(/Check$/, "")] ?? "onay istiyor";
      let host = "";
      try { host = browser.currentURI.host; } catch {}
      island.dialog(browser, `${host} — sayfa ${kind}`, message);
      while (openDialog(browser) && island?.state === "dialog") await sleep(500);
      island?.dialogEnded();
    }

    // ---- durdurma: kullanıcı adadan (ya da Ctrl+Shift+Esc ile) Claude'u durdurur ----
    //
    // Süren beklemeler (sayfa cevabı, yükleme, ask_user) hemen kesilir; "Devam et"e basılana
    // kadar sekmelere dokunan her tool reddedilir. Durum reload'da korunur.
    class Stopped extends Error {
      constructor() {
        super("Kullanıcı Claude'u Zen'deki adadan durdurdu. Kullanıcı adadaki \"Devam et\"e basana kadar tarayıcıda işlem yapılamaz; ne yapmak istediğini kullanıcıya sor.");
      }
    }
    const stopListeners = new Set();

    // bekleyen bir işleme yarıştırılır; durdurulunca reddedilir. cancel ile bırakılır.
    function whenStopped() {
      let reject;
      const promise = new Promise((_, r) => (reject = r));
      stopListeners.add(reject);
      promise.cancel = () => stopListeners.delete(reject);
      return promise;
    }

    async function guard(promise) {
      const stopped = whenStopped();
      try {
        return await Promise.race([promise, stopped]);
      } finally {
        stopped.cancel();
      }
    }

    function stopClaude() {
      if (state.paused) return;
      state.paused = true;
      for (const reject of stopListeners) reject(new Stopped());
      stopListeners.clear();
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
        const alert = new AlertNotification({ name: ALERT_NAME, title: "Claude senden bir şey istiyor", text: message, textClickable: true });
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
          if (args.url === "back") return "geri gidiyor";
          if (args.url === "forward") return "ileri gidiyor";
          try { host = Services.uriFixup.getFixupURIInfo(args.url).preferredURI.host; } catch {}
          return "sayfayı açıyor";
        },
        computer: () => ({
          screenshot: "ekrana bakıyor", left_click: "tıklıyor", right_click: "sağ tıklıyor",
          double_click: "çift tıklıyor", triple_click: "tıklıyor", hover: "fareyi gezdiriyor",
          left_click_drag: "sürüklüyor", scroll: "kaydırıyor", scroll_to: "kaydırıyor",
          type: "yazıyor", key: "tuşa basıyor", wait: "bekliyor",
        })[args.action] ?? "çalışıyor",
        read_page: () => "sayfayı okuyor",
        get_page_text: () => "sayfayı okuyor",
        find: () => `"${args.query}" arıyor`,
        form_input: () => "formu dolduruyor",
        file_upload: () => "dosya yüklüyor",
        javascript_tool: () => "sayfada kod çalıştırıyor",
        read_console_messages: () => "konsolu okuyor",
        read_network_requests: () => "ağ isteklerine bakıyor",
        handle_dialog: () => "diyaloğu cevaplıyor",
        ask_user: () => "senden bir şey istiyor",
      }[tool]?.() ?? "çalışıyor";
      return host ? `${host} — ${what}` : what;
    }

    async function query(browser, name, data, timeout = 30000) {
      const wg = browser.browsingContext?.currentWindowGlobal;
      if (!wg) throw new Error("Sayfa henüz yüklenmedi.");
      throwIfDialog(browser);
      let done = false;
      const watchDialog = (async () => {
        while (!done) {
          await sleep(250);
          if (done) return;
          throwIfDialog(browser);
          if (browser.browsingContext?.currentWindowGlobal !== wg) throw new PageGone("Sayfa değişti.");
          if (!state.tabs.has(browser.browserId)) throw new Error("Kullanıcı bu sekmeyi Claude'dan geri aldı; artık bu sekmede işlem yapamazsın.");
        }
      })();
      try {
        const result = await guard(Promise.race([
          wg.getActor("ZenMcp").sendQuery(name, data),
          watchDialog,
          sleep(timeout).then(() => { throw new Error(`Sayfa ${timeout / 1000} sn içinde cevap vermedi.`); }),
        ]));
        if (result?.error) throw new Error(result.error);
        return result;
      } finally {
        done = true;
      }
    }

    // ---- tool'lar: hepsi MCP içerik dizisi döner ----

    const text = t => [{ type: "text", text: typeof t === "string" ? t : JSON.stringify(t, null, 2) }];

    const tools = {
      async tabs_context_mcp({ createIfEmpty }) {
        let tabs = liveTabs();
        if (!tabs.length && createIfEmpty) tabs = [await createTab()];
        if (!tabs.length) return text("Claude'un sekmesi yok. createIfEmpty: true ile veya tabs_create_mcp ile aç.");
        return text({ tabs: tabs.map(describeTab) });
      },

      async tabs_create_mcp() {
        return text(describeTab(await createTab()));
      },

      async navigate({ url, tabId }) {
        const browser = browserFor(tabId);
        const loaded = waitForLoad(browser);
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
          if (args[key] == null) throw new Error(`${args.action} için ${key} gerekli.`);
          return args[key];
        };
        switch (args.action) {
          case "screenshot": {
            const shot = await screenshot(browser);
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
            await query(browser, "locate", { ref: need("ref") });
            break;
          case "type":
            await input(browser, { kind: "text", text: need("text") });
            break;
          case "key":
            for (let i = 0; i < (args.repeat || 1); i++) await pressKeys(browser, need("text"));
            break;
          case "wait":
            await guard(sleep(Math.min(need("duration"), 30) * 1000));
            break;
          default:
            throw new Error(`Desteklenmeyen işlem: ${args.action}`);
        }
        // olayların sayfada işlenmesine kısa süre tanı
        await sleep(100);
        return text(`${args.action} tamam.`);
      },

      async get_page_text({ tabId }) {
        const page = await query(browserFor(tabId), "text");
        return text(`${page.title}\n${page.url}\n\n${page.text}`);
      },

      async read_page({ tabId, filter, depth, ref_id, max_chars }) {
        const { value } = await query(browserFor(tabId), "read_page", { filter, depth, ref_id, max_chars });
        return text(value);
      },

      async find({ tabId, query: q }) {
        const { value } = await query(browserFor(tabId), "find", { query: q });
        return text(value);
      },

      async form_input({ tabId, ref, value }) {
        const { value: result } = await query(browserFor(tabId), "form_input", { ref, value });
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
          ({ value: result } = await query(browser, "ask_user", { ref, x, y, message, wait, timeout }, (timeout + 10) * 1000));
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
          clicked: "Kullanıcı işaretlenen öğeye tıkladı.",
          done: "Kullanıcı Tamam'a bastı.",
          cancelled: "Kullanıcı vazgeçti.",
          timeout: `Kullanıcı ${timeout} sn içinde yanıt vermedi.`,
          navigated: "Sayfa değişti (kullanıcı bir işlem yapmış olabilir); screenshot ile kontrol et.",
          replaced: "Yerine yeni bir ask_user geldi.",
          taken_back: "Kullanıcı bu sekmeyi Claude'dan geri aldı; artık bu sekmede işlem yapamazsın.",
        }[result] ?? String(result));
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
          if (!file.exists() || !file.isFile()) throw new Error(`Dosya yok: ${path}`);
          total += file.fileSize;
          if (total > MAX_UPLOAD) throw new Error(`Dosyalar toplam ${MAX_UPLOAD / 1048576} MB'ı aşıyor.`);
          let type = "application/octet-stream";
          try { type = mime.getTypeFromFile(file); } catch {}
          files.push({ name: file.leafName, type, lastModified: file.lastModifiedTime, bytes: await IOUtils.read(path) });
        }
        const { value } = await query(browser, "file_upload", { ref, files }, 60000);
        return text(value);
      },

      async handle_dialog({ tabId, accept, text: answer }) {
        const browser = browserFor(tabId);
        const win = openDialog(browser);
        if (!win) return text("Açık diyalog yok.");
        const { promptType, text: message } = win.Dialog.args;
        if (answer != null && accept) {
          const box = promptType === "promptPassword" ? win.Dialog.ui.password1Textbox : win.Dialog.ui.loginTextbox;
          box.value = String(answer);
        }
        const dialog = win.document.querySelector("dialog");
        if (accept) dialog.acceptDialog();
        else dialog.cancelDialog();
        await sleep(200);
        return text(`${promptType} "${message}" ${accept ? "kabul edildi" : "iptal edildi"}${answer != null && accept ? ` (metin: "${answer}")` : ""}.`);
      },

      read_network_requests({ tabId, urlPattern, limit = 100, clear }) {
        const browser = browserFor(tabId);
        const log = network.get(browser.browserId);
        let list = log?.list ?? [];
        if (urlPattern) list = list.filter(r => r.url.includes(urlPattern));
        const lines = list.slice(-limit).map(r => {
          const status = r.error ?? (r.status ?? (r.duration == null ? "bekliyor" : "cevap yok"));
          const extra = [r.type, r.mime, r.cached && "önbellek", r.duration != null && `${r.duration} ms`].filter(Boolean).join(", ");
          return `${r.method} ${status} ${r.url}${extra ? `  (${extra})` : ""}`;
        });
        if (clear && log) {
          log.list.length = 0;
          log.byChannel.clear();
        }
        if (!lines.length) return text("Kayıtlı istek yok (sekme Claude tarafından açıldığından beri, eşleşen).");
        const hidden = list.length - lines.length;
        return text((hidden > 0 ? `…önceki ${hidden} istek gösterilmedi\n` : "") + lines.join("\n"));
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
    const commands = {
      reload() {
        // cevap yazıldıktan sonra yeniden yükle
        Services.tm.dispatchToMainThread(() => {
          stop();
          try {
            Services.scriptloader.loadSubScript("resource://zenmcp/main.js?" + Date.now(), { zenMcpDir: dir });
          } catch (e) {
            logError("reload", e);
          }
          // yeni sürüm başlamadıysa soket de yok: köprü tarayıcı yeniden başlayana kadar
          // ölü kalmasın, yarım kurulumu temizleyip bu sürümü yeniden başlat
          if (!(globalThis.zenMcpRunning > version)) {
            logError("reload", new Error(`yeni sürüm başlamadı, v${version} ile devam`));
            try { globalThis.zenMcpStop?.(); } catch {}
            start();
            globalThis.zenMcpStop = stop;
            globalThis.zenMcpRunning = version;
          }
        });
        return text(`v${version} kapatılıyor, yeniden yükleniyor.`);
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
        sandbox.h = { version, state, tools, browserFor, findTab, liveTabs, toPagePoint, screenshot, query };
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

    async function handle(line, transport, output) {
      let message;
      try {
        const { tool, args = {} } = JSON.parse(line);
        const fn = tools[tool] || commands[tool];
        if (!fn) throw new Error(`Bilinmeyen tool: ${tool}`);
        let shown = false;
        if (tools[tool]) {
          if (state.paused) throw new Stopped();
          const browser = state.tabs.has(args.tabId) ? findTab(args.tabId)?.linkedBrowser : null;
          if (browser) {
            island?.working(browser, describeAction(tool, args, browser));
            activeCalls++;
            shown = true;
          }
        }
        try {
          message = { ok: true, content: await fn(args) };
        } finally {
          if (shown && --activeCalls === 0) island?.idle();
        }
      } catch (e) {
        // diyalog bir hata değil, Claude'un bilmesi gereken durum
        if (e instanceof DialogOpen) {
          message = { ok: true, content: text(e.message) };
          if (e.browser) showDialog(e.browser);
        } else {
          message = { ok: false, error: String(e?.message ?? e) };
        }
      }
      try { reply(transport, output, message); } catch (e) { logError("cevap", e); }
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
      pump.asyncRead({
        onStartRequest() {},
        onDataAvailable(_request, stream, _offset, count) {
          buffer += NetUtil.readInputStreamToString(stream, count);
          const end = buffer.indexOf("\n");
          if (end >= 0 && !handled) {
            handled = true;
            handle(buffer.slice(0, end), transport, output);
          }
        },
        onStopRequest() {},
      });
    }

    let server = null;

    function start() {
      sss.loadAndRegisterSheet(markSheet, sss.USER_SHEET);
      const { Island } = ChromeUtils.importESModule(`resource://zenmcp/Island.sys.mjs?v=${version}`);
      island = new Island(
        { stop: stopClaude, resume: resumeClaude, goTo: goToTab, answer: (browser, result) => cancelAsk(browser, result) },
        { setTimeout, clearTimeout }
      );
      for (const win of browserWindows()) {
        island.attach(win);
        attachMenu(win);
      }
      if (state.paused) island.stopped();
      for (const topic of NETWORK_TOPICS) Services.obs.addObserver(networkObserver, topic);
      restoreMarks();
      for (const win of browserWindows()) watchWindow(win);
      Services.obs.addObserver(onWindowReady, "browser-delayed-startup-finished");
      // önceki sürüm stop() çağrılmadan kaybolduysa (ör. farklı kapsamdan yüklendiyse) kaydı kalır
      try { ChromeUtils.unregisterWindowActor("ZenMcp"); } catch {}
      ChromeUtils.registerWindowActor("ZenMcp", {
        parent: { esModuleURI: `resource://zenmcp/actors/ZenMcpParent.sys.mjs?v=${version}` },
        child: { esModuleURI: `resource://zenmcp/actors/ZenMcpChild.sys.mjs?v=${version}` },
        // web sayfası süreçlerine girmesi için açık izin gerekiyor (Marionette de böyle yapıyor);
        // child yalnız parent'tan gelen mesajlara cevap verir
        safeForUntrustedWebProcess: true,
      });

      const file = localFile(socketPath);
      if (file.exists()) file.remove(false);
      server = Cc["@mozilla.org/network/server-socket;1"].createInstance(Ci.nsIServerSocket);
      server.initWithFilename(file, 0o600, -1);
      server.asyncListen({
        onSocketAccepted(_server, transport) {
          try { onConnection(transport); } catch (e) { logError("bağlantı", e); }
        },
        onStopListening() {},
      });
    }

    function stop() {
      try { sss.unregisterSheet(markSheet, sss.USER_SHEET); } catch {}
      try { island?.destroy(); } catch {}
      island = null;
      for (const cleanup of menuCleanups.values()) {
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
