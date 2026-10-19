// `config` komutu: ~/.config/<ad>/config.json'u düzenler. Köprü dosya değişince kendiliğinden
// okur; tarayıcıyı yeniden başlatmak gerekmez.
import fs from "node:fs";
import path from "node:path";
import { L } from "./i18n.ts";
import { CONFIG_FILE, NAME } from "./paths.ts";

type Config = { mode: "auto" | "ask"; sensitive: string[] };

export function readConfig(): Config {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    return { mode: raw.mode === "ask" ? "ask" : "auto", sensitive: Array.isArray(raw.sensitive) ? raw.sensitive.map(String) : [] };
  } catch {
    return { mode: "auto", sensitive: [] };
  }
}

function writeConfig(config: Config) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

// "https://www.garanti.com.tr/x" → "garanti.com.tr": şema, yol ve www. atılır
const domain = (s: string) => s.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/\/.*$/, "").replace(/^\*?\./, "").replace(/^www\./, "");

export function configCommand(args: string[]) {
  const config = readConfig();
  const [cmd, ...rest] = args;
  if (!cmd) {
    console.log(`${CONFIG_FILE}\n`);
    console.log(L(`mode: ${config.mode}  (${config.mode === "ask" ? "Claude asks before every action" : "Claude acts without asking"})`,
      `mod: ${config.mode}  (${config.mode === "ask" ? "Claude her işlemden önce izin ister" : "Claude sormadan işlem yapar"})`));
    console.log(L("sensitive sites (always ask):", "hassas siteler (her işlemde sorulur):"), config.sensitive.length ? config.sensitive.join(", ") : L("none", "yok"));
    console.log(L(`\nUsage:\n  npx ${NAME} config mode auto|ask\n  npx ${NAME} config sensitive add|remove <domain>…`,
      `\nKullanım:\n  npx ${NAME} config mode auto|ask\n  npx ${NAME} config sensitive add|remove <alan-adı>…`));
    return;
  }
  if (cmd === "mode") {
    const mode = rest[0];
    if (mode !== "auto" && mode !== "ask") throw new Error(L("mode must be auto or ask.", "mod auto ya da ask olmalı."));
    writeConfig({ ...config, mode });
    console.log(L(`✓ mode: ${mode}`, `✓ mod: ${mode}`));
    return;
  }
  if (cmd === "sensitive") {
    const [action, ...domains] = rest;
    const list = new Set(config.sensitive);
    const items = domains.map(domain).filter(Boolean);
    if (action === "add") items.forEach((d) => list.add(d));
    else if (action === "remove") items.forEach((d) => list.delete(d));
    else if (action !== "list" && action !== undefined) throw new Error(L("Use: sensitive add|remove <domain>…", "Kullanım: sensitive add|remove <alan-adı>…"));
    writeConfig({ ...config, sensitive: [...list].sort() });
    console.log(L("sensitive sites:", "hassas siteler:"), list.size ? [...list].sort().join(", ") : L("none", "yok"));
    return;
  }
  throw new Error(L(`Unknown config command: ${cmd}`, `Bilinmeyen config komutu: ${cmd}`));
}
