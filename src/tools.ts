// The browser tools as MCP clients see them. Names and parameters follow Claude in Chrome; the
// work is done by the bridge in the browser (browser/main.js).
import { z } from "zod";

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  // How long to wait for the browser's answer (ms); tools that wait for the user need longer.
  timeout?: (args: any) => number;
};

export const TOOLS: ToolDef[] = [];
const tool = (name: string, description: string, inputSchema: z.ZodRawShape, timeout?: (args: any) => number) => {
  TOOLS.push({ name, description, inputSchema, timeout });
};

// Allow the island's full response window for each clipboard/attention prompt.
function consentTimeout(name: string, args: any): number | undefined {
  if (
    ((name === "computer" && args.action === "type") ||
      (name === "extensions" && args.action === "computer" && args.computerAction === "type")) &&
    args.typing === "human"
  ) {
    return Math.min(600000, 10000 + [...String(args.text || "")].length * (args.delay_ms ?? 65) * 3.5) + 135000;
  }
  if (name === "browser_settings") return 150000;
  if (name === "clipboard") return 135000;
  if (name === "extensions" && args.action === "open") return 270000;
  if (
    (name === "computer" && args.action === "key") ||
    (name === "extensions" && args.action === "computer" && args.computerAction === "key")
  ) {
    const keys = String(args.text || "")
      .trim()
      .split(/\s+/).length;
    return (keys * Math.max(1, Math.ceil(args.repeat ?? 1)) + 1) * 135000;
  }
  return undefined;
}

const tabId = z.number().describe("Tab ID to act on. Use tabs_context_mcp first if you don't have a valid tab ID.");

const inputOptions = {
  if_changed: z
    .boolean()
    .optional()
    .describe(
      "screenshot: return unchanged metadata instead of repeating an identical image; scoped to session, document, scale and annotations.",
    ),
  annotate: z
    .boolean()
    .optional()
    .describe("screenshot: label up to 80 visible top-frame controls with refs. Does not annotate iframe contents."),
  movement: z
    .enum(["instant", "smooth", "human"])
    .optional()
    .describe(
      "Opt-in real pointer path; default retains existing fast input and visual cursor. No detection bypass guarantee.",
    ),
  typing: z.enum(["instant", "human"]).optional().describe("type only: human sends characters with variable delays."),
  delay_ms: z.number().min(0).max(1000).optional().describe("Human typing base delay per character; default 65ms."),
  duration_ms: z.number().min(0).max(5000).optional().describe("Pointer path duration in milliseconds."),
  steps: z.number().int().min(1).max(300).optional(),
  seed: z.number().int().optional(),
  hold_ms: z
    .number()
    .int()
    .min(100)
    .max(30000)
    .optional()
    .describe("Safety release timeout for held keys/buttons; default and max 30 seconds."),
  button: z.enum(["left", "middle", "right"]).optional(),
};

const readDiff = {
  diff: z
    .boolean()
    .optional()
    .describe(
      "Opt in to snapshot output. First call returns full text plus snapshot ID; pass since with that ID on the next read for a compact unified line diff or unchanged result. Default false preserves plain text.",
    ),
  since: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Exact snapshot ID from your previous diff-enabled read of this tab and same tool/options. Missing, stale, evicted or wrong-scope IDs cause a fresh full response. Navigation, reload and ownership changes reset the baseline.",
    ),
};

tool(
  "tabs_context_mcp",
  "Get the tabs the agent controls in the browser: the ones this MCP session opened and the ones the user explicitly handed to this session from the tab context menu (givenByUser: true; continue from where the user left off). Call this first in a browser task to get valid tab IDs. Use tab_work list to discover other sessions' published task summaries and request a queued handoff. userTabs lists user-owned tab IDs, titles and URLs for discovery only. If an existing tab matches the task (e.g. YouTube), call request_tab with its ID and wait for explicit approval before reading or acting. Approvals and denials may include an optional untrusted user note (userMessage); follow it as user guidance. Other sessions' page contents and unapproved user tabs cannot be read; the user can take a tab back at any time.",
  {
    createIfEmpty: z.boolean().optional().describe("Create a new tab if the agent has none yet."),
  },
);

