// Paketin adı ve kullanıcıya görünen yollar tek yerde: isim değişince yalnız burası (ve
// browser/main.js'e yükleyicinin verdiği zenMcpName) değişir. Tarayıcı tarafı aynı yolları
// aynı ortam değişkenlerinden hesaplar; bütün platformlarda XDG düzeni kullanılır.
import os from "node:os";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

export const NAME = "zen-mcp";
// Claude Code'da önerilen sunucu adı: kanal bayrağı "server:<ad>" bununla eşleşir
export const SERVER_NAME = "zen";

const home = os.homedir();
const env = process.env;

// tarayıcı tarafı dosyaları (browser/): yükleyici buradan yükler
export const DATA_DIR = path.join(env.XDG_DATA_HOME || path.join(home, ".local/share"), NAME);
export const CONFIG_FILE = path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), NAME, "config.json");
export const STATE_DIR = path.join(env.XDG_STATE_HOME || path.join(home, ".local/state"), NAME);
// Desktop MCP clients may not inherit the login session's XDG_RUNTIME_DIR.
// On Linux, use the existing per-user runtime directory before falling back to tmp.
const userRuntime = process.platform === "linux" && process.getuid
  ? `/run/user/${process.getuid()}`
  : undefined;
export const RUNTIME_DIR = env.XDG_RUNTIME_DIR
  || (userRuntime && existsSync(userRuntime) ? userRuntime : undefined)
  || env.TMPDIR
  || "/tmp";
export const SOCKET = env.ZEN_MCP_SOCKET || path.join(RUNTIME_DIR, `${NAME}.sock`);
export const LOG_FILE = path.join(RUNTIME_DIR, `${NAME}.log`);

// paketin kökü (src/ ya da dist/ bir üstü): browser/ ve package.json burada
export const PACKAGE_DIR = path.resolve(import.meta.dirname, "..");
export const VERSION: string = JSON.parse(readFileSync(path.join(PACKAGE_DIR, "package.json"), "utf8")).version;
