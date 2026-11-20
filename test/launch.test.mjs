import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "zm-launch-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));
Object.assign(process.env, {
  XDG_RUNTIME_DIR: root,
  XDG_CONFIG_HOME: path.join(root, "config"),
  XDG_STATE_HOME: path.join(root, "state"),
  ZEN_MCP_CHANNEL: "0",
});
delete process.env.ZEN_MCP_SOCKET;
delete process.env.ZEN_MCP_BROWSER;
delete process.env.ZEN_MCP_PROFILE;
delete process.env.ZEN_MCP_BROWSER_MODE;

const { browserExecutable, createBrowserLauncher } = await import("../dist/launch.js");
const { BrowserResolver } = await import("../dist/instances.js");
const { createServer } = await import("../dist/server.js");
const { CONFIG_FILE, PERMISSIONS_FILE, INSTANCES_DIR, LOG_FILE } = await import("../dist/paths.js");
const { readConfig, launchRule, configCommand } = await import("../dist/config.js");
const { examplePermissions, parsePermissions } = await import("../browser/Policy.sys.mjs");

function installation(name, dir, binary = name.toLowerCase(), binDir = dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(dir, "application.ini"), `[App]\nName=${name}\nRemotingName=${binary}\n`);
  fs.writeFileSync(path.join(binDir, binary), "", { mode: 0o700 });
  return { name, dir };
}

const zen = installation("Zen", path.join(root, "zen"));
const firefox = installation("Firefox", path.join(root, "firefox"));
const profileDir = path.join(root, "fixture");
const metadata = {
  browser: zen.name,
  installationDir: zen.dir,
  profileDir,
  profileName: "Testing",
  pid: process.pid,
  bridgeVersion: "test",
  bridgeGeneration: 1,
  startedAt: 1,
  focusedAt: 0,
};
const socket = path.join(INSTANCES_DIR, "0000000000000001.sock");
const entry = { ...metadata, socket };
fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });

function configure(config, custom) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config));
  if (custom) fs.writeFileSync(PERMISSIONS_FILE, JSON.stringify(custom));
  else fs.rmSync(PERMISSIONS_FILE, { force: true });
}

function launcher({ exitCode = null, started, ...options } = {}) {
  const calls = [];
  const launch = createBrowserLauncher({
    find: () => [zen, firefox],
    display: (env) => env,
    timeout: 50,
    start(file, args, spawnOptions) {
      calls.push({ file, args, options: spawnOptions });
      started?.();
      return Object.assign(new EventEmitter(), {
        pid: metadata.pid,
        exitCode,
        signalCode: null,
        unref() {},
      });
    },
    ...options,
  });
  const list = async () => (calls.length ? [entry] : []);
  return { launch, calls, list };
}

test("finds executable Linux and macOS paths", () => {
  assert.equal(browserExecutable(zen, "linux"), path.join(zen.dir, "zen"));
  const bundle = path.join(root, "Firefox Nightly.app", "Contents");
  const mac = installation("Firefox", path.join(bundle, "Resources"), "firefox", path.join(bundle, "MacOS"));
  assert.equal(browserExecutable(mac, "darwin"), path.join(bundle, "MacOS", "firefox"));
  fs.chmodSync(path.join(bundle, "MacOS", "firefox"), 0o600);
  assert.throws(() => browserExecutable(mac, "darwin"), /No executable for Firefox/);
  assert.throws(() => browserExecutable(zen, "win32"), /Linux and macOS/);
});

test("launches the first installation by default and honors browser, profile name and profile path selectors", async () => {
  configure({ mode: "auto" });
  for (const [choice, args] of [
    [{}, []],
    [{ browser: "zeN", profile: "Testing" }, ["-P", "Testing"]],
    [{ browser: zen.dir, profile: profileDir }, ["--profile", profileDir]],
  ]) {
    const { launch, calls, list } = launcher({
      extraArgs: ["--test-extra"],
      extraEnv: { ZEN_MCP_BROWSER: "stripped", ZEN_MCP_PROFILE: "stripped", OTHER: "kept" },
    });
    assert.equal(await launch(choice, list), entry);
    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.equal(call.file, path.join(zen.dir, "zen"));
    assert.deepEqual(call.args, [...args, "--test-extra"]);
    assert.equal(call.options.detached, true);
    assert.equal(call.options.stdio, "ignore");
    assert.equal(call.options.env.XDG_RUNTIME_DIR, root);
    assert.equal(call.options.env.ZEN_MCP_BROWSER, undefined);
    assert.equal(call.options.env.ZEN_MCP_PROFILE, undefined);
    assert.equal(call.options.env.OTHER, "kept");
  }
  const { launch, calls } = launcher();
  const firefoxEntry = { ...entry, browser: firefox.name, installationDir: firefox.dir };
  assert.equal(await launch({ browser: "Firefox" }, async () => (calls.length ? [firefoxEntry] : [])), firefoxEntry);
  assert.equal(calls[0].file, path.join(firefox.dir, "firefox"));
});

