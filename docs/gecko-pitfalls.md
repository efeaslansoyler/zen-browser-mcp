# Gecko and Zen pitfalls

These notes cover behavior observed in Zen and other desktop Gecko builds.
See the [compatibility matrix](browser-compatibility.md) for exact test versions.

## Loading and scopes

- `loadSubScript` rejects `file://` URLs ("untrusted URI"): map a `resource://` substitution first.
- An actor that enters web content processes needs `safeForUntrustedWebProcess: true`.
- `eval()` is forbidden in the system scope: use `Cu.Sandbox` + `Cu.evalInSandbox`.
- The autoconfig scope lacks `IOUtils`, `BrowsingContext`, `DecompressionStream`, `TextDecoder`,
  `Blob` and `Response`: take them from a browser window. (`.sys.mjs` modules have `IOUtils`
  and `PathUtils` as globals.)
- In this scope `el.ownerGlobal` is undefined: use `ownerDocument.defaultView`.
- XPCOM constants don't show up in `Object.entries`: iterate with `for...in`.
- `addSystemEventListener` is gone: use `addEventListener(…, { mozSystemGroup: true })`.
- A bare `nsITimer` without a reference may be garbage collected before it fires: use `Timer.sys.mjs`.
- Gecko autoconfig skips the first line of the `.cfg` file. It runs before the network and
  browser windows are ready. Zen's stderr may go to `/dev/null`, so the bridge writes early
  errors to a runtime log even when the browser console is unavailable.
- `security.sandbox.content.read_path_whitelist` must be set before the first content process
  starts (`main.js` writes it to the default branch during autoconfig).
- Tool group factories (`readTools(ctx)` …) destructure `ctx` when they are created, so
  `main.js` builds them last; other modules read `ctx` at call time.
- A `.sys.mjs` module has its own global: `globalThis` there is not `main.js`'s autoconfig
  scope. State that must survive a reload (`globalThis.zenMcp*`) is kept in `main.js` and
  handed to modules through `ctx`.
- A static `import` between `.sys.mjs` files drops the `?v=` query that makes a bridge reload
  load new code, so the imported module stays on its old version until the browser restarts.
  Load modules with `ChromeUtils.importESModule(url + version query)` instead; the actor
  helpers get each other's functions from the actor.
- An actor registration can outlive the autoconfig scope that made it. A fresh bridge may need
  to unregister the old actor before registering the new version.
- Xrays hide page-defined property overrides and expose native DOM behavior. Reading page-owned
  framework metadata needs waived Xrays. A content-principal sandbox without Xrays can read page
  variables, and the page's eval CSP does not govern evaluation in the separate sandbox.

## Sockets and streams

- A Unix socket can be unlinked while its server is listening. With the old shared
  `zen-mcp.sock` path, the last browser to start took over the path and a subsequent
  crash left a refused socket while the first browser was still running. Give each bind
  a fresh path and publish metadata after the listener is bound. `nsIFile.isSymlink()`
  throws on a path that does not exist.
- The full Unix socket path is limited to 107 UTF-8 bytes on Linux and 103 on macOS.
  Long `XDG_RUNTIME_DIR` values can exceed the limit even with a short filename.
  On Linux use a short directory under `/run/user/<uid>` for disposable profiles.
- In Zen, `CurProcD` is the installation's `browser/` subdirectory. Use `GreD`
  for the directory that matches the installer.
- On Linux, file input streams cannot report `available()` for `/proc/self/status`.
  Read the first 512 bytes to find the UID when resolving the runtime directory.
- Linux `/proc/<pid>/stat` puts the command name in parentheses. Locate the end of that field
  before splitting the remaining fields, since the name can contain spaces.
- Closing a buffered socket output stream cut replies at 32 KB: open it with `OPEN_UNBUFFERED`.
  Closing the output stream alone leaves the transport open while its input pump is running.
- `NetUtil.asyncCopy` also closes the sink. For a subscription that must stay open, write with
  `nsIAsyncStreamCopier` and `closeSink: false`.

