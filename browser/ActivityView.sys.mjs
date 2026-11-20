// why: Log fields can contain page-controlled text and must be escaped before rendering.

// why: A capped tail can start mid-record, so skip the incomplete first line.
export async function readRecent(path, bytes = 512 * 1024) {
  let size;
  try {
    ({ size } = await IOUtils.stat(path));
  } catch {
    return [];
  }
  const offset = Math.max(0, size - bytes);
  const data = await IOUtils.read(path, { offset, maxBytes: Math.min(size, bytes) });
  const lines = new TextDecoder().decode(data).split("\n");
  if (offset > 0) lines.shift();
  const entries = [];
  for (const line of lines) {
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {}
  }
  return entries;
}

const time = (entry) =>
  new Date(entry.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function formatLine(entry, L) {
  const doing = entry.what ?? entry.doing ?? [entry.tool, entry.action].filter(Boolean).join(" ");
  const to = entry.to ? ` → ${entry.to}` : "";
  const error = entry.error ? ` ✗ ${entry.error}` : "";
  return `${time(entry)} · ${entry.who ?? entry.agent ?? L("agent", "ajan")} — ${doing}${to}${error}`;
}

const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

export function renderPage(entries, L, source = "activity.jsonl") {
  const groups = new Map();
  for (const entry of entries) {
    if (!entry.session) continue;
    const key = entry.session;
    if (!groups.has(key)) groups.set(key, { who: entry.who ?? entry.agent ?? key.slice(-6), items: [] });
    const group = groups.get(key);
    if (entry.who) group.who = entry.who;
    group.items.push(entry);
  }
  const sections = [...groups.values()]
    .sort((a, b) => Date.parse(b.items.at(-1).t) - Date.parse(a.items.at(-1).t))
    .map((group) => {
      const rows = group.items
        .slice()
        .reverse()
        .map(
          (e) => `<tr${e.error ? ' class="error"' : ""}>
<td class="time">${escape(new Date(e.t).toLocaleString())}</td><td>${escape(e.host ?? "")}</td>
<td>${escape(e.what ?? e.doing ?? [e.tool, e.action].filter(Boolean).join(" "))}${e.to ? `<div class="to">→ ${escape(e.to)}</div>` : ""}${e.error ? `<div class="err">${escape(e.error)}</div>` : ""}</td></tr>`,
        )
        .join("");
      return `<section><h2>${escape(group.who)} <span>${group.items.length}</span></h2><table>${rows}</table></section>`;
    })
    .join("");
  const title = L("Agent history", "Ajan geçmişi");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
:root { color-scheme: light dark; --muted: #6b6b6b; --line: #e4e4e4; --bad: #c0392b; }
@media (prefers-color-scheme: dark) { :root { --muted: #a0a0a0; --line: #333; --bad: #ff7b6b; } }
body { font: 14px/1.45 system-ui, sans-serif; max-width: 960px; margin: 32px auto; padding: 0 16px; }
h1 { font-size: 20px; } h2 { font-size: 15px; margin: 28px 0 8px; } h2 span { color: var(--muted); font-weight: normal; }
table { width: 100%; border-collapse: collapse; } td { padding: 6px 8px; border-top: 1px solid var(--line); vertical-align: top; }
td.time { white-space: nowrap; color: var(--muted); width: 1%; } td:nth-child(2) { color: var(--muted); white-space: nowrap; width: 1%; }
.to { color: var(--muted); word-break: break-all; } .err { color: var(--bad); } p { color: var(--muted); }
</style></head><body><h1>${title}</h1>
<p>${escape(L("What agents did in your browser, newest first. Kept in", "Ajanların tarayıcında yaptıkları, en yeni üstte. Kaynak:"))} ${escape(source)}</p>
${sections || `<p>${escape(L("Nothing yet.", "Henüz bir şey yok."))}</p>`}</body></html>`;
}
