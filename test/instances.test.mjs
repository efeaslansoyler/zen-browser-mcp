import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { BrowserResolver, deliveryScope, discoverInstances, parseBrowserFlags } from "../dist/instances.js";
import { config } from "../browser/Config.sys.mjs";
import { normalizeConfig } from "../browser/SiteRules.sys.mjs";

function fixture(t, { discoverable = false } = {}) {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "zi-"));
  const dir = discoverable ? path.join(runtime, "zen-mcp") : runtime;
  if (discoverable) fs.mkdirSync(dir, { mode: 0o700 });
  const legacy = path.join(dir, "legacy.sock");
  const servers = new Set();
  t.after(async () => {
    await Promise.all([...servers].map((server) => new Promise((resolve) => server.close(resolve))));
    fs.rmSync(runtime, { recursive: true, force: true });
  });
  async function listen(socket, onClient = (client) => client.end()) {
    const server = net.createServer(onClient);
    await new Promise((resolve, reject) => server.once("error", reject).listen(socket, resolve));
    servers.add(server);
    return async () => {
      await new Promise((resolve) => server.close(resolve));
      servers.delete(server);
    };
  }
  async function instance(index, fields = {}, onClient) {
    const id = String(index).padStart(16, "0");
    const socket = path.join(dir, id + ".sock");
    const metadata = path.join(dir, id + ".json");
    const close = await listen(socket, onClient);
    const data = {
      browser: "Zen",
      installationDir: "/opt/zen",
      profileDir: `/profiles/profile-${index}`,
      profileName: `Profile ${index}`,
      pid: process.pid,
      bridgeVersion: "dev",
      bridgeGeneration: 1,
      startedAt: index,
      focusedAt: index * 10,
      ...fields,
    };
    const write = (changes = {}) =>
      fs.writeFileSync(metadata, JSON.stringify({ ...data, ...changes }), { mode: 0o600 });
    write();
    return { socket, metadata, close, write, data };
  }
  const resolver = (options = {}) =>
    new BrowserResolver({ dir, legacy, override: "", env: {}, config: () => ({}), ...options });
  return { dir, runtime, legacy, listen, resolver, instance };
}

test("discovery returns live metadata and removes dead and refused entries", async (t) => {
  const { dir, instance } = fixture(t);
  const live = await instance(1);
  const dead = await instance(2, { pid: 2147483647 });
  const refused = await instance(3);
  fs.renameSync(refused.socket, refused.socket + ".moved");
  await refused.close();
  fs.renameSync(refused.socket + ".moved", refused.socket);
  assert.deepEqual(await discoverInstances(dir), [{ ...live.data, socket: live.socket }]);
  for (const entry of [dead, refused]) {
    assert(!fs.existsSync(entry.socket));
    assert(!fs.existsSync(entry.metadata));
  }
});

test("selection prefers CLI flags, then env, then config, then focus", async (t) => {
  const { resolver, instance } = fixture(t);
  const zen = await instance(1);
  const ff = await instance(2, { browser: "Firefox", installationDir: "/opt/firefox" });
  const config = () => ({ browser: "zen", profile: "Profile 1" });
  const env = { ZEN_MCP_BROWSER: "Firefox", ZEN_MCP_PROFILE: "Profile 2" };
  const cli = resolver({ config, env });
  cli.flags = parseBrowserFlags(["--browser", "/opt/zen", "--profile", "Profile 1"]);
  assert.equal((await cli.resolve()).socket, zen.socket);
  assert.equal((await resolver({ config, env }).resolve()).socket, ff.socket);
  assert.equal((await resolver({ config }).resolve()).socket, zen.socket);
  assert.equal((await resolver().resolve()).socket, ff.socket);
  assert.equal((await resolver({ env: { ZEN_MCP_PROFILE: "Profile 1" } }).resolve()).socket, zen.socket);
  await assert.rejects(
    resolver({ config: () => ({ browser: "Zen", profile: "Missing" }) }).resolve(),
    /browser "Zen", profile "Missing".*not running/,
  );
  await ff.close();
  assert.equal((await resolver().resolve()).reason, "only running instance");
});

