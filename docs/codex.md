# Codex integration

Use the Codex registration command in the [README](../README.md#install-from-source).
This page covers how Zen MCP associates a tool call with a conversation and sends
element picks back to Codex.

## Conversation identity

An MCP process can serve several conversations. When Codex provides a valid
conversation UUID in `_meta.threadId` or `_meta["x-codex-turn-metadata"].thread_id`,
`server.ts` uses `codex:<thread>` for tab access and pick delivery. Calls without
usable metadata use the generic session fallback.

## Which conversations are shown

`src/codex-watch.ts` is a single background process (started by a Codex MCP server or a hook)
that talks to the Codex service:

- Socket: `~/.codex/app-server-control/app-server-control.sock`, WebSocket JSON-RPC
  (`initialize`, then read-only `thread/loaded/list` and `thread/read`). The protocol is
  marked experimental by Codex.
- A conversation exists as soon as a Codex window opens, before the first message, and its
  name (`thread.name`) arrives after the first reply.
- `/quit` only detaches the window; the conversation keeps running in the service ("Any
  running work continues"). Detached background conversations are hidden on purpose.
- If the service can't be reached (the protocol changes, or an older Codex), hooks take over
  and a conversation appears after its first message.
- The service doesn't say which conversation a window shows, so the watcher looks at
  `codex` window processes: `codex resume <id>` is exact; otherwise each window gets the
  newest conversation created or loaded after the window started. Ephemeral helper
  conversations (title generation) are skipped. Two windows opening old conversations with
  the `resume` picker at the same time can be mismatched.
- For every shown conversation the watcher holds a subscription
  `{session: "codex:<thread>", title: name}`; when it disappears the subscription closes and
  the menus drop it. The watcher exits after ten minutes without a Codex window.

## Hooks (fallback)

`node dist/cli.js hooks install` (all supported clients) or
`node dist/cli.js codex-hooks install` (Codex only) adds SessionStart, UserPromptSubmit and SessionEnd hooks to
`~/.codex/hooks.json` (other hooks are kept; the old file is backed up). Each hook first tries
to start the watcher. Only if the Codex service can't be reached does it start the older
per-conversation receiver (`codex-relay.ts`), which connects after the first message and stops
on SessionEnd (or after 24 idle hours). Codex asks the user to trust new hooks once in
`/hooks`.

The UserPromptSubmit hook also adds what the user sent from the browser and couldn't be queued
to their next message (see [architecture.md](architecture.md#sending-to-a-session-browser--agent)).

`connect_session` is a manual last resort: the agent reads `CODEX_THREAD_ID` from its command
environment and binds picks to it.

## Pick delivery

`delivery.ts` runs `codex queue --thread <id> --message <text>` with `execFile` (no shell).
The user's note and the untrusted page context are kept apart in the message. Success means
Codex accepted the queued message, not that the agent read it.

## Socket permissions in Codex's sandbox

In Codex's default sandbox, shell commands may get `EPERM` when connecting to the bridge
socket (`/run/user/<uid>/zen-mcp.sock`) or binding any Unix socket: Linux sandboxing with
seccomp and `NoNewPrivs`. The MCP tools still work, because Codex runs MCP servers outside
the command sandbox; only shell scripts (`zenctl`, live checks, relay tests) are affected.

Run those scripts from a full-access session or your own terminal, or allow the single socket
in the active Codex [permission profile](https://learn.chatgpt.com/docs/permissions):

```toml
[permissions.<profile>.network.unix_sockets]
"/run/user/1000/zen-mcp.sock" = "allow"
```

Don't loosen the socket's mode or move it, and don't expose development commands through MCP
to get around the sandbox.

Codex MCP processes may not inherit `XDG_RUNTIME_DIR`; `paths.ts` falls back to
`/run/user/<uid>`.
