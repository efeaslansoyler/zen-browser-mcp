import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

const T3 = { T3CODE_THREAD_ID: "nested-test-thread", T3CODE_CLI_PATH: "/bin/t3" };
const CHANNEL = ["--dangerously-load-development-channels", "server:zen"];

// why: Process ancestry is what is under test, so each step is a real process; the last one is the MCP server.
function delivery(...steps) {
  const env = { ...process.env, ZEN_TEST_CHAIN: JSON.stringify(steps) };
  for (const name of ["T3CODE_THREAD_ID", "T3CODE_CLI_PATH", "ZEN_MCP_CHANNEL"]) delete env[name];
  const script = path.join(import.meta.dirname, "support/process-chain.mjs");
  return JSON.parse(execFileSync(process.execPath, [script], { env, encoding: "utf8" }));
}
const client = (env, args) => ({ env, args });
const server = {};
const shell = { shell: true };

test("an agent T3 starts owns the thread", () => {
  assert.equal(delivery(client(T3), server).t3, T3.T3CODE_THREAD_ID);
});

test("an agent started inside a T3 session doesn't own the outer thread", () => {
  assert.equal(delivery(client(T3), client(), server).t3, null);
  assert.equal(delivery(client(T3), shell, client(), server).t3, null);
  assert.equal(delivery(client(T3), client(), client(), client(), server).t3, null);
});

test("a T3 run from inside a T3 session gives its own agents their thread", () => {
  const inner = { ...T3, T3CODE_THREAD_ID: "inner-test-thread" };
  assert.equal(delivery(client(T3), client(), client(inner), server).t3, "inner-test-thread");
});

test("a shell that starts the server is not taken for the client", () => {
  assert.equal(delivery(client(T3), shell).t3, T3.T3CODE_THREAD_ID);
  assert.equal(delivery(client({}, CHANNEL), shell).channel, true);
});

test("an agent started inside a Claude with a channel has no channel of its own", () => {
  assert.equal(delivery(client({}, CHANNEL), server).channel, true);
  assert.equal(delivery(client({}, CHANNEL), client(), server).channel, false);
  assert.equal(delivery(client({}, CHANNEL), shell, client(), server).channel, false);
  assert.equal(delivery(client({}, CHANNEL), client({}, CHANNEL), server).channel, true);
});

test("a prompt hook asks for its own client only, not for the agents that client was started in", () => {
  assert.deepEqual(delivery(client(), server).hook, ["client"]);
  assert.deepEqual(delivery(client(), shell).hook, ["client"]);
  assert.deepEqual(delivery(client(), shell, client(), shell).hook, ["client"]);
});