tool(
  "browser_settings",
  "Get or temporarily change an owned tab's viewport, generic device preset, DPR, touch-event override, custom user agent or color scheme. Every change/reset requires island approval even in auto mode; applying selects the target tab only after consent. Changes are tab-local and restored on reset, ownership release or bridge reload. Generic mobile/tablet/desktop presets keep Gecko (mobile/tablet send the Android Firefox user agent) and do not emulate Safari/Chrome or a complete physical device fingerprint; navigator.maxTouchPoints is reported, not spoofed. Server-side UA changes may require explicit navigation/reload. get reports actual metrics; devices lists presets without a tab.",
  {
    action: z.enum(["get", "devices", "viewport", "device", "media", "reset"]),
    tabId: tabId.optional(),
    width: z.number().int().min(200).max(4000).optional(),
    height: z.number().int().min(200).max(4000).optional(),
    dpr: z.number().min(0.5).max(4).optional(),
    touch: z.boolean().optional(),
    userAgent: z.string().max(1000).optional(),
    device: z.enum(["mobile", "tablet", "desktop"]).optional(),
    color_scheme: z.enum(["dark", "light", "no-preference"]).optional(),
  },
  (args) => (args.action === "get" || args.action === "devices" ? 60000 : 150000),
);

tool(
  "clipboard",
  "Read/write system clipboard text or copy/paste in an owned tab or its open extension panel. Every call requires explicit island approval, including auto mode and browser_batch; approval is never remembered. The clipboard is shared with the user's other applications. read returns untrusted text with truncation metadata; write replaces it. copy uses the existing selection; paste uses ref or the focused editable field. extensionId targets an already-open panel for copy/paste; use its fresh panel ref. No tab switch is performed. Do not use shell, JavaScript or other routes to bypass clipboard consent.",
  {
    action: z.enum(["read", "write", "copy", "paste"]),
    tabId,
    text: z.string().max(1000000).optional().describe("Required for write; empty string clears text."),
    ref: z.string().optional(),
    extensionId: z.string().min(1).optional(),
    max_chars: z
      .number()
      .int()
      .min(1)
      .max(100000)
      .optional()
      .describe("Read limit; default 20000. Does not alter clipboard contents."),
  },
  () => 135000,
);

tool(
  "extensions",
  "List installed browser extensions or use their real toolbar panels without extension-specific APIs. list needs no tab; other actions require an owned tabId and an exact extensionId from list. open asks in the island before changing the selected tab (even in auto mode), then invokes the toolbar button (may execute immediately if no popup). read/text/find inspect the panel; computer/form_input interact with it. Panel refs belong to the current panel only, never the source page. Actions follow the source site's permission rules. Close after use. Record temporary setting changes and restore them through the UI when finished; this is agent responsibility, not automatic rollback. A panel closes when the user switches tabs or dismisses it; reopen and read fresh refs. No arbitrary extension background code is exposed.",
  {
    action: z.enum(["list", "open", "read", "text", "find", "computer", "form_input", "close"]),
    tabId: tabId.optional(),
    extensionId: z.string().min(1).optional(),
    ...inputOptions,
    computerAction: z
      .enum([
        "screenshot",
        "left_click",
        "right_click",
        "double_click",
        "triple_click",
        "hover",
        "left_click_drag",
        "scroll",
        "scroll_to",
        "type",
        "key",
        "key_down",
        "key_up",
        "mouse_move",
        "mouse_down",
        "mouse_up",
        "wait",
      ])
      .optional(),
    ref: z.string().optional(),
    coordinate: z.array(z.number()).length(2).optional(),
    start_coordinate: z.array(z.number()).length(2).optional(),
    text: z.string().optional(),
    query: z.string().optional(),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    scroll_direction: z.enum(["up", "down", "left", "right"]).optional(),
    scroll_amount: z.number().optional(),
    duration: z.number().min(0).max(30).optional(),
    scale: z.number().min(0.1).max(1).optional(),
    filter: z.enum(["all", "interactive"]).optional(),
    depth: z.number().optional(),
    max_chars: z.number().min(1).max(100000).optional(),
  },
);

tool(
  "tab_work",
  "Coordinate shared browser tabs without reading other sessions' pages. list/status return owner, published task, execution state, FIFO queue and handoff note. start/update publish your task; finish explicitly releases a completed task for handoff (auto transfers to the first connected waiter; ask requires request_tab approval). request queues/renews your request without blocking or interrupting the owner; cancel removes your request. Status/request remain responsive during long browser operations. Busy/stale/disconnected tasks are never silently treated as finished. Call separately from browser_batch. After transfer, read the handoff note and refresh the page state. No chat history is shared.",
  {
    action: z.enum(["list", "status", "start", "update", "finish", "request", "cancel"]),
    tabId: z
      .number()
      .int()
      .optional()
      .describe("Required except for list. list discovers agent-owned tabs only; user tabs stay private."),
    summary: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .optional()
      .describe(
        "Required for start/update/finish/request. Short task, progress, handoff note or requested work; shared with other sessions. No secrets.",
      ),
  },
);

