// why: Run a headless copy from the checkout so live checks cannot touch the user's browser.
// why: Headless Zen cannot exercise the native clipboard or checks that require a visible window.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const CHECKOUT = fileURLToPath(new URL("..", import.meta.url));
const [command, arg] = process.argv.slice(2);

function up(installDir = "/opt/zen-browser-bin") {
  assert(fs.existsSync(path.join(installDir, "application.ini")), `No browser installation at ${installDir}.`);
  const runtime = fs.mkdtempSync(path.join(`/run/user/${process.getuid!()}`, "zs."));
  fs.chmodSync(runtime, 0o700);
  const dirs = Object.fromEntries(["config", "data", "state", "cache"].map((name) => [name, path.join(runtime, name)]));
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir);
  const copy = path.join(os.homedir(), ".cache", "zen-mcp-sandbox", path.basename(runtime));
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  // why: Reflinks avoid copying a full browser install on filesystems that support them.
  execFileSync("cp", ["-a", "--reflink=auto", installDir, copy]);
  fs.symlinkSync(path.join(CHECKOUT, "browser"), path.join(dirs.data, "zen-mcp"));
  fs.mkdirSync(path.join(dirs.config, "zen-mcp"), { mode: 0o700 });
  fs.writeFileSync(path.join(dirs.config, "zen-mcp", "config.json"), JSON.stringify({ mode: "auto" }) + "\n");
  const env = {
    XDG_RUNTIME_DIR: runtime,
    XDG_CONFIG_HOME: dirs.config,
    XDG_DATA_HOME: dirs.data,
    XDG_STATE_HOME: dirs.state,
    XDG_CACHE_HOME: dirs.cache,
    ZEN_MCP_SOCKET: path.join(runtime, "zen-mcp.sock"),
  };
  execFileSync(process.execPath, [path.join(CHECKOUT, "src/cli.ts"), "install", "--browser", copy], {
    env: { ...process.env, ...env },
    stdio: "ignore",
  });
  const profile = path.join(runtime, "profile");
  fs.mkdirSync(profile);
  const browser = spawn(
    path.join(copy, "zen-bin"),
    ["--headless", "--no-remote", "--profile", profile, "about:blank"],
    {
      env: { ...process.env, ...env },
      stdio: "ignore",
      detached: true,
    },
  );
  browser.unref();
  fs.writeFileSync(path.join(runtime, "browser.pid"), String(browser.pid));
  fs.writeFileSync(path.join(runtime, "install"), copy);
  const file = path.join(runtime, "env");
  fs.writeFileSync(
    file,
    Object.entries(env)
      .map(([key, value]) => `export ${key}=${value}\n`)
      .join(""),
  );
  return { runtime, file, socket: env.ZEN_MCP_SOCKET };
}

function down(runtime: string) {
  assert(
    runtime && path.basename(runtime).startsWith("zs.") && fs.existsSync(path.join(runtime, "env")),
    `Not a sandbox: ${runtime}`,
  );
  try {
    process.kill(Number(fs.readFileSync(path.join(runtime, "browser.pid"), "utf8")));
  } catch {}
  const copy = fs.readFileSync(path.join(runtime, "install"), "utf8");
  fs.rmSync(copy, { recursive: true, force: true });
  fs.rmSync(runtime, { recursive: true, force: true });
}

if (command === "up") {
  const { runtime, file, socket } = up(arg);
  for (let i = 0; i < 300 && !fs.existsSync(socket); i++) await sleep(100);
  assert(fs.existsSync(socket), `The sandbox browser did not open its socket; see the log under ${runtime}/state.`);
  console.log(
    `Sandbox ready. In the shell that runs zenctl and checks:\n  source ${file}\nStop it with:\n  node scripts/sandbox.ts down ${runtime}`,
  );
} else if (command === "down") down(arg);
else {
  console.error("usage: node scripts/sandbox.ts up [zen install dir] | down <sandbox dir>");
  process.exit(1);
}
