// Install: copies the browser-side files to DATA_DIR and puts an autoconfig loader into the
// browser's installation folder. If the browser already has an autoconfig (the user's own,
// Sine, fx-autoconfig…), a marked block is appended to its .cfg file; otherwise our own files
// are created. The installation folder usually belongs to root: sudo is used if it isn't writable.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { L } from "./i18n.ts";
import { DATA_DIR, NAME, PACKAGE, PACKAGE_DIR, SERVER_NAME, VERSION } from "./paths.ts";
import { call } from "./zen.ts";

const BEGIN = `// BEGIN ${NAME}`;
const END = `// END ${NAME}`;
// an old, unmarked loader added by hand (development setup)
const LEGACY = "resource://zenmcp/main.js";

export type Browser = { name: string; dir: string };

// The loader: loads main.js with system privileges if DATA_DIR exists. The path is computed
// from environment variables at run time (the same way as src/paths.ts).
function loaderBlock() {
  return `${BEGIN}: loads ${PACKAGE} (browser bridge for AI agents). Remove with \`npx ${PACKAGE} uninstall\`.
try {
  const { classes: Cc, interfaces: Ci } = Components;
  const dir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  dir.initWithPath((Services.env.get("XDG_DATA_HOME") || Services.env.get("HOME") + "/.local/share") + "/${NAME}");
  if (dir.exists()) {
    // the content sandbox sees the real path, not a symlink
    dir.normalize();
    // loadSubScript rejects file:// URIs, so map the folder to resource://
    Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler)
      .setSubstitution("zenmcp", Services.io.newFileURI(dir));
    Services.scriptloader.loadSubScript("resource://zenmcp/main.js", { zenMcpDir: dir.path, zenMcpName: "${NAME}" });
  }
} catch (e) {
  Components.utils.reportError(e);
}
${END}
`;
}

// ---- finding browsers ----

// a folder with application.ini is a Gecko installation
export function browserAt(dir: string): Browser | null {
  try {
    const ini = fs.readFileSync(path.join(dir, "application.ini"), "utf8");
    const name = /^Name=(.+)$/m.exec(ini)?.[1]?.trim() ?? path.basename(dir);
    return { name, dir };
  } catch {
    return null;
  }
}

export function findBrowsers(): Browser[] {
  const home = os.homedir();
  const dirs: string[] = [];
  if (process.platform === "darwin") {
    for (const app of [
      "Zen",
      "Zen Browser",
      "Firefox",
      "Firefox Developer Edition",
      "Firefox Nightly",
      "LibreWolf",
      "Floorp",
      "Waterfox",
    ]) {
      for (const base of ["/Applications", path.join(home, "Applications")]) {
        dirs.push(path.join(base, `${app}.app`, "Contents", "Resources"));
      }
    }
  } else {
    dirs.push(
      "/opt/zen-browser-bin",
      "/opt/zen-browser",
      "/opt/zen",
      "/usr/lib/zen-browser",
      "/usr/lib64/zen-browser",
      path.join(home, ".tarball-installations", "zen"),
      "/usr/lib/firefox",
      "/usr/lib64/firefox",
      "/opt/firefox",
      "/usr/lib/firefox-developer-edition",
      "/usr/lib/librewolf",
      "/opt/librewolf",
      "/opt/floorp",
      "/usr/lib/floorp",
      "/opt/waterfox",
      "/usr/lib/waterfox",
    );
    // executables on PATH (usually links into the installation folder)
    for (const bin of ["zen-browser", "zen", "firefox", "librewolf", "floorp", "waterfox"]) {
      for (const p of (process.env.PATH ?? "").split(":")) {
        try {
          const real = fs.realpathSync(path.join(p, bin));
          dirs.push(path.dirname(real));
        } catch {}
      }
    }
  }
  const seen = new Set<string>();
  const found: Browser[] = [];
  for (const dir of dirs) {
    let real: string;
    try {
      real = fs.realpathSync(dir);
    } catch {
      continue;
    }
    if (seen.has(real)) continue;
    seen.add(real);
    const browser = browserAt(real);
    if (browser) found.push(browser);
  }
  // Zen first
  return found.sort((a, b) => Number(/zen/i.test(b.name)) - Number(/zen/i.test(a.name)));
}

