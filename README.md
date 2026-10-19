# zen-mcp

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![Türkçe](https://img.shields.io/badge/dil-Türkçe-red)](README.tr.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Let Claude use **your own Zen browser**: your tabs, your logins, real mouse and keyboard
input, and a small island at the top of the window that shows what Claude is doing. Works with
Claude Code (and any MCP client). Firefox and other Firefox-based browsers work too.

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

## Using it

Ask Claude to do something in the browser: *"open seaskablo.com and find the price list"*.
Claude opens its own tab in the background; the tab gets an orange line and the island shows
what's happening. Click the island to jump to the tab.

### The island

- shows the site and the current action (*clicking*, *typing*, …), with a live preview on hover
- **■** stops Claude; **Resume** lets it continue. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Esc</kbd> works too
- when Claude needs you (a payment confirmation, a captcha, a login) it asks in the island and
  outlines the element on the page; you get a desktop notification if the browser isn't focused
- page dialogs (`alert`, `confirm`) show up there too

### Handing over a tab

Right-click a tab → **Give to Claude** lets Claude continue where you are. **Take back from
Claude** ends it at any time.

### Showing Claude an element

Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> (or right-click → **Show to Claude…**),
hover to choose an element (<kbd>↑</kbd>/<kbd>↓</kbd> for parent/child), click, and type what
you want. It's sent to your Claude Code session with the page URL, a CSS selector, the
accessible name, computed styles, text, trimmed HTML, a screenshot of the element and, on dev
builds, the component chain (`HeroSection > CTAButton`). Great for "make this button bigger"
on your own site.

This uses Claude Code [channels](https://code.claude.com/docs/en/channels), a research
preview. Custom channels need a flag, and Claude Code asks for confirmation at every start:

```sh
claude --dangerously-load-development-channels server:zen
```

Without the flag, the element and your note are copied to the clipboard instead, ready to paste.

If Claude wants to look at your tab live afterwards, it can ask for it; you approve or deny in
the island.

## Modes and sensitive sites

| | |
|---|---|
| **auto** (default) | Claude acts without asking |
| **ask** | Claude asks in the island before every action: *button "Send": click*, *type "hello"* |
| **sensitive sites** | always ask, whatever the mode. There is no built-in list; add your own |

Actions are clicks, dragging, typing, key presses, filling forms, uploading files, running
JavaScript, answering dialogs and, in ask mode, navigating. Reading, screenshots, scrolling and
waiting are always allowed. A batch of actions is approved with one question.

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

## License

[MIT](LICENSE)
