#!/usr/bin/env node
// Entry point: without arguments the MCP server (how MCP clients start it), plus setup commands
import { configCommand } from "./config.ts";
import { doctor } from "./doctor.ts";
import { L } from "./i18n.ts";
import { install, uninstall } from "./install.ts";
import { stopCodexRelays } from "./codex-relay.ts";
import { configureCodexHooks, handleCodexHook } from "./codex-hooks.ts";
import { PACKAGE, VERSION } from "./paths.ts";
import { serve } from "./server.ts";

const [cmd, ...args] = process.argv.slice(2);

// Usage lines: [command, description], the descriptions aligned in one column.
const usage = (rows: [string, string][]) => rows.map(([cmd, what]) => `  ${cmd.padEnd(30)}  ${what}`).join("\n");
const help = L(
  `${PACKAGE} ${VERSION}: let AI agents use your Zen (or other Firefox-based) browser.

Usage:
${usage([
  [`npx ${PACKAGE}`, "run the MCP server (your MCP client starts it this way)"],
  [`npx ${PACKAGE} install`, "install the browser part (asks for sudo if needed)"],
  ["    --browser <dir>", "a specific installation (the folder with application.ini)"],
  ["    --all", "every browser found"],
  [`npx ${PACKAGE} uninstall`, "remove it"],
  [`npx ${PACKAGE} doctor`, "check the setup"],
  [`npx ${PACKAGE} codex-hooks install|uninstall`, "manage automatic Codex chat connection"],
  [`npx ${PACKAGE} config`, "show or change settings (mode, site rules)"],
])}`,
  `${PACKAGE} ${VERSION}: AI ajanlarının Zen'i (ya da başka bir Firefox tabanlı tarayıcıyı) kullanmasını sağlar.

Kullanım:
${usage([
  [`npx ${PACKAGE}`, "MCP sunucusunu çalıştırır (MCP istemcin böyle başlatır)"],
  [`npx ${PACKAGE} install`, "tarayıcı tarafını kurar (gerekirse sudo ister)"],
  ["    --browser <klasör>", "belirli bir kurulum (application.ini'nin olduğu klasör)"],
  ["    --all", "bulunan bütün tarayıcılar"],
  [`npx ${PACKAGE} uninstall`, "kaldırır"],
  [`npx ${PACKAGE} doctor`, "kurulumu kontrol eder"],
  [`npx ${PACKAGE} codex-hooks install|uninstall`, "otomatik Codex sohbet bağlantısını yönetir"],
  [`npx ${PACKAGE} config`, "ayarları gösterir ya da değiştirir (mod, site kuralları)"],
])}`,
);

try {
  switch (cmd) {
    case undefined:
    case "serve":
      await serve();
      break;
    case "codex-hook": {
      let input = "";
      for await (const chunk of process.stdin) {
        input += chunk;
        if (input.length > 1_048_576) throw new Error("Hook input is too large.");
      }
      await handleCodexHook(JSON.parse(input));
      break;
    }
    case "codex-hooks": {
      if (args[0] !== "install" && args[0] !== "uninstall")
        throw new Error("Usage: zen-browser-mcp codex-hooks install|uninstall");
      console.log(configureCodexHooks(args[0]));
      if (args[0] === "uninstall") await stopCodexRelays();
      if (args[0] === "install")
        console.log(
          "Review and trust the Zen MCP lifecycle hooks once in Codex with /hooks. No hook trust is bypassed.",
        );
      break;
    }
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
