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

const tagOf = (el) => el.tagName?.toUpperCase();

// why: Browser-internal roots (fields, details, video controls) and the copies in a use element aren't page content.
function shadowRootOf(el) {
  const root = el?.openOrClosedShadowRoot;
  return root && !root.isUAWidget() && tagOf(el) !== "USE" ? root : null;
}

// why: A slot shows what is slotted into it; light children of a host show only through one.
function shownChildren(el) {
  const root = shadowRootOf(el);
  if (root) return root.childNodes;
  const slotted = el.localName === "slot" ? el.assignedNodes() : [];
  return slotted.length ? slotted : el.childNodes;
}

export function composedParent(node) {
  const slot = node.openOrClosedAssignedSlot;
  if (slot && !slot.getRootNode().isUAWidget()) return slot;
  return node.parentNode?.nodeType === 11 ? node.parentNode.host : node.parentNode;
}

export function closestShown(el, selector) {
  for (let up = el; up; up = composedParent(up)) if (up.matches?.(selector)) return up;
  return null;
}

// why: Finding them is a pass over the whole page, so the answer is kept until the running job ends.
let crossings = new WeakMap();
function crossingsIn(doc) {
  if (crossings.has(doc)) return crossings.get(doc);
  const found = new Set();
  const add = (el) => {
    for (let up = el; up && !found.has(up); up = composedParent(up)) found.add(up);
  };
  const scan = (root) => {
    for (const el of root.querySelectorAll("*")) {
      const inner = shadowRootOf(el);
      if (inner) {
        add(el);
        scan(inner);
      } else if (el.localName === "slot" && el.assignedNodes().length) add(el);
    }
  };
  scan(doc);
  crossings.set(doc, found);
  Promise.resolve().then(() => (crossings = new WeakMap()));
  return found;
}

// why: Native text and queries are right, and much faster, where nothing inside is in another tree.
const crossesTrees = (el) => crossingsIn(el.ownerDocument).has(el);

export function shownElements(root) {
  const found = [];
  const collect = (el) => {
    if (!crossesTrees(el)) {
      for (const inner of el.querySelectorAll("*")) found.push(inner);
      return;
    }
    for (const child of shownChildren(el)) {
      if (child.nodeType !== 1) continue;
      found.push(child);
      collect(child);
    }
  };
  collect(root);
  return found;
}

export const findShown = (el, selector) =>
  crossesTrees(el) ? shownElements(el).find((inner) => inner.matches(selector)) : el.querySelector(selector);

function allText(el) {
  if (!crossesTrees(el)) return el.textContent;
  return [...shownChildren(el)]
    .map((node) =>
      node.nodeType === 3 ? node.data : node.nodeType === 1 && !SKIP_TAGS.has(tagOf(node)) ? allText(node) : "",
    )
    .join("");
}

export function hitAt(doc, x, y) {
  let hit = doc.elementFromPoint(x, y);
  for (let root = shadowRootOf(hit); root; root = shadowRootOf(hit)) {
    const inner = root.elementFromPoint(x, y);
    if (!inner || inner.getRootNode() !== root) break;
    hit = inner;
  }
  return hit;
}

export function submitsForm(el) {
  const control = closestShown(el, "button, input");
  if (!control?.form) return false;
  return control.localName === "button" ? control.type === "submit" : ["submit", "image"].includes(control.type);
}

