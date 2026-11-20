import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  promptHook,
  configureClaudeHook,
  claudeHookInstalled,
  hookCommand,
  hooksCommand,
  configureAntigravityHook,
  antigravityHookInstalled,
} from "../src/hooks.ts";

test("the prompt hook adds what waits for its conversation, and nothing otherwise", async () => {
  const asked = [];
  const browser = async (tool, args, timeout) => {
    asked.push([tool, args, timeout]);
    return [{ type: "text", text: args.clientSession === "with-items-1" ? "The user sent you this…" : "" }];
  };
  const out = JSON.parse(await promptHook("claude", { session_id: "with-items-1", prompt: "go" }, browser, [10, 1]));
  assert.deepEqual(out, {
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "The user sent you this…" },
  });
  assert.deepEqual(asked[0], ["inbox_take", { client: "claude", clientSession: "with-items-1", pids: [10, 1] }, 2000]);
  assert.equal(await promptHook("codex", { session_id: "empty-session" }, browser), "");
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
  configureClaudeHook("install", file);
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
  assert.match(hooksCommand("install", home, {}), /No Claude Code, Codex, Antigravity CLI or OpenCode found/);
  fs.mkdirSync(path.join(home, ".claude"));
  fs.mkdirSync(path.join(home, ".codex"));
  fs.mkdirSync(path.join(home, ".gemini", "antigravity-cli"), { recursive: true });
  fs.mkdirSync(path.join(home, ".config", "opencode"), { recursive: true });
  const out = hooksCommand("install", home, {});
  assert.match(out, /OpenCode: plugin in .*\.config\/opencode\/plugins\/zen-browser\.js/);
  assert.match(out, /Antigravity CLI: prompt hook in .*\.gemini\/config\/hooks\.json/);
  assert.match(out, /Claude Code: prompt hook in .*\.claude\/settings\.json/);
  assert.match(out, /Codex: hooks in .*\.codex\/hooks\.json/);
  assert.equal(claudeHookInstalled(path.join(home, ".claude", "settings.json")), true);
  hooksCommand("uninstall", home, {});
  assert.equal(claudeHookInstalled(path.join(home, ".claude", "settings.json")), false);
  assert.equal(fs.existsSync(path.join(home, ".config", "opencode", "plugins", "zen-browser.js")), false);
  assert.throws(() => hooksCommand("maybe", home, {}), /Usage/);
});

test("Antigravity's hook finds the conversation by its process and injects a system message", async () => {
  const asked = [];
  const browser = async (tool, args) => {
    asked.push(args);
    return [{ type: "text", text: args.pids.includes(4242) ? "The user sent you this…" : "" }];
  };
  const input = { conversationId: "2aa390f1-f633-4f6d-9e28-48429beccf18", hookEventName: "PreInvocation" };
  const out = JSON.parse(await promptHook("antigravity", input, browser, [4300, 4242, 1]));
  assert.deepEqual(out, { injectSteps: [{ systemMessage: { systemMessage: "The user sent you this…" } }] });
  assert.equal(asked[0].clientSession, "2aa390f1-f633-4f6d-9e28-48429beccf18");
  assert.equal(await promptHook("antigravity", {}, browser, [99]), "");
});

test("the Antigravity hook is one named entry in its hooks.json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zen-agy-"));
  const file = path.join(dir, "hooks.json");
  fs.writeFileSync(file, JSON.stringify({ linter: { PostToolUse: [] } }));
  configureAntigravityHook("install", file);
  const hooks = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(Object.keys(hooks), ["linter", "zen-browser"]);
  assert.deepEqual(hooks["zen-browser"].PreInvocation, [
    { type: "command", command: hookCommand("antigravity"), timeout: 5 },
  ]);
  assert.equal(antigravityHookInstalled(file), true);
  configureAntigravityHook("uninstall", file);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { linter: { PostToolUse: [] } });
  assert.equal(antigravityHookInstalled(file), false);
  // why: Antigravity may create an empty hook file before any config has been written.
  const empty = path.join(dir, "empty.json");
  fs.writeFileSync(empty, "");
  configureAntigravityHook("install", empty);
  assert.equal(antigravityHookInstalled(empty), true);
});
