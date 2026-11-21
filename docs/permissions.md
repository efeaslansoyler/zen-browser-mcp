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
`zen-browser-mcp config mode <auto|ask|custom>`.

| Mode | Behavior |
|---|---|
| `auto` (default) | Allows ordinary navigation and input. Asks for recognized form submissions and secret fields, uploads, arbitrary page JavaScript, clipboard use, HAR start/attach, network control, user-tab access, and other protected actions. |
| `ask` | Also asks before navigation, clicks, typing and similar page actions. Read-only operations and communication with the user remain available. |
| `custom` | Uses the base mode and per-operation rules in `permissions.jsonc`. |

Form protections use the target's DOM and the kind of action. A custom
JavaScript button outside a form may send or buy something without looking
like form submission. Use `ask` or a site rule if the distinction matters.
Approvals in a batch are scoped to the current document, site, permissions
and tab access. An approval covers only the steps the prompt listed; every
other step is checked when it runs, against the focus and URL it has then.
The bridge stops on a denial.

## Browser pages and local files

Agents work only on web pages: `http`, `https`, `data` and `about:blank`. Browser-internal pages
(`about:` pages such as settings, `chrome:`, `resource:`, extension pages opened in a tab and
anything else with browser privileges) are closed to them, even in a tab you give them: they
can't open, read or run code there.

Opening a file from your computer (`file:` URLs or a plain path) is the separate operation
`navigate.local_file`, because the agent can then read the file and send it elsewhere. It asks
in both templates, can be set in custom rules, and is denied in the autonomous modes unless a
custom rule allows it.

## Custom rules

```sh
zen-browser-mcp config permissions init
# Edit ~/.config/zen-mcp/permissions.jsonc before enabling it
zen-browser-mcp config mode custom
zen-browser-mcp config permissions
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
Local files stay closed too: `navigate.local_file` and `file_upload` are
denied unless a custom rule allows them.
`ask_user`, `hand_to_user` and `show_me` immediately return
`no user is present (autonomous browser mode)`.

`browser.launch` is decided by the MCP server and can still ask in the MCP client.
If a persistent agent profile is already open, the server reuses the bridge and
its existing permission behavior. The `browserMode` field in `tabs_context_mcp`
reports the running mode.

## PDF, video, site data and network rules

- `save_pdf` and `record.start` / `record.stop` follow the same allow rules as
  screenshots in both templates. Both require access to the tab.
- `cookies.list` and `storage.get` allow in both templates. Cookie writes and
  deletion and Web Storage writes, removals and clears ask in the ask template
  and allow in auto. These tools require an agent browser mode. Cookie calls
  check the tab and the requested URL against the site rules. Web Storage
  applies to the tab's top-level origin. Values are untrusted page data.
- All four `network_control` actions ask in both templates and work only on
  tabs opened by an agent. A tab the user gave to a session is ineligible.
  Rules affect the whole agent tab if sessions share it. Closing or taking back
  the tab, ending the rule owner's session, the island Stop control, and bridge
  reload clear those rules.

## Site rules

The blocklist allows sites except those listed. The allowlist allows only
listed sites. Both lists are stored and the selected mode applies. A domain
entry covers subdomains.

```sh
zen-browser-mcp config site block example.com
zen-browser-mcp config site unblock example.com
zen-browser-mcp config site allow localhost example.org
zen-browser-mcp config site mode allowlist
zen-browser-mcp config site list
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

## Browser startup

The `browser.launch` rule decides whether a tool call may open a browser that isn't running:
allowed in auto mode, asked in the MCP client in ask mode, and configurable in custom mode.
A `config launch` preference applies in every mode, but a custom `deny` always wins. See
[starting the browser on demand](browsers.md#starting-the-browser-on-demand).
