## What and why

<!-- What changes for users or agents, and why. Link the issue: Fixes #123 -->

## Checks

- [ ] `npm test`, `npm run typecheck`, `npm run lint` and `npm run format:check` pass
- [ ] For changes in `browser/`: the matching `scripts/check-*.ts` passed in `node scripts/sandbox.ts up` (name them below)
- [ ] A visible change has its line under `## [Unreleased]` in `CHANGELOG.md` (see `docs/releasing.md`)
- [ ] Docs describe the new behavior; nothing in them became wrong

## Live checks run

<!-- e.g. check-permissions.ts, check-tab-access.ts; or "none: no browser/ change" -->
