# Architecture

zen-browser-mcp lets AI agents (Claude Code, Codex, any MCP client) use the browser you already have
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
| `cli.ts` | `npx zen-browser-mcp`: no arguments runs the MCP server; `install`, `uninstall`, `doctor`, `config`, `hooks`, `codex-hooks`; `hook <client>` is the prompt hook command |
| `server.ts` | The MCP server: registers the tools, agent identity and per-call session, channel and lifecycle subscriptions |
| `tools.ts`, `instructions.ts` | Tool schemas, descriptions and answer timeouts; server instructions |
| `claude.ts` | Channel detection and the Claude conversation title |
| `skill.ts` | `skill install`: copies `skills/zen-browser` into Claude Code's and Codex's skill folders |
| `zen.ts` | Socket client: one request per connection (`call`) and long-lived subscriptions (`subscribe`) |
| `paths.ts` | Package name and every user-visible path in one place |
| `install.ts`, `doctor.ts`, `config.ts` | Loader installation, health checks, `~/.config/zen-mcp/config.json` |
| `codex-watch.ts` | Watches the Codex service and connects open Codex conversations (see [codex.md](codex.md)) |
| `codex-hooks.ts`, `codex-relay.ts`, `delivery.ts` | Codex lifecycle hooks (fallback), per-thread receiver, `codex queue` and `t3 thread send` delivery |
| `hooks.ts` | `hooks install`: prompt hooks for Claude Code and Antigravity CLI, plus the Codex hooks and the OpenCode plugin |
| `opencode.ts` | The OpenCode plugin (push socket and `chat.message`) and the MCP process's push to it |

### Browser side (`browser/`)

