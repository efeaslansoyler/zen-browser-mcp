import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

type Comment = { type: "Line" | "Block"; value: string };
const parseForESLint = tseslint.parser.parseForESLint as (
  source: string,
  options: { filePath: string; comment: true },
) => { ast: { comments: Comment[] } };

const root = fileURLToPath(new URL("../", import.meta.url));
const baselineFile = new URL("comments-baseline.json", import.meta.url);
const baseline: Record<string, number> = JSON.parse(readFileSync(baselineFile, "utf8"));
const paths = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "src", "browser", "scripts", "test"],
  { cwd: root, encoding: "utf8" },
);

const counts: Record<string, number> = {};
for (const file of [...new Set(paths.split("\0"))].sort()) {
  if (!/\.(?:ts|mjs|js)$/.test(file) || file.startsWith("browser/vendor/")) continue;
  const sourceFile = join(root, file);
  if (!existsSync(sourceFile)) continue;
  const source = readFileSync(sourceFile, "utf8");
  const { comments } = parseForESLint(source, { filePath: file, comment: true }).ast;
  const count = comments.filter(
    ({ type, value }) =>
      !(type === "Line" && value.startsWith(" why:")) && !/^\s*(?:eslint-disable\b|@ts-)/.test(value),
  ).length;
  if (count > 0) counts[file] = count;
}

for (const [file, count] of Object.entries(counts)) {
  const limit = baseline[file] ?? 0;
  if (count > limit) {
    console.error(`${file}: ${count} comments without // why: (baseline: ${limit}).`);
    process.exitCode = 1;
  }
}

if (process.argv.includes("--update") && !process.exitCode) {
  writeFileSync(baselineFile, JSON.stringify(counts, null, 2) + "\n");
}
