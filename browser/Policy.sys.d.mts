export type Rule = "allow" | "ask" | "deny";
export type Custom = { base: "ask" | "auto"; rules: Record<string, Rule> };
export const OPERATIONS: Map<string, { ask: Rule; auto: Rule; about: string }>;
export function ruleOf(key: string, mode?: string, custom?: Custom | null): Rule;
export function parsePermissions(text: string): Custom;
export function examplePermissions(base?: "ask" | "auto"): string;
