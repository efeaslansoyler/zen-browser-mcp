import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const scripts = path.resolve(import.meta.dirname, "../scripts");
const guard = path.join(scripts, "support/require-sandbox.ts");
// why: These start their own browser and check their own environment, or need no browser.
const OWN_RULES = ["agent-tools", "browser-modes", "comments", "instances", "launch"];
// why: It messages a real conversation, which only the user's browser knows.
const REAL_BROWSER = ["pick-delivery"];

function run(env) {
  const { status, stderr } = spawnSync(process.execPath, [guard], { env, encoding: "utf8" });
  return { status, stderr };
}

test("every live check that talks to a running browser refuses without a sandbox", () => {
  const exempt = [...OWN_RULES, ...REAL_BROWSER].map((name) => `check-${name}.ts`);
  const checks = readdirSync(scripts).filter((file) => /^check-.*\.ts$/.test(file) && !exempt.includes(file));
  assert(checks.length > 30);
  for (const file of checks)
    assert.match(readFileSync(path.join(scripts, file), "utf8"), /^import "\.\/support\/require-sandbox\.ts";$/m, file);
});

test("only a disposable runtime directory with its own socket counts as a sandbox", (t) => {
  const runtime = mkdtempSync(path.join(tmpdir(), "zs."));
  t.after(() => rmSync(runtime, { recursive: true }));
  const socket = path.join(runtime, "zen-mcp.sock");
  const sandbox = { XDG_RUNTIME_DIR: runtime, ZEN_MCP_SOCKET: socket };
  assert.equal(run(sandbox).status, 1, "no browser listens there");
  writeFileSync(socket, "");
  assert.equal(run(sandbox).status, 0);

  const own = `/run/user/${process.getuid()}`;
  for (const env of [
    {},
    { XDG_RUNTIME_DIR: own },
    { XDG_RUNTIME_DIR: runtime },
    { ZEN_MCP_SOCKET: socket },
    { XDG_RUNTIME_DIR: own, ZEN_MCP_SOCKET: `${own}/zen-mcp.sock` },
    { XDG_RUNTIME_DIR: `${own}/`, ZEN_MCP_SOCKET: socket },
    { XDG_RUNTIME_DIR: runtime, ZEN_MCP_SOCKET: `${own}/zen-mcp.sock` },
  ]) {
    const { status, stderr } = run(env);
    assert.equal(status, 1, JSON.stringify(env));
    assert.match(stderr, /node scripts\/sandbox\.ts up/);
  }
});
