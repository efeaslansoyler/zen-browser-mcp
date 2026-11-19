# zen-browser-mcp

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![Türkçe](https://img.shields.io/badge/dil-Türkçe-red)](README.tr.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

> [!WARNING]
> **Vibe-coded: use at your own risk.** This project was written almost entirely by AI coding
> agents. It has tests, but it has not been audited.
>
> It also works differently from most browser tools: it doesn't drive a separate browser, it
> runs **inside your own browser** with full browser privileges (through autoconfig), and agents
> act with **your logins and sessions**. So:
>
> - A bug hits your real browser, tabs and accounts, not a sandbox.
> - A malicious page can try to talk the agent into doing things with your accounts (prompt
>   injection).
> - The loader goes into the browser's installation folder (sometimes with `sudo`).
> - Any program running as your user can connect to the bridge's socket.
>
> Keep auto or ask mode, block sites agents should never touch, watch the island, and don't use
> it in a browser profile whose accounts you can't afford to risk. See [Security](#security).

Let AI agents use **your own Zen browser**: your tabs, your logins, real mouse and keyboard
input, and a small island at the top of the window that shows what the agent is doing. Works with
Claude Code, Codex, and other MCP clients. Firefox and other Firefox-based browsers work too.

[![zen-browser-mcp demo: you point at a grey button and send it to Claude Code, point at the total and send it to Codex; both work in one browser, Claude asks before submitting the form; then you show Claude once how to add a coffee in the admin page, it saves that as a recipe and adds the rest](docs/media/demo.gif)](docs/media/demo.mp4)

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
npx zen-browser-mcp install
```

This finds your browser, adds a small loader to its installation folder (it asks for `sudo`
if the folder belongs to root) and copies the browser-side files to `~/.local/share/zen-mcp`.
If the browser already has an autoconfig file (for example from Sine or fx-autoconfig), the
loader is appended to it as a marked block; nothing else is changed.

Then restart the browser and add the server to Claude Code:

```sh
claude mcp add --scope user zen -- npx -y zen-browser-mcp
```

Optionally, add the agent skill. It teaches the agent when to use which tool: your open tab
instead of a new one, handing you logins and 2FA, waiting without blocking. It goes into the
skill folders of the clients you have (`~/.claude/skills`, `~/.agents/skills` for Codex):

```sh
npx zen-browser-mcp skill install
```

Check everything with `npx zen-browser-mcp doctor`. New versions update the browser side by
themselves when Claude Code starts the server, without sudo or a browser restart.

> Some browser updates replace the installation folder (macOS app updates, tarball installs).
> If `doctor` says the loader is gone, run `npx zen-browser-mcp install` again.

## Codex and other MCP clients

The standard browser tools use stdio MCP. For a local development checkout:

```sh
codex mcp add zen -- node /absolute/path/to/zen-browser-mcp/src/server.ts
```

Other MCP clients can launch the same command, or the built package's `dist/cli.js`.
Mouse coordinates use standard fixed-length arrays (`[x, y]`) for client compatibility.

The MCP initialization client name selects presentation automatically: **Claude** uses
orange, **Codex** mint, **Antigravity** blue, **OpenCode** gray, each with its own icon, and
other agents light blue with their client name. Menus that let you choose a session show the
icon of the agent all connected sessions share, or a combined icon when they differ. The island, tab
stripe, cursor, click ring, and handoff outline follow the agent performing the action.
Tab colors follow the agent that acted last in the tab. After a browser restart, restored
tabs must be handed over again; saved colors do not restore access rights.
For clients that hide their identity behind a proxy, set `ZEN_MCP_AGENT=codex` or
`ZEN_MCP_AGENT=claude` in the MCP server environment.

Agent identity is a visual label. Tab access belongs to particular MCP server sessions:
two Codex clients have separate tab lists and cannot read, modify or close each other's tabs
unless one joins the other's tab. Calls on one tab run one at a time, in order; calls on
different tabs run at the same time. Stop/Resume and the permission mode apply to all.
How picks and recipes reach a conversation depends on the client; see
[Showing an agent an element](#showing-an-agent-an-element). Every client can use the clipboard.

Access uses the MCP server's session ID, distinct from a Codex conversation UUID.
We do not infer a relationship from agent names or project folders. Multiple conversations
sharing one MCP server process remain one session.

Several sessions can share a tab. `tabs_context_mcp` lists the tabs other sessions work in
(`agentTabs`), and `request_tab` joins one: at once in **auto** mode, after your Allow in
**ask** mode. Your own tabs always need your approval, in every mode. In a shared tab the
agents take turns call by call, and a `browser_batch` runs as one turn. They tell each other
what they are doing with `tab_work` (`start`, `update`, then `finish` with a short summary);
`list`/`status` show each member's note and whether a call is running. Page contents and
chat histories stay private. When an agent comes back to a shared tab, its next result says
what the others did there meanwhile (who, their task note, how many actions, how long ago;
never what they typed) and, if one of them may have changed the page since the agent last
read it, tells it to read the page again before using old refs. For a few steps that must
not be interrupted (a checkout, a multi-page form) an agent can hold the tab with a reason
(`tab_work hold`, up to 10 minutes, renewable): the others are refused in that tab until it
releases it (they wait in the background with `watch` and `hold: true`, which reports when the
hold ends), and with `noWorkaround` they can't work on that site in another tab either, so
they can't open the same page elsewhere. A hold also ends when its agent makes no call for 2
minutes or disconnects; right-click the tab → **Remove hold** to end it yourself. An agent
that closes a tab others still use only leaves it.

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

Missing/old IDs, different options, navigation, frame-document changes or tab access changes
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
  outlines the element on the page; you get a desktop notification if the browser isn't focused.
  Logins and 2FA codes are yours to type: Claude hands the step over and waits for **Done**, so
  your credentials never pass through it
- page dialogs (`alert`, `confirm`) show up there too
- several agents at once stay on one line: it shows one of them (the latest to act) with
  **◀ ▶** and every agent's icon; click an icon or an arrow to keep the line on that agent. An
  agent holding its tab shows a lock and the time left; hover for the reason and **Remove hold**
- questions from several agents are cards: **◀ 1/2 ▶** goes through them and you answer each
  on its own. A new question never replaces the card you're reading; a dot on **▶** tells you
  it came

### Handing over a tab

Right-click a tab → **Give to session…**, then select the agent/project/session suffix.
On a tab agents already work in, **Share with session…** adds another session; the ones in
it keep working. **Take back from agent** revokes every agent's access and cancels active
work immediately. A session's old queued requests cannot resume after it left a tab, even if
the tab is given back to the same session.

When an MCP process disconnects, active work stops immediately. A five-second reconnect
grace preserves access for the same process; otherwise it leaves its tabs, and a tab no
agent works in any more returns to you and stays open. Reconnect the MCP server once after installing this update to enable lifecycle
tracking. Older running servers remain usable but untracked sessions expire after 24 hours
of inactivity.

### Showing an agent an element

Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> (or right-click → **Show to agent…**),
select an element, write your request, and choose the destination session in the island.
The payload includes the page URL, selector, accessible name, styles, text, trimmed HTML,
element screenshot path and, on development builds, the React/Vue component chain.

The destination list says how each session receives it: **now**, **when you write** or
**on its next action**.

- **Now**, when the client has a way in:
  - **Claude Code** with [channels](https://code.claude.com/docs/en/channels):
    `claude --dangerously-load-development-channels server:zen`. Claude Code ignores the flag
    in `-p` mode and in apps that run it through the Agent SDK (T3 Code, for example).
  - **Codex** through `codex queue` (details below).
  - **T3 Code** threads through `t3 thread send`. The message shows in the thread as a user
    message marked `[zen]`.
  - **OpenCode** with the zen plugin (`hooks install`, below): sent as a new message to the
    session you last wrote to, with its agent and model.
- **Otherwise it waits** and arrives once, with the session's next browser tool result, or
  with your next message to that session when the prompt hooks are installed:

  ```sh
  npx zen-browser-mcp hooks install
  ```

  For the clients you have, this adds a `UserPromptSubmit` hook to Claude Code, the lifecycle
  hooks to Codex, a `PreInvocation` hook to Antigravity CLI and a plugin to OpenCode. Other
  hooks and settings are kept, and changed files are backed up first. `doctor` shows whether
  they are installed; remove them with `hooks uninstall`. Codex asks you to trust new hooks
  once in `/hooks`.
- **Clipboard:** choose it in the island and paste into any agent.

Codex details: SessionStart starts a receiver with the exact host-provided session UUID;
UserPromptSubmit refreshes it; SessionEnd stops it. Opening or resuming a chat connects
automatically, even before its first browser tool call. One receiver per thread survives MCP
reconnects and retries when Zen opens or reloads. `connect_session` remains a manual
fallback, and `codex-hooks install|uninstall` still manages only the Codex hooks. The island
says **Queued** only after `codex queue` accepts the message, not when the agent has read or
completed it. In the tested active conversation, input arrived after the current turn
finished.

The destination list shows the agent, project and a short session suffix. It is fixed when
compose opens; Send uses the selected target even if another session becomes active.
If that session ends before it receives what you sent, or delivery fails, the context is copied
to the clipboard, never silently sent to another chat. Double-clicking Send does not duplicate delivery.

Selecting an element does not grant access to its tab. The agent can ask with `request_tab`
if it needs live access, and you approve or decline in the browser.

### Show me once

Some things are faster to show than to explain. An agent can ask you to show it a task once
(`show_me`): the island turns into a one-line recorder ("Recording · 3 steps") while you do the
task in the tab, and each recorded element flashes briefly. You can also start a recording
yourself with right-click → **Record steps for an agent…** on any page.

When you press **Finish**, the island shows the steps for review:

- Name the recipe. Saving under an existing name overwrites that recipe (the button says so).
- Delete wrong steps (✕) and mark values that change every time (**↻ Changes**): the agent then
  asks you for them, or takes them from your request, instead of repeating the recorded value.
- **Play** the steps from their screenshots, zoomed in on each element (← → to step, Esc to go
  back).
- Add a note, and tick **Let the agent try it now**. For a recording you started, choose a
  session to send it to, like an element pick.

Clicks, typing, selections, checkboxes, uploads and special keys are recorded, in iframes too;
scrolling and mouse movement are not. Values typed into password, card and one-time-code
fields are never recorded: such steps say "secret" and the agent hands them back to you.

Recipes are saved in `~/.local/state/zen-mcp/recipes/` (steps and screenshots, nothing leaves
your computer). `tabs_context_mcp` tells agents about the recipes for the sites you have open,
and the `recipes` tool lists and returns them as steps to repeat with their own tools; deleting
one asks you first. From the terminal: `npx zen-browser-mcp recipes [list] | show <id> | rm <id>`.

## Input and tab emulation

Hover already works with `computer hover`. Optional `movement: "smooth" | "human"`
sends real intermediate pointer events for clicks, hover, movement and drag;
`duration_ms`, `steps`, `seed` control the path. `typing: "human"` sends characters with
variable delays (`delay_ms`, `seed`). Defaults preserve fast input. These are pacing
options, not a guarantee against bot detection.

`computer key_down/key_up` hold/release a single key (`text: "Shift"`, `"Control"`, `"a"`).
`mouse_move/mouse_down/mouse_up` provide separate pointer control (`button: "left" |
"middle" | "right"`). Holds are session/frame scoped and released on errors, Stop,
navigation, tab access changes, disconnection, reload and a maximum 30-second watchdog
(`hold_ms` may shorten it). Held Control/Meta cannot bypass clipboard consent.

`screenshot` accepts `if_changed: true` to skip identical images and `annotate: true`
to label up to 80 visible top-frame controls with refs.

Use `computer` → `screenshot` with `diff: true` to save a viewport baseline. Compare with
`diff: true` and `since: "<baseline>"`. Use `baseline_scope: "deploy"` when saving to compare
across a reload or against another tab in the same session. Keep the source tab open and
match the viewport, scale and scroll position. Baselines expire after one hour or on
eviction, access revocation or bridge reload. Visual diffs are inspired by
[Agent Browser](https://agent-browser.dev/diffing).

Set `full_page: true` to inspect the currently rendered document as one bounded image.
Long pages are downsampled and unloaded content stays unloaded. Use refs or a viewport
screenshot for clicks.

`browser_settings` supports `get`, `devices`, `viewport`, `device`, `media`, `reset`.
Every mutation/reset asks in the island, even in auto mode; the prompt mentions any
necessary tab switch. Viewport, DPR, touch-event, custom user-agent and color overrides
are per tab, and restored on reset, on take-back, or when the session that made them leaves
the tab. No window resize/global pref changes are made. Generic mobile/tablet/desktop
presets keep Gecko; actual metrics are
returned alongside `requested` overrides and may differ due to native scaling/privacy.
A preset is not another browser engine or a physical device fingerprint.

See [feature comparison and limitations](docs/feature-comparison.md).

## React and accessibility inspection

`react` reads a DOM-backed React component tree (`action: "tree"`) or an element's
ancestor component chain (`action: "inspect", ref: "ref_4"`). `include_props: true`
adds bounded committed-props previews; the default is false. Getters and components
are not invoked. `max_depth` (default 12, max 30) and `max_nodes` (default 100, max 300)
limit the tree. Unavailable/minified names and server-only components cannot be
recovered; this uses private Fiber data, so React version compatibility is best-effort.
It does not install a DevTools hook or record renders.

`accessibility` runs the bundled **axe-core 4.14.0** locally, returning `violations`,
`incomplete` checks requiring manual review, counts and affected element refs.
Optional `tags` selects rule tags (e.g. `["wcag2a", "wcag2aa"]`); `ref` scopes the
scan to a subtree. `max_nodes` limits affected nodes per rule (default 10, max 50),
`max_rules` limits detailed rules per group/frame (default 100, max 200).
Scans time out after 20 seconds per frame, with a 45-second total work budget.
No remote service or page-global `axe` installation is used; the sandbox is destroyed
on completion, cancellation or timeout.

Both tools use owned tabs and the usual permissions: they ask in ask mode and are refused on
blocked sites. Without a ref, accessible frames are
inspected separately; failed frames are reported explicitly. Cross-frame accessibility
relationships are not evaluated. With a ref, only its frame/subtree is inspected;
nested frames are excluded. Navigation during inspection invalidates the result.
Props and findings are untrusted page data; props can contain sensitive values.
Automated checks cannot establish accessibility compliance.

## System clipboard

`clipboard` supports `read`, `write`, `copy` and `paste`. Every operation requires a
fresh island approval, including auto mode and each step of a batch. Standard
Ctrl/Cmd+C/V/X and Insert/Delete clipboard shortcuts use the same consent path.
Denial or timeout does not access the clipboard or perform the requested action.

An owned `tabId` anchors the request to a browser context. `read` returns plain text
with `untrusted`, `characters` and `truncated` metadata (`max_chars`: 20000 by default,
100000 maximum). `write` replaces clipboard text without echoing it in the response
or activity log. `copy` copies the existing selection; `paste` uses an editable `ref`
or the focused field. Native copy/paste events are used; no synthetic clipboard data
is sent to the page. Target changes during approval invalidate the request.

```json
{"action":"read","tabId":12,"max_chars":20000}
{"action":"write","tabId":12,"text":"Hello"}
{"action":"copy","tabId":12}
{"action":"paste","tabId":12,"ref":"ref_4"}
```

For an already-open extension panel, copy/paste accept `extensionId` and its panel ref.
The panel is temporarily kept open while island consent is pending. Clipboard operations
do not switch tabs. Page block rules still apply. This controls MCP clipboard actions
and standard shortcuts, not independent clipboard writes by websites or extensions.
The clipboard is shared with other applications; there is no automatic rollback of
an approved write. Reconnect the MCP client to discover the new tool.

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
navigation, tab access changes or dismissal require reopening and fresh refs. Stop,
session end and bridge reload close tracked panels.

The agent is instructed to track temporary setting changes and restore the original
state through the UI when finished. There is no automatic rollback after interruption.
This first version controls toolbar panels, not arbitrary browser settings, extension
background code or sidebar-only interfaces. Extension-created tabs follow normal tab
tab access rules; clipboard/download outputs still use the existing host/file workflow.

After installing this update, reconnect the MCP client to discover the new `extensions`
tool; reloading the browser bridge alone does not refresh an existing MCP server.

## Zen workspaces

Agent tabs open in the workspace you're in. To keep them out of your way, pick a space in the
tab context menu → **Agent settings** → **New agent tabs open in** (or
`npx zen-browser-mcp config workspace <name>`, `current` to undo). A missing space is created without
switching to it. Agents work in a hidden space as usual: reading, input and screenshots don't
need the tab to be visible, and the island's go-to-tab button takes you there.

## Clean tabs

By default agent tabs use your logins, which is what you want when the agent works in your
accounts. For research or sites you don't trust, an agent can open a **clean tab**
(`tabs_create_mcp` with `clean: true`): it runs in a separate **Agent** container, with its own
cookies, logins and site data, in the same window. To make every new agent tab clean, run
`npx zen-browser-mcp config container Agent` (`off` to undo). History and extensions are still
shared, and tabs you hand over keep their own container.

## Permission modes and sites

Two settings decide what agents may do: the **permission mode** says which operations need
your approval, and the **site list** says where agents may go at all.

### Permission modes

| Mode | Asks you before |
|---|---|
| **ask** | Every action: clicks, typing, keys, forms, navigation, dialogs, inspection. Reading pages, screenshots, scrolling and talking to you are free. |
| **auto** (default) | Only risky operations: submitting a form, typing into password, card or one-time-code fields, running JavaScript, uploading files, accepting page dialogs, acting in extension panels, and anything touching your clipboard, your own tabs or browser settings. |
| **custom** | Whatever your own `permissions.jsonc` says. |

"Submitting a form" means clicking a form's submit button, or pressing Enter or Space where
that submits it. Sites that send messages or buy things with plain JavaScript buttons outside
a form are not detected; use **ask** for those, or block them.

Switch the mode with the island's mode button or the tab context menu → **Agent settings**,
or `npx zen-browser-mcp config mode ask|auto|custom`. Batch actions on an unchanged page share
one approval; navigation, redirects, reloads or settings edits invalidate it, and denying
stops the remaining steps.

### Your own template (custom)

```sh
npx zen-browser-mcp config permissions init      # or: init ask, to start from the ask template
$EDITOR ~/.config/zen-mcp/permissions.jsonc
npx zen-browser-mcp config mode custom
```

The file lists every operation (each tool, and each action of the bigger ones such as
`computer.click` or `clipboard.read`, plus `submit` and `secret_field`) with a comment that
says what it does and its built-in rules. Set each to `"allow"`, `"ask"` or `"deny"`; lines you
delete keep the base template's rule:

```jsonc
{
  "base": "auto",
  "rules": {
    "navigate": "ask",           // (ask / allow) Go to an address, back or forward.
    "javascript_tool": "deny",   // (ask / ask) Run any JavaScript in the page…
    "submit": "allow"            // (ask / ask) Submit a form…
  }
}
```

> [!CAUTION]
> In a custom template you decide everything, including allowing what the built-in templates
> always ask: your clipboard, your own tabs, submitting forms, secret fields. An `"allow"`
> there means an agent, or a page that tricks it, can do it with your logins without a question.

`npx zen-browser-mcp config permissions` shows what your file changes from its base. A typo in
an operation name, or a broken file, is an error (tools fail and `doctor` reports it); it
never falls back to looser rules.

### Sites

The site list is a **blocklist** (default: agents can use every site except the listed ones)
or an **allowlist** (agents can use only the listed ones). Both lists are kept, so you can switch
without losing either; only the active one applies. A domain covers its subdomains. Toggle the
current site in the tab context menu → **Agent settings**, or:

```sh
npx zen-browser-mcp config site block mybank.com
npx zen-browser-mcp config site unblock mybank.com
npx zen-browser-mcp config site allow localhost github.com
npx zen-browser-mcp config site mode allowlist
npx zen-browser-mcp config site list
```

A site agents may not use is closed to them completely: no reads, screenshots, actions or
navigation, and the tab list shows only its ID. A blocked frame inside a page blocks the page
too. Agents can still close a blocked tab or hand it back. During an agent call, requests to a
blocked host are cancelled; with an allowlist only page and frame loads are, because allowed
sites load resources from other hosts (CDNs). Pages without a host (`about:blank`, local
files) aren't sites and are not restricted. The list governs agents, not your own browsing,
and it is not a network firewall.

Settings live in `~/.config/zen-mcp/config.json` and apply immediately:

```json
{"mode": "auto", "sites": {"mode": "blocklist", "blocklist": ["mybank.com"], "allowlist": []}}
```

Every tool call is logged to `~/.local/state/zen-mcp/activity.jsonl` (time, site, what was
done). Right-click a tab → **Agent history** for the last actions agents took there, or
**Full history…** for a page of everything, grouped by session. You can also ask Claude
*"what did you do in the browser yesterday?"*.

## Tools

Names and parameters match Claude in Chrome, so prompts carry over.

Agent tabs run like foreground tabs during page tool calls and for five seconds afterward.
Watches and downloads use normal background throttling by default. Use `watch` with
`live: true` when the page needs fast timers or animation frames for the whole watch. This
costs CPU and cannot be combined with `hold: true`.

| Tool | |
|---|---|
| `tab_work` | what each agent in a shared tab is doing (task notes) |
| `tabs_context_mcp`, `tabs_create_mcp`, `tabs_close_mcp` | Claude's tabs |
| `navigate` | go to a URL, back, forward |
| `computer` | screenshot (with `scale`), clicks, hover, drag, scroll, type, keys, wait; by coordinate or element ref |
| `react`, `accessibility` | React component tree/ancestor props and local axe-core checks, including per-frame reports |
| `read_page`, `find`, `get_page_text` | accessibility-style tree with refs, keyword search, readable text. Iframes included, cross-origin too |
| `form_input`, `file_upload` | set form values; put files into file inputs without a picker |
| `wait_for` | wait until text or an element appears or disappears, or the network is idle |
| `watch` | report page conditions or text changes to an events file in the background, with optional `live: true` |
| `browser_batch` | several of the above in one call |
| `read_console_messages`, `read_network_requests` | console output; requests with headers and bodies (cookies and auth hidden) |
| `downloads` | files downloaded from the tab: state, path, size/progress; `wait` blocks until the file is done and returns its sha256; `cancel` stops one and deletes the partial file |
| `javascript_tool`, `handle_dialog` | run JS in the page; answer `alert`/`confirm`/`prompt` |
| `connect_session` | bind a Codex conversation for browser-to-chat selections |
| `highlight` | frame elements with short labels to point them out to you (several at once, iframes included) |
| `show_me`, `recipes` | ask you to show a task once and save it as a recipe; list, read and (after you confirm) delete recipes |
| `ask_user`, `hand_to_user`, `request_tab` | ask you a question (with answer buttons, with or without a tab); hand you a step only you should do (logging in, 2FA, a captcha, a payment) and continue when you press **Done**; ask for access to your tab |

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
- **Pages can try to trick Claude** (prompt injection), and Claude acts with your logins. Keep
  the default auto mode or use ask mode for anything that matters, block sites agents should
  never use, and watch the island.
- **Cookies and authorization headers are hidden** from network details.
- Remove everything with `npx zen-browser-mcp uninstall`.

## How it works

```
Claude Code ──stdio MCP──▶ npx zen-browser-mcp ──Unix socket──▶ browser bridge (privileged, in the browser)
                                                         ├─ island and menus in the browser window
                                                         └─ a page actor in every frame: input, page tree, picker
```

The loader is a few lines of [autoconfig](https://support.mozilla.org/kb/customizing-firefox-using-autoconfig).
Input is produced inside the page's process with the browser's own `EventUtils`, the same
way Firefox's WebDriver does it, but without starting the remote agent.

## Troubleshooting

- `npx zen-browser-mcp doctor` checks each piece and tells you what to do.
- Bridge errors go to `$XDG_RUNTIME_DIR/zen-mcp.log` (or `$TMPDIR` on macOS).
- After installing, restart the browser once; the loader only runs at startup.

## Development

```sh
git clone https://github.com/efeaslansoyler/zen-browser-mcp && cd zen-browser-mcp
npm install && npm run build
ln -s "$PWD/browser" ~/.local/share/zen-mcp   # browser side straight from the repo
node dist/cli.js install                         # adds the loader to your browser
claude mcp add --scope user zen -- node "$PWD/src/server.ts"
node scripts/zenctl.ts reload                    # reload the bridge after changes, no restart
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for tests and live checks, and [docs/](docs/README.md) for architecture notes and the Gecko pitfalls we hit.

Run `npm test` for the MCP compatibility, wire-protocol, and island state tests. These
use an in-memory browser/DOM fixture; live Gecko behavior still needs a browser smoke test.

## License

[MIT](LICENSE)
