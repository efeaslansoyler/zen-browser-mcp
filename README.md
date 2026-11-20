# zen-browser-mcp

[English](README.md) · [Türkçe](README.tr.md) · [MIT License](LICENSE)

An independent project, not affiliated with or endorsed by the Zen Browser team or Mozilla.

Give Claude Code, Codex, or another MCP client access to your Zen or Firefox-based
browser. The agent can read pages, click and type in its own tabs, and work in a
tab you share. The island at the top of the browser shows what it is doing and
lets you approve, take over, or stop the work.

[![Demo of sharing page elements and recording a task in Zen](docs/media/demo.gif)](docs/media/demo.mp4)

> [!IMPORTANT]
> The bridge runs with browser privileges and can work with your signed-in
> accounts. Use it with clients you trust, and review what an agent asks to do.
> The project has tests and has not undergone a security audit.
> See [permissions and security](docs/permissions.md), and report vulnerabilities
> privately as described in [SECURITY.md](SECURITY.md).

## Install from source

You need Node.js 22 or newer, an MCP client, and a desktop browser installed in a
folder the installer can write to. The installer targets Linux and macOS. The
[compatibility matrix](docs/browser-compatibility.md) records tested Linux builds
of Zen, Firefox, LibreWolf, Floorp, and Waterfox. Flatpak and Snap installations
are unsupported.

```sh
git clone https://github.com/efeaslansoyler/zen-browser-mcp.git
cd zen-browser-mcp
npm ci
npm run build
node dist/cli.js install
```

The installer adds an autoconfig loader to each browser installation it finds. It may
request `sudo` for that step. Restart the browsers you want to use, then register the server with
your client. Run one of these commands from the checkout:

```sh
# Claude Code
claude mcp add --scope user zen -- node "$PWD/dist/cli.js"

# Codex
codex mcp add zen -- node "$PWD/dist/cli.js"
```

For another MCP client, add a local stdio server with command `node` and the
absolute path to `dist/cli.js` as its first argument. Check the setup with
`node dist/cli.js doctor`. If the installer cannot find your browser, pass
`--browser /path/to/install` with the folder containing `application.ini`.

In the default `together` mode, new MCP sessions use the most recently focused
user profile. To choose a default, run
`node dist/cli.js config browser Zen --profile Default`. One client can
override that choice with the server arguments `--browser` and `--profile`.
Run `node dist/cli.js doctor` to see the running instances and the selection.

When the selected browser is closed, a tool call can open it on demand on Linux
and macOS. With automatic selection and no matching browser, the server opens
the first browser it finds (Zen first). In `together` it uses the browser's default profile. Auto mode allows
startup, and ask mode prompts in MCP clients that support form elicitation.
Use `node dist/cli.js config launch allow|ask|deny` to set a preference,
or `config launch default` to follow the active permission template.
See [browser startup and permissions](docs/permissions.md#on-demand-browser-startup).

## Browser modes

| Mode | Profile | Window |
|---|---|---|
| `together` (default) | Your own profile | Visible |
| `agent` | Shared agent profile with persistent logins | Visible |
| `scratch` | Temporary profile for this MCP process | Visible |
| `autonomous` | Temporary profile for this MCP process | Headless |
| `autonomous-agent` | The same persistent profile as `agent` | Headless |

Set the default with `node dist/cli.js config browser-mode agent`. For one client,
pass `--browser-mode <mode>` in its MCP server arguments or set `ZEN_MCP_BROWSER_MODE`
in its server environment. Reconnect the client to apply a change. The browser
selector applies to every mode. The profile selector applies to `together`.

If the persistent profile is already open, both persistent modes reuse it in its
current mode. Use `agent` to sign in, then close that browser before starting
`autonomous-agent` for unattended work. The autonomous modes allow operations that
would ask on the island, deny system clipboard access and retain custom denials and
site rules. See [autonomous permissions](docs/permissions.md#autonomous-browser-modes).

`node dist/cli.js doctor` shows the agent profile location. To erase its logins and
site data, close the agent browser and run
`node dist/cli.js reset-agent-profile --browser <name|dir>`.

## Use it

- **Ask your agent to open a page.** Try “Open example.com and tell me what the
  page says.” The agent opens its own tab and the island shows its activity.
- **Work in a tab you already have open.** Right-click the tab and choose
  **Give to session…**, or approve the agent's request to use it. Choose
  **Take back from agent** when you want to revoke access.
- **Approve or stop.** Use the island to answer permission prompts and take over
  steps such as signing in. Click **Stop** to stop agent work.
- **Show the agent what you mean.** Right-click a page and choose
  **Show to agent…** to send an element with a note. Choose
  **Record steps for an agent…** to save a repeatable task as a recipe. See the
  [browser workflows guide](docs/browser-workflows.md) for delivery setup.

The agent can also inspect pages and accessibility, compare screenshots,
print PDFs, record short tab videos, and collect network and performance
diagnostics. HTTP rules apply to agent-opened tabs, and dedicated agent modes
include cookie and Web Storage tools. See [browser diagnostics](docs/browser-diagnostics.md)
for tool usage and limits.

## More help

- [Browser tool comparison](docs/feature-comparison.md) and a
  [Codex token benchmark](docs/browser-benchmark.md) with Kitsune and ZenPilot on the same Zen build
- [Documentation](docs/README.md) for configuration, workflows, and internals
- [Contributing](CONTRIBUTING.md) for development and live checks
- After updating the checkout, rerun `npm ci`, `npm run build`, and
  `node dist/cli.js install`. Restart the browser and reconnect the MCP client.
- Run `node dist/cli.js uninstall` to remove the browser bridge. Restart the
  browser and remove the server entry from your MCP client.
