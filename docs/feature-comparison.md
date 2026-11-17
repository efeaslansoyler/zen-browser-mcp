# Feature comparison with agent-browser

Reference: [agent-browser commands](https://agent-browser.dev/commands), a CDP/WebDriver based
agent CLI for Chromium and Safari. zen-browser-mcp's goal is different: work together with the user
in their everyday Firefox-based browser instead of launching a separate one. Rows below are
rough equivalents, not API or engine parity.

| Area | zen-browser-mcp |
|---|---|
| Snapshot, refs, interactive tree | `read_page`, `find`, `form_input` |
| Page text and text diff | `get_page_text`, `diff`/`since` on reads |
| Navigation, tabs, iframes, dialogs | Yes, with per-session tab ownership |
| Hover, click, drag, scroll | Real input, covered-target check before clicks |
| Key down / up | `computer` `key_down`/`key_up` |
| Mouse move / down / up | `computer` `mouse_move`/`mouse_down`/`mouse_up` |
| Variable typing speed | `typing: human`, `delay_ms`, `seed`; fast by default |
| Smooth / curved mouse paths | `movement: smooth`/`human`, `duration_ms`, `steps`, `seed` |
| Viewport / device | `browser_settings`: per-tab size, native DPR, touch events, user agent |
| Color scheme | `browser_settings` `media`: dark / light / no-preference |
| Fewer repeated screenshots | `if_changed`: exact image equality per session/document/options |
| Screenshot labels | `annotate`: refs of up to 80 visible controls in the top frame |
| Clipboard | Every operation and shortcut asks in the island |
| File upload | `file_upload` |
| Downloads | `downloads`: list / wait / cancel, path, progress, sha256, events file |
| Console and network | Console; requests with headers and bodies |
| Network route / mock / HAR / throttling | Not available; the tools only observe |
| React | `react` tree/inspect with optional props; no render history or Suspense tracking |
| Accessibility audit | `accessibility`: bundled axe-core, findings and refs per frame |
| Full-page screenshot / PDF | Not available; screenshots cover the viewport |
| Web Vitals | Not available |
| Cookie / storage / session export | Not available: the user's sessions are already there |
| CDP / headless / launching a browser | Out of scope: the everyday browser and window |
| Proxy / geolocation / TLS settings | Not available; global profile settings are never changed |
| Recording / streaming / profiling | Not available |
| Element picks, island, Stop, task handoff | zen-browser-mcp's own focus |
| Installed extension popups | `extensions`; tab switch asks even in auto mode |

## Limits

- Human-like input is optional. It produces real, trusted events but is no guarantee against
  bot detection.
- Held keys and buttons belong to a session and frame. They are released on key up, Stop,
  errors, navigation, handoff, disconnect and bridge reload, and at the latest 30 s after the
  last `key_down`/`mouse_down` (`hold_ms` can shorten that). A held button doesn't move
  between frames; it's released with an error.
- `browser_settings` never resizes the window or changes global prefs. Every change and reset
  asks in the island, even in auto mode. Previous inline CSS and native overrides are restored
  on reset, handoff, take-back, disconnect and bridge shutdown.
- Mobile / tablet / desktop are generic Gecko presets (mobile and tablet send the Android
  Firefox user agent), not Safari or a full device fingerprint; `maxTouchPoints` isn't spoofed.
  Measured values can differ from requested ones because of native scaling and privacy
  behavior; servers that sniff the user agent may need an explicit reload.
- `if_changed` compares encoded images exactly, with no pixel tolerance; the cache holds 8 MB
  / 32 entries. `annotate` doesn't label iframe content; labels are removed after the capture.
