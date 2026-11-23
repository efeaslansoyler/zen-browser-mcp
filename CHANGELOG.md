# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0.0, a minor version may
change tool names, parameters or results.

## [Unreleased]

### Added

- **Take over** on the island's row: on an agent's tab, one click gives you the tab for a while and
  **Give back**, at the same place, returns it, with an optional note. Meanwhile agents can neither
  act nor look there; the running call is interrupted, watches pause, a video recording ends and
  nothing is logged. Calls wait up to 45 seconds, then return a `user_control` status. Afterwards an
  agent must read the page again before it acts.
- The island's row stays on an agent's tab while the agent thinks, until two minutes after its last
  call there, and shows that tab's agent first.

### Changed

- A request on the island (a permission, a question, a hand-over or a page dialog) opens for a few
  seconds while you look at its tab, then shrinks to one line that leaves the page free. Hover
  opens it again. A hand-over keeps Cancel and Done on the line. The asking agent is no longer
  repeated below its card; the mode and Stop are on the card. The recording review can be folded.
- `find` ranks an element that holds every word of the query above any that holds only some, and
  sees the whole text of a control whose name is a label or cut off.
- The server instructions, `hand_to_user` and the skill tell agents to number several elements
  with `highlight` before handing over; `hand_to_user` and the skill also say not to name the
  card's buttons, whose language agents don't know.
- `read_page`, `find` and click results name a form field without a name of its own after the
  label in its table row, marked `(from row)`, and an icon control or clickable after its own
  hidden text, marked `(hidden text)`.
- An installed agent skill is updated when an MCP client starts a newer server, like the bridge
  files. A copy you edited is left alone and `doctor` says so; a skill that isn't installed is never
  added.

### Fixed

- `read_page`, `find`, `get_page_text`, annotated screenshots and click results see inside web
  components (open and closed shadow roots), in the order in which the content shows; refs to what
  is inside work with every tool. Light content a component doesn't show stays out. `wait_for` and
  `watch` selectors match inside each shadow root. A submit button inside one is treated as a
  submit for permissions.
- `read_page` reads elements at any depth. It silently stopped after 30 levels, which left out most
  of a GitHub page. When you pass `depth` and it leaves something out, the result says so.
- `read_page` and `find` no longer leave out everything inside an element with `display: contents`,
  such as the whole article on MDN. Refs to such elements can be clicked and highlighted, and
  `wait_for` and `watch` selectors match them.
