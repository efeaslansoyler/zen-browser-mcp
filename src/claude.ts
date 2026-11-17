// Facts about the Claude Code process that started this server: whether it opened the server
// as a channel, and the current conversation's title.
import { execFileSync } from "node:child_process";
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NAME, SERVER_NAME } from "./paths.ts";

// Did Claude Code open this server as a channel: --dangerously-load-development-channels (or
// --channels) with server:zen (or the package name) on its command line. Without a channel,
// events are dropped silently; then we don't subscribe and Zen copies picks to the clipboard.
// ZEN_MCP_CHANNEL=1/0 overrides the check.
export function channelEnabled(): boolean {
  if (process.env.ZEN_MCP_CHANNEL) return process.env.ZEN_MCP_CHANNEL === "1";
  let pid = process.ppid;
  for (let i = 0; i < 3 && pid > 1; i++) {
    const proc = processInfo(pid);
    if (!proc) return false;
    if (proc.args.some((a) => /^--(dangerously-load-development-)?channels\b/.test(a))) return channelArgs(proc.args);
    pid = proc.ppid;
  }
  return false;
}

// The channel flags of a Claude Code command line. Claude Code ignores them in -p mode and under
// the Agent SDK (stream-json input, as T3 Code and other apps start it), so there is no channel.
export function channelArgs(args: string[]): boolean {
  const names = new Set([`server:${SERVER_NAME}`, `server:${NAME}`]);
  const headless = args.some(
    (a, i) =>
      a === "-p" ||
      a === "--print" ||
      a === "--input-format=stream-json" ||
      (a === "--input-format" && args[i + 1] === "stream-json"),
  );
  return !headless && args.some((a) => a.split(/[\s,=]+/).some((t) => names.has(t)));
}

// A process's arguments and parent: /proc on Linux, ps on macOS (arguments split at spaces).
function processInfo(pid: number): { args: string[]; ppid: number } | null {
  try {
    const args = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
    // /proc/<pid>/stat: "pid (name) state ppid ..."
    const ppid = Number(readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ")[1]);
    return { args, ppid };
  } catch {}
  try {
    const out = execFileSync("ps", ["-o", "ppid=,args=", "-p", String(pid)], { encoding: "utf8" }).trim();
    const [ppid, ...args] = out.split(/\s+/);
    return { args, ppid: Number(ppid) };
  } catch {
    return null;
  }
}

// The Claude Code conversation's title (as listed by `claude -r`): the /rename name, otherwise
// the automatic title. The MCP server is Claude's child; the current conversation (also after
// /clear or -r) is in ~/.claude/sessions/<pid>.json. Undocumented format: if it can't be read,
// this returns undefined and menus fall back to a short ID.
export function claudeTitle(
  pid = process.ppid,
  home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
) {
  try {
    const { sessionId, cwd } = JSON.parse(readFileSync(path.join(home, "sessions", `${pid}.json`), "utf8"));
    if (typeof sessionId !== "string" || typeof cwd !== "string") return undefined;
    const file = path.join(home, "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"), `${sessionId}.jsonl`);
    // Title lines are written again and again through the file: the last 512 KB are enough.
    const size = statSync(file).size,
      length = Math.min(size, 512 * 1024);
    const buffer = Buffer.alloc(length),
      fd = openSync(file, "r");
    try {
      readSync(fd, buffer, 0, length, size - length);
    } finally {
      closeSync(fd);
    }
    let custom: string | undefined, ai: string | undefined;
    for (const line of buffer.toString("utf8").split("\n")) {
      if (!line.includes("-title")) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === "custom-title" && entry.customTitle) custom = entry.customTitle;
        if (entry.type === "ai-title" && entry.aiTitle) ai = entry.aiTitle;
      } catch {}
    }
    return (custom ?? ai)?.trim() || undefined;
  } catch {
    return undefined;
  }
}
