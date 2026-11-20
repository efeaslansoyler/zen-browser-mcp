// Run with a copy of a Zen installation that has the bridge loader installed in the isolated XDG environment.
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { discoverInstances, type Instance } from "../src/instances.ts";

const binary = process.argv[2];
const runtime = process.env.XDG_RUNTIME_DIR;
assert(binary && runtime && !process.env.ZEN_MCP_SOCKET, "Use: node scripts/check-instances.ts <isolated Zen binary>");
for (const key of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"])
  assert(process.env[key]?.startsWith(runtime + "/"), `${key} must be inside the disposable XDG_RUNTIME_DIR.`);
assert.equal(fs.statSync(runtime).mode & 0o777, 0o700);
fs.accessSync(binary, fs.constants.X_OK);
const workspace = fs.mkdtempSync(path.join(runtime, "profiles-"));
const children: ChildProcess[] = [];
const clients: Client[] = [];

function start(name: string) {
  const profile = path.join(workspace, name);
  fs.mkdirSync(profile);
  const child = spawn(binary, ["--headless", "--no-remote", "--profile", profile, "about:blank"], { stdio: "ignore" });
  children.push(child);
  return profile;
}

async function until<T>(get: () => T | Promise<T>, label: string): Promise<NonNullable<T>> {
  for (let i = 0; i < 150; i++) {
    const result = await get();
    if (result) return result;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}. See ${runtime}/zen-mcp.log.`);
}

async function close(child: ChildProcess, signal: NodeJS.Signals) {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill(signal);
  await Promise.race([exited, sleep(5000, undefined, { ref: false })]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

const cli = (...args: string[]) => execFileSync(process.execPath, ["dist/cli.js", ...args], { encoding: "utf8" });
const zenctl = (instance: Instance, ...args: string[]) =>
  execFileSync(process.execPath, ["scripts/zenctl.ts", ...args], {
    env: { ...process.env, ZEN_MCP_SOCKET: instance.socket },
    encoding: "utf8",
  }).trim();

async function connect(args: string[] = []) {
  const client = new Client({ name: "instance-check", version: "1" });
  clients.push(client);
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["dist/cli.js", ...args],
      env: { ...env, ZEN_MCP_CHANNEL: "0" },
    }),
  );
  return client;
}

async function context(client: Client) {
  const reply = await client.callTool({ name: "tabs_context_mcp", arguments: {} });
  const content = reply.content as { text: string }[];
  assert(!reply.isError, content[0].text);
  return JSON.parse(content[0].text);
}

const metadataPath = (entry: Instance) => entry.socket.replace(/\.sock$/, ".json");

try {
  cli("config", "launch", "deny");
  const firstProfile = start("first");
  const secondProfile = start("second");
  const both = await until(async () => {
    const instances = await discoverInstances();
    const a = instances.find((entry) => entry.profileDir === firstProfile);
    const b = instances.find((entry) => entry.profileDir === secondProfile);
    if (a && b) return [a, b] as const;
  }, "two distinct bridge sockets");

  let first = both[0];
  const second = both[1];
  for (const entry of both) {
    assert.equal(zenctl(entry, "eval", "Services.appinfo.processID"), String(entry.pid));
    assert.equal(entry.installationDir, path.dirname(fs.realpathSync(binary)));
    assert(entry.bridgeVersion && entry.startedAt > 0);
    assert.equal(fs.statSync(entry.socket).mode & 0o777, 0o600);
    assert.equal(fs.statSync(metadataPath(entry)).mode & 0o777, 0o600);
  }
  assert.notEqual(first.socket, second.socket);
  assert.notEqual(first.pid, second.pid);
  console.log("✓ Two headless Zen profiles answer simultaneously on private sockets");

  cli("config", "browser", "Zen", "--profile", "second");
  const configured = await connect();
  assert.equal((await context(configured)).browser, "Zen / second");
  const overridden = await connect(["--browser", first.installationDir, "--profile", "first"]);
  assert.equal((await context(overridden)).browser, "Zen / first");
  cli("config", "browser", "clear");
  console.log("✓ config.json selects the second profile and MCP CLI flags select the first");

  assert.equal(
    zenctl(
      first,
      "eval",
      `(() => {
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    win.dispatchEvent(new win.Event("activate"));
    return true;
  })()`,
    ),
    "true",
  );
  await until(async () => {
    const instances = await discoverInstances();
    return (
      instances.find((entry) => entry.pid === first.pid)!.focusedAt >
      instances.find((entry) => entry.pid === second.pid)!.focusedAt
    );
  }, "focus metadata");
  const automatic = await connect();
  assert.equal((await context(automatic)).browser, "Zen / first");
  assert.equal((await context(configured)).browser, "Zen / second");
  console.log("✓ Window activation drives automatic selection and existing MCP sessions stay on their profile");

  execFileSync(process.execPath, ["scripts/zenctl.ts", "reload"], {
    env: { ...process.env, ZEN_MCP_PROFILE: "first" },
    encoding: "utf8",
  });
  const oldSocket = first.socket;
  first = await until(
    async () => (await discoverInstances()).find((entry) => entry.pid === first.pid && entry.socket !== oldSocket),
    "reloaded bridge",
  );
  assert(!fs.existsSync(oldSocket));
  assert.equal((await context(automatic)).browser, "Zen / first");
  assert.equal((await context(configured)).browser, "Zen / second");
  console.log("✓ Reload replaces only its own socket and preserves MCP attachment to the same instance");

  const exited = once(children[0], "exit");
  zenctl(
    first,
    "eval",
    `(() => {
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    win.setTimeout(() => Services.startup.quit(Components.interfaces.nsIAppStartup.eForceQuit), 100);
    return true;
  })()`,
  );
  await Promise.race([exited, sleep(8000, undefined, { ref: false }).then(() => assert.fail("Zen did not quit"))]);
  assert(!fs.existsSync(first.socket) && !fs.existsSync(metadataPath(first)), "Stop left discovery files behind");
  assert.equal(zenctl(second, "eval", "Services.appinfo.processID"), String(second.pid));
  const changed = await automatic.callTool({ name: "tabs_context_mcp", arguments: {} });
  assert(changed.isError);
  assert.match((changed.content as { text: string }[])[0].text, /browser changed from Zen \/ first to Zen \/ second/);
  assert.equal((await context(automatic)).browser, undefined);
  const unavailable = await overridden.callTool({ name: "tabs_context_mcp", arguments: {} });
  assert(unavailable.isError);
  assert.match((unavailable.content as { text: string }[])[0].text, /Zen \/ first.*denied.*browser.launch/);
  console.log("✓ Closing the first browser removes its files, preserves the second, and reports MCP failover");

  await close(children[1], "SIGKILL");
  assert(fs.existsSync(second.socket) && fs.existsSync(metadataPath(second)), "Crash fixture left no stale entries");
  assert.deepEqual(await discoverInstances(), []);
  assert(!fs.existsSync(second.socket) && !fs.existsSync(metadataPath(second)));
  console.log("✓ Discovery removes the crashed browser's stale socket and metadata");
} finally {
  await Promise.allSettled(clients.map((client) => client.close()));
  await Promise.all(children.map((child) => close(child, "SIGTERM")));
  fs.rmSync(workspace, { recursive: true, force: true });
}
