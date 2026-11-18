// Prompt hooks: what the user sent a conversation from the browser (picks, recipes) and that
// couldn't be pushed waits in the browser's inbox. With these hooks it is added to the user's
// next message in that conversation, even when the agent never calls a browser tool again.
// Hooks are a stable feature of the clients, unlike channels; they are opt-in (`hooks install`).
//
// The hook command is `node <package>/dist/cli.js hook <client>`: it reads the hook input,
// asks the bridge for what waits for that conversation and prints it as context for the model.
// Nothing waiting, or no browser: no output, at once. The conversation is found by the client's
// own conversation ID when the MCP process knows it (Claude Code), otherwise by the client's
// process: the hook and the MCP process are both its children (Antigravity CLI).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { L } from "./i18n.ts";
import { PACKAGE_DIR } from "./paths.ts";
import { call } from "./zen.ts";
import { configureCodexHooks } from "./codex-hooks.ts";
import { ancestorPids } from "./claude.ts";
import { configureOpenCodePlugin, openCodePluginFile } from "./opencode.ts";

export type HookClient = "claude" | "codex" | "antigravity";
export const HOOK_CLIENTS: HookClient[] = ["claude", "codex", "antigravity"];

// The client's output format for context added before the model runs.
function contextOutput(client: HookClient, text: string) {
  if (client === "antigravity") return { injectSteps: [{ systemMessage: { systemMessage: text } }] };
  return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: text } };
}

// What the hook prints for this input (empty: nothing to add).
export async function promptHook(
  client: HookClient,
  value: unknown,
  browser: typeof call = call,
  pids: number[] = ancestorPids(),
): Promise<string> {
  const input = value as { session_id?: unknown; conversationId?: unknown } | null;
  if (!input || typeof input !== "object") return "";
  const id = input.session_id ?? input.conversationId;
  const clientSession = typeof id === "string" && /^[\w-]{8,100}$/.test(id) ? id : undefined;
  if (!clientSession && client !== "antigravity") return "";
  let text: string;
  try {
    const [reply] = await browser("inbox_take", { client, clientSession, pids }, 2000);
    text = reply?.type === "text" ? reply.text : "";
  } catch {
    return ""; // the browser isn't running: nothing can be waiting
  }
  return text ? JSON.stringify(contextOutput(client, text)) : "";
}

const shellQuote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export function hookCommand(client: HookClient) {
  return `${shellQuote(process.execPath)} ${shellQuote(path.join(PACKAGE_DIR, "dist/cli.js"))} hook ${client}`;
}
// ours, also from another installation path or Node version
const isOurs = (command: unknown, client: HookClient) =>
  typeof command === "string" && /dist\/cli\.js'? hook /.test(command) && command.endsWith(` hook ${client}`);

export function claudeSettingsFile(env = process.env, home = os.homedir()) {
  return path.join(env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"), "settings.json");
}

// Adds or removes our UserPromptSubmit hook in Claude Code's user settings; other hooks and
// settings stay as they are. A changed file is backed up first.
export function configureClaudeHook(action: "install" | "uninstall", file = claudeSettingsFile()) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
  const settings = existing ? JSON.parse(existing) : {};
  settings.hooks ??= {};
  const groups = (settings.hooks.UserPromptSubmit ?? [])
    .map((group: any) => ({
      ...group,
      hooks: (group.hooks ?? []).filter((hook: any) => !isOurs(hook.command, "claude")),
    }))
    .filter((group: any) => group.hooks.length);
  if (action === "install") groups.push({ hooks: [{ type: "command", command: hookCommand("claude"), timeout: 5 }] });
  if (groups.length) settings.hooks.UserPromptSubmit = groups;
  else delete settings.hooks.UserPromptSubmit;
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  const content = JSON.stringify(settings, null, 2) + "\n";
  if (content === existing) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (existing !== undefined) fs.copyFileSync(file, `${file}.zen-backup-${Date.now()}`);
  fs.writeFileSync(file, content, { mode: 0o600 });
  return file;
}

