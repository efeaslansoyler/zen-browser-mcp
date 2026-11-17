// The `config` command: edits ~/.config/<name>/config.json. The bridge reads the file again when
// it changes; no browser restart needed.
import fs from "node:fs";
import path from "node:path";
import { L } from "./i18n.ts";
import { CONFIG_FILE, NAME } from "./paths.ts";

import { normalizeConfig, normalizeDomain, type Config } from "../browser/SiteRules.sys.mjs";

export function readConfig(): Config {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    return normalizeConfig(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return normalizeConfig();
  }
}

function writeConfig(config: Config) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

export function configCommand(args: string[]) {
  const config = readConfig();
  const [cmd, ...rest] = args;
  if (!cmd) {
    console.log(`${CONFIG_FILE}\n`);
    console.log(L(`mode: ${config.mode}  (${config.mode === "ask" ? "Agent asks before every action" : "Agent acts without asking"})`,
      `mod: ${config.mode}  (${config.mode === "ask" ? "Ajan her işlemden önce izin ister" : "Ajan sormadan işlem yapar"})`));
    console.log(L("site rules:", "site kuralları:"), config.sites);
    console.log(L(`workspace: ${config.workspace ?? "(the space you're in)"}`, `çalışma alanı: ${config.workspace ?? "(bulunduğun alan)"}`));
    console.log(L(`\nUsage:\n  npx ${NAME} config mode auto|ask\n  npx ${NAME} config site ask|block|default <domain>…\n  npx ${NAME} config site list\n  npx ${NAME} config workspace <name>|current`,
      `\nKullanım:\n  npx ${NAME} config mode auto|ask\n  npx ${NAME} config site ask|block|default <alan-adı>…\n  npx ${NAME} config site list\n  npx ${NAME} config workspace <ad>|current`));
    return;
  }
  if (cmd === "mode") {
    const mode = rest[0];
    if (mode !== "auto" && mode !== "ask") throw new Error(L("mode must be auto or ask.", "mod auto ya da ask olmalı."));
    writeConfig({ ...config, mode });
    console.log(L(`✓ mode: ${mode}`, `✓ mod: ${mode}`));
    return;
  }
  if (cmd === "workspace") {
    // Zen: tabs agents open go to this workspace; "current" means the user's current one
    const name = rest.join(" ").trim();
    if (!name) throw new Error(L("Use: config workspace <name>|current", "Kullanım: config workspace <ad>|current"));
    const { workspace: _, ...rest2 } = config;
    writeConfig(name === "current" ? rest2 : { ...config, workspace: name });
    console.log(L(`✓ workspace: ${name === "current" ? "the space you're in" : name}`, `✓ çalışma alanı: ${name === "current" ? "bulunduğun alan" : name}`));
    return;
  }
  if (cmd === "site" || cmd === "sensitive") {
    const [action = "list", ...domains] = rest;
    // Keep old commands working; all writes migrate to the single sites map.
    const rule = cmd === "sensitive" ? ({ add: "ask", remove: "default", list: "list" } as Record<string, string>)[action] : action;
    if (!["ask", "block", "default", "list"].includes(rule)) throw new Error("Use: config site ask|block|default <domain>… or config site list");
    if (rule !== "list") {
      if (!domains.length) throw new Error("At least one site domain is required.");
      const items = domains.map(normalizeDomain);
      for (const domain of items) {
        if (rule === "default") delete config.sites[domain];
        else config.sites[domain] = rule as "ask" | "block";
      }
      writeConfig(config);
    }
    console.log(L("site rules:", "site kuralları:"), config.sites);
    return;
  }
  throw new Error(L(`Unknown config command: ${cmd}`, `Bilinmeyen config komutu: ${cmd}`));
}
