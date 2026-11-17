import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { skillCommand, skillStatus, skillTargets } from "../dist/skill.js";

const source = fs.readFileSync(new URL("../skills/zen-browser/SKILL.md", import.meta.url), "utf8");

test("the skill has the frontmatter Claude Code and Codex need", () => {
  const front = source.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
  assert(front, "frontmatter missing");
  assert.match(front, /^name: zen-browser$/m);
  assert.match(front, /^description: .{40,}/m);
});

test("skill install and uninstall touch only present clients and only the skill folder", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zen-skill-"));
  try {
    fs.mkdirSync(path.join(home, ".claude"));
    const targets = skillTargets(home, {});
    const log = console.log;
    console.log = () => {};
    try {
      assert.deepEqual(
        skillStatus(targets).map((t) => [t.client, t.status]),
        [["Claude Code", "missing"]],
      );
      skillCommand("install", targets);
      assert.equal(fs.readFileSync(path.join(home, ".claude/skills/zen-browser/SKILL.md"), "utf8"), source);
      assert.equal(fs.existsSync(path.join(home, ".agents")), false, "Codex is not installed");
      assert.equal(skillStatus(targets)[0].status, "current");
      fs.writeFileSync(path.join(home, ".claude/skills/zen-browser/SKILL.md"), "old");
      assert.equal(skillStatus(targets)[0].status, "outdated");
      fs.mkdirSync(path.join(home, ".claude/skills/other"));
      skillCommand("uninstall", targets);
      assert.equal(fs.existsSync(path.join(home, ".claude/skills/zen-browser")), false);
      assert(fs.existsSync(path.join(home, ".claude/skills/other")));
      assert.throws(() => skillCommand("remove", targets), /Usage/);
    } finally {
      console.log = log;
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
