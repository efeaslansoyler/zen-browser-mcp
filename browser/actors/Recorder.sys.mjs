// "Show me once": turns the user's own input in a recorded tab into semantic steps (click,
// type, select, check, upload, key) that an agent can repeat with its own tools. Runs in every
// frame; the parent collects the steps of a tab (Recordings.sys.mjs).
//
// Text typed into a field becomes one "type" step with the final value, taken on change or
// before the next step. Fields are tracked by input events, not focus: a window without focus
// gets no focus or blur events. Clicks that only focus or toggle a form field are left out:
// the field's change event records what happened. Clicks made by the keyboard (Enter in a form,
// Space on a button) are left out too; the key step records them. Scrolling and mouse movement
// are not recorded.
//
// Values of secret fields (passwords, card data, one-time codes) are never read: such steps
// carry secret: true instead of a value. A field that was a password once stays secret, so a
// "show password" toggle doesn't reveal it.
//
// env: { document(), window(), post(step, element), reader: the PageReader module,
//        info: the ElementInfo module }

const MAX_VALUE = 2000;
const MAX_TEXT = 200;

// Keys worth repeating: they submit, close or move between widgets. Plain typing and Tab
// (moving between fields) are covered by the type steps.
const SPECIAL_KEYS = new Set(["Enter", "Escape", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
// Editing shortcuts change a field; the field's type step already records the result.
const EDIT_SHORTCUTS = new Set(["a", "c", "v", "x", "z", "y"]);
const SECRET_AUTOCOMPLETE = /\b(cc-[a-z-]+|one-time-code|current-password|new-password)\b/;
const NOT_TEXT_INPUTS = new Set(["button", "submit", "reset", "image", "checkbox", "radio", "file", "hidden"]);
const CLICKABLE = new Set(["a", "button", "summary", "label", "input", "select", "textarea"]);

export class Recorder {
  #secret = new WeakSet(); // fields that were secret at some point
  #typed = new WeakMap(); // field → last recorded value
  #dirty = new Set(); // text fields typed into since their last step

  constructor(env) {
    this.env = env;
  }

  // Called by the actor for each trusted event while the tab is recorded.
  handle(event) {
    const target = this.#target(event);
    switch (event.type) {
      case "input":
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

  // Records the fields typed into that have no step yet.
  flush() {
    for (const el of [...this.#dirty]) this.#flush(el);
  }

  // The element the user acted on: inside shadow DOM too, and text nodes go to their parent.
  #target(event) {
    let el = event.composedPath?.()[0] ?? event.target;
    if (el?.nodeType !== 1) el = el?.parentElement;
    return el ?? null;
  }

  #click(el) {
    if (!el) return;
    const control = this.#clickable(el);
    // Focusing a field or toggling a checkbox: the change/type step says it better.
    const field = control.localName === "label" ? control.control : control;
    if (field && this.#isFormField(field)) return;
    this.#post("click", control);
  }

  // The control around the clicked spot (a span inside a button is the button); a click on
  // something that isn't a control stays on that element.
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
    // Arrow keys and Space inside a text field edit it; outside they drive menus, lists and buttons.
    if (!modified && el && this.#isTextField(el) && event.key !== "Enter" && event.key !== "Escape") return;
    const key = [event.ctrlKey && "Control", event.altKey && "Alt", event.metaKey && "Meta", event.shiftKey && "Shift"]
      .filter(Boolean)
      .concat(event.key === " " ? "Space" : event.key)
      .join("+");
    this.#post("key", el && el !== this.env.document().body ? el : null, { key });
  }

  // Records the field's value if it changed since it was last recorded.
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
    if (el.localName !== "input") return false;
    if (el.type === "password" || el.type === "hidden") return true;
    return SECRET_AUTOCOMPLETE.test(el.getAttribute("autocomplete") ?? "");
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
    // A typed value comes before the step that follows it (Enter submits it).
    if (action !== "type") this.flush();
    const doc = this.env.document();
    const r = el?.getBoundingClientRect?.();
    this.env.post(
      {
        action,
        ...(el ? { target: this.#describe(el) } : {}),
        // where the element is in this frame's viewport, for the step's screenshot
        ...(r ? { rect: { x: r.left, y: r.top, width: r.width, height: r.height } } : {}),
        ...extra,
        url: doc.URL,
        title: doc.title,
      },
      el,
    );
  }

  // Enough for an agent to find the element again with find or read_page.
  #describe(el) {
    const { roleOf, accessibleName, elementLabel, clean, truncate } = this.env.reader;
    const doc = this.env.document();
    const target = {
      role: roleOf(el),
      name: accessibleName(el, doc),
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