// Flatpak/Snap installations are read-only: no autoconfig possible
export function unsupportedInstalls(): string[] {
  const out: string[] = [];
  for (const [id, label] of [
    ["app.zen_browser.zen", "Zen (Flatpak)"],
    ["org.mozilla.firefox", "Firefox (Flatpak)"],
  ]) {
    if (spawnSync("flatpak", ["info", id], { stdio: "ignore" }).status === 0) out.push(label);
  }
  if (fs.existsSync("/snap/firefox")) out.push("Firefox (Snap)");
  return out;
}

// ---- loader state ----

type Plan = { writes: { file: string; content: string }[]; status: "new" | "append" | "update" | "legacy" };

const PREF = (name: string) => new RegExp(`pref\\(\\s*["']${name.replace(/\./g, "\\.")}["']\\s*,\\s*([^)]+)\\)`);

// does the browser already have an autoconfig: general.config.filename in defaults/pref/*.js
function existingAutoconfig(dir: string) {
  const prefsDir = path.join(dir, "defaults", "pref");
  let files: string[] = [];
  try {
    files = fs.readdirSync(prefsDir).filter((f) => f.endsWith(".js"));
  } catch {}
  for (const f of files) {
    const text = fs.readFileSync(path.join(prefsDir, f), "utf8");
    const filename = PREF("general.config.filename")
      .exec(text)?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "");
    if (!filename) continue;
    return {
      cfg: path.join(dir, filename),
      obscure: PREF("general.config.obscure_value").exec(text)?.[1]?.trim(),
      sandbox: PREF("general.config.sandbox_enabled").exec(text)?.[1]?.trim(),
    };
  }
  return null;
}

export function loaderStatus(dir: string): "installed" | "legacy" | "missing" {
  const existing = existingAutoconfig(dir);
  if (!existing) return "missing";
  let text: string;
  try {
    text = fs.readFileSync(existing.cfg, "utf8");
  } catch {
    return "missing";
  }
  if (text.includes(BEGIN)) return "installed";
  return text.includes(LEGACY) ? "legacy" : "missing";
}

function planInstall(dir: string): Plan {
  const existing = existingAutoconfig(dir);
  const block = loaderBlock();
  if (!existing) {
    return {
      status: "new",
      writes: [
        {
          file: path.join(dir, "defaults", "pref", `${NAME}-prefs.js`),
          content: `// ${NAME}: loads ${NAME}.cfg (autoconfig). Remove with \`npx ${PACKAGE} uninstall\`.\npref("general.config.filename", "${NAME}.cfg");\npref("general.config.obscure_value", 0);\npref("general.config.sandbox_enabled", false);\n`,
        },
        // autoconfig skips the first line of the .cfg file
        { file: path.join(dir, `${NAME}.cfg`), content: `// ${NAME} autoconfig (the first line is skipped)\n${block}` },
      ],
    };
  }
  if (existing.obscure !== "0") {
    throw new Error(
      L(
        `The existing autoconfig (${existing.cfg}) is obfuscated (general.config.obscure_value is not 0); add the loader by hand.`,
        `Mevcut autoconfig (${existing.cfg}) şifreli (general.config.obscure_value 0 değil); yükleyiciyi elle ekle.`,
      ),
    );
  }
  if (existing.sandbox !== "false") {
    throw new Error(
      L(
        `The existing autoconfig runs sandboxed (general.config.sandbox_enabled is not false), so ${PACKAGE} can't load from it.`,
        `Mevcut autoconfig sandbox'ta çalışıyor (general.config.sandbox_enabled false değil); ${PACKAGE} oradan yüklenemez.`,
      ),
    );
  }
  let text = "// autoconfig (the first line is skipped)\n";
  try {
    text = fs.readFileSync(existing.cfg, "utf8");
  } catch {}
  if (text.includes(BEGIN)) {
    const start = text.indexOf(BEGIN);
    const end = text.indexOf(END, start);
    const after = end < 0 ? text.length : end + END.length + 1;
    return {
      status: "update",
      writes: [{ file: existing.cfg, content: text.slice(0, start) + block + text.slice(after) }],
    };
  }
  if (text.includes(LEGACY)) return { status: "legacy", writes: [] };
  return { status: "append", writes: [{ file: existing.cfg, content: text.replace(/\n*$/, "\n\n") + block }] };
}