tool("tabs_create_mcp", "Open a new empty tab for the agent in the browser and return its tab ID.", {});

tool(
  "tabs_close_mcp",
  "Close a tab the agent opened when you no longer need it. A tab the user handed over (givenByUser) is not closed but given back to the user.",
  { tabId },
);

tool(
  "navigate",
  'Navigate a tab to a URL and wait for the page to load. Use "back" or "forward" for history navigation.',
  {
    url: z.string().describe('URL to open (the scheme is added if missing), or "back" / "forward".'),
    tabId,
  },
);

tool(
  "computer",
  [
    "Use the mouse and keyboard in a browser tab and take screenshots. Input is delivered as real (trusted) browser input.",
    "Coordinates are pixels in the most recent screenshot of that tab, so take a screenshot before clicking.",
    "Instead of a coordinate, clicks, hover and scroll accept ref (from read_page or find): the element is scrolled into view and its center is used.",
    'Actions: screenshot, left_click, right_click, double_click, triple_click, hover, left_click_drag (start_coordinate → coordinate), scroll (coordinate or ref, scroll_direction, scroll_amount), scroll_to (ref), type (text), key (text, e.g. "Return", "ctrl+a", "Tab Tab Return"; repeat), wait (duration in seconds).',
    "Ref clicks verify the target is hit-testable, including enclosing iframes. Covered, moved or disabled targets fail before mouse-down; inspect the reported blocker or refresh screenshot/read_page. Coordinate clicks cannot infer a hidden intended target, so prefer ref for controls. Never bypass an obstruction with page JavaScript. Multi-click actions stop if an earlier click changes the target. Hover/scroll_to remain available for covered elements.",
    "key_down/key_up hold/release one key across calls; mouse_move/down/up support explicit mouse control. Holds are session/frame scoped, automatically released on Stop, errors, navigation, transfer, disconnect, reload or a 30-second deadline. Human typing/movement options are optional, not detection bypass guarantees.",
    'For clicks, text can hold held modifiers such as "shift" or "ctrl+shift".',
  ].join(" "),
  {
    action: z.enum([
      "screenshot",
      "left_click",
      "right_click",
      "double_click",
      "triple_click",
      "hover",
      "left_click_drag",
      "scroll",
      "scroll_to",
      "type",
      "key",
      "wait",
      "key_down",
      "key_up",
      "mouse_move",
      "mouse_down",
      "mouse_up",
    ]),
    ...inputOptions,
    coordinate: z.array(z.number()).length(2).optional().describe("[x, y] in screenshot pixels."),
    ref: z
      .string()
      .optional()
      .describe('Element reference from read_page or find (e.g. "ref_12"), instead of coordinate.'),
    start_coordinate: z.array(z.number()).length(2).optional().describe("Drag start [x, y]."),
    text: z.string().optional().describe("Text to type, keys to press, or click modifiers."),
    scroll_direction: z.enum(["up", "down", "left", "right"]).optional(),
    scroll_amount: z.number().optional().describe("Scroll ticks (100px each). Default 3."),
    duration: z.number().optional().describe("Seconds to wait (max 30)."),
    scale: z
      .number()
      .optional()
      .describe(
        "screenshot only: 0.1–1, shrinks the image (tokens ~scale²); coordinates are pixels of the returned image.",
      ),
    repeat: z.number().optional().describe("How many times to repeat a key action."),
    tabId,
  },
);

tool(
  "read_page",
  [
    "Get the page as an accessibility-style tree: roles, names, values and states, each element with a ref (e.g. ref_12) usable in computer, form_input and read_page.",
    "Cheaper and more precise than a screenshot for finding and operating controls. Refs stay valid until the page navigates.",
    "Iframes (cross-origin too) are included under [iframe url]; their refs look like ref_3_f12 and work with every tool.",
    'filter: "interactive" lists only controls (buttons, links, inputs...) as a flat list; default "all" includes headings, landmarks and text.',
  ].join(" "),
  {
    tabId,
    ...readDiff,
    filter: z.enum(["all", "interactive"]).optional(),
    depth: z.number().optional().describe("Maximum DOM depth to walk (default 30)."),
    ref_id: z.string().optional().describe("Only return the subtree of this element."),
    max_chars: z.number().optional().describe("Output size limit (default 50000)."),
  },
);

