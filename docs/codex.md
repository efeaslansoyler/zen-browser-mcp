# Codex integration

Use the Codex registration command in [installation](installation.md#connect-your-mcp-client).
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
- On Linux, a local `codex resume <uuid>` supplies the launch conversation ID. The watcher
  subscribes only while that process is present and the exact non-ephemeral conversation is
  loaded in the service. It uses `thread.name` for the menu title when available.
- A new window, the resume picker, `--last`, or a session name leaves ownership unresolved
  by the watcher. These conversations can appear through lifecycle hooks, which receive
  the conversation's exact ID from Codex.
- When the process exits or the conversation unloads, the watcher's subscription closes.
  The watcher exits after ten minutes without a Codex window.

## Hooks (fallback)

`zen-browser-mcp hooks install` (all supported clients) or
`zen-browser-mcp codex-hooks install` (Codex only) adds SessionStart, UserPromptSubmit and SessionEnd hooks to
`~/.codex/hooks.json` (other hooks are kept; the old file is backed up). SessionStart and
UserPromptSubmit start or refresh the per-conversation receiver (`codex-relay.ts`) when the
watcher lacks a subscription for the hook's exact `session_id`, including when it can reach
the service. The watcher leaves existing hook receivers in place. The hook receiver stops on
SessionEnd or after 24 idle hours. Codex asks the user to trust new hooks once in `/hooks`.

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
socket (`/run/user/<uid>/zen-mcp/<id>.sock`) or binding any Unix socket: Linux sandboxing with
seccomp and `NoNewPrivs`. The MCP tools still work, because Codex runs MCP servers outside
the command sandbox; only shell scripts (`zenctl`, live checks, relay tests) are affected.

Run those scripts from a full-access session or your own terminal. For a disposable
browser with an explicit `ZEN_MCP_SOCKET`, you can allow its exact socket path in
the active Codex [permission profile](https://learn.chatgpt.com/docs/permissions):

```toml
[permissions.<profile>.network.unix_sockets]
"/run/user/1000/zen-demo.sock" = "allow"
```

Keep the socket's private permissions. Development commands stay on the local socket.

Codex MCP processes may not inherit `XDG_RUNTIME_DIR`; `paths.ts` falls back to
`/run/user/<uid>`.

## Starting a visible browser from Codex

Codex starts MCP servers with a minimal environment (`HOME`, `PATH`, `USER`, `LANG` and a
few more), without `DISPLAY`, `WAYLAND_DISPLAY` or `XDG_RUNTIME_DIR`. Before starting a
visible browser on Linux, the launcher fills the missing variables from the systemd user
manager (`systemctl --user show-environment`), where desktop sessions import them. If none
is found, the call fails and names the fix: pass them with
`env_vars = ["DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR"]` in the server's
`[mcp_servers]` entry, or use a headless browser mode.

`codex exec` declines MCP elicitation without showing it, so with the `ask` launch rule the
browser is not started there; allow launching with `config launch allow`.
