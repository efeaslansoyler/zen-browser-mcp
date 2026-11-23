import { execFileSync } from "node:child_process";
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NAME, SERVER_NAME } from "./paths.ts";

export function channelEnabled(): boolean {
  if (process.env.ZEN_MCP_CHANNEL) return process.env.ZEN_MCP_CHANNEL === "1";
  const args = processInfo(clientPid())?.args ?? [];
  return args.some((a) => /^--(dangerously-load-development-)?channels\b/.test(a)) && channelArgs(args);
}

// why: Claude Code ignores channel flags in print or stream-json mode.
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

export function processInfo(pid: number): { args: string[]; ppid: number } | null {
  try {
    const args = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
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

const LAUNCHER = /^-?((ba|da|z|k|fi)?sh|npm|npx|pnpm|yarn)(-cli)?(\.[cm]?js)?$/;
const programName = (word = "") => path.basename(word.split(" ")[0]);

// why: npx or a shell may stand between the client and this server.
export function clientPid(): number {
  let pid = process.ppid;
  for (let proc = processInfo(pid); proc && proc.ppid > 1; proc = processInfo(pid)) {
    const [command, script] = proc.args;
    if (!LAUNCHER.test(programName(programName(command) === "node" ? script : command))) break;
    pid = proc.ppid;
  }
  return pid;
}

function environmentValue(pid: number, name: string): string | undefined {
  const entries =
    process.platform === "linux"
      ? readFileSync(`/proc/${pid}/environ`, "utf8").split("\0")
      : execFileSync("ps", ["-E", "-ww", "-o", "command=", "-p", String(pid)], { encoding: "utf8" }).split(/\s+/);
  return entries.find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1);
}

// why: A shell passes an agent's variables on to agents started in it; init and systemd adopt orphans, whose starter is unknown.
export function inheritedFromAncestor(name: string, value: string, pid = clientPid()): boolean {
  const parent = processInfo(pid)?.ppid ?? 0;
  if (parent <= 1 || programName(processInfo(parent)?.args[0]) === "systemd") return true;
  for (let above = parent; above > 1; above = processInfo(above)?.ppid ?? 0) {
    try {
      if (environmentValue(above, name) === value) return true;
    } catch {
      if (above === parent) return true;
    }
  }
  return false;
}

// why: Prompt hooks identify the client through its place in the process ancestry.
export function ancestorPids(depth = 8): number[] {
  const pids: number[] = [];
  for (let pid = process.ppid; pid > 1 && pids.length < depth;) {
    pids.push(pid);
    const parent = processInfo(pid)?.ppid;
    if (!parent || parent === pid) break;
    pid = parent;
  }
  return pids;
}

// why: Claude titles come from an undocumented per-PID format, so menus need a fallback short ID.
export function claudeTitle(
  pid = process.ppid,
  home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
) {
  try {
    const { sessionId, cwd } = JSON.parse(readFileSync(path.join(home, "sessions", `${pid}.json`), "utf8"));
    if (typeof sessionId !== "string" || typeof cwd !== "string") return undefined;
    const file = path.join(home, "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"), `${sessionId}.jsonl`);
    // why: Title records recur in transcripts, so scan a bounded tail rather than reading the entire transcript.
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
