# Design decisions

Short records of choices that shape the project, newest last. Each says what we chose, why,
and what we gave up. Add a record when a choice would surprise a new contributor.

## Work in the user's own window, no separate browser or window

Agents work in background tabs of the window you already use, with your logins. A separate
window or browser would defeat the point: if you have to switch to another window anyway,
any automation browser would do. Cost: agent tabs share your profile, so permissions, site
rules and the island matter more.

## Mark agent tabs with a line, not a container

Agent tabs get a colored line that imitates the container indicator. A real container would
separate cookies, so your sessions wouldn't be visible to the agent.

## Real input instead of WebDriver or synthetic DOM events

Input is generated in the page process with the browser's own `EventUtils`, so events are
trusted and `navigator.webdriver` stays `false`. Existing Firefox alternatives either dispatch
synthetic DOM events (`isTrusted: false`) or run under WebDriver. This is why the project
exists. Cost: a privileged autoconfig loader.

## Tool names compatible with Claude in Chrome

Agents already know `tabs_context_mcp`, `computer`, `read_page`, `find`… Replies stay short,
single-line JSON, and the tab list isn't repeated in every reply. On the same form task an
early measurement used about 4,250 tokens with zen-mcp and 5,650 with Claude in Chrome.

## The island

A pill at the top center of the window shows what the agent does, with Stop/Resume and
everything the agent asks of you. Compact mode hides the tab strip, so the tab line alone
wasn't enough. The island is hidden when idle, never brings a tab to the front, uses a dark
tone of the theme color (the primary color can be too light for white text) and sends a
desktop notification when the window isn't focused.

## One site rule list instead of allow/deny/sensitive lists

A single `sites` map with `ask` and `block`, plus a global `auto`/`ask` mode. No preset
sensitive list: what is sensitive is the user's call. `block` wins and covers subdomains.

## Generic extension UI instead of per-extension APIs

Agents open an extension's real toolbar popup and use it with the same input tools. No
extension-specific rules or background API access; restoring temporary settings is the
agent's responsibility.

## Clipboard always asks

Every clipboard read, write, copy or paste asks in the island, even in auto mode and inside a
batch; approvals are never remembered. The clipboard is shared with every other application.

## MCP over CLI + skill

We built a CLI with a persistent broker and a skill and measured both against MCP. Transport:
16 calls took 322 ms through MCP and 785 ms through the CLI with identical text. A pilot with
Codex and Claude (3 tasks × 2 paths) succeeded everywhere; the CLI used 10–15 % more tokens
(within noise) and was clearly slower. MCP stayed the only path.

## Rules agents must see go in the server instructions

Clients load tool descriptions lazily, so a rule written only in a tool description (such as
"check userTabs before opening a tab") is read after the agent has decided what to do. Rules
that choose between tools live in the server `instructions`, which every session sees at
start. Keep them short: they cost context in every session.

## Downloads report through an events file

Waiting on a download blocks the agent. Pushing completion through channels would only work
for Claude started with the development channels flag. A per-download JSON-lines file works
for any agent with a shell: agents that can monitor files keep working, others call `wait`.
The bridge deletes the file, not the agent.

## Codex conversations come from the Codex service, not hooks

Hooks fire at the first message, and `/quit` doesn't end a Codex session (it detaches; work
continues in the background service), so SessionEnd never ran and MCP processes piled up.
The watcher reads the service directly: conversations appear when a window opens, carry
their names, and disappear when no window shows them. Detached background conversations are
hidden, since the user isn't looking at them. Hooks remain as a fallback because the
service protocol is experimental.
