# Architecture

zen-mcp lets AI agents (Claude Code, Codex, any MCP client) use the browser you already have
open: Zen or another Firefox-based browser, your window, your logins. Input reaches pages as
real, trusted events without starting the remote agent or WebDriver, so `navigator.webdriver`
stays `false`.

```
MCP client ──stdio──▶ src/server.ts ──Unix socket──▶ browser/main.js (browser parent process)
(Claude, Codex…)      tool schemas,     $XDG_RUNTIME_DIR/   ├─ Island.sys.mjs   status island, prompts
                      agent identity    zen-mcp.sock 0600   ├─ TabMenu, Picks   tab menu, element picker
                                                            ├─ *Tools.sys.mjs   tool implementations
                                                            └─ JSWindowActor ──▶ actors/ZenMcpChild.sys.mjs
                                                                                 (every frame, page process)
```

## Pieces

### Node side (`src/`)

| File | Role |
|---|---|
| `cli.ts` | `npx zen-mcp`: no arguments runs the MCP server; `install`, `uninstall`, `doctor`, `config`, `codex-hooks` |
| `server.ts` | Tool schemas and descriptions, server instructions, agent identity, per-call session, Claude conversation title |
| `zen.ts` | Socket client: one request per connection (`call`) and long-lived subscriptions (`subscribe`) |
| `paths.ts` | Package name and every user-visible path in one place |
| `install.ts`, `doctor.ts`, `config.ts` | Loader installation, health checks, `~/.config/zen-mcp/config.json` |
| `codex-watch.ts` | Watches the Codex service and connects open Codex conversations (see [codex.md](codex.md)) |
| `codex-hooks.ts`, `codex-relay.ts`, `delivery.ts` | Codex lifecycle hooks (fallback), per-thread receiver, `codex queue` delivery |

### Browser side (`browser/`)

