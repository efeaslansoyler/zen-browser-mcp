// why: Node and Gecko must compute the same paths from the same environment.
import os from "node:os";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

export const PACKAGE = "zen-browser-mcp";
// why: Keep the on-disk name stable independently of npm branding so upgrades preserve settings.
export const NAME = "zen-mcp";
// why: Match the suggested server name when identifying the client's enabled channel.
export const SERVER_NAME = "zen";

const home = os.homedir();
const env = process.env;

export const DATA_DIR = path.join(env.XDG_DATA_HOME || path.join(home, ".local/share"), NAME);
export const CONFIG_FILE = path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), NAME, "config.json");
// why: The browser rewrites config.json and must leave the user's custom policy file alone.
export const PERMISSIONS_FILE = path.join(path.dirname(CONFIG_FILE), "permissions.jsonc");
export const STATE_DIR = path.join(env.XDG_STATE_HOME || path.join(home, ".local/state"), NAME);
// why: Installations replace DATA_DIR, so keep recipes elsewhere.
export const RECIPES_DIR = path.join(STATE_DIR, "recipes");
// why: Desktop clients may omit XDG_RUNTIME_DIR; prefer the existing per-user directory.
const userRuntime = process.platform === "linux" && process.getuid ? `/run/user/${process.getuid()}` : undefined;
export const RUNTIME_DIR =
  env.XDG_RUNTIME_DIR || (userRuntime && existsSync(userRuntime) ? userRuntime : undefined) || env.TMPDIR || "/tmp";
// why: Namespace the runtime path by user when falling back to a shared temp directory.
const runtimeSuffix = /\/(?:var\/)?tmp\/?$/.test(RUNTIME_DIR)
  ? "-" + [...home].reduce((hash, c) => (Math.imul(hash, 31) + c.codePointAt(0)!) >>> 0, 0).toString(16)
  : "";
export const INSTANCES_DIR = path.join(RUNTIME_DIR, NAME + runtimeSuffix);
export const LEGACY_SOCKET = path.join(RUNTIME_DIR, `${NAME}.sock`);
export const LOG_FILE = path.join(RUNTIME_DIR, `${NAME}.log`);

export const PACKAGE_DIR = path.resolve(import.meta.dirname, "..");

// why: npx keeps packages in a cache it may clean or reuse, so hooks pointing there break later.
export function assertStableInstall(dir = PACKAGE_DIR) {
  if (dir.split(path.sep).includes("_npx"))
    throw new Error(
      `Hooks need a lasting install, not the npx cache. Run \`npm install -g ${PACKAGE}\`, then \`${PACKAGE} hooks install\`.`,
    );
}
export const VERSION: string = JSON.parse(readFileSync(path.join(PACKAGE_DIR, "package.json"), "utf8")).version;
