// What agents draw on the page: the virtual cursor, the click ripple and the ask_user outline.
// Everything lives in a closed shadow root (page CSS can't break it, page scripts can't look
// inside) and ignores pointer events. Colors follow the agent theme.
//
// env: { document(), window(), agent(), applyTheme, setTimeout, clearTimeout }

const HOST_STYLE = "all: initial !important; position: fixed !important; z-index: 2147483647 !important; pointer-events: none !important;";

// The arrow in the agent's accent color.
const arrowImage = color => "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22"><path d="M3 2v16.5l4.6-4.3 3.1 6.8 2.7-1.2-3-6.7 6.3-.3z" fill="${color}" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`
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
    background: var(--zen-agent-arrow, url("${arrowImage("#d97757")}")) no-repeat;
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
    background: var(--zen-agent-accent, #d97757);
    color: var(--zen-agent-foreground, #fff);
    font: 600 11px/1.4 system-ui, sans-serif;
    white-space: nowrap;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }
`;

const RIPPLE_CSS = `
  div {
    position: absolute;
    left: -14px;
    top: -14px;
    width: 28px;
    height: 28px;
    box-sizing: border-box;
    border-radius: 50%;
    border: 2px solid var(--zen-agent-accent, #d97757);
    background: rgba(var(--zen-agent-rgb, 217, 119, 87), 0.18);
    animation: ripple 0.65s ease-out forwards;
  }
  @keyframes ripple {
    from { scale: 0.4; opacity: 1; }
    to { scale: 1.6; opacity: 0; }
  }
`;

const ASK_CSS = `
  .box {
    position: fixed; box-sizing: border-box; pointer-events: none;
    border: 3px solid var(--zen-agent-accent, #d97757); border-radius: 8px;
    box-shadow: 0 0 0 4px rgba(var(--zen-agent-rgb, 217, 119, 87), 0.25), 0 0 24px rgba(var(--zen-agent-rgb, 217, 119, 87), 0.55);
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse {
    50% { box-shadow: 0 0 0 8px rgba(var(--zen-agent-rgb, 217, 119, 87), 0.12), 0 0 32px rgba(var(--zen-agent-rgb, 217, 119, 87), 0.8); }
  }
`;

// The system event group: a page's stopPropagation doesn't affect it (privileged code only).
const SYSTEM_CAPTURE = { capture: true, mozSystemGroup: true };

// A themed host element with a closed shadow root holding the style sheet.
function overlayHost(env, tag, css, style = "inset: 0 !important; display: block !important;") {
  const doc = env.document();
  const host = doc.createElement(tag);
  host.setAttribute("style", HOST_STYLE + style);
  env.applyTheme(host, env.agent());
  const root = host.attachShadow({ mode: "closed" });
  const sheet = doc.createElement("style");
  sheet.textContent = css;
  root.append(sheet);
  return { host, root };
}

// The virtual cursor: an arrow with a small label ("Claude", "typing…") so a user watching the
// tab sees where the agent acts. Before an action it glides from its last position to the
// target, but only while the tab is visible (no delay when nobody watches). It fades out when idle.
export class VirtualCursor {
  constructor(env) {
    this.env = env;
    this.el = null;
  }

