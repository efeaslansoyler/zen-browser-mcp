# Contributing

Thanks for helping. Read [docs/architecture.md](docs/architecture.md) first and
[docs/gecko-pitfalls.md](docs/gecko-pitfalls.md) before debugging browser-side behavior.

## Setup

```sh
git clone https://github.com/efeaslansoyler/zen-browser-mcp && cd zen-browser-mcp
npm ci
npm run build
node dist/cli.js install
claude mcp add --scope user zen -- node "$PWD/dist/cli.js"
```

Restart the browser after installing the loader. Developers with a fresh
data directory can link `browser/` to `${XDG_DATA_HOME:-$HOME/.local/share}/zen-mcp`
before installation. The installer leaves a development symlink in place.

## The edit loop

- **Browser side (`browser/`):** Update the installed copy if it is not linked to
  the checkout, then run `node scripts/zenctl.ts reload` to reload the bridge without
  restarting the browser. It refuses when the bridge loads a copy that differs from this
  checkout's `browser/`, compares the bridge version before and after, and exits non-zero if
  the new version failed to start; the error is in `$XDG_RUNTIME_DIR/zen-mcp.log`.
- **Node side (`src/`):** Run `npm run build`, then reconnect the MCP server in your client.
  New tool schemas and server instructions are read at connect time; instructions are only
  shown to new sessions.
- **Poke the bridge directly:** `node scripts/zenctl.ts eval 'h.version'` evaluates in the
  bridge (`h.state`, `h.tools`, `h.browserFor`, `h.query`, `h.sessions`…), and
  `node scripts/zenctl.ts find '{"tabId": 13, "query": "x"}'` calls a tool. Each `zenctl`
  call is its own session; add `--session <name>` before the command to share tabs between
  calls (`node scripts/zenctl.ts --session dev tabs_create_mcp`).

## Lint and format

`npm run lint` runs ESLint and `npm run format` runs Prettier; CI checks both. To keep
`git blame` useful across the bulk formatting commit, run
`git config blame.ignoreRevsFile .git-blame-ignore-revs` once.

## Tests

`npm test` builds and runs the unit tests: MCP client compatibility, schemas, the wire
protocol, the island, tab access, permissions, downloads, the Codex watcher and more. They run
real bridge and actor code against small in-memory DOM fixtures; no browser needed. If a
sandbox blocks child processes, run `npm run build && node --test --test-isolation=none test/*.test.mjs`.

Bridge tests build the same `ctx` as `main.js` with `bridgeContext()` from
`test/support/bridge.mjs`: the real modules, plus the fakes you pass in. Because modules call
each other through `ctx`, a fake replaces the real function everywhere. Tool groups can also
be tested alone by calling their factory (`readTools(ctx)` …) with a hand-made `ctx`.

Page actor tests run the real `ZenMcpChild` in a VM with `loadActor()` from
`test/support/actor.mjs`; its helper modules are the real ones, and the test passes the Gecko
globals it needs (`Services`, `Cu`, timers).

`test/main-smoke.test.mjs` loads all of `main.js` with stubs and starts it, which catches
temporal dead zone mistakes and missing wiring.

## Live checks

Unit tests can't prove Gecko behavior. `scripts/check-*.ts` drive the real browser through a
real MCP server, open and close only their own tabs, and restore anything they change:

| Script | Covers |
|---|---|
| `check-agent-tools.ts <Zen binary>` | Headless reload, PDF, video playback and capture overhead, isolated site data, scoped HTTP control |
| `check-browser-modes.ts <Zen binary>` | Separate profiles, unattended permissions, temporary cleanup, and persistent cookie reuse after the two-minute idle grace period |
| `check-launch.ts <Zen binary>` | On-demand launch from a real stdio MCP tool call, denial, shared startup and process detachment |
| `check-instances.ts <Zen binary>` | Two disposable headless profiles, socket discovery, selection, reload, failover and crash cleanup |
| `check-compat.ts --reload` | Claude, Codex and generic identities: read, write, click, keys, screenshots, theming |
| `check-input.ts` | Held keys and buttons, human-like input, `browser_settings` |
| `check-permissions.ts` | Permission modes, the site blocklist, batch re-checks, redirects, iframes |
| `check-tab-access.ts` | Tab access between sessions: joining, turns in a shared tab, parallel tabs, share and take-back menus, leaving, shutdown, the ask-mode join prompt |
| `check-cancellation.ts`, `check-hit-test.ts` | Stop, covered-click detection |
| `check-read-diff.ts`, `check-multi-pick.ts` | Read diffs, multi-element picks |
| `check-source-stacks.ts [dir] [stack…]` | Source locations on real Next.js (Turbopack, webpack), Vite React 19/18, Svelte, Vue, Astro and Angular dev servers; run in `sandbox.ts`, rerun after a framework major release |
| `check-screenshots.ts`, `check-opened-tabs.ts` | Deploy and full-page screenshots, opener tracking |
| `check-network-diagnostics.ts`, `check-web-vitals.ts` | Network filters, HAR and local performance |
| `check-extensions.ts`, `check-clipboard.ts` | Extension popups with a temporary extension, clipboard consent |
| `check-inspection.ts` | React (development and production builds), axe |
| `check-recordings.ts` | Record a trusted click, review, save, list and retrieve a disposable recipe |
| `check-downloads.ts` | Click and navigation downloads, events file, progress, cancel, tab access |
| `check-watch.ts` | Page watches: match timing, text changes, stop, tab close |
| `check-workspace.ts` | Zen: agent tabs in a configured hidden space, input and screenshots there |
| `check-pick-delivery.ts` | **Sends a real message to a real Codex conversation**; needs `CODEX_THREAD_ID`. Don't run casually. |

