// The island: a pill at the top center of Zen windows, over the page (like Dynamic Island).
// It shows what the agent is doing and holds the Stop/Resume button; when the agent needs
// the user (ask_user) or the page opens a dialog, it expands with the message and "Go to
// tab". Visible in compact mode too. Hidden when idle.
//
// View only: stopping, going to the tab, cancelling and the like are done by callbacks from
// main.js.

const { agentTheme, applyTheme, agentIcon } = ChromeUtils.importESModule(
  new URL("./Agent.sys.mjs", import.meta.url).href + new URL(import.meta.url).search,
);

const XHTML = "http://www.w3.org/1999/xhtml";
// UI language: Turkish if the browser is Turkish, English otherwise
const L = (en, tr) => (Services.locale.appLocaleAsBCP47.startsWith("tr") ? tr : en);
const ID = "zen-mcp-island";
const HIDE_AFTER = 4000;
const PREVIEW_WIDTH = 340; // live preview width (CSS px)
const PREVIEW_EVERY = 400; // ms, ~2,5 kare/sn

// spinning star: the "working" sign
const SPARK =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path stroke="#d97757" stroke-width="2" stroke-linecap="round" d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4M3.4 3.4l2.8 2.8M9.8 9.8l2.8 2.8M3.4 12.6l2.8-2.8M9.8 6.2l2.8-2.8"/></svg>`,
  );

