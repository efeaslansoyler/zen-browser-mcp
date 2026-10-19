// Claude adası: Zen pencerelerinin üst ortasında, sayfanın üzerinde duran hap (Dynamic Island
// gibi). Claude'un ne yaptığını gösterir, Durdur/Devam düğmesi burada. Compact mode'da da
// görünür (kenar çubuğuna/araç çubuğuna bağlı değil). Boştayken gizli.
//
// Yalnız görünüm: durdurma, sekmeye gitme gibi işleri main.js'ten gelen geri çağrılar yapar.
// Stil Zen'in kendi bildirimiyle aynı dil (zen-popup.css #zen-toast-container), tema rengine uyar.

const XHTML = "http://www.w3.org/1999/xhtml";
const ID = "zen-mcp-island";
const HIDE_AFTER = 4000;

const CSS = `
  #${ID} {
    position: fixed;
    z-index: 1001;
    translate: -50% 0;
    display: flex;
    align-items: center;
    gap: 8px;
    box-sizing: border-box;
    max-width: min(560px, 80vw);
    min-height: 36px;
    padding: 5px 5px 5px 12px;
    border-radius: 14px;
    background: linear-gradient(to bottom, var(--zen-primary-color) -40%, color-mix(in srgb, var(--zen-primary-color), #0f0f0f 20%));
    box-shadow: light-dark(rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.4)) 0 0 22px 2px;
    font: menu;
    font-size: 13px;
    font-weight: 600;
    transform-origin: top center;
    transition: opacity 0.2s ease, scale 0.2s ease, translate 0.2s ease;
    -moz-window-dragging: no-drag;

    &[hidden] {
      display: flex !important;
      opacity: 0;
      scale: 0.92;
      translate: -50% -8px;
      pointer-events: none;
    }

    & .dot {
      flex: none;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #d97757;
      animation: zen-mcp-pulse 1.2s ease-in-out infinite;
    }
    &[state="stopped"] .dot {
      animation: none;
      background: color-mix(in srgb, currentColor 45%, transparent);
    }

    & .info {
      display: flex;
      gap: 6px;
      min-width: 0;
      cursor: pointer;
    }
    & .text {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-weight: 500;
      opacity: 0.75;
    }

    & button {
      appearance: none;
      flex: none;
      margin: 0;
      padding: 5px 10px;
      border: none;
      border-radius: 9px;
      background: light-dark(rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0.1));
      color: inherit;
      font: inherit;
      font-size: 12px;
      cursor: pointer;

      &:hover {
        background: light-dark(rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0.18));
      }
    }
  }

  @keyframes zen-mcp-pulse {
    50% { opacity: 0.35; }
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
    const dot = doc.createElementNS(XHTML, "span");
    dot.className = "dot";
    const info = doc.createElementNS(XHTML, "span");
    info.className = "info";
    const name = doc.createElementNS(XHTML, "span");
    name.textContent = "Claude";
    const text = doc.createElementNS(XHTML, "span");
    text.className = "text";
    info.append(name, text);
    const button = doc.createElementNS(XHTML, "button");
    el.append(dot, info, button);
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

    this.#windows.set(win, { el, text, button, onKey, onResize });
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

  // Claude bir sekmede iş yapıyor; son işlemden HIDE_AFTER sonra gizlenir
  working(browser, text) {
    if (this.#state === "stopped") return;
    this.#state = "working";
    this.#text = text;
    this.#browser = new WeakRef(browser);
    this.#render();
    this.#clearTimeout(this.#hideTimer);
    this.#hideTimer = this.#setTimeout(() => this.#hide(), HIDE_AFTER);
  }

  stopped() {
    this.#clearTimeout(this.#hideTimer);
    this.#state = "stopped";
    this.#text = "durduruldu";
    this.#render();
  }

  resumed() {
    this.#state = "working";
    this.#text = "devam edebilir";
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
    const owner = this.#browser?.deref()?.ownerDocument?.defaultView;
    for (const [win, { el, text, button }] of this.#windows) {
      const visible = this.#state === "stopped" || (this.#state === "working" && win === owner);
      el.setAttribute("state", this.#state);
      text.textContent = this.#text;
      button.textContent = this.#state === "stopped" ? "Devam et" : "■ Durdur";
      button.title = this.#state === "stopped" ? "" : "Claude'u durdur (Ctrl+Shift+Esc)";
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