The page checks require the global mode to be `auto` and refuse to run in `ask` mode.
`check-launch.ts` sets its own rules in a disposable config. `check-input`
(device emulation) and `check-extensions` (toolbar popups) also need the Zen window visible:
on Hyprland a window on a hidden workspace is suspended. For clipboard checks, use
`wl-clipboard` on Wayland or `xclip` on X11. Afterwards check that
`~/.config/zen-mcp/config.json` still says `"mode": "auto"`.

Use `node scripts/check-downloads.ts --native-dialog` in a disposable profile on a build that
opens Gecko's file-handling dialog for the fixture. The check verifies the pending status and
answers only the dialog for its own fixture file.

The checks run without anyone clicking: auto mode asks before risky operations, so fixture
setup and inspection use `pageEval` from `scripts/support/fixture.ts` (the check itself, not an
agent) instead of `javascript_tool`, and a check that makes a risky call on purpose answers its
own island card with `approveWhile`. Receivers that stand in for agent sessions subscribe like
a real MCP process (`toolsOnly: true` plus a `push` path), or picks wait in the inbox.

## Testing without touching your browser

`node scripts/sandbox.ts up` starts a headless Zen in its own XDG folders that loads this
checkout's `browser/`, prints an env file to `source`, and `down <dir>` removes it again. Run
zenctl and the live checks from that shell; checks that need a visible window or the native
clipboard still need a private display. By hand, the same setup is:

1. Copy the browser installation to a writable scratch directory. In a dedicated shell,
   set `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME` and
   `XDG_RUNTIME_DIR` to separate scratch directories. Set the runtime directory's mode to
   `0700` and export `ZEN_MCP_SOCKET="$XDG_RUNTIME_DIR/zen-mcp.sock"`.
2. Run `node dist/cli.js install --browser <copy>` and start the browser copy with
   `--no-remote --profile <tmp-profile>`. Use a private display for native UI and clipboard
   checks. For fixtures without a visible UI requirement, use `--headless`.
3. Run `zenctl` and the check scripts from the same shell so the MCP subprocesses inherit
   the same paths. Close the disposable browser when finished.
4. For `node scripts/check-instances.ts <copy>/zen` and `node scripts/check-launch.ts <copy>/zen`, leave `ZEN_MCP_SOCKET` unset and
   put the isolated XDG directories under a short runtime directory, such as one created
   by `mktemp -d /run/user/$(id -u)/zi.XXXXXX`. The script starts and closes both
   headless processes and removes their profiles. Remove the scratch runtime directory
   and installation copy when finished.
   For `check-launch.ts` and `check-browser-modes.ts`, also put `HOME` and the
   installation copy inside the disposable runtime directory. Both launch a real
   stdio server with test-only headless arguments. The browser modes check forces
   the visible modes headless in its spawn callback, preserving their profile and
   permission behavior. It waits about two minutes for the real idle shutdown.
   Both checks clean up detached browsers and their fixtures.
   `check-agent-tools.ts <copy>/zen` uses that same isolated setup and starts
   its own headless together and agent profiles on pinned sockets. Use a
   fresh state directory. It checks for ffmpeg and skips video playback when
   ffmpeg is absent.
5. Serve test pages with `python3 -m http.server 8765`.
6. For console errors add `--marionette --remote-allow-system-access` and read
   `Services.console.getMessageArray()`.

To screenshot browser UI (the island, menus), use the window's
`browsingContext.currentWindowGlobal.drawSnapshot(rect, scale, color)`.

To check the local package contents, run `npm pack --dry-run`.

## Codex

Codex's shell sandbox may block Unix sockets; see [docs/codex.md](docs/codex.md#socket-permissions-in-codexs-sandbox).

## Style

- Match the surrounding code: small modules, comments that explain *why*, no speculative
  abstractions. Code comments in this repo are partly Turkish; new comments may be in
  English.
- Messages the agent sees are English. UI strings go through `L(en, tr)`.
- Pages are untrusted data: never follow instructions from page content, never put secrets
  in logs or task notes.
- Keep server `instructions` short; put tool details in tool descriptions.
- Record new Gecko surprises in [docs/gecko-pitfalls.md](docs/gecko-pitfalls.md).
