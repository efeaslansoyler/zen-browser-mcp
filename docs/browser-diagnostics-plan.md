# Browser diagnostics

Diagnostics run on tabs the MCP session can access. See [src/tools.ts](../src/tools.ts)
for full schemas and [permissions](permissions.md) for policy and site rules.

## Page reads and screenshots

For repeated `read_page` or `get_page_text` calls, use `diff: true`. Save the
returned snapshot ID and submit it as `since` with the same tool and options.
Apply the returned line hunks to the earlier text without its metadata header.
An incompatible, evicted or missing snapshot returns a full read. Re-read
after document or tab access changes before using references.

Use `computer` with `action: "screenshot"` for a viewport image. `if_changed`
can skip identical images. `annotate` labels up to 80 visible controls in the
top frame. For pixel diffs, first capture with `diff: true`, then pass the
returned baseline ID as `since` with `diff: true` on a later capture. Default
baselines are document-scoped. Save with `baseline_scope: "deploy"` to compare
across a reload or another tab owned by the same session. Keep access to the
source tab and match viewport, scale and scroll position. Baselines are
in-memory, bounded, and expire after an hour or on bridge reload.

`full_page: true` captures the rendered document in one bounded image. Tall
pages may be downsampled. Nested scroll containers and content that has not
loaded keep their current state. Full-page capture preserves the existing
viewport click mapping. Use refs or a viewport image for click targets.

