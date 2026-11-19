# Browser diagnostics implementation plan

This is the proposed implementation sequence for viewport screenshot diffs, full-page screenshots,
network filters, HAR capture, and local Web Vitals. The HAR scope includes same-tab login and
checkout redirects across hosts. Proposed tool arguments and limits are starting points for review.

## 1. Add viewport screenshot diffs

**User flow.** Take a baseline with `computer {action: "screenshot", diff: true, tabId}`. Return the
normal viewport image and a baseline ID. Compare a later viewport capture with
`diff: true, since: "<baselineId>"`. Keep the baseline until eviction so several steps can be
compared against it. Return dimensions, changed pixel count and ratio, and an image highlighting
changed pixels. An unchanged result needs only metadata. A missing, incompatible, or expired
baseline returns a normal screenshot with a new ID and a reason. The diff image uses the same
viewport coordinates as the current capture.

**Implementation**

- Add the opt-in arguments to the standalone `computer` schema in `src/tools.ts` and validate the
  combination in `browser/InputTools.sys.mjs`. Keep the normal JPEG, annotations,
  `if_changed`, and extension-panel screenshot paths working. Reject combining visual diff with
  `if_changed` or annotations initially so label changes do not dominate pixel comparison.
- In `PageInput.sys.mjs`, reuse the current overlay handling, canvas resize, and size caps. For
  diff-enabled viewport captures, compare canvas pixels before JPEG encoding. Use a documented
  per-pixel color tolerance and retain the existing exact comparison for `if_changed`. Test
  image generation independently of Gecko using synthetic pixel arrays.
- Add a bounded cache for explicit baselines under the bridge context in `main.js`. Use byte
  accounting for decoded pixels and a global eviction limit. Each baseline is scoped to the
  session, tab, membership epoch, current document/frame context, viewport geometry, scroll
  offset, and effective capture settings. Tie document identity to the capture and verify it
  before publishing the result. Clear cached state when a session leaves, a tab is taken back
  or closed, or the bridge reloads. Follow `ReadSnapshots.sys.mjs` for invalidation.
- V1 targets same-document interaction checks. Cross-navigation comparisons need a separate
  baseline lifetime and scope contract. Settle that scope before implementing the cache.

**Acceptance.** A fixture changes one colored rectangle and reports a nonzero diff in the correct
area. The same capture reports unchanged. Scroll, resize, navigation, changed frame context,
stale IDs, and other sessions cannot accidentally compare against the old baseline. Existing
screenshot compatibility and scaled click tests pass.

## 2. Add full-page screenshots

**User flow.** `computer {action: "screenshot", full_page: true, tabId}` returns a whole-document
image for inspection, with capture dimensions and a downsampling indicator. The caller uses refs
or a fresh viewport capture for subsequent clicks. Treat it as a distinct capture mode from
visual diff, `if_changed`, and viewport annotations in the initial API.

**Implementation**

- Use a top-frame query in `ZenMcpChild.sys.mjs` to read document bounds in CSS document
  coordinates, including the viewport on short pages. In `PageInput.sys.mjs`, pass those bounds
  to the same WindowGlobal's `drawSnapshot` and re-check the document and site after capture.
  See `docs/gecko-pitfalls.md` for the document-coordinate and bfcache details.
- Start with a single bounded capture. Apply the scale before allocating a full-document bitmap,
  retain a reasonable output pixel budget, and report actual output dimensions and scaling.
  Very tall pages may need a local artifact or tiles for legible text. Verify the native capture
  in Zen before choosing that fallback.
- Keep the existing scroll offset and skip updating `ctx.state.scale` for this mode. Capture
  currently rendered document content. Nested scroll containers and virtualized or unloaded
  content keep their existing state. Restore overlays and close bitmaps in error paths.

**Acceptance.** A fixture with colored markers above, inside, and below the viewport shows all
markers while preserving scroll and the prior viewport click mapping. Exercise long pages,
device scale, a Zen workspace, and cancellation/navigation during capture. Verify that a blocked
iframe still prevents capture.

