// The element picker: the user picks elements on the page, writes a note on the island and
// sends them to an agent.
//
// While picking, the page's click and key events are blocked (links don't open, shortcuts
// don't fire); mouse movement isn't, so hover menus stay open. Picked elements stay outlined
// while the note is written; pick_end removes the outline.
//
// env: { document(), window(), agent(), applyTheme, contextTarget(), unwrap, inspector(), L, mac(),
//        reader: the PageReader module, info: the ElementInfo module }

// limits for the outerHTML and text sent for a picked element
const MAX_PICK_HTML = 1500;
const MAX_PICK_TEXT = 300;
const MAX_PICKS = 8;

const PICK_CSS = `
  .box {
    position: fixed; box-sizing: border-box; pointer-events: none;
    border: 2px solid var(--zen-agent-accent, #d97757); border-radius: 4px;
    background: rgba(var(--zen-agent-rgb, 217, 119, 87), 0.12);
    transition: left 0.06s, top 0.06s, width 0.06s, height 0.06s;
  }
  .box.picked {
    border-width: 3px;
    box-shadow: 0 0 0 4px rgba(var(--zen-agent-rgb, 217, 119, 87), 0.25), 0 0 24px rgba(var(--zen-agent-rgb, 217, 119, 87), 0.55);
    background: none;
  }
  .label {
    position: fixed; pointer-events: none;
    padding: 2px 7px; border-radius: 999px;
    background: var(--zen-agent-accent, #d97757); color: var(--zen-agent-foreground, #fff);
    font: 600 11px/1.4 system-ui, sans-serif; white-space: nowrap;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }
  .label span { font-weight: 400; opacity: 0.8; }
  .hint {
    position: fixed; left: 50%; bottom: 12px; transform: translateX(-50%);
    display: flex; gap: 10px; max-width: calc(100vw - 24px); box-sizing: border-box;
    padding: 5px 12px; border-radius: 8px; pointer-events: none;
    background: rgba(20, 20, 20, 0.88); color: #fff;
    font: 12px/1.4 system-ui, sans-serif; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  }
  .hint .count { font-weight: 600; white-space: nowrap; color: var(--zen-agent-accent, #d97757); }
`;

const MOUSE = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "auxclick", "dblclick", "contextmenu"];
const KEYS = ["keydown", "keypress", "keyup"];
const CAPTURE = { capture: true };

export class Picker {
  #pending = null;
  #overlay = null;

  constructor(env) {
    this.env = env;
  }