test("selection is sticky across focus, config edits, and a bridge reload, then reports failover", async (t) => {
  const { resolver, instance } = fixture(t);
  const first = await instance(1);
  const second = await instance(2);
  let config = { profile: "Profile 1" };
  const sticky = resolver({ config: () => config });
  const [a, b] = await Promise.all([sticky.resolve(), sticky.resolve()]);
  assert.equal(a, b, "concurrent callers must select the same instance");
  assert.equal(a.socket, first.socket);
  config = {};
  second.write({ focusedAt: 500 });
  assert.equal((await sticky.resolve()).socket, first.socket);
  await first.close();
  const reloaded = await instance(3, { ...first.data, bridgeGeneration: 2 });
  const afterReload = await sticky.resolve();
  assert.equal(afterReload.socket, reloaded.socket);
  assert.equal(sticky.browserChange(afterReload), undefined);

  await reloaded.close();
  const changed = await sticky.resolve();
  assert.equal(changed.socket, second.socket);
  assert.match(sticky.browserChange(changed), /changed from Zen \/ Profile 1 to Zen \/ Profile 2/);
  assert.equal(sticky.browserChange(changed), undefined);
});

test("a detached receiver stays scoped to the calling client's installation and profile", async (t) => {
  const { resolver, instance } = fixture(t);
  const first = await instance(1);
  const second = await instance(2);
  const source = await resolver({ config: () => ({ profile: "Profile 1" }) }).resolve();
  const receiver = resolver({ config: () => ({ profile: "Profile 2" }) });
  receiver.pinDelivery(source);
  assert.notEqual(deliveryScope(source), deliveryScope(await resolver().resolve()));
  assert.equal((await receiver.resolve()).socket, first.socket);
  await first.close();
  await assert.rejects(receiver.resolve(), /Profile 1.*not running/);
  const restarted = await instance(3, { ...first.data, startedAt: 3 });
  assert.equal((await receiver.resolve()).socket, restarted.socket);
  assert.equal(deliveryScope(await receiver.resolve()), deliveryScope(source));
  assert.equal((await resolver().resolve()).socket, second.socket);
});

test("exact socket override skips discovery and config; legacy is used with no discoverable instance", async (t) => {
  const { dir, legacy, listen, resolver } = fixture(t);
  const override = path.join(dir, "custom.sock");
  const direct = resolver({
    dir: "/not-a-directory",
    override,
    config: () => assert.fail("override must not read config"),
  });
  assert.deepEqual(await direct.list(), []);
  assert.deepEqual(await direct.resolve(), { socket: override, reason: "ZEN_MCP_SOCKET" });

  await listen(legacy);
  assert.deepEqual(await resolver().resolve(), { socket: legacy, reason: "legacy socket fallback" });
  await assert.rejects(resolver({ config: () => ({ browser: "Zen" }) }).resolve(), /browser "Zen".*not running/);
});

test("a prompt hook can drain the exact client inbox in a browser that stayed selected", async (t) => {
  const { instance, runtime } = fixture(t, { discoverable: true });
  const clientSession = "sticky-session-id";
  function inbox(reply) {
    return (socket) => {
      socket.once("data", (data) => {
        const request = JSON.parse(data.toString());
        assert.equal(request.tool, "inbox_take");
        assert.equal(request.args.clientSession, clientSession);
        socket.end(JSON.stringify({ ok: true, content: [{ type: "text", text: reply }] }) + "\n");
      });
    };
  }
  await instance(1, {}, inbox("Pick in the original browser"));
  await instance(2, {}, inbox(""));
  const run = promisify(execFile);
  const env = {
    ...process.env,
    XDG_RUNTIME_DIR: runtime,
    XDG_CONFIG_HOME: runtime,
    ZEN_MCP_SOCKET: "",
    ZEN_MCP_BROWSER: "",
    ZEN_MCP_PROFILE: "",
  };
  const call = run(process.execPath, ["dist/cli.js", "hook", "claude"], { env });
  call.child.stdin.end(JSON.stringify({ session_id: clientSession }));
  const { stdout } = await call;
  assert.match(stdout, /Pick in the original browser/);
});