export function deepActiveElement(doc) {
  let el = doc.activeElement;
  for (let inner = el; inner; inner = shadowRootOf(el)?.activeElement) el = inner;
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

// why: Gecko's accessibility tree resolves levels the same way, invalid values included.
function headingLevel(el) {
  const level = parseInt(el.getAttribute("aria-level"), 10);
  return level > 0 ? level : (/^H([1-6])$/.exec(el.tagName.toUpperCase())?.[1] ?? 2);
}

// why: An element with display: contents has no box of its own, so checkVisibility denies it.
const styleOf = (el) => el.ownerDocument.defaultView.getComputedStyle(el);
const isBoxless = (el) => styleOf(el).display === "contents";

// why: These hide what is inside them while they are shown themselves.
const hidesContent = (el) => (tagOf(el) === "DETAILS" && !el.open) || styleOf(el).contentVisibility === "hidden";

function isRendered(el, options) {
  if (el.checkVisibility(options)) return true;
  const style = styleOf(el);
  if (style.display !== "contents" || (options?.visibilityProperty && style.visibility !== "visible")) return false;
  const parent = composedParent(el);
  return parent?.nodeType === 1 && !hidesContent(parent) && isRendered(parent);
}

function* contentRects(el) {
  for (const node of shownChildren(el)) {
    if (node.nodeType === 3) {
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(node);
      yield* range.getClientRects();
    } else if (node.nodeType === 1) {
      const rects = node.getClientRects();
      if (rects.length) yield* rects;
      else if (isBoxless(node)) yield* contentRects(node);
    }
  }
}

const lacksBox = ({ width, height }, el) => !width && !height && isBoxless(el);

export function rectOf(el) {
  const rect = el.getBoundingClientRect();
  if (!lacksBox(rect, el)) return rect;
  const parts = [...contentRects(el)].filter((part) => part.width || part.height);
  if (!parts.length) return rect;
  const left = Math.min(...parts.map((part) => part.left));
  const top = Math.min(...parts.map((part) => part.top));
  const right = Math.max(...parts.map((part) => part.right));
  const bottom = Math.max(...parts.map((part) => part.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

// why: The middle of everything inside a boxless element can be a gap between its parts.
function firstPart(el) {
  for (const node of shownChildren(el)) {
    if (node.nodeType !== 1 && node.nodeType !== 3) continue;
    const box = node.nodeType === 1 ? node : el.ownerDocument.createRange();
    if (node.nodeType === 3) box.selectNodeContents(node);
    const rect = [...box.getClientRects()].find(({ width, height }) => width && height);
    const part = rect ? { node, rect } : node.nodeType === 1 && isBoxless(node) && firstPart(node);
    if (part) return part;
  }
  return null;
}

export function clickRectOf(el) {
  const rect = el.getBoundingClientRect();
  return lacksBox(rect, el) ? (firstPart(el)?.rect ?? rect) : rect;
}

// why: Text has no scrollIntoView. Pages don't use this selection, so the user's own stays.
function scrollTextIntoView(node) {
  const controller = node.ownerDocument.defaultView.docShell
    .QueryInterface(Ci.nsIInterfaceRequestor)
    .getInterface(Ci.nsISelectionDisplay)
    .QueryInterface(Ci.nsISelectionController);
  const type = controller.SELECTION_URLSECONDARY;
  const range = node.ownerDocument.createRange();
  const start = Math.max(0, node.data.search(/\S/));
  range.setStart(node, start);
  range.setEnd(node, start + 1);
  const selection = controller.getSelection(type);
  selection.addRange(range);
  controller.scrollSelectionIntoView(
    type,
    controller.SELECTION_WHOLE_SELECTION,
    controller.SCROLL_SYNCHRONOUS | controller.SCROLL_VERTICAL_CENTER | controller.SCROLL_OVERFLOW_HIDDEN,
  );
  selection.removeRange(range);
}

export function scrollIntoView(el, options) {
  const part = lacksBox(el.getBoundingClientRect(), el) ? firstPart(el)?.node : el;
  if (part?.nodeType === 3) return scrollTextIntoView(part);
  let target = part ?? el;
  while (isBoxless(target) && composedParent(target)?.nodeType === 1) target = composedParent(target);
  target.scrollIntoView({ block: "center", behavior: "instant", ...options });
}

// why: An iframe larger than the viewport has no scrollIntoView for a part of it.
export function scrollPointIntoView(el, at) {
  const root = el.ownerDocument.scrollingElement;
  for (let up = el; up && up !== root; up = composedParent(up)) {
    const box = up !== el && up.getBoundingClientRect?.();
    if (box) scrollToMiddle(up, at, box.left + up.clientLeft, box.top + up.clientTop);
    if (up.nodeType === 1 && styleOf(up).position === "fixed") return;
  }
  if (root) scrollToMiddle(root, at, 0, 0);
}

function scrollToMiddle(scroller, at, left, top) {
  const [x, y] = at();
  const { clientWidth, clientHeight } = scroller;
  scroller.scrollBy({
    left: x - left - clientWidth / 2,
    top: y - top - clientHeight / 2,
    behavior: "instant",
  });
}

function showsText(el, node) {
  if (el.openOrClosedShadowRoot && !shadowRootOf(el) && !node.openOrClosedAssignedSlot) return false;
  return !hidesContent(el) && isRendered(el, { visibilityProperty: true });
}

// why: innerText, built from the DOM where Gecko leaves it empty (docs/gecko-pitfalls.md, Input and frames).
// why: As in its specification, a number is how many line breaks must separate what is around it.
function textItems(el, isNative) {
  const style = styleOf(el);
  const items = [];
  for (const child of shownChildren(el)) {
    if (child.nodeType === 3 && showsText(el, child))
      items.push(style.whiteSpace.startsWith("pre") ? child.data : child.data.replace(/\s+/g, " "));
    if (child.nodeType !== 1) continue;
    if (!isRendered(child)) continue;
    const tag = tagOf(child);
    if (tag === "BR") items.push("\n");
    if (tag === "BR" || SKIP_TAGS.has(tag) || frameIdOf(child)) continue;
    const { display } = styleOf(child);
    const inline = /^(inline|contents|ruby)/.test(display);
    const inner = !inline && isNative?.(child) ? [shownText(child)] : textItems(child, isNative);
    const gap = tag === "P" ? 2 : 1;
    if (inline) items.push(...inner);
    else if (display === "table-cell") items.push(...inner, "\t");
    else items.push(gap, ...inner, gap);
  }
  return items;
}

function joinItems(items) {
  let out = "";
  let gap = 0;
  for (const item of items) {
    if (typeof item === "number") gap = Math.max(gap, item);
    else if (item.trim() || (out && !gap)) {
      if (gap && out) out = out.trimEnd() + "\n".repeat(gap);
      out += /\s/.test(out.at(-1)) ? item.replace(/^ /, "") : item;
      gap = 0;
    }
  }
  return out.replace(/ +(?=[\t\n])/g, "").trim();
}

// why: Hidden text stays out, so for an element that really shows nothing both parts are empty.
export function shownText(el) {
  if (crossesTrees(el)) return joinItems(textItems(el, (inner) => !crossesTrees(inner)));
  return (el.innerText ?? el.textContent) || (clean(el.textContent) && joinItems(textItems(el)));
}

export function pageText(root) {
  const win = root.ownerDocument.defaultView;
  const skipped = [root, ...shownElements(root)].filter(
    (el) => win.getComputedStyle(el).contentVisibility === "auto" && !el.innerText && clean(allText(el)),
  );
  if (!skipped.length) return shownText(root);
  const isNative = (el) =>
    !crossesTrees(el) && !skipped.some((section) => el.contains(section) || section.contains(el));
  return joinItems(textItems(root, isNative));
}

export function accessibleName(el, fromContent = NAME_FROM_CONTENT.has(roleOf(el))) {
  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    const text = labelledby
      .split(/\s+/)
      .map((id) => {
        const target = el.getRootNode().getElementById?.(id);
        return target ? shownText(target) : "";
      })
      .join(" ");
    if (clean(text)) return truncate(clean(text), MAX_NAME);
  }
  const aria = el.getAttribute("aria-label");
  if (aria && clean(aria)) return truncate(clean(aria), MAX_NAME);
  const tag = el.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    const label = el.labels?.[0];
    const labelText = label && clean(shownText(label));
    if (labelText) return truncate(labelText, MAX_NAME);
    if (tag === "INPUT" && ["button", "submit", "reset"].includes(el.type) && el.value)
      return truncate(el.value, MAX_NAME);
    if (el.getAttribute("placeholder")) return truncate(clean(el.getAttribute("placeholder")), MAX_NAME);
  }
  if (tag === "IMG" || (tag === "INPUT" && el.type === "image")) {
    const alt = el.getAttribute("alt");
    if (alt) return truncate(clean(alt), MAX_NAME);
  }
  if (fromContent) {
    const text = clean(shownText(el));
    if (text) return truncate(text, MAX_NAME);
    const inner = findShown(el, "img[alt], svg title, [aria-label]");
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
  if (!el.checkVisibility || el.checkVisibility({ visibilityProperty: true })) return true;
  return isRendered(el, { visibilityProperty: true }) && !contentRects(el).next().done;
}

export function inViewport(el, win) {
  const r = rectOf(el);
  return r.bottom > 0 && r.right > 0 && r.top < win.innerHeight && r.left < win.innerWidth;
}

export function fullyInViewport(el, win) {
  const r = rectOf(el);
  return r.top >= 0 && r.left >= 0 && r.bottom <= win.innerHeight && r.right <= win.innerWidth;
}

export function frameIdOf(el) {
  const tag = el?.localName;
  if (tag !== "iframe" && tag !== "frame") return null;
  return el.browsingContext?.id ?? null;
}

export const MAX_TREE = 50000;
const STILL_LOADING = "(still loading)";

const FIELD_ROLES = new Set([
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "slider",
  "switch",
  "spinbutton",
]);
const FIELD_SELECTOR = "input, select, textarea, [role], [contenteditable]";
// why: A cell that holds one of these is a part of the page's layout, not the place of one field.
const LAYOUT_SELECTOR = "h1, h2, h3, h4, h5, h6, table, ul, ol, form, main, nav, section";
const CLICK_EVENTS = new Set(["click", "mousedown", "mouseup", "pointerdown", "pointerup"]);
const MAX_JOINED_TEXT = 2000;
const FULL_MATCH = 10;
const MAX_HIT_NAME = 60;
const NATIVELY_CLICKABLE = new Set(["VIDEO", "AUDIO", "EMBED", "OBJECT"]);

const isControl = (el) => INTERACTIVE_ROLES.has(roleOf(el));
const isField = (el) => FIELD_ROLES.has(roleOf(el)) || (tagOf(el) === "INPUT" && ["file", "color"].includes(el.type));
const isSkipped = (el, clickable) => SKIP_TAGS.has(tagOf(el)) && !(clickable && tagOf(el) === "SVG");

export class PageReader {
  #clickables = new Map();
  #wholes = new Map();
  #rowLabels = new Map();

  constructor(env) {
    this.env = env;
  }

  // why: Answers hold only while one synchronous read runs; within it each element is measured once.
  #startRead() {
    this.#clickables.clear();
    this.#wholes.clear();
    this.#rowLabels.clear();
  }

  #remember(answers, el, answer) {
    if (!answers.has(el)) answers.set(el, answer());
    return answers.get(el);
  }

  #listens(el) {
    return this.env.listenerTypes(el).some((type) => CLICK_EVENTS.has(type));
  }

  #pointer(el) {
    return el?.nodeType === 1 && this.env.window().getComputedStyle(el)?.cursor?.endsWith("pointer") === true;
  }

  // why: The cursor is inherited, so only the element where it starts says what is clickable.
  #startsPointer(el) {
    return this.#pointer(el) && !this.#pointer(composedParent(el));
  }

  // why: Only a short clickable without parts of its own can be read and clicked as one line.
  #whole(el) {
    return this.#remember(this.#wholes, el, () => {
      if (tagOf(el) === "SVG") return true;
      const shown = shownText(el).trim();
      if (shown.length > MAX_NAME || /[\n\t]/.test(shown)) return false;
      const all = clean(allText(el));
      return !shownElements(el).some((part) => {
        const role = roleOf(part);
        return (role && role !== "img") || frameIdOf(part) || (this.#listens(part) && clean(allText(part)) !== all);
      });
    });
  }

  #insideControl(el) {
    for (let up = composedParent(el); up?.nodeType === 1 && tagOf(up) !== "BODY"; up = composedParent(up))
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
    if (pointer) return !this.#isOneControl(el);
    // why: Frameworks put delegated listeners on wrappers, which are not themselves a target.
    if (clean(allText(el)).length > MAX_NAME) return false;
    const { width, height } = rectOf(el);
    if (!width || !height) return false;
    return !shownElements(el).some((inner) => isControl(inner) || this.#startsPointer(inner) || this.#listens(inner));
  }

  // why: Components often give their host the pointer of the control they show.
  #isOneControl(el) {
    if (!shadowRootOf(el)) return false;
    const all = clean(allText(el));
    return shownElements(el).some((inner) => isControl(inner) && isVisible(inner) && clean(allText(inner)) === all);
  }

  // why: A wrong name makes an agent change the wrong setting, so any doubt leaves the field unnamed.
  #rowLabel(el) {
    const cell = el.closest("td, th");
    const row = cell?.parentElement;
    if (!row || tagOf(row) !== "TR") return "";
    const { field, cells } = this.#remember(this.#rowLabels, row, () => {
      const fields = shownElements(row).filter(
        (inner) => inner.matches(FIELD_SELECTOR) && isField(inner) && isVisible(inner),
      );
      return {
        field: fields.length === 1 && fields[0],
        cells: [...row.children].filter((child) => isVisible(child)),
      };
    });
    if (field !== el || findShown(cell, LAYOUT_SELECTOR)) return "";
    const labels = cells.slice(0, cells.indexOf(cell)).filter((before) => tokens(shownText(before)).length);
    if (labels.length !== 1) return "";
    const text = shownText(labels[0]).trim();
    if (text.length > MAX_NAME || /[\n\t]/.test(text)) return "";
    const holdsControl = shownElements(labels[0]).some((inner) => isControl(inner) && clean(shownText(inner)));
    return holdsControl ? "" : clean(text);
  }

  // why: Text of a submenu or of an inner control doesn't name the element around it.
  #hiddenText(el) {
    if (clean(shownText(el))) return "";
    const texts = [];
    const collect = (node, own) => {
      for (const child of shownChildren(node)) {
        if (texts.length > 1) return;
        if (child.nodeType === 3 && clean(child.data)) texts.push(own ? clean(child.data) : "");
        else if (child.nodeType === 1 && !SKIP_TAGS.has(tagOf(child)) && !frameIdOf(child))
          collect(child, own && !isControl(child) && !this.#listens(child));
      }
    };
    collect(el, true);
    return texts.length === 1 && texts[0].length <= MAX_NAME ? texts[0] : "";
  }

  // why: An inferred name is marked, because the page declares no relation between the text and the element.
  #name(el, clickable, fromContent) {
    const declared = accessibleName(el, fromContent);
    if (declared) return { name: declared, mark: "" };
    const fromRow = isField(el) && this.#rowLabel(el);
    if (fromRow) return { name: fromRow, mark: "(from row)" };
    const hidden = (clickable || (isControl(el) && NAME_FROM_CONTENT.has(roleOf(el)))) && this.#hiddenText(el);
    return hidden ? { name: hidden, mark: "(hidden text)" } : { name: "", mark: "" };
  }

  targets(selector) {
    this.#startRead();
    return shownElements(this.env.document().documentElement).filter(
      (el) => el.matches(selector) || this.#clickable(el),
    );
  }

  readPage({ filter = "all", depth = Infinity, ref_id, max_chars = MAX_TREE, bare = false, loading = false }) {
    this.#startRead();
    const doc = this.env.document();
    const root = ref_id ? this.env.element(ref_id) : doc.body;
    if (!root) return loading ? STILL_LOADING : "(empty page)";
    const lines = [];
    let size = 0;
    let truncated = false;
    let leftOut = false;
    const interactiveOnly = filter === "interactive";

    const push = (level, indent, line) => {
      if (level > depth) leftOut = true;
      if (truncated || level > depth) return;
      const text = "  ".repeat(indent) + line();
      if (size + text.length > max_chars) {
        truncated = true;
        return;
      }
      size += text.length + 1;
      lines.push(text);
    };

    const tooDeep = new Map();
    const goesTooDeep = (el, level) =>
      level > depth ||
      this.#remember(tooDeep, el, () =>
        [...shownChildren(el)].some((child) => child.nodeType === 1 && goesTooDeep(child, level + 1)),
      );

    const walk = (el, indent, level, named = false) => {
      // why: Below the depth limit or past max_chars, only whether anything is too deep matters.
      if ((truncated || level > depth) && (leftOut || depth === Infinity || !goesTooDeep(el, level))) return;
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
        if (!interactiveOnly) push(level, indent, () => this.describeElement(el, role));
        push(level, interactiveOnly ? indent : indent + 1, () => `{{frame:${frameId}}}`);
        return;
      }
      if (printed) {
        const whole = clickable && this.#whole(el);
        push(level, indent, () =>
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
          const t = clean(shownText(el));
          if (t) push(level, childIndent, () => `text "${truncate(t, 500)}"`);
          return;
        }
      }
      const ownNamed = printed ? NAME_FROM_CONTENT.has(role) : named && tagOf(el) === "SLOT";
      for (const child of shownChildren(el)) {
        if (child.nodeType === 1) walk(child, childIndent, level + 1, ownNamed);
        else if (!interactiveOnly && child.nodeType === 3) {
          const t = clean(child.data);
          if (t && !ownNamed && showsText(el, child)) push(level, childIndent, () => `text "${t}"`);
        }
      }
    };

    walk(root, 0, 0);
    if (truncated) {
      const hint = interactiveOnly ? "search with find" : 'use filter: "interactive"';
      lines.push(`…(truncated at ${max_chars} characters; focus on a subtree with ref_id or ${hint})`);
    }
    // why: At the start, so that cutting a long result can't remove it.
    if (leftOut)
      lines.unshift(
        `(depth ${depth}: deeper elements are left out; read without depth, or focus on a subtree with ref_id)`,
      );
    const tree = lines.join("\n") || (loading ? STILL_LOADING : "");
    if (bare) return tree;
    return `${doc.title}\n${doc.URL}\n\n${tree || "(no visible elements)"}`;
  }

  #hasTargets(el) {
    return !!findShown(el, CONTROL_SELECTOR) || shownElements(el).some((inner) => this.#clickable(inner));
  }

  describeElement(el, role, { clickable = false, nameFromContent } = {}) {
    const parts = [role || (clickable ? "clickable" : "text")];
    const { name, mark } = this.#name(el, clickable, nameFromContent);
    if (name) parts.push(`"${name}"`);
    else if (!role) parts.push(elementLabel(el));
    if (mark) parts.push(mark);
    parts.push(`[${this.env.ref(el)}]`);
    const tag = el.tagName.toUpperCase();
    if (role === "heading") parts.push(`level=${headingLevel(el)}`);
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
    if (el.isContentEditable && role === "textbox") parts.push(`value="${truncate(clean(shownText(el)), MAX_NAME)}"`);
    if (el.disabled || el.getAttribute("aria-disabled") === "true") parts.push("disabled");
    const expanded = el.getAttribute("aria-expanded");
    if (expanded) parts.push(`expanded=${expanded}`);
    if (el.getAttribute("aria-selected") === "true") parts.push("selected");
    if (el.getAttribute("aria-checked")) parts.push(`checked=${el.getAttribute("aria-checked")}`);
    if (clickable && role) parts.push("clickable");
    if (!inViewport(el, this.env.window())) parts.push("(off-screen)");
    return parts.join(" ");
  }

  // why: An element whose match lies in one of its children is not a separate hit.
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
      for (const child of shownChildren(el)) {
        if (child.nodeType === 3 && showsText(el, child)) {
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
          inner = NAME_FROM_CONTENT.has(roleOf(child)) || !isControl(child) ? allText(child) : "";
          const raw = normalize(inner);
          // why: The name may be a label or cut off, and textContent joins lines and includes what isn't shown.
          if (words.some((w) => raw.includes(w))) inner = clean(shownText(child));
          if (holds(inner)) {
            found.push({ el: child, text: inner });
            inner = null;
          }
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
    const add = (el, text, share, named, details) => {
      // why: Prefer an actionable element to a surrounding node with the same name, and a real control to a guessed one.
      const kind = isControl(el) ? 3 : details.clickable ? 2 : named ? 1 : 0;
      // why: Scores of a frame are compared with those of others, so a full match must beat any partial one by itself.
      let score = share === 1 ? FULL_MATCH + kind : share + kind / 6;
      if (normalize(text) === normalize(query)) score += 0.4;
      // why: Check whole names so package.json does not match package-lock.json.
      else if (normalize(text).includes(normalize(query))) score += 0.2;
      if (inViewport(el, win)) score += 0.1;
      if (score > (results.get(el)?.score ?? 0)) results.set(el, { el, score, ...details });
    };
    const all = doc.body ? shownElements(doc.body) : [];
    for (const el of all) {
      if (el.ownerSVGElement) continue;
      const role = roleOf(el);
      const clickable = this.#clickable(el);
      if ((!role && !clickable) || !isVisible(el)) continue;
      if (isSkipped(el, clickable)) continue;
      const { name } = this.#name(el, clickable, clickable || undefined);
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
      if (hits) add(el, name, hits / words.length, !!name, { clickable, nameFromContent: clickable || undefined });
    }
    for (const { el, text } of this.#textMatches(words))
      add(el, text, 1, false, { clickable: this.#clickable(el), nameFromContent: true });
    return [...results.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map(({ el, score, clickable, nameFromContent }) => ({
        line: this.describeElement(el, roleOf(el), { clickable, nameFromContent }),
        score,
      }));
  }

  #matching(selector) {
    const doc = this.env.document();
    const { documentElement } = doc;
    if (!documentElement || !crossesTrees(documentElement)) return [...doc.querySelectorAll(selector)];
    const shown = [documentElement, ...shownElements(documentElement)];
    // why: A query of the root gives :scope its meaning, which matches() can't.
    const matches = new Set(
      [...new Set(shown.map((el) => el.getRootNode()))].flatMap((root) => [...root.querySelectorAll(selector)]),
    );
    return shown.filter((el) => matches.has(el));
  }

  check({ text, selector }) {
    const doc = this.env.document();
    const has = (el) => !text || normalize(pageText(el)).includes(normalize(text));
    if (selector) return this.#matching(selector).some((el) => isVisible(el) && has(el));
    return !!doc.body && has(doc.body);
  }

  sample({ selector }) {
    const el = this.#matching(selector).find((el) => isVisible(el));
    return el ? truncate(clean(shownText(el)), 500) : null;
  }

  risk({ ref, x, y, focused = false, enter = false, space = false }) {
    const doc = this.env.document();
    const el = focused ? deepActiveElement(doc) : ref ? this.env.element(ref) : hitAt(doc, x, y);
    if (!focused) return { submit: submitsForm(el), secret: isSecretField(el) };
    const textField =
      el?.localName === "input" &&
      !["button", "submit", "reset", "image", "checkbox", "radio", "file"].includes(el.type);
    return {
      submit: ((enter || space) && submitsForm(el)) || (enter && textField && !!el.form),
      secret: isSecretField(el),
    };
  }

  // why: A click that lands beside its target otherwise looks exactly like one that hit it.
  describeHit(el, expected) {
    this.#startRead();
    let listens = false;
    for (let up = el; up && tagOf(up) !== "BODY" && tagOf(up) !== "HTML"; up = composedParent(up)) {
      if (up.nodeType !== 1) break;
      const target = tagOf(up) === "LABEL" && up.control ? up.control : up;
      const clickable = !isControl(target) && this.#clickable(target);
      if (!clickable && !isControl(target)) {
        listens ||= NATIVELY_CLICKABLE.has(tagOf(up)) || this.#listens(up);
        continue;
      }
      const role = roleOf(target) || "clickable";
      const { name, mark } = this.#name(target, clickable, clickable || undefined);
      const shown = name
        ? `"${truncate(name, MAX_HIT_NAME).replaceAll('"', "'")}"${mark && ` ${mark}`}`
        : elementLabel(target);
      return `${role} ${shown}${target === expected ? "" : ` [${this.env.ref(target)}]`}`;
    }
    return `${elementLabel(el)}${listens ? "" : " (no click handler detected)"}`;
  }

  describeTarget({ ref, x, y }) {
    const doc = this.env.document();
    const el = ref ? this.env.element(ref) : hitAt(doc, x, y);
    if (!el) return this.env.L("an empty spot", "boş bir yer");
    const role = roleOf(el) || el.localName;
    const name = accessibleName(el) || truncate(clean(el.innerText ?? ""), 40);
    return name ? `${role} "${truncate(name, 60)}"` : role;
  }
}