tool(
  "find",
  "Find elements by keywords matched against their accessible name, text, placeholder, title, id, name and href (not natural-language understanding: use words that appear on the element). Returns up to 20 matches with refs, interactive elements first.",
  {
    tabId,
    query: z.string().describe('Keywords, e.g. "search", "sign in", "email".'),
  },
);

tool(
  "wait_for",
  [
    "Wait until something is true on the page instead of sleeping: text appears (anywhere, iframes included), an element matching a CSS selector is visible (with text: one that contains it), and/or the network is idle (no requests for 0.5 s).",
    "gone: true waits for the text/selector to disappear (e.g. a spinner). Keeps waiting across navigations, so it works right after submitting a form. Fails with an error on timeout (stops a browser_batch). Blocks the agent for at most 60 s: for anything that may take longer, use watch.",
  ].join(" "),
  {
    tabId,
    text: z.string().optional().describe("Text to wait for (case-insensitive)."),
    selector: z.string().optional().describe("CSS selector to wait for."),
    gone: z.boolean().optional().describe("Wait for text/selector to disappear instead."),
    network_idle: z.boolean().optional().describe("Also wait until no request is in flight for 0.5 s."),
    timeout: z.number().optional().describe("Seconds (default 10, max 60)."),
  },
  (args) => (Math.min(args.timeout ?? 10, 60) + 15) * 1000,
);

tool(
  "watch",
  [
    "Watch an agent tab in the background without blocking: report when text appears (anywhere, iframes included), when an element matching a CSS selector is visible (with text: one containing it), or with gone: true when it disappears; or with change: true every time the text of the first visible element matching selector changes (a price, a counter, a status).",
    "Events are JSON lines in the returned events file: started, then matched / changed lines, and a final line (matched with final: true, or ended with a reason such as timeout, tab closed, stopped). If you have a background monitor tool, watch that file (e.g. tail -f) and keep working; otherwise check it later. Without repeat the watch ends at the first match. The page keeps working normally; the watch only reads.",
    "Ends when the tab is closed or taken back, on Stop in the island, on timeout, or with action stop. list shows this session's watches. The file is deleted a few minutes after the watch ends.",
  ].join(" "),
  {
    tabId: tabId.optional(),
    action: z.enum(["start", "list", "stop"]).optional().describe("Default start (needs tabId)."),
    id: z.number().int().optional().describe("Watch id for stop."),
    text: z.string().optional().describe("Text to watch for (case-insensitive)."),
    selector: z.string().optional().describe("CSS selector to watch for, or whose text to follow with change."),
    gone: z.boolean().optional().describe("Report when text/selector disappears instead."),
    change: z.boolean().optional().describe("Report every change of selector's text instead of a condition."),
    repeat: z.boolean().optional().describe("Keep watching after a match and report each new match."),
    interval: z.number().optional().describe("Seconds between checks (default 2, 0.5 to 60)."),
    timeout: z.number().optional().describe("Seconds until the watch ends (default 3600, max 86400)."),
  },
);

tool(
  "downloads",
  [
    "Track files downloaded from an agent tab (or a popup it opened): state (downloading, done, failed, canceled, paused), source url, filename, absolute path, size or progress, sha256 when done.",
    "A running download also has an events file: JSON lines written when it starts, every 10% and when it ends (the last line has state done/failed/canceled, plus sha256 when done). For long downloads, if you have a background monitor tool, call wait with until: start right after the click, watch the returned events file (e.g. tail -f) and keep working; otherwise use wait. The file is deleted automatically a few minutes after the download ends.",
    "action wait: call right after the click/navigation that starts a download; blocks until the oldest download not yet reported (or the next one to start) finishes, so call it once per expected file. Pass id to wait for a specific one. list shows all downloads from the tab. cancel stops download id and deletes its partial file.",
  ].join(" "),
  {
    tabId,
    action: z.enum(["list", "wait", "cancel"]).optional().describe("Default list."),
    id: z.number().int().optional().describe("With wait: the download #id from list. Required for cancel."),
    until: z
      .enum(["start", "end"])
      .optional()
      .describe(
        "With wait: end (default) waits for the file; start returns as soon as it begins, with its events file.",
      ),
    timeout: z.number().optional().describe("With wait: seconds (default 120, max 600)."),
  },
  (args) => (args.action === "wait" ? Math.min(args.timeout ?? 120, 600) + 15 : 60) * 1000,
);

