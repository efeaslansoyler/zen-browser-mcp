// why: Xrays hide page property overrides, so reads follow the native DOM.

export const MAX_NAME = 100;

const LANDMARKS = {
  NAV: "navigation",
  MAIN: "main",
  HEADER: "banner",
  FOOTER: "contentinfo",
  ASIDE: "complementary",
  FORM: "form",
  DIALOG: "dialog",
  SECTION: "region",
};
const STRUCTURE = {
  H1: "heading",
  H2: "heading",
  H3: "heading",
  H4: "heading",
  H5: "heading",
  H6: "heading",
  UL: "list",
  OL: "list",
  LI: "listitem",
  TABLE: "table",
  TR: "row",
  TD: "cell",
  TH: "columnheader",
  P: "paragraph",
  IMG: "img",
  LABEL: "label",
  IFRAME: "iframe",
};
export const INPUT_ROLES = {
  button: "button",
  submit: "button",
  reset: "button",
  image: "button",
  checkbox: "checkbox",
  radio: "radio",
  range: "slider",
  search: "searchbox",
  file: "button",
  color: "button",
};
export const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "option",
  "slider",
  "switch",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "spinbutton",
  "treeitem",
]);
export const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "HEAD", "META", "LINK"]);
export const TEXT_CONTAINERS = new Set(["paragraph", "listitem", "cell", "label"]);
export const CONTROL_SELECTOR =
  "a[href], button, input, select, textarea, summary, [role], [contenteditable], [tabindex]";

// why: Avoid repeating the accessible name of a link or control inside a structural element.
export const NAME_FROM_CONTENT = new Set([
  "button",
  "link",
  "heading",
  "tab",
  "menuitem",
  "option",
  "columnheader",
  "treeitem",
  "switch",
  "checkbox",
  "radio",
]);

// why: The same secret-field detection protects recordings and permission checks.
const SECRET_AUTOCOMPLETE = /\b(cc-[a-z-]+|one-time-code|current-password|new-password)\b/;
export function isSecretField(el) {
  if (el?.localName !== "input") return false;
  if (el.type === "password" || el.type === "hidden") return true;
  return SECRET_AUTOCOMPLETE.test(el.getAttribute("autocomplete") ?? "");
}

export function submitsForm(el) {
  const control = el?.closest?.("button, input");
  if (!control?.form) return false;
  return control.localName === "button" ? control.type === "submit" : ["submit", "image"].includes(control.type);
}

function deepActiveElement(doc) {
  let el = doc.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

export const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();
export const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
// why: No locale's lowercasing fits every page: Turkish turns "WIFI" into "wıfı", English splits "İ" in two.
export const normalize = (s) => clean(s).replace(/[Iİı]/g, "i").toLowerCase();
export const tokens = (s) =>
  normalize(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

export function roleOf(el) {
  const explicit = el.getAttribute("role")?.split(/\s+/)[0];
  if (explicit && explicit !== "presentation" && explicit !== "none" && explicit !== "generic") return explicit;
  const tag = el.tagName.toUpperCase();
  switch (tag) {
    case "A":
    case "AREA":
      return el.hasAttribute("href") ? "link" : "";
    case "BUTTON":
    case "SUMMARY":
      return "button";
    case "SELECT":
      return el.multiple || el.size > 1 ? "listbox" : "combobox";
    case "TEXTAREA":
      return "textbox";
    case "INPUT":
      return INPUT_ROLES[el.type] || "textbox";
    case "IMG":
      return el.getAttribute("alt") === "" ? "" : "img";
  }
  if (el.isContentEditable && !el.parentElement?.isContentEditable) return "textbox";
  if (LANDMARKS[tag]) {
    if ((tag === "SECTION" || tag === "FORM") && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby"))
      return "";
    return LANDMARKS[tag];
  }
  if (STRUCTURE[tag]) return STRUCTURE[tag];
  if (el.hasAttribute("tabindex") && el.tabIndex >= 0) return "focusable";
  return "";
}

export function accessibleName(el, doc, fromContent = NAME_FROM_CONTENT.has(roleOf(el))) {
  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    const text = labelledby
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.innerText ?? "")
      .join(" ");
    if (clean(text)) return truncate(clean(text), MAX_NAME);
  }
  const aria = el.getAttribute("aria-label");
  if (aria && clean(aria)) return truncate(clean(aria), MAX_NAME);
  const tag = el.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    const label = el.labels?.[0];
    if (label && clean(label.innerText)) return truncate(clean(label.innerText), MAX_NAME);
    if (tag === "INPUT" && ["button", "submit", "reset"].includes(el.type) && el.value)
      return truncate(el.value, MAX_NAME);
    if (el.getAttribute("placeholder")) return truncate(clean(el.getAttribute("placeholder")), MAX_NAME);
  }
  if (tag === "IMG" || (tag === "INPUT" && el.type === "image")) {
    const alt = el.getAttribute("alt");
    if (alt) return truncate(clean(alt), MAX_NAME);
  }
  if (fromContent) {
    const text = clean(el.innerText ?? el.textContent);
    if (text) return truncate(text, MAX_NAME);
    const inner = el.querySelector("img[alt], svg title, [aria-label]");
    const innerName = inner?.getAttribute("alt") || inner?.getAttribute("aria-label") || inner?.textContent;
    if (innerName && clean(innerName)) return truncate(clean(innerName), MAX_NAME);
  }
  const title = el.getAttribute("title");
  if (title) return truncate(clean(title), MAX_NAME);
  return "";
}

