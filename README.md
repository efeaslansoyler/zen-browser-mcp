# zen-mcp

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![Türkçe](https://img.shields.io/badge/dil-Türkçe-red)](README.tr.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Let AI agents use **your own Zen browser**: your tabs, your logins, real mouse and keyboard
input, and a small island at the top of the window that shows what the agent is doing. Works with
Claude Code, Codex, and other MCP clients. Firefox and other Firefox-based browsers work too.

[![zen-mcp demo: Claude shops in a background tab, asks before acting, hands the payment to you, and receives an element you point at](docs/demo.gif)](docs/demo.mp4)

## Why

- **Real input.** Clicks, typing and scrolling reach the page as genuine (`isTrusted`) events,
  sent from inside the browser. No WebDriver, no remote debugging port, and
  `navigator.webdriver` stays `false`, so sites don't see a bot.
- **Your browser, your window.** Claude opens its tabs in the background of the window you're
  already using, with your sessions. It never steals focus, and it only touches its own tabs
  plus the ones you hand over.
- **You can see and stop it.** A Dynamic-Island-style pill shows what Claude is doing, with a
  live preview on hover. Stop it with one click or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Esc</kbd>.
- **Point at things instead of describing them.** Pick an element on any page, type what you
  want, and it lands in your Claude Code session with the selector, styles, a screenshot and
  the React/Vue component chain.
- **Cheap on tokens.** Short, single-line results and a batch tool. In a side-by-side run of
  the same form task, it used about 25% fewer tokens than Claude in Chrome.

## Requirements

- Linux or macOS (Windows isn't supported yet)
- Node.js 22 or newer
- Zen, Firefox, LibreWolf, Floorp or Waterfox, installed normally. **Flatpak and Snap builds
  can't be supported**: their installation folder is read-only.
- Claude Code, or another MCP client

## Install

```sh
npx zen-mcp install
```

This finds your browser, adds a small loader to its installation folder (it asks for `sudo`
if the folder belongs to root) and copies the browser-side files to `~/.local/share/zen-mcp`.
If the browser already has an autoconfig file (for example from Sine or fx-autoconfig), the
loader is appended to it as a marked block; nothing else is changed.

Then restart the browser and add the server to Claude Code:

```sh
claude mcp add --scope user zen -- npx -y zen-mcp
```

Check everything with `npx zen-mcp doctor`. New versions update the browser side by
themselves when Claude Code starts the server, without sudo or a browser restart.

> Some browser updates replace the installation folder (macOS app updates, tarball installs).
> If `doctor` says the loader is gone, run `npx zen-mcp install` again.

## Codex and other MCP clients

The standard browser tools use stdio MCP. For a local development checkout:

```sh
codex mcp add zen -- node /absolute/path/to/zen-mcp/src/server.ts
```

Other MCP clients can launch the same command, or the built package's `dist/cli.js`.
Mouse coordinates use standard fixed-length arrays (`[x, y]`) for client compatibility.

The MCP initialization client name selects presentation automatically: **Claude** uses
orange, **Codex** mint, and other agents blue with their client name. The island, tab
stripe, cursor, click ring, and handoff outline follow the agent performing the action.
Tab colors follow the owning session. After a browser restart, restored tabs require a new
explicit handoff; saved colors do not restore access rights.
For clients that hide their identity behind a proxy, set `ZEN_MCP_AGENT=codex` or
`ZEN_MCP_AGENT=claude` in the MCP server environment.

Agent identity is a visual label. Tab access belongs to a particular MCP server session:
two Codex clients have separate tab lists and cannot read, modify or close each other's tabs.
Tool calls share a queue and the global Stop/Resume and auto/ask controls.
Element-to-chat delivery uses Claude channels or Codex queue as described below; other
clients can use the clipboard fallback.

Ownership uses the MCP server's session ID, distinct from a Codex conversation UUID.
We do not infer a relationship from agent names or project folders. Multiple conversations
sharing one MCP server process remain one ownership session.

Agents coordinate with `tab_work`: `list`/`status` show agent-owned tabs, published task
summaries, execution state and a FIFO request queue; page contents and chat histories stay
private. The owner calls `start`, `update`, then `finish` with a handoff summary. Individual
tool calls ending never count as the task finishing. Ordinary tool replies remind owners
when another session is waiting.

A second session calls `request` to queue without interrupting the owner. In **auto** mode,
explicit task completion transfers the tab to the first connected waiter with the handoff
note. In **ask** mode, the first waiter calls `request_tab` once the task is ready; the island
requires Allow/Deny. Waiters poll `status` and only act when `ownedByCaller` is true; there
is no automatic chat wake-up. Requests expire after ten minutes and can be renewed without
jumping the queue. After fifteen minutes without a task update the task is marked stale,
not completed. A disconnected or stalled owner never grants implicit permission to take over;
the user can transfer or take back the tab from the context menu. User-owned tabs still
require a picked `source_tab` and explicit `request_tab` approval even in auto mode.

## Using it

Ask Claude to do something in the browser: *"open seaskablo.com and find the price list"*.
Claude opens its own tab in the background; the tab gets an agent-colored line and the island shows
what's happening. Click the island to jump to the tab.

### Select several elements

Open the picker with Ctrl+Shift+F or the page context menu. Shift-click adds/removes
an element; Enter finishes the selected set. Up to eight elements from the same top-level
page are supported. Backspace removes the last selection, Escape cancels all, and arrow
keys still move to parent/child. A normal click keeps the original single-element flow.
Numbered outlines follow selected elements. Write one note and choose a destination in
the island: each element arrives with its own context and visible crop when available.
Selection grants no tab access. A navigation before sending requires a new selection.

### Compact repeated reads

`read_page` and `get_page_text` accept `diff: true`. The first response includes a
`snapshot` ID and full output. On the next call, use the same tool/options and pass that
exact ID as `since`: unchanged output is short; changed output contains unified line hunks
and a new ID. Apply hunks to the previous returned text, excluding its metadata header.
Only the returned scope is compared, including any truncation; removed lines describe the
old state and their refs should not be used. Snapshot metadata is not page content.

Missing/old IDs, different options, navigation, frame-document changes or ownership changes
produce a fresh full response. Large/expensive diffs also fall back to full text. Snapshot
storage is bounded, isolated by MCP session and discarded on bridge reload. Default
`diff: false` keeps the plain-text response and is available for recovery. Existing clients
need an MCP reconnect to discover the new arguments.

### Click target checks

`computer` ref clicks check the selected point before mouse-down and report a covering
node with its ref. Child icons are accepted; parent iframes are checked too. Moving or
covered targets stop the click, and multi-click stops if an earlier click exposes another
element. Hover and scroll-to remain available. No overlay is automatically removed.
Coordinate clicks detect changes during cursor movement but cannot identify an intended
control that was already covered before the call; prefer refs. Cross-process iframe checks
are not atomic. These checks apply to computer clicks, not programmatic JavaScript/form edits.

### The island

- shows the site and the current action (*clicking*, *typing*, …), with a live preview on hover
- **■** stops Claude; **Resume** lets it continue. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Esc</kbd> works too
- when Claude needs you (a payment confirmation, a captcha, a login) it asks in the island and
  outlines the element on the page; you get a desktop notification if the browser isn't focused
- page dialogs (`alert`, `confirm`) show up there too

### Handing over a tab

Right-click a tab → **Give to session…**, then select the agent/project/session suffix.
Use **Transfer to session…** to change the owner. **Take back from agent** revokes access
and cancels active work immediately. Old queued requests cannot resume after a transfer,
even if the tab is given back to the same session.

When an MCP process disconnects, active work stops immediately. A five-second reconnect
grace preserves ownership for the same process; otherwise its tabs are returned to you and
remain open. Reconnect the MCP server once after installing this update to enable lifecycle
tracking. Older running servers remain usable but untracked sessions expire after 24 hours
of inactivity.

### Showing an agent an element

Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> (or right-click → **Show to agent…**),
select an element, write your request, and choose the destination session in the island.
The payload includes the page URL, selector, accessible name, styles, text, trimmed HTML,
element screenshot path and, on development builds, the React/Vue component chain.

- **Claude Code:** enable [channels](https://code.claude.com/docs/en/channels) with
  `claude --dangerously-load-development-channels server:zen`. The channel subscribes automatically.
- **Codex:** install lifecycle hooks once with `node dist/cli.js codex-hooks install`
  (or `npx zen-mcp codex-hooks install` for an installed package), then review and trust
  the three Zen hooks in Codex's `/hooks` screen. SessionStart starts a receiver using the
  exact host-provided session UUID; UserPromptSubmit refreshes it; SessionEnd stops it.
  Opening or resuming a chat connects automatically, even before its first browser tool call.
  One receiver per thread survives MCP reconnects and retries when Zen opens or reloads.
  `connect_session` remains a manual fallback. Remove with `codex-hooks uninstall`.
  The island says **Queued** only after `codex queue` accepts the message, not when the
  agent has read or completed it. In the tested active conversation, input arrived after
  the current turn finished.
- **Other clients / no connection:** choose **Clipboard**, then paste into your agent.

The destination list shows the agent, project and a short session suffix. It is fixed when
compose opens; Send uses the selected target even if another session becomes active.
If that target disconnects or delivery fails, the context is copied to the clipboard,
never silently sent to another chat. Double-clicking Send does not duplicate delivery.

Selecting an element does not grant access to its tab. The agent can ask with `request_tab`
if it needs live access, and you approve or decline in the browser.

## Browser extensions

The agent discovers installed extensions in `tabs_context_mcp` or with `extensions list`.
It can use their real toolbar UI with one generic tool; there are no extension-specific
APIs, rules or integrations.

```json
{"action":"open","tabId":12,"extensionId":"uBlock0@raymondhill.net"}
{"action":"read","tabId":12,"extensionId":"uBlock0@raymondhill.net"}
{"action":"computer","computerAction":"left_click","ref":"<panel ref from read>","tabId":12,"extensionId":"uBlock0@raymondhill.net"}
{"action":"close","tabId":12,"extensionId":"uBlock0@raymondhill.net"}
```

`read`, `text`, `find`, `computer` (including screenshots, scrolling, typing and keys), and
`form_input` operate on the panel. Panel refs include a panel/document prefix and cannot
be confused with source-page refs. An extension with a toolbar action but no popup can
still be invoked with `open`; the response states that no panel exists.

If the source tab is not selected, opening a panel always asks in the island before
switching tabs, even in auto mode. Denial or timeout leaves the selected tab unchanged.
An already selected target needs no switch approval; normal site/action rules still apply.
The existing window is used because extensions act on the active tab. The tab must belong to the caller. Site rules and approvals apply to the
source site; a panel cannot be used as another session's tab handle. Switching tabs,
navigation, ownership changes or dismissal require reopening and fresh refs. Stop,
session end and bridge reload close tracked panels.

The agent is instructed to track temporary setting changes and restore the original
state through the UI when finished. There is no automatic rollback after interruption.
This first version controls toolbar panels, not arbitrary browser settings, extension
background code or sidebar-only interfaces. Extension-created tabs follow normal tab
ownership rules; clipboard/download outputs still use the existing host/file workflow.

After installing this update, reconnect the MCP client to discover the new `extensions`
tool; reloading the browser bridge alone does not refresh an existing MCP server.

## Modes and site rules

The general mode is **auto** (act without asking) or **ask** (request approval before
an action). Each site can have one rule in the tab context menu → **Agent permissions** → **This site**:

| Site rule | Behavior |
|---|---|
| **Use general setting** | Follow auto/ask; removes this site's explicit rule |
| **Ask before every action** | Require approval even in auto mode |
| **Block agent access** | Deny page reads, screenshots, actions and agent navigation |

Rules cover subdomains. Blocking wins over asking; a child domain cannot weaken a
parent-domain rule. The menu indicates inherited restrictions. There is no built-in list.
Blocked embedded frames also prevent access to the parent page, including screenshots.
A blocked tab can still be closed or returned to the user.

Actions are clicks, dragging, typing, key presses, filling forms, uploading files, running
JavaScript and answering dialogs. In general ask mode, navigation also requires approval;
a site's ask rule retains the old sensitive-site behavior (navigation and reads are free).
Reading, screenshots, scrolling and waiting require no approval unless site access is blocked.
Batch actions on an unchanged page share one approval; navigation, redirects, reloads or
policy edits invalidate it. Denying approval stops the remaining batch steps.

Switch the general mode from the island or the tab context menu. CLI equivalents:

```sh
npx zen-mcp config mode ask
npx zen-mcp config site ask accounts.google.com
npx zen-mcp config site block mybank.com
npx zen-mcp config site default accounts.google.com
npx zen-mcp config site list
```

Settings live in `~/.config/zen-mcp/config.json` and apply immediately:

```json
{"mode":"auto","sites":{"accounts.google.com":"ask","mybank.com":"block"}}
```

Old `sensitive` entries are read as ask rules and migrated on the next settings write;
`config sensitive add|remove` remains supported. Rules govern Zen MCP access, not the
user's browsing or a system-wide network firewall. During an agent call, HTTP requests
and redirects to blocked hosts are cancelled; the browser's independent background
activity is not globally filtered.

Every tool call is logged to `~/.local/state/zen-mcp/activity.jsonl` (time, site, what was
done). Ask Claude *"what did you do in the browser yesterday?"*.

## Tools

Names and parameters match Claude in Chrome, so prompts carry over.

| Tool | |
|---|---|
| `tab_work` | shared task status, FIFO handoff requests and context |
| `tabs_context_mcp`, `tabs_create_mcp`, `tabs_close_mcp` | Claude's tabs |
| `navigate` | go to a URL, back, forward |
| `computer` | screenshot (with `scale`), clicks, hover, drag, scroll, type, keys, wait; by coordinate or element ref |
| `read_page`, `find`, `get_page_text` | accessibility-style tree with refs, keyword search, readable text. Iframes included, cross-origin too |
| `form_input`, `file_upload` | set form values; put files into file inputs without a picker |
| `wait_for` | wait until text or an element appears or disappears, or the network is idle |
| `browser_batch` | several of the above in one call |
| `read_console_messages`, `read_network_requests` | console output; requests with headers and bodies (cookies and auth hidden) |
| `javascript_tool`, `handle_dialog` | run JS in the page; answer `alert`/`confirm`/`prompt` |
| `connect_session` | bind a Codex conversation for browser-to-chat selections |
| `ask_user`, `request_tab` | hand a step to you; ask for access to your tab |

## Security

Please read this before installing.

- **The browser side runs with full browser privileges.** That's what makes real input
  possible, and it's how autoconfig works. The code is in [`browser/`](browser); it's loaded
  from `~/.local/share/zen-mcp`.
- **Only you can talk to it.** The bridge listens on a Unix socket in your runtime folder with
  `0600` permissions; there's no network port. Other programs running as your user could
  connect, as they could also edit your browser profile.
- **Claude only touches its own tabs** and the ones you hand over. Your other tabs aren't
  listed and can't be used, even by ID.
- **Pages can try to trick Claude** (prompt injection), and Claude acts with your logins. Use
  ask mode or sensitive sites for anything that matters, and watch the island.
- **Cookies and authorization headers are hidden** from network details.
- Remove everything with `npx zen-mcp uninstall`.

## How it works

```
Claude Code ──stdio MCP──▶ npx zen-mcp ──Unix socket──▶ browser bridge (privileged, in the browser)
                                                         ├─ island and menus in the browser window
                                                         └─ a page actor in every frame: input, page tree, picker
```

The loader is a few lines of [autoconfig](https://support.mozilla.org/kb/customizing-firefox-using-autoconfig).
Input is produced inside the page's process with the browser's own `EventUtils`, the same
way Firefox's WebDriver does it, but without starting the remote agent.

## Troubleshooting

- `npx zen-mcp doctor` checks each piece and tells you what to do.
- Bridge errors go to `$XDG_RUNTIME_DIR/zen-mcp.log` (or `$TMPDIR` on macOS).
- After installing, restart the browser once; the loader only runs at startup.

## Development

```sh
git clone https://github.com/efeaslansoyler/zen-mcp && cd zen-mcp
npm install && npm run build
ln -s "$PWD/browser" ~/.local/share/zen-mcp   # browser side straight from the repo
node dist/cli.js install                         # adds the loader to your browser
claude mcp add --scope user zen -- node "$PWD/src/server.ts"
node scripts/zenctl.ts reload                    # reload the bridge after changes, no restart
```

[`docs/DEVAM.md`](docs/DEVAM.md) has architecture notes and the Gecko pitfalls we hit (in Turkish).

Run `npm test` for the MCP compatibility, wire-protocol, and island state tests. These
use an in-memory browser/DOM fixture; live Gecko behavior still needs a browser smoke test.

## License

[MIT](LICENSE)
