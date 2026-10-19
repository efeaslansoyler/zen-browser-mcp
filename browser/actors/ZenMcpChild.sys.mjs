// İçerik sürecinde, her sayfanın üst çerçevesinde çalışır. Hatalar fırlatılmaz, { error }
// olarak döner: sendQuery hata mesajını düzgün taşımıyor.
//
// read_page/find öğelere "ref_N" kimliği verir; kimlikler bu actor örneğinde (yani bu sayfa
// yüklemesinde) geçerlidir, yeni sayfada sıfırlanır. DOM'a ayrıcalıklı (Xray) erişimle bakılır:
// sayfanın kendi tanımladığı özellikler/override'lar görülmez, yerel DOM davranışı esastır.

const { setTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");

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
  #ids = new WeakMap();
  #next = 1;

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
        case "form_input":
          return { value: this.#formInput(data.ref, data.value) };
        case "locate":
          return this.#locate(data.ref);
        case "input":
          return { value: await this.#input(data) };
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
      id = `ref_${this.#next++}`;
      this.#ids.set(el, id);
      this.#refs.set(id, new WeakRef(el));
    }
    return id;
  }

  #element(ref) {
    const el = this.#refs.get(ref)?.deref();
    if (!el || !el.isConnected) {
      throw new Error(`${ref} bulunamadı (sayfa değişmiş olabilir); read_page veya find ile yeniden al.`);
    }
    return el;
  }

  // ---- read_page ----

  #readPage({ filter = "all", depth = 30, ref_id, max_chars = MAX_TREE }) {
    const root = ref_id ? this.#element(ref_id) : this.document.body;
    if (!root) return "(sayfa boş)";
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
      const hint = interactiveOnly ? "find ile ara" : 'filter: "interactive" kullan';
      lines.push(`…(kesildi: ${max_chars} karakter sınırı; ref_id ile alt ağaca odaklan veya ${hint})`);
    }
    const doc = this.document;
    return `${doc.title}\n${doc.URL}\n\n${lines.join("\n") || "(görünür öğe yok)"}`;
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
    if (!this.#inViewport(el)) parts.push("(görünür alanın dışında)");
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
    if (!words.length) throw new Error("Boş sorgu.");
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
    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, 20);
    if (!top.length) return `"${query}" ile eşleşen öğe yok. read_page ile sayfanın yapısına bak.`;
    return top.map(({ el, role }) => this.#describeElement(el, role)).join("\n");
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
      if (!opt) throw new Error(`"${wanted}" seçeneği yok. Seçenekler: ${[...el.options].map(o => o.text.trim()).join(", ")}`);
      el.value = opt.value;
      fire("input");
      fire("change");
      return `${ref}: "${opt.text.trim()}" seçildi.`;
    }
    if (tag === "INPUT" && (el.type === "checkbox" || el.type === "radio")) {
      const checked = value === true || value === "true" || value === 1 || value === "1" || value === "on";
      if (el.checked !== checked) {
        // tıklama: sayfanın click dinleyicileri ve label/radio grubu davranışı da çalışsın
        el.click();
      }
      return `${ref}: ${el.checked ? "işaretli" : "işaretsiz"}.`;
    }
    if (tag === "INPUT" || tag === "TEXTAREA") {
      el.focus();
      // Xray üzerinden atama yerel setter'ı çağırır; React'in değer izleyicisi değişikliği görür
      el.value = String(value);
      fire("input");
      fire("change");
      return `${ref}: değer ayarlandı.`;
    }
    if (el.isContentEditable) {
      el.focus();
      this.document.execCommand("selectAll");
      this.document.execCommand("insertText", false, String(value));
      return `${ref}: içerik ayarlandı.`;
    }
    throw new Error(`${ref} bir form alanı değil (${roleOf(el) || tag.toLowerCase()}).`);
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

  async #input({ kind, x, y, to, button = 0, count = 1, modifiers = {}, keys, text, dx = 0, dy = 0, multiplier = [1, 1] }) {
    const win = this.contentWindow;
    const eu = this.#eu();
    const mouse = (px, py, event) => eu.synthesizeMouseAtPoint(px, py, { ...modifiers, ...event }, win);
    switch (kind) {
      case "click":
        mouse(x, y, { type: "mousemove" });
        for (let i = 1; i <= count; i++) {
          mouse(x, y, { type: "mousedown", button, clickCount: i });
          mouse(x, y, { type: "mouseup", button, clickCount: i });
        }
        if (button === 0) this.#focusAt(x, y);
        return "tamam";
      case "hover":
        mouse(x, y, { type: "mousemove" });
        return "tamam";
      case "drag": {
        mouse(x, y, { type: "mousemove" });
        mouse(x, y, { type: "mousedown" });
        const steps = 10;
        for (let i = 1; i <= steps; i++) {
          mouse(x + ((to[0] - x) * i) / steps, y + ((to[1] - y) * i) / steps, { type: "mousemove", buttons: 1 });
        }
        mouse(to[0], to[1], { type: "mouseup" });
        return "tamam";
      }
      case "wheel":
        return this.#wheel(x, y, dx, dy, multiplier);
      case "keys":
        for (const { key, mods } of keys) eu.synthesizeKey(key, mods, win);
        return "tamam";
      case "text":
        text.split("\n").forEach((line, i) => {
          if (i > 0) eu.synthesizeKey("KEY_Enter", {}, win);
          if (line) eu.sendString(line, win);
        });
        return "tamam";
      default:
        throw new Error(`Bilinmeyen girdi: ${kind}`);
    }
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
    return "tamam";
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
    if (!r.width && !r.height) throw new Error(`${ref} görünmüyor (boyutu yok).`);
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