function planUninstall(dir: string): string[] | { file: string; content: string }[] {
  const ours = [path.join(dir, "defaults", "pref", `${NAME}-prefs.js`), path.join(dir, `${NAME}.cfg`)];
  if (ours.some((f) => fs.existsSync(f))) return ours.filter((f) => fs.existsSync(f));
  const existing = existingAutoconfig(dir);
  if (!existing) return [];
  const text = fs.readFileSync(existing.cfg, "utf8");
  const start = text.indexOf(BEGIN);
  if (start < 0) return [];
  const end = text.indexOf(END, start);
  const after = end < 0 ? text.length : end + END.length + 1;
  return [{ file: existing.cfg, content: text.slice(0, start).replace(/\n+$/, "\n") + text.slice(after) }];
}

// ---- writing files: directly, or with sudo ----

function writeFiles(writes: { file: string; content: string }[]) {
  const needSudo: { file: string; content: string }[] = [];
  for (const w of writes) {
    try {
      fs.mkdirSync(path.dirname(w.file), { recursive: true });
      fs.writeFileSync(w.file, w.content);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EACCES" && (e as NodeJS.ErrnoException).code !== "EPERM") throw e;
      needSudo.push(w);
    }
  }
  if (!needSudo.length) return;
  console.log(
    L(
      "The browser folder belongs to root; sudo will ask for your password.",
      "Tarayıcı klasörü root'un; sudo şifreni soracak.",
    ),
  );
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${NAME}-`));
  try {
    for (const [i, w] of needSudo.entries()) {
      const src = path.join(tmp, String(i));
      fs.writeFileSync(src, w.content);
      const r = spawnSync("sudo", ["install", "-D", "-m", "644", src, w.file], { stdio: "inherit" });
      if (r.status !== 0) throw new Error(L(`Could not write ${w.file}.`, `${w.file} yazılamadı.`));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function removeFiles(files: string[]) {
  for (const f of files) {
    try {
      fs.rmSync(f);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      if (spawnSync("sudo", ["rm", "-f", f], { stdio: "inherit" }).status !== 0)
        throw new Error(L(`Could not remove ${f}.`, `${f} silinemedi.`), { cause: e });
    }
  }
}

// ---- browser-side files ----

// a symlinked DATA_DIR is a development setup: left alone
const isDevLink = () => {
  try {
    return fs.lstatSync(DATA_DIR).isSymbolicLink();
  } catch {
    return false;
  }
};

export function installedVersion(): string | null {
  if (isDevLink()) return "dev";
  try {
    return fs.readFileSync(path.join(DATA_DIR, ".version"), "utf8").trim();
  } catch {
    return null;
  }
}

function copyBrowserFiles() {
  if (isDevLink()) return;
  const tmp = `${DATA_DIR}.new`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.cpSync(path.join(PACKAGE_DIR, "browser"), tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, ".version"), VERSION + "\n");
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.renameSync(tmp, DATA_DIR);
}

// On server start: installed files older than this package (e.g. npx fetched a new version)
// are updated and the bridge reloads; no browser restart or sudo needed.
export async function syncBrowserFiles() {
  const installed = installedVersion();
  if (!installed || installed === "dev" || installed === VERSION) return;
  copyBrowserFiles();
  await call("reload", {}, 10_000).catch(() => {});
}

// ---- komutlar ----

function chooseBrowsers(args: string[]): Browser[] {
  const flag = args.indexOf("--browser");
  if (flag >= 0) {
    const dir = args[flag + 1];
    const browser = dir && browserAt(path.resolve(dir.replace(/^~/, os.homedir())));
    if (!browser)
      throw new Error(
        L(
          `No Firefox-based browser installation at ${dir} (application.ini not found).`,
          `${dir} bir Firefox tabanlı tarayıcı kurulumu değil (application.ini yok).`,
        ),
      );
    return [browser];
  }
  const found = findBrowsers();
  if (!found.length) {
    const flatpak = unsupportedInstalls();
    throw new Error(
      L(
        "No supported browser installation found. Pass its folder with --browser <dir> (the one containing application.ini).",
        "Desteklenen bir tarayıcı kurulumu bulunamadı. Klasörünü --browser <klasör> ile ver (application.ini'nin olduğu klasör).",
      ) +
        (flatpak.length
          ? "\n" +
            L(
              `Flatpak/Snap installations can't be supported (read-only): ${flatpak.join(", ")}`,
              `Flatpak/Snap kurulumları desteklenemiyor (salt okunur): ${flatpak.join(", ")}`,
            )
          : ""),
    );
  }
  return found;
}

