export type Sites = { mode: "blocklist" | "allowlist"; blocklist: string[]; allowlist: string[] };
export type Config = {
  mode: "auto" | "ask" | "custom";
  sites: Sites;
  workspace?: string;
  container?: string;
  browser?: string;
  profile?: string;
  launch?: "ask" | "allow" | "deny";
};
export function normalizeDomain(value: unknown): string;
export function normalizeConfig(raw?: any): Config;
export function normalizeSites(raw?: any): Sites;
export function siteEntry(host: string, sites: Sites): string | null;
export function siteAllowed(host: string, sites: Sites): boolean;
