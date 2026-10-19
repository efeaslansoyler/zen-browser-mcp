// İçerik sürecinde, her sayfanın her çerçevesinde (iframe'ler dahil) çalışır. Hatalar fırlatılmaz, { error }
// olarak döner: sendQuery hata mesajını düzgün taşımıyor.
//
// read_page/find öğelere "ref_N" kimliği verir (alt çerçevede "ref_N_f<browsingContext id>":
// main.js isteği bu ekle doğru çerçeveye yollar); kimlikler bu actor örneğinde (yani bu sayfa
// yüklemesinde) geçerlidir, yeni sayfada sıfırlanır. read_page iframe'in yerine
// "{{frame:<id>}}" satırı koyar, main.js onu o çerçevenin ağacıyla değiştirir. DOM'a ayrıcalıklı (Xray) erişimle bakılır:
// sayfanın kendi tanımladığı özellikler/override'lar görülmez, yerel DOM davranışı esastır.

const { setTimeout, clearTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");

// Kullanıcının gördüğü yazılar (imleç etiketi, öğe tarifi) tarayıcı Türkçeyse Türkçe; Claude'a
// giden mesajlar hep İngilizce
const L = (en, tr) => (Services.locale.appLocaleAsBCP47.startsWith("tr") ? tr : en);

// sanal imleç: Claude turuncusu ok, yanında küçük etiket ("Claude", "yazıyor…")
const ARROW = "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22"><path d="M3 2v16.5l4.6-4.3 3.1 6.8 2.7-1.2-3-6.7 6.3-.3z" fill="#d97757" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`
);
const CURSOR_CSS = `
  .pointer {
    position: absolute;
    left: 0;
    top: 0;
    transition: translate var(--move, 0ms) cubic-bezier(0.3, 0.7, 0.2, 1), opacity 0.35s ease;
  }
  .pointer.gone { opacity: 0; }
  .arrow {
    width: 22px;
    height: 22px;
    margin: -2px 0 0 -3px;
    background: url("${ARROW}") no-repeat;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35));
    transform-origin: 3px 2px;
    transition: scale 0.12s ease;
  }
  .pointer.press .arrow { scale: 0.82; }
  .label {
    position: absolute;
    left: 13px;
    top: 17px;
    padding: 2px 7px;
    border-radius: 999px;
    background: #d97757;
    color: #fff;
    font: 600 11px/1.4 system-ui, sans-serif;
    white-space: nowrap;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }
`;

// tıklama halkası
const RIPPLE_CSS = `
  div {
    position: absolute;
    left: -14px;
    top: -14px;
    width: 28px;
    height: 28px;
    box-sizing: border-box;
    border-radius: 50%;
    border: 2px solid #d97757;
    background: rgba(217, 119, 87, 0.18);
    animation: ripple 0.65s ease-out forwards;
  }
  @keyframes ripple {
    from { scale: 0.4; opacity: 1; }
    to { scale: 1.6; opacity: 0; }
  }
