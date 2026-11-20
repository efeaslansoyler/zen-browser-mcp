// Details about an element or page value for agents: a short unique selector, the computed
// styles that matter for design fixes, the React/Vue component chain, and readable forms of
// console arguments and evaluated values. unwrap is Cu.waiveXrays: page objects are read
// without Xrays.

// Owner stacks: enough frames to reach React's bottom frame; library owners are skipped later.
const MAX_STACK = 4000;
const MAX_OWNERS = 12;

const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// React/Next.js internals: noise in a component chain
const FRAMEWORK_COMPONENTS = new Set([
  "InnerLayoutRouter",
  "OuterLayoutRouter",
  "RedirectBoundary",
  "RedirectErrorBoundary",
  "NotFoundBoundary",
  "NotFoundErrorBoundary",
  "HTTPAccessFallbackBoundary",
  "HTTPAccessFallbackErrorBoundary",
  "LoadingBoundary",
  "ErrorBoundary",
  "ErrorBoundaryHandler",
  "ScrollAndFocusHandler",
  "InnerScrollAndFocusHandler",
  "RenderFromTemplateContext",
  "AppRouter",
  "Router",
  "HotReload",
  "ReactDevOverlay",
  "ServerRoot",
  "Root",
  "AppContainer",
  "SegmentViewNode",
  "SegmentStateProvider",
  "LinkComponent",
  "Suspense",
  "Fragment",
]);

// A short selector matching one element: stops at a unique ID or once the path is unique.
export function cssPath(el, win) {
  const doc = el.ownerDocument;
  const esc = (s) => win.CSS.escape(s);
  const unique = (sel) => {
    try {
      return doc.querySelectorAll(sel).length === 1;
    } catch {
      return false;
    }
  };
  const parts = [];
  for (let node = el; node?.nodeType === 1 && node !== doc.documentElement; node = node.parentElement) {
    if (node.id && unique(`#${esc(node.id)}`)) {
      parts.unshift(`#${esc(node.id)}`);
      break;
    }
    let part = node.localName;
    // Utility classes (md:flex, w-[20px]) make selectors long; take the first two plain ones.
    const classes = [...node.classList].filter((c) => /^[a-zA-Z_-][\w-]*$/.test(c)).slice(0, 2);
    part += classes.map((c) => "." + esc(c)).join("");
    const same = node.parentElement
      ? [...node.parentElement.children].filter((c) => c.localName === node.localName)
      : [];
    if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
    parts.unshift(part);
    if (unique(parts.join(" > "))) break;
  }
  return parts.join(" > ");
}

// Computed styles that matter for a design fix; default values are left out.
export function pickStyles(el, win) {
  const s = win.getComputedStyle(el);
  const out = { display: s.display };
  if (s.position !== "static") out.position = s.position;
  out.font = `${s.fontWeight} ${s.fontSize}/${s.lineHeight} ${s.fontFamily.split(",")[0].trim()}`;
  out.color = s.color;
  if (s.backgroundColor !== "rgba(0, 0, 0, 0)") out.background = s.backgroundColor;
  if (s.backgroundImage !== "none") out["background-image"] = truncate(s.backgroundImage, 200);
  if (s.padding && s.padding !== "0px") out.padding = s.padding;
  if (s.margin && s.margin !== "0px") out.margin = s.margin;
  if (
    parseFloat(s.borderTopWidth) ||
    parseFloat(s.borderRightWidth) ||
    parseFloat(s.borderBottomWidth) ||
    parseFloat(s.borderLeftWidth)
  ) {
    out.border = s.border || `${s.borderWidth} ${s.borderStyle} ${s.borderColor}`;
  }
  if (s.borderRadius && s.borderRadius !== "0px") out["border-radius"] = s.borderRadius;
  if (/flex|grid/.test(s.display)) {
    if (s.display.includes("flex")) out["flex-direction"] = s.flexDirection;
    if (s.display.includes("grid")) out["grid-template-columns"] = truncate(s.gridTemplateColumns, 120);
    out["justify-content"] = s.justifyContent;
    out["align-items"] = s.alignItems;
    if (s.gap && s.gap !== "normal") out.gap = s.gap;
  }
  if (s.opacity !== "1") out.opacity = s.opacity;
  // Tailwind puts transparent ring/shadow layers on every element; keep only visible ones.
  const shadows = splitTopLevel(s.boxShadow).filter(
    (l) => l !== "none" && !/rgba\([^)]*,\s*0\)|\/\s*0\)|transparent/.test(l),
  );
  if (shadows.length) out["box-shadow"] = truncate(shadows.join(", "), 160);
  return out;
}

// A comma-separated CSS list, without splitting at commas inside parentheses.
function splitTopLevel(value) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "(") depth++;
    else if (value[i] === ")") depth--;
    else if (value[i] === "," && !depth) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

