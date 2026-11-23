// why: Use a writable isolated copy because this check starts dedicated profiles and exercises install state.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { browserResolver, discoverInstances, parseBrowserFlags } from "../src/instances.ts";
import { createBrowserLauncher } from "../src/launch.ts";
import { alive, prepareProfile } from "../src/profiles.ts";
import { type Content } from "../src/zen.ts";

const runtime = process.env.XDG_RUNTIME_DIR;
assert(runtime && !process.env.ZEN_MCP_SOCKET, "Use: node scripts/check-browser-modes.ts <isolated Zen binary>");
for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"])
  assert(process.env[key]?.startsWith(runtime + "/"), `${key} must be inside the disposable XDG_RUNTIME_DIR.`);
assert.equal(fs.statSync(runtime).mode & 0o777, 0o700);

if (process.argv[2] === "--serve") {
  const [pidFile, ...flags] = process.argv.slice(3);
  assert(pidFile.startsWith(runtime + "/"));
  browserResolver.flags = parseBrowserFlags(flags);
  const { serve } = await import("../src/server.ts");
  await serve(
    createBrowserLauncher({
      start(file, args, options) {
        assert(file.startsWith(runtime + "/"), "Copy Zen into the disposable runtime directory.");
        // why: Headless launch preserves the mode under test without opening a desktop window.
        const child = spawn(file, args.includes("--headless") ? args : [...args, "--headless"], options);
        if (child.pid) fs.appendFileSync(pidFile, `${child.pid}\n`);
        return child;
      },
    }),
  );
} else {
  const binary = fs.realpathSync(process.argv[2] ?? "");
  assert(binary.startsWith(runtime + "/"), "Copy Zen into the disposable runtime directory.");
  const workspace = fs.mkdtempSync(path.join(runtime, "modes-"));
  const userProfile = path.join(workspace, "user-profile");
  const pidFile = path.join(workspace, "pids");
  const clients = new Set<Client>();
  const cli = (...args: string[]) =>
    execFileSync(process.execPath, ["dist/cli.js", ...args], { encoding: "utf8", stdio: "pipe" }).trim();
  const json = (reply: Content[]) => JSON.parse((reply[0] as { text: string }).text);
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

  async function until<T>(get: () => T | Promise<T>, label: string, ms = 15_000): Promise<NonNullable<T>> {
    const deadline = Date.now() + ms;
    do {
      const value = await get();
      if (value) return value;
      await sleep(100);
    } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for ${label}. See ${runtime}/zen-mcp.log.`);
  }

  async function connect(mode?: string) {
    const client = new Client({ name: "browser-modes-check", version: "1" });
    const args = [
      "scripts/check-browser-modes.ts",
      "--serve",
      pidFile,
      "--browser",
      path.dirname(binary),
      "--profile",
      userProfile,
      ...(mode ? ["--browser-mode", mode] : []),
    ];
    clients.add(client);
    await client.connect(new StdioClientTransport({ command: process.execPath, args, env }));
    return client;
  }

  async function close(client: Client) {
    await client.close();
    clients.delete(client);
  }

  async function tool(client: Client, name: string, args: Record<string, unknown> = {}, error?: RegExp) {
    const reply = await client.callTool({ name, arguments: args }, undefined, { timeout: 8000 });
    const content = reply.content as Content[];
    const text = (content[0] as { text: string }).text;
    if (error) {
      assert(reply.isError, text);
      assert.match(text, error);
    } else assert(!reply.isError, text);
    return content;
  }

  const context = async (client: Client) => json(await tool(client, "tabs_context_mcp"));
  const modeInstance = async (mode: string) => (await discoverInstances()).find((entry) => entry.browserMode === mode);
  const fixture = http.createServer((request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    if (request.url === "/seed") response.setHeader("Set-Cookie", "modeCheck=kept; Max-Age=600; Path=/");
    response.end(
      request.url?.startsWith("/submit")
        ? "<h1>Submitted successfully</h1>"
        : '<form action="/submit"><button type="submit">Submit fixture</button></form>',
    );
  });

  function signalGroup(pid: number, signal: NodeJS.Signals) {
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }

  let userPid: number | undefined;
  try {
    prepareProfile(userProfile);
    const user = spawn(binary, ["--headless", "--no-remote", "--new-instance", "--profile", userProfile], {
      detached: true,
      stdio: "ignore",
    });
    userPid = user.pid;
    assert(userPid);
    const together = await until(() => modeInstance("together"), "the disposable user bridge");
    assert.equal(together.pid, userPid);
    assert.equal(together.launchedByMcp, false);
    const userClient = await connect();
    assert.equal((await context(userClient)).browserMode, undefined);

    cli("config", "browser-mode", "agent");
    const agent = await connect();
    assert.equal((await context(agent)).browserMode, "agent");
    const persistent = await until(() => modeInstance("agent"), "the persistent agent bridge");
    assert.notEqual(persistent.pid, together.pid);
    assert.notEqual(persistent.profileDir, userProfile);
    assert.equal(persistent.launchedByMcp, true);
    const secondUserClient = await connect("together");
    assert.match((await context(secondUserClient)).browser, /user-profile$/);
    assert.throws(() => cli("reset-agent-profile", "--browser", path.dirname(binary)), /Close the agent browser/);
    const reuse = await connect("autonomous-agent");
    assert.equal((await context(reuse)).browserMode, "agent");
    assert.equal((await modeInstance("agent"))?.pid, persistent.pid);
    console.log("✓ Together and agent select separate headless Zen processes of the same installation");
    console.log("✓ Autonomous-agent reuses the running agent instance and reset refuses the live profile");

    await new Promise<void>((resolve, reject) => {
      fixture.once("error", reject);
      fixture.listen(0, "127.0.0.1", resolve);
    });
    const address = fixture.address();
    assert(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    const agentTab = json(await tool(agent, "tabs_create_mcp", { clean: true })).tabId;
    await tool(agent, "navigate", { tabId: agentTab, url: url + "/seed" });
    await close(agent);
    assert(await modeInstance("agent"), "Closing one client must leave the shared browser running");
    await close(reuse);

    cli("config", "mode", "ask");
    cli("config", "launch", "allow");
    const autonomous = await connect("autonomous");
    assert.equal((await context(autonomous)).browserMode, "autonomous");
    const temp = await until(() => modeInstance("autonomous"), "the autonomous bridge");
    const tab = json(await tool(autonomous, "tabs_create_mcp")).tabId;
    await tool(autonomous, "navigate", { tabId: tab, url });
    await tool(autonomous, "javascript_tool", {
      tabId: tab,
      action: "javascript_exec",
      text: "document.querySelector('button').textContent = 'Submit changed fixture'",
    });
    const found = await tool(autonomous, "find", { tabId: tab, query: "Submit changed fixture" });
    const ref = (found[0] as { text: string }).text.match(/ref_\w+/)?.[0];
    assert(ref, (found[0] as { text: string }).text);
    await tool(autonomous, "computer", { tabId: tab, action: "left_click", ref });
    await until(async () => {
      const page = await tool(autonomous, "get_page_text", { tabId: tab });
      return (page[0] as { text: string }).text.includes("Submitted successfully");
    }, "form submission without an island answer");
    await tool(autonomous, "clipboard", { tabId: tab, action: "read" }, /clipboard.read/);
    await tool(autonomous, "hand_to_user", { tabId: tab, message: "Please do this." }, /no user is present/);
    await tool(autonomous, "ask_user", { message: "Question?" }, /no user is present/);
    await tool(autonomous, "show_me", { tabId: tab, message: "Show the fixture" }, /no user is present/);
    console.log("✓ Autonomous runs page JavaScript and submits a form in ask mode without an island answer");
    console.log("✓ Autonomous refuses the system clipboard and all three user-only tools");

    await close(autonomous);
    await until(
      () => !fs.existsSync(temp.profileDir) && !alive(temp.pid),
      "temporary browser exit and profile deletion",
    );
    assert.equal((await modeInstance("together"))?.pid, userPid);
    console.log("✓ Disconnect quits the temporary browser and deletes its profile; together stays open");

    await until(async () => !(await modeInstance("agent")) && !alive(persistent.pid), "idle agent exit", 135_000);
    const headlessAgent = await connect("autonomous-agent");
    assert.equal((await context(headlessAgent)).browserMode, "autonomous-agent");
    const restarted = await until(() => modeInstance("autonomous-agent"), "the autonomous-agent bridge");
    assert.equal(restarted.profileDir, persistent.profileDir);
    assert.notEqual(restarted.pid, persistent.pid);
    const secondTab = json(await tool(headlessAgent, "tabs_create_mcp", { clean: true })).tabId;
    await tool(headlessAgent, "navigate", { tabId: secondTab, url });
    const cookie = await tool(headlessAgent, "javascript_tool", {
      tabId: secondTab,
      action: "javascript_exec",
      text: "document.cookie",
    });
    assert.match((cookie[0] as { text: string }).text, /modeCheck=kept/);
    console.log("✓ The agent browser quits after its idle grace period and autonomous-agent retains its login cookie");
  } finally {
    fixture.close();
    fixture.closeAllConnections();
    await Promise.allSettled([...clients].map((client) => client.close()));
    const pids = fs.existsSync(pidFile) ? fs.readFileSync(pidFile, "utf8").trim().split("\n").map(Number) : [];
    if (userPid) pids.push(userPid);
    for (const pid of pids.filter((value) => value > 0)) signalGroup(pid, "SIGTERM");
    for (let i = 0; i < 30 && pids.some(alive); i++) await sleep(100);
    for (const pid of pids.filter(alive)) signalGroup(pid, "SIGKILL");
    await until(() => !pids.some(alive), "fixture browsers to exit");
    await discoverInstances();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}
