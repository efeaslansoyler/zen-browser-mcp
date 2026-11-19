# Gecko and Zen pitfalls

Every item below cost us time at least once (Gecko 157–158, Zen). Check here before debugging
something that "should work".

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

## Sockets and streams

- Closing a buffered socket output stream cut replies at 32 KB: open it with `OPEN_UNBUFFERED`.
- `NetUtil.asyncCopy` also closes the sink. For a subscription that must stay open, write with
  `nsIAsyncStreamCopier` and `closeSink: false`.

## Input and frames

- Mouse and keyboard events sent with the top page's `windowUtils` don't reach out-of-process
  (Fission) iframes; same-site ones work. Send from the frame's own actor.
- In a background tab a click doesn't move focus (call `focus()` yourself) and the wheel
  doesn't scroll (use `scrollBy`). Zen multiplies wheel deltas by
  `mousewheel.default.delta_multiplier_*` (200), so divide before sending.
- In an inactive tab, timers may fire only about once per second, animation frames can
  stall, and `document.hidden` is true. Setting the tab's `browser.docShellIsActive` to
  `true` restores foreground timer and animation frame rates without selecting the tab.
  The tab switcher can reset the flag when the user selects the tab and then leaves it.
- A pending `sendQuery` is not rejected when the actor is destroyed: watch for
  `currentWindowGlobal` changes.
- With bfcache, a navigation can move the old page into the cache together with its own
  BrowsingContext: that context's `currentWindowGlobal` never changes and the tab's
  `browser.browsingContext` becomes a new object. Check `bc.isInBFCache` / `bc.top.isInBFCache`
  (and `isDiscarded`) as well.
- A closed shadow root's contents don't appear in a window listener's `composedPath()`.
- A window without focus gets no focus, blur or blur-time `change` events for text fields;
  track typing with `input` events. Enter in a form clicks its submit button with a trusted
  click whose `detail` is 0 (so do Space and Enter on a focused button).
- Hyprland suspends windows on hidden workspaces (`document.hidden`, no focus, no APZ
  scrolling); that's why input is never sent at the window level.

## Network and downloads

- An `nsITraceableChannel` listener sees bodies before content decoding: they arrive gzip/br
  encoded. Decode with `DecompressionStream` (`br` is spelled `"brotli"`).
- `DownloadSource.browsingContextId` may be a subframe; use its `top.browserId` (and the
  opener chain for popups).
- While a download is being canceled with `finalize(true)`, Gecko briefly reports
  `canceled` with partial data, which looks like `paused`.

## Browser UI and session store

- SessionStore lives at `moz-src:///browser/components/sessionstore/SessionStore.sys.mjs`.
  Values of lazy tabs may only be readable some time after the window opens.
- `gBrowser.insertBrowser(tab)` (no underscore) creates the `<browser>` of a lazy tab.
- Without a container Firefox sets `.tab-context-line` to `display: none`.
- `drawSnapshot(rect, …)` wants document coordinates (viewport + scrollX/Y).
- In Zen, `gBrowser.tabs` holds only the active workspace's tabs; tabs in other spaces are
  in `gZenWorkspaces.allStoredTabs`. Code that looks tabs up by id must use the latter, or an
  agent loses its tab as soon as the user switches spaces.
- `gZenWorkspaces.createAndSaveWorkspace(name, icon, true)` creates a space without switching;
  `moveTabToWorkspace(tab, uuid)` moves a background tab without selecting it.
- Zen keeps a hidden empty-tab placeholder per workspace (`zen-empty-tab`, `about:blank`):
  skip it when listing tabs.
- Zen syncs windows; an unsynced window needs `OpenBrowserWindow({ zenSyncedWindow: false })`.
- `--zen-primary-color` can be a light gray; white text on it is unreadable, so the island
  uses a dark tone of the theme color.

## Testing

- An agent's synthetic `right_click` doesn't produce a `contextmenu` event. To test context
  menus, load `EventUtils` into the browser window and call
  `synthesizeMouseAtPoint(x, y, { type: "contextmenu", button: 2 }, win)`.
- `pkill -f "<pattern>"` also kills the shell whose command line contains the pattern. Find
  servers by port instead: `ss -ltnpH 'sport = :8765'`.
