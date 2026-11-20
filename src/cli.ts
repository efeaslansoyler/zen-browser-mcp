#!/usr/bin/env node
import { configCommand, readConfig } from "./config.ts";
import { doctor } from "./doctor.ts";
import { L } from "./i18n.ts";
import { resetAgentProfile } from "./launch.ts";
import { install, uninstall } from "./install.ts";
import { stopCodexRelays } from "./codex-relay.ts";
import { configureCodexHooks, handleCodexHook } from "./codex-hooks.ts";
import { PACKAGE, VERSION, assertStableInstall } from "./paths.ts";
import { serve } from "./server.ts";
import { recipesCommand } from "./recipes.ts";
import { hooksCommand, promptHook } from "./hooks.ts";
import { skillCommand } from "./skill.ts";

import { browserResolver, parseBrowserFlags } from "./instances.ts";

const argv = process.argv.slice(2);
const [cmd, ...args] = ["--browser", "--profile", "--browser-mode"].includes(argv[0]) ? ["serve", ...argv] : argv;

function applyBrowserFlags() {
  browserResolver.flags = parseBrowserFlags(args);
}

const usage = (rows: [string, string][]) => rows.map(([cmd, what]) => `  ${cmd.padEnd(30)}  ${what}`).join("\n");
const help = L(
  `${PACKAGE} ${VERSION}: let AI agents use your Zen (or other Firefox-based) browser.

Usage:
${usage([
  [`${PACKAGE}`, "run the MCP server (your MCP client starts it this way)"],
  ["    --browser <name|dir> --profile <name|dir>", "choose a browser or profile for this MCP client"],
  ["    --browser-mode <mode>", "choose a browser mode for this MCP client"],
  [`${PACKAGE} reset-agent-profile [--browser <name|dir>]`, "delete the persistent agent profile after closing it"],
  [`${PACKAGE} install`, "install the browser part (asks for sudo if needed)"],
  ["    --browser <dir>", "a specific installation (the folder with application.ini)"],
  ["    --all", "every browser found"],
  [`${PACKAGE} uninstall`, "remove it"],
  [`${PACKAGE} doctor`, "check the setup"],
  [`${PACKAGE} skill install|uninstall`, "add the agent skill to Claude Code and Codex"],
  [
    `${PACKAGE} hooks install|uninstall`,
    "deliver browser picks with your next message (Claude Code, Codex, Antigravity CLI) or at once (OpenCode)",
  ],
  [`${PACKAGE} config`, "show or change settings (mode, site rules)"],
  [`${PACKAGE} recipes [list]|show|rm <id>`, "recipes the user showed the agent once"],
])}`,
  `${PACKAGE} ${VERSION}: AI ajanlarının Zen'i (ya da başka bir Firefox tabanlı tarayıcıyı) kullanmasını sağlar.

Kullanım:
${usage([
  [`${PACKAGE}`, "MCP sunucusunu çalıştırır (MCP istemcin böyle başlatır)"],
  ["    --browser <name|dir> --profile <name|dir>", "choose a browser or profile for this MCP client"],
  ["    --browser-mode <mode>", "choose a browser mode for this MCP client"],
  [`${PACKAGE} reset-agent-profile [--browser <name|dir>]`, "delete the persistent agent profile after closing it"],
  [`${PACKAGE} install`, "tarayıcı tarafını kurar (gerekirse sudo ister)"],
  ["    --browser <klasör>", "belirli bir kurulum (application.ini'nin olduğu klasör)"],
  ["    --all", "bulunan bütün tarayıcılar"],
  [`${PACKAGE} uninstall`, "kaldırır"],
  [`${PACKAGE} doctor`, "kurulumu kontrol eder"],
  [`${PACKAGE} skill install|uninstall`, "ajan skill'ini Claude Code ve Codex'e ekler"],
  [
    `${PACKAGE} hooks install|uninstall`,
    "tarayıcıdan gönderilenleri sonraki mesajınla (Claude Code, Codex, Antigravity CLI) ya da hemen (OpenCode) iletir",
  ],
  [`${PACKAGE} config`, "ayarları gösterir ya da değiştirir (mod, site kuralları)"],
  [`${PACKAGE} recipes [list]|show|rm <id>`, "ajana bir kez gösterdiğin tarifler"],
])}`,
);

try {
  switch (cmd) {
    case undefined:
    case "serve":
      applyBrowserFlags();
      await serve();
      break;
    case "codex-hook": {
      let input = "";
      for await (const chunk of process.stdin) {
        input += chunk;
        if (input.length > 1_048_576) throw new Error("Hook input is too large.");
      }
      const value = JSON.parse(input);
      await handleCodexHook(value);
      if (value?.hook_event_name === "UserPromptSubmit") {
        const output = await promptHook("codex", value);
        if (output) console.log(output);
      }
      break;
    }
    case "hook": {
      if (args[0] !== "claude" && args[0] !== "antigravity")
        throw new Error("Usage: zen-browser-mcp hook claude|antigravity");
      let input = "";
      for await (const chunk of process.stdin) {
        input += chunk;
        if (input.length > 1_048_576) throw new Error("Hook input is too large.");
      }
      let value: unknown = null;
      try {
        value = JSON.parse(input);
      } catch {}
      const output = await promptHook(args[0], value);
      if (output) console.log(output);
      break;
    }
    case "hooks":
      if (args[0] === "install") assertStableInstall();
      console.log(hooksCommand(args[0]));
      break;
    case "codex-hooks": {
      if (args[0] !== "install" && args[0] !== "uninstall")
        throw new Error("Usage: zen-browser-mcp codex-hooks install|uninstall");
      if (args[0] === "install") assertStableInstall();
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
      applyBrowserFlags();
      await doctor();
      break;
    case "reset-agent-profile": {
      if (args.length && (args.length !== 2 || args[0] !== "--browser"))
        throw new Error("Use: zen-browser-mcp reset-agent-profile [--browser <name|dir>]");
      const browser = parseBrowserFlags(args).browser ?? readConfig().browser;
      console.log(`✓ Agent profile reset: ${await resetAgentProfile(browser)}`);
      break;
    }
    case "config":
      configCommand(args);
      break;
    case "skill":
      skillCommand(args[0]);
      break;
    case "recipes":
      console.log(await recipesCommand(args));
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