`;

// sistem olay grubu: sayfanın stopPropagation'ı bu dinleyiciyi etkilemez (yalnız ayrıcalıklı kod)
const SYSTEM_CAPTURE = { capture: true, mozSystemGroup: true };

// ask_user çizimi; renk Claude sekmesinin kenar çizgisiyle aynı
const ASK_CSS = `
  .box {
    position: fixed; box-sizing: border-box; pointer-events: none;
    border: 3px solid #d97757; border-radius: 8px;
    box-shadow: 0 0 0 4px rgba(217, 119, 87, 0.25), 0 0 24px rgba(217, 119, 87, 0.55);
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse {
    50% { box-shadow: 0 0 0 8px rgba(217, 119, 87, 0.12), 0 0 32px rgba(217, 119, 87, 0.8); }
  }
`;

// öğe seçici: fareyle gezilen öğenin çerçevesi ve etiketi; seçilince çerçeve sabit kalır
const PICK_CSS = `
  .box {
    position: fixed; box-sizing: border-box; pointer-events: none;
    border: 2px solid #d97757; border-radius: 4px;
    background: rgba(217, 119, 87, 0.12);
    transition: left 0.06s, top 0.06s, width 0.06s, height 0.06s;
  }
  .box.picked {
    border-width: 3px;
    box-shadow: 0 0 0 4px rgba(217, 119, 87, 0.25), 0 0 24px rgba(217, 119, 87, 0.55);
    background: none;
  }
  .label {
    position: fixed; pointer-events: none;
    padding: 2px 7px; border-radius: 999px;
    background: #d97757; color: #fff;
    font: 600 11px/1.4 system-ui, sans-serif; white-space: nowrap;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }
  .label span { font-weight: 400; opacity: 0.8; }
`;

// seçilen öğeden gönderilen outerHTML ve metin sınırı
const MAX_PICK_HTML = 1500;
const MAX_PICK_TEXT = 300;

// React/Next.js'in kendi bileşenleri: bileşen zincirinde gürültü
const FRAMEWORK_COMPONENTS = new Set([
  "InnerLayoutRouter", "OuterLayoutRouter", "RedirectBoundary", "RedirectErrorBoundary",
  "NotFoundBoundary", "NotFoundErrorBoundary", "HTTPAccessFallbackBoundary",
  "HTTPAccessFallbackErrorBoundary", "LoadingBoundary", "ErrorBoundary", "ErrorBoundaryHandler",
  "ScrollAndFocusHandler", "InnerScrollAndFocusHandler", "RenderFromTemplateContext", "AppRouter",
  "Router", "HotReload", "ReactDevOverlay", "ServerRoot", "Root", "AppContainer",
  "SegmentViewNode", "SegmentStateProvider", "LinkComponent", "Suspense", "Fragment",
]);

const MAX_TEXT = 100000;
const MAX_TREE = 50000;
const MAX_NAME = 100;

const LANDMARKS = {
  NAV: "navigation", MAIN: "main", HEADER: "banner", FOOTER: "contentinfo", ASIDE: "complementary",
  FORM: "form", DIALOG: "dialog", SECTION: "region",
};
const STRUCTURE = {
  H1: "heading", H2: "heading", H3: "heading", H4: "heading", H5: "heading", H6: "heading",
  UL: "list", OL: "list", LI: "listitem", TABLE: "table", TR: "row", TD: "cell", TH: "columnheader",
  P: "paragraph", IMG: "img", LABEL: "label", IFRAME: "iframe",
};
const INPUT_ROLES = {
  button: "button", submit: "button", reset: "button", image: "button", checkbox: "checkbox",
  radio: "radio", range: "slider", search: "searchbox", file: "button", color: "button",
};
const INTERACTIVE_ROLES = new Set([
  "button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox", "listbox", "option",
  "slider", "switch", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "spinbutton", "treeitem",
]);
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "HEAD", "META", "LINK"]);

export class ZenMcpChild extends JSWindowActorChild {
  #refs = new Map();
  #eventUtils = null;
  #consoleSince = 0;
  #ask = null;
  #cursor = null;
  #ids = new WeakMap();
  #next = 1;
  #pick = null;
  #contextTarget = null;

  // sağ tık menüsündeki "Claude'a göster" için tıklanan öğe (main.js bu olayı actor'a bağlar)
  handleEvent(event) {
    // sayfanın kendi ürettiği olay seçilen öğeyi değiştiremesin
    if (event.type !== "contextmenu" || !event.isTrusted) return;
    let target = event.composedPath()[0] ?? event.target;
    if (target?.nodeType !== 1) target = target?.parentElement;
    this.#contextTarget = target ? new WeakRef(target) : null;
  }

  async receiveMessage({ name, data }) {
    try {
      switch (name) {
        case "text":
          return this.#text();
        case "eval":
          return { value: await this.#eval(data.code) };
        case "read_page":
          return { value: this.#readPage(data) };
        case "find":
          return { value: this.#find(data.query) };
        case "frame_rect":
          return this.#frameRect(data.bcId);
        case "frame_at":
          return { value: this.#frameAt(data.x, data.y) };
        case "active_frame":
          return { value: this.#frameId(this.document.activeElement) };
        case "check":
          return { value: this.#check(data) };
        case "describe":
          return { value: this.#describeTarget(data) };
        case "form_input":
          return { value: this.#formInput(data.ref, data.value) };
        case "locate":
          return this.#locate(data.ref);
        case "input":
          return { value: await this.#input(data) };
        case "console":
          return { value: this.#console(data) };
        case "ask_user":
          return { value: await this.#askUser(data) };
        case "overlays":
          return { value: this.#overlays(data.hidden) };
        case "cancel_ask":
          // kullanıcı adadan vazgeçti ya da Claude'u durdurdu (cevap beklenmez)
          this.#ask?.finish(data?.result ?? "stopped");
          return null;
        case "file_upload":
          return { value: this.#fileUpload(data.ref, data.files) };
        case "pick_start":
          return await this.#pickStart(data);
        case "pick_end":
          this.#pick?.finish(null);
          this.#pickEnd();
          return null;
        default:
          return { error: `Bilinmeyen mesaj: ${name}` };
      }
    } catch (e) {
      return { error: String(e?.message ?? e) };
    }
  }

  #text() {
    const doc = this.document;
    const root = doc.querySelector("main, article, [role=main]") || doc.body;
    let text = root?.innerText ?? "";
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + "\n…(kesildi)";
    return { title: doc.title, url: doc.URL, text };
  }

  // Sayfanın principal'ıyla, Xray olmadan çalışan sandbox: sayfa değişkenlerine doğrudan
  // erişir, sayfanın CSP'si eval'i engellemez
  async #eval(code) {
    const win = this.contentWindow;
    const sandbox = Cu.Sandbox(win, { sandboxPrototype: win, wantXrays: false, sameZoneAs: win });
    let value = Cu.evalInSandbox(code, sandbox, null, "zen-mcp", 1);
    if (value && typeof value.then === "function") value = await value;
    return describe(value);
  }

  // ---- ref'ler ----

  #ref(el) {
    let id = this.#ids.get(el);
    if (!id) {
      const bc = this.browsingContext;
      id = `ref_${this.#next++}${bc.parent ? `_f${bc.id}` : ""}`;
      this.#ids.set(el, id);
      this.#refs.set(id, new WeakRef(el));
    }
    return id;
  }

  #element(ref) {
    const el = this.#refs.get(ref)?.deref();
    if (!el || !el.isConnected) {
      throw new Error(`${ref} not found (the page may have changed); get refs again with read_page or find.`);
    }
    return el;
  }

  // ---- read_page ----

  // bare: alt çerçeve için yalnız ağaç satırları (başlık ve URL main.js'te)
  #readPage({ filter = "all", depth = 30, ref_id, max_chars = MAX_TREE, bare = false }) {
    const root = ref_id ? this.#element(ref_id) : this.document.body;
    if (!root) return "(empty page)";
    const lines = [];
    let size = 0;
    let truncated = false;
    const interactiveOnly = filter === "interactive";

    const push = (indent, line) => {
      if (truncated) return;
      const text = "  ".repeat(indent) + line;
      if (size + text.length > max_chars) {
        truncated = true;
        return;
      }
      size += text.length + 1;
      lines.push(text);
    };

    const walk = (el, indent, level) => {
      if (truncated || level > depth) return;
      if (SKIP_TAGS.has(el.tagName?.toUpperCase()) || !this.#visible(el)) return;
      const role = roleOf(el);
      const interactive = INTERACTIVE_ROLES.has(role);
      const printed = interactiveOnly ? interactive : !!role;
      let childIndent = indent;
      // iframe'in içi ayrı bir actor'da: yerine işaret, main.js doldurur
      const frameId = this.#frameId(el);
      if (frameId) {
        if (!interactiveOnly) push(indent, this.#describeElement(el, role));
        push(interactiveOnly ? indent : indent + 1, `{{frame:${frameId}}}`);
        return;
      }
      if (printed) {
        push(indent, this.#describeElement(el, role));
        childIndent = interactiveOnly ? indent : indent + 1;
        // düğme/bağlantının metni adında zaten var; içine girme
        if (interactive && role !== "listbox" && role !== "combobox") return;
        // içinde kontrol olmayan metin kutusu: <b>, <span> gibi parçalara bölmeden tek satır
        if (!interactiveOnly && TEXT_CONTAINERS.has(role) && !el.querySelector(CONTROL_SELECTOR)) {
          const t = clean(el.innerText);
          if (t) push(childIndent, `text "${truncate(t, 500)}"`);
          return;
        }
      }
      for (const child of el.childNodes) {
        if (child.nodeType === 1) walk(child, childIndent, level + 1);
        else if (!interactiveOnly && child.nodeType === 3) {
          const t = clean(child.data);
          // bir öğenin altındaki serbest metin; adı metinden gelen rollerde tekrar etmesin
          if (t && !(printed && NAME_FROM_CONTENT.has(role))) push(childIndent, `text "${t}"`);
        }
      }
    };

    walk(root, 0, 0);
    if (truncated) {
      const hint = interactiveOnly ? "search with find" : 'use filter: "interactive"';
      lines.push(`…(truncated at ${max_chars} characters; focus on a subtree with ref_id or ${hint})`);
    }
    const doc = this.document;
    if (bare) return lines.join("\n");
    return `${doc.title}\n${doc.URL}\n\n${lines.join("\n") || "(no visible elements)"}`;
  }

  #describeElement(el, role) {
    const parts = [role];
    const name = accessibleName(el, this.document);
    if (name) parts.push(`"${name}"`);
    parts.push(`[${this.#ref(el)}]`);
    const tag = el.tagName.toUpperCase();
    if (role === "heading") parts.push(`level=${tag[1] || el.getAttribute("aria-level") || ""}`);
    if (role === "link" && el.getAttribute("href")) parts.push(`href="${truncate(el.getAttribute("href"), 120)}"`);
    if (tag === "INPUT" || tag === "TEXTAREA") {
      const type = el.getAttribute("type");
      if (type && tag === "INPUT" && !INPUT_ROLES[type]) parts.push(`type=${type}`);
      if (el.type === "checkbox" || el.type === "radio") parts.push(el.checked ? "checked" : "unchecked");
      else if (el.type !== "password" && el.value) parts.push(`value="${truncate(el.value, MAX_NAME)}"`);
      if (el.placeholder && el.placeholder !== name) parts.push(`placeholder="${truncate(el.placeholder, MAX_NAME)}"`);
    }
    if (tag === "SELECT") {
      const opt = el.selectedOptions?.[0];
      if (opt) parts.push(`value="${truncate(clean(opt.text), MAX_NAME)}"`);
      parts.push(`options=[${[...el.options].slice(0, 20).map(o => `"${truncate(clean(o.text), 40)}"`).join(", ")}${el.options.length > 20 ? ", …" : ""}]`);
    }
    if (el.isContentEditable && role === "textbox") parts.push(`value="${truncate(clean(el.innerText), MAX_NAME)}"`);
    if (el.disabled || el.getAttribute("aria-disabled") === "true") parts.push("disabled");
    const expanded = el.getAttribute("aria-expanded");
    if (expanded) parts.push(`expanded=${expanded}`);
    if (el.getAttribute("aria-selected") === "true") parts.push("selected");
    if (el.getAttribute("aria-checked")) parts.push(`checked=${el.getAttribute("aria-checked")}`);
    if (!this.#inViewport(el)) parts.push("(off-screen)");
    return parts.join(" ");
  }

  #visible(el) {
    if (el.getAttribute?.("aria-hidden") === "true" || el.hidden) return false;
    if (el.tagName?.toUpperCase() === "INPUT" && el.type === "hidden") return false;
    // checkVisibility: display:none, visibility, content-visibility ve ataları kontrol eder
    if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true })) return false;
    return true;
  }

  #inViewport(el) {
    const r = el.getBoundingClientRect();
    const win = this.contentWindow;
    return r.bottom > 0 && r.right > 0 && r.top < win.innerHeight && r.left < win.innerWidth;
  }

  // ---- find ----

  // Anahtar kelime eşleştirme: sorgudaki her kelime, öğenin adındaki/özniteliklerindeki bir
  // kelimenin başıyla eşleşmeli ("to" "autoconfig"e uymaz, "serv" "server"a uyar)
  #find(query) {
    const words = tokens(query);
    if (!words.length) throw new Error("Empty query.");
    const results = [];
    const all = this.document.body?.querySelectorAll("*") ?? [];
    for (const el of all) {
      if (SKIP_TAGS.has(el.tagName.toUpperCase())) continue;
      const role = roleOf(el);
      if (!role || !this.#visible(el)) continue;
      const name = accessibleName(el, this.document);
      const haystack = tokens(
        [name, el.getAttribute("placeholder"), el.getAttribute("title"), el.id, el.getAttribute("name"), el.getAttribute("href"), role].join(" ")
      );
      const hits = words.filter(w => haystack.some(t => t.startsWith(w))).length;
      if (!hits) continue;
      let score = hits / words.length;
      // etkileşimli öğe, tam ad eşleşmesinden önce gelsin (hücre değil içindeki bağlantı)
      if (INTERACTIVE_ROLES.has(role)) score += 0.5;
      if (normalize(name) === normalize(query)) score += 0.4;
      // sorgu adın içinde bütün olarak geçiyorsa ("package.json" ≠ "package-lock.json")
      else if (normalize(name).includes(normalize(query))) score += 0.2;
      if (this.#inViewport(el)) score += 0.1;
      results.push({ el, role, score });
    }
    // main.js bütün çerçevelerin sonuçlarını puana göre birleştirir
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 20).map(({ el, role, score }) => ({ line: this.#describeElement(el, role), score }));
  }

  // ---- iframe'ler ----

  // iframe/frame öğesinin içindeki çerçevenin browsingContext kimliği (yüklenmemişse null)
  #frameId(el) {
    const tag = el?.localName;
    if (tag !== "iframe" && tag !== "frame") return null;
    return el.browsingContext?.id ?? null;
  }

  #frameElement(bcId) {
    for (const el of this.document.querySelectorAll("iframe, frame")) {
      if (this.#frameId(el) === bcId) return el;
    }
    return null;
  }

  // iframe'in içerik kutusu bu çerçevenin görünür alanında; gerekirse görünür yapılır
  #frameRect(bcId) {
    const el = this.#frameElement(bcId);
    if (!el) throw new Error("iframe not found (the page may have changed).");
    if (!this.#fullyInViewport(el)) el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    return this.#contentOrigin(el);
  }

  #contentOrigin(el) {
    const r = el.getBoundingClientRect();
    const s = this.contentWindow.getComputedStyle(el);
    return {
      x: r.left + el.clientLeft + parseFloat(s.paddingLeft),
      y: r.top + el.clientTop + parseFloat(s.paddingTop),
    };
  }

  // nokta bir iframe'in üstündeyse o çerçevenin kimliği ve içindeki koordinat
  #frameAt(x, y) {
    const el = this.document.elementFromPoint(x, y);
    const bcId = this.#frameId(el);
    if (!bcId) return null;
    const o = this.#contentOrigin(el);
    return { bcId, x: x - o.x, y: y - o.y };
  }

  // izin sorusu ve günlük için öğenin kısa tarifi: 'button "Teklif al"'
  #describeTarget({ ref, x, y }) {
    const el = ref ? this.#element(ref) : this.document.elementFromPoint(x, y);
    if (!el) return L("an empty spot", "boş bir yer");
    const role = roleOf(el) || el.localName;
    const name = accessibleName(el, this.document) || truncate(clean(el.innerText ?? ""), 40);
    return name ? `${role} "${truncate(name, 60)}"` : role;
  }

  // wait_for: metin ve/veya seçici bu çerçevede görünüyor mu
  #check({ text, selector }) {
    const doc = this.document;
    const has = el => !text || normalize(el.innerText ?? "").includes(normalize(text));
    if (selector) {
      return [...doc.querySelectorAll(selector)].some(el => this.#visible(el) && has(el));
    }
    return !!doc.body && has(doc.body);
  }

  // ---- form_input ----

  #formInput(ref, value) {
    const el = this.#element(ref);
    const win = this.contentWindow;
    const tag = el.tagName.toUpperCase();
    const fire = type => el.dispatchEvent(new win.Event(type, { bubbles: true }));

    if (tag === "SELECT") {
      const wanted = String(value);
      const opt = [...el.options].find(o => o.value === wanted) ||
        [...el.options].find(o => normalize(o.text) === normalize(wanted));
      if (!opt) throw new Error(`No option "${wanted}". Options: ${[...el.options].map(o => o.text.trim()).join(", ")}`);
      el.value = opt.value;
      fire("input");
      fire("change");
      return `${ref}: selected "${opt.text.trim()}".`;
    }
    if (tag === "INPUT" && (el.type === "checkbox" || el.type === "radio")) {
      const checked = value === true || value === "true" || value === 1 || value === "1" || value === "on";
      if (el.checked !== checked) {
        // tıklama: sayfanın click dinleyicileri ve label/radio grubu davranışı da çalışsın
        el.click();
      }
      return `${ref}: ${el.checked ? "checked" : "unchecked"}.`;
    }
    if (tag === "INPUT" || tag === "TEXTAREA") {
      el.focus();
      // Xray üzerinden atama yerel setter'ı çağırır; React'in değer izleyicisi değişikliği görür
      el.value = String(value);
      fire("input");
      fire("change");
      return `${ref}: value set.`;
    }
    if (el.isContentEditable) {
      el.focus();
      this.document.execCommand("selectAll");
      this.document.execCommand("insertText", false, String(value));
      return `${ref}: content set.`;
    }
    throw new Error(`${ref} is not a form field (${roleOf(el) || tag.toLowerCase()}).`);
  }

  // ---- file_upload: dosyalar parent'ta okunur (bu süreç sandbox'ta, diske erişemez) ----

  #fileUpload(ref, files) {
    const input = this.#fileInputNear(this.#element(ref));
    if (!input) throw new Error(`No file input (input type=file) near ${ref}.`);
    if (files.length > 1 && !input.multiple) throw new Error("Bu alan tek dosya kabul ediyor.");
    const win = this.contentWindow;
    const list = files.map(f => new win.File([Cu.cloneInto(f.bytes, win)], f.name, { type: f.type, lastModified: f.lastModified }));
    // ayrıcalıklı yöntem: dosya seçme penceresi açmadan alanı doldurur
    input.mozSetFileArray(list);
    // ayrıcalıklı koddan oluşturulan olaylar sayfaya güvenilir (isTrusted) görünür
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
    input.dispatchEvent(new win.Event("change", { bubbles: true }));
    return `${files.length} file(s) uploaded: ${files.map(f => f.name).join(", ")}`;
  }

  // Sürükle-bırak alanları çoğunlukla gizli bir input[type=file] kullanır: öğenin kendisi,
  // bağlı olduğu label, kendi içi ve birkaç ata yukarısına kadar ara
  #fileInputNear(el) {
    const isFile = node => node?.localName === "input" && node.type === "file";
    if (isFile(el)) return el;
    if (isFile(el.control)) return el.control;
    for (let node = el, depth = 0; node && depth < 5; node = node.parentElement, depth++) {
      const found = node.querySelector?.('input[type="file"]');
      if (found) return found;
    }
    return null;
  }

  // ---- ask_user: öğeyi çerçevele, kullanıcıya ne yapacağını söyle, cevabını bekle ----
  //
  // Çizim kapalı shadow DOM içinde (sayfanın CSS'i bozamaz, script'leri içine bakamaz).
  // Yalnız gerçek (isTrusted) tıklamalar sayılır; tıklama sistem olay grubunda dinlenir,
  // sayfa olayı durdursa da görülür.

  didDestroy() {
    this.#ask?.finish("navigated");
    this.#pick?.finish(null);
  }

  #askUser({ ref, x, y, wait = "done", timeout = 300 }) {
    this.#ask?.finish("replaced");
    const doc = this.document;
    const win = this.contentWindow;
    // önceki bir hatadan asılı kalmış çizim
    for (const old of doc.querySelectorAll("zen-mcp-ask")) old.remove();
    const target = ref ? this.#element(ref) : x != null ? doc.elementFromPoint(x, y) : null;
    if (target && !this.#fullyInViewport(target)) target.scrollIntoView({ block: "center", behavior: "instant" });

    // Mesaj ve düğmeler adada (Island.sys.mjs); sayfada yalnız öğenin çerçevesi. Öğe yoksa
    // sayfaya bir şey çizilmez, cevap adadan (cancel_ask ile) gelir.
    const host = doc.createElement("zen-mcp-ask");
    host.setAttribute("style", "all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; pointer-events: none !important; display: block !important;");
    const root = host.attachShadow({ mode: "closed" });
    const style = doc.createElement("style");
    style.textContent = ASK_CSS;
    root.append(style);
    let box = null;
    if (target) {
      box = doc.createElement("div");
      box.className = "box";
      root.append(box);
      doc.documentElement.append(host);
    }

    // öğe kayar/boyutu değişirse çerçeve takip etsin
    let frame = 0;
    const place = () => {
      const r = target.getBoundingClientRect();
      const pad = 6;
      Object.assign(box.style, {
        left: `${r.left - pad}px`, top: `${r.top - pad}px`,
        width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`,
      });
      frame = win.requestAnimationFrame(place);
    };
    if (target) place();

    return new Promise(resolve => {
      // yalnız gerçek tıklama; pencereden yakalanır (sayfa olayı durdursa da)
      const onClick = event => {
        if (event.isTrusted && wait === "click" && target && event.composedPath().includes(target)) finish("clicked");
      };
      const timer = setTimeout(() => finish("timeout"), timeout * 1000);
      try {
        win.addEventListener("click", onClick, SYSTEM_CAPTURE);
      } catch (e) {
        clearTimeout(timer);
        host.remove();
        throw e;
      }
      const finish = result => {
        if (this.#ask?.finish !== finish) return;
        this.#ask = null;
        clearTimeout(timer);
        try { win.removeEventListener("click", onClick, SYSTEM_CAPTURE); } catch {}
        try { win.cancelAnimationFrame(frame); } catch {}
        host.remove();
        resolve(result);
      };
      this.#ask = { finish };
    });
  }

  // ---- öğe seçici: kullanıcı sayfada bir öğe seçer, adada notunu yazıp Claude'a gönderir ----
  //
  // Seçim sürerken sayfanın tıklama ve tuş olayları engellenir (bağlantı açılmasın, kısayollar
  // çalışmasın); fare hareketi engellenmez, üzerine gelince açılan menüler açık kalır. Seçilen
  // öğe not yazılırken çerçeveli kalır; pick_end ile kalkar.

  #pickOverlay = null;

  // fromContext: sağ tık menüsünden; seçim sağ tıklanan öğeden başlar, fareyle değişir
  #pickStart({ fromContext = false } = {}) {
    this.#pick?.finish(null);
    this.#pickEnd();
    const doc = this.document;
    const win = this.contentWindow;
    const overlay = this.#pickOverlayEl();
    let current = null;
    let hovered = null;
    let trail = []; // ↑ ile çıkılan öğeler; ↓ geri iner
    const show = el => {
      current = el;
      overlay.track(el);
    };
    if (fromContext) {
      const el = this.#contextTarget?.deref();
      if (el?.isConnected) show((hovered = el));
    }
    const MOUSE = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "auxclick", "dblclick", "contextmenu"];
    const KEYS = ["keydown", "keypress", "keyup"];
    const CAPTURE = { capture: true };

    return new Promise(resolve => {
      const onMove = event => {
        if (!event.isTrusted) return;
        const el = doc.elementFromPoint(event.clientX, event.clientY);
        if (!el || el === hovered) return;
        hovered = el;
        trail = [];
        show(el);
      };
      const onMouse = event => {
        if (!event.isTrusted) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.type === "click" && event.button === 0 && current) finish(current);
        else if (event.type === "contextmenu") finish(null);
      };
      const onKey = event => {
        if (!event.isTrusted) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.type !== "keydown") return;
        if (event.key === "Escape") finish(null);
        else if (event.key === "Enter" && current) finish(current);
        else if (event.key === "ArrowUp" && current?.parentElement && current.parentElement !== doc.documentElement) {
          trail.push(current);
          show(current.parentElement);
        } else if (event.key === "ArrowDown" && trail.length) show(trail.pop());
      };
      win.addEventListener("mousemove", onMove, CAPTURE);
      for (const type of MOUSE) win.addEventListener(type, onMouse, CAPTURE);
      for (const type of KEYS) win.addEventListener(type, onKey, CAPTURE);

      const finish = el => {
        if (this.#pick?.finish !== finish) return;
        this.#pick = null;
        try {
          win.removeEventListener("mousemove", onMove, CAPTURE);
          for (const type of MOUSE) win.removeEventListener(type, onMouse, CAPTURE);
          for (const type of KEYS) win.removeEventListener(type, onKey, CAPTURE);
        } catch {}
        if (!el) {
          this.#pickEnd();
          resolve({ cancelled: true });
          return;
        }
        overlay.freeze();
        try {
          resolve(this.#pickInfo(el));
        } catch (e) {
          this.#pickEnd();
          resolve({ error: String(e?.message ?? e) });
        }
      };
      this.#pick = { finish };
    });
  }

  #pickEnd() {
    this.#pickOverlay?.remove();
    this.#pickOverlay = null;
  }

  // Kapalı shadow DOM içinde çerçeve ve etiket ("button.cta 320×48"); öğe kayarsa takip eder
  #pickOverlayEl() {
    const doc = this.document;
    const win = this.contentWindow;
    const host = doc.createElement("zen-mcp-pick");
    host.setAttribute("style", "all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; pointer-events: none !important; display: block !important;");
    const root = host.attachShadow({ mode: "closed" });
    const style = doc.createElement("style");
    style.textContent = PICK_CSS;
    const box = doc.createElement("div");
    box.className = "box";
    const label = doc.createElement("div");
    label.className = "label";
    root.append(style, box, label);
    doc.documentElement.append(host);

    let target = null;
    let frame = 0;
    const place = () => {
      if (target?.isConnected) {
        const r = target.getBoundingClientRect();
        Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        // etiket öğenin üstünde; yer yoksa içinde, üst kenarda
        const top = r.top >= 24 ? r.top - 22 : Math.max(r.top, 0) + 4;
        label.style.left = `${Math.max(4, Math.min(r.left, win.innerWidth - label.offsetWidth - 4))}px`;
        label.style.top = `${Math.min(top, win.innerHeight - 22)}px`;
        label.hidden = false;
      }
      frame = win.requestAnimationFrame(place);
    };
    label.hidden = true;
    place();

    const overlay = {
      track: el => {
        target = el;
        const r = el.getBoundingClientRect();
        const size = doc.createElement("span");
        size.textContent = ` ${Math.round(r.width)}×${Math.round(r.height)}`;
        label.textContent = elementLabel(el);
        label.append(size);
      },
      freeze: () => box.classList.add("picked"),
      remove: () => {
        try { win.cancelAnimationFrame(frame); } catch {}
        host.remove();
      },
    };
    this.#pickOverlay = overlay;
    return overlay;
  }

  // Claude'a gidecek bağlam: kodda doğru yeri bulmaya yetecek kadar, sayfa boyutundan bağımsız
  #pickInfo(el) {
    const doc = this.document;
    const win = this.contentWindow;
    const r = el.getBoundingClientRect();
    return {
      url: doc.URL,
      title: doc.title,
      label: elementLabel(el),
      selector: cssPath(el, win),
      role: roleOf(el),
      name: accessibleName(el, doc),
      text: truncate(clean(el.innerText ?? el.textContent), MAX_PICK_TEXT),
      html: truncate(el.outerHTML, MAX_PICK_HTML),
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      viewport: { width: win.innerWidth, height: win.innerHeight, scrollX: win.scrollX, scrollY: win.scrollY, dpr: win.devicePixelRatio },
      styles: pickStyles(el, win),
      components: componentChain(el),
    };
  }

  // ---- konsol: Firefox bu sayfanın console.* çağrılarını (ConsoleAPIStorage) ve JS hatalarını
  // (konsol servisi) sayfa yüklemesi başından beri tutuyor; önceden dinlemeye başlamak gerekmez ----

  #console({ onlyErrors = false, pattern, limit = 100, clear = false }) {
    const innerId = this.manager.innerWindowId;
    const entries = [];

    const storage = Cc["@mozilla.org/consoleAPI-storage;1"].getService(Ci.nsIConsoleAPIStorage);
    for (const event of storage.getEvents(String(innerId))) {
      const level = event.level === "warn" ? "warning" : event.level;
      if (onlyErrors && level !== "error" && level !== "assert") continue;
      const message = [...(event.arguments ?? [])].map(formatArg).join(" ");
      entries.push({ time: event.timeStamp, level, message, source: event.filename && `${event.filename}:${event.lineNumber}` });
    }

    for (const m of Services.console.getMessageArray() ?? []) {
      if (!(m instanceof Ci.nsIScriptError) || m.innerWindowID !== innerId) continue;
      const isWarning = m.flags & Ci.nsIScriptError.warningFlag;
      if (onlyErrors && isWarning) continue;
      entries.push({
        time: m.timeStamp,
        level: isWarning ? "warning" : "error",
        message: m.errorMessage,
        source: m.sourceName && `${m.sourceName}:${m.lineNumber}`,
      });
    }

    let list = entries.filter(e => e.time > this.#consoleSince).sort((a, b) => a.time - b.time);
    if (pattern) {
      const re = new RegExp(pattern, "i");
      list = list.filter(e => re.test(e.message) || re.test(e.source ?? ""));
    }
    if (clear) this.#consoleSince = Date.now();
    if (!list.length) return "No console messages" + (pattern || onlyErrors ? " matching the filter." : ".");
    const shown = list.slice(-limit);
    const lines = shown.map(e => {
      const time = new Date(e.time).toTimeString().slice(0, 8);
      return `[${e.level}] ${time} ${truncate(e.message, 2000)}${e.source ? `  (${e.source})` : ""}`;
    });
    if (list.length > shown.length) lines.unshift(`…${list.length - shown.length} earlier message(s) not shown`);
    return lines.join("\n");
  }

  // ---- girdi: olaylar bu süreçte, sayfanın windowUtils'i ile üretilir ----
  //
  // Zen'in WebDriver kodunun da kullandığı yol: sayfa bunları gerçek (isTrusted) girdi olarak
  // görür ve sekme arka plandayken de çalışır; sekmeyi seçmek, kullanıcının penceresine
  // dokunmak gerekmez. Koordinatlar sayfanın görünür alanında CSS px.

  #eu() {
    if (!this.#eventUtils) {
      const win = this.contentWindow;
      const eu = { window: win, parent: win, _EU_Ci: Ci, _EU_Cc: Cc };
      Services.scriptloader.loadSubScript("chrome://remote/content/external/EventUtils.js", eu);
      this.#eventUtils = eu;
    }
    return this.#eventUtils;
  }

  // silent: sanal imleç ve halka yok (geliştirme/demo: kullanıcının tıklaması gibi)
  async #input({ kind, x, y, to, button = 0, count = 1, modifiers = {}, keys, text, dx = 0, dy = 0, multiplier = [1, 1], silent = false }) {
    const win = this.contentWindow;
    const eu = this.#eu();
    const mouse = (px, py, event) => eu.synthesizeMouseAtPoint(px, py, { ...modifiers, ...event }, win);
    switch (kind) {
      case "click":
        if (!silent) {
          await this.#moveCursor(x, y);
          this.#press();
        }
        mouse(x, y, { type: "mousemove" });
        for (let i = 1; i <= count; i++) {
          mouse(x, y, { type: "mousedown", button, clickCount: i });
          mouse(x, y, { type: "mouseup", button, clickCount: i });
        }
        if (button === 0) this.#focusAt(x, y);
        if (!silent) this.#ripple(x, y);
        return "done";
      case "hover":
        await this.#moveCursor(x, y);
        mouse(x, y, { type: "mousemove" });
        return "done";
      case "drag": {
        await this.#moveCursor(x, y);
        this.#press();
        mouse(x, y, { type: "mousemove" });
        mouse(x, y, { type: "mousedown" });
        const steps = 10;
        for (let i = 1; i <= steps; i++) {
          mouse(x + ((to[0] - x) * i) / steps, y + ((to[1] - y) * i) / steps, { type: "mousemove", buttons: 1 });
        }
        mouse(to[0], to[1], { type: "mouseup" });
        await this.#moveCursor(to[0], to[1]);
        return "done";
      }
      case "wheel":
        await this.#moveCursor(x, y);
        return this.#wheel(x, y, dx, dy, multiplier);
      case "keys":
        this.#cursorLabel(L("pressing keys", "tuşa basıyor"));
        for (const { key, mods } of keys) eu.synthesizeKey(key, mods, win);
        return "done";
      case "text":
        this.#cursorLabel(L("typing…", "yazıyor…"));
        text.split("\n").forEach((line, i) => {
          if (i > 0) eu.synthesizeKey("KEY_Enter", {}, win);
          if (line) eu.sendString(line, win);
        });
        return "done";
      default:
        throw new Error(`Bilinmeyen girdi: ${kind}`);
    }
  }

  // ---- sanal imleç: kullanıcı sekmeye bakınca Claude'un nereye tıkladığını izlesin ----
  //
  // İşlemden önce imleç son konumundan hedefe kayar; yalnız sekme görünürken (izleyen yoksa
  // gecikme olmasın diye arka planda anında konumlanır). Boşta kalınca kaybolur.

  #cursorEl() {
    if (this.#cursor?.host.isConnected) return this.#cursor;
    const doc = this.document;
    const win = this.contentWindow;
    const host = doc.createElement("zen-mcp-cursor");
    host.setAttribute("style", "all: initial !important; position: fixed !important; left: 0 !important; top: 0 !important; z-index: 2147483647 !important; pointer-events: none !important;");
    const root = host.attachShadow({ mode: "closed" });
    const style = doc.createElement("style");
    style.textContent = CURSOR_CSS;
    const pointer = doc.createElement("div");
    pointer.className = "pointer";
    const arrow = doc.createElement("div");
    arrow.className = "arrow";
    const label = doc.createElement("div");
    label.className = "label";
    label.textContent = "Claude";
    pointer.append(arrow, label);
    root.append(style, pointer);
    doc.documentElement.append(host);
    // ilk görünüşte sayfanın ortasından gelsin
    const x = this.#cursor?.x ?? win.innerWidth / 2;
    const y = this.#cursor?.y ?? win.innerHeight / 2;
    pointer.style.setProperty("--move", "0ms");
    pointer.style.translate = `${x}px ${y}px`;
    this.#cursor = { host, pointer, label, x, y, hideTimer: null };
    return this.#cursor;
  }

  async #moveCursor(x, y) {
    const cursor = this.#cursorEl();
    const visible = !this.document.hidden;
    const distance = Math.hypot(x - cursor.x, y - cursor.y);
    const ms = visible && distance > 2 ? Math.round(Math.min(450, 160 + distance * 0.35)) : 0;
    cursor.label.textContent = "Claude";
    cursor.pointer.classList.remove("gone");
    cursor.pointer.style.setProperty("--move", `${ms}ms`);
    cursor.pointer.style.translate = `${x}px ${y}px`;
    cursor.x = x;
    cursor.y = y;
    this.#cursorIdle();
    if (ms) await new Promise(r => setTimeout(r, ms + 30));
  }

  #press() {
    const pointer = this.#cursor?.pointer;
    if (!pointer) return;
    pointer.classList.add("press");
    setTimeout(() => pointer.classList.remove("press"), 160);
  }

  #cursorLabel(text) {
    const cursor = this.#cursor;
    if (!cursor?.host.isConnected) return;
    cursor.label.textContent = text;
    cursor.pointer.classList.remove("gone");
    this.#cursorIdle();
  }

  // boşta 4 sn sonra kaybolur (ada ile aynı)
  #cursorIdle() {
    const cursor = this.#cursor;
    clearTimeout(cursor.hideTimer);
    cursor.hideTimer = setTimeout(() => {
      cursor.label.textContent = "Claude";
      cursor.pointer.classList.add("gone");
    }, 4000);
  }

  // Claude'un kendi ekran görüntüsünde imleç ve halkalar sayfanın üstünü kapatmasın
  #overlays(hidden) {
    if (this.#cursor?.host.isConnected) this.#cursor.pointer.style.visibility = hidden ? "hidden" : "";
    if (hidden) for (const ripple of this.document.querySelectorAll("zen-mcp-ripple")) ripple.remove();
    for (const pick of this.document.querySelectorAll("zen-mcp-pick")) {
      pick.style.setProperty("visibility", hidden ? "hidden" : "visible", "important");
    }
    return "done";
  }

  // Tıklanan noktada kısa turuncu halka: kullanıcı sekmeye bakınca Claude'un son ne yaptığını
  // görsün. Kapalı shadow DOM içinde, tıklamaları engellemez, kendini siler.
  #ripple(x, y) {
    const doc = this.document;
    const host = doc.createElement("zen-mcp-ripple");
    host.setAttribute("style", `all: initial !important; position: fixed !important; left: ${x}px !important; top: ${y}px !important; z-index: 2147483647 !important; pointer-events: none !important;`);
    const root = host.attachShadow({ mode: "closed" });
    const style = doc.createElement("style");
    style.textContent = RIPPLE_CSS;
    const ring = doc.createElement("div");
    root.append(style, ring);
    doc.documentElement.append(host);
    setTimeout(() => host.remove(), 700);
  }

  // Arka plandaki sekmede tıklama odağı taşımıyor; tıklanan noktadaki odaklanabilir öğeyi
  // (kullanıcının tıklamasıyla aynı sonuç) elle odakla
  #focusAt(x, y) {
    const doc = this.document;
    const target = doc.elementFromPoint(x, y);
    const focusable = target?.closest(
      'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href], [contenteditable=""], [contenteditable="true"], [tabindex]'
    );
    if (focusable && doc.activeElement !== focusable) focusable.focus();
  }

  // Tekerlek olayı gönderilir (sayfanın wheel dinleyicileri çalışsın). Tarayıcı deltayı
  // mousewheel.default.delta_multiplier_* ile çarptığı için olay deltası ona bölünür. Arka
  // plandaki sekmede tekerlek sayfayı kaydırmaz; o zaman istenen miktar doğrudan kaydırılır.
  async #wheel(x, y, dx, dy, [mx, my]) {
    const win = this.contentWindow;
    const scroller = this.#scrollerAt(x, y);
    const before = [scroller.scrollLeft, scroller.scrollTop];
    const dpr = win.devicePixelRatio;
    this.#eu().synthesizeWheelAtPoint(x, y, { deltaX: (dx / mx) * dpr, deltaY: (dy / my) * dpr, deltaMode: 0 }, win);
    await new Promise(r => setTimeout(r, 150));
    const moved = [scroller.scrollLeft - before[0], scroller.scrollTop - before[1]];
    if (!moved[0] && !moved[1]) {
      scroller.scrollBy({ left: dx, top: dy, behavior: "instant" });
    }
    return "done";
  }

  // noktadaki öğenin kaydırılabilir en yakın atası, yoksa sayfanın kendisi
  #scrollerAt(x, y) {
    const doc = this.document;
    const win = this.contentWindow;
    for (let el = doc.elementFromPoint(x, y); el && el !== doc.documentElement; el = el.parentElement) {
      const style = win.getComputedStyle(el);
      const scrollable = /(auto|scroll|overlay)/.test(style.overflowY + style.overflowX);
      if (scrollable && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) return el;
    }
    return doc.scrollingElement || doc.documentElement;
  }

  // ---- locate: ref ile tıklama için öğeyi görünür yap, merkezini ver (CSS px, görünür alan) ----

  #locate(ref) {
    const el = this.#element(ref);
    if (!this.#fullyInViewport(el)) el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) throw new Error(`${ref} is not visible (no size).`);
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  #fullyInViewport(el) {
    const r = el.getBoundingClientRect();
    const win = this.contentWindow;
    return r.top >= 0 && r.left >= 0 && r.bottom <= win.innerHeight && r.right <= win.innerWidth;
  }
}

// ---- roller ve adlar ----

const TEXT_CONTAINERS = new Set(["paragraph", "listitem", "cell", "label"]);
const CONTROL_SELECTOR = "a[href], button, input, select, textarea, summary, [role], [contenteditable], [tabindex]";

// adı metninden gelen roller; liste öğesi, hücre, paragraf gibi yapısal öğelerin metni ad
// yerine alt satırlarda yazılır (yoksa içteki bağlantının adıyla iki kez tekrar eder)
const NAME_FROM_CONTENT = new Set([
  "button", "link", "heading", "tab", "menuitem", "option", "columnheader", "treeitem", "switch",
  "checkbox", "radio",
]);

function roleOf(el) {
  const explicit = el.getAttribute("role")?.split(/\s+/)[0];
  if (explicit && explicit !== "presentation" && explicit !== "none" && explicit !== "generic") return explicit;
  const tag = el.tagName.toUpperCase();
  switch (tag) {
    case "A":
    case "AREA":
      return el.hasAttribute("href") ? "link" : "";
    case "BUTTON":
    case "SUMMARY":
      return "button";
    case "SELECT":
      return el.multiple || el.size > 1 ? "listbox" : "combobox";
    case "TEXTAREA":
      return "textbox";
    case "INPUT":
      return INPUT_ROLES[el.type] || "textbox";
    case "IMG":
      // alt="" süs görseli demek
      return el.getAttribute("alt") === "" ? "" : "img";
  }
  if (el.isContentEditable && !el.parentElement?.isContentEditable) return "textbox";
  if (LANDMARKS[tag]) {
    // section/form yalnız adı varsa landmark sayılır
    if ((tag === "SECTION" || tag === "FORM") && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby")) return "";
    return LANDMARKS[tag];
  }
  if (STRUCTURE[tag]) return STRUCTURE[tag];
  // tıklanabilir ama anlamsal olmayan öğeler (div onclick vb. tespit edilemez; tabindex ipucu)
  if (el.hasAttribute("tabindex") && el.tabIndex >= 0) return "focusable";
  return "";
}

function accessibleName(el, doc) {
  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    const text = labelledby.split(/\s+/).map(id => doc.getElementById(id)?.innerText ?? "").join(" ");
    if (clean(text)) return truncate(clean(text), MAX_NAME);
  }
  const aria = el.getAttribute("aria-label");
  if (aria && clean(aria)) return truncate(clean(aria), MAX_NAME);
  const tag = el.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    const label = el.labels?.[0];
    if (label && clean(label.innerText)) return truncate(clean(label.innerText), MAX_NAME);
    if (tag === "INPUT" && ["button", "submit", "reset"].includes(el.type) && el.value) return truncate(el.value, MAX_NAME);
    if (el.getAttribute("placeholder")) return truncate(clean(el.getAttribute("placeholder")), MAX_NAME);
  }
  if (tag === "IMG" || (tag === "INPUT" && el.type === "image")) {
    const alt = el.getAttribute("alt");
    if (alt) return truncate(clean(alt), MAX_NAME);
  }
  const role = roleOf(el);
  if (NAME_FROM_CONTENT.has(role)) {
    // innerText: görünmeyen parçaları (ör. gizli kısayol ipuçları) atlar, blokları ayırır
    const text = clean(el.innerText ?? el.textContent);
    if (text) return truncate(text, MAX_NAME);
    // yalnız simgeden oluşan düğmeler: içteki görselin alt'ı veya svg başlığı
    const inner = el.querySelector("img[alt], svg title, [aria-label]");
    const innerName = inner?.getAttribute("alt") || inner?.getAttribute("aria-label") || inner?.textContent;
    if (innerName && clean(innerName)) return truncate(clean(innerName), MAX_NAME);
  }
  const title = el.getAttribute("title");
  if (title) return truncate(clean(title), MAX_NAME);
  return "";
}

const clean = s => (s ?? "").replace(/\s+/g, " ").trim();
const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const normalize = s => clean(s).toLocaleLowerCase("tr");
// harf/rakam dışındaki her şey ayırıcı: "package.json" → ["package", "json"]
const tokens = s => normalize(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// ---- seçilen öğe ----

// "button#cta.btn.primary"
function elementLabel(el) {
  let s = el.localName;
  if (el.id) s += "#" + el.id;
  const classes = [...el.classList].slice(0, 2);
  if (classes.length) s += "." + classes.join(".");
  return truncate(s, 60);
}

// Sayfada tek öğeye uyan kısa seçici: benzersiz id'de ya da yol benzersizleşince durur
function cssPath(el, win) {
  const doc = el.ownerDocument;
  const esc = s => win.CSS.escape(s);
  const unique = sel => {
    try { return doc.querySelectorAll(sel).length === 1; } catch { return false; }
  };
  const parts = [];
  for (let node = el; node?.nodeType === 1 && node !== doc.documentElement; node = node.parentElement) {
    if (node.id && unique(`#${esc(node.id)}`)) {
      parts.unshift(`#${esc(node.id)}`);
      break;
    }
    let part = node.localName;
    // Tailwind gibi araç sınıfları (md:flex, w-[20px]) seçiciyi uzatır; sade sınıflardan ilk ikisi
    const classes = [...node.classList].filter(c => /^[a-zA-Z_-][\w-]*$/.test(c)).slice(0, 2);
    part += classes.map(c => "." + esc(c)).join("");
    const same = node.parentElement ? [...node.parentElement.children].filter(c => c.localName === node.localName) : [];
    if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
    parts.unshift(part);
    if (unique(parts.join(" > "))) break;
  }
  return parts.join(" > ");
}

// Tasarım düzeltmesi için önemli hesaplanmış stiller; varsayılan değerler atlanır
function pickStyles(el, win) {
  const s = win.getComputedStyle(el);
  const out = { display: s.display };
  if (s.position !== "static") out.position = s.position;
  out.font = `${s.fontWeight} ${s.fontSize}/${s.lineHeight} ${s.fontFamily.split(",")[0].trim()}`;
  out.color = s.color;
  if (s.backgroundColor !== "rgba(0, 0, 0, 0)") out.background = s.backgroundColor;
  if (s.backgroundImage !== "none") out["background-image"] = truncate(s.backgroundImage, 200);
  if (s.padding && s.padding !== "0px") out.padding = s.padding;
  if (s.margin && s.margin !== "0px") out.margin = s.margin;
  if (parseFloat(s.borderTopWidth) || parseFloat(s.borderRightWidth) || parseFloat(s.borderBottomWidth) || parseFloat(s.borderLeftWidth)) {
    out.border = s.border || `${s.borderWidth} ${s.borderStyle} ${s.borderColor}`;
  }
  if (s.borderRadius && s.borderRadius !== "0px") out["border-radius"] = s.borderRadius;
  if (/flex|grid/.test(s.display)) {
    if (s.display.includes("flex")) out["flex-direction"] = s.flexDirection;
    if (s.display.includes("grid")) out["grid-template-columns"] = truncate(s.gridTemplateColumns, 120);
    out["justify-content"] = s.justifyContent;
    out["align-items"] = s.alignItems;
    if (s.gap && s.gap !== "normal") out.gap = s.gap;
  }
  if (s.opacity !== "1") out.opacity = s.opacity;
  // Tailwind her öğeye saydam ring/gölge katmanları koyar; yalnız görünenler
  const shadows = splitTopLevel(s.boxShadow).filter(l => l !== "none" && !/rgba\([^)]*,\s*0\)|\/\s*0\)|transparent/.test(l));
  if (shadows.length) out["box-shadow"] = truncate(shadows.join(", "), 160);
  return out;
}

