// Settings and site lists, shared by the CLI and the browser. A listed domain covers its subdomains.
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
  // Zen: the workspace (by name) for tabs agents open; otherwise the user's current one
  const workspace = typeof raw.workspace === "string" ? raw.workspace.trim().slice(0, 80) : "";
  if (workspace) config.workspace = workspace;
  // A container (by name) that agent tabs open in by default: their own cookies and site data
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

// Which sites agents may use. "blocklist": every site but the listed ones; "allowlist": only the
// listed ones. Both lists are kept so switching loses nothing, but only the mode's list applies.
// Sites only say where agents may go; what they may do there is the permission mode's job.
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

// The domain in the active list that covers this host (itself or a parent domain), if any.
export function siteEntry(host, sites) {
  host = String(host).toLowerCase().replace(/\.$/, "");
  return sites[sites.mode].find((domain) => host === domain || host.endsWith(`.${domain}`)) ?? null;
}

// May agents use this host? Pages without one (about:blank, local files) aren't sites.
export function siteAllowed(host, sites) {
  if (!host) return true;
  const listed = siteEntry(host, sites) !== null;
  return sites.mode === "allowlist" ? listed : !listed;
}
