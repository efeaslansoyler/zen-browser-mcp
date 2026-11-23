import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { L } from "./i18n.ts";
import { PACKAGE_DIR, VERSION } from "./paths.ts";

const SKILL = "zen-browser";
const SOURCE = path.join(PACKAGE_DIR, "skills", SKILL);
const STAMP = ".installed";

// why: 0.2.0 and 0.3.0 installed the skill without a stamp.
const UNSTAMPED = new Set([
  "f736965238da35cd6809ed2347275a0bbd2127aa75b64147ffed07e366bc0b23",
  "7161bcf48104bc4a012d3976559097137146ee356c9fa5222301e2c5041621ad",
]);

export function skillTargets(home = os.homedir(), env = process.env) {
  const claude = env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
  const codex = env.CODEX_HOME || path.join(home, ".codex");
  return [
    { client: "Claude Code", present: fs.existsSync(claude), dir: path.join(claude, "skills", SKILL) },
    { client: "Codex", present: fs.existsSync(codex), dir: path.join(home, ".agents", "skills", SKILL) },
  ];
}

const hashOf = (dir: string) =>
  createHash("sha256")
    .update(fs.readFileSync(path.join(dir, "SKILL.md")))
    .digest("hex");

const stamp = (dir: string) => fs.writeFileSync(path.join(dir, STAMP), `${hashOf(SOURCE)} ${VERSION}\n`);

function stampOf(dir: string) {
  try {
    const [hash, version = "0.0.0"] = fs.readFileSync(path.join(dir, STAMP), "utf8").trim().split(" ");
    return { hash, version };
  } catch {
    return null;
  }
}

function compareVersions(a: string, b: string) {
  const [[core, pre], [otherCore, otherPre]] = [a.split("-", 2), b.split("-", 2)];
  const compare = (x = "", y = "") => x.localeCompare(y, "en", { numeric: true });
  return compare(core, otherCore) || Number(!pre) - Number(!otherPre) || compare(pre, otherPre);
}

function statusOf(dir: string): "missing" | "current" | "outdated" | "newer" | "edited" {
  if (!fs.existsSync(dir)) return "missing";
  let hash;
  try {
    hash = hashOf(dir);
  } catch {
    return "edited";
  }
  if (hash === hashOf(SOURCE)) return "current";
  if (UNSTAMPED.has(hash)) return "outdated";
  const stamped = stampOf(dir);
  if (hash !== stamped?.hash) return "edited";
  // why: Servers of several versions can share one copy, and must not replace it in turns.
  return compareVersions(stamped.version, VERSION) > 0 ? "newer" : "outdated";
}

export function skillStatus(targets = skillTargets()) {
  return targets.filter((t) => t.present).map((t) => ({ ...t, status: statusOf(t.dir) }));
}

const isLink = (file: string) => fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink();

export function refreshSkills(targets = skillTargets()) {
  for (const { dir, status } of skillStatus(targets)) {
    const file = path.join(dir, "SKILL.md");
    if ((status !== "current" && status !== "outdated") || isLink(dir) || isLink(file)) continue;
    try {
      if (status === "outdated") {
        // why: A client may read the skill at any moment, and several servers can start together.
        const next = `${file}.${process.pid}`;
        fs.copyFileSync(path.join(SOURCE, "SKILL.md"), next);
        fs.renameSync(next, file);
      }
      const stamped = stampOf(dir);
      if (stamped?.hash !== hashOf(SOURCE) || compareVersions(stamped.version, VERSION) < 0) stamp(dir);
    } catch {
      // why: A copy that can't be written must not stop the server or the other copies.
    }
  }
}

export function skillCommand(action: string | undefined, targets = skillTargets()) {
  if (action !== "install" && action !== "uninstall") throw new Error("Usage: zen-browser-mcp skill install|uninstall");
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
      stamp(dir);
      console.log(L(`✓ ${client}: skill installed in ${dir}`, `✓ ${client}: skill ${dir} klasörüne kuruldu`));
    } else if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(L(`✓ ${client}: skill removed from ${dir}`, `✓ ${client}: skill ${dir} klasöründen kaldırıldı`));
    }
  }
}
