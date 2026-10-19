#!/usr/bin/env node
// Giriş noktası: argümansız MCP sunucusu (Claude Code böyle başlatır), yanında kurulum komutları
import { configCommand } from "./config.ts";
import { doctor } from "./doctor.ts";
import { L } from "./i18n.ts";
import { install, uninstall } from "./install.ts";
import { NAME, VERSION } from "./paths.ts";
import { serve } from "./server.ts";

const [cmd, ...args] = process.argv.slice(2);

const help = L(`${NAME} ${VERSION}: let Claude use your Zen (or other Firefox-based) browser.

Usage:
  npx ${NAME}                 run the MCP server (Claude Code starts it this way)
  npx ${NAME} install         install the browser part (asks for sudo if needed)
      --browser <dir>         a specific installation (the folder with application.ini)
      --all                   every browser found
  npx ${NAME} uninstall       remove it
  npx ${NAME} doctor          check the setup
  npx ${NAME} config          show or change settings (mode, sensitive sites)`,
`${NAME} ${VERSION}: Claude'un Zen'i (ya da başka bir Firefox tabanlı tarayıcıyı) kullanmasını sağlar.

Kullanım:
  npx ${NAME}                 MCP sunucusunu çalıştırır (Claude Code böyle başlatır)
  npx ${NAME} install         tarayıcı tarafını kurar (gerekirse sudo ister)
      --browser <klasör>      belirli bir kurulum (application.ini'nin olduğu klasör)
      --all                   bulunan bütün tarayıcılar
  npx ${NAME} uninstall       kaldırır
  npx ${NAME} doctor          kurulumu kontrol eder
  npx ${NAME} config          ayarları gösterir ya da değiştirir (mod, hassas siteler)`);

try {
  switch (cmd) {
    case undefined:
    case "serve":
      await serve();
      break;
    case "install":
      await install(args);
      break;
    case "uninstall":
      await uninstall(args);
      break;
    case "doctor":
      await doctor();
      break;
    case "config":
      configCommand(args);
      break;
    case "--version":
    case "-v":
      console.log(VERSION);
      break;
    case "help":
    case "--help":
    case "-h":
      console.log(help);
      break;
    default:
      console.error(help);
      process.exitCode = 1;
  }
} catch (e) {
  console.error(`✗ ${(e as Error).message}`);
  process.exitCode = 1;
}
