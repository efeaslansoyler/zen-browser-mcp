// zen.cfg bunu sistem yetkisiyle loadSubScript ile yükler (kapsamda zenMcpDir: bu klasörün
// gerçek yolu). $XDG_RUNTIME_DIR/zen-mcp.sock üzerinde bağlantı başına tek satırlık JSON istek
// alır, tek satırlık JSON cevap yazıp kapatır. Fare/klavye olayları Zen'in kendi WebDriver
// kodunun yaptığı gibi parent süreçten EventUtils ile gönderilir: sayfa bunları gerçek
// (isTrusted) girdi olarak görür, remote agent açılmadığı için navigator.webdriver false kalır.
// "reload" isteği bu dosyayı yeniden okur; tarayıcıyı yeniden başlatmak gerekmez.
"use strict";

(function () {
  const { classes: Cc, interfaces: Ci, utils: Cu } = Components;
  const { NetUtil } = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");

  const dir = zenMcpDir;
  const dirURI = Services.io.newFileURI(localFile(dir)).spec.replace(/\/?$/, "/");
  const version = (globalThis.zenMcpVersion = (globalThis.zenMcpVersion || 0) + 1);
  const socketPath = (Services.env.get("XDG_RUNTIME_DIR") || "/tmp") + "/zen-mcp.sock";

  function localFile(path) {
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(path);
    return f;
  }

  // ---- kurulum: actor modülleri resource://zenmcp/ altından, içerik süreci de okuyabilsin ----

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
    const tabs = [];
    for (const id of state.tabs) {
      const tab = findTab(id);
      if (tab) tabs.push(tab);
      else state.tabs.delete(id);
    }
    return tabs;
  }

  function browserFor(tabId) {
    const tab = findTab(tabId);
    if (!tab) throw new Error(`Sekme ${tabId} bulunamadı. tabs_context_mcp ile güncel sekmeleri al.`);
    return tab.linkedBrowser;
  }

  function describeTab(tab) {
    const b = tab.linkedBrowser;
    return { tabId: b.browserId, title: tab.label, url: b.currentURI?.spec };
  }

  function createTab(url = "about:blank") {
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    if (!win) throw new Error("Açık Zen penceresi yok.");
    const tab = win.gBrowser.addTrustedTab(url, { inBackground: false });
    state.tabs.add(tab.linkedBrowser.browserId);
    return tab;
  }

  // olayların gitmesi için sekmenin penceresinde seçili olması gerekir
  function select(browser) {
    const win = browser.ownerGlobal;
    const tab = win.gBrowser.getTabForBrowser(browser);
    if (win.gBrowser.selectedTab !== tab) win.gBrowser.selectedTab = tab;
    return win;
  }

  function waitForLoad(browser, timeout = 20000) {
    return new Promise(resolve => {
      const listener = {
        QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"]),
        onStateChange(webProgress, _request, flags) {
          const done = Ci.nsIWebProgressListener.STATE_STOP | Ci.nsIWebProgressListener.STATE_IS_WINDOW;
          if (webProgress.isTopLevel && (flags & done) === done) finish();
        },
      };
      const timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
      function finish() {
        timer.cancel();
        try { browser.removeProgressListener(listener); } catch {}
        resolve();
      }
      browser.addProgressListener(listener, Ci.nsIWebProgress.NOTIFY_STATE_WINDOW);
      timer.initWithCallback(finish, timeout, Ci.nsITimer.TYPE_ONE_SHOT);
    });
  }

  const sleep = ms => new Promise(r => {
    const t = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    t.initWithCallback(() => r(), ms, Ci.nsITimer.TYPE_ONE_SHOT);
  });

  // ---- girdi ----

  const eventUtils = new WeakMap();

  // EventUtils global'leri (KeyboardEvent, navigator...) yüklendiği nesnenin compartment'ından
  // okur; pencereyi kirletmemek için pencerenin compartment'ında ayrı bir nesneye yüklenir
  function EU(win) {
    let eu = eventUtils.get(win);
    if (!eu) {
      eu = Cu.createObjectIn(win);
      Object.assign(eu, { window: win, parent: win, _EU_Ci: Ci, _EU_Cc: Cc });
      Services.scriptloader.loadSubScript("chrome://remote/content/external/EventUtils.js", eu);
      eventUtils.set(win, eu);
    }
    return eu;
  }

  // ekran görüntüsü koordinatı → pencere koordinatı (CSS px)
  function toWindowPoint(browser, [x, y]) {
    const s = state.scale.get(browser.browserId) || 1;
    const r = browser.getBoundingClientRect();
    const zoom = browser.fullZoom || 1;
    return [r.left + (x / s) * zoom, r.top + (y / s) * zoom];
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

  function mouse(win, [x, y], event) {
    return new Promise(resolve =>
      EU(win).synthesizeMouseAtPoint(x, y, { ...event, asyncEnabled: true }, win, () => resolve())
    );
  }

  async function click(browser, coordinate, { button = 0, count = 1, modifiers } = {}) {
    const win = select(browser);
    const point = toWindowPoint(browser, coordinate);
    const mods = parseModifiers(modifiers);
    await mouse(win, point, { type: "mousemove", ...mods });
    for (let i = 1; i <= count; i++) {
      await mouse(win, point, { type: "mousedown", button, clickCount: i, ...mods });
      await mouse(win, point, { type: "mouseup", button, clickCount: i, ...mods });
    }
  }

  async function drag(browser, from, to) {
    const win = select(browser);
    const a = toWindowPoint(browser, from);
    const b = toWindowPoint(browser, to);
    await mouse(win, a, { type: "mousemove" });
    await mouse(win, a, { type: "mousedown" });
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await mouse(win, [a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps], {
        type: "mousemove",
        buttons: 1,
      });
    }
    await mouse(win, b, { type: "mouseup" });
  }

  function scroll(browser, coordinate, direction, amount = 3) {
    const win = select(browser);
    const [x, y] = toWindowPoint(browser, coordinate);
    // tık başına 100 CSS px; EventUtils piksel değil cihaz pikseli bekler
    const d = amount * 100 * win.devicePixelRatio;
    const delta = { up: [0, -d], down: [0, d], left: [-d, 0], right: [d, 0] }[direction];
    if (!delta) throw new Error(`Geçersiz kaydırma yönü: ${direction}`);
    return new Promise(resolve =>
      EU(win).synthesizeWheelAtPoint(
        x,
        y,
        { deltaX: delta[0], deltaY: delta[1], deltaMode: 0, asyncEnabled: true },
        win,
        () => resolve()
      )
    );
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

  // içerik odağı adres çubuğundaysa tuşlar sayfaya değil arayüze gider
  function focusContent(browser) {
    const win = select(browser);
    if (win.document.activeElement !== browser) browser.focus();
    return win;
  }

  // "ctrl+a", "Return", "Tab Tab Return"
  function pressKeys(browser, text) {
    const win = focusContent(browser);
    for (const combo of text.trim().split(/\s+/)) {
      const parts = combo.split("+");
      const key = keyName(parts.pop());
      EU(win).synthesizeKey(key, parseModifiers(parts.join("+")), win);
    }
  }

  function typeText(browser, text) {
    const win = focusContent(browser);
    text.split("\n").forEach((line, i) => {
      if (i > 0) EU(win).synthesizeKey("KEY_Enter", {}, win);
      if (line) EU(win).sendString(line, win);
    });
  }

  // ---- ekran görüntüsü ----

  // API büyük görselleri küçültür; modelin gördüğü koordinat ile tıklanan aynı olsun diye
  // görüntüyü kendimiz küçültüp oranı saklıyoruz (toWindowPoint geri çevirir)
  const MAX_EDGE = 1568;
  const MAX_PIXELS = 1150000;

  async function screenshot(browser) {
    const wg = browser.browsingContext?.currentWindowGlobal;
    if (!wg) throw new Error("Sayfa henüz yüklenmedi.");
    const bitmap = await wg.drawSnapshot(null, 1, "white");
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

  async function query(browser, name, data, timeout = 30000) {
    const wg = browser.browsingContext?.currentWindowGlobal;
    if (!wg) throw new Error("Sayfa henüz yüklenmedi.");
    const result = await Promise.race([
      wg.getActor("ZenMcp").sendQuery(name, data),
      sleep(timeout).then(() => { throw new Error(`Sayfa ${timeout / 1000} sn içinde cevap vermedi.`); }),
    ]);
    if (result?.error) throw new Error(result.error);
    return result;
  }

  // ---- tool'lar: hepsi MCP içerik dizisi döner ----

  const text = t => [{ type: "text", text: typeof t === "string" ? t : JSON.stringify(t, null, 2) }];

  const tools = {
    tabs_context_mcp({ createIfEmpty }) {
      let tabs = liveTabs();
      if (!tabs.length && createIfEmpty) tabs = [createTab()];
      if (!tabs.length) return text("Claude'un sekmesi yok. createIfEmpty: true ile veya tabs_create_mcp ile aç.");
      return text({ tabs: tabs.map(describeTab) });
    },

    tabs_create_mcp() {
      return text(describeTab(createTab()));
    },

    async navigate({ url, tabId }) {
      const browser = browserFor(tabId);
      const loaded = waitForLoad(browser);
      if (url === "back") browser.goBack();
      else if (url === "forward") browser.goForward();
      else {
        if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = "https://" + url;
        browser.fixupAndLoadURIString(url, {
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        });
      }
      await loaded;
      const tab = browser.ownerGlobal.gBrowser.getTabForBrowser(browser);
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
          return [
            { type: "image", data: shot.data, mimeType: "image/jpeg" },
            { type: "text", text: `${shot.width}x${shot.height}, tabId ${browser.browserId}` },
          ];
        }
        case "left_click":
          await click(browser, need("coordinate"), { modifiers: args.text });
          break;
        case "right_click":
          await click(browser, need("coordinate"), { button: 2, modifiers: args.text });
          break;
        case "double_click":
          await click(browser, need("coordinate"), { count: 2, modifiers: args.text });
          break;
        case "triple_click":
          await click(browser, need("coordinate"), { count: 3, modifiers: args.text });
          break;
        case "hover":
          await mouse(select(browser), toWindowPoint(browser, need("coordinate")), { type: "mousemove" });
          break;
        case "left_click_drag":
          await drag(browser, need("start_coordinate"), need("coordinate"));
          break;
        case "scroll":
          await scroll(browser, need("coordinate"), need("scroll_direction"), args.scroll_amount);
          break;
        case "type":
          typeText(browser, need("text"));
          break;
        case "key":
          for (let i = 0; i < (args.repeat || 1); i++) pressKeys(browser, need("text"));
          break;
        case "wait":
          await sleep(Math.min(need("duration"), 30) * 1000);
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
        Services.scriptloader.loadSubScript(dirURI + "main.js?" + Date.now(), { zenMcpDir: dir });
      });
      return text(`v${version} kapatılıyor, yeniden yükleniyor.`);
    },
    // bu kapsamda çalışır: yardımcılara (findTab, EU, screenshot...) erişir
    async chrome_eval({ code }) {
      const value = await eval(code);
      return text(value === undefined ? "undefined" : value);
    },
  };

  // ---- soket ----

  // JSON'u saf ASCII'ye çevir: iki uçta da karakter kodlamasıyla uğraşmayalım
  const ascii = s => s.replace(/[\u007f-￿]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

  function reply(output, message) {
    const stream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
    stream.setByteStringData(ascii(JSON.stringify(message)) + "\n");
    // asyncCopy bitince iki akışı da kapatır: bağlantı başına tek cevap
    NetUtil.asyncCopy(stream, output);
  }

  async function handle(line, output) {
    let message;
    try {
      const { tool, args = {} } = JSON.parse(line);
      const fn = tools[tool] || commands[tool];
      if (!fn) throw new Error(`Bilinmeyen tool: ${tool}`);
      message = { ok: true, content: await fn(args) };
    } catch (e) {
      message = { ok: false, error: String(e?.message ?? e) };
    }
    reply(output, message);
  }

  function onConnection(transport) {
    const input = transport.openInputStream(0, 0, 0);
    const output = transport.openOutputStream(0, 0, 0);
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
          handle(buffer.slice(0, end), output);
        }
      },
      onStopRequest() {},
    });
  }

  let server = null;

  function start() {
    ChromeUtils.registerWindowActor("ZenMcp", {
      parent: { esModuleURI: `resource://zenmcp/actors/ZenMcpParent.sys.mjs?v=${version}` },
      child: { esModuleURI: `resource://zenmcp/actors/ZenMcpChild.sys.mjs?v=${version}` },
      messageManagerGroups: ["browsers"],
    });

    const file = localFile(socketPath);
    if (file.exists()) file.remove(false);
    server = Cc["@mozilla.org/network/server-socket;1"].createInstance(Ci.nsIServerSocket);
    server.initWithFilename(file, 0o600, -1);
    server.asyncListen({
      onSocketAccepted(_server, transport) {
        try { onConnection(transport); } catch (e) { Cu.reportError(e); }
      },
      onStopListening() {},
    });
  }

  function stop() {
    try { server?.close(); } catch {}
    try { ChromeUtils.unregisterWindowActor("ZenMcp"); } catch {}
    try { localFile(socketPath).remove(false); } catch {}
    delete globalThis.zenMcpStop;
  }

  globalThis.zenMcpStop?.();
  globalThis.zenMcpStop = stop;

  const safeStart = () => {
    try { start(); } catch (e) { Cu.reportError(e); }
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
})();
