// Presentation metadata only: client identity never grants tab access or permission.
export const THEMES = Object.freeze({
  claude: Object.freeze({
    id: "claude",
    name: "Claude",
    accent: "#d97757",
    hover: "#e08667",
    rgb: "217, 119, 87",
    foreground: "#ffffff",
    glyph: "✳",
  }),
  codex: Object.freeze({
    id: "codex",
    name: "Codex",
    accent: "#a7e8d0",
    hover: "#c5f2e2",
    rgb: "167, 232, 208",
    foreground: "#10251d",
    glyph: ">_",
  }),
  generic: Object.freeze({
    id: "generic",
    name: "AI Agent",
    accent: "#87b8f5",
    hover: "#adcff8",
    rgb: "135, 184, 245",
    foreground: "#101d2d",
    glyph: ">_",
  }),
});

export function identifyAgent(clientName = "", override = "") {
  const name = String(override || clientName)
    .trim()
    .slice(0, 80);
  if (/codex/i.test(name)) return { id: "codex", name: "Codex" };
  if (/claude/i.test(name)) return { id: "claude", name: "Claude" };
  if (/antigravity/i.test(name)) return { id: "generic", name: "Antigravity" };
  if (/^opencode$/i.test(name)) return { id: "generic", name: "OpenCode" };
  return { id: "generic", name: name || "AI Agent" };
}

export function agentTheme(agent) {
  const theme = Object.hasOwn(THEMES, agent?.id) ? THEMES[agent.id] : THEMES.generic;
  return { ...theme, name: theme.id === "generic" ? String(agent?.name || theme.name).slice(0, 80) : theme.name };
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

// SVG icons stay crisp in browser menus and the island.
export function agentIcon(agent) {
  const theme = agentTheme(agent);
  if (theme.id === "codex")
    return new URL("./assets/codex.svg", import.meta.url).href + new URL(import.meta.url).search;
  const path =
    theme.id === "claude"
      ? '<path d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4M3.4 3.4l2.8 2.8M9.8 9.8l2.8 2.8M3.4 12.6l2.8-2.8M9.8 6.2l2.8-2.8"/>'
      : '<path d="m2 4 4 4-4 4M9 12h5"/>';
  return (
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="${theme.accent}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`,
    )
  );
}
