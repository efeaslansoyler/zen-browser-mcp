import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promptHook, configureClaudeHook, claudeHookInstalled, hookCommand, hooksCommand } from "../src/hooks.ts";

test("the prompt hook adds what waits for its conversation, and nothing otherwise", async () => {
  const asked = [];
  const browser = async (tool, args, timeout) => {
    asked.push([tool, args, timeout]);
    return [{ type: "text", text: args.clientSession === "with-items-1" ? "The user sent you this…" : "" }];
  };
  const out = JSON.parse(await promptHook("claude", { session_id: "with-items-1", prompt: "go" }, browser));
  assert.deepEqual(out, {
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "The user sent you this…" },
  });
  assert.deepEqual(asked[0], ["inbox_take", { client: "claude", clientSession: "with-items-1" }, 2000]);
  assert.equal(await promptHook("codex", { session_id: "empty-session" }, browser), "");
  // bad input or no browser: silent
  assert.equal(await promptHook("claude", { session_id: "../x y" }, browser), "");
  assert.equal(await promptHook("claude", null, browser), "");
  const closed = async () => {
    throw new Error("connect ENOENT");
  };
  assert.equal(await promptHook("claude", { session_id: "with-items-1" }, closed), "");
});

test("installing the Claude Code hook keeps the user's other hooks and settings", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zen-hooks-"));
  const file = path.join(dir, "settings.json");
  const theirs = { hooks: [{ type: "command", command: "my-linter" }] };
  fs.writeFileSync(file, JSON.stringify({ model: "opus", hooks: { UserPromptSubmit: [theirs] } }));
  assert.equal(claudeHookInstalled(file), false);

  configureClaudeHook("install", file);
  configureClaudeHook("install", file); // twice: still one entry
  let settings = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(settings.model, "opus");
  assert.deepEqual(settings.hooks.UserPromptSubmit, [
    theirs,
    { hooks: [{ type: "command", command: hookCommand("claude"), timeout: 5 }] },
  ]);
  assert.equal(claudeHookInstalled(file), true);
  assert.equal(fs.readdirSync(dir).filter((f) => f.includes("zen-backup")).length, 1);

  configureClaudeHook("uninstall", file);
  settings = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(settings, { model: "opus", hooks: { UserPromptSubmit: [theirs] } });
  assert.equal(claudeHookInstalled(file), false);
});

test("hooks install covers the clients that are installed", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zen-home-"));
  assert.match(hooksCommand("install", home, {}), /No Claude Code or Codex found/);
  fs.mkdirSync(path.join(home, ".claude"));
  fs.mkdirSync(path.join(home, ".codex"));
  const out = hooksCommand("install", home, {});
  assert.match(out, /Claude Code: prompt hook in .*\.claude\/settings\.json/);
  assert.match(out, /Codex: hooks in .*\.codex\/hooks\.json/);
  assert.equal(claudeHookInstalled(path.join(home, ".claude", "settings.json")), true);
  hooksCommand("uninstall", home, {});
  assert.equal(claudeHookInstalled(path.join(home, ".claude", "settings.json")), false);
  assert.throws(() => hooksCommand("maybe", home, {}), /Usage/);
});