The loader is a few lines of [autoconfig](https://support.mozilla.org/kb/customizing-firefox-using-autoconfig):
`npx zen-browser-mcp install` adds a marked block to the browser's `.cfg` that maps
`resource://zenmcp/` to `~/.local/share/zen-mcp` and loads `main.js` with `loadSubScript`. A
development install makes that folder a symlink to the repo's `browser/`.

Modules share state and helpers through one `ctx` object: each factory (`tabs(ctx)`,
`pageQueries(ctx)`, …) returns functions that `main.js` adds to `ctx`, and modules call each
other through `ctx` at call time. That makes load order irrelevant and lets tests replace any
function with a fake (see `test/support/bridge.mjs`).

| File | Role |
|---|---|
| `main.js` | Wiring: loads the modules into one shared `ctx`, builds the browser components, socket server, start/stop/reload, dev commands |
| `ToolRunner.sys.mjs` | Request handling: the tool queue, the call scope (session, agent, tabs, cancellation; tools get it as their second argument, helpers find it with `ctx.callOf(browser)`), per-call ownership/site/permission checks, island status, activity log entry; `browser_batch` |
| `Sessions.sys.mjs`, `TabWork.sys.mjs` | Session lifecycle (connect, grace period, sweep); `tab_work` status, queue and handoff |
| `Tabs.sys.mjs` | Finding tabs across windows and Zen workspaces, creating agent tabs, the tab mark and its restore |
| `PageQuery.sys.mjs` | `query` to a frame's actor, refs across frames, coordinate translation, load waits, page dialogs |
| `PageInput.sys.mjs` | Mouse, keys, held input and screenshots |
| `Control.sys.mjs` | Stop/Resume and island questions (`askIsland`, tab-less `ask_user`, notifications) |
| `Config.sys.mjs`, `Activity.sys.mjs` | `config.json` and site access checks; island action text and the activity log |
| `TabTools`, `ReadTools`, `InputTools`, `BrowserTools.sys.mjs` | Tool groups |
| `Island.sys.mjs` | The island: live status, Stop/Resume, `ask_user` and `hand_to_user`, approvals, dialogs, pick note box |
| `Agent.sys.mjs` | Agent identity, theme and icon (`assets/`: Claude, Codex, Antigravity, OpenCode, several agents; others a drawn `>_`); shared by Node and Gecko |
| `Ownership.sys.mjs` | Per-session tab ownership, `tab_work` tasks and the handoff queue |
| `Channels.sys.mjs` | Long-lived subscriptions: pushes picks to sessions, waits for delivery receipts |
| `Picks.sys.mjs`, `TabMenu.sys.mjs` | Element picker and page menu; tab context menu (give / take back / transfer) |
| `Recordings.sys.mjs` | "Show me once": publishes the recorded tabs to content processes, cleans and collects their steps, screenshots each step |
| `Demonstrations.sys.mjs` | "Show me once" end to end: record, review, save; `show_me`, and "Record steps for an agent…" in the page menu with sending to a session |
| `RecordingReview.sys.mjs` | The island's review after a recording: name, delete steps, values that change every time, Play |
| `Recipes.sys.mjs` | Saved recordings (`~/.local/state/zen-mcp/recipes/<id>/`), their text for agents, the `recipes` tool; the CLI uses it too |
| `SiteRules.sys.mjs` | Global mode and per-site `ask`/`block` rules |
| `Cancellation.sys.mjs` | Real Stop: cancels waits, typing, drags and navigation in flight |
| `NetworkLog.sys.mjs`, `DownloadLog.sys.mjs` | Network requests and downloads of agent tabs |
| `ReadSnapshots`, `ScreenshotCache`, `InputMotion`, `BrowserSettings`, `ExtensionPanels`, `Clipboard`, `ReactInspect` | Read diffs, `if_changed` screenshots, human-like input, per-tab emulation, extension popups, clipboard consent, React tree |
| `actors/ZenMcpChild.sys.mjs` | Runs in every frame: answers the parent's queries and owns per-page state (refs, held input, cursor, pending questions); `form_input`, `file_upload`, console, clipboard targets, axe. Its one message to the parent is a recorded step |
| `actors/ZenMcpParent.sys.mjs` | Passes recorded steps to `Recordings` (observer topic), adding the tab and page URL itself |
| `actors/PageReader`, `ElementInfo` | Roles, names and the `read_page`/`find` tree; selectors, styles and component chains for picks |
| `actors/InputDriver`, `Overlays`, `Picker` | Input through the browser's own `EventUtils` with hit testing; virtual cursor, ripple, `ask_user` outline and `highlight` frames; the element picker |
| `actors/Recorder` | Turns the user's input in a recorded tab into steps (click, type, select, check, upload, key); secret fields never carry values |

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
- Claude conversation titles come from Claude Code's session files
  (`~/.claude/sessions/<pid>.json` and the transcript's latest `/rename` or generated title).
  The format is undocumented; if it changes, menus fall back to short ids.
- `tab_work` lets agents publish task notes and queue for another session's tab; the owner
  hands over with `finish`.

## Permissions

`~/.config/zen-mcp/config.json`: `{"mode": "ask" | "auto" | "custom", "sites": {"mode": "blocklist" | "allowlist", "blocklist": [], "allowlist": []}, "workspace": "Agents", "container": "Agent"}`
(`workspace` is optional: the Zen space new agent tabs open in).

- **Operations and templates** (`Policy.sys.mjs`, shared with the CLI): every tool call is an
  operation (`operationOf`: a tool, or `tool.action` for `computer`, `clipboard`,
  `extensions`, `browser_settings`, `handle_dialog`, `recipes`), plus `submit`,
  `secret_field` and `tab_work.handoff`. A mode gives each one a rule: `allow`, `ask` or
  `deny`. The `ask` and `auto` columns of `SECTIONS` are the built-in templates; `custom`
  reads `permissions.jsonc` (a base template plus the user's rules, parsed by
  `parsePermissions`; errors fail closed). A test checks that every MCP tool and action has an
  operation.
- **One decision** (`Permissions.sys.mjs`): `requirePermission` checks a page call (every
  step of a batch, against the current document, origin and settings; a redirect or new
  document invalidates earlier approvals), `requireToolPermission` a call without a page, and
  `gate(key)` the operations that keep their own prompt (clipboard, `request_tab`,
  `browser_settings` changes, extension tab switches, recipe deletes, tab handoffs).
  A click, Enter or Space is also checked against `submit`, and typing against `secret_field`,
  when that could make the rule stricter: the page answers a `risk` query (`PageReader.risk`:
  a submit button of a form, Enter in a form's text field, a password, card or one-time-code
  field).
- **Sites** (`SiteRules.sys.mjs`) only decide access: `siteAllowed(host, sites)` with the
  active list; a domain covers its subdomains, and hostless pages aren't sites. During an
  agent call `NetworkLog` cancels requests to a host agents may not use; with an allowlist only
  document loads (allowed sites use CDNs).

## Sending to a session (browser → agent)

Element picks (Ctrl+Shift+F or the page menu; Shift+click selects up to 8 elements; the island
asks for a note and a target session) and recipes the user recorded go through
`Inbox.sys.mjs`:

1. **Push now** when the session's MCP process can. Every MCP process keeps one `subscribe`
   connection (it also owns the session's tabs) and acknowledges each event; it tells the
   bridge its push path when it connects:
   - **Claude Code** through [channels](https://code.claude.com/docs/en/channels): when Claude
     runs with `--dangerously-load-development-channels server:zen`, `claude.ts` detects the
     flag from `/proc`, declares `claude/channel` and forwards events as
     `notifications/claude/channel`. Claude Code ignores the flag in `-p` mode and under the
     Agent SDK (stream-json input, e.g. T3 Code), so those sessions have no push path.
   - **Codex** through `codex queue` (see [codex.md](codex.md)).
   - **T3 Code** threads (`T3CODE_THREAD_ID` and `T3CODE_CLI_PATH` in the environment) through
     `t3 thread send <thread> -`: the message arrives as the thread's next turn, marked as
     coming from zen.
   - **OpenCode** through the plugin `hooks install` writes to
     `~/.config/opencode/plugins/zen-browser.js` (`opencode.ts`). OpenCode gives its MCP
     servers only `OPENCODE_PID`, but a plugin runs inside OpenCode with its API client: it
     listens on `$XDG_RUNTIME_DIR/zen-mcp-opencode/<OpenCode PID>.sock`, the MCP process (its
     child) pushes there, and the plugin sends the text as a new prompt to the session the user
     last wrote to (`session.promptAsync`, with that session's agent and model). Before the
     user's first message there is no session to send to, so the push is refused and the
     plugin's `chat.message` hook adds what waits to that first message (asking by PID, as
     Antigravity's hook does).
2. **Otherwise it waits** in the bridge and goes, once, with whichever comes first: the
   session's next tool result, or the user's next message in that conversation when the prompt
   hooks are installed (`hooks install`: Claude Code's `UserPromptSubmit`, the Codex lifecycle
   hook, and Antigravity CLI's `PreInvocation` in `~/.gemini/config/hooks.json`). The hook
   (`cli.js hook claude|antigravity`) asks the bridge (`inbox_take`) with the client's own
   conversation ID, which the MCP process reported when it connected (Claude Code's
   `CLAUDE_CODE_SESSION_ID`). Antigravity gives its MCP servers no conversation ID, so the hook
   also sends its ancestor PIDs and the bridge matches the MCP process's parent (the `agy`
   process) among them.
3. If the session ends first, or there is no target, the text is copied to the clipboard.

The target list in the island (picks, recipe review) has every connected session, the same as
"Give to session", each labelled with how it receives: now, when you write (prompt hook) or on
its next action. After sending, the island says which of these happened.

## Downloads

`DownloadLog` adds a view to Gecko's download list and keeps downloads whose source browsing
context belongs to an agent tab (or a popup it opened). Each one appends JSON lines to
`$XDG_RUNTIME_DIR/zen-mcp-downloads/<id>-<time>.jsonl` on start, every 10 % and at the end, with the
sha256 when done (hashed in 4 MB chunks so the UI never blocks). Agents with a background
monitor watch that file; others call `downloads wait`. The bridge deletes the file five
minutes after the download ends. If the browser is set to always ask where to save, a
download only appears once the save dialog is answered.

## Page watches

`wait_for` blocks the agent for at most 60 s. For longer waits and for following changes,
`watch` starts a background check on an agent tab (`Watches.sys.mjs`): text or a selector
appearing or disappearing, or every change of a selector's text. Results go to
`$XDG_RUNTIME_DIR/zen-mcp-watch/<id>-<time>.jsonl` (`started`, `matched`/`changed`, and a final
line), written by the same `EventFiles` helper as downloads. Checks use a light query path
that doesn't belong to a tool call, so a call ending or being cancelled doesn't cancel them;
the watch re-checks ownership and site rules itself on every tick. A watch ends at its first
match (unless `repeat`), on timeout, when the tab is closed or changes owner, when its session
ends, and on Stop in the island.

## Other files at runtime

- `$XDG_RUNTIME_DIR/zen-mcp.log`: bridge errors (the browser's stderr goes nowhere).
- `~/.local/state/zen-mcp/activity.jsonl`: one line per tool call (time, tool, tab, site, session name, island label, action description, destination, error); rotated at 5 MB. The tab menu's **Agent history** reads its tail (`ActivityView.sys.mjs`); **Full history…** renders it to `$XDG_RUNTIME_DIR/zen-mcp-history.html` (0600) with every field HTML-escaped and opens it in a new user tab.
- `$XDG_RUNTIME_DIR/zen-mcp-picks/`: pick screenshots (last 20).

## Frames

The actor runs in every frame (`allFrames: true`). Refs inside a subframe carry its browsing
context id (`ref_3_f150323855361`); the bridge shows agents a short form (`ref_3_f2`) and maps
it back. `read_page` splices each iframe's tree under `[iframe url]`, `find` searches all
frames, and mouse events are sent from the actor of the innermost frame under the point,
because events dispatched from the top page don't reach out-of-process iframes.