  #element() {
    if (this.el?.host.isConnected) return this.el;
    const doc = this.env.document();
    const win = this.env.window();
    const { host, root } = overlayHost(this.env, "zen-mcp-cursor", CURSOR_CSS, "left: 0 !important; top: 0 !important;");
    const pointer = doc.createElement("div");
    pointer.className = "pointer";
    const arrow = doc.createElement("div");
    arrow.className = "arrow";
    const label = doc.createElement("div");
    label.className = "label";
    label.textContent = this.env.agent().name;
    pointer.append(arrow, label);
    root.append(pointer);
    doc.documentElement.append(host);
    // The first appearance comes from the middle of the page.
    const x = this.el?.x ?? win.innerWidth / 2;
    const y = this.el?.y ?? win.innerHeight / 2;
    pointer.style.setProperty("--move", "0ms");
    pointer.style.translate = `${x}px ${y}px`;
    this.el = { host, pointer, label, x, y, hideTimer: null };
    return this.el;
  }

  // Follows the agent theme (the active agent can change between requests).
  paint() {
    if (!this.el) return;
    const agent = this.env.agent();
    this.env.applyTheme(this.el.host, agent);
    this.el.host.style.setProperty("--zen-agent-arrow", `url("${arrowImage(agent.accent)}")`);
  }

  async move(x, y, scope, instant = false) {
    const cursor = this.#element();
    this.paint();
    const visible = !this.env.document().hidden;
    const distance = Math.hypot(x - cursor.x, y - cursor.y);
    const ms = !instant && visible && distance > 2 ? Math.round(Math.min(450, 160 + distance * 0.35)) : 0;
    cursor.label.textContent = this.env.agent().name;
    cursor.pointer.classList.remove("gone");
    cursor.pointer.style.setProperty("--move", `${ms}ms`);
    cursor.pointer.style.translate = `${x}px ${y}px`;
    cursor.x = x;
    cursor.y = y;
    this.#idle();
    if (ms) await scope.wait(ms + 30, this.env);
    scope.check();
  }

  press() {
    const pointer = this.el?.pointer;
    if (!pointer) return;
    pointer.classList.add("press");
    this.env.setTimeout(() => pointer.classList.remove("press"), 160);
  }

  unpress() {
    this.el?.pointer.classList.remove("press");
  }

  label(text) {
    const cursor = this.el;
    if (!cursor?.host.isConnected) return;
    cursor.label.textContent = text;
    cursor.pointer.classList.remove("gone");
    this.#idle();
  }

  // An operation was cancelled: hide at once.
  hide() {
    if (!this.el) return;
    this.env.clearTimeout(this.el.hideTimer);
    this.el.pointer.classList.remove("press");
    this.el.pointer.classList.add("gone");
  }

  // Kept out of the agent's own screenshots.
  setHidden(hidden) {
    if (this.el?.host.isConnected) this.el.pointer.style.visibility = hidden ? "hidden" : "";
  }

  destroy() {
    if (this.el) this.env.clearTimeout(this.el.hideTimer);
  }

  // Fades out after 4 s idle (like the island).
  #idle() {
    const cursor = this.el;
    this.env.clearTimeout(cursor.hideTimer);
    cursor.hideTimer = this.env.setTimeout(() => {
      cursor.label.textContent = this.env.agent().name;
      cursor.pointer.classList.add("gone");
    }, 4000);
  }
}

// A short ring at the clicked point, so a user looking at the tab sees what the agent last did.
// It doesn't block clicks and removes itself.
export function ripple(env, x, y) {
  const { host, root } = overlayHost(env, "zen-mcp-ripple", RIPPLE_CSS, `left: ${x}px !important; top: ${y}px !important;`);
  root.append(env.document().createElement("div"));
  env.document().documentElement.append(host);
  env.setTimeout(() => host.remove(), 700);
}

// ask_user: outline the element and wait. The message and buttons are on the island; the page
// only gets the outline (nothing at all without a target, then the answer comes from the
// island through cancel_ask). Only trusted clicks count; they are watched in the system group,
// so a page that stops the event can't hide them.
// Returns { answer: Promise<"clicked" | "timeout" | result>, finish(result) }.
export function outlineAndWait(env, { target, wait, timeout }) {
  const doc = env.document();
  const win = env.window();
  // an outline left behind by an earlier failure
  for (const old of doc.querySelectorAll("zen-mcp-ask")) old.remove();
  const { host, root } = overlayHost(env, "zen-mcp-ask", ASK_CSS);
  let box = null;
  if (target) {
    box = doc.createElement("div");
    box.className = "box";
    root.append(box);
    doc.documentElement.append(host);
  }

  // follow the element when it scrolls or resizes
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

  let finish;
  const answer = new Promise(resolve => {
    const onClick = event => {
      if (event.isTrusted && wait === "click" && target && event.composedPath().includes(target)) finish("clicked");
    };
    const timer = env.setTimeout(() => finish("timeout"), timeout * 1000);
    try {
      win.addEventListener("click", onClick, SYSTEM_CAPTURE);
    } catch (e) {
      env.clearTimeout(timer);
      host.remove();
      throw e;
    }
    let done = false;
    finish = result => {
      if (done) return;
      done = true;
      env.clearTimeout(timer);
      try { win.removeEventListener("click", onClick, SYSTEM_CAPTURE); } catch {}
      try { win.cancelAnimationFrame(frame); } catch {}
      host.remove();
      resolve(result);
    };
  });
  return { answer, finish };
}
