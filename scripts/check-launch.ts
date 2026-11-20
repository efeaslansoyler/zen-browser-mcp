import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { discoverInstances, parseBrowserFlags, browserResolver } from "../src/instances.ts";
import { createBrowserLauncher } from "../src/launch.ts";

const runtime = process.env.XDG_RUNTIME_DIR;
assert(runtime && !process.env.ZEN_MCP_SOCKET, "Use: node scripts/check-launch.ts <isolated Zen binary>");
for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"])
  assert(process.env[key]?.startsWith(runtime + "/"), `${key} must be inside the disposable XDG_RUNTIME_DIR.`);
assert.equal(fs.statSync(runtime).mode & 0o777, 0o700);

// why: Inject headless launch arguments only for this invocation of the real server.
if (process.argv[2] === "--serve") {
  const [pidFile, ...flags] = process.argv.slice(3);
  assert(pidFile.startsWith(runtime + "/"));
  browserResolver.flags = parseBrowserFlags(flags);
  const { serve } = await import("../src/server.ts");
  await serve(
    createBrowserLauncher({
      extraArgs: ["--headless", "--no-remote", "about:blank"],
      start(file, args, options) {
        assert(file.startsWith(runtime + "/"), "The executable must be inside the disposable runtime directory.");
        const child = spawn(file, args, options);
        if (child.pid) fs.appendFileSync(pidFile, `${child.pid}\n`);
        return child;
      },
    }),
  );
} else {
  const binary = fs.realpathSync(process.argv[2] ?? "");
  assert(binary.startsWith(runtime + "/"), "Use a copy of Zen inside the disposable runtime directory.");
  fs.accessSync(binary, fs.constants.X_OK);
  const workspace = fs.mkdtempSync(path.join(runtime, "launch-"));
  const pidFile = path.join(workspace, "pids");
  const profile = path.join(workspace, "profile");
  fs.mkdirSync(profile);
  const config = (...args: string[]) => execFileSync(process.execPath, ["dist/cli.js", "config", ...args]);
  const client = new Client({ name: "launch-check", version: "1" });
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const context = () => client.callTool({ name: "tabs_context_mcp", arguments: {} });
  try {
    assert.deepEqual(await discoverInstances(), []);
    config("launch", "deny");
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["scripts/check-launch.ts", "--serve", pidFile, "--browser", path.dirname(binary), "--profile", profile],
        env: { ...env, ZEN_MCP_CHANNEL: "0" },
      }),
    );
    assert((await client.listTools()).tools.length);
    assert(!fs.existsSync(pidFile), "MCP initialization and listing should never launch a browser");
    const denied = await context();
    assert(denied.isError);
    const denial = (denied.content as { text: string }[])[0].text;
    assert.match(denial, /denied by the user's browser.launch permission/);
    assert(!fs.existsSync(pidFile), "Denial must not spawn a browser");
    assert.deepEqual(await discoverInstances(), []);
    console.log("✓ MCP initialization and a denied tool call leave Zen closed");

    config("launch", "default");
    config("mode", "auto");
    const results = await Promise.all([context(), context()]);
    for (const reply of results) assert(!reply.isError, (reply.content as { text: string }[])[0].text);
    const [entry] = await discoverInstances();
    assert.equal(entry.profileDir, profile);
    assert.equal(fs.readFileSync(pidFile, "utf8"), `${entry.pid}\n`);
    console.log("✓ Two concurrent MCP tool calls start one headless Zen and both receive a bridge reply");

    await client.close();
    assert.equal((await discoverInstances())[0]?.pid, entry.pid);
    console.log("✓ The detached browser is still running after the MCP server disconnects");
  } finally {
    await client.close().catch(() => {});
    const pids = fs.existsSync(pidFile) ? fs.readFileSync(pidFile, "utf8").trim().split("\n").map(Number) : [];
    for (const pid of pids) {
      const signal = (name: NodeJS.Signals | 0) => {
        try {
          return process.kill(-pid, name);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          return false;
        }
      };
      signal("SIGTERM");
      for (let i = 0; i < 50 && signal(0); i++) await sleep(100);
      if (signal(0)) signal("SIGKILL");
    }
    await discoverInstances();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}
