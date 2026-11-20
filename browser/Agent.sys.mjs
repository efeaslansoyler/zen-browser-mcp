// why: Client identity is presentation metadata and must never grant access.
export const THEMES = Object.freeze({
  claude: Object.freeze({
    id: "claude",
    name: "Claude",
    accent: "#d97757",
    hover: "#e08667",
    rgb: "217, 119, 87",
    foreground: "#ffffff",
  }),
  codex: Object.freeze({
    id: "codex",
    name: "Codex",
    accent: "#a7e8d0",
    hover: "#c5f2e2",
    rgb: "167, 232, 208",
    foreground: "#10251d",
  }),
  antigravity: Object.freeze({
    id: "antigravity",
    name: "Antigravity",
    accent: "#3186ff",
    hover: "#5c9fff",
    rgb: "49, 134, 255",
    foreground: "#ffffff",
  }),
  opencode: Object.freeze({
    id: "opencode",
    name: "OpenCode",
    accent: "#a8a4a0",
    hover: "#c2bfbb",
    rgb: "168, 164, 160",
    foreground: "#161413",
  }),
  multi: Object.freeze({
    id: "multi",
    name: "Agents",
    accent: "#8f8f9d",
    hover: "#a9a9b5",
    rgb: "143, 143, 157",
    foreground: "#ffffff",
  }),
  generic: Object.freeze({
    id: "generic",
    name: "AI Agent",
    accent: "#87b8f5",
    hover: "#adcff8",
    rgb: "135, 184, 245",
    foreground: "#101d2d",
  }),
});

export function identifyAgent(clientName = "", override = "") {
  const name = String(override || clientName)
    .trim()
    .slice(0, 80);
  if (/codex/i.test(name)) return { id: "codex", name: "Codex" };
  if (/claude/i.test(name)) return { id: "claude", name: "Claude" };
  if (/antigravity/i.test(name)) return { id: "antigravity", name: "Antigravity" };
  if (/^opencode$/i.test(name)) return { id: "opencode", name: "OpenCode" };
  return { id: "generic", name: name || "AI Agent" };
}

export function agentTheme(agent) {
  const theme = Object.hasOwn(THEMES, agent?.id) ? THEMES[agent.id] : THEMES.generic;
  const own = theme.id === "generic" || theme.id === "multi";
  return { ...theme, name: own ? String(agent?.name || theme.name).slice(0, 80) : theme.name };
}

export function commonAgent(agents) {
  const themes = new Map();
  for (const agent of agents) {
    const theme = agentTheme(agent);
    themes.set(theme.id === "generic" ? `generic:${theme.name}` : theme.id, theme);
  }
  if (themes.size <= 1) return themes.values().next().value ?? null;
  return agentTheme({ id: "multi", name: [...themes.values()].map((t) => t.name).join(", ") });
}

export function applyTheme(element, agent) {
  const theme = agentTheme(agent);
  for (const [key, value] of Object.entries({
    "--zen-agent-accent": theme.accent,
    "--zen-agent-hover": theme.hover,
    "--zen-agent-rgb": theme.rgb,
    "--zen-agent-foreground": theme.foreground,
  }))
    element.style.setProperty(key, value);
  element.setAttribute("data-zen-agent", theme.id);
  return theme;
}

// why: SVG icons stay crisp in browser menus and the island at different scales.
const ICON_FILES = new Set(["claude", "codex", "antigravity", "opencode", "multi"]);
export function agentIcon(agent) {
  const theme = agentTheme(agent);
  if (ICON_FILES.has(theme.id))
    return new URL(`./assets/${theme.id}.svg`, import.meta.url).href + new URL(import.meta.url).search;
  return (
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="${theme.accent}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m2 4 4 4-4 4M9 12h5"/></svg>`,
    )
  );
}