The loader is a few lines of [autoconfig](https://support.mozilla.org/kb/customizing-firefox-using-autoconfig):
`npx zen-mcp install` adds a marked block to the browser's `.cfg` that maps
`resource://zenmcp/` to `~/.local/share/zen-mcp` and loads `main.js` with `loadSubScript`. A
development install makes that folder a symlink to the repo's `browser/`.

| File | Role |
|---|---|
| `main.js` | Bridge core: socket server, tab tracking and marks, sessions and ownership, permissions, `query`/frame/input helpers, tab tools |
| `ReadTools`, `InputTools`, `BrowserTools.sys.mjs` | Tool groups; `main.js` passes shared helpers through a `ctx` object |
| `Island.sys.mjs` | The island: live status, Stop/Resume, `ask_user`, approvals, dialogs, pick note box |
| `Agent.sys.mjs` | Agent identity and theme (Claude orange, Codex mint, others blue); shared by Node and Gecko |
| `Ownership.sys.mjs` | Per-session tab ownership, `tab_work` tasks and the handoff queue |
| `Channels.sys.mjs` | Long-lived subscriptions: pushes picks to sessions, waits for delivery receipts |
| `Picks.sys.mjs`, `TabMenu.sys.mjs` | Element picker and page menu; tab context menu (give / take back / transfer) |
| `SiteRules.sys.mjs` | Global mode and per-site `ask`/`block` rules |
| `Cancellation.sys.mjs` | Real Stop: cancels waits, typing, drags and navigation in flight |
| `NetworkLog.sys.mjs`, `DownloadLog.sys.mjs` | Network requests and downloads of agent tabs |
| `ReadSnapshots`, `ScreenshotCache`, `InputMotion`, `BrowserSettings`, `ExtensionPanels`, `Clipboard`, `ReactInspect` | Read diffs, `if_changed` screenshots, human-like input, per-tab emulation, extension popups, clipboard consent, React tree |
| `actors/ZenMcpChild.sys.mjs` | Runs in every frame: virtual cursor and input (the browser's own `EventUtils` with the page's `windowUtils`), page tree and refs, `form_input`, console, picker overlay, `file_upload`, axe |

## Wire protocol

One JSON line per connection: request `{tool, args, session, agent}`, reply `{ok, content}` or
`{ok: false, error}`. JSON is converted to pure ASCII on both ends so encodings never matter.
`subscribe` is the exception: the connection stays open, the bridge writes events line by
line and, for acknowledged subscriptions, the client answers `{event: "delivery", id, ok}`.

## Sessions and ownership

- Every request carries a `session`. For Claude and generic clients it is the MCP process
  UUID. Codex sends the conversation id in each tool call's `_meta.threadId`, so Codex calls
  use `codex:<thread>`: one Codex service process can serve many conversations.
- A session sees and touches only its own tabs: the ones it opened and the ones the user
  handed to it from the tab menu (`givenByUser`). `tabs_context_mcp` also lists the user's
  other tabs (`userTabs`, metadata only); `request_tab` asks for one in the island.
- A session is *live* while it holds a lifecycle subscription: Claude's MCP process opens one
  at initialize, Codex conversations through `codex-watch`. Menus ("Give to session",
  pick targets) list live sessions only, named by conversation title. When the last
  connection closes, ownership survives a 5 s grace period, then tabs return to the user
  (they stay open). Connectionless sessions (one-off calls such as `zenctl`) are never listed
  and are swept after ten idle minutes.
- `tab_work` lets agents publish task notes and queue for another session's tab; the owner
  hands over with `finish`.

## Permissions

`~/.config/zen-mcp/config.json`: `{"mode": "auto" | "ask", "sites": {"example.com": "ask" | "block"}}`.
Site rules cover subdomains, `block` wins, and a subdomain can't loosen its parent. Every
`browser_batch` step is re-checked against the current document, origin and rules; a redirect
or new document invalidates earlier approvals. Clipboard access, tab switches for extension
popups and `browser_settings` changes always ask, even in auto mode.

## Element picks (browser → agent)

Ctrl+Shift+F or the page menu starts the picker; Shift+click selects several elements (up to
8). The island asks for a note and a target session. The pick (note, URL, selector, role,
component chain, styles, text, trimmed HTML, PNG per element) goes to the target:

- **Claude Code** through [channels](https://code.claude.com/docs/en/channels): when Claude
  runs with `--dangerously-load-development-channels server:zen`, `server.ts` detects the flag
  from `/proc`, declares `claude/channel` and forwards events as `notifications/claude/channel`.
- **Codex** through `codex queue` (see [codex.md](codex.md)).
- Without a target the text is copied to the clipboard.

## Downloads

`DownloadLog` adds a view to Gecko's download list and keeps downloads whose source browsing
context belongs to an agent tab (or a popup it opened). Each one appends JSON lines to
`$XDG_RUNTIME_DIR/zen-mcp-downloads/<id>.jsonl` on start, every 10 % and at the end, with the
sha256 when done (hashed in 4 MB chunks so the UI never blocks). Agents with a background
monitor watch that file; others call `downloads wait`. The bridge deletes the file five
minutes after the download ends.

## Other files at runtime

- `$XDG_RUNTIME_DIR/zen-mcp.log`: bridge errors (the browser's stderr goes nowhere).
- `~/.local/state/zen-mcp/activity.jsonl`: one line per tool call (time, tool, tab, site, action, error); rotated at 5 MB.
- `$XDG_RUNTIME_DIR/zen-mcp-picks/`: pick screenshots (last 20).

## Frames

The actor runs in every frame (`allFrames: true`). Refs inside a subframe carry its browsing
context id (`ref_3_f150323855361`); the bridge shows agents a short form (`ref_3_f2`) and maps
it back. `read_page` splices each iframe's tree under `[iframe url]`, `find` searches all
frames, and mouse events are sent from the actor of the innermost frame under the point,
because events dispatched from the top page don't reach out-of-process iframes.
