# Installation

## Requirements

- Node.js 22 or newer.
- An MCP client: Claude Code, Codex, OpenCode or any client that runs a local stdio server.
- Linux, or macOS **(untested: use it at your own risk)**, and a Gecko browser installed in a
  folder you can write to (with `sudo` if
  needed). The [compatibility matrix](browser-compatibility.md) lists the tested Linux builds
  of Zen, Firefox, Firefox ESR, LibreWolf, Floorp and Waterfox. Flatpak and Snap installations
  are read-only and not supported.

## Install

```sh
npm install -g zen-browser-mcp
zen-browser-mcp install
```

If npm can't write its global folder, set a user prefix as in
[npm's guide](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally)
rather than running npm as root.

`zen-browser-mcp install` adds a small
[autoconfig](https://support.mozilla.org/kb/customizing-firefox-using-autoconfig) loader to
every supported browser installation it finds and copies the bridge files to
`~/.local/share/zen-mcp`. It asks for `sudo` when an installation is not writable. If it
doesn't find your browser, pass the folder that contains `application.ini`:

```sh
zen-browser-mcp install --browser /path/to/browser
```

Restart the browser once so the loader runs.

Use a global install rather than `npx` for anything that stays: MCP clients and hooks run the
command again and again, and npx may keep an old version or clear the folder they point to.
`npx zen-browser-mcp doctor` is fine for a quick look.

## Connect your MCP client

```sh
claude mcp add --scope user zen -- zen-browser-mcp   # Claude Code
codex mcp add zen -- zen-browser-mcp                 # Codex
```

For another client, add a local stdio server whose command is `zen-browser-mcp`, without
arguments.

Optional extras:

- `zen-browser-mcp skill install` installs the agent guide for Claude Code and Codex: which
  tool to use when, from choosing your open tab to handing over logins.
- `zen-browser-mcp hooks install` lets picks and recipes you send from the browser reach the
  agent with your next message (Claude Code, Codex, Antigravity CLI) or at once (OpenCode).
  See [sending to an agent](browser-workflows.md#send-an-element-or-a-recipe). The hooks
  remember where Node and the package live, so run it again after you switch Node versions.

## Check the setup

```sh
zen-browser-mcp doctor
```

`doctor` shows the installed loaders, the running browsers and which one new sessions use,
the permission mode, and what is missing. [Contributing](../CONTRIBUTING.md#debugging) lists
where to look when something still doesn't work.

## Update

```sh
npm install -g zen-browser-mcp@latest
```

Then reconnect your MCP client. When it starts the server, the server copies the new bridge
files and reloads the bridge in the running browser; no browser restart is needed. It also
updates an installed skill, which new agent sessions then read. A skill that a newer version
installed stays. A skill you edited is left alone, and `doctor` says so; `zen-browser-mcp skill install` replaces it.

## Uninstall

```sh
zen-browser-mcp hooks uninstall     # if you installed hooks
zen-browser-mcp skill uninstall     # if you installed the skill
zen-browser-mcp uninstall
npm uninstall -g zen-browser-mcp
```

`uninstall` removes the loader and the bridge files. Restart the browser and remove the `zen`
server from your MCP client. Settings in `~/.config/zen-mcp` and the activity log and recipes
in `~/.local/state/zen-mcp` stay until you delete them.

## From source

To run your own checkout, for example to try a change:

```sh
git clone https://github.com/efeaslansoyler/zen-browser-mcp.git
cd zen-browser-mcp
npm ci
npm run build
npm link                      # makes the zen-browser-mcp command run this checkout
zen-browser-mcp install
```

To go back to the published version, run `npm install -g zen-browser-mcp@latest`; unlinking
alone leaves no command behind. [Contributing](../CONTRIBUTING.md) covers
the development loop.