test("evaluates templates, explicit preferences and custom denial", () => {
  for (const [mode, launch, custom, expected] of [
    ["auto", undefined, undefined, "allow"],
    ["ask", undefined, undefined, "ask"],
    ["auto", "ask", undefined, "ask"],
    ["auto", "deny", undefined, "deny"],
    ["ask", "allow", undefined, "allow"],
    ["custom", undefined, { base: "ask" }, "ask"],
    ["custom", "allow", { base: "auto", rules: { "browser.launch": "deny" } }, "deny"],
  ]) {
    configure({ mode, launch }, custom);
    assert.equal(launchRule(), expected);
  }
  configure({ mode: "custom", launch: "allow" });
  assert.throws(() => launchRule(), /permissions.jsonc/);
  assert.equal(parsePermissions(examplePermissions("ask")).rules["browser.launch"], "ask");
  assert.equal(parsePermissions(examplePermissions("auto")).rules["browser.launch"], "allow");
});

test("a socket override skips launch and passive resolution never launches", async () => {
  const resolver = new BrowserResolver({
    dir: INSTANCES_DIR,
    legacy: path.join(root, "legacy.sock"),
    env: { ZEN_MCP_BROWSER: "Firefox", ZEN_MCP_SOCKET: socket },
    config: () => ({ browser: "Zen", profile: "Testing" }),
  });
  assert.equal((await resolver.resolveForTool(() => assert.fail("unexpected launch"))).socket, socket);
  const passive = new BrowserResolver({
    dir: INSTANCES_DIR,
    legacy: path.join(root, "legacy.sock"),
    env: { ZEN_MCP_BROWSER: "Firefox" },
    config: () => ({ browser: "Zen", profile: "Testing" }),
  });
  await assert.rejects(passive.resolve(), /"Firefox".*MCP client override.*not running/);
});

test("times out with the chosen browser, profile and log; an early exit never respawns", async () => {
  configure({ mode: "auto" });
  const choice = { browser: "Zen", profile: "Testing" };
  const timed = launcher({ timeout: 10 });
  await assert.rejects(
    timed.launch(choice, async () => []),
    (error) => {
      assert.match(error.message, /Timed out.*Zen \/ Testing/);
      assert(error.message.includes(LOG_FILE));
      return true;
    },
  );
  await assert.rejects(
    timed.launch(choice, async () => []),
    /already running without a live bridge/,
  );
  assert.equal(timed.calls.length, 1);
  const exited = launcher({ exitCode: 0 });
  await assert.rejects(
    exited.launch(choice, async () => []),
    /may already be running.*install/,
  );
  assert.equal(exited.calls.length, 1);
});

