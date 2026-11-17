// The package name and user-visible paths in one place: renaming the paths changes only this
// file (and the zenMcpName the loader passes to browser/main.js). The browser side computes the same paths
// from the same environment variables; the XDG layout is used on every platform.
import os from "node:os";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

// The npm package: what users type after npx.
export const PACKAGE = "zen-browser-mcp";
// The name on disk and in the browser (folders, socket, log, loader markers). It differs from
// the package name on purpose: changing it would move every user's files and settings.
export const NAME = "zen-mcp";
// The suggested server name in Claude Code: the channel flag "server:<name>" matches it
export const SERVER_NAME = "zen";

const home = os.homedir();
const env = process.env;

// the browser-side files (browser/): the loader loads from here
export const DATA_DIR = path.join(env.XDG_DATA_HOME || path.join(home, ".local/share"), NAME);
export const CONFIG_FILE = path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), NAME, "config.json");
export const STATE_DIR = path.join(env.XDG_STATE_HOME || path.join(home, ".local/state"), NAME);
// "show me once" recipes; not in DATA_DIR, which installs replace
export const RECIPES_DIR = path.join(STATE_DIR, "recipes");
// Desktop MCP clients may not inherit the login session's XDG_RUNTIME_DIR.
// On Linux, use the existing per-user runtime directory before falling back to tmp.
const userRuntime = process.platform === "linux" && process.getuid ? `/run/user/${process.getuid()}` : undefined;
export const RUNTIME_DIR =
  env.XDG_RUNTIME_DIR || (userRuntime && existsSync(userRuntime) ? userRuntime : undefined) || env.TMPDIR || "/tmp";
export const SOCKET = env.ZEN_MCP_SOCKET || path.join(RUNTIME_DIR, `${NAME}.sock`);
export const LOG_FILE = path.join(RUNTIME_DIR, `${NAME}.log`);

// the package root (the parent of src/ or dist/): browser/ and package.json live here
export const PACKAGE_DIR = path.resolve(import.meta.dirname, "..");
export const VERSION: string = JSON.parse(readFileSync(path.join(PACKAGE_DIR, "package.json"), "utf8")).version;
