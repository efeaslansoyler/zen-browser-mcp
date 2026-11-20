// One local receiver per exact Codex thread. Session hooks supply the UUID; never infer it.
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { RUNTIME_DIR, NAME } from "./paths.ts";
import { subscribe } from "./zen.ts";
import { browserResolver, deliveryScope, type Selection } from "./instances.ts";
import { THREAD_ID, deliverCodexPick } from "./delivery.ts";

export type RelayOptions = { threadId: string; cwd: string; label?: string };
export function relaySocket(threadId: string, scope = deliveryScope()) {
  if (!THREAD_ID.test(threadId)) throw new Error("An exact Codex thread UUID is required.");
  return path.join(RUNTIME_DIR, `${NAME}-codex`, `${scope ? scope + "." : ""}${threadId}.sock`);
}

export function contactRelay(
  threadId: string,
  action: "ping" | "stop" | "refresh" = "ping",
  options?: RelayOptions,
  scope?: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(relaySocket(threadId, scope));
    let data = "";
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(500, () => finish(false));
    socket.on("error", () => finish(false));
    socket.on("connect", () => socket.write(JSON.stringify({ action, threadId, ...options }) + "\n"));
    socket.on("data", (chunk) => {
      data += chunk;
      if (!data.includes("\n")) return;
      try {
        const reply = JSON.parse(data);
        finish(reply.ok === true && reply.threadId === threadId);
      } catch {
        finish(false);
      }
    });
    socket.on("close", () => finish(false));
  });
}

export async function ensureCodexRelay(options: RelayOptions) {
  if (!THREAD_ID.test(options.threadId)) throw new Error("An exact Codex thread UUID is required.");
  const target = await browserResolver.resolve();
  const scope = deliveryScope(target);
  if (await contactRelay(options.threadId, "refresh", options, scope)) return;
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), "--relay", JSON.stringify(options), JSON.stringify(target)],
    {
      detached: true,
      stdio: "ignore",
      cwd: options.cwd,
    },
  );
  let spawnError: Error | undefined;
  child.on("error", (error) => {
    spawnError = error;
  });
  child.unref();
  for (let i = 0; i < 25; i++) {
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (spawnError) throw spawnError;
    if (await contactRelay(options.threadId, "ping", undefined, scope)) return;
  }
  throw new Error("The Codex browser receiver did not start.");
}

export async function stopCodexRelays({ scope, threadId }: { scope?: string; threadId?: string } = {}) {
  const directory = path.join(RUNTIME_DIR, `${NAME}-codex`);
  let files: string[];
  try {
    files = fs.readdirSync(directory);
  } catch {
    return;
  }
  await Promise.all(
    files.map((file) => {
      if (!file.endsWith(".sock")) return;
      const parts = file.slice(0, -5).split(".");
      const id = parts.pop()!;
      const route = parts.join(".");
      if (!THREAD_ID.test(id) || (route && !/^[a-f0-9]{12}$/.test(route))) return;
      if ((scope === undefined || scope === route) && (threadId === undefined || threadId === id))
        return contactRelay(id, "stop", undefined, route);
    }),
  );
}

export async function runCodexRelay(initial: RelayOptions, target: Selection) {
  browserResolver.pinDelivery(target);
  const scope = deliveryScope(target);
  const socketPath = relaySocket(initial.threadId, scope);
  fs.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });
  if (await contactRelay(initial.threadId, "ping", undefined, scope)) return; // idempotent on resume/compaction
  let options = initial;
  let subscription: ReturnType<typeof subscribe> | undefined;
  let idleTimer: ReturnType<typeof setTimeout>;
  const touch = () => {
    clearTimeout(idleTimer);
    // SessionEnd handles normal cleanup; recover from an abruptly killed Codex client.
    idleTimer = setTimeout(
      () => {
        subscription?.close();
        server.close(() => process.exit(0));
      },
      24 * 60 * 60 * 1000,
    );
    idleTimer.unref();
  };
  const connect = () => {
    touch();
    subscription?.close();
    subscription = subscribe(
      (event) => {
        touch();
        return deliverCodexPick(options.threadId, event);
      },
      {
        cwd: options.cwd,
        label: options.label,
        threadId: options.threadId,
        agent: { id: "codex", name: "Codex" },
        ack: true,
        session: `codex:${options.threadId}`,
      },
    );
  };
  const server = net.createServer((socket) => {
    socket.setTimeout(1000, () => socket.destroy());
    let buffer = "";
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 8192) {
        socket.destroy();
        return;
      }
      if (!buffer.includes("\n")) return;
      try {
        const request = JSON.parse(buffer);
        if (request.threadId !== options.threadId) {
          socket.end();
          return;
        }
        if (request.action === "refresh") {
          options = {
            threadId: options.threadId,
            cwd: String(request.cwd || options.cwd),
            label: typeof request.label === "string" ? request.label : undefined,
          };
          connect();
        }
        socket.end(JSON.stringify({ ok: true, threadId: options.threadId, pid: process.pid }) + "\n");
        if (request.action === "stop") {
          subscription?.close();
          server.close(() => process.exit(0));
        }
      } catch {
        socket.destroy();
      }
    });
  });
  const listen = () =>
    server.listen(socketPath, () => {
      fs.chmodSync(socketPath, 0o600);
      connect();
    });
  server.on("error", (error) => {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") {
      console.error(error.message);
      process.exit(1);
    }
    // Never unlink a listening endpoint, including one still starting up.
    let inode: number;
    try {
      inode = fs.statSync(socketPath).ino;
    } catch {
      listen();
      return;
    }
    const probe = net.createConnection(socketPath);
    probe.setTimeout(500, () => {
      probe.destroy();
      process.exit(0);
    });
    probe.on("connect", () => {
      probe.destroy();
      process.exit(0);
    });
    probe.on("error", (e) => {
      if ((e as NodeJS.ErrnoException).code !== "ECONNREFUSED") {
        process.exit(0);
      }
      try {
        if (fs.statSync(socketPath).ino === inode) fs.unlinkSync(socketPath);
      } catch {}
      listen();
    });
  });
  listen();
  const stop = () => {
    subscription?.close();
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

if ((import.meta as { main?: boolean }).main && process.argv[2] === "--relay") {
  await runCodexRelay(JSON.parse(process.argv[3]), JSON.parse(process.argv[4]));
}