for (const { action, value, expected, grant } of [
  { action: "accept", value: "open" },
  { action: "accept", value: "always", grant: "allow" },
  { action: "decline", expected: /not approved[\s\S]*config launch allow/ },
  { action: "cancel", expected: /not approved[\s\S]*config launch allow/ },
  { expected: /cannot ask.*config launch allow/ },
  { action: "deny", expected: /denied.*browser.launch/ },
]) {
  test(`MCP launch approval: ${value ?? action ?? "no elicitation capability"}`, async () => {
    configure(
      {
        mode: action === "deny" ? "custom" : "ask",
        launch: action === "deny" ? "allow" : undefined,
        browser: "Zen",
        profile: "Testing",
      },
      action === "deny" ? { base: "auto", rules: { "browser.launch": "deny" } } : undefined,
    );
    const bridge = net.createServer((peer) => peer.end());
    fs.mkdirSync(INSTANCES_DIR, { mode: 0o700, recursive: true });
    // Bind only once spawn is attempted so the resolver has to go through approval.
    const { launch, calls } = launcher({
      timeout: 1000,
      started() {
        bridge.listen(socket);
        bridge.once("listening", () =>
          fs.writeFileSync(socket.replace(/\.sock$/, ".json"), JSON.stringify(metadata), { mode: 0o600 }),
        );
      },
    });
    let prompts = 0;
    const canAsk = action && action !== "deny";
    const client = new Client(
      { name: "launch-test", version: "1" },
      {
        capabilities: canAsk ? { elicitation: { form: {} } } : {},
      },
    );
    if (canAsk)
      client.setRequestHandler(ElicitRequestSchema, async ({ params }) => {
        prompts++;
        assert.equal(params.message, "Open Zen / Testing?");
        assert.deepEqual(params.requestedSchema.properties.launch.oneOf, [
          { const: "open", title: "Open" },
          { const: "always", title: "Always open (don't ask again)" },
        ]);
        return { action, ...(value ? { content: { launch: value } } : {}) };
      });
    const server = createServer(
      async (...args) => [{ type: "text", text: args[5].instance.profileName }],
      undefined,
      launch,
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const call = () => client.callTool({ name: "tabs_context_mcp", arguments: {} });
      const results = await Promise.all([call(), call()]);
      for (const result of results) {
        if (expected) {
          assert(result.isError);
          assert.match(result.content[0].text, expected);
        } else {
          assert(!result.isError, result.content[0].text);
          assert.equal(result.content[0].text, "Testing");
        }
      }
      assert.equal(calls.length, expected ? 0 : 1);
      assert.equal(prompts, canAsk ? 1 : 0);
      assert.equal(readConfig().launch, action === "deny" ? "allow" : grant);
      if (grant) {
        assert.equal(launchRule(), "allow");
        configCommand(["launch", "default"]);
        assert.equal(launchRule(), "ask");
      }
    } finally {
      await client.close();
      await server.close();
      if (bridge.listening) {
        const closed = once(bridge, "close");
        bridge.close();
        await closed;
      }
      fs.rmSync(socket.replace(/\.sock$/, ".json"), { force: true });
    }
  });
}

test("dedicated launches prepare the chosen profile and pass isolation flags and launch identity", async () => {
  const { agentProfile, profileOwner, TEMPORARY_DIR } = await import("../dist/profiles.js");
  configure({ mode: "ask", launch: "allow" });
  for (const mode of ["agent", "scratch", "autonomous", "autonomous-agent"]) {
    const temporary = mode === "scratch" || mode === "autonomous";
    const headless = mode.startsWith("autonomous");
    let child;
    let request;
    const launch = createBrowserLauncher({
      display: (env) => env,
      start(file, args, options) {
        request = { file, args, env: options.env };
        return (child = Object.assign(new EventEmitter(), {
          pid: process.pid,
          exitCode: null,
          signalCode: null,
          unref() {},
        }));
      },
    });
    const readonly = await launch(
      { browser: zen.dir, profile: "/ignored/user-profile", browserMode: mode },
      async () =>
        request
          ? [
              {
                ...entry,
                browserMode: mode,
                launchedByMcp: true,
                profileDir: request.args[1],
                profileOwner,
              },
            ]
          : [],
    );
    const dir = readonly.profileDir;
    if (temporary) assert.equal(path.dirname(dir), TEMPORARY_DIR);
    else assert.equal(dir, agentProfile(zen.dir));
    assert.equal(request.file, path.join(zen.dir, "zen"));
    assert.deepEqual(request.args, [
      "--profile",
      dir,
      "--new-instance",
      "--no-remote",
      ...(headless ? ["--headless"] : []),
    ]);
    assert.equal(request.env.ZEN_MCP_BROWSER_MODE, mode);
    assert.equal(request.env.ZEN_MCP_LAUNCHED, "1");
    assert.equal(request.env.ZEN_MCP_LAUNCHED_PROFILE, dir);
    assert.equal(request.env.ZEN_MCP_PROFILE_OWNER, temporary ? profileOwner : undefined);
    assert.match(fs.readFileSync(path.join(dir, "user.js"), "utf8"), /zen.welcome-screen.seen/);
    assert.match(fs.readFileSync(path.join(dir, "user.js"), "utf8"), /dataSubmissionEnabled", false/);
    child.emit("exit");
    assert.equal(fs.existsSync(dir), !temporary);
  }
});

test("orphan sweep removes dead temporary profiles and skips live owners, browsers and other folders", async () => {
  const { createTemporaryProfile, recordTemporaryBrowser, sweepTemporaryProfiles, TEMPORARY_DIR } =
    await import("../dist/profiles.js");
  const liveOwner = createTemporaryProfile();
  const liveBrowser = path.join(TEMPORARY_DIR, "2147483647-active");
  const orphan = path.join(TEMPORARY_DIR, "2147483647-orphan");
  const starting = path.join(TEMPORARY_DIR, "2147483647-justnw");
  const unrelated = path.join(TEMPORARY_DIR, "custom");
  for (const dir of [liveBrowser, orphan, starting, unrelated]) fs.mkdirSync(dir);
  recordTemporaryBrowser(liveBrowser, process.pid);
  recordTemporaryBrowser(orphan, 2147483647);
  sweepTemporaryProfiles();
  assert(!fs.existsSync(orphan));
  for (const dir of [liveOwner, liveBrowser, starting, unrelated]) assert(fs.existsSync(dir));
  const before = new Date(Date.now() - 65_000);
  fs.utimesSync(starting, before, before);
  sweepTemporaryProfiles();
  assert(!fs.existsSync(starting));
});

test("launch rules also gate autonomous startup before a profile is created", async () => {
  configure({ mode: "ask" });
  const { launch, calls } = launcher();
  await assert.rejects(
    launch({ browser: zen.dir, browserMode: "autonomous" }, async () => []),
    /cannot ask for launch approval/,
  );
  configure({ mode: "custom", launch: "allow" }, { base: "ask", rules: { "browser.launch": "deny" } });
  await assert.rejects(
    launch({ browser: zen.dir, browserMode: "autonomous-agent" }, async () => []),
    /denied by the user's browser.launch permission/,
  );
  assert.equal(calls.length, 0);
});

test("new agent profiles get a user.js Gecko can parse", async () => {
  const { agentProfile, prepareProfile } = await import("../dist/profiles.js");
  const profile = agentProfile(zen.dir);
  prepareProfile(profile);
  for (const line of fs.readFileSync(path.join(profile, "user.js"), "utf8").trim().split("\n"))
    assert.match(line, /^user_pref\("[^"]+", (true|false|-?\d+|"[^"]*")\);$/);
  fs.rmSync(profile, { recursive: true, force: true });
});

