// Source locations for picked elements: turns the raw hints the picker collects (stack
// strings, framework metadata) into project files and lines through the page's source maps.
//
// It fetches only from the picked page's origin and only when the site rules allow that host.
// Anything missing, failing or slower than the budget makes the result "unknown".
// env: { fetchText(url): Promise<string>, siteAllowed(host), sleep(ms), budgetMs }

const SNIPPET_BEFORE = 3;
const SNIPPET_AFTER = 4;
const MAX_COMPONENTS = 3;
const MAX_CSS_RULES = 8;

// One resolver per hint kind; each returns a location or null.
const FRAMEWORKS = [["react19", resolveReact19]];

export class SourceResolver {
  #maps = new WeakMap(); // document → Map(script URL → Promise<parsed map | null>)

  constructor(env) {
    this.env = env;
  }

  // → "unknown" or { framework, precision, chain: [{ role, name?, file, original, line, column }], snippet,
  //   cssRules? }; with CSS rules but no element location, just { cssRules }.
  async resolve(hints, { pageUrl, document }) {
    let page;
    try {
      page = new URL(pageUrl);
    } catch {
      return "unknown";
    }
    if (!/^https?:$/.test(page.protocol) || !this.env.siteAllowed(page.hostname)) return "unknown";
    let maps = this.#maps.get(document);
    if (!maps) this.#maps.set(document, (maps = new Map()));
    const context = { origin: page.origin, mapFrame: (frame) => this.#mapFrame(frame, page.origin, maps) };
    const located = (async () => {
      for (const [key, resolveHints] of FRAMEWORKS) {
        if (!hints?.[key]) continue;
        const location = await resolveHints(hints[key], context);
        if (location) return location;
      }
      return "unknown";
    })().catch(() => "unknown");
    const work = Promise.all([located, hints?.css ? this.#cssRules(hints.css, page, maps) : []]).then(
      ([location, cssRules]) => {
        if (!cssRules.length) return location;
        return location === "unknown" ? { cssRules } : { ...location, cssRules };
      },
    );
    return Promise.race([work, this.env.sleep(this.env.budgetMs).then(() => "unknown")]);
  }

  // A generated stack frame → its original position, or null.
  async #mapFrame({ url, line, column }, origin, maps) {
    let script;
    try {
      script = new URL(url);
    } catch {
      return null;
    }
    if (script.origin !== origin) return null;
    const { map, position } = await this.#lookup(maps, script.href, () => this.#loadMap(script, origin), line, column);
    if (!position) return null;
    const original = sourcePath(map, position);
    return {
      file: projectPath(original, map.url, script),
      original,
      line: position.line + 1,
      column: position.column + 1,
      content: map.sourcesContent?.[position.source] ?? null,
    };
  }

  // A cached map and the original position of a 1-based generated line and column.
  async #lookup(maps, key, load, line, column) {
    if (!maps.has(key))
      maps.set(
        key,
        load().catch(() => null),
      );
    const map = await maps.get(key);
    return { map, position: map && originalPosition(map, line - 1, Math.max(0, column - 1)) };
  }

  async #loadMap(script, origin) {
    const text = await this.env.fetchText(script.href);
    const comment = [...text.matchAll(/[#@]\s*sourceMappingURL=(\S+)/g)].at(-1)?.[1];
    if (!comment) return null;
    return this.#parseMap(new URL(comment, script), script, origin);
  }

  async #parseMap(url, script, origin) {
    let json;
    if (url.protocol === "data:") json = decodeDataURL(url.href);
    else if (url.origin === origin) json = await this.env.fetchText(url.href);
    else return null;
    const map = JSON.parse(json);
    if (!map?.mappings || !Array.isArray(map.sources)) return null;
    return {
      url: url.protocol === "data:" ? script?.href : url.href,
      sourceRoot: map.sourceRoot || "",
      sources: map.sources,
      sourcesContent: map.sourcesContent,
      lines: decodeMappings(map.mappings),
    };
  }

  // Each matched rule's file and line. Lines inside an injected <style> are only a place in the
  // project after a CSS source map maps them; rules made by script have no place at all.
  #cssRules({ sheets = [], rules = [] }, page, maps) {
    return Promise.all(
      rules.slice(0, MAX_CSS_RULES).map(async ({ sheet: index, selector, line, column }) => {
        const sheet = sheets[index] ?? {};
        if (sheet.kind === "link") {
          const position = await this.#mapFrame({ url: sheet.href, line, column }, page.origin, maps).catch(() => null);
          if (position)
            return { selector, kind: "file", file: position.file, original: position.original, line: position.line };
          return { selector, kind: "file", file: servedFile(sheet.href, page), line };
        }
        if (sheet.kind !== "style") return { selector, kind: "script" };
        const mapped = sheet.map && (await this.#mapStyle(sheet, line, column, page, maps).catch(() => null));
        if (mapped) return { selector, kind: "file", ...mapped };
        if (sheet.devId) return { selector, kind: "unmapped", file: sheet.devId, line };
        return { selector, kind: "inline", line };
      }),
    );
  }

  // A <style>'s own map: inline (Vite) or a same-origin URL relative to the page. Relative
  // sources sit next to the style's dev file.
  async #mapStyle({ map: comment, devId }, line, column, page, maps) {
    const url = new URL(comment, page);
    if (url.protocol !== "data:" && url.origin !== page.origin) return null;
    const { map, position } = await this.#lookup(
      maps,
      url.href,
      () => this.#parseMap(url, null, page.origin),
      line,
      column,
    );
    if (!position) return null;
    const original = sourcePath(map, position);
    let file = original;
    if (original.startsWith("file://")) file = decodeURIComponent(new URL(original).pathname);
    else if (devId && !/^([a-z]+:|\/)/i.test(original))
      file = decodeURIComponent(new URL(original, `file:///${devId.replace(/^\//, "")}`).pathname).replace(
        /^\/(?=[a-zA-Z]:)/,
        "",
      );
    return { file, original, line: position.line + 1 };
  }
}

