// why: Session hooks carry host metadata that must never be inferred from page output.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { THREAD_ID } from "./delivery.ts";
import { ensureCodexRelay, stopCodexRelays } from "./codex-relay.ts";
import { ensureCodexWatch } from "./codex-watch.ts";
import { PACKAGE_DIR } from "./paths.ts";

export type CodexHookInput = { session_id: string; cwd: string; hook_event_name: string };
export function parseHookInput(value: unknown): CodexHookInput {
  const input = value as Partial<CodexHookInput> | null;
  if (
    !input ||
    typeof input.session_id !== "string" ||
    !THREAD_ID.test(input.session_id) ||
    typeof input.cwd !== "string" ||
    !path.isAbsolute(input.cwd) ||
    !["SessionStart", "SessionEnd", "UserPromptSubmit"].includes(input.hook_event_name ?? "")
  ) {
    throw new Error("Invalid Codex lifecycle metadata; exact session UUID and absolute cwd are required.");
  }
  return input as CodexHookInput;
}

export async function handleCodexHook(value: unknown) {
  const input = parseHookInput(value);
  if (input.hook_event_name === "SessionEnd") {
    await stopCodexRelays({ threadId: input.session_id });
  } else if (!(await ensureCodexWatch(undefined, input.session_id).catch(() => false))) {
    await ensureCodexRelay({ threadId: input.session_id, cwd: input.cwd });
  }
}

const description = "Zen MCP: automatically connect this Codex conversation to the browser.";
const shellQuote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export function codexHookCommand() {
  return `${shellQuote(process.execPath)} ${shellQuote(path.join(PACKAGE_DIR, "dist/cli.js"))} codex-hook`;
}

export function configureCodexHooks(
  action: "install" | "uninstall",
  codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
) {
  const file = path.join(codexHome, "hooks.json");
  fs.mkdirSync(codexHome, { recursive: true });
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
  const config = existing ? JSON.parse(existing) : {};
  config.hooks ??= {};
  const command = codexHookCommand();
  for (const event of ["SessionStart", "UserPromptSubmit", "SessionEnd"]) {
    const groups = config.hooks[event] ?? [];
    // why: Keep other handlers, including those stored in the same group.
    const kept = groups
      .map((group: any) => ({
        ...group,
        hooks: (group.hooks ?? []).filter(
          (hook: any) =>
            !(
              hook.command === command ||
              (hook.statusMessage === description && String(hook.command).endsWith(" codex-hook"))
            ),
        ),
      }))
      .filter((group: any) => group.hooks.length);
    if (action === "install")
      kept.push({ hooks: [{ type: "command", command, timeout: 5, statusMessage: description }] });
    if (kept.length) config.hooks[event] = kept;
    else delete config.hooks[event];
  }
  const content = JSON.stringify(config, null, 2) + "\n";
  if (content === existing) return file;
  if (existing !== undefined) fs.copyFileSync(file, `${file}.zen-backup-${Date.now()}`);
  fs.writeFileSync(file, content, { mode: 0o600 });
  return file;
}
