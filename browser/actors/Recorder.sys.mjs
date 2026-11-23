const MAX_VALUE = 2000;
const MAX_TEXT = 200;

// why: Type steps already capture text edits, so keep only keys that drive controls or submit.
const SPECIAL_KEYS = new Set(["Enter", "Escape", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
const EDIT_SHORTCUTS = new Set(["a", "c", "v", "x", "z", "y"]);
const NOT_TEXT_INPUTS = new Set(["button", "submit", "reset", "image", "checkbox", "radio", "file", "hidden"]);
const CLICKABLE = new Set(["a", "button", "summary", "label", "input", "select", "textarea"]);

export class Recorder {
  // why: Remember once-secret fields so a show-password toggle cannot disclose their values.
  #secret = new WeakSet();
  #typed = new WeakMap();
  #dirty = new Set();

  constructor(env) {
    this.env = env;
  }

  handle(event) {
    const target = this.#target(event);
    switch (event.type) {
      case "input":
        // why: Unfocused Gecko windows can omit change events (docs/gecko-pitfalls.md, Input and frames).
        if (target && this.#isTextField(target)) {
          this.#remember(target);
          this.#dirty.add(target);
        }
        return;
      case "change":
        if (!target) return;
        if (this.#isTextField(target)) this.#flush(target);
        else this.#change(target);
        return;
      case "click":
        // why: The key step already records activation when Gecko generates a click with detail zero.
        if (event.button !== 0 || event.detail === 0) return;
        this.#click(target);
        return;
      case "keydown":
        this.#key(event, target);
        return;
      case "pagehide":
        this.flush();
        return;
    }
  }

  flush() {
    for (const el of [...this.#dirty]) this.#flush(el);
  }

  #target(event) {
    let el = event.composedPath?.()[0] ?? event.target;
    if (el?.nodeType !== 1) el = el?.parentElement;
    return el ?? null;
  }

  #click(el) {
    if (!el) return;
    const control = this.#clickable(el);
    // why: Skip focus and toggle clicks already represented by the resulting field step.
    const field = control.localName === "label" ? control.control : control;
    if (field && this.#isFormField(field)) return;
    this.#post("click", control);
  }

  // why: Identify the activated control even when the click landed on its child.
  #clickable(el) {
    const { roleOf, INTERACTIVE_ROLES } = this.env.reader;
    for (let node = el; node?.nodeType === 1; node = node.parentElement ?? node.getRootNode?.().host) {
      if (CLICKABLE.has(node.localName) && (node.localName !== "a" || node.hasAttribute("href"))) return node;
      if (INTERACTIVE_ROLES.has(roleOf(node)) || node.hasAttribute("onclick")) return node;
    }
    return el;
  }

  #change(el) {
    if (el.localName === "select") {
      const options = [...el.selectedOptions].map((o) => this.env.reader.clean(o.label || o.text));
      this.#post("select", el, { value: el.multiple ? options : options[0] });
    } else if (el.localName === "input" && (el.type === "checkbox" || el.type === "radio")) {
      this.#post("check", el, { checked: el.checked });
    } else if (el.localName === "input" && el.type === "file") {
      this.#post("upload", el, { files: [...(el.files ?? [])].map((f) => f.name) });
    }
  }

  #key(event, el) {
    const modified = event.ctrlKey || event.metaKey || event.altKey;
    if (!modified && !SPECIAL_KEYS.has(event.key)) return;
    if (modified && ["Control", "Meta", "Alt", "Shift"].includes(event.key)) return;
    if (modified && !event.altKey && EDIT_SHORTCUTS.has(event.key.toLowerCase())) return;
    // why: In a text field these keys edit the value; outside it they can operate widgets.
    if (!modified && el && this.#isTextField(el) && event.key !== "Enter" && event.key !== "Escape") return;
    const key = [event.ctrlKey && "Control", event.altKey && "Alt", event.metaKey && "Meta", event.shiftKey && "Shift"]
      .filter(Boolean)
      .concat(event.key === " " ? "Space" : event.key)
      .join("+");
    this.#post("key", el && el !== this.env.document().body ? el : null, { key });
  }

  #flush(el) {
    this.#dirty.delete(el);
    this.#remember(el);
    const value = this.#value(el);
    if (this.#typed.has(el) && this.#typed.get(el) === value) return;
    this.#typed.set(el, value);
    if (this.#secret.has(el)) this.#post("type", el, { secret: true });
    else this.#post("type", el, { value: this.env.reader.truncate(value, MAX_VALUE) });
  }

  #remember(el) {
    if (this.#isSecret(el)) this.#secret.add(el);
  }

  #isSecret(el) {
    return this.env.reader.isSecretField(el);
  }

  #isFormField(el) {
    return ["input", "select", "textarea"].includes(el.localName) && !(el.localName === "input" && this.#isButton(el));
  }

  #isButton(el) {
    return ["button", "submit", "reset", "image"].includes(el.type);
  }

  #isTextField(el) {
    if (el.localName === "textarea") return true;
    if (el.localName === "input") return !NOT_TEXT_INPUTS.has(el.type);
    return !!el.isContentEditable;
  }

  #value(el) {
    return el.localName === "input" || el.localName === "textarea" ? el.value : (el.innerText ?? el.textContent ?? "");
  }

  #post(action, el, extra = {}) {
    // why: Flush pending values before an action such as Enter can submit them.
    if (action !== "type") this.flush();
    const doc = this.env.document();
    const r = el?.getBoundingClientRect?.();
    this.env.post(
      {
        action,
        ...(el ? { target: this.#describe(el) } : {}),
        ...(r ? { rect: { x: r.left, y: r.top, width: r.width, height: r.height } } : {}),
        ...extra,
        url: doc.URL,
        title: doc.title,
      },
      el,
    );
  }

  #describe(el) {
    const { roleOf, accessibleName, elementLabel, clean, truncate } = this.env.reader;
    const target = {
      role: roleOf(el),
      name: accessibleName(el),
      label: elementLabel(el),
      selector: this.env.info.cssPath(el, this.env.window()),
    };
    const text = truncate(clean(el.innerText ?? ""), MAX_TEXT);
    if (text && text !== target.name) target.text = text;
    if (el.localName === "a" && el.href) target.href = el.href;
    if (el.localName === "input" && el.type) target.type = el.type;
    return target;
  }
}