test("reset checks Gecko's locks even without a bridge and only removes the chosen agent profile", async () => {
  const { agentProfile, prepareProfile } = await import("../dist/profiles.js");
  const { resetAgentProfile } = await import("../dist/launch.js");
  const profile = agentProfile(zen.dir);
  const other = agentProfile(firefox.dir);
  prepareProfile(profile);
  prepareProfile(other);
  const lock = path.join(profile, "lock");
  fs.symlinkSync(`127.0.0.1:+${process.pid}`, lock);
  await assert.rejects(resetAgentProfile(zen.dir), /Close the agent browser/);
  assert(fs.existsSync(profile));
  fs.unlinkSync(lock);
  assert.equal(await resetAgentProfile(zen.dir), profile);
  assert(!fs.existsSync(profile));
  assert(fs.existsSync(other));
});

test("a visible launch fills a missing display from the user session or explains how to pass one", async () => {
  const { withDisplay } = await import("../dist/launch.js");
  const session = () => ({
    WAYLAND_DISPLAY: "wayland-1",
    XDG_RUNTIME_DIR: "/run/user/1000",
    DISPLAY: ":0",
    OTHER: "x",
  });
  const minimal = { HOME: "/home/u", PATH: "/usr/bin" };
  assert.deepEqual(withDisplay({ ...minimal }, "linux", session), {
    ...minimal,
    DISPLAY: ":0",
    WAYLAND_DISPLAY: "wayland-1",
    XDG_RUNTIME_DIR: "/run/user/1000",
  });
  const own = { ...minimal, XDG_RUNTIME_DIR: "/tmp/own" };
  assert.equal(withDisplay(own, "linux", session).XDG_RUNTIME_DIR, "/tmp/own", "Set variables are kept");
  const shown = { ...minimal, WAYLAND_DISPLAY: "wayland-0" };
  assert.deepEqual(
    withDisplay({ ...shown }, "linux", () => assert.fail("not consulted")),
    shown,
  );
  assert.deepEqual(
    withDisplay({ ...minimal }, "darwin", () => assert.fail("not consulted")),
    minimal,
  );
  assert.throws(() => withDisplay({ ...minimal }, "linux", () => ({})), /No graphical display[\s\S]*env_vars/);
});