test("browser selection survives CLI config writes and a browser-side permission toggle", (t) => {
  const { dir } = fixture(t);
  const file = path.join(dir, "zen-mcp", "config.json");
  const cli = (...args) =>
    execFileSync(process.execPath, ["dist/cli.js", "config", ...args], {
      env: { ...process.env, XDG_CONFIG_HOME: dir },
      encoding: "utf8",
    });
  cli("browser", " /opt/zen ", "--profile", " Profile 1 ");
  cli("browser-mode", "agent");
  const bridge = config({
    normalizeConfig,
    configPath: file,
    permissionsPath: path.join(dir, "permissions.jsonc"),
    localFile: (file) => ({ path: file, exists: () => fs.existsSync(file), lastModifiedTime: 1 }),
    readTextFile: ({ path }) => fs.readFileSync(path, "utf8"),
    writeTextFile: ({ path }, value) => fs.writeFileSync(path, value),
  });
  bridge.toggleMode();
  assert.match(cli(), /browser: \/opt\/zen \/ Profile 1/);
  assert.deepEqual(normalizeConfig(JSON.parse(fs.readFileSync(file, "utf8"))), {
    mode: "ask",
    sites: { mode: "blocklist", blocklist: [], allowlist: [] },
    browser: "/opt/zen",
    profile: "Profile 1",
    browserMode: "agent",
  });
  cli("browser", "clear");
  assert.match(cli(), /browser: \(automatic\)/);
});

test("browser mode precedence and profile isolation apply before focus", async (t) => {
  const { agentProfile, profileOwner, TEMPORARY_DIR } = await import("../dist/profiles.js");
  const { resolver, instance, listen, legacy } = fixture(t);
  const user = await instance(1);
  const firefox = await instance(2, {
    browser: "Firefox",
    installationDir: "/opt/firefox",
    browserMode: "autonomous-agent",
    profileDir: agentProfile("/opt/firefox"),
  });
  const agent = await instance(3, {
    browserMode: "agent",
    launchedByMcp: false,
    profileDir: agentProfile("/opt/zen"),
  });
  const scratch = await instance(4, {
    browserMode: "scratch",
    launchedByMcp: true,
    profileOwner,
    profileDir: path.join(TEMPORARY_DIR, "owned"),
  });
  const autonomous = await instance(5, {
    browserMode: "autonomous",
    launchedByMcp: true,
    profileOwner,
    profileDir: path.join(TEMPORARY_DIR, "headless"),
  });
  await instance(6, {
    browserMode: "scratch",
    launchedByMcp: true,
    profileOwner: "another MCP process",
    profileDir: path.join(TEMPORARY_DIR, "other"),
  });
  await instance(7, { profileDir: agentProfile("/opt/zen") });
  await instance(8, { browserMode: "scratch", profileOwner });
  assert.equal((await resolver().resolve()).socket, user.socket);
  const config = () => ({ browser: "Zen", profile: "Missing", browserMode: "autonomous-agent" });
  assert.equal((await resolver({ config }).resolve()).socket, agent.socket);
  const env = { ZEN_MCP_BROWSER_MODE: "autonomous", ZEN_MCP_PROFILE: "Also missing" };
  assert.equal((await resolver({ config, env }).resolve()).socket, autonomous.socket);
  const cli = resolver({ config, env });
  cli.flags = parseBrowserFlags(["--browser-mode", "scratch"]);
  assert.equal((await cli.resolve()).socket, scratch.socket);
  const firefoxClient = resolver({ config });
  firefoxClient.flags = parseBrowserFlags(["--browser-mode", "agent", "--browser", "Firefox"]);
  assert.equal((await firefoxClient.resolve()).socket, firefox.socket);
  assert.throws(() => parseBrowserFlags(["--browser-mode", "unsupported"]), /browserMode must be/);

  await scratch.close();
  await listen(legacy);
  await assert.rejects(resolver({ env: { ZEN_MCP_BROWSER_MODE: "scratch" } }).resolve(), /scratch.*not running/);
});
