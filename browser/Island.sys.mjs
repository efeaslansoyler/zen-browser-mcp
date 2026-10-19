// Claude adası: Zen pencerelerinin üst ortasında, sayfanın üzerinde duran hap (Dynamic Island
// gibi). Claude'un ne yaptığını gösterir, Durdur/Devam düğmesi burada. Compact mode'da da
// görünür (kenar çubuğuna/araç çubuğuna bağlı değil). Boştayken gizli.
//
// Yalnız görünüm: durdurma, sekmeye gitme gibi işleri main.js'ten gelen geri çağrılar yapar.
// Stil Zen'in kendi bildirimiyle aynı dil (zen-popup.css #zen-toast-container), tema rengine uyar.

const XHTML = "http://www.w3.org/1999/xhtml";
const ID = "zen-mcp-island";
const HIDE_AFTER = 4000;

// dönen yıldız: Claude'un "çalışıyor" işareti
const SPARK = "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path stroke="#d97757" stroke-width="2" stroke-linecap="round" d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4M3.4 3.4l2.8 2.8M9.8 9.8l2.8 2.8M3.4 12.6l2.8-2.8M9.8 6.2l2.8-2.8"/></svg>`
);

// Dynamic Island gibi: koyu, tam yuvarlak hap; her temada aynı (koyu hap açık temada da okunur)
const CSS = `
  #${ID} {
    position: fixed;
    z-index: 1001;
    translate: -50% 0;
    display: flex;
    align-items: center;
    gap: 8px;
    box-sizing: border-box;
    height: 34px;
    max-width: min(520px, 70vw);
    padding: 0 5px 0 11px;
    border-radius: 999px;
    background: rgba(14, 14, 14, 0.94);
    color: #f3f3f3;
    /* iç kenar: koyu sayfalarda (ör. YouTube başlığı) hap arka plana karışmasın */
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(255, 255, 255, 0.12);
    font: menu;
    font-size: 12.5px;
    transform-origin: top center;
    transition:
      opacity 0.2s ease,
      scale 0.4s cubic-bezier(0.2, 0.9, 0.3, 1.25),
      translate 0.4s cubic-bezier(0.2, 0.9, 0.3, 1.25);
    -moz-window-dragging: no-drag;

    &[hidden] {
      display: flex !important;
      opacity: 0;
      scale: 0.6;
      translate: -50% -12px;
      pointer-events: none;
    }

    & .spark {
      flex: none;
      width: 14px;
      height: 14px;
      background: url("${SPARK}") center / contain no-repeat;
      animation: zen-mcp-spin 2.4s linear infinite;
    }
    &[state="stopped"] .spark {
      animation: none;
      filter: grayscale(1);
      opacity: 0.5;
    }

    & .info {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      cursor: pointer;
    }
    & .favicon {
      flex: none;
      width: 14px;
      height: 14px;
      border-radius: 3px;

      &:not([src]) { display: none; }
    }
    & .host {
      flex: none;
      opacity: 0.5;
    }
    & .action {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-weight: 500;
    }

    & button {
      appearance: none;
      flex: none;
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      margin: 0;
      padding: 0;
      border: none;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.1);
      color: inherit;
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease;

      &::before {
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 2px;
        background: currentColor;
      }
      &:hover { background: rgba(255, 255, 255, 0.2); }
    }
    &[state="stopped"] button {
      width: auto;
      padding: 0 12px;
      background: #d97757;
      color: #fff;

      &::before { display: none; }
      &:hover { background: #e08667; }
    }
  }

  @keyframes zen-mcp-spin {
    to { rotate: 1turn; }
  }
`;

const isStopKey = event =>
  event.key === "Escape" && event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey;

export class Island {
  #windows = new Map(); // pencere → { el, text, button, onKey, onResize }
  #sheet = Services.io.newURI("data:text/css;charset=utf-8," + encodeURIComponent(CSS));
  #state = "hidden"; // hidden | working | stopped
  #text = "";
  #browser = null; // son işlem yapılan sekme (WeakRef)
  #hideTimer = null;
  #actions;
  #setTimeout;
  #clearTimeout;

  // actions: { stop(), resume(), goTo(browser) }
  constructor(actions, { setTimeout, clearTimeout }) {
    this.#actions = actions;
    this.#setTimeout = setTimeout;
    this.#clearTimeout = clearTimeout;
  }

