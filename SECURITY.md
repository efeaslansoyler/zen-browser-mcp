# Security policy

## Supported versions

Only the latest release gets security fixes. Before 1.0.0 a fix ships as the next patch or
minor version (see [docs/releasing.md](docs/releasing.md)).

## Reporting a vulnerability

Report privately through GitHub:
[Security → Report a vulnerability](https://github.com/efeaslansoyler/zen-browser-mcp/security/advisories/new).
Don't open a public issue, pull request or discussion for it.

Include the version (`node dist/cli.js --version`), the browser and its version, the
permission mode, and the steps or page that trigger it. A minimal local HTML page is the most
useful reproduction. Leave out real cookies, tokens and page contents from your accounts.

This is a one-maintainer project: expect an acknowledgement within a week. Once a fix is
released, the advisory is published with credit, unless you prefer otherwise.

## What counts

The bridge runs with browser privileges, so these are in scope:

- An agent doing something the permission template, site rules, tab access or the island's
  Stop should have refused or asked about.
- Page content, network responses, extension UI or clipboard text that makes the bridge
  (not the model) act, or that passes as trusted text in a tool result.
- Another OS user, a web page or a remote host reaching the bridge socket or its files.
- Secrets or page data written where [docs/permissions.md](docs/permissions.md) says they are
  not, such as logs, task notes or HAR files.

Out of scope, by design (see [permissions and security](docs/permissions.md)):

- Programs running as your own OS user connecting to the socket.
- An agent doing what your current rules allow, including following instructions it read on a
  page. Report it if the bridge marked such text as trusted.
- Vulnerabilities in the browser itself, MCP clients or the models. Report those upstream.