## 3. Filter the network log

Add optional method, status, and resource type filters to `read_network_requests` in
`src/tools.ts`. Make status accept an exact code or family such as `4xx`. Keep the current
`urlPattern` substring filter. Normalize HTTP methods, document the Gecko resource type names,
and combine filters with AND. Use the same predicates for HAR export.

In `ReadTools.sys.mjs`, apply site access and filters before the existing limit. Preserve the
meaning of `id`, output formatting, and `clear` clearing the entire ordinary tab log. Failed and
pending requests are retained in an unfiltered list and have no HTTP status unless headers arrived.

**Acceptance.** Fixture routes exercise GET/POST, exact and family status, fetch and document
types, combined filters, limits, empty results, and the existing details and clear behavior.

## 4. Add bounded cross-host HAR capture

**User flow.** Proposed `network_capture` actions are `start`, `status`, `stop`, and `cancel`.
Start on an agent-owned blank tab before navigating. The user or agent goes through a redirecting
login in that tab. Stop freezes the recording and returns a local HAR path, the entry count, and
counts for omissions. Stop may apply the same filters as the network log. Cancel discards the
capture. Status exposes elapsed time, state, and counters to its owner.

**Capture and lifecycle**

- Use the existing `NetworkLog.sys.mjs` HTTP observation points and browser ID attribution.
  Feed a separate bridge-local capture buffer before the ordinary log's host-reset and eviction.
  The ordinary log is tab-wide and capped at 500 requests. The capture is owned by the
  initiating session and follows that same tab through allowed origins.
- Start records requests opened after it succeeds, including redirects and requests from frames
  attributed to the tab. Track lifecycle events by Gecko channel ID. A capture observes the
  tab's traffic, including actions by the user or another tab member. A caller that needs
  isolation can use an agent-owned tab with no other members or the existing `tab_work hold`.
  Detached OAuth popups are a separate scope decision.
- Bound elapsed time and storage. Start with one capture per tab, a 10-minute duration,
  2,000 entries, and an overall byte ceiling. At a limit, freeze the capture for a bounded
  retrieval window and report the stop reason. At explicit stop, take a fixed cut of the log,
  count in-flight and unsupported records separately, and return without waiting on long-lived
  requests. Retry a failed file write from the same frozen capture.
- Register action-specific rules in `Policy.sys.mjs` and readable activity labels. Treat
  starting a persistent capture as its own operation. Recommended defaults are island consent
  for start and owner-only stop/export under the same tab and current site checks. Keep capture
  independent of individual tool calls and of `TabWake`. Stop in the island, tab take-back or
  close, owner departure or session end, and bridge reload end capture collection and revoke
  unexported data. Wire these through `Control.sys.mjs`, `Tabs.sys.mjs`, `Sessions.sys.mjs`,
  and bridge shutdown. Re-check ownership and site policy during capture and export.

**Data and output**

- Project requests to metadata early. V1 includes method, redacted URL, status, resource type,
  MIME, cache and timing information. Exclude headers, cookies, request and response bodies, and
  URL userinfo, query, and fragment. URL paths can contain identifiers, so keep the artifact
  local and describe remaining identifying data. Do not store raw HAR payloads in the activity
  log or MCP response.
- Validate native channel timing data on the supported Gecko build before defining the mapping.
  Reuse a real timing source such as `nsITimedChannel` where supported. HAR 1.2 requires
  nonnegative `send`, `wait`, and `receive` values whose sum with other exported phases
  equals the total. Keep unavailable optional sizes/timings marked unavailable as the format
  specifies. Count entries that cannot be represented faithfully and verify redirects, cached
  responses, and failed requests in Firefox DevTools.
- Write the HAR atomically under a unique name in a private runtime directory and return its
  path. Use the existing `IOUtils` and `PathUtils` conventions for file safety and bounded
  retention. Keep export serialization separate from capture and independent of upstream code.

