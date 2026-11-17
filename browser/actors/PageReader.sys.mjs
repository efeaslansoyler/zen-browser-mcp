// Reading a frame for agents: roles and accessible names close to what assistive technology
// reports, the tree for read_page, keyword search for find, wait_for/watch checks and short
// element descriptions for prompts and the log. Elements are seen through Xrays: the page's
// own property overrides are invisible, native DOM behavior is what counts.
//
// Elements get "ref_N" IDs from the actor (in a subframe "ref_N_f<browsing context id>", which
// the parent uses to route requests to the right frame). An iframe is replaced by a
// "{{frame:<id>}}" line that the parent fills with that frame's tree.
//
// Other actor helpers get these functions from the actor, never by importing this module:
// a static import would skip the ?v= query that makes a bridge reload load new code.

export const MAX_NAME = 100;

const LANDMARKS = {
  NAV: "navigation", MAIN: "main", HEADER: "banner", FOOTER: "contentinfo", ASIDE: "complementary",
  FORM: "form", DIALOG: "dialog", SECTION: "region",
};
const STRUCTURE = {
  H1: "heading", H2: "heading", H3: "heading", H4: "heading", H5: "heading", H6: "heading",
  UL: "list", OL: "list", LI: "listitem", TABLE: "table", TR: "row", TD: "cell", TH: "columnheader",
  P: "paragraph", IMG: "img", LABEL: "label", IFRAME: "iframe",
};
export const INPUT_ROLES = {
  button: "button", submit: "button", reset: "button", image: "button", checkbox: "checkbox",
  radio: "radio", range: "slider", search: "searchbox", file: "button", color: "button",
};
export const INTERACTIVE_ROLES = new Set([
  "button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox", "listbox", "option",
  "slider", "switch", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "spinbutton", "treeitem",
]);
export const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "HEAD", "META", "LINK"]);
export const TEXT_CONTAINERS = new Set(["paragraph", "listitem", "cell", "label"]);
export const CONTROL_SELECTOR = "a[href], button, input, select, textarea, summary, [role], [contenteditable], [tabindex]";

// Roles named by their content. The text of structural elements (list items, cells,
// paragraphs) goes on the lines below instead, or it would repeat the name of a link inside.
export const NAME_FROM_CONTENT = new Set([
  "button", "link", "heading", "tab", "menuitem", "option", "columnheader", "treeitem", "switch",
  "checkbox", "radio",
]);

export const clean = s => (s ?? "").replace(/\s+/g, " ").trim();
export const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
export const normalize = s => clean(s).toLocaleLowerCase("tr");
// Everything but letters and digits separates words: "package.json" → ["package", "json"]
export const tokens = s => normalize(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

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
      // alt="" marks a decorative image
      return el.getAttribute("alt") === "" ? "" : "img";
  }
  if (el.isContentEditable && !el.parentElement?.isContentEditable) return "textbox";
  if (LANDMARKS[tag]) {
    // section and form are landmarks only when named
    if ((tag === "SECTION" || tag === "FORM") && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby")) return "";
    return LANDMARKS[tag];
  }
  if (STRUCTURE[tag]) return STRUCTURE[tag];
  // Clickable non-semantic elements (a div with onclick can't be detected; tabindex is a hint)
  if (el.hasAttribute("tabindex") && el.tabIndex >= 0) return "focusable";
  return "";
}

export function accessibleName(el, doc) {
  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    const text = labelledby.split(/\s+/).map(id => doc.getElementById(id)?.innerText ?? "").join(" ");
    if (clean(text)) return truncate(clean(text), MAX_NAME);
  }
  const aria = el.getAttribute("aria-label");
  if (aria && clean(aria)) return truncate(clean(aria), MAX_NAME);
  const tag = el.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    const label = el.labels?.[0];
    if (label && clean(label.innerText)) return truncate(clean(label.innerText), MAX_NAME);
    if (tag === "INPUT" && ["button", "submit", "reset"].includes(el.type) && el.value) return truncate(el.value, MAX_NAME);
    if (el.getAttribute("placeholder")) return truncate(clean(el.getAttribute("placeholder")), MAX_NAME);
  }
  if (tag === "IMG" || (tag === "INPUT" && el.type === "image")) {
    const alt = el.getAttribute("alt");
    if (alt) return truncate(clean(alt), MAX_NAME);
  }
  const role = roleOf(el);
  if (NAME_FROM_CONTENT.has(role)) {
    // innerText skips invisible parts (e.g. hidden shortcut hints) and separates blocks
    const text = clean(el.innerText ?? el.textContent);
    if (text) return truncate(text, MAX_NAME);
    // Icon-only buttons: the inner image's alt or the svg title
    const inner = el.querySelector("img[alt], svg title, [aria-label]");
    const innerName = inner?.getAttribute("alt") || inner?.getAttribute("aria-label") || inner?.textContent;
    if (innerName && clean(innerName)) return truncate(clean(innerName), MAX_NAME);
  }
  const title = el.getAttribute("title");
  if (title) return truncate(clean(title), MAX_NAME);
  return "";
}

// "button#cta.btn.primary"
export function elementLabel(el) {
  let s = el.localName;
  if (el.id) s += "#" + el.id;
  const classes = [...el.classList].slice(0, 2);
  if (classes.length) s += "." + classes.join(".");
  return truncate(s, 60);
}

