import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { EventEmitter } from "node:events";
import { call } from "../dist/zen.js";

// why: Mock the wire connection alone; instance discovery has its own tests.
let previousSocket;
beforeEach(() => {
  previousSocket = process.env.ZEN_MCP_SOCKET;
  process.env.ZEN_MCP_SOCKET = "/wire-test.sock";
});
afterEach(() => {
  if (previousSocket === undefined) delete process.env.ZEN_MCP_SOCKET;
  else process.env.ZEN_MCP_SOCKET = previousSocket;
});

test("wire carries identity and preserves partial batch failures", async (t) => {
  let request;
  const socket = new EventEmitter();
  socket.setTimeout = () => socket;
  socket.end = () => socket.emit("close");
  socket.write = (packet) => {
    request = JSON.parse(packet);
    queueMicrotask(() =>
      socket.emit(
        "data",
        Buffer.from(
          JSON.stringify({ ok: true, content: [{ type: "text", text: "partial results" }], isError: true }) + "\n",
        ),
      ),
    );
  };
  t.mock.method(net, "createConnection", (path) => {
    assert.equal(path, "/wire-test.sock");
    queueMicrotask(() => socket.emit("connect"));
    return socket;
  });
  const result = await call("browser_batch", { actions: [] }, 1000, { id: "codex", name: "Codex" });
  assert.deepEqual(request.agent, { id: "codex", name: "Codex" });
  assert.equal(typeof request.session, "string");
  assert.equal(result.isError, true);
  assert.equal(result[0].text, "partial results");
});

test("an empty closed browser connection rejects instead of hanging", async (t) => {
  const socket = new EventEmitter();
  socket.setTimeout = () => socket;
  socket.write = () => queueMicrotask(() => socket.emit("close"));
  t.mock.method(net, "createConnection", () => {
    queueMicrotask(() => socket.emit("connect"));
    return socket;
  });
  await assert.rejects(call("ping"), /closed the connection without a reply/);
});

for (const [outcome, receipt] of [
  ["sent", { ok: true }],
  ["unavailable", { ok: false, status: "unavailable", error: "no push path" }],
  ["queue denied", { ok: false, status: "failed", error: "queue denied" }],
  ["no push path", { ok: false, status: "failed", error: "Delivery rejected: no push path" }],
]) {
  test(`subscription acknowledges delivery only after handler settles (${outcome})`, async (t) => {
    const { subscribe } = await import("../dist/zen.js");
    const writes = [];
    const socket = new EventEmitter();
    socket.destroyed = false;
    socket.write = (packet) => writes.push(JSON.parse(packet));
    socket.destroy = () => {
      socket.destroyed = true;
      socket.emit("close");
    };
    t.mock.method(net, "createConnection", () => {
      queueMicrotask(() => socket.emit("connect"));
      return socket;
    });
    let complete, reject;
    const delivery = new Promise((resolve, fail) => {
      complete = resolve;
      reject = fail;
    });
    const sub = subscribe(() => delivery, { cwd: "/project", ack: true, agent: { id: "codex", name: "Codex" } });
    try {
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(writes[0].args.ack, true);
      socket.emit("data", Buffer.from('{"event":"channel","id":"receipt","content":"test"}\n'));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(writes.length, 1, "no premature acknowledgement");
      if (outcome === "unavailable") complete("unavailable");
      else if (outcome === "sent") complete();
      else reject(new Error(outcome));
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(writes[1], { event: "delivery", id: "receipt", ...receipt });
    } finally {
      sub.close();
    }
  });
}

test("ownership lifecycle subscription and tool requests use the same process session ID", async (t) => {
  const { subscribe, session } = await import("../dist/zen.js");
  const requests = [];
  t.mock.method(net, "createConnection", () => {
    const socket = new EventEmitter();
    socket.destroyed = false;
    socket.setTimeout = () => socket;
    socket.end = () => socket.emit("close");
    socket.destroy = () => {
      socket.destroyed = true;
      socket.emit("close");
    };
    socket.write = (packet) => {
      const request = JSON.parse(packet);
      requests.push(request);
      if (request.tool !== "subscribe")
        queueMicrotask(() => socket.emit("data", Buffer.from('{"ok":true,"content":[]}\n')));
    };
    queueMicrotask(() => socket.emit("connect"));
    return socket;
  });
  const sub = subscribe(() => {}, { cwd: "/project", toolsOnly: true, agent: { id: "codex" } });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    await call("tabs_context_mcp");
    assert.equal(requests[0].args.toolsOnly, true);
    assert.equal(requests[0].args.session, session);
    assert.equal(requests[1].session, session);
  } finally {
    sub.close();
  }
});

test("a title goes out on the open connection, and a reconnect carries the latest one", async (t) => {
  const { subscribe } = await import("../dist/zen.js");
  const sockets = [];
  t.mock.method(net, "createConnection", () => {
    const socket = Object.assign(new EventEmitter(), { connecting: true, destroyed: false, writes: [] });
    socket.write = (packet) => socket.writes.push(JSON.parse(packet));
    socket.destroy = () => {
      socket.destroyed = true;
      socket.emit("close");
    };
    sockets.push(socket);
    return socket;
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const connect = (socket) => {
    socket.connecting = false;
    socket.emit("connect");
  };
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sub = subscribe(() => {}, { cwd: "/project", toolsOnly: true, agent: { id: "claude" }, title: "One" });
  try {
    await settle();
    sub.setTitle("Two");
    assert.deepEqual(sockets[0].writes, [], "a title before the subscription would be read as the request");
    connect(sockets[0]);
    assert.equal(sockets[0].writes[0].args.title, "Two");
    sub.setTitle("Üç");
    sub.setTitle(undefined);
    sub.setTitle("Four");
    assert.deepEqual(sockets[0].writes.slice(1), [
      { event: "title", title: "Üç" },
      { event: "title", title: null },
      { event: "title", title: "Four" },
    ]);
    assert.equal(sockets.length, 1);
    sockets[0].destroy();
    sub.setTitle("Five");
    t.mock.timers.tick(3000);
    await settle();
    connect(sockets[1]);
    assert.equal(sockets[1].writes[0].args.title, "Five");
  } finally {
    sub.close();
  }
});
