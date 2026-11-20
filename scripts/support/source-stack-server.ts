import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer, type AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

async function availablePort() {
  const reservation = createServer().listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const { port } = reservation.address() as AddressInfo;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  return port;
}

function listenersOn(port: number) {
  return execFileSync("ss", ["-ltnpH", "sport", "=", `:${port}`], { encoding: "utf8" }).trim();
}

function groupMembers(group: number | undefined) {
  if (!group) return new Set<number>();
  const result = spawnSync("ps", ["-s", String(group), "-o", "pid=,pgid=,stat="], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status === 1 && !result.stderr) return new Set<number>();
  if (result.status !== 0) throw new Error(`ps failed: ${result.stderr || result.signal || result.status}`);
  const members = new Set<number>();
  for (const line of result.stdout.trim().split("\n")) {
    const [pid, pgid, state] = line.trim().split(/\s+/);
    if (Number(pgid) === group && !state.startsWith("Z")) members.add(Number(pid));
  }
  return members;
}

function ownedListener(port: number, group: number | undefined) {
  const listeners = listenersOn(port);
  if (!listeners) return false;
  const members = groupMembers(group);
  return listeners.split("\n").every((line) => {
    const pids = [...line.matchAll(/pid=(\d+)/g)];
    return pids.length > 0 && pids.every((match) => members.has(Number(match[1])));
  });
}

async function stopGroup(group: number | undefined) {
  if (!group) return;
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    if (!groupMembers(group).size) return;
    try {
      process.kill(-group, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    const deadline = Date.now() + 1000;
    while (groupMembers(group).size && Date.now() < deadline) await sleep(50);
  }
  const remaining = groupMembers(group);
  if (remaining.size) throw new Error(`process group ${group} still has PIDs ${[...remaining].join(", ")}`);
}

async function waitForServer(server: ChildProcess, port: number, url: string, label: string, timeoutMs: number) {
  let spawnError: Error | undefined;
  server.on("error", (error) => (spawnError = error));
  const signal = AbortSignal.timeout(timeoutMs);
  while (!signal.aborted) {
    if (spawnError) throw new Error(`${label}: could not launch the dev server.`, { cause: spawnError });
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`${label}: dev server exited before readiness (${server.exitCode ?? server.signalCode}).`);
    }
    // why: The CLI binds after the reservation closes, so a 200 alone cannot establish ownership.
    if (ownedListener(port, server.pid)) {
      const response = await fetch(url, { signal, redirect: "error", headers: { connection: "close" } }).catch(
        () => undefined,
      );
      await response?.body?.cancel().catch(() => {});
      if (response?.ok && ownedListener(port, server.pid)) return;
    }
    await sleep(100);
  }
  throw new Error(`${label}: dev server did not answer from its process group on ${url}.`);
}

export async function withSourceStackServer(
  id: string,
  dir: string,
  dev: string,
  run: (url: string) => Promise<void>,
  timeoutMs = 90_000,
) {
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}/`;
  const label = `${id} (port ${port})`;
  // why: A private process group owns the foreground dev server and its descendants.
  const server = spawn("sh", ["-c", dev.replace("PORT", String(port))], {
    cwd: dir,
    detached: true,
    stdio: "ignore",
  });
  server.unref();

  let failure: { error: unknown } | undefined;
  try {
    await waitForServer(server, port, url, label, timeoutMs);
    await run(url);
  } catch (error) {
    failure = { error };
  }

  try {
    await stopGroup(server.pid);
    const listeners = listenersOn(port);
    if (listeners) throw new Error(`remaining listener(s) with unverified ownership:\n${listeners}`);
  } catch (error) {
    const message = `${label}: cleanup failed: ${error instanceof Error ? error.message : String(error)}`;
    if (failure) throw new AggregateError([failure.error, error], message, { cause: error });
    throw new Error(message, { cause: error });
  }
  if (failure) throw failure.error;
}
