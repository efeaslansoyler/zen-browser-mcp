// why: Source map fixture segments are zero-based even where decoded tool locations are one-based.
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function vlq(value) {
  let rest = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = "";
  do {
    let digit = rest & 31;
    rest >>>= 5;
    if (rest) digit |= 32;
    out += BASE64[digit];
  } while (rest);
  return out;
}

export function encodeMappings(lines) {
  let source = 0,
    line = 0,
    column = 0;
  return lines
    .map((segments) => {
      let generated = 0;
      return segments
        .map(([genColumn, src, origLine, origColumn]) => {
          const out = vlq(genColumn - generated) + vlq(src - source) + vlq(origLine - line) + vlq(origColumn - column);
          generated = genColumn;
          source = src;
          line = origLine;
          column = origColumn;
          return out;
        })
        .join(",");
    })
    .join(";");
}

export function sourceMap({ sources, sourcesContent, lines, sourceRoot }) {
  return JSON.stringify({
    version: 3,
    sources,
    sourcesContent,
    sourceRoot,
    names: [],
    mappings: encodeMappings(lines),
  });
}

export const inlineMapComment = (map) =>
  `//# sourceMappingURL=data:application/json;base64,${Buffer.from(map).toString("base64")}`;
