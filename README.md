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

Ownership uses the MCP server's session ID, which is distinct from a Codex conversation UUID.
We do not infer a relationship from the agent name or project folder. When a delivery target
cannot be verified as the tab owner, the pick carries `source_tab` and live access requires
an explicit `request_tab` grant. Multiple conversations sharing one MCP server process are
one ownership session; this does not claim isolation between those conversations.

## Using it

Ask Claude to do something in the browser: *"open seaskablo.com and find the price list"*.
Claude opens its own tab in the background; the tab gets an agent-colored line and the island shows
what's happening. Click the island to jump to the tab.

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

## Modes and sensitive sites

| | |
|---|---|
| **auto** (default) | Claude acts without asking |
| **ask** | Claude asks in the island before every action: *button "Send": click*, *type "hello"* |
| **sensitive sites** | always ask, whatever the mode. There is no built-in list; add your own |

Actions are clicks, dragging, typing, key presses, filling forms, uploading files, running
JavaScript, answering dialogs and, in ask mode, navigating. Reading, screenshots, scrolling and
waiting are always allowed. Batch actions on an unchanged page share one approval. Navigation,
redirects, page reloads or permission-setting changes invalidate that approval; subsequent
actions are checked again against the current site. Destination-page actions are requested
after navigation. Denying permission stops the remaining batch steps.

Switch modes from the island (while Claude works) or from the tab context menu (**Claude asks
before every action**), or:

```sh
npx zen-mcp config mode ask
npx zen-mcp config sensitive add mybank.com accounts.google.com
```

Settings live in `~/.config/zen-mcp/config.json` and apply immediately.

Every tool call is logged to `~/.local/state/zen-mcp/activity.jsonl` (time, site, what was
done). Ask Claude *"what did you do in the browser yesterday?"*.

## Tools

Names and parameters match Claude in Chrome, so prompts carry over.

| Tool | |
|---|---|
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