  attach(win) {
    if (this.#windows.has(win) || !win.gBrowser) return;
    const doc = win.document;
    win.windowUtils.loadSheet(this.#sheet, win.windowUtils.AUTHOR_SHEET);

    const el = doc.createElementNS(XHTML, "div");
    el.id = ID;
    el.hidden = true;
    const span = cls => {
      const node = doc.createElementNS(XHTML, "span");
      node.className = cls;
      return node;
    };
    const spark = span("spark");
    spark.title = "Claude";
    const info = span("info");
    const favicon = doc.createElementNS(XHTML, "img");
    favicon.className = "favicon";
    const host = span("host");
    const text = span("action");
    info.append(favicon, host, text);
    const button = doc.createElementNS(XHTML, "button");
    el.append(spark, info, button);
    doc.documentElement.append(el);

    info.addEventListener("click", () => {
      const browser = this.#browser?.deref();
      if (browser) this.#actions.goTo(browser);
    });
    button.addEventListener("click", () => {
      if (this.#state === "stopped") this.#actions.resume();
      else this.#actions.stop();
    });
    // Ctrl+Shift+Esc: Claude'u durdur (sayfa odaktayken de; tuşları önce tarayıcı görür)
    const onKey = event => {
      if (!isStopKey(event) || this.#state === "stopped") return;
      event.preventDefault();
      event.stopPropagation();
      this.#actions.stop();
    };
    win.addEventListener("keydown", onKey, true);
    const onResize = () => this.#place(win);
    win.addEventListener("resize", onResize);

    this.#windows.set(win, { el, favicon, host, text, button, onKey, onResize });
    this.#render();
  }

  detach(win) {
    const parts = this.#windows.get(win);
    if (!parts) return;
    this.#windows.delete(win);
    try {
      parts.el.remove();
      win.removeEventListener("keydown", parts.onKey, true);
      win.removeEventListener("resize", parts.onResize);
      win.windowUtils.removeSheet(this.#sheet, win.windowUtils.AUTHOR_SHEET);
    } catch {}
  }

  destroy() {
    this.#clearTimeout(this.#hideTimer);
    for (const win of [...this.#windows.keys()]) this.detach(win);
  }

  // Claude bir sekmede iş yapıyor; işlem sürdükçe görünür kalır
  working(browser, text) {
    if (this.#state === "stopped") return;
    this.#clearTimeout(this.#hideTimer);
    this.#state = "working";
    this.#text = text;
    this.#browser = new WeakRef(browser);
    this.#render();
  }

  // süren işlem kalmadı: HIDE_AFTER sonra gizlen (arada yeni işlem gelirse iptal)
  idle() {
    if (this.#state !== "working") return;
    this.#clearTimeout(this.#hideTimer);
    this.#hideTimer = this.#setTimeout(() => this.#hide(), HIDE_AFTER);
  }

  stopped() {
    this.#clearTimeout(this.#hideTimer);
    this.#state = "stopped";
    this.#text = "";
    this.#render();
  }

  resumed() {
    this.#state = "working";
    this.#text = "devam ediyor";
    this.#render();
    this.#clearTimeout(this.#hideTimer);
    this.#hideTimer = this.#setTimeout(() => this.#hide(), 2000);
  }

  #hide() {
    if (this.#state === "stopped") return;
    this.#state = "hidden";
    this.#render();
  }

  // Durdurulmuşken her pencerede; çalışırken yalnız işlem yapılan sekmenin penceresinde
  #render() {
    const browser = this.#browser?.deref();
    const owner = browser?.ownerDocument?.defaultView;
    const stopped = this.#state === "stopped";
    // "seaskablo.com — tıklıyor": site soluk, işlem belirgin; sekmenin favicon'u başta
    const [siteName, action] = this.#text.includes(" — ") ? this.#text.split(" — ") : ["", this.#text];
    let icon = null;
    try { icon = owner?.gBrowser.getIcon(owner.gBrowser.getTabForBrowser(browser)); } catch {}
    for (const [win, { el, favicon, host, text, button }] of this.#windows) {
      const visible = stopped || (this.#state === "working" && win === owner);
      el.setAttribute("state", this.#state);
      host.textContent = stopped ? "" : siteName;
      text.textContent = stopped ? "Claude durduruldu" : action;
      if (icon && !stopped) favicon.src = icon;
      else favicon.removeAttribute("src");
      button.textContent = stopped ? "Devam et" : "";
      button.title = stopped ? "" : "Claude'u durdur (Ctrl+Shift+Esc)";
      if (visible) this.#place(win);
      el.hidden = !visible;
    }
  }

  // sayfa alanının üst ortası (compact mode'da araç çubuğu gizliyken de doğru yer)
  #place(win) {
    const parts = this.#windows.get(win);
    const panels = win.gBrowser?.tabpanels;
    if (!parts || !panels) return;
    const r = panels.getBoundingClientRect();
    parts.el.style.top = `${r.top + 8}px`;
    parts.el.style.left = `${r.left + r.width / 2}px`;
  }
}