// Like Dynamic Island: a dark, fully rounded pill, the same in every theme (dark reads on light themes too)
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
    /* inner edge: keeps the pill apart from dark pages (e.g. YouTube's header) */
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

    /* waiting for the user: a pulse in the agent color */
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
        background: var(--zen-agent-accent, #d97757);
        color: var(--zen-agent-foreground, #fff);
        &:hover { background: var(--zen-agent-hover, #e08667); }
      }
    }

    /* mode: "auto" / "ask"; toggles on click */
    & .mode {
      padding: 0 9px;
      background: none;
      font-weight: 500;
      font-size: 11px;
      opacity: 0.55;

      &:hover { opacity: 1; background: rgba(255, 255, 255, 0.1); }
      &[mode="ask"] { opacity: 0.9; color: var(--zen-agent-accent, #e8a58e); }
    }
    &:not([state="working"]) .mode { display: none; }

    /* stop: a small round ■; once stopped, a colored "Resume" */
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
      background: var(--zen-agent-accent, #d97757);
      color: var(--zen-agent-foreground, #fff);

      &::before { display: none; }
      &:hover { background: var(--zen-agent-hover, #e08667); }
    }
    &:is([state="ask"], [state="dialog"], [state="picking"], [state="compose"], [state="sent"]) .stop { display: none; }
    &:is([state="picking"], [state="compose"], [state="sent"]) .spark { animation: none; }

    & .hint {
      flex: none;
      opacity: 0.5;
      font-size: 11.5px;
      &:empty { display: none; }
    }

    /* element picked: "What should happen?" */
    & .compose {
      display: none;
      flex-direction: column;
      gap: 8px;
      padding: 0 10px 10px 33px;
    }
    &[state="compose"] .compose { display: flex; }
    & textarea {
      appearance: none;
      box-sizing: border-box;
      width: 400px;
      max-width: 100%;
      height: 56px;
      margin: 0;
      padding: 7px 9px;
      resize: none;
      border: none;
      border-radius: 9px;
      outline: none;
      background: rgba(255, 255, 255, 0.08);
      color: inherit;
      font: inherit;
      line-height: 1.4;

      &:focus { box-shadow: inset 0 0 0 1px rgba(var(--zen-agent-rgb, 217, 119, 87), 0.7); }
      /* the note on an approval question: one line, sent with either button */
      &.answer-note { height: 32px; }
      &::placeholder { color: rgba(243, 243, 243, 0.45); }
    }
    & .compose-footer {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    & .target {
      flex: 1; min-width: 0; max-width: 280px;
      background: #252525; color: inherit; border: 1px solid #555;
      border-radius: 6px; padding: 4px; font: inherit; font-size: 11.5px;
    }

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
    /* live preview: on hover, a small live view of the agent's tab */
    & .preview {
      display: none;
      padding: 0 6px 6px;
      cursor: pointer;

      & canvas {
        display: block;
        width: ${PREVIEW_WIDTH}px;
        max-height: 240px;
        object-fit: cover;
        object-position: top;
        border-radius: 11px;
        background: #000;
      }
    }
    /* while a question is shown, the preview must not cover the page next to the buttons */
    &[previewing][state="working"] .preview { display: block; }

    & .buttons {
      display: flex;
      gap: 6px;
      justify-content: flex-end;
    }
    /* ask_user options: one button per answer, wrapping under the message */
    & .choices {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      &[hidden] { display: none; }
    }
    &[state="dialog"] .cancel { display: none; }
    & :is(.goto, .ok)[hidden] { display: none; }
  }

  @keyframes zen-mcp-spin {
    to { rotate: 1turn; }
  }
  @keyframes zen-mcp-glow {
    50% { box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(var(--zen-agent-rgb, 217, 119, 87), 0.6), 0 0 18px rgba(var(--zen-agent-rgb, 217, 119, 87), 0.45); }
  }
`;

const isStopKey = (event) =>
  event.key === "Escape" && event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey;
// Ctrl+Shift+F: pick elements (Ctrl+Shift+E is Zen's network monitor)
const isPickKey = (event) =>
  event.key?.toLowerCase() === "f" && event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey;
const SENT_FOR = 2500;

export class Island {
  #agent = agentTheme({ id: "claude" });
  #windows = new Map(); // window → DOM parts and listeners
  #sheet = Services.io.newURI("data:text/css;charset=utf-8," + encodeURIComponent(CSS));
  #state = "hidden"; // hidden | working | ask | dialog | stopped
  #text = "";
  #message = "";
  #askDone = false; // ask_user wait: "done" → OK on the island
  #askLabels = {}; // { ok, cancel }: button labels (request_tab: Allow / Deny)
  #askOptions = []; // ask_user options: answer buttons that replace OK
  #browser = null; // the tab of the latest action (WeakRef)
  #hideTimer = null;
  // The user's pick goes over the agent's state; afterwards the island returns to it:
  // { mode: "picking" | "compose" | "sent", browser (WeakRef), label, target, text }
  #pick = null;
  #pickTimer = null;
  #mode = "auto"; // "auto" | "ask"
  #actions;
  #setTimeout;
  #clearTimeout;

  // actions: { stop(), resume(), goTo(browser), answer(browser, "done" | "cancelled", note, choice?),
  //            pick(win), send(note), cancelPick(), toggleMode() }
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
    const hint = node("span", "hint");
    info.append(favicon, host, text, hint);
    const mode = node("button", "mode");
    mode.addEventListener("click", () => this.#actions.toggleMode());
    const stop = node("button", "stop");
    row.append(spark, info, mode, stop);
    const detail = node("div", "detail");
    const message = node("div", "message");
    const buttons = node("div", "buttons");
    const cancel = node("button", "cancel", L("Cancel", "Vazgeç"));
    const goto = node("button", "goto", L("Go to tab", "Sekmeye git"));
    const ok = node("button", "ok primary", L("OK", "Tamam"));
    buttons.append(cancel, goto, ok);
    const answerNote = node("textarea", "answer-note");
    answerNote.placeholder = L("Note for the agent (optional)", "Ajana not (isteğe bağlı)");
    answerNote.rows = 1;
    answerNote.setAttribute("aria-label", answerNote.placeholder);
    answerNote.maxLength = 2000;
    const choices = node("div", "choices");
    detail.append(message, choices, answerNote, buttons);
    const preview = node("div", "preview");
    preview.title = L("Go to tab", "Sekmeye git");
    const canvas = node("canvas");
    preview.append(canvas);
    const compose = node("div", "compose");
    const note = node("textarea");
    note.placeholder = L("What should the agent do?", "Ne yapılsın?");
    const footer = node("div", "compose-footer");
    const target = node("select", "target");
    target.setAttribute("aria-label", L("Destination session", "Hedef oturum"));
    target.addEventListener("change", () => {
      if (this.#pick?.mode !== "compose" || this.#pick.sending) return;
      this.#pick.targetId = target.value;
      const selected = this.#pick.targets.find((t) => t.id === target.value);
      this.#pick.agent = selected?.agent ?? agentTheme(null);
      this.#actions.selectTarget?.(selected);
      this.#render();
    });
    const discard = node("button", "", L("Cancel", "Vazgeç"));
    const send = node("button", "primary", L("Send", "Gönder"));
    footer.append(target, discard, send);
    compose.append(note, footer);
    el.append(row, detail, compose, preview);
    doc.documentElement.append(el);

    const submit = () => {
      if (this.#pick?.mode !== "compose") return;
      const value = note.value.trim();
      if (value && !this.#pick.sending) {
        this.#pick.sending = true;
        target.disabled = true;
        send.disabled = true;
        send.textContent = L("Sending…", "Gönderiliyor…");
        note.disabled = true;
        this.#actions.send(value, this.#pick.targetId);
      } else note.focus();
    };
    send.addEventListener("click", submit);
    discard.addEventListener("click", () => this.#actions.cancelPick());
    // Enter sends, Shift+Enter adds a line, Esc cancels
    note.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        submit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.#actions.cancelPick();
      }
    });

    const goToTab = () => {
      if (this.#pick) return;
      const browser = this.#browser?.deref();
      if (browser) this.#actions.goTo(browser);
    };
    info.addEventListener("click", goToTab);
    goto.addEventListener("click", goToTab);
    preview.addEventListener("click", goToTab);
    el.addEventListener("mouseenter", () => this.#startPreview(win));
    el.addEventListener("mouseleave", () => this.#stopPreview(win));
    // A question without a tab answers with browser null; a tab that's gone answers nothing.
    const answer =
      (result, ...choice) =>
      () => {
        const browser = this.#browser ? this.#browser.deref() : null;
        if (browser !== undefined) this.#actions.answer(browser, result, answerNote.value.trim(), ...choice);
      };
    cancel.addEventListener("click", answer("cancelled"));
    ok.addEventListener("click", answer("done"));
    stop.addEventListener("click", () => {
      if (this.#state === "stopped") this.#actions.resume();
      else this.#actions.stop();
    });
    // Ctrl+Shift+Esc: stop the agent (also while the page has focus; the browser sees keys first)
    // Ctrl+Shift+F: pick elements (pressing it again while picking cancels)
    const onKey = (event) => {
      if (isPickKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        this.#actions.pick(win);
        return;
      }
      if (!isStopKey(event) || this.#state === "stopped") return;
      event.preventDefault();
      event.stopPropagation();
      this.#actions.stop();
    };
    win.addEventListener("keydown", onKey, true);
    const onResize = () => this.#place(win);
    win.addEventListener("resize", onResize);
    // once the user is on the agent's tab, "Go to tab" is pointless
    const onTabSelect = () => this.#render();
    win.gBrowser.tabContainer.addEventListener("TabSelect", onTabSelect);

    this.#windows.set(win, {
      el,
      favicon,
      host,
      text,
      hint,
      mode,
      stop,
      message,
      cancel,
      goto,
      ok,
      note,
      target,
      send,
      canvas,
      previewing: false,
      onKey,
      onResize,
      onTabSelect,
      answerNote,
      choices,
      answer,
    });
    this.#fillChoices(win);
    this.#render();
  }

  detach(win) {
    const parts = this.#windows.get(win);
    if (!parts) return;
    this.#windows.delete(win);
    parts.previewing = false;
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
    this.#clearTimeout(this.#pickTimer);
    for (const win of [...this.#windows.keys()]) this.detach(win);
  }

  get state() {
    return this.#state;
  }

  setAgent(agent) {
    this.#agent = agentTheme(agent);
    this.#render();
  }

  // The agent is working in a tab; stays visible while the action runs.
  working(browser, text) {
    if (this.#state === "stopped" || this.#state === "ask") return;
    this.#clearTimeout(this.#hideTimer);
    this.#state = "working";
    this.#text = text;
    this.#browser = new WeakRef(browser);
    this.#render();
  }

  // No action running: hide after HIDE_AFTER (cancelled if a new action arrives).
  idle() {
    if (this.#state !== "working") return;
    this.#clearTimeout(this.#hideTimer);
    this.#hideTimer = this.#setTimeout(() => this.#hide(), HIDE_AFTER);
  }

  // The agent needs the user: expand and show the message until askEnded.
  // done: an OK button (wait: "done"); otherwise it ends when the user clicks the element.
  // labels: button labels, e.g. { ok: "Allow", cancel: "Deny" }
  // options: answer buttons instead of OK; browser null: a question not tied to a tab,
  // shown in every window
  ask(browser, text, message, done, labels = {}, options = []) {
    if (this.#state === "stopped") return;
    this.#clearTimeout(this.#hideTimer);
    this.#state = "ask";
    this.#text = text;
    this.#message = message;
    this.#askDone = done;
    this.#askLabels = labels;
    this.#askOptions = options ?? [];
    for (const parts of this.#windows.values()) parts.answerNote.value = "";
    for (const win of this.#windows.keys()) this.#fillChoices(win);
    // don't wait for the "sent" notice; a running pick or note stays on top
    if (this.#pick?.mode === "sent") {
      this.#clearTimeout(this.#pickTimer);
      this.#pick = null;
    }
    this.#browser = browser ? new WeakRef(browser) : null;
    this.#render();
  }

  #fillChoices(win) {
    const parts = this.#windows.get(win);
    parts.choices.replaceChildren(
      ...this.#askOptions.map((option) => {
        const button = win.document.createElementNS(XHTML, "button");
        button.className = "choice";
        button.textContent = option;
        button.addEventListener("click", parts.answer("done", option));
        return button;
      }),
    );
  }

  // A running ask's title changes (show_me: "Recording · 3 steps").
  askProgress(text) {
    if (this.#state !== "ask") return;
    this.#text = text;
    this.#render();
  }

  #clearChoices() {
    this.#askOptions = [];
    for (const win of this.#windows.keys()) this.#fillChoices(win);
  }

  askEnded() {
    if (this.#state !== "ask") return;
    this.#clearChoices();
    // a tab-less question leaves no tab to show "working" for
    if (!this.#browser) {
      this.#state = "hidden";
      this.#render();
      return;
    }
    this.#state = "working";
    this.#render();
    this.idle();
  }

  // The page opened alert/confirm/prompt; stays until dialogEnded (or a new action).
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

  // The tab is no longer the agent's (the user took it back): hide if it is shown.
  release(browser) {
    if (this.#state === "stopped" || this.#browser?.deref() !== browser) return;
    this.#clearTimeout(this.#hideTimer);
    this.#state = "hidden";
    this.#browser = null;
    this.#render();
  }

  stopped() {
    this.#clearTimeout(this.#hideTimer);
    this.#state = "stopped";
    this.#text = "";
    this.#clearChoices();
    this.#render();
  }

  resumed() {
    this.#state = "working";
    this.#text = L("resuming", "devam ediyor");
    this.#render();
    this.#clearTimeout(this.#hideTimer);
    this.#hideTimer = this.#setTimeout(() => this.#hide(), 2000);
  }

  // The agent mode: auto (acts without asking) | ask (asks before each action)
  setMode(mode) {
    if (mode === this.#mode) return;
    this.#mode = mode;
    this.#render();
  }

  // ---- the user's element pick ----

  get pickMode() {
    return this.#pick?.mode ?? null;
  }

  // picker open: "click an element"
  picking(browser, agent = { id: "claude" }) {
    this.#clearTimeout(this.#pickTimer);
    this.#pick = { mode: "picking", browser: new WeakRef(browser), agent };
    this.#render();
  }

  // Element picked: the note box; target is the receiving session's name (none: clipboard).
  compose(browser, label, targets = [], targetId = "") {
    this.#clearTimeout(this.#pickTimer);
    const selected = targets.find((t) => t.id === targetId);
    this.#pick = {
      mode: "compose",
      browser: new WeakRef(browser),
      label,
      targets,
      targetId: selected?.id ?? "",
      agent: selected?.agent ?? agentTheme(null),
    };
    for (const parts of this.#windows.values()) {
      parts.note.disabled = false;
      parts.target.disabled = false;
      parts.send.disabled = false;
      parts.send.textContent = L("Send", "Gönder");
    }
    for (const parts of this.#windows.values()) parts.note.value = "";
    this.#render();
    const owner = browser.ownerDocument?.defaultView;
    this.#windows.get(owner)?.note.focus();
  }

  // "sent" shows briefly, then the island returns to the agent's state
  sent(text) {
    const browser = this.#pick?.browser;
    if (!browser) return;
    this.#pick = { mode: "sent", browser, text, agent: this.#pick.agent };
    this.#render();
    this.#clearTimeout(this.#pickTimer);
    this.#pickTimer = this.#setTimeout(() => this.pickEnded(), SENT_FOR);
  }

  pickEnded() {
    this.#clearTimeout(this.#pickTimer);
    if (!this.#pick) return;
    this.#pick = null;
    this.#render();
  }

  #hide() {
    if (this.#state !== "working") return;
    // don't vanish while the user watches the preview; idle() counts again when the mouse leaves
    if ([...this.#windows.values()].some((p) => p.previewing)) return;
    this.#state = "hidden";
    this.#render();
  }

  // In every window while stopped; otherwise only in the window of the agent's tab
  #render() {
    const pick = this.#pick;
    const browser = (pick ? pick.browser : this.#browser)?.deref();
    const owner = browser?.ownerDocument?.defaultView;
    const state = pick ? pick.mode : this.#state;
    const stopped = state === "stopped";
    // "example.com — clicking": the site dimmed, the action prominent; the tab's favicon first
    let [siteName, action] = this.#text.includes(" — ") ? this.#text.split(" — ") : ["", this.#text];
    let hintText = "";
    if (pick) {
      siteName = "";
      if (pick.mode === "picking") {
        action = L("Select elements (up to 8)", "Öğeleri seç (en çok 8)");
        hintText = L("Shift-click: add/remove · Enter: done · Esc", "Shift+tık: ekle/çıkar · Enter: bitir · Esc");
      } else if (pick.mode === "compose") {
        try {
          siteName = browser.currentURI.host;
        } catch {}
        action = pick.label;
      } else action = pick.text;
    }
    let icon = null;
    try {
      icon = owner?.gBrowser.getIcon(owner.gBrowser.getTabForBrowser(browser));
    } catch {}
    for (const [win, parts] of this.#windows) {
      const { el, favicon, host, text, hint, mode, stop, message, cancel, goto, ok, target } = parts;
      const theme = applyTheme(el, pick ? pick.agent : this.#agent);
      const spark = el.querySelector(".spark");
      spark.title = theme.name;
      spark.textContent = theme.id === "codex" ? "" : theme.glyph;
      spark.style.background = theme.id === "codex" ? `url("${agentIcon(theme)}") center / contain no-repeat` : "none";
      spark.style.color = theme.accent;
      spark.style.font = theme.id === "claude" ? "bold 17px/14px system-ui" : "bold 11px/14px monospace";
      spark.style.animation = theme.id === "claude" && !stopped ? "" : "none";
      el.setAttribute("aria-label", theme.name);
      mode.setAttribute("mode", this.#mode);
      mode.textContent = this.#mode === "ask" ? L("ask", "onaylı") : L("auto", "otomatik");
      mode.title =
        this.#mode === "ask"
          ? L(
              `${theme.name} asks before every action. Click: auto (acts without asking)`,
              `${theme.name} her işlemde izin istiyor. Tıkla: otomatik (sormadan işlem yapar)`,
            )
          : L(
              `${theme.name} acts without asking. Click: ask (asks before every action)`,
              `${theme.name} sormadan işlem yapıyor. Tıkla: onaylı (her işlemde izin ister)`,
            );
      const anywhere = state === "ask" && !pick && !this.#browser;
      const visible = stopped || anywhere || (state !== "hidden" && win === owner);
      el.setAttribute("state", state);
      host.textContent = stopped ? "" : siteName;
      text.textContent = stopped
        ? L(`${theme.name} is stopped`, `${theme.name} durduruldu`)
        : `${theme.name} · ${action}`;
      hint.textContent = hintText;
      if (pick?.mode === "compose") {
        const options = [...pick.targets, { id: "", name: L("Clipboard", "Pano") }].map((destination) => {
          const option = win.document.createElementNS(XHTML, "option");
          option.value = destination.id;
          option.textContent = destination.name;
          return option;
        });
        target.replaceChildren(...options);
        target.value = pick.targetId;
      }
      if (icon && !stopped) favicon.src = icon;
      else favicon.removeAttribute("src");
      stop.textContent = stopped ? L("Resume", "Devam et") : "";
      stop.title = stopped ? "" : L("Stop all agents (Ctrl+Shift+Esc)", "Tüm ajanları durdur (Ctrl+Shift+Esc)");
      message.textContent = this.#message;
      parts.answerNote.hidden = state !== "ask";
      parts.choices.hidden = state !== "ask" || !this.#askOptions.length;
      // on the agent's tab already, "Go to tab" is pointless; without OK it is the primary button
      goto.hidden = !browser || win.gBrowser.selectedBrowser === browser;
      ok.hidden = !(state === "ask" && this.#askDone && !this.#askOptions.length);
      ok.textContent = this.#askLabels.ok ?? L("OK", "Tamam");
      cancel.textContent = this.#askLabels.cancel ?? L("Cancel", "Vazgeç");
      goto.classList.toggle("primary", ok.hidden);
      if (visible) this.#place(win);
      el.hidden = !visible;
    }
  }

  // ---- live preview ----

  #startPreview(win) {
    const parts = this.#windows.get(win);
    if (!parts || parts.previewing) return;
    parts.previewing = true;
    parts.el.setAttribute("previewing", "true");
    this.#clearTimeout(this.#hideTimer);
    this.#previewLoop(parts);
  }

  #stopPreview(win) {
    const parts = this.#windows.get(win);
    if (!parts) return;
    parts.previewing = false;
    parts.el.removeAttribute("previewing");
    this.idle();
  }

  // A background tab's image comes from drawSnapshot (without selecting the tab)
  async #previewLoop(parts) {
    while (parts.previewing) {
      const browser = this.#browser?.deref();
      const wg = browser?.browsingContext?.currentWindowGlobal;
      if (wg && this.#state !== "stopped") {
        try {
          const width = browser.getBoundingClientRect().width || 1;
          const dpr = browser.ownerDocument.defaultView.devicePixelRatio;
          const bitmap = await wg.drawSnapshot(null, (PREVIEW_WIDTH * dpr) / width, "white");
          if (parts.previewing) {
            parts.canvas.width = bitmap.width;
            parts.canvas.height = bitmap.height;
            parts.canvas.getContext("2d").drawImage(bitmap, 0, 0);
          }
          bitmap.close();
        } catch {}
      }
      await new Promise((r) => this.#setTimeout(r, PREVIEW_EVERY));
    }
  }

  // the top center of the page area (also right in compact mode with the toolbar hidden)
  #place(win) {
    const parts = this.#windows.get(win);
    const panels = win.gBrowser?.tabpanels;
    if (!parts || !panels) return;
    const r = panels.getBoundingClientRect();
    parts.el.style.top = `${r.top + 8}px`;
    parts.el.style.left = `${r.left + r.width / 2}px`;
  }
}
