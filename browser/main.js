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
      return { tabId: b.browserId, title: b.contentTitle || tab.label, url: b.currentURI?.spec };
    }

    // Claude in Chrome gibi kullanıcının penceresinde, arka planda: girdiler sayfa sürecinden
    // gittiği için sekmenin seçili olması gerekmez, kullanıcının görünümü değişmez
    function createTab() {
      const win = Services.wm.getMostRecentWindow("navigator:browser");
      if (!win) throw new Error("Açık Zen penceresi yok.");
      const tab = win.gBrowser.addTrustedTab("about:blank", { inBackground: true });
      state.tabs.add(tab.linkedBrowser.browserId);
      return tab;
    }

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
        await loaded;
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
            return [
              { type: "image", data: shot.data, mimeType: "image/jpeg" },
              { type: "text", text: `${shot.width}x${shot.height}, tabId ${browser.browserId}` },
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
          Services.scriptloader.loadSubScript("resource://zenmcp/main.js?" + Date.now(), { zenMcpDir: dir });
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
        message = { ok: true, content: await fn(args) };
      } catch (e) {
        message = { ok: false, error: String(e?.message ?? e) };
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
      try { server?.close(); } catch {}
      try { ChromeUtils.unregisterWindowActor("ZenMcp"); } catch {}
      try { localFile(socketPath).remove(false); } catch {}
      delete globalThis.zenMcpStop;
    }

    globalThis.zenMcpStop?.();
    globalThis.zenMcpStop = stop;

    const safeStart = () => {
      try { start(); } catch (e) { logError("start", e); }
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
