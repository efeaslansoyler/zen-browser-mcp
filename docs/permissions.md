# Permissions and security

The bridge runs privileged code inside the browser through autoconfig. It uses
a local Unix socket with mode `0600`, without a network listener. Programs
running as the same OS user can connect. This design assumes you trust local
processes that can access the browser profile. The project has tests and has
not undergone a security audit.

Agents can work with signed-in accounts in their tabs or tabs you grant to
them. Page text, network responses, clipboard contents and extension UI can
contain instructions aimed at the agent. Review approval prompts, use
**Stop** or **Take back from agent** when needed, and restrict sensitive sites.
Use a separate browser profile if you need a separate set of accounts and
extensions. [Clean tabs](browser-workflows.md#tabs-and-the-island) separate site
sessions within one profile.

## Permission modes

Change mode from the island, **Agent settings** in the tab menu, or
`node dist/cli.js config mode <auto|ask|custom>` from the built checkout.

| Mode | Behavior |
|---|---|
| `auto` (default) | Allows ordinary navigation and input. Asks for recognized form submissions and secret fields, uploads, arbitrary page JavaScript, clipboard use, HAR start/attach, user-tab access, and other protected actions. |
| `ask` | Also asks before navigation, clicks, typing and similar page actions. Read-only operations and communication with the user remain available. |
| `custom` | Uses the base mode and per-operation rules in `permissions.jsonc`. |

Form protections use the target's DOM and the kind of action. A custom
JavaScript button outside a form may send or buy something without looking
like form submission. Use `ask` or a site rule if the distinction matters.
Approvals in a batch are scoped to the current document, site, permissions
and tab access. The bridge checks each step and stops on a denial.

## Custom rules

```sh
node dist/cli.js config permissions init
# Edit ~/.config/zen-mcp/permissions.jsonc before enabling it
node dist/cli.js config mode custom
node dist/cli.js config permissions
```

Use `init ask` to generate rules from the ask template. The file accepts
`"allow"`, `"ask"`, or `"deny"` for each operation. Omitted rules inherit from
the selected base. An invalid file fails closed. A custom allow rule can
remove consent for a protected action such as clipboard access.

## Autonomous browser modes

When the MCP launcher starts the bridge in `autonomous` or `autonomous-agent`,
every bridge rule that resolves to `ask` becomes `allow`. This applies to
the built-in templates and custom rules, including JavaScript and recognized
form submission. Custom denials and site rules keep their effect. The system
clipboard is always denied, including clipboard shortcuts routed through it.
`ask_user`, `hand_to_user` and `show_me` immediately return
`no user is present (autonomous browser mode)`.

`browser.launch` is decided by the MCP server and can still ask in the MCP client.
If a persistent agent profile is already open, the server reuses the bridge and
its existing permission behavior. The `browserMode` field in `tabs_context_mcp`
reports the running mode.

## Site rules

The blocklist allows sites except those listed. The allowlist allows only
listed sites. Both lists are stored and the selected mode applies. A domain
entry covers subdomains.

```sh
node dist/cli.js config site block example.com
node dist/cli.js config site unblock example.com
node dist/cli.js config site allow localhost example.org
node dist/cli.js config site mode allowlist
node dist/cli.js config site list
```

Blocked tabs expose only their IDs to agents. A disallowed iframe can prevent
access to the whole page. During an agent call the blocklist can cancel
requests to blocked hosts. In allowlist mode the network check applies to
document and frame loads, preserving other resources such as CDNs. Site rules
govern agent calls, while the user's own browsing follows the browser's normal
rules.

Settings live in the XDG config directory, typically
`~/.config/zen-mcp/config.json`. The activity log is under the XDG state
directory, typically `~/.local/state/zen-mcp/activity.jsonl`. Use **Agent history**
in the tab menu to review activity. Uninstalling the bridge keeps settings and
state. See [architecture](architecture.md#permissions) for enforcement details.

## Browser and profile selection

The optional `browser` and `profile` keys in `config.json` choose the browser
for new MCP sessions. Use an application name or the installation directory
containing `application.ini`. Use a registered profile name or an absolute
profile directory. The profile selector applies in `together` mode. For already-running instances without a registered profile
name, the directory's basename also matches. Omit the profile to start the
browser with its own default. Permission mode and site rules apply across the
installed bridges.

```sh
node dist/cli.js config browser Zen --profile Default
node dist/cli.js config
node dist/cli.js doctor
node dist/cli.js config browser clear
```

To override the config for one MCP client, append `--browser <name|dir>` or
`--profile <name|dir>` to its server arguments, or set `ZEN_MCP_BROWSER` and
`ZEN_MCP_PROFILE` in that client's server environment. Reconnect the client to
apply a change to an existing session.

## On-demand browser startup

On Linux and macOS, a tool call can open a visible browser window if the
selected browser or profile is closed. With automatic selection and no live
bridge, it opens the first installed browser found (Zen first) with that
browser's default profile. Install the bridge loader in the browser you want
to use. A server pinned with `ZEN_MCP_SOCKET` only connects to that socket.

The `browser.launch` rule is `allow` in auto mode, `ask` in ask mode and
configurable in `permissions.jsonc` in custom mode. An explicit launch setting
applies across modes, and a custom `deny` always wins.

```sh
node dist/cli.js config launch         # Show the preference and effective rule
node dist/cli.js config launch allow   # Open on demand
node dist/cli.js config launch ask     # Ask before opening
node dist/cli.js config launch deny    # Keep launch disabled
node dist/cli.js config launch default # Follow the active template
```

The launch prompt appears in the MCP client through form elicitation.
**Open** approves this launch. **Always open (don't ask again)** saves an
allow preference in `config.json`. If the MCP client cannot show the
prompt, open the browser yourself or set `config launch allow`.