- Names and text in off-screen sections that the browser doesn't render yet (`content-visibility:
  auto`) are no longer empty in `read_page`, `find`, `get_page_text`, `wait_for` and `watch`.
- Text hidden by a closed `details` element or `content-visibility: hidden` is no longer read as
  shown.
- `read_page` says `(still loading)` instead of `(empty page)` or `(no visible elements)` for a page
  or iframe that is still loading and has shown nothing yet.
- `handle_dialog` answers in English; parts of its result were Turkish.
- `handle_dialog` returns once the dialog it answered is gone, so the next call isn't refused
  because of it, and fails if the dialog stays open.
- A new conversation title no longer cancels the session's running and queued calls or releases its
  holds, for Claude and for Codex conversations found through the Codex service.

## [0.3.0] - 2026-11-23

### Added

- `read_page`, `find` and annotated screenshots give refs to clickable elements without a control
  role, such as menu entries built from a `div`.
- Clicks report the element they hit, and say when it shows no sign of reacting to clicks.
- Screenshots have an ID. `computer`, `extensions`, `highlight`, `ask_user` and `hand_to_user`
  take it as `screenshot` to say which image a coordinate comes from.

### Changed

- **Breaking:** after two screenshots of a tab at different scales, a coordinate without
  `screenshot` is refused instead of being read with the latest scale. Pass the ID of the image
  the coordinate comes from.
- `find` also matches visible text anywhere on the page and returns the innermost element that
  holds all the words.

### Fixed

- Coordinates in a `browser_batch` refer to the screenshot from before the batch, as documented,
  and another session's screenshot in a shared tab no longer changes how yours are read.
- A ref from before a navigation or a bridge reload, or from another tab, is refused instead of
  resolving to another element. Refs look like `ref_12c`: a number for the document and letters
  for the element.
- `find`, `wait_for` text and select options match capital I: "WIFI" on a page now equals "wifi".

## [0.2.0] - 2026-11-21

### Added

- Install from npm: `npm install -g zen-browser-mcp`, then `zen-browser-mcp install`. MCP
  clients run the `zen-browser-mcp` command, and an update reloads the bridge in the running
  browser on the next client start. Releases after this one are published from GitHub
  Actions with provenance.

### Changed

- CLI, `doctor` and error messages name the `zen-browser-mcp` command instead of `npx` or
  `node dist/cli.js`. Source checkouts get the same command with `npm link`.
- `hooks install` and `codex-hooks install` refuse to run from the npx cache, whose files can
  disappear; they ask for a global install instead.
- The agent skill tells agents to read the page before retrying a call that timed out or was
  cut off by a bridge stop. Run `zen-browser-mcp skill install` to update an installed skill.
- The README and installation guide mark macOS as untested.

### Security

- Agents could open browser-internal pages such as `about:config` and run approved page
  JavaScript there with the browser's own privileges. These pages are now closed to agents in
  every mode, and page code refuses to run in them.
- Agents could open and read local files with `file:` URLs without a question in auto mode.
  This is now the operation `navigate.local_file`, which asks in both templates and is denied in
  the autonomous modes unless a custom rule allows it.
- Pick messages indent page HTML inside a fence the page can't close, and page-derived names
  stay on one line, so page content can't pass for the user's note.
- A custom deny for `tabs_close_mcp` is enforced.
- HAR export redacts values after percent-encoded sensitive path segments too.
- When the runtime folder is a shared temp directory, the bridge keeps its files in its private
  per-user folder, and the MCP server refuses browser and OpenCode sockets owned by another user.
  Codex and OpenCode receivers use private per-user folders there too, and the browser
  subscription refuses a socket owned by another user.
- In `browser_batch`, approving one step no longer covers later steps the user wasn't asked
  about, and an approved step is checked again if earlier steps changed which rule applies.
  A bare path that turns into a `file:` URL asks as `navigate.local_file`, and Enter after
  `form_input` is judged against the new focus.
- `computer` key sequences that press Enter or Space after another key (`Tab Return`) and
  `left_click_drag` on a submit button follow the `submit` rule.
- `form_input` refuses file inputs; uploads go through `file_upload`, which is denied in the
  autonomous modes unless a custom rule allows it.
- Copy and paste in an extension panel follow the `extensions.act` rule, and panel prompts
  name the extension, the target and the typed value. `browser_settings` prompts list every
  setting they apply, including user agent, pixel ratio and touch.
- The activity log no longer keeps what agents typed: `type` and `form_input` entries show
  `"…"` instead of the value.
- Network rules stop applying in a tab once its site is blocked.
- Recipe steps and the `recipes` CLI flatten page-derived text, so it can't add step lines or
  send terminal control sequences. Source-map paths and snippets in pick messages can't start
  their own line or close their fence.
- `install` and `uninstall` refuse an autoconfig name or a file path that leads outside the
  browser folder, including through a symlink, and use sudo only when every folder on the
  path belongs to root.

### Fixed

- `install` can write a loader into a root-owned browser folder on macOS too (untested).
- A browser that kept running old bridge files while another browser received an update is
  reloaded with the new files when an MCP client connects to it.

## [0.1.0] - 2026-11-20

The first release. Agents (Claude Code, Codex and other MCP clients) use your own Zen or
Firefox-based browser: your tabs and logins, real input, and an island that shows what they do.

### Added

- **Browser tools** for tabs, `navigate`, `computer`
  (mouse, keyboard, screenshots), `read_page`, `find`, `form_input`, `get_page_text`,
  `wait_for`, `javascript_tool`, console and network reads, `file_upload`, `handle_dialog`
  and `browser_batch`.
- **Real input** from the page's own process: trusted events and background tab input.
  Optional human-like
  pointer paths and typing, held keys and buttons, and hit testing that refuses clicks on
  covered or disabled targets.
- **Iframes**, cross-origin ones included, in reads, refs and input.
- **The island**: live status with a preview on hover, Stop/Resume
  (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Esc</kbd>), page dialogs, and `ask_user` questions
  with OK/Cancel or answer buttons, with or without a tab.
- **`highlight`**: frames with short labels around elements the agent points out to the user,
  several at once and across iframes, without waiting.
- **`hand_to_user`**: steps only the user should do (logging in, 2FA, captchas, payments) are
  handed over in the island and the agent continues when the user presses **Done**, so
  credentials never pass through the agent.
- **Several agents at once**: each MCP session (each Codex conversation) has its own tabs,
  and agents in different tabs work at the same time. Agents can share a tab (`request_tab`
  joins one, free in auto mode, asked in ask mode) and take turns in it call by call;
  `tab_work` notes tell the others what each is doing. `request_tab` also asks the user for one
  of their own tabs.
- **Element picks**: pick one or more elements on any page (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd>
  or the context menu; Shift- or Ctrl/Cmd-click adds elements, a hint bar lists the gestures),
  write a note for the whole pick and for each element, and send them to any connected session
  with selector, styles, a screenshot and the component chain.
- **Source locations in picks**: on local dev servers a pick names the file and line that
  rendered the element (React 19 and 18, Next.js app router with Turbopack or webpack, Svelte,
  Astro) or its component file (Vue, Angular), through the page's own source maps, plus the
  author CSS rules that style it.
- **Delivery to every client**: picks and recipes are pushed when the client has a way in
  (Claude Code channels, `codex queue`, `t3 thread send` in T3 Code, a plugin in OpenCode).
  Otherwise they wait and arrive once, with the session's next tool result or, with
  `hooks install`, the user's next message (Claude Code, Codex, Antigravity CLI, OpenCode).
  The target list says which applies to each session; what can't be delivered goes to the
  clipboard.
- **Show me once**: the user shows a task once (`show_me`, or right-click → "Record steps for
  an agent…") and it becomes a recipe: semantic steps with a screenshot each, reviewed on the
  island (rename, delete steps, mark values that change, play back), saved locally and offered
  to agents on the same site (`tabs_context_mcp`, `recipes`). Secret fields are never recorded.
- **Permissions**: permission templates for every tool and action: **ask** (every action),
  **auto** (only risky ones: submitting forms, secret fields, JavaScript, uploads, dialogs,
  extension panels, the user's clipboard, tabs and browser settings) and **custom** (the
  user's own allow/ask/deny rules in a commented `permissions.jsonc`, `config permissions
  init`). Sites are a blocklist or an allowlist. Approvals are scoped to the document,
  origin, settings and tab access.
- **Tab context menu**: give or share a tab with a session, take it back, agent settings and
  the agent history of the tab.
- **Inspection**: React component trees and `axe-core` accessibility audits, run locally.
- **Per-tab emulation**: viewport, device presets, DPR, touch and color scheme.
- **Extensions**: agents can open and use real extension toolbar panels.
- **More page tools**: `navigate` reloads (optionally bypassing the cache), `save_pdf` prints an
  agent tab to a local PDF, `record` saves a short WebM of a tab, `cookies` and `storage` read
  and write site data in agent browser modes, and `network_control` blocks, mocks or takes
  offline the requests of an agent-opened tab.
- **Open and read in one call**: `tabs_create_mcp` with a `url` and `read` returns the loaded
  page's refs, so a new page costs one tool call.
- **Downloads and page watches** that report to events files, so agents can keep working
  instead of blocking.
- **Zen workspaces**: agent tabs can open in a chosen workspace.
- **Several browsers**: every running browser has its own private socket; the server picks one
  by client flag (`--browser`, `--profile`), environment, `config browser` or the most recently
  focused, and `browser.launch` starts the chosen browser on demand (asked in the ask template).
- **Browser modes**: `together` (the user's profile), `agent` (a persistent profile only agents
  use), `scratch` (a temporary profile), and headless `autonomous` and `autonomous-agent` for
  unattended work, where ask rules become allow, the system clipboard is denied and custom
  denials and site rules still apply.
- **Clean tabs**: `tabs_create_mcp` with `clean: true` (or `config container`) opens agent tabs in
  a separate container without the user's cookies and logins.
- **Compact reads**: `read_page` and `get_page_text` can return diffs against an earlier
  snapshot, and unchanged screenshots can skip the image.
- **Browser diagnostics**: screenshot baselines across deploys, full-page capture, HTTP
  request filters, verified opener notices, redacted cross-host HAR export, and local Web Vitals.
- **Browser compatibility**: Gecko ESR SessionStore fallback, pending native download status
  and clearer errors when browser dialogs block emulation or extension actions.
- **CLI**: `install`, `uninstall`, `doctor`, `config` (mode, permissions, sites, browser, browser
  mode, launch), `reset-agent-profile`, `skill`, `hooks`, `codex-hooks` and `recipes`; the
  browser side updates itself when the package version changes.
- **Agent skill** (`skills/zen-browser`) for Claude Code and Codex: which tool to use when, from
  choosing the user's open tab to handing over logins. Short server instructions point the same
  way for every client.
- English and Turkish UI, following the browser language.

## Development history (before 0.1.0)

These stages were never published; they are listed so the history is readable. Details are in
the commit log.

### 2026-11-20

- A Codex behavior and token eval on an isolated Zen; shorter tool descriptions and server
  instructions, trimmed tab results and the one-call open-and-read path came out of it.
- Several browser instances with their own sockets, on-demand launch and the browser modes.
- Reload, PDF, tab recording, site data and network control tools.
- Source locations and CSS rules in picks, per-element notes and Ctrl/Cmd-click picking.
- An isolated sandbox browser for live checks, and fixes from an architecture and test review:
  custom rules for every listed operation, queued calls refused when the bridge stops, and agent
  tabs that wait for a starting window.

### 2026-11-19

- Each tool call carries its own session and agent instead of a global "active" one, and calls
  on different tabs run in parallel (per-tab locks; one lock for the clipboard, browser
  settings and extension panels; one island question at a time).
- The island shows several agents on one line (◀ their icons ▶) and their questions as cards
  that don't replace the one you're reading; a finished agent's line goes on its own, so no
  stale status stays behind.
- Tabs are shared instead of owned: several sessions can be members of a tab (join with
  `request_tab`), and `tab_work` keeps only task notes; the request queue and handoffs are gone.
- In a shared tab, a call's result says what the other members did since the caller's last
  call (`meanwhile`, no values) and asks it to read the page again when another member may
  have changed it (`pageChanged`).
- `tab_work hold` keeps a tab to one agent for a few steps (with a reason, up to 10 minutes,
  renewable; `noWorkaround` also keeps the others off that site). The tab menu's **Remove
  hold** ends it. A refused agent waits with `watch` and `hold: true`, which answers at once
  and reports when the hold ends.
- Agent tabs run at foreground speed during page tool calls and for five seconds after.
  `watch` can opt in with `live: true` to keep the tab active for the whole watch.

### 2026-11-18

- Delivery layer: an inbox in the bridge, push paths for T3 Code and OpenCode, prompt hooks
  for Claude Code, Codex and Antigravity CLI (`hooks install`), and one target list for picks
  and recipes that says how each session receives.
- Own icons for Antigravity and OpenCode, the Claude logo, and a combined icon on menus when
  sessions of several agents are connected.
- Permission templates (ask, auto, custom) instead of two modes and per-site ask rules: auto
  asks only risky operations, custom follows `permissions.jsonc`. Sites became a blocklist or
  an allowlist that only decides access.

### 2026-11-17

- `ask_user` answer buttons and questions without a tab.
- Refactor for open source: the browser bridge, the page actor and the MCP server split into
  focused modules; tests run the real modules instead of slicing source files; English
  comments throughout; CI on Node 22 and 24.

### 2026-10-26 – 2026-10-27

- User tabs can be discovered and requested, with optional notes on approvals and denials.
- Downloads tool with events files, page watches, Zen workspaces, agent history in the tab menu.
- Codex conversations tracked through the Codex service instead of hooks; Claude sessions
  named by their conversation title.
- First modularization of the bridge (network log, tab menu, channels, picks, tool groups).

### 2026-10-20

- Multi-agent identity (Claude, Codex, other clients) and per-session tab ownership.
- Real Stop that cancels running and queued work; coordinated tab handoffs (`tab_work`).
- Incremental reads, multi-element picks, per-site rules, extension panels, the system
  clipboard, held input and tab emulation, React and accessibility inspection.

### 2026-10-19

- First prototype: the autoconfig bridge and MCP server, page reading, refs, forms, real input
  from the page process in the user's own window.
- Dialogs, `ask_user`, `file_upload`, the island with Stop/Resume, the tab context menu,
  virtual cursor and live preview.
- Element picks to Claude Code through channels, `request_tab`, iframes and `wait_for`.
- Auto/ask modes, sensitive sites, the activity log, the CLI and package layout, README and
  MIT license.

[Unreleased]: https://github.com/efeaslansoyler/zen-browser-mcp/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/efeaslansoyler/zen-browser-mcp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/efeaslansoyler/zen-browser-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/efeaslansoyler/zen-browser-mcp/releases/tag/v0.1.0