tool(
  "form_input",
  "Set a form control's value by ref: text inputs and textareas (value), selects (option value or visible text), checkboxes and radios (true/false), contenteditable (text). Fires input/change events so frameworks like React notice. To type with real keystrokes, click the field and use computer type instead.",
  {
    tabId,
    ref: z.string().describe("Element reference from read_page or find."),
    value: z.union([z.string(), z.number(), z.boolean()]),
  },
);

tool(
  "get_page_text",
  "Get the readable text of the page (main/article content if present, otherwise the body), with title and URL.",
  { tabId, ...readDiff },
);

tool(
  "ask_user",
  [
    "Hand a step to the user when they must do it themselves (confirming a payment or deletion, solving a captcha, logging in, choosing something only they know), or ask them a question.",
    "Shows your message in the browser island at the top of the user's browser window (with a desktop notification if the browser is not focused) and outlines the element (ref from read_page/find, or a screenshot coordinate) in the agent's color in the tab; the tab is not switched, the user opens it from the island. Waits for the user.",
    'wait: "click" returns when the user clicks the outlined element; "done" (default) shows OK/Cancel in the island and returns which they pressed. The user can always cancel.',
    'options: 2-6 short answers shown as buttons instead of OK; the result has the chosen one as choice. Without tabId the question is not tied to a tab (no outline, no ref/coordinate, no wait: "click").',
    "Results may carry an optional userMessage typed by the user. Write the message in the user's language and say exactly what to do.",
  ].join(" "),
  {
    tabId: tabId.optional().describe("Tab the step or question is about. Omit for a general question."),
    message: z
      .string()
      .describe(
        "What the user should do, e.g. \"Check the amount and press Confirm if it's right.\" Write it in the user's language.",
      ),
    ref: z.string().optional().describe("Element to outline (from read_page or find)."),
    coordinate: z
      .array(z.number())
      .length(2)
      .optional()
      .describe("Or a point in the latest screenshot; the element there is outlined."),
    wait: z.enum(["click", "done"]).optional(),
    options: z
      .array(z.string().min(1).max(80))
      .min(2)
      .max(6)
      .optional()
      .describe('Answers to offer as buttons, e.g. ["Red", "Blue"]. Needs wait: "done".'),
    timeout: z.number().optional().describe("Seconds to wait (default 300)."),
  },
  (args) => ((args.timeout ?? 300) + 20) * 1000,
);

tool(
  "request_tab",
  [
    "Request access to an existing user tab from tabs_context_mcp userTabs or source_tab, or claim an agent-owned tab after its owner finishes. For busy agent tabs this queues a FIFO request and returns task context immediately; it never interrupts. In auto mode finished agent tabs transfer automatically; in ask mode the first waiter uses this tool for approval. User-owned tabs always require explicit approval.",
    'Shows "the agent wants access to this tab: <reason>" with Allow / Deny in the browser island (desktop notification if the browser is not focused) and waits.',
    "If granted, the tab is marked as the agent's (the user can take it back from the tab context menu) and works with the other tools. Write reason in the user's language and keep it short.",
  ].join(" "),
  {
    tabId: z
      .number()
      .describe(
        "A userTabs ID from tabs_context_mcp, a source_tab from a browser selection, or an agent-owned tab ID from tab_work list.",
      ),
    reason: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .describe('Why you need the tab, e.g. "I want to see the button\'s hover state live."'),
    timeout: z.number().optional().describe("Seconds to wait (default 120)."),
  },
  (args) => ((args.timeout ?? 120) + 20) * 1000,
);

tool(
  "file_upload",
  "Put local files into a file input without opening a file picker. ref can be the file input itself or an upload button/drop zone: a nearby (often hidden) input[type=file] is used. Use absolute paths.",
  {
    tabId,
    ref: z.string().describe("The file input, or the upload button/area (from read_page or find)."),
    paths: z.array(z.string()).min(1).describe("Absolute paths of the files to upload."),
  },
  () => 90_000,
);

tool(
  "handle_dialog",
  "Answer a JavaScript dialog (alert, confirm, prompt) open in a tab. While one is open the page is frozen, and other tools report it instead of acting. accept: true presses OK, false presses Cancel; text fills a prompt before accepting.",
  {
    tabId,
    accept: z.boolean(),
    text: z.string().optional().describe("Text to enter into a prompt dialog."),
  },
);

