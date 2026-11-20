// why: Source maps cannot trigger cross-origin or site-blocked fetches.
// why: A bounded deadline prevents source resolution from blocking the pick indefinitely.

const SNIPPET_BEFORE = 3;
const SNIPPET_AFTER = 4;
const MAX_COMPONENTS = 3;

const FRAMEWORKS = [
  ["react19", resolveReact19],
  ["react18", resolveReact18],
  ["svelte", resolveSvelte],
  ["astro", resolveAstro],
  ["vue", resolveVue],
  ["angular", resolveAngular],
];

export class SourceResolver {
  #maps = new WeakMap();

  constructor(env) {
    this.env = env;
  }

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

  async #mapFrame({ url, line, column }, origin, maps) {
    const server = url.startsWith("webpack-internal:///")
      ? url
      : /^(?:rsc|about):\/\/React\/[^/]+\/(.+)\?\d+$/.exec(url)?.[1];
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
        (server ? this.#loadServerMap(decodeURI(server), origin) : this.#loadMap(script, origin)).catch(() => null),
      );
    const map = await maps.get(key);
    const found = map && originalPosition(map, line - 1, column - 1);
    if (!found) return null;
    const { section, position } = found;
    const original = sourcePath(section, position);
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
    const comment = [...text.matchAll(/[#@]\s*sourceMappingURL=(\S+?)(?=\*\/|\s|$)/g)].at(-1)?.[1];
    if (!comment) return null;
    return this.#parseMap(new URL(comment, script), script, origin);
  }

  async #parseMap(url, script, origin) {
    let json;
    if (url.protocol === "data:") json = decodeDataURL(url.href);
    else if (url.origin === origin) json = await this.env.fetchText(url.href);
    else return null;
    return parseMap(json, url.protocol === "data:" ? script?.href : url.href);
  }

  async #loadServerMap(filename, origin) {
    const url = new URL("/__nextjs_source-map", origin);
    url.searchParams.set("filename", filename);
    return parseMap(await this.env.fetchText(url.href), url.href);
  }

  // why: Generated inline CSS only identifies a project position after source-map resolution.
  #cssRules({ sheets = [], rules = [] }, page, maps) {
    return Promise.all(
      rules.map(async ({ sheet: index, selector, line, column }) => {
        const sheet = sheets[index] ?? {};
        if (sheet.kind === "link") {
          const frame = { url: sheet.href, line, column: Math.max(1, column) };
          const position = await this.#mapFrame(frame, page.origin, maps).catch(() => null);
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

  async #mapStyle({ map: comment, devId }, line, column, page, maps) {
    const url = new URL(comment, page);
    if (url.protocol !== "data:" && url.origin !== page.origin) return null;
    if (!maps.has(url.href))
      maps.set(
        url.href,
        this.#parseMap(url, null, page.origin).catch(() => null),
      );
    const map = await maps.get(url.href);
    const found = map && originalPosition(map, line - 1, Math.max(0, column - 1));
    if (!found) return null;
    const { section, position } = found;
    const original = sourcePath(section, position);
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

const sourcePath = ({ sourceRoot, sources }, { source }) =>
  (sourceRoot ? sourceRoot.replace(/\/?$/, "/") : "") + sources[source];

function servedFile(href, page) {
  const url = new URL(href);
  return url.origin === page.origin ? decodeURIComponent(url.pathname).slice(1) : href;
}

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

function resolveReact18({ element, owners = [] }) {
  const place = (source) => userPlace(source?.fileName, source?.lineNumber, source?.columnNumber);
  return elementChain(
    "React",
    place(element),
    owners.map((owner) => ({ name: owner.name, ...place(owner.source) })),
  );
}

function resolveSvelte({ element, parents = [] }) {
  const place = (loc) => userPlace(loc?.file, loc?.line, Number.isInteger(loc?.column) ? loc.column + 1 : null);
  return elementChain(
    "Svelte",
    place(element),
    parents.map((parent) => ({ name: parent.name, ...place(parent) })),
  );
}

function resolveAstro({ file, loc }) {
  return elementChain("Astro", userPlace(file, Number(String(loc ?? "").split(":")[0])), []);
}

function resolveVue({ components = [] }) {
  for (const { name, file } of components) {
    const place = userPlace(file);
    if (place) return componentDefinition("Vue", name, place);
  }
  return null;
}

function resolveAngular({ name, file, line }) {
  const place = userPlace(file, line);
  return place && componentDefinition("Angular", name, place);
}

function elementChain(framework, element, components) {
  if (!element) return null;
  const chain = [{ role: "element", ...element }];
  for (const component of components) {
    if (chain.length > MAX_COMPONENTS) break;
    if (component.file) chain.push({ role: "component", ...component });
  }
  return { framework, precision: "element", chain, snippet: null };
}

function componentDefinition(framework, name, place) {
  return {
    framework,
    precision: "component",
    chain: [{ role: "definition", ...(name && { name }), ...place }],
    snippet: null,
  };
}

function userPlace(file, line, column) {
  if (typeof file !== "string" || !file || isLibrary(file)) return null;
  const place = { file };
  if (Number.isInteger(line) && line > 0) {
    place.line = line;
    if (Number.isInteger(column) && column > 0) place.column = column;
  }
  return place;
}

async function userFrame(stack, mapFrame) {
  for (const frame of parseStack(stack)) {
    if (isLibrary(frame.url)) continue;
    const position = await mapFrame(frame);
    if (position && !isLibrary(position.original)) return position;
  }
  return null;
}

const isLibrary = (path) => /(^|[/\\])node_modules[/\\]/.test(path);

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

function projectPath(original, mapUrl, script) {
  const bundled =
    /^(?:turbopack:\/\/\/\[project\]\/|webpack:\/\/(?:[^/]*\/)?\.\/|webpack-internal:\/\/\/(?:\([^)]*\)\/)?\.\/)(.+)$/.exec(
      original,
    );
  if (bundled) return bundled[1];
  const absolute = original.startsWith("file://") ? decodeURIComponent(new URL(original).pathname) : original;
  if (!script) return absolute;
  const served = decodeURIComponent(script.pathname);
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
    if (digit === undefined) continue;
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