**Acceptance.** Use local synthetic endpoints on two hostnames with login-shaped redirects,
requests before start and after stop, and sentinel cookies, query strings, headers, and bodies.
Verify one HAR shows the allowed host transitions, imports into Firefox DevTools, and omits all
sentinels. Test disallowed requests, parallel sessions, owner departure, Stop, timeout, capacity,
in-flight requests, write retry, and the existing log reset. Real credentials are unnecessary.

## 5. Report local Web Vitals and navigation timings

**User flow.** A read-only `web_vitals {tabId}` tool reports metric values and their availability
for the open top-level document. Start with Navigation Timing (TTFB and useful load milestones),
FCP, LCP, and INP where Gecko exposes the data required to calculate it. The response distinguishes
measured, provisional, insufficient-data, and unsupported metrics. Report measurement scope,
visibility, and navigation context. Keep CLS unsupported unless the active browser exposes
Layout Instability entries. A local tab measurement does not represent field data.

**Implementation**

- Use a dedicated actor query from `ReadTools.sys.mjs`, registered in `src/tools.ts` and as a
  read operation in `Policy.sys.mjs`. Collect read-only primitives. Use the page's
  `PerformanceObserver.supportedEntryTypes` and event interaction ID capability to establish
  support. Reuse document identity and cancellation from `PageQuery.sys.mjs`.
- Verify buffered entries for FCP/LCP on an already loaded page. For INP, verify interaction
  counting, entry thresholds, buffered history, and lifecycle before returning the metric.
  Group records by interaction and use the standard percentile definition. A partial observer
  history needs explicit coverage metadata. If native data cannot support valid INP, return
  insufficient data rather than substitute the slowest event.
- Keep any necessary observer state on the top-frame actor. Install only for tracked documents
  that need it, tear it down with the actor, and define navigation and bfcache behavior before
  reporting metrics from a restored page. Existing tab wake behavior remains sufficient for a
  tool call. The fixture should distinguish a visible tab from a hidden workspace. New external
  dependencies require separate approval.

**Acceptance.** Use a local document with a controlled server delay, a visible content paint,
and a deliberately slow fixture interaction. Assert field presence and relative timing rather
than exact milliseconds. Verify fresh and already loaded documents, no-interaction state,
navigation, and supported-versus-unsupported reporting on the installed Zen build.

## Delivery and verification

- Use one local commit per numbered feature. Update tool descriptions, README, and the relevant
  rows in `docs/feature-comparison.md` with each implementation. Credit
  [Agent Browser](https://github.com/vercel-labs/agent-browser) for the specific ideas we adopt.
  Implement against Zen's native APIs and the public specs.
- Run `npm test`, `npm run lint`, and `npm run format:check` for each commit. Extend the
  existing screenshot and policy tests, add focused deterministic coverage for the new
  behavior, and use a dedicated Gecko fixture for screenshot, HAR, and performance workflows.
- When changing `browser/`, copy it into the installed bridge with
  `cp -r browser/. ~/.local/share/zen-mcp/` and run `node scripts/zenctl.ts reload`. Reconnect the
  MCP client when `src/` changes. Open and close only fixture tabs. Confirm configuration mode
  remains `auto`. Never run `scripts/check-pick-delivery.ts`.
- Follow-up after these five features: ref-scoped screenshots. The element picker already
  captures element geometry, so inspect `browser/Picks.sys.mjs` as the starting point.
  A ref-scoped capture can later become a separate visual diff scope.

## References

- [Firefox screenshot work](https://github.com/mozilla-firefox/firefox/blob/main/devtools/docs/user/taking_screenshots/index.md)
- [Agent Browser diffing](https://agent-browser.dev/diffing)
- [HAR 1.2 format](https://webperfwg.org/specs/HAR/Overview.html)
- [Firefox DevTools HAR builder](https://searchfox.org/firefox-main/source/devtools/client/netmonitor/src/har/har-builder.js)
- [Web Vitals browser support](https://github.com/GoogleChrome/web-vitals#browser-support)
