# Browser workflows

Use the root [README](../README.md) to install. This guide describes the browser
UI and the MCP tools behind the most common workflows. The current argument
schemas are in [src/tools.ts](../src/tools.ts).

## Tabs and the island

The island shows activity, permission cards and **Stop** / **Resume**. Click
the activity to go to the agent's tab. Ctrl+Shift+Esc also stops browser
automation. When several agents are active, use the arrows or agent icons to
switch between them.

`tabs_context_mcp` separates the caller's tabs, other sessions' agent tabs
(`agentTabs`), and open user tabs (`userTabs`). The latter includes tab metadata.
Live page access needs tab membership. Use **Give to session…** from the tab
menu or approve a `request_tab` call. **Share with session…** adds a member to
an agent tab. **Take back from agent** revokes access for all members and
cancels their active work.

Sessions take turns in a shared tab. `tab_work` posts short task notes and can
hold a tab for an uninterrupted sequence. Read the page again when a result
reports `pageChanged`. A session that closes a shared tab leaves it while
other members can keep working. The [architecture](architecture.md#sessions-and-tab-access)
describes the hold, lock and reconnect behavior.

New agent tabs use the browser profile's sessions by default. Set `clean: true`
on `tabs_create_mcp` for a separate **Agent** container, or run
`node dist/cli.js config container Agent` to use it by default. Containers
separate cookies and site storage. History and extensions still belong to the
profile. In Zen, the tab menu's **Agent settings** can also place new agent
tabs in a separate workspace. The equivalent CLI is
`node dist/cli.js config workspace Agents`. Use `off` for the container or
`current` for the workspace to restore the default.

## Read and act on a page

- For a known new URL, call `tabs_create_mcp` with `url` to open it and wait for load in
  one call. Without `url`, it opens an empty tab. For an existing agent tab, use `navigate`
  with a URL, `"back"`, or `"forward"`. Opening a new tab with a URL uses the same navigation
  permissions and site rules. If navigation is refused after tab creation, the error includes
  the new tab ID so the agent can close it.
- Add `read: "all"` for text and controls or `read: "interactive"` for controls only.
  The response contains tab metadata followed by the `read_page` output, capped at 8,000
  characters, with refs ready for clicks and form input. The read uses the destination
  page's permissions and leaves diff baselines alone. By default the result is tab metadata.
- Use `read_page`, `find`, or `get_page_text` to understand a page. Prefer
  element refs for clicks and form actions. A covered-target error identifies
  the blocker when the browser can resolve it.
- Use `navigate`, `computer`, `form_input`, and `file_upload` to work on a page.
  `browser_batch` runs several steps in sequence and stops at the first error.
- After `computer` input completes, a follow-up read can see synchronous input effects.
  Wheel scrolling returns once the scroll position changes or the browser applies its
  fallback after a bounded wait. Use `wait_for` for application updates that happen
  asynchronously after input.
- Use `wait_for` for short page conditions and `watch` for longer or ongoing
  changes. A watch returns a local events file. `live: true` keeps the tab
  active for timer and animation work and cannot be combined with `hold: true`.
- `highlight` points out controls without waiting. `hand_to_user` lets you
  complete an action such as signing in or entering a one-time code. The
  agent continues when you press **Done**.

## Send an element or a recipe

Choose **Show to agent…** from the page menu or start the picker with
Ctrl+Shift+F. Click to send one element, or Ctrl-click (Cmd-click on macOS;
Shift-click also works) up to eight elements and press Enter. A bar at the
bottom of the page lists every picker key and how many elements are selected.
Add a note and choose a destination. A multi-element pick also has an optional
note per numbered element; the agent reads each one at the top of that
element's context (Codex reads them with the general note). The pick can include
the page URL, selector, visible crop, styles and component context. A pick
does not grant live access to its source tab.

On a development page of a React 19 app (for example Vite, or the Next.js app
router with server and client components), each element also
carries its **source location**: the file and line of its JSX, the call sites
of up to three components above it (code in `node_modules` is skipped), and a
few lines of the original source from the page's source maps (for Next.js
server components, from its dev server's `/__nextjs_source-map` endpoint). The
HTML is then shortened. Source maps are read only from the page's own origin,
only when your site rules allow it, and within two seconds; otherwise the pick says
`Source: unknown` and keeps its full HTML. Production pages and stacks without such metadata
get no `Source:` line: the pick has the full HTML and the CSS rules below.

Other stacks give the location their development build records, without a
snippet. The pick names the framework and whether the location points at the
element itself or only at its component:

| Stack | Location |
| --- | --- |
| React 18 | element: the JSX file, line and column, plus component call sites |
| Svelte 5 | element: the file, line and column, plus component call sites |
| Astro (dev toolbar on) | element: the `.astro` file and line |
| Vue 3 | component: the nearest component's file, without a line |
| Angular | component: the component class's file and line |

Each element also lists up to eight CSS rules of the page that style it, most
specific first, with their stylesheet file and line; browser default styles are
left out. Vite dev styles name their original file; their lines are the
original ones only with a CSS source map (Vite's `css.devSourcemap`), and
otherwise the pick says the line is in the injected CSS. Rules from an inline
`<style>` and rules created by script are reported as such, without a file.

The destination menu shows whether delivery is immediate, follows your next
message, or waits for the next browser tool call:

| Client | Delivery |
|---|---|
| Claude Code | Start Claude with `claude --dangerously-load-development-channels server:zen` for channel delivery where supported. |
| Codex | The bridge queues to the bound conversation. See [Codex integration](codex.md). |
| T3 Code | The MCP server uses the connected thread when its T3 context is available. |
| OpenCode | The hook installer adds an OpenCode plugin for delivery. |
| Other clients | Pick up pending items with the next tool result, or choose **Clipboard** to paste manually. |

From a built checkout, `node dist/cli.js hooks install` sets up the supported
client hooks and plugin. Use `hooks uninstall` to remove them. Optional
`node dist/cli.js skill install` installs the agent guide for Claude Code and
Codex. Use `node dist/cli.js doctor` to see detected setup. If delivery fails
or the chosen session is gone, the browser can copy the pick to the clipboard.

To record a workflow, use **Record steps for an agent…** or respond when an
agent calls `show_me`. Press **Finish**, review or delete steps, and mark values
that change before saving. Recorded steps include clicks and field changes.
Values typed into recognized secret fields are excluded. Recipes are stored
locally. Agents can read them with `recipes` and repeat the steps with the
browser tools. Use `node dist/cli.js recipes list` or `recipes show <id>` from
the CLI.

## Clipboard and extensions

`clipboard` reads or writes system text and can copy, cut, or paste through
the specified tab or its open extension panel. The built-in modes ask separately for
each operation, including standard clipboard shortcuts. A target change while
awaiting consent invalidates the operation. The clipboard is shared with
other apps and approved writes have no automatic undo.

Use `extensions list` to see installed extensions and which have toolbar actions.
`extensions open` invokes the toolbar action. Use `read`, `find`, `computer`,
or `form_input` with panel refs, then `close`. A toolbar action without a popup
can still be invoked. Selecting a different tab for an extension asks in the
built-in modes. Dismiss blocking browser dialogs and read fresh refs after
reopening a panel. Tool access covers toolbar UI. Extension background code
and sidebar-only interfaces are outside this surface.

## Downloads

Use `downloads wait` after a click or navigation that starts a file. When it
finishes the tool returns its path, size and SHA-256 when available. For a
large file, use `until: "start"` and follow the events file for progress.
`downloads cancel` stops a tracked file and removes its partial data.

If `wait` reports `waiting_for_user`, choose Save or Cancel in the browser's
file-handling dialog. Save is followed by another `wait`. Cancel clears the
pending state. The dialog status has no download ID or events file.
