const { agentTheme, applyTheme, agentIcon } = ChromeUtils.importESModule(
  new URL("./Agent.sys.mjs", import.meta.url).href + new URL(import.meta.url).search,
);
const { renderReview, REVIEW_CSS } = ChromeUtils.importESModule(
  new URL("./RecordingReview.sys.mjs", import.meta.url).href + new URL(import.meta.url).search,
);

const XHTML = "http://www.w3.org/1999/xhtml";
const L = (en, tr) => (Services.locale.appLocaleAsBCP47.startsWith("tr") ? tr : en);
const ID = "zen-mcp-island";
const HIDE_AFTER = 4000;
const PREVIEW_WIDTH = 340;
const PREVIEW_EVERY = 400;
const SWITCH_EVERY = 1500;
const RECENT = 1200;
const UNPIN_AFTER = 5000;
const MAX_ICONS = 5;
const HOLD_REFRESH = 30_000;

const SPARK =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path stroke="#d97757" stroke-width="2" stroke-linecap="round" d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4M3.4 3.4l2.8 2.8M9.8 9.8l2.8 2.8M3.4 12.6l2.8-2.8M9.8 6.2l2.8-2.8"/></svg>`,
  );

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
    /* working: the agents' row is the island; asking: it sits under the card, smaller */
    &[state="working"] .main { display: none; }
    & .workers { display: none; }
    &[state="working"] .workers { display: flex; }
    &[state="ask"] .workers[busy] {
      display: flex;
      height: 30px;
      margin: 0 6px;
      padding-left: 5px;
      font-size: 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
    }
    & .w-icon {
      flex: none;
      width: 15px;
      height: 15px;
      background: center / contain no-repeat;
    }
    & .pager {
      display: flex;
      align-items: center;
      gap: 3px;
      flex: none;
      &[hidden] { display: none; }
    }
    & .pager button.arr {
      width: 20px;
      height: 20px;
      padding: 0;
      font-size: 9px;
      &[disabled] { opacity: 0.3; cursor: default; }
    }
    & button.av {
      position: relative;
      width: 16px;
      height: 16px;
      padding: 0;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.07) center / 11px no-repeat;
      opacity: 0.55;
      &[on] { opacity: 1; box-shadow: 0 0 0 1.5px var(--c); }
      &[recent] { opacity: 1; box-shadow: 0 0 6px 1px var(--c); }
      &[locked]::after { content: "🔒"; position: absolute; right: -4px; bottom: -4px; font-size: 8px; }
    }
    & .more, & .count {
      flex: none;
      font-size: 11px;
      opacity: 0.7;
      padding: 0 3px;
    }
    & .count { display: flex; align-items: center; gap: 4px; }
    & .mini {
      width: 11px;
      height: 11px;
      background: center / contain no-repeat;
      opacity: 0.8;
    }
    /* a question came while the user reads another card */
    & button.arr[unseen] { position: relative; }
    & button.arr[unseen]::after {
      content: "";
      position: absolute;
      top: -2px;
      right: -2px;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #ff6b6b;
      box-shadow: 0 0 0 2px rgba(14, 14, 14, 0.94);
    }
    & .count[unseen] { animation: zen-mcp-blink 0.6s ease-in-out 3; }
    /* tab_work hold of the agent shown: a lock and the time left; on hover why, and Remove hold */
    & .lock {
      flex: none;
      font-size: 11px;
      padding: 2px 7px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.1);
      white-space: nowrap;
      &[hidden] { display: none; }
    }
    & .holdline {
      display: none;
      align-items: center;
      gap: 8px;
      padding: 0 12px 9px 34px;
      font-size: 11.5px;
      & span { opacity: 0.8; }
      & button { margin-left: auto; height: 22px; font-size: 11px; }
    }
    &[previewing][state="working"] .holdline[hold] { display: flex; }

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

    /* mode: "auto" / "ask"; toggles on click (on the agents' row) */
    & .mode {
      padding: 0 9px;
      background: none;
      font-weight: 500;
      font-size: 11px;
      opacity: 0.55;

      &:hover { opacity: 1; background: rgba(255, 255, 255, 0.1); }
      &[mode="ask"] { opacity: 0.9; color: var(--zen-agent-accent, #e8a58e); }
    }

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
    &:is([state="ask"], [state="dialog"], [state="picking"], [state="compose"], [state="sent"]) .main .stop { display: none; }
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
    & .element-notes {
      display: flex;
      flex-direction: column;
      gap: 6px;
      &:empty { display: none; }
    }
    & .element-note {
      display: flex;
      align-items: center;
      gap: 6px;
      & .number { flex: none; width: 16px; text-align: center; opacity: 0.7; font-size: 11.5px; }
      & textarea { flex: 1; width: auto; height: 32px; }
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
${REVIEW_CSS}
  }

  @keyframes zen-mcp-rec {
    50% { opacity: 0.45; }
  }

  @keyframes zen-mcp-blink {
    50% { opacity: 0.25; }
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
const isPickKey = (event) =>
  event.key?.toLowerCase() === "f" && event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey;
const SENT_FOR = 2500;

export class Island {
  #agent = agentTheme({ id: "claude" });
  #windows = new Map();
  #sheet = Services.io.newURI("data:text/css;charset=utf-8," + encodeURIComponent(CSS));
  #state = "hidden";
  #text = "";
  #message = "";
  #browser = null;
  #workers = new Map();
  #shownWorker = null;
  #switchedAt = 0;
  // why: Manual row selection must stay in place while the user examines it.
  #pinned = false;
  #hovering = false;
  #unpinTimer = null;
  #renderTimer = null;
  #renderAt = 0;
  #cards = [];
  #nextCard = 1;
  #shownCard = null;
  #unseen = false;
  // why: Keep the underlying agent state while the user finishes their pick.
  #pick = null;
  #pickTimer = null;
  #fresh = false;
  #review = null;
  #mode = "auto";
  #actions;
  #setTimeout;
  #clearTimeout;

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
    const row = node("div", "row main");
    const recdot = node("span", "recdot");
    const spark = node("span", "spark");
    spark.title = "Claude";
    const info = node("span", "info");
    const favicon = node("img", "favicon");
    const host = node("span", "host");
    const text = node("span", "action");
    const hint = node("span", "hint");
    info.append(favicon, host, text, hint);
    const stop = node("button", "stop");
    // why: Keep recording controls reachable without expanding the island.
    const recCancel = node("button", "rec-button", L("Cancel", "Vazgeç"));
    const recFinish = node("button", "rec-button primary", L("Finish", "Bitir"));
    const cardPager = node("span", "pager");
    const cardPrev = node("button", "arr", "◀");
    const cardCount = node("span", "count");
    const cardNext = node("button", "arr", "▶");
    cardPager.append(cardPrev, cardCount, cardNext);
    row.append(recdot, spark, info, cardPager, recCancel, recFinish, stop);
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
    const workers = node("div", "row workers");
    const wIcon = node("span", "w-icon");
    const wInfo = node("span", "info");
    const wFavicon = node("img", "favicon");
    const wHost = node("span", "host");
    const wText = node("span", "action");
    wInfo.append(wFavicon, wHost, wText);
    const lock = node("span", "lock");
    const pager = node("span", "pager");
    const prev = node("button", "arr", "◀");
    const icons = node("span", "pager");
    const next = node("button", "arr", "▶");
    pager.append(prev, icons, next);
    const mode = node("button", "mode");
    mode.addEventListener("click", () => this.#actions.toggleMode());
    const wStop = node("button", "stop");
    workers.append(wIcon, wInfo, lock, pager, mode, wStop);
    const holdline = node("div", "holdline");
    const holdText = node("span");
    const removeHold = node("button", "", L("Remove hold", "Tutmayı kaldır"));
    holdline.append(holdText, removeHold);
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
    const elementNotes = node("div", "element-notes");
    compose.append(note, elementNotes, footer);
    const reviewHost = node("div", "review-host");
    el.append(row, detail, workers, holdline, reviewHost, compose, preview);
    doc.documentElement.append(el);

    const submit = () => {
      if (this.#pick?.mode !== "compose") return;
      const value = note.value.trim();
      const fields = this.#windows.get(win)?.elementFields ?? [];
      const notes = fields.map((field) => field.value.trim());
      if ((value || notes.some(Boolean)) && !this.#pick.sending) {
        this.#pick.sending = true;
        target.disabled = true;
        send.disabled = true;
        send.textContent = L("Sending…", "Gönderiliyor…");
        note.disabled = true;
        for (const field of fields) field.disabled = true;
        this.#actions.send(value, this.#pick.targetId, notes);
      } else note.focus();
    };
    send.addEventListener("click", submit);
    discard.addEventListener("click", () => this.#actions.cancelPick());
    const onNoteKey = (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        submit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.#actions.cancelPick();
      }
    };
    note.addEventListener("keydown", onNoteKey);

    const goTo = (browser) => {
      if (!this.#pick && browser) this.#actions.goTo(browser);
    };
    const mainBrowser = () => {
      const card = this.#card();
      return (card && this.#stateNow() === "ask" ? card.browser : this.#browser)?.deref();
    };
    info.addEventListener("click", () => goTo(mainBrowser()));
    goto.addEventListener("click", () => goTo(mainBrowser()));
    wInfo.addEventListener("click", () => goTo(this.#worker()?.browser.deref()));
    preview.addEventListener("click", () => goTo(this.#previewBrowser()));
    el.addEventListener("mouseenter", () => {
      this.#hovering = true;
      this.#clearTimeout(this.#unpinTimer);
      this.#startPreview(win);
    });
    el.addEventListener("mouseleave", () => {
      this.#hovering = false;
      this.#stopPreview(win);
      this.#clearTimeout(this.#unpinTimer);
      this.#unpinTimer = this.#setTimeout(() => {
        this.#pinned = false;
        this.#render();
      }, UNPIN_AFTER);
    });
    prev.addEventListener("click", () => this.#stepWorker(-1));
    next.addEventListener("click", () => this.#stepWorker(1));
    removeHold.addEventListener("click", () => {
      const browser = this.#worker()?.browser.deref();
      if (browser) this.#actions.releaseHold?.(browser);
      this.#render();
    });
    cardPrev.addEventListener("click", () => this.#stepCard(-1));
    cardNext.addEventListener("click", () => this.#stepCard(1));
    // why: Note editing must retain the arrow keys.
    el.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key) || this.#stateNow() !== "ask") return;
      if (["TEXTAREA", "INPUT", "SELECT"].includes(event.target?.tagName?.toUpperCase())) return;
      event.preventDefault();
      this.#stepCard(event.key === "ArrowLeft" ? -1 : 1);
    });
    // why: Bind an answer to the card being displayed, including tab-less questions.
    const answer =
      (result, ...choice) =>
      () => {
        const card = this.#card();
        if (!card || this.#stateNow() !== "ask") return;
        if (card.browser && !card.browser.deref()) return;
        this.#actions.answer(card.key, result, answerNote.value.trim(), ...choice);
      };
    const recordingAnswer = (result) => () => {
      const browser = this.#browser?.deref();
      if (browser) this.#actions.answer(browser, result, "");
    };
    cancel.addEventListener("click", answer("cancelled"));
    ok.addEventListener("click", answer("done"));
    recCancel.addEventListener("click", recordingAnswer("cancelled"));
    recFinish.addEventListener("click", recordingAnswer("done"));
    const onStop = () => {
      if (this.#state === "stopped") this.#actions.resume();
      else this.#actions.stop();
    };
    stop.addEventListener("click", onStop);
    wStop.addEventListener("click", onStop);
    // why: Listen in browser chrome so Stop works while the page has focus.
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
    const onTabSelect = () => this.#render();
    win.gBrowser.tabContainer.addEventListener("TabSelect", onTabSelect);

    this.#windows.set(win, {
      el,
      spark,
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
      elementNotes,
      elementFields: [],
      onNoteKey,
      target,
      send,
      canvas,
      cardPager,
      cardPrev,
      cardCount,
      cardNext,
      workers,
      wIcon,
      wFavicon,
      wHost,
      wText,
      wStop,
      lock,
      pager,
      prev,
      icons,
      next,
      holdline,
      holdText,
      previewing: false,
      onKey,
      onResize,
      onTabSelect,
      answerNote,
      choices,
      choicesFor: undefined,
      noteFor: undefined,
      answer,
      reviewHost,
      reviewView: null,
      reviewVersion: -1,
    });
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
    this.#clearTimeout(this.#pickTimer);
    this.#clearTimeout(this.#unpinTimer);
    this.#clearTimeout(this.#renderTimer);
    for (const worker of this.#workers.values()) this.#clearTimeout(worker.ending);
    for (const win of [...this.#windows.keys()]) this.detach(win);
  }

  get state() {
    return this.#pick ? this.#pick.mode : this.#stateNow();
  }

  #stateNow() {
    if (["stopped", "recording", "review", "dialog"].includes(this.#state)) return this.#state;
    if (this.#cards.length) return "ask";
    return this.#workers.size ? "working" : "hidden";
  }

  refresh() {
    this.#render();
  }

  setAgent(agent) {
    this.#agent = agentTheme(agent);
    this.#render();
  }

  working(browser, text, { session = "", agent = this.#agent } = {}) {
    if (this.#state === "stopped") return;
    const worker = this.#workers.get(session) ?? { session };
    this.#clearTimeout(worker.ending);
    Object.assign(worker, { agent: agentTheme(agent), browser: new WeakRef(browser), text, at: Date.now() });
    worker.ending = null;
    this.#workers.set(session, worker);
    this.#render();
  }

  // why: Keep the preview on screen while the user is watching it.
  finished(session = "") {
    const worker = this.#workers.get(session);
    if (!worker) return;
    this.#clearTimeout(worker.ending);
    const end = () => {
      if (this.#hovering && this.#shownWorker === session) {
        worker.ending = this.#setTimeout(end, HIDE_AFTER);
        return;
      }
      this.#workers.delete(session);
      this.#render();
    };
    worker.ending = this.#setTimeout(end, HIDE_AFTER);
  }

  // why: Limit automatic switches so multiple busy agents do not make the row flicker.
  #worker() {
    const workers = [...this.#workers.values()];
    if (!workers.length) return null;
    let shown = this.#workers.get(this.#shownWorker);
    if (shown && (this.#pinned || this.#hovering)) return shown;
    const latest = workers.reduce((a, b) => (b.at > a.at ? b : a));
    const wait = SWITCH_EVERY - (Date.now() - this.#switchedAt);
    if (!shown || (latest !== shown && wait <= 0)) {
      shown = latest;
      this.#shownWorker = latest.session;
      this.#switchedAt = Date.now();
    } else if (latest !== shown) this.#later(wait);
    return shown;
  }

  #stepWorker(step) {
    const workers = [...this.#workers.values()];
    if (workers.length < 2) return;
    const i = workers.indexOf(this.#worker());
    this.#selectWorker(workers[(i + step + workers.length) % workers.length].session);
  }

  #selectWorker(session) {
    this.#shownWorker = session;
    this.#pinned = true;
    this.#switchedAt = Date.now();
    this.#render();
  }

  // why: Keep the earliest pending redraw so later actions cannot postpone it indefinitely.
  #later(ms) {
    const at = Date.now() + Math.max(ms, 50);
    if (this.#renderTimer && this.#renderAt <= at) return;
    this.#clearTimeout(this.#renderTimer);
    this.#renderAt = at;
    this.#renderTimer = this.#setTimeout(() => {
      this.#renderTimer = null;
      this.#render();
    }, at - Date.now());
  }

  ask(browser, text, message, done, labels = {}, options = [], { key = browser, agent = this.#agent } = {}) {
    if (this.#state === "stopped") return null;
    const card = {
      id: this.#nextCard++,
      key,
      browser: browser ? new WeakRef(browser) : null,
      text,
      message,
      done,
      labels: labels ?? {},
      options: options ?? [],
      agent: agentTheme(agent),
    };
    this.#cards.push(card);
    if (this.#card() !== card) this.#unseen = true;
    // why: A delivery notice is transient; an active pick or draft needs priority.
    if (this.#pick?.mode === "sent") {
      this.#clearTimeout(this.#pickTimer);
      this.#pick = null;
    }
    this.#render();
    return card.id;
  }

  // why: A new question must not displace the card the user is reading.
  #card() {
    if (!this.#cards.length) return null;
    let card = this.#cards.find((c) => c.id === this.#shownCard);
    if (!card) {
      const selected = (c) => {
        const browser = c.browser?.deref();
        return browser && browser.ownerDocument?.defaultView?.gBrowser?.selectedBrowser === browser;
      };
      card = this.#cards.find(selected) ?? this.#cards[0];
      this.#shownCard = card.id;
    }
    return card;
  }

  #stepCard(step) {
    if (this.#cards.length < 2) return;
    const i = this.#cards.indexOf(this.#card());
    const next = i + step;
    if (next < 0 || next >= this.#cards.length) return;
    this.#shownCard = this.#cards[next].id;
    this.#unseen = false;
    this.#render();
  }

  askEnded(id) {
    if (id == null) return this.#recordingEnded();
    const before = this.#cards.length;
    this.#cards = this.#cards.filter((card) => card.id !== id);
    if (this.#cards.length === before) return;
    if (this.#shownCard === id) {
      this.#shownCard = null;
      this.#unseen = false;
    }
    this.#render();
  }

  #fillChoices(win, card) {
    const parts = this.#windows.get(win);
    if (parts.choicesFor === card?.id) return;
    parts.choicesFor = card?.id;
    parts.choices.replaceChildren(
      ...(card?.options ?? []).map((option) => {
        const button = win.document.createElementNS(XHTML, "button");
        button.className = "choice";
        button.textContent = option;
        button.addEventListener("click", parts.answer("done", option));
        return button;
      }),
    );
  }

  recording(browser, text, message) {
    if (this.#state === "stopped") return;
    this.#state = "recording";
    this.#text = text;
    this.#message = message;
    this.#fresh = true;
    this.#browser = new WeakRef(browser);
    this.#render();
  }

  recordingProgress(text) {
    if (this.#state !== "recording") return;
    this.#text = text;
    this.#fresh = false;
    this.#render();
  }

  // why: Reuse the island answer path for recording review so Save and Cancel settle the same wait.
  review(browser, text, model) {
    if (this.#state === "stopped") return;
    this.#state = "review";
    this.#text = text;
    this.#review = { model, version: 0 };
    this.#browser = new WeakRef(browser);
    this.#render();
  }

  #reviewChanged() {
    if (!this.#review) return;
    this.#review.version++;
    this.#render();
  }

  // why: Rebuilding the review panel on unrelated renders would lose the user's focus and typing.
  #renderReview(win, parts, visible) {
    const review = this.#state === "review" && visible ? this.#review : null;
    if (!review) {
      parts.reviewView?.dispose();
      parts.reviewView = null;
      parts.reviewVersion = -1;
      parts.reviewHost.replaceChildren();
      return;
    }
    if (parts.reviewVersion === review.version) return;
    const first = parts.reviewView === null;
    const mode = parts.reviewMode;
    parts.reviewView?.dispose();
    const answer = (result, choice) => {
      const browser = this.#browser?.deref();
      if (browser) this.#actions.answer(browser, result, "", choice);
    };
    parts.reviewView = renderReview(win.document, review.model, {
      changed: () => this.#reviewChanged(),
      save: () => answer("done", review.model.result()),
      cancel: () => answer("cancelled"),
      setTimeout: this.#setTimeout,
      clearTimeout: this.#clearTimeout,
    });
    parts.reviewVersion = review.version;
    parts.reviewMode = review.model.mode;
    parts.reviewHost.replaceChildren(parts.reviewView.node);
    if (first || mode !== review.model.mode) parts.reviewView.focus?.();
  }

  #recordingEnded() {
    if (!["recording", "review"].includes(this.#state)) return;
    this.#review = null;
    this.#state = "hidden";
    this.#render();
  }

  dialog(browser, text, message) {
    if (["stopped", "recording", "review"].includes(this.#state) || this.#cards.length) return;
    this.#state = "dialog";
    this.#text = text;
    this.#message = message;
    this.#browser = new WeakRef(browser);
    this.#render();
  }

  dialogEnded() {
    if (this.#state !== "dialog") return;
    this.#state = "hidden";
    this.#render();
  }

  release(browser) {
    for (const [session, worker] of this.#workers) {
      if (worker.browser.deref() !== browser) continue;
      this.#clearTimeout(worker.ending);
      this.#workers.delete(session);
    }
    if (this.#state !== "stopped" && this.#browser?.deref() === browser) {
      this.#state = "hidden";
      this.#browser = null;
    }
    this.#render();
  }

  stopped() {
    this.#state = "stopped";
    this.#text = "";
    this.#review = null;
    for (const worker of this.#workers.values()) this.#clearTimeout(worker.ending);
    this.#workers.clear();
    // why: Stop cancels the calls behind the cards, so their answers can no longer be used.
    this.#cards = [];
    this.#shownCard = null;
    this.#unseen = false;
    this.#render();
  }

  resumed() {
    this.#state = "hidden";
    this.#render();
  }

  setMode(mode) {
    if (mode === this.#mode) return;
    this.#mode = mode;
    this.#render();
  }

  get pickMode() {
    return this.#pick?.mode ?? null;
  }

  picking(browser, agent = { id: "claude" }) {
    this.#clearTimeout(this.#pickTimer);
    this.#pick = { mode: "picking", browser: new WeakRef(browser), agent };
    this.#render();
  }

  compose(browser, label, targets = [], targetId = "", count = 1) {
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
    for (const [win, parts] of this.#windows) {
      parts.note.value = "";
      parts.note.placeholder =
        count > 1
          ? L("Note for all elements (optional)", "Tüm öğeler için not (isteğe bağlı)")
          : L("What should the agent do?", "Ne yapılsın?");
      parts.elementFields = [];
      const rows = [];
      for (let number = 1; count > 1 && number <= count; number++) {
        const row = win.document.createElementNS(XHTML, "div");
        row.className = "element-note";
        const badge = win.document.createElementNS(XHTML, "span");
        badge.className = "number";
        badge.textContent = String(number);
        const field = win.document.createElementNS(XHTML, "textarea");
        field.placeholder = L(`Note for element ${number} (optional)`, `${number}. öğe için not (isteğe bağlı)`);
        field.addEventListener("keydown", parts.onNoteKey);
        row.append(badge, field);
        rows.push(row);
        parts.elementFields.push(field);
      }
      parts.elementNotes.replaceChildren(...rows);
    }
    this.#render();
    const owner = browser.ownerDocument?.defaultView;
    this.#windows.get(owner)?.note.focus();
  }

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

  #mainBrowser(state) {
    if (this.#pick) return this.#pick.browser.deref();
    if (state === "ask") return this.#card()?.browser?.deref() ?? null;
    return this.#browser?.deref() ?? null;
  }

  #previewBrowser() {
    return this.#stateNow() === "working" ? this.#worker()?.browser.deref() : this.#browser?.deref();
  }

  // why: Stop and tab-less questions need to remain actionable in every window.
  #render() {
    const pick = this.#pick;
    const state = pick ? pick.mode : this.#stateNow();
    const stopped = state === "stopped";
    const card = state === "ask" ? this.#card() : null;
    const worker = this.#worker();
    const browser = this.#mainBrowser(state);
    const shownBrowser = state === "working" ? worker?.browser.deref() : browser;
    const owner = shownBrowser?.ownerDocument?.defaultView;
    const theme = agentTheme(pick ? pick.agent : card ? card.agent : state === "working" ? worker.agent : this.#agent);
    const split = (text) => (text.includes(" — ") ? text.split(" — ") : ["", text]);
    let [siteName, action] = split(card ? card.text : this.#text);
    let hintText = "";
    if (pick) {
      siteName = "";
      if (pick.mode === "picking") {
        action = L("Select elements (up to 8)", "Öğeleri seç (en çok 8)");
        const mod = Services.appinfo?.OS === "Darwin" ? "Cmd" : "Ctrl";
        hintText = L(`${mod}-click: add/remove · Enter: done · Esc`, `${mod}+tık: ekle/çıkar · Enter: bitir · Esc`);
      } else if (pick.mode === "compose") {
        try {
          siteName = browser.currentURI.host;
        } catch {}
        action = pick.label;
      } else action = pick.text;
    }
    const iconOf = (b) => {
      try {
        const win = b?.ownerDocument?.defaultView;
        return win?.gBrowser.getIcon(win.gBrowser.getTabForBrowser(b)) ?? null;
      } catch {
        return null;
      }
    };
    const icon = iconOf(browser);
    const workerBrowser = worker?.browser.deref();
    const hold = worker && workerBrowser ? this.#actions.holdOf?.(workerBrowser) : null;
    const workerHolds = hold && hold.session === worker.session ? hold : null;
    // why: A hold can expire during a long-running call, so its countdown needs independent redraws.
    if (workerHolds) this.#later(HOLD_REFRESH);
    const cardIndex = card ? this.#cards.indexOf(card) : -1;
    const workers = [...this.#workers.values()];
    const now = Date.now();
    if (workers.some((w) => now - w.at < RECENT)) this.#later(RECENT);

    for (const [win, parts] of this.#windows) {
      const { el, spark, favicon, host, text, hint, stop, message, cancel, goto, ok, target } = parts;
      applyTheme(el, theme);
      spark.title = theme.name;
      spark.style.background = `url("${agentIcon(theme)}") center / contain no-repeat`;
      spark.style.animation = theme.id === "claude" && !stopped ? "" : "none";
      el.setAttribute("aria-label", theme.name);
      const anywhere = (state === "ask" && !card?.browser) || stopped;
      const visible = anywhere || (state !== "hidden" && win === owner);
      el.setAttribute("state", state);
      el.toggleAttribute("fresh", state === "recording" && this.#fresh);
      this.#renderReview(win, parts, visible);

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

      parts.cardPager.hidden = !card || this.#cards.length < 2;
      if (card) {
        parts.cardPrev.disabled = cardIndex === 0;
        parts.cardNext.disabled = cardIndex === this.#cards.length - 1;
        parts.cardNext.toggleAttribute("unseen", this.#unseen);
        parts.cardCount.toggleAttribute("unseen", this.#unseen);
        const others = this.#cards
          .filter((c) => c !== card)
          .slice(0, 3)
          .map((c) => {
            const mini = win.document.createElementNS(XHTML, "span");
            mini.className = "mini";
            mini.title = c.agent.name;
            mini.style.backgroundImage = `url("${agentIcon(c.agent)}")`;
            return mini;
          });
        parts.cardCount.replaceChildren(`${cardIndex + 1}/${this.#cards.length}`, ...others);
        if (parts.noteFor !== card.id) {
          parts.answerNote.value = "";
          parts.noteFor = card.id;
        }
      }
      this.#fillChoices(win, card);
      message.textContent = card ? card.message : this.#message;
      parts.answerNote.hidden = !card;
      parts.choices.hidden = !card?.options.length;
      goto.hidden = !browser || win.gBrowser.selectedBrowser === browser;
      ok.hidden = !(card && card.done && !card.options.length);
      ok.textContent = card?.labels.ok ?? L("OK", "Tamam");
      cancel.textContent = card?.labels.cancel ?? L("Cancel", "Vazgeç");
      goto.classList.toggle("primary", ok.hidden);

      this.#renderWorkers(win, parts, worker, workerHolds, workers, now);
      if (visible) this.#place(win);
      el.hidden = !visible;
    }
  }

  #renderWorkers(win, parts, worker, hold, workers, now) {
    const { workers: row, wIcon, wFavicon, wHost, wText, wStop, lock, pager, icons, mode, holdline, holdText } = parts;
    row.toggleAttribute("busy", !!worker);
    if (!worker) return;
    const [site, action] = worker.text.includes(" — ") ? worker.text.split(" — ") : ["", worker.text];
    wIcon.style.backgroundImage = `url("${agentIcon(worker.agent)}")`;
    wIcon.title = worker.agent.name;
    wHost.textContent = site;
    wText.textContent = `${worker.agent.name} · ${action}`;
    let favicon = null;
    try {
      const b = worker.browser.deref();
      const w = b?.ownerDocument?.defaultView;
      favicon = w?.gBrowser.getIcon(w.gBrowser.getTabForBrowser(b)) ?? null;
    } catch {}
    if (favicon) wFavicon.src = favicon;
    else wFavicon.removeAttribute("src");
    lock.hidden = !hold;
    if (hold) {
      lock.textContent = `🔒 ${hold.endsIn}`;
      lock.style.color = worker.agent.accent;
    }
    holdline.toggleAttribute("hold", !!hold);
    if (hold) {
      const origin = hold.noWorkaround?.replace(/^https?:\/\//, "");
      const site = origin ? L(` · also blocks ${origin} in other tabs`, ` · ${origin} başka sekmelerde de kapalı`) : "";
      holdText.textContent = `“${hold.reason}”${site}`;
    }
    pager.hidden = workers.length < 2;
    if (workers.length >= 2) {
      const shown = workers.slice(0, MAX_ICONS);
      if (!shown.includes(worker)) shown[MAX_ICONS - 1] = worker;
      const buttons = shown.map((w) => {
        const button = win.document.createElementNS(XHTML, "button");
        button.className = "av";
        button.title = w.agent.name;
        button.style.backgroundImage = `url("${agentIcon(w.agent)}")`;
        button.style.setProperty("--c", w.agent.accent);
        button.toggleAttribute("on", w === worker);
        button.toggleAttribute("recent", w !== worker && now - w.at < RECENT);
        const b = w.browser.deref();
        const theirs = b ? this.#actions.holdOf?.(b) : null;
        button.toggleAttribute("locked", theirs?.session === w.session);
        button.addEventListener("click", () => this.#selectWorker(w.session));
        return button;
      });
      const rest = workers.length - shown.length;
      if (rest > 0) {
        const more = win.document.createElementNS(XHTML, "span");
        more.className = "more";
        more.textContent = `+${rest}`;
        buttons.push(more);
      }
      icons.replaceChildren(...buttons);
    }
    mode.setAttribute("mode", this.#mode);
    mode.textContent = { ask: L("ask", "onaylı"), auto: L("auto", "otomatik"), custom: L("custom", "özel") }[
      this.#mode
    ];
    mode.title = {
      ask: L(
        "Agents ask before every action. Click to switch mode",
        "Ajanlar her işlemde izin istiyor. Mod değiştirmek için tıkla",
      ),
      auto: L(
        "Agents ask only before risky actions. Click to switch mode",
        "Ajanlar yalnızca riskli işlemlerde izin istiyor. Mod değiştirmek için tıkla",
      ),
      custom: L(
        "Agents follow your permissions.jsonc. Click to switch mode",
        "Ajanlar senin permissions.jsonc kurallarına uyuyor. Mod değiştirmek için tıkla",
      ),
    }[this.#mode];
    wStop.title = L("Stop all agents (Ctrl+Shift+Esc)", "Tüm ajanları durdur (Ctrl+Shift+Esc)");
  }

  #startPreview(win) {
    const parts = this.#windows.get(win);
    if (!parts || parts.previewing) return;
    parts.previewing = true;
    parts.el.setAttribute("previewing", "true");
    this.#render();
    this.#previewLoop(parts);
  }

  #stopPreview(win) {
    const parts = this.#windows.get(win);
    if (!parts) return;
    parts.previewing = false;
    parts.el.removeAttribute("previewing");
  }

  async #previewLoop(parts) {
    while (parts.previewing) {
      const browser = this.#previewBrowser();
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

  // why: Anchor to the page area so compact mode can hide the toolbar without moving the island.
  #place(win) {
    const parts = this.#windows.get(win);
    const panels = win.gBrowser?.tabpanels;
    if (!parts || !panels) return;
    const r = panels.getBoundingClientRect();
    parts.el.style.top = `${r.top + 8}px`;
    parts.el.style.left = `${r.left + r.width / 2}px`;
  }
}
