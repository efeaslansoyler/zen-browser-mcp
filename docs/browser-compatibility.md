# Browser compatibility

Tested November 20, 2026 on Linux x86-64. The original matrix used `840d09c`, with recording
checks added at `378033b`. Download tracking, native dialog handling, and the affected input,
extension and clipboard checks were rechecked through `c5d6475`.
For setup, see the [installation guide](installation.md).

| Browser | Package version | Build ID |
| --- | --- | --- |
| [Zen](https://github.com/zen-browser/desktop/releases/tag/1.24.3b) | 1.24.3b | 20261118023529 |
| [Firefox stable](https://www.mozilla.org/firefox/) | 160.0.1 | 20261116130455 |
| [Firefox ESR](https://www.mozilla.org/firefox/enterprise/) | 153.7.0 | 20261103151912 |
| [LibreWolf](https://librewolf.net/installation/linux/) | 160.0-1 | 20261111003723 |
| [Floorp](https://github.com/Floorp-Projects/Floorp/releases/tag/v12.21.2) | 12.21.2 (Gecko 160.0.1) | 20261113033321 |
| [Waterfox](https://www.waterfox.com/download/) | 6.7.8 (Gecko 153.7.0) | 20261106162521 |

## Live checks

**Pass** means the listed check completed. **Pass on retry** marks a check with an intermittent
failure followed by a pass in a fresh profile. **N/A** means a Zen-specific check.

| Feature | Check | Zen | Firefox | ESR | LibreWolf | Floorp | Waterfox |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Install loader and start bridge | `install / startup` | Pass | Pass | Pass | Pass | Pass | Pass |
| Navigate, read, form fill, clicks, and screenshots | `check-compat.ts` | Pass | Pass | Pass | Pass | Pass | Pass |
| Deploy diff and full-page screenshots | `check-screenshots.ts` | Pass | Pass | Pass | Pass | Pass | Pass |
| Network filters and redacted HAR | `check-network-diagnostics.ts` | Pass | Pass | Pass | Pass | Pass | Pass |
| Immediate and delayed tab-open notices | `check-opened-tabs.ts` | Pass | Pass | Pass | Pass | Pass | Pass |
| Local Web Vitals | `check-web-vitals.ts` | Pass | Pass | Pass | Pass | Pass | Pass |
| Text and accessibility tree diffs | `check-read-diff.ts` | Pass | Pass | Pass | Pass | Pass | Pass |
| Click hit testing and frame coordinates | `check-hit-test.ts` | Pass | Pass | Pass | Pass | Pass | Pass |
| Permission modes and site rules | `check-permissions.ts` | Pass | Pass | Pass | Pass | Pass | Pass |
| Stop and cancellation | `check-cancellation.ts` | Pass | Pass | Pass | Pass | Pass | Pass |
| Session sharing and tab access | `check-tab-access.ts` | Pass | Pass | Pass | Pass | Pass | Pass |
| Download tracking and cancellation | `check-downloads.ts` | Pass | Pass | Pass | Pass | Pass | Pass (native dialog) |
| Page watches | `check-watch.ts` | Pass | Pass | Pass | Pass | Pass | Pass |
| React trees and axe audit | `check-inspection.ts` | Pass | Pass | Pass | Pass | Pass | Pass |
| Multi-element picker | `check-multi-pick.ts` | Pass | Pass | Pass | Pass | Pass | Pass |
| Held input, annotated screenshots, and device emulation | `check-input.ts` | Pass | Pass | Pass | Pass | Pass | Pass |
| Clipboard consent and extension-panel paste | `check-clipboard.ts` | Pass | Pass | Pass | Pass on retry | Pass | Pass on retry |
| Temporary extension toolbar panels | `check-extensions.ts` | Pass | Pass | Pass | Pass | Pass | Pass on retry |
| Record, review, save and retrieve a recipe | `check-recordings.ts` | Pass | Pass | Pass | Pass | Pass | Pass |
| Zen workspace placement and interaction | `check-workspace.ts` | Pass | N/A | N/A | N/A | N/A | N/A |

## Observed limits

- The Firefox Spotlight startup dialog blocks native tab selection. Stable and ESR both
  returned a prompt to close the dialog before applying emulation that requires a tab switch or
  opening an extension. After dismissal, emulation, extension-panel and clipboard checks passed.
- LibreWolf passed page clipboard operations and opened and operated the toolbar panel. The
  panel closed during an initial clipboard-paste approval workflow. The full clipboard check
  passed on retry in a fresh profile.
- Waterfox passed page clipboard operations. The toolbar panel failed to open in two initial
  runs. Both extension and clipboard workflows passed on retry in a fresh profile. Later
  repeated runs on LibreWolf and Waterfox also passed.
- Waterfox opens a native file-handling dialog before Gecko adds a download entry.
  `check-downloads.ts --native-dialog` verified the tab-scoped `waiting_for_user` status,
  native Cancel clearing it, Save followed by path, size and SHA-256, and cancellation of
  an in-progress download after Save. On the other five browsers, the ordinary download
  fixture completed without this dialog.
- The Web Vitals fixture measured TTFB, FCP, LCP and INP wherever it passed. CLS was unsupported
  in those builds. These were local measurements of the same fixture.

## Test setup

Each upstream package ran from a writable local copy with its own disposable profile, XDG
config, data, state, cache and runtime directories, MCP socket, download folder, Xvfb display,
and session bus. The test waited for Gecko's delayed browser startup before opening a fixture.
The Zen profile skipped the first-run welcome screen. Test-only permission changes stayed in
each isolated configuration. Fork privacy settings stayed at their defaults.

To repeat, [install into a browser copy](../CONTRIBUTING.md#testing-without-touching-your-browser),
launch it on a separate display for the extension, clipboard and emulation checks, and run the
listed scripts sequentially with the same XDG environment and `ZEN_MCP_SOCKET`. The clipboard
check uses `xclip` on X11 and `wl-clipboard` on Wayland. Close the disposable browser after the
checks. The [contributor guide](../CONTRIBUTING.md#live-checks) describes the fixture coverage.

This matrix covers these Linux packages and check paths. macOS, Windows, mobile, Flatpak and
Snap were outside the test. Unit tests cover additional bridge and recipe behavior.
Real conversation delivery through `check-pick-delivery.ts` was excluded.