  // fromContext: started from the context menu; the pick starts at the right-clicked element
  // and follows the mouse from there.
  start({ fromContext = false } = {}) {
    this.cancel();
    this.end();
    const { L } = this.env;
    const doc = this.env.document();
    const win = this.env.window();
    const mac = this.env.mac();
    const mod = mac ? "Cmd" : "Ctrl";
    const overlay = this.#overlayElement({
      keys: L(
        `Click: pick · ${mod}-click: add/remove · ↑/↓: parent/child · Backspace: undo · Enter: done · Esc: cancel`,
        `Tık: seç · ${mod}+tık: ekle/çıkar · ↑/↓: üst/alt öğe · Backspace: geri al · Enter: bitir · Esc: iptal`,
      ),
      count: (n) => L(`${n}/${MAX_PICKS} selected`, `${n}/${MAX_PICKS} seçili`),
    });
    let current = null;
    let hovered = null;
    let trail = []; // elements left with ↑; ↓ goes back down
    const selected = [];
    const add = (el) => {
      if (!el?.isConnected) return false;
      if (selected.includes(el)) return true;
      if (selected.length === MAX_PICKS) {
        overlay.notice(
          L(`Up to 8 elements; ${mod}-click one to remove it`, `En fazla 8 öğe; çıkarmak için ${mod}+tıkla`),
        );
        return false;
      }
      selected.push(el);
      overlay.select(selected);
      return true;
    };
    const toggle = (el) => {
      const index = selected.indexOf(el);
      if (index < 0) add(el);
      else {
        selected.splice(index, 1);
        overlay.select(selected);
      }
    };
    const show = (el) => {
      current = el;
      overlay.track(el);
    };
    if (fromContext) {
      const el = this.env.contextTarget();
      if (el?.isConnected) show((hovered = el));
    }

    return new Promise((resolve) => {
      const onMove = (event) => {
        if (!event.isTrusted) return;
        const el = doc.elementFromPoint(event.clientX, event.clientY);
        if (!el || el === hovered) return;
        hovered = el;
        trail = [];
        show(el);
      };
      const onMouse = (event) => {
        if (!event.isTrusted) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.type === "click" && event.button === 0 && current) {
          if (event.shiftKey || (mac ? event.metaKey : event.ctrlKey)) toggle(current);
          else if (add(current)) finish(selected);
        } else if (event.type === "contextmenu") finish(null);
      };
      const onKey = (event) => {
        if (!event.isTrusted) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.type !== "keydown") return;
        if (event.key === "Escape") finish(null);
        else if (event.key === "Enter" && (selected.length || current)) {
          if (!selected.length) add(current);
          finish(selected);
        } else if (event.key === "Backspace" && selected.length) {
          selected.pop();
          overlay.select(selected);
        } else if (event.key === "ArrowUp" && current?.parentElement && current.parentElement !== doc.documentElement) {
          trail.push(current);
          show(current.parentElement);
        } else if (event.key === "ArrowDown" && trail.length) show(trail.pop());
      };
      win.addEventListener("mousemove", onMove, CAPTURE);
      for (const type of MOUSE) win.addEventListener(type, onMouse, CAPTURE);
      for (const type of KEYS) win.addEventListener(type, onKey, CAPTURE);

      const finish = (elements) => {
        if (this.#pending?.finish !== finish) return;
        this.#pending = null;
        try {
          win.removeEventListener("mousemove", onMove, CAPTURE);
          for (const type of MOUSE) win.removeEventListener(type, onMouse, CAPTURE);
          for (const type of KEYS) win.removeEventListener(type, onKey, CAPTURE);
        } catch {}
        if (!elements?.length) {
          this.end();
          resolve({ cancelled: true });
          return;
        }
        overlay.freeze();
        try {
          if (elements.some((el) => !el.isConnected))
            throw new Error("A selected element disappeared. Select the elements again.");
          const items = elements.map((el) => this.#info(el));
          resolve(items.length === 1 ? items[0] : { items });
        } catch (e) {
          this.end();
          resolve({ error: String(e?.message ?? e) });
        }
      };
      this.#pending = { finish };
    });
  }

  // Ends a running pick without a result.
  cancel() {
    this.#pending?.finish(null);
  }

  // Removes the outline.
  end() {
    this.#overlay?.remove();
    this.#overlay = null;
  }

  retheme() {
    if (this.#overlay?.host) this.env.applyTheme(this.#overlay.host, this.env.agent());
  }

  // An outline and label ("button.cta 320×48") in a closed shadow root; follows the element.
  #overlayElement(hintText) {
    const { elementLabel } = this.env.reader;
    const doc = this.env.document();
    const win = this.env.window();
    const host = doc.createElement("zen-mcp-pick");
    host.setAttribute(
      "style",
      "all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; pointer-events: none !important; display: block !important;",
    );
    this.env.applyTheme(host, this.env.agent());
    const root = host.attachShadow({ mode: "closed" });
    const style = doc.createElement("style");
    style.textContent = PICK_CSS;
    const box = doc.createElement("div");
    box.className = "box";
    const label = doc.createElement("div");
    label.className = "label";
    const hint = doc.createElement("div");
    hint.className = "hint";
    const keys = doc.createElement("span");
    keys.textContent = hintText.keys;
    const count = doc.createElement("span");
    count.className = "count";
    count.textContent = hintText.count(0);
    hint.append(keys, count);
    root.append(style, box, label, hint);
    doc.documentElement.append(host);

    let target = null;
    let selections = [];
    let frame = 0;
    const place = () => {
      if (target?.isConnected) {
        const r = target.getBoundingClientRect();
        Object.assign(box.style, {
          left: `${r.left}px`,
          top: `${r.top}px`,
          width: `${r.width}px`,
          height: `${r.height}px`,
        });
        // The label sits above the element, or inside its top edge when there's no room.
        const top = r.top >= 24 ? r.top - 22 : Math.max(r.top, 0) + 4;
        label.style.left = `${Math.max(4, Math.min(r.left, win.innerWidth - label.offsetWidth - 4))}px`;
        label.style.top = `${Math.min(top, win.innerHeight - 22)}px`;
        label.hidden = false;
      }
      for (const { el, box: selectedBox, label: selectedLabel } of selections) {
        selectedBox.hidden = selectedLabel.hidden = !el.isConnected;
        if (!el.isConnected) continue;
        const r = el.getBoundingClientRect();
        Object.assign(selectedBox.style, {
          left: `${r.left}px`,
          top: `${r.top}px`,
          width: `${r.width}px`,
          height: `${r.height}px`,
        });
        selectedLabel.style.left = `${Math.max(4, Math.min(r.left, win.innerWidth - selectedLabel.offsetWidth - 4))}px`;
        selectedLabel.style.top = `${Math.max(0, Math.min(r.top - 22, win.innerHeight - 22))}px`;
      }
      frame = win.requestAnimationFrame(place);
    };
    label.hidden = true;
    place();

    const overlay = {
      host,
      track: (el) => {
        target = el;
        const r = el.getBoundingClientRect();
        const size = doc.createElement("span");
        size.textContent = ` ${Math.round(r.width)}×${Math.round(r.height)}`;
        label.textContent = elementLabel(el);
        label.append(size);
      },
      notice: (message) => {
        label.textContent = message;
      },
      select: (elements) => {
        for (const item of selections) {
          item.box.remove();
          item.label.remove();
        }
        selections = elements.map((el, index) => {
          const selectedBox = doc.createElement("div"),
            selectedLabel = doc.createElement("div");
          selectedBox.className = "box picked";
          selectedLabel.className = "label";
          selectedLabel.textContent = `${index + 1}. ${elementLabel(el)}`;
          root.append(selectedBox, selectedLabel);
          return { el, box: selectedBox, label: selectedLabel };
        });
        count.textContent = hintText.count(elements.length);
      },
      freeze: () => {
        target = null;
        box.hidden = label.hidden = hint.hidden = true;
      },
      remove: () => {
        try {
          win.cancelAnimationFrame(frame);
        } catch {}
        host.remove();
      },
    };
    this.#overlay = overlay;
    return overlay;
  }

  // Context for the agent: enough to find the right place in the code, whatever the page size.
  #info(el) {
    const { elementLabel, roleOf, accessibleName, clean, truncate } = this.env.reader;
    const { cssPath, pickStyles, componentChain, sourceHints, cssHints } = this.env.info;
    const doc = this.env.document();
    const win = this.env.window();
    const r = el.getBoundingClientRect();
    const hints = sourceHints(el, this.env.unwrap);
    const css = cssHints(el, this.env.inspector());
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
      viewport: {
        width: win.innerWidth,
        height: win.innerHeight,
        scrollX: win.scrollX,
        scrollY: win.scrollY,
        dpr: win.devicePixelRatio,
      },
      styles: pickStyles(el, win),
      components: componentChain(el, this.env.unwrap),
      sourceHints: css ? { ...hints, css } : hints,
    };
  }
}