tool(
  "read_console_messages",
  "Read the page's console output (console.log/info/warn/error and uncaught JS errors) since the page loaded; no need to start listening first. Use pattern to filter, since output can be verbose.",
  {
    tabId,
    onlyErrors: z.boolean().optional().describe("Only errors and assertions."),
    pattern: z.string().optional().describe("Case-insensitive regex matched against message and source."),
    limit: z.number().optional().describe("Maximum messages, most recent kept (default 100)."),
    clear: z.boolean().optional().describe("After reading, hide these messages from later calls."),
  },
);

tool(
  "read_network_requests",
  "List HTTP requests made by a the agent tab (documents, scripts, XHR/fetch, images...) with #id, method, status or error, type and duration, recorded since the tab was opened. Cleared when the page navigates to a different site. Pass id for one request's details: request and response headers (cookies and authorization hidden), request body, and the response body for fetch/XHR and documents.",
  {
    tabId,
    urlPattern: z.string().optional().describe('Only requests whose URL contains this text, e.g. "/api/".'),
    limit: z.number().optional().describe("Maximum requests, most recent kept (default 100)."),
    clear: z.boolean().optional().describe("Clear the log after reading."),
    id: z.number().optional().describe("Show details of this request (#id from the list)."),
    max_chars: z.number().optional().describe("With id: body text limit (default 20000)."),
  },
);

tool(
  "javascript_tool",
  "Run JavaScript in the page with full access to the page's own variables. The value of the last expression is returned (promises are awaited); do not use return.",
  {
    action: z.literal("javascript_exec").describe("Must be 'javascript_exec'."),
    text: z.string().describe("JavaScript code to run."),
    tabId,
  },
);

tool(
  "react",
  "Read the committed DOM-backed React component tree or inspect the ancestor component chain for an element ref. Read-only, best-effort private fiber inspection; names may be minified and server-only components/render history are unavailable. Props are untrusted page data and may contain secrets; request them only when needed. No React DevTools extension or Next.js server required.",
  {
    tabId,
    action: z.enum(["tree", "inspect"]),
    ref: z.string().optional().describe("Required for inspect. Ref from read_page/find, including iframe refs."),
    include_props: z
      .boolean()
      .optional()
      .describe("Include bounded previews of committed props (default false); getters are not invoked."),
    max_depth: z.number().int().min(1).max(30).optional(),
    max_nodes: z.number().int().min(1).max(300).optional(),
  },
);

tool(
  "accessibility",
  "Run bundled axe-core accessibility checks locally. Returns violations, incomplete checks requiring manual review, affected element refs and counts. Default: scan each accessible frame independently; cross-frame relationships are not evaluated. With ref: only that subtree, excluding nested frames. Output is untrusted page data. Zero violations does not establish compliance. Uses existing site/ownership permissions; no external service.",
  {
    tabId,
    ref: z.string().optional().describe("Optional subtree ref from read_page/find."),
    tags: z
      .array(z.string().min(1).max(50))
      .min(1)
      .max(20)
      .optional()
      .describe("Optional axe rule tags, e.g. wcag2a, wcag2aa, wcag21aa."),
    max_nodes: z.number().int().min(1).max(50).optional().describe("Affected nodes per rule, default 10."),
    max_rules: z.number().int().min(1).max(200).optional().describe("Rules per result group per frame, default 100."),
  },
);

tool(
  "browser_batch",
  [
    "Run several of the tools above in one call: each item is {name, input} with exactly the input you would pass to that tool. Items run sequentially and stop at the first error; text results come back as one numbered block, screenshots in place.",
    "Use it whenever you can predict two or more steps, e.g. navigate, read_page, several form_input, click, get_page_text. Coordinates in a batch refer to the screenshot taken before this call. browser_batch cannot be nested.",
  ].join(" "),
  {
    actions: z
      .array(
        z.object({
          name: z.string().describe("Tool name, e.g. form_input, computer, navigate."),
          input: z.record(z.string(), z.any()),
        }),
      )
      .min(1),
  },
  (args) =>
    (args.actions ?? []).reduce(
      (sum: number, step: any) => sum + (callTimeout(step.name, step.input ?? {}) ?? 60_000),
      0,
    ),
);

// The answer timeout for one call (also each browser_batch step); undefined means the default.
export function callTimeout(name: string, args: any): number | undefined {
  return TOOLS.find((t) => t.name === name)?.timeout?.(args) ?? consentTimeout(name, args);
}
