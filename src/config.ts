import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { L } from "./i18n.ts";
import { CONFIG_FILE, PACKAGE, PERMISSIONS_FILE } from "./paths.ts";
import { examplePermissions, parsePermissions, ruleOf } from "../browser/Policy.sys.mjs";

import {
  BROWSER_MODES,
  normalizeConfig,
  normalizeDomain,
  parseBrowserMode,
  type Config,
} from "../browser/SiteRules.sys.mjs";

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
  const temp = `${CONFIG_FILE}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    fs.renameSync(temp, CONFIG_FILE);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

export function setLaunchPreference(launch: Config["launch"]) {
  writeConfig({ ...readConfig(), launch });
}

export function launchRule(config = readConfig()) {
  const rule = ruleOf("browser.launch", config.mode, config.mode === "custom" ? readPermissions() : null);
  return rule === "deny" ? rule : (config.launch ?? rule);
}

const MODE_TEXT = {
  ask: ["Agent asks before every action", "Ajan her işlemden önce izin ister"],
  auto: ["Agent asks only before risky operations", "Ajan yalnızca riskli işlemlerden önce izin ister"],
  custom: [`Your own rules in ${PERMISSIONS_FILE}`, `Kendi kuralların: ${PERMISSIONS_FILE}`],
};

export function readPermissions() {
  if (!fs.existsSync(PERMISSIONS_FILE))
    throw new Error(
      L(
        `${PERMISSIONS_FILE} doesn't exist. Create it with: ${PACKAGE} config permissions init`,
        `${PERMISSIONS_FILE} yok. Oluşturmak için: ${PACKAGE} config permissions init`,
      ),
    );
  return parsePermissions(fs.readFileSync(PERMISSIONS_FILE, "utf8"));
}

function permissionsCommand([action, base = "auto"]: string[]) {
  if (action === "init") {
    if (base !== "ask" && base !== "auto") throw new Error("Use: config permissions init [ask|auto]");
    if (fs.existsSync(PERMISSIONS_FILE))
      throw new Error(
        L(
          `${PERMISSIONS_FILE} already exists; edit it, or delete it to start over.`,
          `${PERMISSIONS_FILE} zaten var; düzenle ya da baştan başlamak için sil.`,
        ),
      );
    fs.mkdirSync(path.dirname(PERMISSIONS_FILE), { recursive: true, mode: 0o700 });
    fs.writeFileSync(PERMISSIONS_FILE, examplePermissions(base), { mode: 0o600 });
    console.log(
      L(
        `✓ ${PERMISSIONS_FILE} (every operation, starting from the ${base} template)\n  Edit it, then: ${PACKAGE} config mode custom`,
        `✓ ${PERMISSIONS_FILE} (tüm işlemler, ${base} şablonundan başlayarak)\n  Düzenle, sonra: ${PACKAGE} config mode custom`,
      ),
    );
    return;
  }
  if (action) throw new Error("Use: config permissions [init [ask|auto]]");
  const custom = readPermissions();
  const changed = Object.entries(custom.rules).filter(([key, rule]) => rule !== ruleOf(key, custom.base));
  console.log(`${PERMISSIONS_FILE}\n`);
  console.log(L(`base: ${custom.base}`, `temel: ${custom.base}`));
  const baseLaunch = ruleOf("browser.launch", custom.base);
  if (ruleOf("browser.launch", "custom", custom) === baseLaunch) console.log(`browser.launch: ${baseLaunch}`);
  console.log(
    changed.length
      ? L("changed from the base:", "temelden farklı olanlar:") +
          "\n" +
          changed.map(([key, rule]) => `  ${key}: ${ruleOf(key, custom.base)} → ${rule}`).join("\n")
      : L("nothing changed from the base", "temelden farklı bir şey yok"),
  );
}