## Launching dedicated profiles

- Launch with `--profile <dir> --new-instance --no-remote`. The isolated Zen check
  runs the user profile and an agent profile of the same installation side by side.
  New Gecko uses `--new-instance` to bypass remote dispatch and accepts
  `--no-remote` for compatibility with older builds.
  See [Gecko's command-line handling](https://searchfox.org/firefox-main/source/toolkit/xre/nsAppRunner.cpp#10723).
- Headless Gecko also creates a browser window internally. `final-ui-startup`
  can fire before it has a usable `gBrowser`. A newly launched dedicated bridge
  waits for `browser-delayed-startup-finished` before publishing its socket.
- Gecko can leave an advisory lock file in the profile after shutdown. Reset
  and orphan cleanup check whether a process holds the lock.
  See [Gecko's profile lock implementation](https://searchfox.org/firefox-main/source/toolkit/profile/nsProfileLock.cpp#1693).
- The loader installer needs a writable installation. The Flatpak and Snap installation
  layouts are read-only for this flow.

## Input and frames

- Mouse and keyboard events sent with the top page's `windowUtils` don't reach out-of-process
  (Fission) iframes; same-site ones work. Bind Gecko's `EventUtils` to the frame window and
  send from its actor to dispatch trusted input even in a background tab.
- A page can stop propagation in its own event group without suppressing a listener in
  Gecko's system event group. For a user's answer or a recording, check event trust separately.
- In a background tab a click doesn't move focus (call `focus()` yourself) and the wheel
  doesn't scroll (use `scrollBy`). Zen multiplies wheel deltas by
  `mousewheel.default.delta_multiplier_*` (200), so divide before sending.
- In an inactive tab, timers may fire only about once per second, animation frames can
  stall, and `document.hidden` is true. Setting the tab's `browser.docShellIsActive` to
  `true` restores foreground timer and animation frame rates without selecting the tab.
  The tab switcher can reset the flag when the user selects the tab and then leaves it.
- A pending `sendQuery` is not rejected when the actor is destroyed: watch for
  `currentWindowGlobal` changes. Return structured errors explicitly because rejected actor
  queries do not reliably carry the original message. Page alerts, confirms and prompts block
  page JavaScript, so monitor for a dialog instead of relying on the pending query to finish.
- With bfcache, a navigation can move the old page into the cache together with its own
  BrowsingContext: that context's `currentWindowGlobal` never changes and the tab's
  `browser.browsingContext` becomes a new object. Check `bc.isInBFCache` / `bc.top.isInBFCache`
  (and `isDiscarded`) as well.
- A closed shadow root's contents don't appear in a window listener's `composedPath()`.
- A progress listener added to a fresh tab may receive `about:blank`'s STOP after
  the requested navigation begins. Ignore that initial stop and hold a strong reference
  to the listener while waiting, since Gecko stores it weakly.
- Gecko can register a new tab after the actor replies to the click that opens it, even
  for a link with `target="_blank"`. The bridge retains the opener watch so a later
  `tabs_context_mcp` can report it.
- Fission can replace a browsing context on cross-site navigation while carrying its emulation
  overrides to the new context. Restore the override on the current context. Read the reported
  user agent and DPR from content because privileged reads can bypass emulation.
- A window without focus gets no focus, blur or blur-time `change` events for text fields;
  track typing with `input` events. Enter in a form clicks its submit button with a trusted
  click whose `detail` is 0 (so do Space and Enter on a focused button). Record the key
  instead of its generated click to avoid replaying the activation twice. A button
  associated with a form submits by default unless its type changes that behavior.
- Hyprland suspends windows on hidden workspaces (`document.hidden`, no focus, no APZ
  scrolling); that's why input is never sent at the window level.
- The privileged file-input setter fills a file control without a native picker. Use the
  parent to read the files because the sandboxed content actor has no arbitrary disk access.
  Events dispatched from the privileged actor can be trusted by the page.
- Setting a control through its Xray invokes the native setter, bypassing React's value
  tracker so the following event registers the change.
- Native semantics treat `alt=""` as decorative and expose `section` and `form` as landmarks
  when they have an accessible name. Use `innerText` for rendered text because it skips hidden
  descendants and separates rendered blocks. Native DOM reads do not expose arbitrary handlers
  registered by page scripts, so `tabindex` is only a hint that a generic element is actionable.
- Gecko stores console API calls in `ConsoleAPIStorage` and JavaScript errors in its console
  service. Reading the stored messages does not require an early listener.

## Source locations and styles

- Astro's dev toolbar removes `data-astro-source-file`/`-loc` from the DOM about 300 ms after
  load (and after every view-transition swap). The child actor records them at
  `DOMContentLoaded`; elements swapped in later have no source location. The column marks the
  end of the opening tag, so report only the line.
- Gecko stack entries use `name@url:line:column`. React 19 stores JSX call sites in
  `_debugStack` on fibers and `debugStack` on server component owners. Capture enough frames
  to reach React's bottom marker and ignore subsequent frames. React 18 with the Babel JSX
  source transform instead supplies positions in `_debugSource`.
- Svelte 5 development metadata (`__svelte_meta.loc`) uses zero-based columns and includes
  enclosing component render sites in its parent entries. Vue 3 supplies component files
  without lines. Angular's development helpers can resolve component files and class lines.
- Next.js development serves maps for server component frames and webpack eval modules
  from its `/__nextjs_source-map` endpoint. Turbopack can return indexed maps with
  `turbopack:///[project]/` sources. Webpack uses prefixes such as `webpack://_N_E/./`;
  Vite typically serves project-relative paths such as `/src/App.tsx`.
- `InspectorUtils` exists only on window globals; actor modules get it from a system sandbox
  with `wantGlobalProperties: ["InspectorUtils"]`. Current Gecko calls the matched-rules method
  `getMatchingCSSRules` (older builds: `getCSSStyleRules`). It lists matched rules in cascade order (least specific
  first) and includes user-agent and user sheets; keep `parentStyleSheet.parsingMode ===
  "author"`. `getRuleLine` counts a parser-inserted `<style>`'s rules from the top of the HTML
  document; `getRelativeRuleLine` counts from the start of the `<style>`, which is what its own
  source map (Vite's `css.devSourcemap`) uses. Vite can put an inline map on the style, whose
  relative sources resolve against its served development file. CSSOM-inserted rules can
  exist in a textless `<style>` with no source position.
- Tailwind can add transparent ring and shadow layers to every element. Ignore those layers
  when summarizing visible styles.

## Network and downloads

- On Gecko builds with native response overrides, `http-on-before-connect`
  can call `nsIHttpChannelInternal.setResponseOverride` with an
  `nsIReplacedHttpResponse`. This supplies body, headers and status without
  contacting the origin. `responseBody` is an `ACString` and needs UTF-8 bytes.
  The service-worker interception decision precedes this hook. Returning
  `data:` or `blob:` through `redirectTo` changes URL/origin handling and
  does not supply an HTTP status or headers at the original URL.
  [Gecko's DevTools override](https://searchfox.org/firefox-main/source/devtools/shared/network-observer/NetworkOverride.sys.mjs)
- Use the channel's browsing context to scope HTTP cancellation to a tab.
  `Services.io.offline` changes network state for the whole browser.
- A request refused before opening (for example for a blocked port) may get no
  `http-on-stop-request`. By the response-header notification, outgoing request headers
  include late additions such as cookies.
- An `nsITraceableChannel` listener sees bodies before content decoding: they arrive gzip/br
  encoded. Decode with `DecompressionStream` (`br` is spelled `"brotli"`).
- `DownloadSource.browsingContextId` may be a subframe; use its `top.browserId` (and the
  opener chain for popups).
- Gecko's `unknownContentType.xhtml` file-handling dialog can open before the Downloads list
  contains an entry. Use its launcher's browsing context for attribution. The dialog's
  owner window and its selected tab can be unrelated to the download source.
- While a download is being canceled with `finalize(true)`, Gecko briefly reports
  `canceled` with partial data, which looks like `paused`. The same call can remove a
  paused download's partial file. Adding a Downloads view replays existing entries,
  so the bridge deduplicates them after reload.

## Cookie expiry

- `nsICookieManager.add` and `nsICookie.expiry` use Unix seconds on Gecko 141
  and earlier and milliseconds on Gecko 142 and later. Use the Gecko
  platform version, since Zen and other derivatives report their own app
  versions. [Gecko's expiry change](https://bugzilla.mozilla.org/show_bug.cgi?id=1972757)

## Printing and capture

- Use fresh print settings with PDF output and `kOutputDestinationFile`, then
  await `BrowsingContext.print`. It works in headless Zen and resolves
  without page-count metadata. Clearing header and footer strings prevents
  the default URL/date headers.
- Low-scale `drawSnapshot` can capture video frames without changing screenshot
  coordinates, including for a background tab without selecting it. Keep each capture serial and
  resize into bounded frames before handing them to the encoder.

## Browser UI and session store

- SessionStore lives at `moz-src:///browser/components/sessionstore/SessionStore.sys.mjs` on
  newer Gecko builds. ESR-based builds may use `resource:///modules/sessionstore/SessionStore.sys.mjs`.
  Zen can restore tabs through its own manager after the window opens. Listen for
  `SSTabRestoring`, and retry reads of lazy tab values that can remain unavailable even
  after that event or delayed startup.
- `gBrowser.insertBrowser(tab)` (no underscore) creates the `<browser>` of a lazy tab.
- A browser window-modal dialog such as Firefox Spotlight sets `window-modal-open` on the
  chrome document root. While it is open, assigning `gBrowser.selectedTab` can leave the prior
  tab selected. Keep the selected-browser and target-document identity checks after any switch.
- Without a container Firefox sets `.tab-context-line` to `display: none`. Zen's vertical
  tab styles draw the line as a narrow strip on the edge of the tab.
- `drawSnapshot(rect, …)` wants document coordinates (viewport + scrollX/Y).
- In Zen, `gBrowser.tabs` holds only the active workspace's tabs; tabs in other spaces are
  in `gZenWorkspaces.allStoredTabs`. Code that looks tabs up by id must use the latter, or an
  agent loses its tab as soon as the user switches spaces.
- `gZenWorkspaces.createAndSaveWorkspace(name, icon, true)` creates a space without switching;
  `moveTabToWorkspace(tab, uuid)` moves a background tab without selecting it.
- Layout emulation may need to select a background tab to update its suspended layout.
  Native extension toolbar popups also use the selected tab for `activeTab` and
  `tabs.query({active: true})`. Let the tab and focus handlers finish before opening
  the popup. Both operations require consent before switching the user's tab.
- Zen keeps a hidden empty-tab placeholder per workspace (`zen-empty-tab`, `about:blank`):
  skip it when listing tabs.
- Zen syncs windows; an unsynced window needs `OpenBrowserWindow({ zenSyncedWindow: false })`.
- `--zen-primary-color` can be a light gray; white text on it is unreadable, so the island
  uses a dark tone of the theme color.
- Zen uses Ctrl+Shift+E for its network monitor. The element picker uses Ctrl+Shift+F
  to avoid that collision.

## Testing

- An agent's synthetic `right_click` doesn't produce a `contextmenu` event. To test context
  menus, load `EventUtils` into the browser window and call
  `synthesizeMouseAtPoint(x, y, { type: "contextmenu", button: 2 }, win)`.
- `pkill -f "<pattern>"` also kills the shell whose command line contains the pattern. Find
  servers by port instead: `ss -ltnpH 'sport = :8765'`.
- Unit-test fakes encode where a Gecko API lives. A fake global (`InspectorUtils` on the actor
  module scope) passed while the real one existed only on window globals, and a renamed method
  (`getCSSStyleRules` → `getMatchingCSSRules`) passed too; run the matching live check in
  `scripts/sandbox.ts` before trusting a fake of a new Gecko API.
