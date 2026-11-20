# Browser automation alternatives

zen-browser-mcp is an MCP bridge for working with an agent in an open Zen or
Firefox-based window. Its browser UI covers approval, tab sharing and take-back,
element picks sent to a conversation, and recording tasks as recipes. The
autoconfig loader requires write access to the browser installation and runs the
bridge with browser privileges. See [browser workflows](browser-workflows.md)
and [permissions and security](permissions.md).

## When to use each tool

| Tool | Browser and connection | Where it fits |
|---|---|---|
| **zen-browser-mcp** | Autoconfig loader and a local Unix socket in the running Gecko browser | Work alongside an agent in the window you use. Grant a live tab to one or more MCP sessions, approve actions in the island, or send an element or recipe to a conversation. |
| [Kitsune](https://github.com/junyeong-nero/kitsune) | WebExtension and local bridge for Firefox, Zen and LibreWolf | Work in the existing browser with background agent tabs and handoff. By default, agents can read user tabs and need handoff to change them. Kitsune offers a compact Python tool surface and a direct tool mode with scripting disabled. |
| [ZenPilot](https://github.com/beSaif/zenpilot) | WebDriver BiDi in Zen, with a fresh profile or one you choose | Use an allowlisted Zen profile with page-level Stop, HAR capture and opt-in request mocking. Zen may need to restart with remote control enabled. One agent controls Zen at a time. |
| [spaxe-dev/zen-mcp](https://github.com/spaxe-dev/zen-mcp) | Launches its own Zen window through Marionette, with a dedicated profile by default | Organize research in native Spaces, folders, pins and split view. It offers one consent decision per server session and a Pause control. The optional normal profile requires closing the other Zen instance first. |
| [sh6drack/zen-mcp](https://github.com/sh6drack/zen-mcp) | WebDriver BiDi over a WebSocket to Zen started with `--remote-debugging-port` | Drive Zen from an MCP client with 20 tools for tabs, page snapshots, forms, keys and page JavaScript. Zen has to run with remote debugging enabled. Its documentation lists file upload and drag and drop as unsupported. |
| [ZenLink MCP](https://github.com/JayQuan-McCleary/ZenLink-MCP) | Python MCP server with the ZenLink WebExtension and a local bridge process | A broad tool surface (75+ tools) for parallel multi-tab work: tab pools and tags, saved and restored sessions, request interception, cookies and storage, Readability and Markdown extraction, and scripted batches. |
| [Claude for Firefox](https://github.com/NetVar1337/claude-for-firefox) | Community WebExtension with native messaging and a Firefox MCP server for Claude Code | Bring Claude's browser sidebar and Claude integrations to Firefox. Its documented setup uses a temporary add-on and Claude Code's authenticated session. |
| [Vercel Agent Browser](https://github.com/vercel-labs/agent-browser#how-it-works) | CLI and stdio MCP. Chrome for Testing by default, with CDP attachment to a running Chrome | Automate web tasks through refs, selectors, batch actions and diagnostics. Choose it when the workflow is designed for a managed browser or an existing Chrome session. |
| [Firefox DevTools MCP](https://firefox-source-docs.mozilla.org/ai-agent-tools/firefox-devtools-mcp.html) | Mozilla's BiDi and WebDriver Classic bridge, with a temporary Firefox profile by default | Test Firefox builds and debug browser or site behavior with developer tools, profiling and browser logs. |
| [MCP for Firefox](https://addons.mozilla.org/en-US/firefox/addon/mcp-for-firefox/) | Firefox extension and local companion MCP server | Use signed-in Firefox with a toolbar pairing flow, claimed tabs and a Stop control. |

These descriptions are based on the linked project documentation as reviewed on
November 20, 2026. Shared features cover different scopes. For example, a
connection approval, permission to read a tab, and consent to submit a form
are separate decisions.

## What sharing a tab means in zen-browser-mcp

- **Read access.** User tabs appear as metadata. The agent needs access from
  `request_tab` or **Give to session…** before it can read the page. A tab
  can have multiple MCP session members, with queued turns and a way to
  revoke access.
- **User participation.** The island shows active work and approval cards.
  The agent can hand off sign-in or another step, and the user can send an
  element back to a conversation or save steps as a recipe.
- **Gecko diagnostics.** The bridge supports viewport diffs across deploys,
  full-page screenshots, redacted HAR, local Web Vitals, React and axe
  inspection, and download tracking. See [browser diagnostics](browser-diagnostics.md)
  and the [tested browser builds](browser-compatibility.md).

## Agent-browser capabilities

| Capability | zen-browser-mcp |
|---|---|
| Reload | `navigate` supports reload, cache bypass and an optional page read. |
| PDF | `save_pdf` prints through Gecko, including headless profiles. |
| Video | `record` captures a short silent tab video with ffmpeg. |
| Cookies and storage | `cookies` and `storage` work in dedicated agent profiles. |
| Request mocking and offline | `network_control` operates on agent-opened tabs with Gecko's HTTP hooks. |
| Trace/profiler and pushstate | Outside the scope of these tools. |

See [browser diagnostics](browser-diagnostics.md) for arguments and limits.

## Token benchmark

See [the Codex and Zen benchmark](browser-benchmark.md) for measured usage on
common browser tasks in isolated profiles. The measurements do not cover
the sharing and approval workflows described above.