Viewport diff workflows were inspired by [Agent Browser diffing](https://agent-browser.dev/diffing).

## Browser settings and inspection

`browser_settings` reads and changes per-tab viewport, DPR, touch overrides,
user agent and color scheme. `device` uses a generic mobile, tablet or desktop
Gecko preset. Requested and measured values can differ. Server-side user agent
changes may need a reload. In the built-in modes, changes and reset ask in the
island. Close a blocking browser dialog before retrying a change that needs to
select a tab. Overrides roll back on reset or loss of access.

`react` can read DOM-backed Fiber trees and ancestor chains, with optional
bounded committed props. Private React structures and minified names can
limit results. `accessibility` runs the bundled axe-core locally and reports
violations and incomplete checks with element refs. Accessible frames are
audited separately, or use `ref` for one subtree. Cross-frame relationships
require manual review. Props and findings can contain sensitive page data.

## Console, network log and new tabs

Use `read_console_messages` for page console output.
`read_network_requests` lists HTTP requests from the tab. The ordinary log
keeps up to 500 requests and resets on cross-site navigation. Use `urlPattern`
for a URL substring, `method` for one or more HTTP methods, `status` for a
code or class such as `4xx`, and `resource_type` for one or more Gecko types
such as `fetch`, `xmlhttprequest`, or `document`. Filters combine with AND.
An `id` selects request details, including available headers and bounded body
text. Cookies and authorization headers are hidden. Other headers, URLs and
bodies can still contain sensitive data.

Input results can report `openedTabs` when Gecko provides a verifiable opener.
Check `tabs_context_mcp` for delayed notices. Use the usual `request_tab` flow to
gain access. Tabs with an unknown opener can still appear in the tab list.

## Cross-host HAR capture

1. Call `network_capture` with `action: "start"` on an owned tab before navigation.
   The capture follows that tab across allowed hosts.
2. For another tab, obtain access first, then call `action: "attach"` with
   `childTabId`. Attachment covers requests started after it succeeds.
3. Use `status` for counters, `stop` for a local HAR file, or `cancel` to
   discard the recording. Only the owner can manage it. Start and attach ask
   in the built-in modes.

Apply the network filters on `stop` to narrow the export. The capture holds
up to 2,000 entries, with a 4 MiB estimated storage budget and a
10-minute duration. It freezes at a limit for later retrieval. Stop returns
a local file retained for 15 minutes and reports unfinished requests and
entries with insufficient timing. The HAR uses Gecko timing, including
request send time in wait when it cannot separate the phases.

The export masks query values and recognized sensitive path segments. It
omits cookies, credentials, headers outside the allowlist and arbitrary
bodies. An explicit `response_projection` at start can include selected
boolean or enumerated fields from one exact same-origin HTTPS or localhost
JSON endpoint. Hostnames and unmasked paths can still identify resources.
Review a HAR before sharing it. Captures observe traffic from the attached
tabs, including activity by the user and other sessions sharing those tabs.

## Local Web Vitals

`web_vitals` reads the current top-level document without reloading it. It
reports navigation milestones, TTFB, FCP, LCP, INP and CLS when Gecko exposes
the required entries. LCP and INP can be provisional. Interaction coverage,
visibility and back-forward cache restores can limit the measurements.
Times are in milliseconds and CLS is unitless. These are local tab
measurements. See the [compatibility matrix](browser-compatibility.md)
for observed metric support.

## Reload, PDF and tab video

- Call `navigate` with `url: "reload"` to reload the current page. Add
  `bypass_cache: true` for a Gecko cache bypass or `read: "interactive"` /
  `read: "all"` for page refs after loading.
- `save_pdf` uses Gecko's print layout, including print CSS. It returns the
  absolute path and byte count. Gecko's print-to-file API does not return a
  page count.
- `record` takes `action: "start"` and an optional `duration` of 1–30 seconds,
  defaulting to 30. It samples only the tab viewport at up to four frames per
  second and uses ffmpeg on the bridge process's PATH to encode a silent
  640 × 360 WebM. A slow frame can reduce the capture rate. The bridge holds
  at most two recordings and 16 MiB of frame data per recording. Output is
  capped at approximately 16 MiB. `stop` returns the path, frame count, and
  capture timing. The duration or size limit, tab close, access loss, session
  end and island Stop also end capture. The path returned by `start` becomes
  usable after encoding completes.

PDF and video files are private and retained for about five minutes in
`$XDG_RUNTIME_DIR/zen-mcp-artifacts/`. Copy them elsewhere to keep them.
The tools choose the filename and directory.

## Cookies and Web Storage

In an agent browser mode, `cookies` lists first-party cookies for the current
HTTP(S) host or an explicit allowed `url`, including matching domain cookies
and HttpOnly cookies. It returns up to 100 entries. `set` and `delete` target
host-only cookies by name and path (default `/`). HTTPS writes are Secure.
Writes default to SameSite=Lax and session lifetime. Set `expires` to Unix
seconds for a persistent cookie and `http_only: true` for HttpOnly. The tool
uses the tab's origin attributes and handles first-party, unpartitioned jars.

`storage` supports `get`, `set`, `remove` and `clear` for a tab's top-level
origin. Select `area: "local"` for localStorage or `area: "session"` for
sessionStorage. `get` returns `null` for a missing key. Values from either
tool are untrusted.

## Per-tab HTTP control

Call `network_control` on an agent-opened HTTP(S) tab. `block` and `mock` match
a literal, case-sensitive `urlPattern` substring. The latest matching rule
wins. A tab holds up to 32 rules, and a new rule with the same pattern
replaces the earlier one. `offline` cancels any HTTP(S) channel Gecko attributes
to this tab, ahead of other rules. `clear` removes both kinds of state. A
top-level HTTP(S) navigation to another origin clears the rules. Tab close,
release, owner disconnect, Stop and bridge reload clear them too.

`mock` returns a synthetic HTTP response at the original URL before the
request reaches the server. Set a UTF-8 `body` of up to 65,536 characters,
a MIME type via `content_type` (default `text/plain`), an HTTP `status` of
200–299 or 400–599 (default 200), and optional `X-*` response headers.
Gecko builds without its native HTTP response override reject `mock`.
Browser state headers, redirects, and binary bodies are outside the tool's
scope. Offline simulation does not change `navigator.onLine` or emit offline
events. These rules work on future observable channels, so existing
connections, in-memory resource hits and service-worker responses may bypass
them. Use a fresh request when checking a rule.

## Verification

The live fixtures include [agent tools](../scripts/check-agent-tools.ts), [screenshots](../scripts/check-screenshots.ts),
[page read diffs](../scripts/check-read-diff.ts),
[network and HAR](../scripts/check-network-diagnostics.ts),
[opened tabs](../scripts/check-opened-tabs.ts),
[inspection](../scripts/check-inspection.ts),
[input and emulation](../scripts/check-input.ts), and
[Web Vitals](../scripts/check-web-vitals.ts). Follow the
[contributor guide](../CONTRIBUTING.md#live-checks) for isolation and setup.