// Production builds minify names ("_", "y", "Oe"); skip them rather than mislead.
const isMinified = (name) => name.length <= 2;
// Next.js internal boundaries such as __next_root_layout_boundary__
const isInternal = (name) => /^__.*__$/.test(name);

// The component chain of a development React (fiber) or Vue build, outermost first: enough to
// find the right file in the repo.
export function componentChain(el, unwrap) {
  try {
    const raw = unwrap(el);
    const key = fiberKey(raw);
    if (key) {
      const names = [];
      for (let fiber = raw[key]; fiber && names.length < 8; fiber = fiber.return) {
        const type = fiber.type;
        if (!type || typeof type === "string") continue;
        const name = componentName(type);
        if (
          typeof name === "string" &&
          name &&
          !isMinified(name) &&
          !isInternal(name) &&
          !FRAMEWORK_COMPONENTS.has(name) &&
          names.at(-1) !== name
        )
          names.push(name);
      }
      return names.length ? { framework: "React", chain: names.reverse() } : null;
    }
    // A Vue 3 development build also records the component's file.
    let instance = raw.__vueParentComponent;
    if (instance) {
      const names = [];
      let file = null;
      for (; instance && names.length < 8; instance = instance.parent) {
        const type = instance.type;
        const name = type?.__name || type?.name;
        if (typeof name === "string" && name && !isMinified(name)) names.push(name);
        if (!file && typeof type?.__file === "string") file = type.__file;
      }
      return names.length ? { framework: "Vue", chain: names.reverse(), file } : null;
    }
  } catch {}
  return null;
}

const componentName = (type) =>
  type.displayName ||
  type.name ||
  type.render?.displayName ||
  type.render?.name ||
  type.type?.displayName ||
  type.type?.name;

const fiberKey = (raw) =>
  Object.keys(raw).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));

// Unresolved hints for the source resolver, one per stack whose dev build left metadata on the
// element. Page values are copied into plain strings and numbers.
export function sourceHints(el, unwrap, win) {
  const hints = {};
  for (const [key, collect] of HINTS) {
    try {
      const hint = collect(el, unwrap, win);
      if (hint) hints[key] = hint;
    } catch {}
  }
  return Object.keys(hints).length ? hints : null;
}

const MAX_PATH = 500;
const text = (value) => (typeof value === "string" && value ? truncate(value, MAX_PATH) : null);
const number = (value) => (Number.isFinite(value) ? value : null);
const ownerName = (fiber) => {
  const name = fiber.type && typeof fiber.type !== "string" ? componentName(fiber.type) : null;
  return typeof name === "string" && name ? name : null;
};

// React 19 keeps the JSX call site of every element and owner component in _debugStack (an
// Error); the parent maps these stacks through source maps.
function react19Hints(el, unwrap) {
  const raw = unwrap(el);
  const key = fiberKey(raw);
  // Server components (React Server Components payload) own elements as ReactComponentInfo:
  // { name, env, owner, debugStack } instead of a fiber.
  const stackOf = (owner) => {
    const stack = (owner?._debugStack ?? owner?.debugStack)?.stack;
    return typeof stack === "string" ? truncate(stack, MAX_STACK) : null;
  };
  const element = key && stackOf(raw[key]);
  if (!element) return null;
  const owners = [];
  for (
    let owner = raw[key]._debugOwner;
    owner && owners.length < MAX_OWNERS;
    owner = owner.type !== undefined ? owner._debugOwner : owner.owner
  ) {
    const stack = stackOf(owner);
    const name = owner.type === undefined ? text(owner.name) : ownerName(owner);
    if (stack && name) owners.push({ name, stack });
  }
  return { element, owners };
}

// React 18 (with Babel's JSX source transform) records each element's JSX position in _debugSource.
function react18Hints(el, unwrap) {
  const raw = unwrap(el);
  const key = fiberKey(raw);
  const sourceOf = (fiber) => {
    const source = fiber?._debugSource;
    const fileName = text(source?.fileName);
    return fileName
      ? { fileName, lineNumber: number(source.lineNumber), columnNumber: number(source.columnNumber) }
      : null;
  };
  const element = key && sourceOf(raw[key]);
  if (!element) return null;
  const owners = [];
  for (let owner = raw[key]._debugOwner; owner && owners.length < MAX_OWNERS; owner = owner._debugOwner) {
    const source = sourceOf(owner);
    const name = ownerName(owner);
    if (source && name) owners.push({ name, source });
  }
  return { element, owners };
}

// Svelte 5 dev builds: __svelte_meta.loc is the element's position (column zero-based); its
// parent entries include the places where the enclosing components were rendered.
function svelteHints(el, unwrap) {
  const meta = unwrap(el).__svelte_meta;
  const file = text(meta?.loc?.file);
  if (!file) return null;
  const parents = [];
  for (let entry = meta.parent; entry && parents.length < MAX_OWNERS; entry = entry.parent) {
    const parentFile = text(entry.file);
    if (entry.type === "component" && parentFile)
      parents.push({
        name: text(entry.componentTag),
        file: parentFile,
        line: number(entry.line),
        column: number(entry.column),
      });
  }
  return { element: { file, line: number(meta.loc.line), column: number(meta.loc.column) }, parents };
}