export function isVisible(el) {
  if (el.getAttribute?.("aria-hidden") === "true" || el.hidden) return false;
  if (el.tagName?.toUpperCase() === "INPUT" && el.type === "hidden") return false;
  // checkVisibility covers display:none, visibility, content-visibility and ancestors
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

// The browsing context ID of the frame inside an iframe/frame element (null if not loaded).
export function frameIdOf(el) {
  const tag = el?.localName;
  if (tag !== "iframe" && tag !== "frame") return null;
  return el.browsingContext?.id ?? null;
}

export const MAX_TREE = 50000;

export class PageReader {
  // env: { document(), window(), ref(el), element(ref), L }
  constructor(env) { this.env = env; }

  // bare: tree lines only, for a subframe (the parent adds title and URL)
  readPage({ filter = "all", depth = 30, ref_id, max_chars = MAX_TREE, bare = false }) {
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
      if (SKIP_TAGS.has(el.tagName?.toUpperCase()) || !isVisible(el)) return;
      const role = roleOf(el);
      const interactive = INTERACTIVE_ROLES.has(role);
      const printed = interactiveOnly ? interactive : !!role;
      let childIndent = indent;
      // The iframe's content belongs to another actor: leave a marker for the parent to fill.
      const frameId = frameIdOf(el);
      if (frameId) {
        if (!interactiveOnly) push(indent, this.describeElement(el, role));
        push(interactiveOnly ? indent : indent + 1, `{{frame:${frameId}}}`);
        return;
      }
      if (printed) {
        push(indent, this.describeElement(el, role));
        childIndent = interactiveOnly ? indent : indent + 1;
        // A button's or link's text is already its name; don't descend.
        if (interactive && role !== "listbox" && role !== "combobox") return;
        // A text block without controls: one line instead of <b>, <span>… fragments
        if (!interactiveOnly && TEXT_CONTAINERS.has(role) && !el.querySelector(CONTROL_SELECTOR)) {
          const t = clean(el.innerText);
          if (t) push(childIndent, `text "${truncate(t, 500)}"`);
          return;
        }
      }
      for (const child of el.childNodes) {
        if (child.nodeType === 1) walk(child, childIndent, level + 1);
        else if (!interactiveOnly && child.nodeType === 3) {
          const t = clean(child.data);
          // Loose text under an element; not repeated for roles named by their content.
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

  describeElement(el, role) {
    const parts = [role];
    const name = accessibleName(el, this.env.document());
    if (name) parts.push(`"${name}"`);
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
      parts.push(`options=[${[...el.options].slice(0, 20).map(o => `"${truncate(clean(o.text), 40)}"`).join(", ")}${el.options.length > 20 ? ", …" : ""}]`);
    }
    if (el.isContentEditable && role === "textbox") parts.push(`value="${truncate(clean(el.innerText), MAX_NAME)}"`);
    if (el.disabled || el.getAttribute("aria-disabled") === "true") parts.push("disabled");
    const expanded = el.getAttribute("aria-expanded");
    if (expanded) parts.push(`expanded=${expanded}`);
    if (el.getAttribute("aria-selected") === "true") parts.push("selected");
    if (el.getAttribute("aria-checked")) parts.push(`checked=${el.getAttribute("aria-checked")}`);
    if (!inViewport(el, this.env.window())) parts.push("(off-screen)");
    return parts.join(" ");
  }

  // Keyword matching: every query word must match the start of a word in the element's name
  // or attributes ("to" doesn't match "autoconfig", "serv" matches "server").
  find(query) {
    const doc = this.env.document();
    const win = this.env.window();
    const words = tokens(query);
    if (!words.length) throw new Error("Empty query.");
    const results = [];
    const all = doc.body?.querySelectorAll("*") ?? [];
    for (const el of all) {
      if (SKIP_TAGS.has(el.tagName.toUpperCase())) continue;
      const role = roleOf(el);
      if (!role || !isVisible(el)) continue;
      const name = accessibleName(el, doc);
      const haystack = tokens(
        [name, el.getAttribute("placeholder"), el.getAttribute("title"), el.id, el.getAttribute("name"), el.getAttribute("href"), role].join(" ")
      );
      const hits = words.filter(w => haystack.some(t => t.startsWith(w))).length;
      if (!hits) continue;
      let score = hits / words.length;
      // Interactive elements rank above exact name matches (the link, not the cell around it).
      if (INTERACTIVE_ROLES.has(role)) score += 0.5;
      if (normalize(name) === normalize(query)) score += 0.4;
      // The whole query inside the name ("package.json" ≠ "package-lock.json")
      else if (normalize(name).includes(normalize(query))) score += 0.2;
      if (inViewport(el, win)) score += 0.1;
      results.push({ el, role, score });
    }
    // The parent merges all frames' results by score.
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 20).map(({ el, role, score }) => ({ line: this.describeElement(el, role), score }));
  }

  // wait_for: is the text and/or selector visible in this frame
  check({ text, selector }) {
    const doc = this.env.document();
    const has = el => !text || normalize(el.innerText ?? "").includes(normalize(text));
    if (selector) {
      return [...doc.querySelectorAll(selector)].some(el => isVisible(el) && has(el));
    }
    return !!doc.body && has(doc.body);
  }

  // watch change: the text of the first visible element matching the selector (or null)
  sample({ selector }) {
    const el = [...this.env.document().querySelectorAll(selector)].find(el => isVisible(el));
    return el ? truncate(clean(el.innerText ?? el.textContent ?? ""), 500) : null;
  }

  // A short description for permission prompts and the log: 'button "Get a quote"'
  describeTarget({ ref, x, y }) {
    const doc = this.env.document();
    const el = ref ? this.env.element(ref) : doc.elementFromPoint(x, y);
    if (!el) return this.env.L("an empty spot", "boş bir yer");
    const role = roleOf(el) || el.localName;
    const name = accessibleName(el, doc) || truncate(clean(el.innerText ?? ""), 40);
    return name ? `${role} "${truncate(name, 60)}"` : role;
  }
}
