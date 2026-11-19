# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0.0, a minor version may
change tool names, parameters or results.

## [0.1.0] - Unreleased

The first public release. Agents (Claude Code, Codex and other MCP clients) use your own Zen or
Firefox-based browser: your tabs and logins, real input, and an island that shows what they do.

### Added

- **Browser tools** with Claude in Chrome's names and parameters: tabs, `navigate`, `computer`
  (mouse, keyboard, screenshots), `read_page`, `find`, `form_input`, `get_page_text`,
  `wait_for`, `javascript_tool`, console and network reads, `file_upload`, `handle_dialog`
  and `browser_batch`.
- **Real input** from the page's own process: trusted events, `navigator.webdriver` stays
  false, and agent tabs work in the background without taking focus. Optional human-like
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
  or the context menu), write a note and send them to any connected session, with selector,
  styles, a screenshot and the React/Vue component chain.
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
- **Downloads and page watches** that report to events files, so agents can keep working
  instead of blocking.
- **Zen workspaces**: agent tabs can open in a chosen workspace.
- **Clean tabs**: `tabs_create_mcp` with `clean: true` (or `config container`) opens agent tabs in
  a separate container without the user's cookies and logins.
- **Compact reads**: `read_page` and `get_page_text` can return diffs against an earlier
  snapshot, and unchanged screenshots can skip the image.
- **CLI**: `install`, `uninstall`, `doctor`, `config` (mode, permissions, sites), `skill`, `hooks`, `codex-hooks` and `recipes`; the browser
  side updates itself when the package version changes.
- **Agent skill** (`skills/zen-browser`) for Claude Code and Codex: which tool to use when, from
  choosing the user's open tab to handing over logins. Short server instructions point the same
  way for every client.
- English and Turkish UI, following the browser language.

## Development history (before 0.1.0)

These stages were never published; they are listed so the history is readable. Details are in
the commit log.

### 2026-11-19

- Each tool call carries its own session and agent instead of a global "active" one, and calls
  on different tabs run in parallel (per-tab locks; one lock for the clipboard, browser
  settings and extension panels; one island question at a time).
- Tabs are shared instead of owned: several sessions can be members of a tab (join with
  `request_tab`), and `tab_work` keeps only task notes; the request queue and handoffs are gone.
- In a shared tab, a call's result says what the other members did since the caller's last
  call (`meanwhile`, no values) and asks it to read the page again when another member may
  have changed it (`pageChanged`).
- `tab_work hold` keeps a tab to one agent for a few steps (with a reason, up to 10 minutes,
  renewable; `noWorkaround` also keeps the others off that site). The tab menu's **Remove
  hold** ends it.

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

[0.1.0]: https://github.com/efeaslansoyler/zen-browser-mcp/releases/tag/v0.1.0
