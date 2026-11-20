const lang = (process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "").toLowerCase();
export const turkish = lang.startsWith("tr");
export const L = (en: string, tr: string) => (turkish ? tr : en);
