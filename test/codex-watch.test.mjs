import test from "node:test";
import assert from "node:assert/strict";
import { parseTui, visibleThreads } from "../dist/codex-watch.js";
import { codexSession } from "../dist/server.js";

const A = "01a17dd5-f1ba-79f2-b881-e7b636dfe9c4";
const B = "01a17ddc-41c9-7131-8b1b-2035e3027911";
const C = "01a17de2-f4e9-77a1-ba2c-61bc6ff33664";
const thread = (id, createdAt, extra = {}) => ({
  id,
  cwd: "/p",
  createdAt,
  loadedAt: createdAt,
  ephemeral: false,
  ...extra,
});

test("only interactive codex windows count; resume gives the exact thread", () => {
  assert.deepEqual(parseTui(["codex"]), {});
  assert.deepEqual(parseTui(["/usr/bin/codex", "-m", "x"]), {});
  assert.deepEqual(parseTui(["codex", "resume", B]), { threadId: B });
  assert.deepEqual(parseTui(["codex", "resume"]), { threadId: undefined });
  assert.equal(parseTui(["codex", "app-server", "--listen", "unix://"]), null);
  assert.equal(parseTui(["codex", "exec", "hi"]), null);
  assert.equal(parseTui(["codex", "agents"]), null);
  assert.equal(parseTui(["node", "codex"]), null);
});

test("detached background threads stay hidden; a window shows its newest thread", () => {
  const threads = [thread(A, 1000), thread(B, 5000), thread(C, 5100, { ephemeral: true })];
  assert.deepEqual([...visibleThreads(threads, [])], []);
  assert.deepEqual([...visibleThreads(threads, [{ pid: 1, startedAt: 4900 }])], [B]);
  assert.deepEqual(
    new Set(
      visibleThreads(threads, [
        { pid: 1, startedAt: 900, threadId: A },
        { pid: 2, startedAt: 4900 },
      ]),
    ),
    new Set([A, B]),
  );
  assert.deepEqual([...visibleThreads([thread(B, 5000)], [{ pid: 1, startedAt: 9000, threadId: A }])], []);
});

test("codex tool calls are owned by their thread, others keep the process session", () => {
  assert.equal(codexSession({ id: "codex" }, { threadId: C }), `codex:${C}`);
  assert.equal(codexSession({ id: "codex" }, { "x-codex-turn-metadata": { thread_id: C } }), `codex:${C}`);
  assert.equal(codexSession({ id: "codex" }, { threadId: "nope" }), undefined);
  assert.equal(codexSession({ id: "claude" }, { threadId: C }), undefined);
  assert.equal(codexSession({ id: "codex" }, undefined), undefined);
});

test("claude title follows the current conversation; /rename wins over the generated title", async () => {
  const { claudeTitle } = await import("../dist/claude.js");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "claude-title-"));
  try {
    assert.equal(claudeTitle(4242, home), undefined);
    fs.mkdirSync(path.join(home, "sessions"));
    fs.writeFileSync(
      path.join(home, "sessions", "4242.json"),
      JSON.stringify({ sessionId: "s1", cwd: "/home/u/my.proj" }),
    );
    const dir = path.join(home, "projects", "-home-u-my-proj");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "s1.jsonl");
    fs.writeFileSync(
      file,
      [
        '{"type":"user"}',
        '{"type":"ai-title","aiTitle":"Old"}',
        "not json -title",
        '{"type":"ai-title","aiTitle":"Download tracking"}',
      ].join("\n") + "\n",
    );
    assert.equal(claudeTitle(4242, home), "Download tracking");
    fs.appendFileSync(file, '{"type":"custom-title","customTitle":"My name"}\n{"type":"ai-title","aiTitle":"Later"}\n');
    assert.equal(claudeTitle(4242, home), "My name");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
