# Notes for agents working on this repo

Read [docs/README.md](docs/README.md) for the map, [CONTRIBUTING.md](CONTRIBUTING.md) for the
edit/test loop, and [ROADMAP.md](ROADMAP.md) for open work.

- **The bridge runs inside the user's real browser.** Test on a copy or in your own tabs;
  never act on the user's tabs without `request_tab` approval.
- After changing `browser/`: `node scripts/zenctl.ts reload` (it fails loudly if the new
  version didn't start). After changing `src/`: the MCP client must reconnect.
- `npm test` must pass. For behavior that depends on Gecko, also run the matching
  `scripts/check-*.ts` live check. Never run `check-pick-delivery.ts` casually: it messages a
  real Codex conversation.
- Live checks share the user's `~/.config/zen-mcp/config.json`; confirm `"mode": "auto"`
  afterwards.
- `zenctl` calls are one-off sessions: they can't reuse each other's tabs. Clean up tabs you
  open.
- Check [docs/gecko-pitfalls.md](docs/gecko-pitfalls.md) before debugging browser behavior,
  and add new pitfalls there.
- Keep docs current instead of appending dated logs: update the relevant page, delete what
  became wrong. Commit messages carry the history.
- Don't push, publish or rename without the user asking.
