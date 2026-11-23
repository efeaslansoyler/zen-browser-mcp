// why: Isolate overlay styles from the page and keep overlays from intercepting input.

const HOST_STYLE =
  "all: initial !important; position: fixed !important; z-index: 2147483647 !important; pointer-events: none !important;";

const arrowImage = (color) =>
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22"><path d="M3 2v16.5l4.6-4.3 3.1 6.8 2.7-1.2-3-6.7 6.3-.3z" fill="${color}" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
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

// why: The system event group still sees events the page stops propagating.
const SYSTEM_CAPTURE = { capture: true, mozSystemGroup: true };

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

// why: Avoid cursor animation delays when the user cannot see the tab.
export class VirtualCursor {
  constructor(env) {
    this.env = env;
    this.el = null;
  }

  #element() {
    if (this.el?.host.isConnected) return this.el;
    const doc = this.env.document();
    const win = this.env.window();
    const { host, root } = overlayHost(
      this.env,
      "zen-mcp-cursor",
      CURSOR_CSS,
      "left: 0 !important; top: 0 !important;",
    );
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
    const x = this.el?.x ?? win.innerWidth / 2;
    const y = this.el?.y ?? win.innerHeight / 2;
    pointer.style.setProperty("--move", "0ms");
    pointer.style.translate = `${x}px ${y}px`;
    this.el = { host, pointer, label, x, y, hideTimer: null };
    return this.el;
  }

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

  hide() {
    if (!this.el) return;
    this.env.clearTimeout(this.el.hideTimer);
    this.el.pointer.classList.remove("press");
    this.el.pointer.classList.add("gone");
  }

  // why: Keep the visual cursor out of screenshots sent to the agent.
  setHidden(hidden) {
    if (this.el?.host.isConnected) this.el.pointer.style.visibility = hidden ? "hidden" : "";
  }

  destroy() {
    if (this.el) this.env.clearTimeout(this.el.hideTimer);
  }

  #idle() {
    const cursor = this.el;
    this.env.clearTimeout(cursor.hideTimer);
    cursor.hideTimer = this.env.setTimeout(() => {
      cursor.label.textContent = this.env.agent().name;
      cursor.pointer.classList.add("gone");
    }, 4000);
  }
}

export function ripple(env, x, y) {
  const { host, root } = overlayHost(
    env,
    "zen-mcp-ripple",
    RIPPLE_CSS,
    `left: ${x}px !important; top: ${y}px !important;`,
  );
  root.append(env.document().createElement("div"));
  env.document().documentElement.append(host);
  env.setTimeout(() => host.remove(), 700);
}

// why: A contrasting double ring and dark labels stay visible on varied pages.
const HIGHLIGHT_CSS = `
  .ring {
    position: fixed; box-sizing: border-box; pointer-events: none;
    border: 3px solid var(--zen-agent-accent, #d97757);
    box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.95), 0 0 0 1px rgba(0, 0, 0, 0.35);
    animation: appear 0.16s ease-out;
  }
  .tag {
    position: fixed; pointer-events: none; display: flex; align-items: center; gap: 6px;
    padding: 3px 9px 3px 3px; border-radius: 999px;
    background: #1c1c1f; color: #fff;
    font: 600 12px/18px system-ui, sans-serif; white-space: nowrap;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(255, 255, 255, 0.08);
    animation: appear 0.16s ease-out;
  }
  .num {
    min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: 999px;
    background: var(--zen-agent-accent, #d97757); color: var(--zen-agent-foreground, #fff);
    font: 700 11px/18px system-ui, sans-serif; text-align: center;
  }
  @keyframes appear {
    from { opacity: 0; scale: 0.96; }
  }
`;

const GAP = 3;
const SIDE = 8;

export function highlight(env, items) {
  const doc = env.document();
  const win = env.window();
  const { host, root } = overlayHost(env, "zen-mcp-highlight", HIGHLIGHT_CSS);
  const parts = items.map(({ element, label, number }) => {
    const ring = doc.createElement("div");
    ring.className = "ring";
    const tag = doc.createElement("div");
    tag.className = "tag";
    const num = doc.createElement("span");
    num.className = "num";
    num.textContent = number;
    tag.append(num);
    if (label) tag.append(label);
    else tag.style.padding = "3px";
    root.append(ring, tag);
    // why: Match the target's corner radius so the outline follows its shape.
    const radius = parseFloat(win.getComputedStyle(element).borderTopLeftRadius) || 0;
    ring.style.borderRadius = `${radius + GAP}px`;
    return { element, ring, tag };
  });
  let frame = 0;
  const place = () => {
    for (const { element, ring, tag } of parts) {
      ring.hidden = tag.hidden = !element.isConnected;
      if (!element.isConnected) continue;
      const r = env.reader.rectOf(element);
      Object.assign(ring.style, {
        left: `${r.left - GAP}px`,
        top: `${r.top - GAP}px`,
        width: `${r.width + GAP * 2}px`,
        height: `${r.height + GAP * 2}px`,
      });
      const width = tag.offsetWidth;
      const right = r.right + GAP + SIDE;
      const left = r.left - GAP - SIDE - width;
      const x = right + width <= win.innerWidth - 4 ? right : left >= 4 ? left : Math.max(4, r.right - width - 4);
      const inside = x !== right && x !== left;
      tag.style.left = `${x}px`;
      tag.style.top = `${inside ? r.top + 4 : r.top + r.height / 2 - tag.offsetHeight / 2}px`;
    }
    frame = win.requestAnimationFrame(place);
  };
  doc.documentElement.append(host);
  place();
  return {
    remove() {
      try {
        win.cancelAnimationFrame(frame);
      } catch {}
      host.remove();
    },
  };
}

export function outlineAndWait(env, { target, wait, timeout }) {
  const doc = env.document();
  const win = env.window();
  for (const old of doc.querySelectorAll("zen-mcp-ask")) old.remove();
  const { host, root } = overlayHost(env, "zen-mcp-ask", ASK_CSS);
  let box = null;
  if (target) {
    box = doc.createElement("div");
    box.className = "box";
    root.append(box);
    doc.documentElement.append(host);
  }

  let frame = 0;
  const place = () => {
    const r = env.reader.rectOf(target);
    const pad = 6;
    Object.assign(box.style, {
      left: `${r.left - pad}px`,
      top: `${r.top - pad}px`,
      width: `${r.width + pad * 2}px`,
      height: `${r.height + pad * 2}px`,
    });
    frame = win.requestAnimationFrame(place);
  };
  if (target) place();

  let finish;
  const answer = new Promise((resolve) => {
    const onClick = (event) => {
      if (!event.isTrusted || wait !== "click" || !target) return;
      // why: composedPath() leaves out what is inside closed shadow roots.
      for (let el = event.composedTarget; el; el = env.reader.composedParent(el)) if (el === target) finish("clicked");
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
    finish = (result) => {
      if (done) return;
      done = true;
      env.clearTimeout(timer);
      try {
        win.removeEventListener("click", onClick, SYSTEM_CAPTURE);
      } catch {}
      try {
        win.cancelAnimationFrame(frame);
      } catch {}
      host.remove();
      resolve(result);
    };
  });
  return { answer, finish };
}
