import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { STATE_DIR } from "./paths.ts";

// Resolve symlinked XDG roots even when this installation has no profile yet.
function realDirectory(dir: string): string {
  try {
    return fs.realpathSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return path.join(realDirectory(path.dirname(dir)), path.basename(dir));
  }
}

export const PROFILES_DIR = realDirectory(path.resolve(STATE_DIR, "profiles"));
export const TEMPORARY_DIR = path.join(PROFILES_DIR, "temporary");
export const profileOwner = randomUUID();

export function agentProfile(installationDir: string) {
  const name = path
    .basename(installationDir)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  const hash = createHash("sha256").update(installationDir).digest("hex").slice(0, 16);
  return path.join(PROFILES_DIR, `${name}-${hash}`, "agent");
}

export function isManagedProfile(profile: string) {
  const [group, name, ...rest] = path.relative(PROFILES_DIR, profile).split(path.sep);
  return !rest.length && (group === "temporary" || (group !== ".." && name === "agent"));
}

export function alive(pid: number) {
  if (!Number.isSafeInteger(pid) || pid < 1 || pid > 0x7fffffff) return false;
  try {
    process.kill(pid, 0);
    if (process.platform === "linux") {
      const status = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      if (status.slice(status.lastIndexOf(")") + 2).startsWith("Z")) return false;
    }
    return true;
  } catch (error) {
    return !["ESRCH", "ENOENT"].includes((error as NodeJS.ErrnoException).code ?? "");
  }
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

function linkTarget(file: string) {
  try {
    return fs.readlinkSync(file);
  } catch (error) {
    if (!missing(error) && (error as NodeJS.ErrnoException).code !== "EINVAL") throw error;
  }
}

// Gecko leaves the fcntl lock file on disk after exit. Check the holder, not file existence.
export function geckoProfileInUse(profile: string) {
  const locks = [".parentlock", "lock"].map((name) => path.join(profile, name));
  for (const lock of locks) {
    const stat = fs.lstatSync(lock, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) {
      const pid = /:\+?(\d+)$/.exec(linkTarget(lock) ?? "")?.[1];
      if (pid && alive(Number(pid))) return true;
    } else if (stat?.isFile()) {
      if (process.platform === "linux") {
        if (new RegExp(`:${stat.ino}\\s`).test(fs.readFileSync("/proc/locks", "utf8"))) return true;
      } else if (process.platform === "darwin") {
        const result = spawnSync("/usr/sbin/lsof", ["-t", lock], { encoding: "utf8" });
        if (result.status !== 1 || result.stderr) return true;
      } else return true;
    }
  }
  return false;
}

// Serialize managed startup with reset, including the interval before Gecko locks the profile.
export function reserveAgentProfile(profile: string) {
  const file = path.join(path.dirname(profile), "starting");
  const owner = `${process.pid}:${randomUUID()}`;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    fs.symlinkSync(owner, file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const previous = linkTarget(file);
    if (previous && !alive(Number(previous.split(":")[0])) && linkTarget(file) === previous)
      fs.rmSync(file, { force: true });
    return undefined;
  }
  return () => {
    if (linkTarget(file) === owner) fs.rmSync(file, { force: true });
  };
}

const PREFS = {
  "zen.welcome-screen.seen": true,
  "browser.aboutwelcome.enabled": false,
  "browser.shell.checkDefaultBrowser": false,
  "browser.startup.page": 0,
  "browser.startup.homepage_override.mstone": "ignore",
  "browser.sessionstore.resume_from_crash": false,
  "datareporting.policy.dataSubmissionEnabled": false,
  "datareporting.healthreport.uploadEnabled": false,
  "toolkit.telemetry.enabled": false,
};

export function prepareProfile(profile: string) {
  fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
  const prefs = Object.entries(PREFS).map(
    ([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});\n`,
  );
  try {
    fs.writeFileSync(path.join(profile, "user.js"), prefs.join(""), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

export function createTemporaryProfile() {
  fs.mkdirSync(TEMPORARY_DIR, { recursive: true, mode: 0o700 });
  return fs.mkdtempSync(path.join(TEMPORARY_DIR, `${process.pid}-`));
}

export function recordTemporaryBrowser(profile: string, pid: number) {
  fs.writeFileSync(path.join(profile, "browser.pid"), String(pid), { mode: 0o600 });
}

export function removeProfile(profile: string) {
  fs.rmSync(profile, { force: true, recursive: true });
}

export function sweepTemporaryProfiles() {
  let entries;
  try {
    entries = fs.readdirSync(TEMPORARY_DIR, { withFileTypes: true });
  } catch (error) {
    if (missing(error)) return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+-[a-zA-Z0-9]{6}$/.test(entry.name)) continue;
    if (alive(Number(entry.name.split("-")[0]))) continue;
    const profile = path.join(TEMPORARY_DIR, entry.name);
    try {
      if (alive(Number(fs.readFileSync(path.join(profile, "browser.pid"), "utf8")))) continue;
    } catch (error) {
      if (!missing(error)) throw error;
      // The spawning process may have died before recording a browser that is still starting.
      const stat = fs.lstatSync(profile, { throwIfNoEntry: false });
      if (stat && Date.now() - stat.mtimeMs < 60_000) continue;
    }
    if (!geckoProfileInUse(profile)) removeProfile(profile);
  }
}
