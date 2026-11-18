// Shared policy for the CLI and browser. Parent-domain restrictions also cover subdomains.
export function normalizeDomain(value) {
  let input = String(value).trim().replace(/^\*\./, "");
  const url = new URL(input.includes("://") ? input : `https://${input}`);
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password)
    throw new Error(`Invalid site domain: ${value}`);
  return url.hostname.toLowerCase().replace(/\.$/, "");
}

export function normalizeConfig(raw = {}) {
  const sites = {};
  for (const value of Array.isArray(raw.sensitive) ? raw.sensitive : []) {
    sites[normalizeDomain(value)] = "ask";
  }
  for (const [value, rule] of Object.entries(raw.sites || {})) {
    if (!["ask", "block", "default"].includes(rule)) throw new Error(`Invalid site rule: ${rule}`);
    const domain = normalizeDomain(value);
    if (rule === "default") delete sites[domain];
    else sites[domain] = rule;
  }
  const config = { mode: ["ask", "custom"].includes(raw.mode) ? raw.mode : "auto", sites };
  // Zen: the workspace (by name) for tabs agents open; otherwise the user's current one
  const workspace = typeof raw.workspace === "string" ? raw.workspace.trim().slice(0, 80) : "";
  if (workspace) config.workspace = workspace;
  // A container (by name) that agent tabs open in by default: their own cookies and site data
  const container = typeof raw.container === "string" ? raw.container.trim().slice(0, 80) : "";
  if (container) config.container = container;
  return config;
}

export function siteRule(host, sites = {}) {
  host = String(host).toLowerCase().replace(/\.$/, "");
  let result = "default";
  for (const [domain, rule] of Object.entries(sites)) {
    if (host !== domain && !host.endsWith(`.${domain}`)) continue;
    // A child rule cannot weaken a parent restriction.
    if (rule === "block") return "block";
    if (rule === "ask") result = "ask";
  }
  return result;
}
