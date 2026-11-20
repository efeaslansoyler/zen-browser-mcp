// Source locations for picked elements: turns the raw hints the picker collects (stack
// strings, framework metadata) into project files and lines through the page's source maps.
//
// It fetches only from the picked page's origin (including Next.js's dev source map endpoint for
// server components) and only when the site rules allow that host.
// Anything missing, failing or slower than the budget makes the result "unknown".
// env: { fetchText(url): Promise<string>, siteAllowed(host), sleep(ms), budgetMs }

const SNIPPET_BEFORE = 3;
const SNIPPET_AFTER = 4;
const MAX_COMPONENTS = 3;

// One resolver per hint kind; each returns a location or null.
const FRAMEWORKS = [["react19", resolveReact19]];

export class SourceResolver {
  #maps = new WeakMap(); // document → Map(script URL → Promise<parsed map | null>)

  constructor(env) {
    this.env = env;
  }

  // → "unknown" or { framework, precision, chain: [{ role, name?, file, original, line, column }], snippet }
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
    const work = (async () => {
      for (const [key, resolveHints] of FRAMEWORKS) {
        if (!hints?.[key]) continue;
        const location = await resolveHints(hints[key], context);
        if (location) return location;
      }
      return "unknown";
    })().catch(() => "unknown");
    return Promise.race([work, this.env.sleep(this.env.budgetMs).then(() => "unknown")]);
  }

  // A generated stack frame → its original position, or null.
  async #mapFrame({ url, line, column }, origin, maps) {
    // React's stand-in for a server component frame: the server file at its own position.
    const server = /^(?:rsc|about):\/\/React\/[^/]+\/(.+)\?\d+$/.exec(url);
    let script;
    try {
      script = server ? null : new URL(url);
    } catch {
      return null;
    }
    if (script && script.origin !== origin) return null;
    const key = script?.href ?? url;
    if (!maps.has(key))
      maps.set(
        key,
        (server ? this.#loadServerMap(decodeURI(server[1]), origin) : this.#loadMap(script, origin)).catch(() => null),
      );
    const map = await maps.get(key);
    const found = map && originalPosition(map, line - 1, column - 1);
    if (!found) return null;
    const { section, position } = found;
    const original =
      (section.sourceRoot ? section.sourceRoot.replace(/\/?$/, "/") : "") + section.sources[position.source];
    return {
      file: projectPath(original, section.url, script),
      original,
      line: position.line + 1,
      column: position.column + 1,
      content: section.sourcesContent?.[position.source] ?? null,
      next: Boolean(server) || script.pathname.startsWith("/_next/"),
    };
  }

  async #loadMap(script, origin) {
    const text = await this.env.fetchText(script.href);
    const comment = [...text.matchAll(/[#@]\s*sourceMappingURL=(\S+)/g)].at(-1)?.[1];
    if (!comment) return null;
    const url = new URL(comment, script);
    let json;
    if (url.protocol === "data:") json = decodeDataURL(url.href);
    else if (url.origin === origin) json = await this.env.fetchText(url.href);
    else return null;
    return parseMap(json, url.protocol === "data:" ? script.href : url.href);
  }

  // Next.js dev servers serve server bundle maps at /__nextjs_source-map?filename=… (the URL its own
  // findSourceMapURL gives React).
  async #loadServerMap(filename, origin) {
    const url = new URL("/__nextjs_source-map", origin);
    url.searchParams.set("filename", filename);
    return parseMap(await this.env.fetchText(url.href), url.href);
  }
}

// A source map, or an index map of sections (Turbopack), as sections with decoded mappings.
function parseMap(json, url) {
  const map = JSON.parse(json);
  const parts = Array.isArray(map?.sections) ? map.sections : [{ offset: { line: 0, column: 0 }, map }];
  const sections = [];
  for (const { offset, map: part } of parts) {
    if (!part?.mappings || !Array.isArray(part.sources)) continue;
    sections.push({
      line: offset?.line ?? 0,
      column: offset?.column ?? 0,
      url,
      sourceRoot: part.sourceRoot || "",
      sources: part.sources,
      sourcesContent: part.sourcesContent,
      lines: decodeMappings(part.mappings),
    });
  }
  return sections.length ? sections : null;
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
    framework: chain.some((link) => link.next) ? "Next.js" : "React",
    precision: "element",
    chain: chain.map(({ content, next, ...link }) => link),
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
// Dev servers serve project files at their project path (Vite: /src/App.tsx); bundlers name them
// turbopack:///[project]/app/page.tsx or webpack://_N_E/./app/page.tsx.
function projectPath(original, mapUrl, script) {
  const bundled =
    /^(?:turbopack:\/\/\/\[project\]\/|webpack:\/\/[^/]*\/\.\/|webpack-internal:\/\/\/(?:\([^)]*\)\/)?\.\/)(.+)$/.exec(
      original,
    );
  if (bundled) return bundled[1];
  if (!script) return original;
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

// Sections are sorted; the last one starting at or before the position holds it.
function originalPosition(sections, line, column) {
  const section = sections.findLast((s) => s.line < line || (s.line === line && s.column <= column));
  if (!section) return null;
  if (line === section.line) column -= section.column;
  let found = null;
  for (const segment of section.lines[line - section.line] ?? []) {
    if (segment[0] > column) break;
    found = segment;
  }
  return found && { section, position: { source: found[1], line: found[2], column: found[3] } };
}
