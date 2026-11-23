import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { refreshSkills, skillCommand, skillStatus, skillTargets } from "../dist/skill.js";
import { runsFromCheckout } from "../dist/paths.js";

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
      assert.equal(skillStatus(targets)[0].status, "edited");
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

function installedSkill(content, stamp) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zen-skill-"));
  const dir = path.join(home, ".claude/skills/zen-browser");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "SKILL.md");
  fs.writeFileSync(file, content);
  if (stamp) fs.writeFileSync(path.join(dir, ".installed"), createHash("sha256").update(stamp).digest("hex") + "\n");
  const targets = skillTargets(home, {});
  return {
    home,
    dir,
    file,
    targets,
    status: () => skillStatus(targets)[0].status,
    read: () => fs.readFileSync(file, "utf8"),
    remove: () => fs.rmSync(home, { recursive: true, force: true }),
  };
}

test("an untouched older copy is refreshed, and again after the next update", () => {
  const skill = installedSkill("older", "older");
  try {
    assert.equal(skill.status(), "outdated");
    fs.writeFileSync(path.join(skill.dir, "notes.md"), "mine");
    refreshSkills(skill.targets);
    assert.equal(skill.read(), source);
    assert.equal(skill.status(), "current");
    assert.deepEqual(fs.readdirSync(skill.dir).sort(), [".installed", "SKILL.md", "notes.md"]);
    const stamp = fs.readFileSync(path.join(skill.dir, ".installed"), "utf8").trim();
    assert.equal(stamp, createHash("sha256").update(source).digest("hex"));
  } finally {
    skill.remove();
  }
});

test("a copy the user edited, or one of unknown origin, is left alone", () => {
  for (const stamp of ["older", undefined]) {
    const skill = installedSkill("my own version", stamp);
    try {
      refreshSkills(skill.targets);
      assert.equal(skill.read(), "my own version");
      assert.equal(skill.status(), "edited");
    } finally {
      skill.remove();
    }
  }
});

test("skill install stamps its copy, and a current copy without a stamp gets one", () => {
  const skill = installedSkill(source);
  const log = console.log;
  console.log = () => {};
  try {
    refreshSkills(skill.targets);
    assert(fs.existsSync(path.join(skill.dir, ".installed")));
    skillCommand("install", skill.targets);
    fs.writeFileSync(skill.file, "edited later");
    refreshSkills(skill.targets);
    assert.equal(skill.read(), "edited later");
  } finally {
    console.log = log;
    skill.remove();
  }
});

test("the skill is never installed by a refresh, and a link is never written through", () => {
  const skill = installedSkill("older", "older");
  try {
    const elsewhere = path.join(skill.home, "elsewhere");
    fs.renameSync(skill.dir, elsewhere);
    refreshSkills(skill.targets);
    assert.equal(fs.existsSync(skill.dir), false);
    fs.symlinkSync(elsewhere, skill.dir);
    refreshSkills(skill.targets);
    assert.equal(fs.readFileSync(path.join(elsewhere, "SKILL.md"), "utf8"), "older");
    fs.rmSync(skill.dir);
    fs.mkdirSync(skill.dir);
    fs.copyFileSync(path.join(elsewhere, ".installed"), path.join(skill.dir, ".installed"));
    fs.symlinkSync(path.join(elsewhere, "SKILL.md"), skill.file);
    refreshSkills(skill.targets);
    assert.equal(skill.read(), "older");
    assert(fs.lstatSync(skill.file).isSymbolicLink());
  } finally {
    skill.remove();
  }
});

test("a copy that can't be written doesn't stop the others", () => {
  const broken = installedSkill("older", "older");
  const skill = installedSkill("older", "older");
  try {
    fs.mkdirSync(path.join(broken.dir, `SKILL.md.${process.pid}`));
    refreshSkills([...broken.targets, ...skill.targets]);
    assert.equal(broken.read(), "older");
    assert.equal(skill.read(), source);
  } finally {
    broken.remove();
    skill.remove();
  }
});

test("a refresh replaces only SKILL.md, so the skill must stay that one file", () => {
  assert.deepEqual(fs.readdirSync(new URL("../skills/zen-browser", import.meta.url)), ["SKILL.md"]);
});

test("a checkout or worktree is told apart from an installed package", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zen-package-"));
  try {
    assert.equal(runsFromCheckout(dir), false);
    fs.writeFileSync(path.join(dir, ".git"), "gitdir: elsewhere\n");
    assert.equal(runsFromCheckout(dir), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
