# Notes for agents working on this repo

Read [docs/README.md](docs/README.md) for the map and [CONTRIBUTING.md](CONTRIBUTING.md) for the
edit/test loop.

- **The bridge runs inside the user's real browser.** Test on a copy or in your own tabs;
  never act on the user's tabs without `request_tab` approval.
- After changing `browser/`: `node scripts/zenctl.ts reload` (it fails loudly if the new
  version didn't start). After changing `src/`: the MCP client must reconnect.
- `npm test` and `npm run typecheck` must pass. For behavior that depends on Gecko, also run the matching
  `scripts/check-*.ts` live check. Never run `check-pick-delivery.ts` casually: it messages a
  real Codex conversation.
- Run live checks in an isolated headless Zen that runs your checkout's `browser/`:
  `node scripts/sandbox.ts up`, then `source` the printed env file in the same shell. This is
  required from a worktree or next to other agents. If a check uses the user's config,
  confirm `"mode": "auto"` afterwards.
- `zenctl` calls are one-off sessions unless you pass `--session <name>`. Clean up tabs you
  open.
- Check [docs/gecko-pitfalls.md](docs/gecko-pitfalls.md) before debugging browser behavior,
  and add new pitfalls there.
- Keep docs current instead of appending dated logs: update the relevant page, delete what
  became wrong. Commit messages carry the history.
- Don't push, publish or rename without the user asking.
- A commit that changes what users or agents see adds a line under `## [Unreleased]` in
  [CHANGELOG.md](CHANGELOG.md) in the same commit. Never change the version, tag or release
  unless the user asks; then follow [docs/releasing.md](docs/releasing.md), which also says
  what counts as visible and how the version is chosen.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`efeaslansoyler/zen-browser-mcp`), managed with `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
