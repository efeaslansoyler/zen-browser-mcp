// Claude adası: Zen pencerelerinin üst ortasında, sayfanın üzerinde duran hap (Dynamic Island
// gibi). Claude'un ne yaptığını gösterir, Durdur/Devam düğmesi burada; Claude kullanıcıdan
// bir şey istediğinde (ask_user) ya da sayfa diyalog açtığında genişleyip mesajı ve
// "Sekmeye git"i gösterir. Compact mode'da da görünür. Boştayken gizli.
//
// Yalnız görünüm: durdurma, sekmeye gitme, vazgeçme gibi işleri main.js'ten gelen geri
// çağrılar yapar.

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
    flex-direction: column;
    box-sizing: border-box;
    max-width: min(520px, 70vw);
    border-radius: 17px;
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

    /* kullanıcıdan bir şey bekleniyor: turuncu nabız */
    &:is([state="ask"], [state="dialog"]) {
      animation: zen-mcp-glow 1.8s ease-in-out infinite;
    }

    & .row {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 34px;
      padding: 0 5px 0 11px;
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
      flex: 1;
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
      margin: 0;
      padding: 0 12px;
      height: 24px;
      border: none;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.1);
      color: inherit;
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease;

      &:hover { background: rgba(255, 255, 255, 0.2); }
      &.primary {
        background: #d97757;
        color: #fff;
        &:hover { background: #e08667; }
      }
    }

    /* durdurma: küçük yuvarlak ■; durdurulunca turuncu "Devam et" */
    & .stop {
      display: grid;
      place-items: center;
      width: 24px;
      padding: 0;

      &::before {
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 2px;
        background: currentColor;
      }
    }
    &[state="stopped"] .stop {
      width: auto;
      padding: 0 12px;
      background: #d97757;
      color: #fff;

      &::before { display: none; }
      &:hover { background: #e08667; }
    }
    &:is([state="ask"], [state="dialog"]) .stop { display: none; }

    & .detail {
      display: none;
      flex-direction: column;
      gap: 10px;
      padding: 0 12px 11px 33px;
    }
    &:is([state="ask"], [state="dialog"]) .detail { display: flex; }
    & .message {
      white-space: pre-wrap;
      line-height: 1.45;
      font-weight: 500;
      max-height: 6.5em;
      overflow: auto;
    }
    & .buttons {
      display: flex;
      gap: 6px;
      justify-content: flex-end;
    }
    &[state="dialog"] .cancel { display: none; }
    & .goto[hidden] { display: none; }
  }

  @keyframes zen-mcp-spin {
    to { rotate: 1turn; }
  }
  @keyframes zen-mcp-glow {
    50% { box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(217, 119, 87, 0.6), 0 0 18px rgba(217, 119, 87, 0.45); }
  }