export function elementLabel(el) {
  let s = el.localName;
  if (el.id) s += "#" + el.id;
  const classes = [...el.classList].slice(0, 2);
  if (classes.length) s += "." + classes.join(".");
  // why: An id can hold quotes and line breaks, which would let the page write its own lines here.
  return truncate(s.replace(/[^\p{L}\p{N}_.#:-]+/gu, "_"), 60);
}

export function isVisible(el) {
  if (el.getAttribute?.("aria-hidden") === "true" || el.hidden) return false;
  if (el.tagName?.toUpperCase() === "INPUT" && el.type === "hidden") return false;
  // why: Visibility must include ancestor and content-visibility checks, beyond the element's own display value.
  if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true })) return false;
  return true;
}

export function inViewport(el, win) {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.right > 0 && r.top < win.innerHeight && r.left < win.innerWidth;
}

export function fullyInViewport(el, win) {
  const r = el.getBoundingClientRect();
  return r.top >= 0 && r.left >= 0 && r.bottom <= win.innerHeight && r.right <= win.innerWidth;
}

export function frameIdOf(el) {
  const tag = el?.localName;
  if (tag !== "iframe" && tag !== "frame") return null;
  return el.browsingContext?.id ?? null;
}

export const MAX_TREE = 50000;

const CLICK_EVENTS = new Set(["click", "mousedown", "mouseup", "pointerdown", "pointerup"]);
const MAX_JOINED_TEXT = 2000;

const tagOf = (el) => el.tagName?.toUpperCase();
const isControl = (el) => INTERACTIVE_ROLES.has(roleOf(el));
const isSkipped = (el, clickable) => SKIP_TAGS.has(tagOf(el)) && !(clickable && tagOf(el) === "SVG");

export class PageReader {
  #clickables = new Map();
  #wholes = new Map();

  constructor(env) {
    this.env = env;
  }

