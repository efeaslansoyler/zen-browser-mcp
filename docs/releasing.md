# Versions, changelog and releases

The package has one version, in `package.json`: the MCP server, the CLI, the browser bridge
and the agent skill ship and change together.

The version also updates users' browsers. `install` copies `browser/` into the data
directory with a `.version` file, and when an MCP client starts the server, it copies the
package's `browser/` again and reloads the bridge only if that version differs
(`syncBrowserFiles` in `src/install.ts`). A release that changes `browser/` without a new
version leaves every existing installation on the old bridge.

## Changelog

[CHANGELOG.md](../CHANGELOG.md) follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

- A commit that changes what users or agents see adds its line under `## [Unreleased]` in the
  same commit. Use the headings `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed` and
  `Security`, in that order, and create a heading only when it gets a line.
- Visible means tools, their parameters, results and descriptions, server instructions,
  permission operations and templates, config keys, CLI commands and flags, environment
  variables, hooks, the island and menus, the skill, install steps and supported browsers.
- Write for the user: what changed and what they must do, if anything. One line per change,
  not per commit; extend an existing Unreleased line when a later commit changes the same
  feature. Start a breaking change with **Breaking:** and say how to adapt.
- No entry for tests, CI, refactors without visible effect, dev scripts or docs-only edits.
- Released sections are history: change them only to correct a mistake.

## Choosing the version

[Semantic Versioning](https://semver.org/spec/v2.0.0.html), read for 0.x as follows:

| Unreleased contains | Next version |
|---|---|
| Only `Fixed` or `Security` lines, or `Changed` lines that keep every existing call, config and command working | patch: 0.1.0 → 0.1.1 |
| Any `Added` line, or any **Breaking:** line | minor: 0.1.0 → 0.2.0 |

A change is breaking when something that worked stops working or means something else:
a removed or renamed tool, parameter, result field, permission operation, config key, CLI
command or flag, environment variable; a parameter that becomes required; a default that
asks less than before; a step users must repeat, such as running `install` again.

1.0.0 is the owner's decision. From then on breaking changes need a major version.

## Releasing

Only when the owner asks. Agents never bump the version, tag or publish on their own.

1. Check the candidate on `main`, pushed and clean:
   - CI is green for that commit.
   - `npm test`, `npm run typecheck`, `npm run lint` and `npm run format:check` pass.
   - In `node scripts/sandbox.ts up`: `check-compat.ts`, `check-permissions.ts`,
     `check-tab-access.ts` and `check-cancellation.ts`, plus the checks for areas the release
     changes (see [Contributing](../CONTRIBUTING.md#live-checks)).
   - A clean source install works: `git archive HEAD` into an empty directory, then
     `npm ci`, `npm run build` and `node dist/cli.js --version`.
   - `npm pack --dry-run` lists only the expected files, and installing that tarball in an
     empty folder gives a working `zen-browser-mcp --version`.
2. Pick the version from the table above. Rename `## [Unreleased]` to
   `## [X.Y.Z] - YYYY-MM-DD`, add a new empty `## [Unreleased]` above it and update the
   compare links at the bottom.
3. Run `npm version X.Y.Z --no-git-tag-version` (updates `package.json` and
   `package-lock.json`), then commit everything as `Release X.Y.Z`.
4. Tag that commit and push both:
   `git tag -a vX.Y.Z -m "X.Y.Z"`, `git push origin main vX.Y.Z`. The tag starts
   `.github/workflows/publish.yml`, which checks that the tag matches `package.json`, runs
   every check again and publishes to npm through trusted publishing (OIDC, no token), with
   provenance.
5. When the workflow is green, check `npm view zen-browser-mcp version`, then create the
   GitHub release with the version's changelog section as its notes:
   `gh release create vX.Y.Z --title "X.Y.Z" --notes-file <section.md> --verify-tag`.

A failed publish leaves nothing on npm: fix the cause on `main` and release the next patch
version, since tags are protected and can't be moved. Fixes for a released version go to
`main` and ship as the next patch; there are no release branches.
