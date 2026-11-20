import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";
import { withSourceStackServer } from "../scripts/support/source-stack-server.ts";

const linuxOnly = { skip: process.platform !== "linux" };

function fixtureDir(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "source-stack-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function readPort(dir) {
  for (let i = 0; i < 100; i++) {
    try {
      const port = Number(readFileSync(path.join(dir, "port"), "utf8"));
      if (port) return port;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await sleep(20);
  }
  assert.fail("fixture did not record its port");
}

test("a listener that takes the fixture port during startup survives cleanup", linuxOnly, async (t) => {
  const dir = fixtureDir(t);
  const listener = createServer((_req, res) => res.end("unrelated"));
  t.after(() => listener.close());
  const attemptedSignals = [];
  const kill = process.kill;
  t.mock.method(process, "kill", (pid, signal) => {
    if (pid === process.pid) return attemptedSignals.push(signal);
    return kill(pid, signal);
  });

  const dev = `node -e 'require("node:fs").writeFileSync("port", process.argv[1]); setInterval(() => {}, 1000)' PORT`;
  const run = withSourceStackServer(
    "collision",
    dir,
    dev,
    async () => {
      assert.fail("an unrelated HTTP response was accepted");
    },
    2000,
  );
  const result = run.catch((error) => error);
  const port = await readPort(dir);
  listener.listen(port, "127.0.0.1");
  await once(listener, "listening");

  const error = await result;
  assert.match(error.message, new RegExp(`collision .*port ${port}.*cleanup failed.*unverified ownership`, "s"));
  assert.match(error.errors[0].message, /dev server did not answer from its process group/);
  assert.deepEqual(attemptedSignals, []);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), "unrelated");
});

test("the fixture process group shuts down after success and startup timeout", linuxOnly, async (t) => {
  for (const status of [200, 503]) {
    const dir = fixtureDir(t);
    const dev = `node -e '
      const port = Number(process.argv[1]);
      require("node:http").createServer((_req, res) => {
        res.writeHead(${status}); res.end("fixture");
      }).listen(port, "127.0.0.1", () => require("node:fs").writeFileSync("port", String(port)));
    ' PORT & wait`;
    const run = withSourceStackServer(
      "fixture",
      dir,
      dev,
      async (url) => {
        assert.equal(status, 200);
        assert.equal(await (await fetch(url)).text(), "fixture");
      },
      2000,
    );
    if (status === 200) await run;
    else await assert.rejects(run, /fixture.*did not answer/);
    const port = await readPort(dir);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/`));
  }
});
