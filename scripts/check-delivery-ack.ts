import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { LOG_FILE, RUNTIME_DIR } from "../src/paths.ts";
import { call, subscribe } from "../src/zen.ts";
import { assertBridgeRunsCheckout } from "./support/bridge.ts";

const socketPath = process.env.ZEN_MCP_SOCKET;
assert(
  socketPath === path.join(RUNTIME_DIR, "zen-mcp.sock") &&
    path.basename(RUNTIME_DIR).startsWith("zs.") &&
    existsSync(path.join(RUNTIME_DIR, "browser.pid")),
  "Run this check in scripts/sandbox.ts.",
);
await assertBridgeRunsCheckout();

const id = `delivery-ack-${randomUUID()}`;
const current = `${id}-current`;
const raw = `${id}-raw`;
const options = (session: string) => ({
  session,
  clientSession: session,
  cwd: process.cwd(),
  ack: true,
  toolsOnly: true,
  push: "channel",
});
const receipts = {
  "legacy unavailable": { ok: false, error: "no push path" },
  "legacy failed": { ok: false, error: "fixture delivery failed" },
  "structured unavailable": { ok: false, status: "unavailable" },
  "structured failed": { ok: false, status: "failed", error: "no push path" },
};
const text = async (tool: string, args: object) => {
  const [result] = await call(tool, args, 5000);
  assert.equal(result?.type, "text");
  return result.text;
};
const chrome = (code: string) => text("chrome_eval", { code });
const log = () => (existsSync(LOG_FILE) ? readFileSync(LOG_FILE, "utf8") : "");
const receiver = subscribe(() => "unavailable", options(current));
const socket = net.createConnection(socketPath);
const lines = createInterface({ input: socket });
try {
  lines.on("line", (line) => {
    const { id, content } = JSON.parse(line);
    const receipt = receipts[content as keyof typeof receipts];
    assert(receipt, `Unexpected fixture event: ${content}`);
    socket.write(JSON.stringify({ event: "delivery", id, ...receipt }) + "\n");
  });
  await once(socket, "connect");
  socket.write(JSON.stringify({ tool: "subscribe", args: options(raw) }) + "\n");

  const connected = `h.subscribers.has(${JSON.stringify(current)}) && h.subscribers.has(${JSON.stringify(raw)})`;
  for (let i = 0; i < 50 && (await chrome(connected)) !== "true"; i++) await sleep(50);
  assert.equal(await chrome(connected), "true", "Fixture subscribers did not connect.");

  for (const [clientSession, content, error] of [
    [current, "current Node unavailable", ""],
    [raw, "legacy unavailable", ""],
    [raw, "legacy failed", "fixture delivery failed"],
    [raw, "structured unavailable", ""],
    [raw, "structured failed", "no push path"],
  ]) {
    const offset = log().length;
    const item = JSON.stringify({ kind: "pick", content });
    assert.equal(await chrome(`h.inbox.send(${JSON.stringify(clientSession)}, ${item})`), "waiting");
    const logged = log().slice(offset);
    if (error) assert(logged.includes(`pick delivery: Error: ${error}`), logged);
    else assert(!logged.includes("pick delivery:"), logged);
    const take = () => text("inbox_take", { client: "generic", clientSession });
    assert((await take()).endsWith(content));
    assert.equal(await take(), "");
    console.log(
      `✓ ${content}: inbox delivered once${error ? " and logged the failure" : " without logging a failure"}`,
    );
  }
} finally {
  lines.close();
  socket.destroy();
  receiver.close();
}