  // why: Answers hold only while one synchronous read runs; within it each element is measured once.
  #startRead() {
    this.#clickables.clear();
    this.#wholes.clear();
  }

  #remember(answers, el, answer) {
    if (!answers.has(el)) answers.set(el, answer());
    return answers.get(el);
  }

  #listens(el) {
    return this.env.listenerTypes(el).some((type) => CLICK_EVENTS.has(type));
  }

  #pointer(el) {
    return !!el && this.env.window().getComputedStyle(el)?.cursor?.endsWith("pointer") === true;
  }

  // why: The cursor is inherited, so only the element where it starts says what is clickable.
  #startsPointer(el) {
    return this.#pointer(el) && !this.#pointer(el.parentElement ?? el.parentNode?.host);
  }

  // why: Only a short clickable without parts of its own can be read and clicked as one line.
  #whole(el) {
    return this.#remember(this.#wholes, el, () => {
      if (tagOf(el) === "SVG") return true;
      const shown = (el.innerText ?? "").trim();
      if (shown.length > MAX_NAME || /[\n\t]/.test(shown)) return false;
      const all = clean(el.textContent);
      return ![...el.querySelectorAll("*")].some((part) => {
        const role = roleOf(part);
        return (role && role !== "img") || frameIdOf(part) || (this.#listens(part) && clean(part.textContent) !== all);
      });
    });
  }

  #insideControl(el) {
    for (let up = el.parentElement; up && tagOf(up) !== "BODY"; up = up.parentElement)
      if (isControl(up) || (this.#startsPointer(up) && this.#whole(up))) return true;
    return false;
  }

  #clickable(el) {
    return this.#remember(this.#clickables, el, () => this.#reactsToClicks(el));
  }

  #reactsToClicks(el) {
    if (tagOf(el) === "HTML" || tagOf(el) === "BODY" || isControl(el)) return false;
    if (tagOf(el) === "LABEL" && el.control && isVisible(el.control)) return false;
    const pointer = this.#startsPointer(el);
    if ((!pointer && !this.#listens(el)) || this.#insideControl(el)) return false;
    if (pointer) return true;
    // why: Frameworks put delegated listeners on wrappers, which are not themselves a target.
    if (clean(el.textContent).length > MAX_NAME) return false;
    const { width, height } = el.getBoundingClientRect();
    if (!width || !height) return false;
    return ![...el.querySelectorAll("*")].some(
      (inner) => isControl(inner) || this.#startsPointer(inner) || this.#listens(inner),
    );
  }

  targets(selector) {
    this.#startRead();
    return [...this.env.document().querySelectorAll("*")].filter((el) => el.matches(selector) || this.#clickable(el));
  }

  readPage({ filter = "all", depth = 30, ref_id, max_chars = MAX_TREE, bare = false }) {
    this.#startRead();
    const doc = this.env.document();
    const root = ref_id ? this.env.element(ref_id) : doc.body;
    if (!root) return "(empty page)";
    const lines = [];
    let size = 0;
    let truncated = false;
    const interactiveOnly = filter === "interactive";

    const push = (indent, line) => {
      if (truncated) return;
      const text = "  ".repeat(indent) + line;
      if (size + text.length > max_chars) {
        truncated = true;
        return;
      }
      size += text.length + 1;
      lines.push(text);
    };

    const walk = (el, indent, level) => {
      if (truncated || level > depth) return;
      if (!isVisible(el)) return;
      const clickable = this.#clickable(el);
      if (isSkipped(el, clickable)) return;
      const role = roleOf(el);
      const interactive = INTERACTIVE_ROLES.has(role);
      const printed = interactiveOnly ? interactive || clickable : !!role || clickable;
      let childIndent = indent;
      // why: Leave a marker because the content of a frame belongs to its own actor.
      const frameId = frameIdOf(el);
      if (frameId) {
        if (!interactiveOnly) push(indent, this.describeElement(el, role));
        push(interactiveOnly ? indent : indent + 1, `{{frame:${frameId}}}`);
        return;
      }
      if (printed) {
        const whole = clickable && this.#whole(el);
        push(
          indent,
          this.describeElement(el, role, {
            clickable,
            nameFromContent: whole || (clickable && interactiveOnly) || undefined,
          }),
        );
        if (whole) return;
        childIndent = interactiveOnly ? indent : indent + 1;
        // why: Avoid repeating names and splitting text from a single logical block into markup fragments.
        if (interactive && role !== "listbox" && role !== "combobox") return;
        if (!interactiveOnly && TEXT_CONTAINERS.has(role) && !this.#hasTargets(el)) {
          const t = clean(el.innerText);
          if (t) push(childIndent, `text "${truncate(t, 500)}"`);
          return;
        }
      }
      for (const child of el.childNodes) {
        if (child.nodeType === 1) walk(child, childIndent, level + 1);
        else if (!interactiveOnly && child.nodeType === 3) {
          const t = clean(child.data);
          if (t && !(printed && NAME_FROM_CONTENT.has(role))) push(childIndent, `text "${t}"`);
        }
      }
    };

    walk(root, 0, 0);
    if (truncated) {
      const hint = interactiveOnly ? "search with find" : 'use filter: "interactive"';
      lines.push(`…(truncated at ${max_chars} characters; focus on a subtree with ref_id or ${hint})`);
    }
    if (bare) return lines.join("\n");
    return `${doc.title}\n${doc.URL}\n\n${lines.join("\n") || "(no visible elements)"}`;
  }

  #hasTargets(el) {
    return (
      !!el.querySelector(CONTROL_SELECTOR) || [...el.querySelectorAll("*")].some((inner) => this.#clickable(inner))
    );
  }

  describeElement(el, role, { clickable = false, nameFromContent } = {}) {
    const parts = [role || (clickable ? "clickable" : "text")];
    const name = accessibleName(el, this.env.document(), nameFromContent);
    if (name) parts.push(`"${name}"`);
    else if (!role) parts.push(elementLabel(el));
    parts.push(`[${this.env.ref(el)}]`);
    const tag = el.tagName.toUpperCase();
    if (role === "heading") parts.push(`level=${tag[1] || el.getAttribute("aria-level") || ""}`);
    if (role === "link" && el.getAttribute("href")) parts.push(`href="${truncate(el.getAttribute("href"), 120)}"`);
    if (tag === "INPUT" || tag === "TEXTAREA") {
      const type = el.getAttribute("type");
      if (type && tag === "INPUT" && !INPUT_ROLES[type]) parts.push(`type=${type}`);
      if (el.type === "checkbox" || el.type === "radio") parts.push(el.checked ? "checked" : "unchecked");
      else if (el.type !== "password" && el.value) parts.push(`value="${truncate(el.value, MAX_NAME)}"`);
      if (el.placeholder && el.placeholder !== name) parts.push(`placeholder="${truncate(el.placeholder, MAX_NAME)}"`);
    }
    if (tag === "SELECT") {
      const opt = el.selectedOptions?.[0];
      if (opt) parts.push(`value="${truncate(clean(opt.text), MAX_NAME)}"`);
      parts.push(
        `options=[${[...el.options]
          .slice(0, 20)
          .map((o) => `"${truncate(clean(o.text), 40)}"`)
          .join(", ")}${el.options.length > 20 ? ", …" : ""}]`,
      );
    }
    if (el.isContentEditable && role === "textbox") parts.push(`value="${truncate(clean(el.innerText), MAX_NAME)}"`);
    if (el.disabled || el.getAttribute("aria-disabled") === "true") parts.push("disabled");
    const expanded = el.getAttribute("aria-expanded");
    if (expanded) parts.push(`expanded=${expanded}`);
    if (el.getAttribute("aria-selected") === "true") parts.push("selected");
    if (el.getAttribute("aria-checked")) parts.push(`checked=${el.getAttribute("aria-checked")}`);
    if (clickable && role) parts.push("clickable");
    if (!inViewport(el, this.env.window())) parts.push("(off-screen)");
    return parts.join(" ");
  }

  // why: An element whose match lies in one of its children, or in a control listed by name, is not a separate hit.
  #textMatches(words) {
    const win = this.env.window();
    const found = [];
    const holds = (text) => {
      const there = tokens(text);
      return words.every((w) => there.some((t) => t.startsWith(w)));
    };
    const visit = (el) => {
      let text = "";
      let own = false;
      let covered = false;
      for (const child of el.childNodes) {
        if (child.nodeType === 3) {
          text += child.data;
          own ||= !!clean(child.data);
        }
        if (child.nodeType !== 1) continue;
        if (tagOf(child) === "BR" || SKIP_TAGS.has(tagOf(child)) || frameIdOf(child) || !isVisible(child)) {
          text += " ";
          continue;
        }
        let inner;
        if (isControl(child) || (this.#clickable(child) && this.#whole(child))) {
          inner = NAME_FROM_CONTENT.has(roleOf(child)) || !isControl(child) ? child.textContent : "";
          if (holds(inner)) inner = null;
        } else inner = visit(child);
        if (inner === null) covered = true;
        else text += win.getComputedStyle(child)?.display === "inline" ? inner : ` ${inner} `;
      }
      if (covered) return null;
      // why: Joined text of large wrappers is not worth searching; text of their own is.
      if (text.length > MAX_JOINED_TEXT && !own) return null;
      if (!holds(text)) return text;
      found.push({ el, text: clean(text) });
      return null;
    };
    const { body } = this.env.document();
    if (body) visit(body);
    return found;
  }

  find(query) {
    this.#startRead();
    const doc = this.env.document();
    const win = this.env.window();
    const words = tokens(query);
    if (!words.length) throw new Error("Empty query.");
    const results = new Map();
    const add = (el, name, base, weight, details) => {
      let score = base;
      if (normalize(name) === normalize(query)) score += 0.4 * weight;
      // why: Check whole names so package.json does not match package-lock.json.
      else if (normalize(name).includes(normalize(query))) score += 0.2 * weight;
      if (inViewport(el, win)) score += 0.1 * weight;
      if (score > (results.get(el)?.score ?? 0)) results.set(el, { el, score, ...details });
    };
    const all = doc.body?.querySelectorAll("*") ?? [];
    for (const el of all) {
      if (el.ownerSVGElement) continue;
      const role = roleOf(el);
      const clickable = this.#clickable(el);
      if ((!role && !clickable) || !isVisible(el)) continue;
      if (isSkipped(el, clickable)) continue;
      const name = accessibleName(el, doc, clickable || undefined);
      const haystack = tokens(
        [
          name,
          el.getAttribute("placeholder"),
          el.getAttribute("title"),
          el.id,
          el.getAttribute("name"),
          el.getAttribute("href"),
          role || "clickable",
        ].join(" "),
      );
      const hits = words.filter((w) => haystack.some((t) => t.startsWith(w))).length;
      // why: Prefer an actionable element to a surrounding node with the same name, and a real control to a guessed one.
      const bonus = INTERACTIVE_ROLES.has(role) ? 0.5 : clickable ? 0.45 : 0;
      if (hits) add(el, name, hits / words.length + bonus, 1, { clickable, nameFromContent: clickable || undefined });
    }
    // why: Even the best text match stays below a full name match (1).
    for (const { el, text } of this.#textMatches(words))
      add(el, text, 0.7, 0.5, { clickable: this.#clickable(el), nameFromContent: true });
    return [...results.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map(({ el, score, clickable, nameFromContent }) => ({
        line: this.describeElement(el, roleOf(el), { clickable, nameFromContent }),
        score,
      }));
  }

  check({ text, selector }) {
    const doc = this.env.document();
    const has = (el) => !text || normalize(el.innerText ?? "").includes(normalize(text));
    if (selector) {
      return [...doc.querySelectorAll(selector)].some((el) => isVisible(el) && has(el));
    }
    return !!doc.body && has(doc.body);
  }

  sample({ selector }) {
    const el = [...this.env.document().querySelectorAll(selector)].find((el) => isVisible(el));
    return el ? truncate(clean(el.innerText ?? el.textContent ?? ""), 500) : null;
  }

  risk({ ref, x, y, focused = false, enter = false, space = false }) {
    const doc = this.env.document();
    const el = focused ? deepActiveElement(doc) : ref ? this.env.element(ref) : doc.elementFromPoint(x, y);
    if (!focused) return { submit: submitsForm(el), secret: isSecretField(el) };
    const textField =
      el?.localName === "input" &&
      !["button", "submit", "reset", "image", "checkbox", "radio", "file"].includes(el.type);
    return {
      submit: ((enter || space) && submitsForm(el)) || (enter && textField && !!el.form),
      secret: isSecretField(el),
    };
  }

  describeTarget({ ref, x, y }) {
    const doc = this.env.document();
    const el = ref ? this.env.element(ref) : doc.elementFromPoint(x, y);
    if (!el) return this.env.L("an empty spot", "boş bir yer");
    const role = roleOf(el) || el.localName;
    const name = accessibleName(el, doc) || truncate(clean(el.innerText ?? ""), 40);
    return name ? `${role} "${truncate(name, 60)}"` : role;
  }
}
