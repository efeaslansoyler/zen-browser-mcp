# zen-browser-mcp

[English](README.md) · [Türkçe](README.tr.md) · [MIT License](LICENSE)

Give Claude Code, Codex, or another MCP client access to your Zen or Firefox-based
browser. The agent can read pages, click and type in its own tabs, and work in a
tab you share. The island at the top of the browser shows what it is doing and
lets you approve, take over, or stop the work.

[![Demo of sharing page elements and recording a task in Zen](docs/media/demo.gif)](docs/media/demo.mp4)

> [!IMPORTANT]
> The bridge runs with browser privileges and can work with your signed-in
> accounts. Use it with clients you trust, and review what an agent asks to do.
> The project has tests and has not undergone a security audit.
> See [permissions and security](docs/permissions.md).

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

If several browsers or profiles are running, new MCP sessions use the most
recently focused one. To choose a default, run
`node dist/cli.js config browser Zen --profile Default`. One client can
override that choice with the server arguments `--browser` and `--profile`.
Run `node dist/cli.js doctor` to see the running instances and the selection.

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

The agent can also inspect pages and accessibility, compare screenshots, and
collect network and performance diagnostics. See [browser diagnostics](docs/browser-diagnostics-plan.md)
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
