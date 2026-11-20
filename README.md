# zen-browser-mcp

Let Claude Code, Codex and other MCP agents work in the browser you already use: your tabs,
your logins, real input, and an island at the top of the window that shows what they do.

[![CI](https://github.com/efeaslansoyler/zen-browser-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/efeaslansoyler/zen-browser-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/zen-browser-mcp)](https://www.npmjs.com/package/zen-browser-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[English](README.md) · [Türkçe](README.tr.md)

[![Sharing page elements with an agent and recording a task in Zen](docs/media/demo.gif)](docs/media/demo.mp4)

## Why

- **Your own browser.** Agents open their own background tabs next to yours, or work in a tab
  you share. No separate automation browser, no remote debugging port.
- **You stay in control.** The island shows each agent's work. By default, form submissions,
  password fields, uploads and page JavaScript wait for your approval, and **Stop** or **Take back**
  ends an agent's work at once.
- **The parts only you should do stay yours.** Agents hand you logins, 2FA and payments and
  continue when you press **Done**, so credentials never pass through them.
- **Point instead of describing.** Pick elements on any page and send them to a session with
  a note. On a local dev server of a supported framework, the pick names the source file.
- **Show a task once.** Record it in the browser; agents reuse it as a recipe.
- **Several agents, several browsers.** Sessions share tabs and take turns. Works with Zen,
  Firefox, LibreWolf, Floorp and Waterfox.

## Quick start

You need Node.js 22+, Linux or macOS, and a Zen or Firefox-based browser installed in a
folder you can write to.

```sh
npm install -g zen-browser-mcp
zen-browser-mcp install
```

Restart the browser, then connect your client:

```sh
claude mcp add --scope user zen -- zen-browser-mcp   # Claude Code
codex mcp add zen -- zen-browser-mcp                 # Codex
```

Ask your agent: *"Open example.com and tell me what the page says."* An agent tab opens and
the island shows the work. To let it use a tab you already have open, right-click the tab
and choose **Give to session…**, or approve the agent's request.

[Installation](docs/installation.md) covers other clients, `doctor`, updating, uninstalling
and running from source.

## How it works

```
MCP client ──stdio──▶ zen-browser-mcp ──local socket──▶ bridge inside the browser ──▶ pages
```

`install` adds a small autoconfig loader to the browser. It starts a bridge in the browser
that listens on a private Unix socket; the MCP server your client runs talks to it. Input
reaches pages as trusted events from the page's own process, so agents can work in background
tabs while you use the browser.

## Security

The bridge runs with browser privileges and can act with your signed-in accounts. Use it with
clients you trust and read what an agent asks before you approve it. The project has tests
but no security audit. [Permissions and security](docs/permissions.md) explains the modes,
site rules and trust boundary; report vulnerabilities privately as described in
[SECURITY.md](SECURITY.md).

## Documentation

| Guide | What it covers |
|---|---|
| [Installation](docs/installation.md) | Requirements, clients, hooks and the skill, updating, uninstalling |
| [Browser workflows](docs/browser-workflows.md) | Tabs and the island, sending elements, recipes, clipboard, extensions, downloads |
| [Permissions and security](docs/permissions.md) | Approval modes, custom rules, site lists |
| [Browsers, profiles and modes](docs/browsers.md) | Choosing a browser, agent and headless profiles, starting the browser on demand |
| [Browser diagnostics](docs/browser-diagnostics.md) | Read diffs, screenshot baselines, network and HAR, Web Vitals, PDF and video |
| [All documentation](docs/README.md) | Codex integration, compatibility, architecture, comparisons |

## Contributing

Bug reports, ideas and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md);
changes are listed in the [changelog](CHANGELOG.md).

## License

[MIT](LICENSE). An independent project, not affiliated with or endorsed by the Zen Browser
team or Mozilla.