`;

const isStopKey = event =>
  event.key === "Escape" && event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey;

export class Island {
  #windows = new Map(); // pencere → DOM parçaları ve dinleyiciler
  #sheet = Services.io.newURI("data:text/css;charset=utf-8," + encodeURIComponent(CSS));
  #state = "hidden"; // hidden | working | ask | dialog | stopped
  #text = "";
  #message = "";
  #browser = null; // son işlem yapılan sekme (WeakRef)
  #hideTimer = null;
  #actions;
  #setTimeout;
  #clearTimeout;

  // actions: { stop(), resume(), goTo(browser), cancelAsk(browser) }
  constructor(actions, { setTimeout, clearTimeout }) {
    this.#actions = actions;
    this.#setTimeout = setTimeout;
    this.#clearTimeout = clearTimeout;
  }

  attach(win) {
    if (this.#windows.has(win) || !win.gBrowser) return;
    const doc = win.document;
    win.windowUtils.loadSheet(this.#sheet, win.windowUtils.AUTHOR_SHEET);

    const node = (tag, cls, text) => {
      const n = doc.createElementNS(XHTML, tag);
      if (cls) n.className = cls;
      if (text) n.textContent = text;
      return n;
    };
    const el = node("div");
    el.id = ID;
    el.hidden = true;
    const row = node("div", "row");
    const spark = node("span", "spark");
    spark.title = "Claude";
    const info = node("span", "info");
    const favicon = node("img", "favicon");
    const host = node("span", "host");
    const text = node("span", "action");
    info.append(favicon, host, text);
    const stop = node("button", "stop");
    row.append(spark, info, stop);
    const detail = node("div", "detail");
    const message = node("div", "message");
    const buttons = node("div", "buttons");
    const cancel = node("button", "cancel", "Vazgeç");
    const goto = node("button", "goto primary", "Sekmeye git");
    buttons.append(cancel, goto);
    detail.append(message, buttons);
    el.append(row, detail);
    doc.documentElement.append(el);

    const goToTab = () => {
      const browser = this.#browser?.deref();
      if (browser) this.#actions.goTo(browser);
    };
    info.addEventListener("click", goToTab);
    goto.addEventListener("click", goToTab);
    cancel.addEventListener("click", () => {
      const browser = this.#browser?.deref();
      if (browser) this.#actions.cancelAsk(browser);
    });
    stop.addEventListener("click", () => {
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
    // kullanıcı Claude'un sekmesine geçince "Sekmeye git" gereksiz
    const onTabSelect = () => this.#render();
    win.gBrowser.tabContainer.addEventListener("TabSelect", onTabSelect);

    this.#windows.set(win, { el, favicon, host, text, stop, message, goto, onKey, onResize, onTabSelect });
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
      win.gBrowser.tabContainer.removeEventListener("TabSelect", parts.onTabSelect);
      win.windowUtils.removeSheet(this.#sheet, win.windowUtils.AUTHOR_SHEET);
    } catch {}
  }

  destroy() {
    this.#clearTimeout(this.#hideTimer);
    for (const win of [...this.#windows.keys()]) this.detach(win);
  }

  get state() {
    return this.#state;
  }

  // Claude bir sekmede iş yapıyor; işlem sürdükçe görünür kalır
  working(browser, text) {
    if (this.#state === "stopped" || this.#state === "ask") return;
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

  // Claude kullanıcıdan bir şey istiyor: genişle, mesajı göster; askEnded'e kadar kalır
  ask(browser, text, message) {
    if (this.#state === "stopped") return;
    this.#clearTimeout(this.#hideTimer);
    this.#state = "ask";
    this.#text = text;
    this.#message = message;
    this.#browser = new WeakRef(browser);
    this.#render();
  }

  askEnded() {
    if (this.#state !== "ask") return;
    this.#state = "working";
    this.#render();
    this.idle();
  }

  // sayfa alert/confirm/prompt açtı; dialogEnded'e (ya da yeni işleme) kadar kalır
  dialog(browser, text, message) {
    if (this.#state === "stopped" || this.#state === "ask") return;
    this.#clearTimeout(this.#hideTimer);
    this.#state = "dialog";
    this.#text = text;
    this.#message = message;
    this.#browser = new WeakRef(browser);
    this.#render();
  }

  dialogEnded() {
    if (this.#state !== "dialog") return;
    this.#state = "working";
    this.#render();
    this.idle();
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
    if (this.#state !== "working") return;
    this.#state = "hidden";
    this.#render();
  }

  // Durdurulmuşken her pencerede; diğer durumlarda yalnız Claude'un sekmesinin penceresinde
  #render() {
    const browser = this.#browser?.deref();
    const owner = browser?.ownerDocument?.defaultView;
    const stopped = this.#state === "stopped";
    // "seaskablo.com — tıklıyor": site soluk, işlem belirgin; sekmenin favicon'u başta
    const [siteName, action] = this.#text.includes(" — ") ? this.#text.split(" — ") : ["", this.#text];
    let icon = null;
    try { icon = owner?.gBrowser.getIcon(owner.gBrowser.getTabForBrowser(browser)); } catch {}
    for (const [win, parts] of this.#windows) {
      const { el, favicon, host, text, stop, message, goto } = parts;
      const visible = stopped || (this.#state !== "hidden" && win === owner);
      el.setAttribute("state", this.#state);
      host.textContent = stopped ? "" : siteName;
      text.textContent = stopped ? "Claude durduruldu" : action;
      if (icon && !stopped) favicon.src = icon;
      else favicon.removeAttribute("src");
      stop.textContent = stopped ? "Devam et" : "";
      stop.title = stopped ? "" : "Claude'u durdur (Ctrl+Shift+Esc)";
      message.textContent = this.#message;
      goto.hidden = win.gBrowser.selectedBrowser === browser;
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
