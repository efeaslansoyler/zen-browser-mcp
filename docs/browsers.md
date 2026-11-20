# Browsers, profiles and modes

## Which browser a session uses

Every running browser with the loader has its own bridge. A new MCP session picks one in
this order:

1. The client's server arguments `--browser <name|dir>` and `--profile <name|dir>`, or the
   environment variables `ZEN_MCP_BROWSER` and `ZEN_MCP_PROFILE` in that client's server
   entry.
2. The `browser` and `profile` keys in `~/.config/zen-mcp/config.json`.
3. Otherwise the only running browser, or the one you focused last.

```sh
node dist/cli.js config browser Zen --profile Default   # set a default
node dist/cli.js config browser clear                   # back to automatic
node dist/cli.js doctor                                 # running browsers and the selection
```

A browser is an application name or the installation folder containing `application.ini`.
A profile is a registered profile name or an absolute profile directory; for a running
browser without a registered name, the directory's basename matches too. The profile
selector applies in `together` mode. Reconnect the client to apply a change to an existing
session. A session stays with its browser and tells the agent if that browser was replaced.

`ZEN_MCP_SOCKET` pins a session to one socket and turns off discovery and startup.

## Browser modes

| Mode | Profile | Window |
|---|---|---|
| `together` (default) | Your own profile | Visible |
| `agent` | A persistent profile only agents use, with its own logins | Visible |
| `scratch` | A temporary profile for this MCP process | Visible |
| `autonomous` | A temporary profile for this MCP process | Headless |
| `autonomous-agent` | The same persistent profile as `agent` | Headless |

Set the default with `node dist/cli.js config browser-mode agent`. For one client, pass
`--browser-mode <mode>` in its server arguments or set `ZEN_MCP_BROWSER_MODE` in its server
environment, then reconnect it.

Use `agent` to sign in to the sites agents need, then close that browser and use
`autonomous-agent` for unattended work with the same logins. If the persistent profile is
already open, both modes reuse it as it is. `doctor` shows where the agent profile lives; to
erase its logins and site data, close it and run:

```sh
node dist/cli.js reset-agent-profile --browser <name|dir>
```

Temporary profiles are deleted when their browser exits. A browser the MCP server started
for a dedicated profile quits about two minutes after its last session leaves; `together`
browsers and ones you started yourself stay open.

In the autonomous modes nobody is at the screen, so what would ask on the island is allowed,
the system clipboard is denied, and custom denials and site rules still apply. See
[autonomous browser modes](permissions.md#autonomous-browser-modes).

## Starting the browser on demand

On Linux and macOS, a tool call can open the selected browser when it isn't running. With
automatic selection and no running browser, it opens the first installed one it finds (Zen
first) with its default profile. The browser needs the loader installed.

Whether it may do so is the `browser.launch` permission: allowed in auto mode, asked in ask
mode, and configurable in custom mode. The question appears in your MCP client (form
elicitation): **Open** allows this launch, **Always open** saves the preference. A client
that can't show the question gets a message saying how to open or allow the browser.

```sh
node dist/cli.js config launch          # show the preference and the effective rule
node dist/cli.js config launch allow    # open on demand
node dist/cli.js config launch ask      # ask first
node dist/cli.js config launch deny     # never open
node dist/cli.js config launch default  # follow the permission mode
```

An explicit preference applies in every mode, but a custom `deny` always wins. Codex starts
MCP servers without display variables; see
[starting a visible browser from Codex](codex.md#starting-a-visible-browser-from-codex).