export async function install(args: string[]) {
  const browsers = chooseBrowsers(args);
  for (const browser of browsers) {
    const plan = planInstall(browser.dir);
    writeFiles(plan.writes);
    const what = {
      new: L("added an autoconfig loader", "autoconfig yükleyicisi eklendi"),
      append: L("added a block to the existing autoconfig", "mevcut autoconfig'e blok eklendi"),
      update: L("updated the loader block", "yükleyici bloğu güncellendi"),
      legacy: L(
        "already loaded by a custom block, left as is",
        "zaten elle eklenmiş bir blokla yükleniyor, dokunulmadı",
      ),
    }[plan.status];
    console.log(`✓ ${browser.name}: ${what}`);
  }
  if (isDevLink())
    console.log(
      L(
        `✓ ${DATA_DIR} is a symlink (development setup), not touched`,
        `✓ ${DATA_DIR} bir bağ (geliştirme kurulumu), dokunulmadı`,
      ),
    );
  else {
    copyBrowserFiles();
    console.log(L(`✓ browser files copied to ${DATA_DIR}`, `✓ tarayıcı dosyaları ${DATA_DIR} klasörüne kopyalandı`));
  }
  if (browsers.length > 1)
    console.log(`Choose a browser with: npx ${PACKAGE} config browser <name|dir> [--profile <name>]`);
  console.log(
    L(
      `
Next:
  1. Restart the browser (the loader runs at startup).
  2. Add the MCP server to your client:
       claude mcp add --scope user ${SERVER_NAME} -- npx -y ${PACKAGE}
       codex mcp add ${SERVER_NAME} -- npx -y ${PACKAGE}
  3. Optional, to send page elements from the browser to Claude Code (channels, research preview):
       claude --dangerously-load-development-channels server:${SERVER_NAME}
Check everything with: npx ${PACKAGE} doctor`,
      `
Sırada:
  1. Tarayıcıyı yeniden başlat (yükleyici açılışta çalışır).
  2. MCP sunucusunu istemcine ekle:
       claude mcp add --scope user ${SERVER_NAME} -- npx -y ${PACKAGE}
       codex mcp add ${SERVER_NAME} -- npx -y ${PACKAGE}
  3. İsteğe bağlı, tarayıcıdan öğe seçip Claude Code'a göndermek için (channels, araştırma önizlemesi):
       claude --dangerously-load-development-channels server:${SERVER_NAME}
Hepsini kontrol etmek için: npx ${PACKAGE} doctor`,
    ),
  );
}

export async function uninstall(args: string[]) {
  const browsers = args.includes("--browser") ? chooseBrowsers(args) : findBrowsers();
  for (const browser of browsers) {
    const plan = planUninstall(browser.dir);
    if (!plan.length) continue;
    if (typeof plan[0] === "string") removeFiles(plan as string[]);
    else writeFiles(plan as { file: string; content: string }[]);
    console.log(L(`✓ ${browser.name}: loader removed`, `✓ ${browser.name}: yükleyici kaldırıldı`));
  }
  if (!isDevLink()) {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    console.log(L(`✓ ${DATA_DIR} removed`, `✓ ${DATA_DIR} silindi`));
  }
  console.log(
    L(
      "Restart the browser to unload it. Settings and the activity log are kept in ~/.config and ~/.local/state.",
      "Tamamen çıkması için tarayıcıyı yeniden başlat. Ayarlar ve etkinlik günlüğü ~/.config ve ~/.local/state'te kalır.",
    ),
  );
}
