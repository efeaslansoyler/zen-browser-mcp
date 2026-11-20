import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { parseHookInput, configureCodexHooks, handleCodexHook } from "../dist/codex-hooks.js";
import { contactRelay, ensureCodexRelay, relaySocket } from "../dist/codex-relay.js";
import { deliveryScope } from "../dist/instances.js";

test("hooks accept exact host IDs, never infer or guess a session", () => {
  const input = { session_id: randomUUID(), cwd: "/project", hook_event_name: "SessionStart" };
  assert.deepEqual(parseHookInput(input), input);
  for (const change of [{ session_id: "latest" }, { cwd: "relative" }, { hook_event_name: "Stop" }]) {
    assert.throws(() => parseHookInput({ ...input, ...change }), /metadata/);
  }
});

test("hook install/uninstall is idempotent and preserves existing user hooks", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zen-hooks-"));
  const file = path.join(dir, "hooks.json");
  const unrelated = { type: "command", command: "echo existing" };
  const original = {
    description: "keep",
    hooks: { SessionStart: [{ matcher: "startup", hooks: [unrelated] }], Stop: [{ hooks: [unrelated] }] },
  };
  try {
    fs.writeFileSync(file, JSON.stringify(original));
    configureCodexHooks("install", dir);
    const first = fs.readFileSync(file, "utf8");
    configureCodexHooks("install", dir);
    assert.equal(fs.readFileSync(file, "utf8"), first);
    const installed = JSON.parse(first);
    assert.deepEqual(installed.hooks.Stop, original.hooks.Stop);
    assert.deepEqual(installed.hooks.SessionStart[0], original.hooks.SessionStart[0]);
    for (const event of ["SessionStart", "UserPromptSubmit", "SessionEnd"]) {
      assert.equal(
        installed.hooks[event].flatMap((g) => g.hooks).filter((h) => h.command.endsWith(" codex-hook")).length,
        1,
      );
    }
    configureCodexHooks("uninstall", dir);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), original);
    assert(fs.readdirSync(dir).some((n) => n.includes("zen-backup")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function waitUntil(check) {
  for (let i = 0; i < 60; i++) {
    if (await check()) return;
    await sleep(30);
  }
  assert.fail("Timed out waiting for relay state");
}
function readControl(threadId) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(relaySocket(threadId));
    socket.on("error", reject);
    socket.on("connect", () => socket.write(JSON.stringify({ threadId, action: "ping" }) + "\n"));
    socket.on("data", (bytes) => {
      socket.destroy();
      resolve(JSON.parse(bytes.toString()));
    });
  });
}

test("a connected watcher leaves hooks available for unconfirmed threads; relay refresh and cleanup still work", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zen-relay-"));
  const previous = process.env.ZEN_MCP_SOCKET;
  process.env.ZEN_MCP_SOCKET = path.join(dir, "browser.sock");
  const threadId = randomUUID();
  const confirmedId = randomUUID();
  const input = { session_id: threadId, cwd: dir, hook_event_name: "SessionStart" };
  const watchSocket = path.join(path.dirname(relaySocket(threadId)), `watch.${deliveryScope()}.sock`);
  fs.mkdirSync(path.dirname(watchSocket), { recursive: true, mode: 0o700 });
  const watcher = net.createServer((socket) => {
    socket.once("data", (bytes) => {
      const request = JSON.parse(bytes.toString());
      socket.end(
        JSON.stringify({
          ok: true,
          daemon: true,
          threadId: request.threadId === confirmedId ? confirmedId : undefined,
        }) + "\n",
      );
    });
  });
  const clients = new Set();
  const registrations = [];
  const browser = net.createServer((socket) => {
    clients.add(socket);
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => {});
    socket.once("data", (bytes) => registrations.push(JSON.parse(bytes.toString())));
  });
  await new Promise((resolve) => browser.listen(process.env.ZEN_MCP_SOCKET, resolve));
  await new Promise((resolve) => watcher.listen(watchSocket, resolve));
  try {
    await handleCodexHook({ ...input, session_id: confirmedId });
    assert.equal(await contactRelay(confirmedId), false);
    await Promise.all([handleCodexHook(input), handleCodexHook(input)]);
    await waitUntil(() => clients.size === 1 && registrations.length >= 1);
    const first = await readControl(threadId);
    await handleCodexHook({ ...input, hook_event_name: "UserPromptSubmit" });
    await waitUntil(() => clients.size === 1 && registrations.length >= 2);
    assert.equal((await readControl(threadId)).pid, first.pid, "refresh must not spawn another process");
    assert.equal(registrations.at(-1).args.threadId, threadId);
    assert.equal(registrations.at(-1).args.session, `codex:${threadId}`);
    assert.equal(registrations.at(-1).args.agent.id, "codex");
    process.kill(first.pid, "SIGKILL");
    await waitUntil(() => clients.size === 0);
    await ensureCodexRelay({ threadId, cwd: dir });
    await waitUntil(() => clients.size === 1);
    assert.notEqual((await readControl(threadId)).pid, first.pid);
    await handleCodexHook({ ...input, hook_event_name: "SessionEnd" });
    await waitUntil(async () => !(await contactRelay(threadId)) && clients.size === 0);
  } finally {
    await contactRelay(threadId, "stop");
    await contactRelay(confirmedId, "stop");
    await new Promise((resolve) => watcher.close(resolve));
    for (const socket of clients) socket.destroy();
    await new Promise((resolve) => browser.close(resolve));
    if (previous === undefined) delete process.env.ZEN_MCP_SOCKET;
    else process.env.ZEN_MCP_SOCKET = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