const sourcePath = (map, position) =>
  (map.sourceRoot ? map.sourceRoot.replace(/\/?$/, "/") : "") + map.sources[position.source];

// A stylesheet without a map: its served path on the page's origin, else its URL.
function servedFile(href, page) {
  const url = new URL(href);
  return url.origin === page.origin ? decodeURIComponent(url.pathname).slice(1) : href;
}

// React 19 owner stacks: the element's JSX call site, then where each owner component was
// rendered. Only the frames above React's bottom frame belong to the owner stack.
async function resolveReact19({ element, owners = [] }, { mapFrame }) {
  const own = await userFrame(element, mapFrame);
  if (!own) return null;
  const chain = [{ role: "element", ...own }];
  for (const owner of owners) {
    if (chain.length > MAX_COMPONENTS) break;
    const site = await userFrame(owner.stack, mapFrame);
    if (site) chain.push({ role: "component", name: owner.name, ...site });
  }
  return {
    framework: "React",
    precision: "element",
    chain: chain.map(({ content, ...link }) => link),
    snippet: snippet(own),
  };
}

// The first frame outside node_modules, mapped to the original source.
async function userFrame(stack, mapFrame) {
  for (const frame of parseStack(stack)) {
    if (isLibrary(frame.url)) continue;
    const position = await mapFrame(frame);
    if (position && !isLibrary(position.original)) return position;
  }
  return null;
}

const isLibrary = (path) => /(^|[/\\])node_modules[/\\]/.test(path);

// Gecko's Error.stack: one "name@url:line:column" per line.
function parseStack(stack) {
  const frames = [];
  for (const text of String(stack ?? "").split("\n")) {
    const match = /^(.*?)@(.+):(\d+):(\d+)$/.exec(text.trim());
    if (!match) continue;
    if (/react[-_]stack[-_]bottom[-_]frame/.test(match[1])) break;
    frames.push({ url: match[2], line: Number(match[3]), column: Number(match[4]) });
  }
  return frames;
}

function snippet({ file, line, content }) {
  if (typeof content !== "string") return null;
  const lines = content.split(/\r?\n/);
  if (line > lines.length) return null;
  const start = Math.max(1, line - SNIPPET_BEFORE);
  return { file, line, start, lines: lines.slice(start - 1, line + SNIPPET_AFTER) };
}

// A path the agent can open from the project root when the map reveals one, else the original.
// Dev servers serve project files at their project path (Vite: /src/App.tsx).
function projectPath(original, mapUrl, script) {
  const served = decodeURIComponent(script.pathname);
  const absolute = original.startsWith("file://") ? decodeURIComponent(new URL(original).pathname) : original;
  if (absolute.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(absolute)) {
    const normalized = absolute.replaceAll("\\", "/");
    return normalized.endsWith(served) && served.length > 1 ? served.slice(1) : absolute;
  }
  let url;
  try {
    url = new URL(original, mapUrl);
  } catch {
    return original;
  }
  if (url.origin !== script.origin) return original;
  const path = decodeURIComponent(url.pathname);
  return path.startsWith("/@fs/") ? path.slice(4) : path.slice(1);
}

function decodeDataURL(href) {
  const comma = href.indexOf(",");
  const header = href.slice(5, comma);
  const body = href.slice(comma + 1);
  if (!/;base64$/i.test(header)) return decodeURIComponent(body);
  const bytes = [];
  let value = 0,
    bits = 0;
  for (const c of body) {
    const digit = BASE64.get(c);
    if (digit === undefined) continue; // padding
    value = ((value << 6) | digit) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 255);
    }
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

const BASE64 = new Map([..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"].map((c, i) => [c, i]));

// Source map v3 "mappings" → per generated line, segments of
// [generatedColumn, sourceIndex, originalLine, originalColumn] (absolute, zero-based).
function decodeMappings(mappings) {
  const lines = [];
  let source = 0,
    line = 0,
    column = 0;
  for (const text of mappings.split(";")) {
    const segments = [];
    let generated = 0;
    for (const part of text.split(",")) {
      if (!part) continue;
      const values = [];
      let value = 0,
        shift = 0;
      for (const c of part) {
        const digit = BASE64.get(c);
        if (digit === undefined) throw new Error("Invalid source map mappings");
        value += (digit & 31) << shift;
        if (digit & 32) shift += 5;
        else {
          values.push(value & 1 ? -(value >>> 1) : value >>> 1);
          value = shift = 0;
        }
      }
      generated += values[0];
      if (values.length < 4) continue;
      source += values[1];
      line += values[2];
      column += values[3];
      segments.push([generated, source, line, column]);
    }
    lines.push(segments);
  }
  return lines;
}

function originalPosition(map, line, column) {
  let found = null;
  for (const segment of map.lines[line] ?? []) {
    if (segment[0] > column) break;
    found = segment;
  }
  return found && { source: found[1], line: found[2], column: found[3] };
}