function printSites(sites: Config["sites"]) {
  console.log(
    sites.mode === "blocklist"
      ? L("sites: every site except the blocklist", "siteler: blocklist dışındaki her site")
      : L("sites: only the allowlist", "siteler: yalnızca allowlist"),
  );
  for (const list of ["blocklist", "allowlist"] as const)
    console.log(`  ${list}${sites.mode === list ? " *" : ""}: ${sites[list].join(", ") || "—"}`);
}

export function configCommand(args: string[]) {
  const config = readConfig();
  const [cmd, ...rest] = args;
  if (!cmd) {
    console.log(`${CONFIG_FILE}\n`);
    const [en, tr] = MODE_TEXT[config.mode];
    console.log(L(`mode: ${config.mode}  (${en})`, `mod: ${config.mode}  (${tr})`));
    printSites(config.sites);
    console.log(`browser: ${config.browser ?? "(automatic)"}${config.profile ? ` / ${config.profile}` : ""}`);
    console.log(`browserMode: ${config.browserMode ?? "together"}`);
    console.log(`launch: ${config.launch ?? "default (permission template)"}`);
    console.log(
      L(
        `workspace: ${config.workspace ?? "(the space you're in)"}`,
        `çalışma alanı: ${config.workspace ?? "(bulunduğun alan)"}`,
      ),
    );
    console.log(
      L(
        `container: ${config.container ?? "off (agent tabs use your logins unless asked otherwise)"}`,
        `container: ${config.container ?? "kapalı (ajan sekmeleri, aksi istenmedikçe senin girişlerini kullanır)"}`,
      ),
    );
    console.log(
      L(
        `\nUsage:\n  ${PACKAGE} config mode ask|auto|custom\n  ${PACKAGE} config browser-mode [mode]\n  ${PACKAGE} config permissions [init [ask|auto]]\n  ${PACKAGE} config launch [default|ask|allow|deny]\n  ${PACKAGE} config site [list] | mode blocklist|allowlist\n  ${PACKAGE} config site block|unblock|allow|disallow <domain>…\n  ${PACKAGE} config workspace <name>|current\n  ${PACKAGE} config container <name>|off\n  ${PACKAGE} config browser <name|dir> [--profile <name|dir>] | clear`,
        `\nKullanım:\n  ${PACKAGE} config mode ask|auto|custom\n  ${PACKAGE} config browser-mode [mode]\n  ${PACKAGE} config permissions [init [ask|auto]]\n  ${PACKAGE} config launch [default|ask|allow|deny]\n  ${PACKAGE} config site [list] | mode blocklist|allowlist\n  ${PACKAGE} config site block|unblock|allow|disallow <alan-adı>…\n  ${PACKAGE} config workspace <ad>|current\n  ${PACKAGE} config container <ad>|off\n  ${PACKAGE} config browser <name|dir> [--profile <name|dir>] | clear`,
      ),
    );
    return;
  }
  if (cmd === "browser-mode") {
    if (rest.length > 1) throw new Error(`Use: config browser-mode [${BROWSER_MODES.join("|")}]`);
    if (!rest.length) console.log(`browserMode: ${config.browserMode ?? "together"}`);
    else {
      const browserMode = parseBrowserMode(rest[0]);
      writeConfig({ ...config, browserMode });
      console.log(`✓ browserMode: ${browserMode}`);
    }
    return;
  }
  if (cmd === "browser") {
    const [browser, flag, profile] = rest.map((value) => value.trim());
    const { browser: _, profile: __, ...remaining } = config;
    if (browser === "clear" && rest.length === 1) {
      writeConfig(remaining);
      console.log("✓ browser selection cleared");
    } else if (
      browser &&
      browser !== "clear" &&
      !browser.startsWith("--") &&
      (rest.length === 1 || (rest.length === 3 && flag === "--profile" && profile && !profile.startsWith("--")))
    ) {
      writeConfig({ ...remaining, browser, ...(profile ? { profile } : {}) });
      console.log(`✓ browser: ${browser}${profile ? ` / ${profile}` : ""}`);
    } else throw new Error("Use: config browser <name|dir> [--profile <name|dir>] | clear");
    return;
  }
  if (cmd === "launch") {
    const [pref] = rest;
    if (rest.length === 0) {
      console.log(`launch: ${config.launch ?? "default"} (effective: ${launchRule(config)})`);
      return;
    }
    if (rest.length !== 1 || (pref !== "default" && pref !== "ask" && pref !== "allow" && pref !== "deny"))
      throw new Error("Use: config launch [default|ask|allow|deny]");
    setLaunchPreference(pref === "default" ? undefined : pref);
    console.log(`✓ launch: ${pref}`);
    return;
  }
  if (cmd === "mode") {
    const mode = rest[0];
    if (mode !== "auto" && mode !== "ask" && mode !== "custom")
      throw new Error(L("mode must be ask, auto or custom.", "mod ask, auto ya da custom olmalı."));
    if (mode === "custom") readPermissions(); // why: Reject a broken permission template at setup time rather than at the user's next browser action.
    writeConfig({ ...config, mode });
    const [en, tr] = MODE_TEXT[mode];
    console.log(L(`✓ mode: ${mode} (${en})`, `✓ mod: ${mode} (${tr})`));
    return;
  }
  if (cmd === "permissions") {
    permissionsCommand(rest);
    return;
  }
  if (cmd === "workspace") {
    const name = rest.join(" ").trim();
    if (!name) throw new Error(L("Use: config workspace <name>|current", "Kullanım: config workspace <ad>|current"));
    const { workspace: _, ...rest2 } = config;
    writeConfig(name === "current" ? rest2 : { ...config, workspace: name });
    console.log(
      L(
        `✓ workspace: ${name === "current" ? "the space you're in" : name}`,
        `✓ çalışma alanı: ${name === "current" ? "bulunduğun alan" : name}`,
      ),
    );
    return;
  }
  if (cmd === "container") {
    const name = rest.join(" ").trim();
    if (!name) throw new Error(L("Use: config container <name>|off", "Kullanım: config container <ad>|off"));
    const { container: _, ...rest2 } = config;
    writeConfig(name === "off" ? rest2 : { ...config, container: name });
    console.log(
      L(
        `✓ container: ${name === "off" ? "off (agent tabs use your logins unless asked otherwise)" : name}`,
        `✓ container: ${name === "off" ? "kapalı (ajan sekmeleri, aksi istenmedikçe senin girişlerini kullanır)" : name}`,
      ),
    );
    return;
  }
  if (cmd === "site") {
    const [action = "list", ...values] = rest;
    const edits: Record<string, ["blocklist" | "allowlist", boolean]> = {
      block: ["blocklist", true],
      unblock: ["blocklist", false],
      allow: ["allowlist", true],
      disallow: ["allowlist", false],
    };
    if (action === "mode") {
      const mode = values[0];
      if (mode !== "blocklist" && mode !== "allowlist") throw new Error("Use: config site mode blocklist|allowlist");
      config.sites.mode = mode;
      writeConfig(config);
    } else if (edits[action]) {
      if (!values.length) throw new Error("At least one site domain is required.");
      const [list, add] = edits[action];
      const domains = values.map(normalizeDomain);
      const kept = config.sites[list].filter((d) => !domains.includes(d));
      config.sites[list] = add ? [...kept, ...domains] : kept;
      writeConfig(config);
      if (config.sites.mode !== list)
        console.log(
          L(
            `Note: the ${list} doesn't apply now; switch with: config site mode ${list}`,
            `Not: ${list} şu an geçerli değil; geçmek için: config site mode ${list}`,
          ),
        );
    } else if (action !== "list")
      throw new Error("Use: config site [list] | mode blocklist|allowlist | block|unblock|allow|disallow <domain>…");
    printSites(config.sites);
    console.log(`browser: ${config.browser ?? "(automatic)"}${config.profile ? ` / ${config.profile}` : ""}`);
    return;
  }
  throw new Error(L(`Unknown config command: ${cmd}`, `Bilinmeyen config komutu: ${cmd}`));
}