// Is our hook in Claude Code's settings (the MCP process tells the browser, for the island).
export function claudeHookInstalled(file = claudeSettingsFile()) {
  try {
    const settings = JSON.parse(fs.readFileSync(file, "utf8"));
    return (settings.hooks?.UserPromptSubmit ?? []).some((group: any) =>
      (group.hooks ?? []).some((hook: any) => isOurs(hook.command, "claude")),
    );
  } catch {
    return false;
  }
}

// Antigravity CLI: a named hook in ~/.gemini/config/hooks.json, run before each model call.
export function antigravityHooksFile(home = os.homedir()) {
  return path.join(home, ".gemini", "config", "hooks.json");
}
const ANTIGRAVITY_HOOK = "zen-browser";

export function configureAntigravityHook(action: "install" | "uninstall", file = antigravityHooksFile()) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
  const hooks = existing?.trim() ? JSON.parse(existing) : {};
  if (action === "install")
    hooks[ANTIGRAVITY_HOOK] = {
      PreInvocation: [{ type: "command", command: hookCommand("antigravity"), timeout: 5 }],
    };
  else delete hooks[ANTIGRAVITY_HOOK];
  const content = JSON.stringify(hooks, null, 2) + "\n";
  if (content === existing) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (existing !== undefined) fs.copyFileSync(file, `${file}.zen-backup-${Date.now()}`);
  fs.writeFileSync(file, content, { mode: 0o600 });
  return file;
}

export function antigravityHookInstalled(file = antigravityHooksFile()) {
  try {
    const hook = JSON.parse(fs.readFileSync(file, "utf8"))[ANTIGRAVITY_HOOK];
    return (hook?.PreInvocation ?? []).some((h: any) => isOurs(h.command, "antigravity"));
  } catch {
    return false;
  }
}

// `hooks install|uninstall`: Claude Code's and Antigravity CLI's prompt hooks, Codex's
// lifecycle hooks (which also deliver what waits) and the OpenCode plugin, for the clients
// that are installed.
export function hooksCommand(action: string | undefined, home = os.homedir(), env = process.env) {
  if (action !== "install" && action !== "uninstall") throw new Error("Usage: hooks install|uninstall");
  const lines: string[] = [];
  const claude = env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
  if (fs.existsSync(claude)) {
    const file = configureClaudeHook(action, path.join(claude, "settings.json"));
    lines.push(
      `✓ Claude Code: ${action === "install" ? L("prompt hook in", "prompt hook'u") : L("prompt hook removed from", "prompt hook'u kaldırıldı:")} ${file}`,
    );
  }
  const codex = env.CODEX_HOME || path.join(home, ".codex");
  if (fs.existsSync(codex)) {
    const file = configureCodexHooks(action, codex);
    lines.push(
      `✓ Codex: ${action === "install" ? L("hooks in", "hook'lar") : L("hooks removed from", "hook'lar kaldırıldı:")} ${file}`,
    );
    if (action === "install")
      lines.push(
        L(
          "  Review and trust the Zen hooks once in Codex with /hooks.",
          "  Codex'te bir kez /hooks ile Zen hook'larını incele ve onayla.",
        ),
      );
  }
  if (fs.existsSync(path.join(home, ".gemini", "antigravity-cli"))) {
    const file = configureAntigravityHook(action, antigravityHooksFile(home));
    lines.push(
      `✓ Antigravity CLI: ${action === "install" ? L("prompt hook in", "prompt hook'u") : L("prompt hook removed from", "prompt hook'u kaldırıldı:")} ${file}`,
    );
  }
  const opencode = openCodePluginFile(env, home);
  if (fs.existsSync(path.dirname(path.dirname(opencode)))) {
    configureOpenCodePlugin(action, opencode);
    lines.push(
      `✓ OpenCode: ${action === "install" ? L("plugin in", "plugin") : L("plugin removed:", "plugin kaldırıldı:")} ${opencode}`,
    );
  }
  if (!lines.length)
    lines.push(
      L(
        "No Claude Code, Codex, Antigravity CLI or OpenCode found.",
        "Claude Code, Codex, Antigravity CLI ya da OpenCode bulunamadı.",
      ),
    );
  return lines.join("\n");
}
