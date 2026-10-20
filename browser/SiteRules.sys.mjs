// Shared policy for the CLI and browser. Parent-domain restrictions also cover subdomains.
export function normalizeDomain(value) {
  let input = String(value).trim().replace(/^\*\./, '');
  const url = new URL(input.includes('://') ? input : `https://${input}`);
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error(`Invalid site domain: ${value}`);
  return url.hostname.toLowerCase().replace(/\.$/, '');
}

export function normalizeConfig(raw = {}) {
  const sites = {};
  for (const value of Array.isArray(raw.sensitive) ? raw.sensitive : []) {
    sites[normalizeDomain(value)] = 'ask';
  }
  for (const [value, rule] of Object.entries(raw.sites || {})) {
    if (!['ask', 'block', 'default'].includes(rule)) throw new Error(`Invalid site rule: ${rule}`);
    const domain = normalizeDomain(value);
    if (rule === 'default') delete sites[domain];
    else sites[domain] = rule;
  }
  return { mode: raw.mode === 'ask' ? 'ask' : 'auto', sites };
}

export function siteRule(host, sites = {}) {
  host = String(host).toLowerCase().replace(/\.$/, '');
  let result = 'default';
  for (const [domain, rule] of Object.entries(sites)) {
    if (host !== domain && !host.endsWith(`.${domain}`)) continue;
    // A child rule cannot weaken a parent restriction.
    if (rule === 'block') return 'block';
    if (rule === 'ask') result = 'ask';
  }
  return result;
}