// virgülle ayrılmış CSS listesi, parantez içindeki virgüller bölünmeden
function splitTopLevel(value) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "(") depth++;
    else if (value[i] === ")") depth--;
    else if (value[i] === "," && !depth) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

// Production build'de adlar küçültülmüş ("_", "y", "Oe"): yanıltmasın diye atlanır
const isMinified = name => name.length <= 2;
// Next.js iç sınırları: __next_root_layout_boundary__ gibi
const isInternal = name => /^__.*__$/.test(name);

// Geliştirme sürümündeki React (fiber) ya da Vue bileşen zinciri, dıştan içe: repoda doğru
// dosyayı bulmak için. Sayfanın nesnelerine Xray'siz bakılır.
function componentChain(el) {
  try {
    const raw = Cu.waiveXrays(el);
    const key = Object.keys(raw).find(k => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
    if (key) {
      const names = [];
      for (let fiber = raw[key]; fiber && names.length < 8; fiber = fiber.return) {
        const type = fiber.type;
        if (!type || typeof type === "string") continue;
        const name = type.displayName || type.name || type.render?.displayName || type.render?.name || type.type?.displayName || type.type?.name;
        if (typeof name === "string" && name && !isMinified(name) && !isInternal(name) && !FRAMEWORK_COMPONENTS.has(name) && names.at(-1) !== name) names.push(name);
      }
      return names.length ? { framework: "React", chain: names.reverse() } : null;
    }
    // Vue 3 geliştirme sürümü bileşenin dosyasını da tutar
    let instance = raw.__vueParentComponent;
    if (instance) {
      const names = [];
      let file = null;
      for (; instance && names.length < 8; instance = instance.parent) {
        const type = instance.type;
        const name = type?.__name || type?.name;
        if (typeof name === "string" && name && !isMinified(name)) names.push(name);
        if (!file && typeof type?.__file === "string") file = type.__file;
      }
      return names.length ? { framework: "Vue", chain: names.reverse(), file } : null;
    }
  } catch {}
  return null;
}

// console.* argümanı sayfanın nesnesi: Xray'i kaldırıp JSON dene, olmazsa String
function formatArg(arg) {
  if (typeof arg === "string") return arg;
  try {
    const raw = Cu.waiveXrays(arg);
    if (raw && typeof raw === "object") {
      if ("stack" in raw && "message" in raw) return `${raw.name ?? "Error"}: ${raw.message}`;
      const json = JSON.stringify(raw);
      if (json !== undefined) return truncate(json, 500);
    }
    return String(raw);
  } catch {
    return String(arg);
  }
}

function describe(value) {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "nodeType" in value) {
    return value.outerHTML ?? value.textContent ?? String(value);
  }
  try {
    const json = JSON.stringify(value, null, 2);
    if (json !== undefined) return json;
  } catch {}
  return String(value);
}
