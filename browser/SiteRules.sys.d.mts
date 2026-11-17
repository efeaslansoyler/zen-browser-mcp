export type Config = { mode: "auto" | "ask"; sites: Record<string, "ask" | "block">; workspace?: string };
export function normalizeDomain(value: unknown): string;
export function normalizeConfig(raw?: any): Config;
export function siteRule(host: string, sites?: Config["sites"]): "default" | "ask" | "block";