// Astro's dev server annotates elements with their .astro file and "line:column", and its dev
// toolbar removes the attributes soon after load, so the actor records them at DOMContentLoaded.
const ASTRO_FILE = "data-astro-source-file";
const ASTRO_LOC = "data-astro-source-loc";
const astroSources = new WeakMap();

export function rememberSourceAttributes(doc) {
  for (const el of doc.querySelectorAll(`[${ASTRO_FILE}]`))
    astroSources.set(el, { file: text(el.getAttribute(ASTRO_FILE)), loc: text(el.getAttribute(ASTRO_LOC)) });
}

function astroHints(el) {
  const file = text(el.getAttribute(ASTRO_FILE));
  return file ? { file, loc: text(el.getAttribute(ASTRO_LOC)) } : (astroSources.get(el) ?? null);
}

// A Vue 3 dev build records each component's file (no line), nearest component first.
function vueHints(el, unwrap) {
  const components = [];
  for (
    let instance = unwrap(el).__vueParentComponent;
    instance && components.length < MAX_OWNERS;
    instance = instance.parent
  ) {
    const file = text(instance.type?.__file);
    if (file) components.push({ name: text(instance.type.__name || instance.type.name), file });
  }
  return components.length ? { components } : null;
}

// Angular dev mode: the global ng helpers find the element's component, whose definition
// carries the class's debug info (file and line of the class).
function angularHints(el, unwrap, win) {
  const ng = win && unwrap(win).ng;
  if (!ng) return null;
  const raw = unwrap(el);
  const component = ng.getComponent?.(raw) ?? ng.getOwningComponent?.(raw);
  const info = component?.constructor?.["ɵcmp"]?.debugInfo;
  const file = text(info?.filePath);
  return file ? { name: text(info.className), file, line: number(info.lineNumber) } : null;
}

const HINTS = [
  ["react19", react19Hints],
  ["react18", react18Hints],
  ["svelte", svelteHints],
  ["astro", astroHints],
  ["vue", vueHints],
  ["angular", angularHints],
];

// Matched author CSS rules for the source resolver, most specific first. Gecko lists them in
// cascade order; user-agent and user sheets are left out. A <style> keeps only its source map
// comment (Vite's css.devSourcemap), not its text.
const MAX_CSS_RULES = 8;
const MAX_CSS_MAP = 4e6;
export function cssHints(el, inspector) {
  if (!inspector) return null;
  try {
    const all = (inspector.getMatchingCSSRules ?? inspector.getCSSStyleRules)(el);
    const sheets = [],
      index = new Map(),
      rules = [];
    for (let i = all.length - 1; i >= 0 && rules.length < MAX_CSS_RULES; i--) {
      const rule = all[i];
      const sheet = rule.parentStyleSheet;
      if (sheet?.parsingMode !== "author") continue;
      if (!index.has(sheet)) index.set(sheet, sheets.push(sheetHint(sheet)) - 1);
      rules.push({
        sheet: index.get(sheet),
        selector: truncate(String(rule.selectorText ?? ""), 200),
        line: inspector.getRelativeRuleLine(rule),
        column: inspector.getRuleColumn(rule),
      });
    }
    return rules.length ? { sheets, rules } : null;
  } catch {}
  return null;
}

function sheetHint(sheet) {
  if (sheet.href) return { kind: "link", href: sheet.href };
  const owner = sheet.ownerNode;
  if (!owner) return { kind: "constructed" };
  const devId = owner.getAttribute?.("data-vite-dev-id") || null;
  const css = String(owner.textContent ?? "");
  // CSS-in-JS libraries insert rules into an empty <style> through the CSSOM
  if (!css.trim()) return { kind: "script", devId };
  const map = [...css.matchAll(/\/\*[#@]\s*sourceMappingURL=(\S+?)\s*\*\//g)].at(-1)?.[1];
  return { kind: "style", devId, map: map && map.length <= MAX_CSS_MAP ? map : null };
}

// A console.* argument is a page object: try JSON without Xrays, fall back to String.
export function formatArg(arg, unwrap) {
  if (typeof arg === "string") return arg;
  try {
    const raw = unwrap(arg);
    if (raw && typeof raw === "object") {
      if ("stack" in raw && "message" in raw) return `${raw.name ?? "Error"}: ${raw.message}`;
      const json = JSON.stringify(raw);
      if (json !== undefined) return truncate(json, 500);
    }
    return String(raw);
  } catch {
    return String(arg);
  }
}

// The result of javascript_tool as text.
export function describe(value) {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "nodeType" in value) {
    return value.outerHTML ?? value.textContent ?? String(value);
  }
  try {
    const json = JSON.stringify(value, null, 2);
    if (json !== undefined) return json;
  } catch {}
  return String(value);
}
