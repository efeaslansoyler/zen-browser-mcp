import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { L } from "./i18n.ts";
import { PACKAGE_DIR } from "./paths.ts";

const SKILL = "zen-browser";
const SOURCE = path.join(PACKAGE_DIR, "skills", SKILL);

export function skillTargets(home = os.homedir(), env = process.env) {
  const claude = env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
  const codex = env.CODEX_HOME || path.join(home, ".codex");
  return [
    { client: "Claude Code", present: fs.existsSync(claude), dir: path.join(claude, "skills", SKILL) },
    { client: "Codex", present: fs.existsSync(codex), dir: path.join(home, ".agents", "skills", SKILL) },
  ];
}

const sameAsPackage = (dir: string) => {
  try {
    return (
      fs.readFileSync(path.join(dir, "SKILL.md"), "utf8") === fs.readFileSync(path.join(SOURCE, "SKILL.md"), "utf8")
    );
  } catch {
    return false;
  }
};

export function skillStatus(targets = skillTargets()) {
  return targets
    .filter((t) => t.present)
    .map((t) => ({ ...t, status: !fs.existsSync(t.dir) ? "missing" : sameAsPackage(t.dir) ? "current" : "outdated" }));
}

export function skillCommand(action: string | undefined, targets = skillTargets()) {
  if (action !== "install" && action !== "uninstall") throw new Error("Usage: skill install|uninstall");
  const found = targets.filter((t) => t.present);
  if (!found.length) {
    console.log(
      L(
        "Neither Claude Code nor Codex was found; nothing to do.",
        "Ne Claude Code ne Codex bulundu; yapılacak bir şey yok.",
      ),
    );
    return;
  }
  for (const { client, dir } of found) {
    if (action === "install") {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      fs.cpSync(SOURCE, dir, { recursive: true });
      console.log(L(`✓ ${client}: skill installed in ${dir}`, `✓ ${client}: skill ${dir} klasörüne kuruldu`));
    } else if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(L(`✓ ${client}: skill removed from ${dir}`, `✓ ${client}: skill ${dir} klasöründen kaldırıldı`));
    }
  }
}
