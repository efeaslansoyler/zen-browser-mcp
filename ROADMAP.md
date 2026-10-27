# Roadmap

Open work and candidates, roughly in priority order. Finished work lives in git history.

## Before going public

- **Name.** `zen-mcp` is taken on npm, and the project isn't Zen-only. Pick a name, then
  rename in `src/paths.ts` (and the `zenMcpName` the loader passes to `main.js`).
- **Publish:** npm package and the MCP Registry.
- **Windows:** the bridge uses a Unix socket; needs a named pipe or another transport.

## Candidates

- **Skill for longer workflows.** If browser workflows outgrow the server instructions and
  tool descriptions (picks, handoffs, downloads, extensions), ship a skill that
  `install` sets up for Claude Code and Codex.
- **Network:** route, mock, HAR export, throttling (today the tools only observe).
- **Screenshots:** full page and PDF.
- **Web Vitals**, recording and profiling.
- **Status bar indicator** (e.g. for Quickshell/Waybar) showing which agent is working.

## Refactoring

- Move the permission section of `browser/main.js` (`describeWrite`, `requirePermission`,
  about 200 lines) into a module, and convert the tests that slice `main.js` between marker
  comments to module tests with a fake `ctx`.

## Known limits

- Two Codex windows opening old conversations through the `resume` picker at the same time
  can be matched to the wrong conversation (see [docs/codex.md](docs/codex.md)).
- The Codex service protocol is experimental; if it changes, Codex falls back to hooks and
  appears after the first message.
- Claude conversation titles come from Claude Code's undocumented session files; if their
  format changes, menus fall back to short ids.
- Sites that open a save dialog (when "always ask where to save" is on) look like "no
  download started" until the dialog is answered.
