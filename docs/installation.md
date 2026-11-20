# Installation

## Requirements

- Node.js 22 or newer.
- An MCP client: Claude Code, Codex, OpenCode or any client that runs a local stdio server.
- Linux or macOS, and a Gecko browser installed in a folder you can write to (with `sudo` if
  needed). The [compatibility matrix](browser-compatibility.md) lists the tested Linux builds
  of Zen, Firefox, Firefox ESR, LibreWolf, Floorp and Waterfox. Flatpak and Snap installations
  are read-only and not supported.

## Install the bridge

```sh
git clone https://github.com/efeaslansoyler/zen-browser-mcp.git
cd zen-browser-mcp
npm ci
npm run build
node dist/cli.js install
```

`install` adds a small [autoconfig](https://support.mozilla.org/kb/customizing-firefox-using-autoconfig)
loader to every supported browser installation it finds and copies the bridge files to
`~/.local/share/zen-mcp`. It asks for `sudo` when an installation is not writable. If it
doesn't find your browser, pass the folder that contains `application.ini`:

```sh
node dist/cli.js install --browser /path/to/browser
```

Restart the browser once so the loader runs.

## Connect your MCP client

Run these from the checkout, so `$PWD` is its path:

```sh
# Claude Code
claude mcp add --scope user zen -- node "$PWD/dist/cli.js"

# Codex
codex mcp add zen -- node "$PWD/dist/cli.js"
```

For another client, add a local stdio server with the command `node` and the absolute path
of `dist/cli.js` as its only argument.

Optional extras:

- `node dist/cli.js skill install` installs the agent guide for Claude Code and Codex: which
  tool to use when, from choosing your open tab to handing over logins.
- `node dist/cli.js hooks install` lets picks and recipes you send from the browser reach the
  agent with your next message (Claude Code, Codex, Antigravity CLI) or at once (OpenCode).
  See [sending to an agent](browser-workflows.md#send-an-element-or-a-recipe).

## Check the setup

```sh
node dist/cli.js doctor
```

`doctor` shows the installed loaders, the running browsers and which one new sessions use,
the permission mode, and what is missing. [Contributing](../CONTRIBUTING.md#debugging) lists
where to look when something still doesn't work.

## Update

```sh
git pull
npm ci
npm run build
node dist/cli.js install
```

Then restart the browser and reconnect your MCP client.

## Uninstall

```sh
node dist/cli.js uninstall
```

This removes the loader and the bridge files. Restart the browser and remove the `zen` server
from your MCP client. Settings in `~/.config/zen-mcp` and the activity log and recipes in
`~/.local/state/zen-mcp` stay until you delete them.
