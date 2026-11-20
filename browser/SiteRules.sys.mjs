export function normalizeDomain(value) {
  let input = String(value).trim().replace(/^\*\./, "");
  const url = new URL(input.includes("://") ? input : `https://${input}`);
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password)
    throw new Error(`Invalid site domain: ${value}`);
  return url.hostname.toLowerCase().replace(/\.$/, "");
}

export const BROWSER_MODES = ["together", "agent", "scratch", "autonomous", "autonomous-agent"];
export const isTemporaryMode = (mode) => mode === "scratch" || mode === "autonomous";
export const isAutonomousMode = (mode) => mode === "autonomous" || mode === "autonomous-agent";

export function parseBrowserMode(mode) {
  if (!BROWSER_MODES.includes(mode)) throw new Error(`browserMode must be one of: ${BROWSER_MODES.join(", ")}.`);
  return mode;
}

export function normalizeConfig(raw = {}) {
  const config = { mode: ["ask", "custom"].includes(raw.mode) ? raw.mode : "auto", sites: normalizeSites(raw.sites) };
  const workspace = typeof raw.workspace === "string" ? raw.workspace.trim().slice(0, 80) : "";
  if (workspace) config.workspace = workspace;
  const container = typeof raw.container === "string" ? raw.container.trim().slice(0, 80) : "";
  if (container) config.container = container;
  for (const key of ["browser", "profile"]) {
    const value = typeof raw[key] === "string" ? raw[key].trim() : "";
    if (value) config[key] = value;
  }
  if (raw.browserMode !== undefined) config.browserMode = parseBrowserMode(raw.browserMode);
  if (["ask", "allow", "deny"].includes(raw.launch)) config.launch = raw.launch;
  return config;
}

// why: Keep the inactive list so changing modes cannot discard the user's entries.
// why: Limit site policy to where agents can go; operation policy governs what they do there.
export function normalizeSites(raw) {
  raw ??= {};
  if (
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).some((k) => !["mode", "blocklist", "allowlist"].includes(k))
  )
    throw new Error(
      'The "sites" setting is {"mode": "blocklist" | "allowlist", "blocklist": [domains], "allowlist": [domains]}.',
    );
  const list = (name) => {
    const value = raw[name] ?? [];
    if (!Array.isArray(value)) throw new Error(`sites.${name} must be a list of domains.`);
    return [...new Set(value.map(normalizeDomain))];
  };
  return {
    mode: raw.mode === "allowlist" ? "allowlist" : "blocklist",
    blocklist: list("blocklist"),
    allowlist: list("allowlist"),
  };
}

export function siteEntry(host, sites) {
  host = String(host).toLowerCase().replace(/\.$/, "");
  return sites[sites.mode].find((domain) => host === domain || host.endsWith(`.${domain}`)) ?? null;
}

// why: Hostless pages do not identify a site to match against domain rules.
export function siteAllowed(host, sites) {
  if (!host) return true;
  const listed = siteEntry(host, sites) !== null;
  return sites.mode === "allowlist" ? listed : !listed;
}
