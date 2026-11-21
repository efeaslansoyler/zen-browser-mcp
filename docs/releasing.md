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

npm reads 0.x the same way: `^0.2.0` accepts 0.2.x but not 0.3.0, so a minor version is
the only safe place for a breaking change.

1.0.0 is the owner's decision. The usual signal is that people depend on the tool names,
parameters and config in daily use and the last few minor versions needed no **Breaking:**
line. From then on breaking changes need a major version.

## When to release

The contents of `## [Unreleased]` decide when to release, not the calendar or a mood:

| Unreleased contains | Release |
|---|---|
| A `Security` line | a patch as soon as the fix is on `main` and the checks in step 1 pass |
| A `Fixed` line for something that worked in the last release and broke | a patch within a few days |
| Other `Fixed` lines | with the next release, or a patch within two weeks |
| `Added` or `Changed` lines | a minor (or patch) once the feature is finished and documented; don't hold finished work back for more than two weeks |
| Nothing | no release |

A release ships everything in Unreleased; versions are cumulative, so nobody needs the ones
in between. When a trigger above is met, an agent says so and proposes the version. The
owner approves; agents never bump the version, tag or publish on their own.

Large commit-driven release tools (semantic-release, release-please, Changesets) were
considered and not adopted. This is one package with a hand-written changelog that is
already updated in the same commit as the change, and a tag-triggered workflow publishes it.

## Releasing

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

The very first version of the package (0.2.0) was published by hand: npm only accepts a
trusted publisher for a package that already exists. After `npm login` and `npm publish` from
the release commit, the package's npm settings got a GitHub Actions trusted publisher for
`efeaslansoyler/zen-browser-mcp` and `publish.yml` with direct publishing allowed, and only
then was the tag pushed; the workflow saw the version on npm and skipped publishing. CI
covers the Node checks only; the Gecko, archive and tarball checks in step 1 stay manual.

A failed publish leaves nothing on npm: fix the cause on `main` and release the next patch
version, since tags are protected and can't be moved. Fixes for a released version go to
`main` and ship as the next patch; there are no release branches.

A published version is never unpublished or republished. If it is broken, release the fix
as the next patch and mark the bad one with
`npm deprecate zen-browser-mcp@X.Y.Z "<what is wrong>; use X.Y.Z+1"`. A breaking change
released by mistake in a patch is reverted in the next patch and comes back in a minor.
