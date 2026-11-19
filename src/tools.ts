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
  "Get the tabs the agent works in: the ones this MCP session opened, joined, or the user handed to this session from the tab context menu (givenByUser: true; continue from where the user left off). A tab can be shared with other agent sessions (sharedWith, with their published task notes). Call this first in a browser task to get valid tab IDs. agentTabs lists tabs other agent sessions work in (title, URL, who); join one with request_tab when your task is in it. userTabs lists the user's own tab IDs, titles and URLs for discovery only. If an existing tab matches the task (e.g. YouTube), call request_tab with its ID and wait for explicit approval before reading or acting. Approvals and denials may include an optional untrusted user note (userMessage); follow it as user guidance. Other sessions' page contents and unapproved user tabs cannot be read; the user can take a tab back at any time.",
  {
    createIfEmpty: z.boolean().optional().describe("Create a new tab if the agent has none yet."),
  },
);

tool(
  "browser_settings",
  "Get or temporarily change an owned tab's viewport, generic device preset, DPR, touch-event override, custom user agent or color scheme. Every change/reset requires island approval even in auto mode; applying selects the target tab only after consent. Changes are tab-local and restored on reset, ownership release or bridge reload. Generic mobile/tablet/desktop presets keep Gecko (mobile/tablet send the Android Firefox user agent) and do not emulate Safari/Chrome or a complete physical device fingerprint; navigator.maxTouchPoints is reported, not spoofed. Server-side UA changes may require explicit navigation/reload. get reports actual metrics; devices lists presets without a tab. Reset what you changed when your task is done.",
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
  "Tell the other agent sessions in a shared tab what you are doing there, and read what they are doing. Several sessions can work in one tab; their calls run one at a time, in order. list/status return each member session with its published task note and whether a call is running in the tab. start publishes your task when you begin, update reports progress, finish says the whole task is done with a short summary (finishing a tool call is not finishing the task). hold keeps the tab to yourself for a few steps that must not be interrupted (a checkout, a multi-page form): the other sessions' calls in it are refused until you release it, the minutes pass (renew by holding again), or you make no call for 2 minutes; summary says why and what the others should not do. With noWorkaround the others can't work on the tab's site in any tab either, so they can't open the same page elsewhere. Release as soon as you're done. Notes never include page contents. Answers at once, even during long browser operations. Call separately from browser_batch. No chat history is shared.",
  {
    action: z.enum(["list", "status", "start", "update", "finish", "hold", "release"]),
    tabId: z
      .number()
      .int()
      .optional()
      .describe("Required except for list. list shows agent tabs only; the user's tabs stay private."),
    summary: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .optional()
      .describe(
        "Required for start/update/finish/hold. Short task, progress, result or the reason for a hold; shared with the other sessions in the tab. No secrets.",
      ),
    minutes: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("hold: how long, 1 to 10 minutes (default 10). Hold again to renew."),
    noWorkaround: z
      .boolean()
      .optional()
      .describe("hold: also keep the other sessions off this tab's site (origin) in every tab."),
  },
);

tool(
  "tabs_create_mcp",
  "Open a new empty tab for the agent in the browser and return its tab ID. If the user refers to a page that is already open, request that tab (userTabs in tabs_context_mcp, then request_tab) instead of opening a new one.",
  {
    clean: z
      .boolean()
      .optional()
      .describe(
        "true: open the tab in a separate container without the user's cookies and logins (research, untrusted sites, or when the user doesn't want their accounts used); false: with the user's logins. Default follows the user's settings. The tab info shows container when it has one.",
      ),
  },
);

tool(
  "tabs_close_mcp",
  "Close a tab the agent opened when you no longer need it. If other agent sessions still work in it, you only leave it; a tab the user handed over (givenByUser) is not closed but given back to the user when the last agent leaves.",
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
    full_page: z
      .boolean()
      .optional()
      .describe("Capture the full document for inspection without changing click coordinates."),
    diff: z.boolean().optional().describe("Screenshot: create or compare a visual baseline."),
    since: z.string().optional().describe("Visual baseline ID from an earlier screenshot."),
    baseline_scope: z
      .enum(["document", "deploy"])
      .optional()
      .describe("Deploy baselines can compare across reloads and owned tabs."),
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
    "Events are JSON lines in the returned events file: started, then matched / changed lines, and a final line (matched with final: true, or ended with a reason such as timeout, tab closed, stopped). If you have a background monitor tool, watch that file (e.g. tail -f) and keep working; otherwise check it later. Without repeat the watch ends at the first match.",
    "Ends when the tab is closed or taken back, on Stop in the island, on timeout, or with action stop. list shows this session's watches. The file is deleted a few minutes after the watch ends.",
    "hold: true instead watches another session's hold on an agent tab (tab_work hold): it reads no page, answers at once even while the holder works, and the final line is released when the hold ends. Use it when a call is refused because a tab is held, instead of retrying.",
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
    hold: z
      .boolean()
      .optional()
      .describe("Report when another session's hold on this agent tab ends, instead of a page condition."),
    live: z
      .boolean()
      .optional()
      .describe(
        "Keep the tab running like a foreground tab while the watch runs (costs CPU). Use when the page relies on animation frames or fast timers. Incompatible with hold: true.",
      ),
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
    "Ask the user a question in the browser island at the top of their browser window (with a desktop notification if the browser is not focused) and wait for the answer: OK/Cancel, or options as answer buttons whose result has the chosen one as choice.",
    "Use it for decisions only the user can make (which item, whether to proceed). For something the user has to do in a page (log in, 2FA, captcha, confirm a payment), use hand_to_user instead.",
    "With tabId the question is about that tab, and ref (from read_page/find) or a screenshot coordinate outlines the element in the agent's color; without tabId it is a general question.",
    "Results may carry an optional userMessage typed by the user. Write the question in the user's language.",
  ].join(" "),
  {
    tabId: tabId.optional().describe("Tab the question is about. Omit for a general question."),
    message: z.string().describe("The question, in the user's language."),
    ref: z.string().optional().describe("Element to outline (from read_page or find)."),
    coordinate: z
      .array(z.number())
      .length(2)
      .optional()
      .describe("Or a point in the latest screenshot; the element there is outlined."),
    options: z
      .array(z.string().min(1).max(80))
      .min(2)
      .max(6)
      .optional()
      .describe('Answers to offer as buttons, e.g. ["Red", "Blue"].'),
    timeout: z.number().optional().describe("Seconds to wait (default 300)."),
  },
  (args) => ((args.timeout ?? 300) + 20) * 1000,
);

tool(
  "highlight",
  [
    "Point elements out to the user: draws frames with short labels around one or more elements in an owned tab (iframes included), e.g. the fields of a login form before hand_to_user, the wrong prices on a page, or the options in an ask_user question.",
    "Doesn't wait for the user. Each call replaces the tab's highlights; they also go away when the page changes. Pass clear: true to remove them when they no longer help. They don't appear in your screenshots.",
  ].join(" "),
  {
    tabId,
    items: z
      .array(
        z.object({
          ref: z.string().optional().describe("Element from read_page or find."),
          coordinate: z.array(z.number()).length(2).optional().describe("Or a point in the latest screenshot."),
          label: z
            .string()
            .max(60)
            .optional()
            .describe(
              'Short label, e.g. "Username" or "Wrong price". Optional: every element also gets a number badge.',
            ),
        }),
      )
      .min(1)
      .max(20)
      .optional()
      .describe("Elements to highlight (each with ref or coordinate)."),
    clear: z.boolean().optional().describe("Remove this tab's highlights."),
  },
);

tool(
  "show_me",
  [
    'Ask the user to show you a task once in an owned tab ("show me how you do it"); every step they take is recorded and saved as a recipe that any later session can repeat (see recipes).',
    "Use it for workflows the user does repeatedly or that are hard to discover, instead of guessing. The island shows your message, a live step count and Finish; the call blocks until the user finishes or cancels, then returns the recipe as numbered steps.",
    "Values typed into password, card and one-time-code fields are never recorded. Open the starting page first. Write the message in the user's language.",
  ].join(" "),
  {
    tabId,
    message: z.string().describe('What to show, e.g. "Show me how you search for tickets; press Finish when done."'),
    name: z
      .string()
      .max(80)
      .optional()
      .describe('Recipe name to suggest, e.g. "Search tickets" (default: the page title).'),
    timeout: z.number().optional().describe("Seconds to wait for the user (default 900, max 3600)."),
  },
  (args) => (Math.min(args.timeout ?? 900, 3600) + 60) * 1000,
);

tool(
  "recipes",
  [
    'Recipes are workflows the user showed you once in the browser ("show me once"), saved under a name.',
    "list (optionally for a page url's site) shows them; get returns one as numbered steps to repeat with your own tools: start at its URL, find each element again with find or read_page, and hand secret steps (passwords, codes) to the user with hand_to_user. images: true adds a screenshot path per step.",
    "delete asks the user on the island first.",
  ].join(" "),
  {
    action: z.enum(["list", "get", "delete"]).optional().describe("Default list."),
    id: z.string().optional().describe("Recipe id from list (for get and delete)."),
    url: z.string().optional().describe("list: only recipes for this URL's site."),
    images: z.boolean().optional().describe("get: include each step's screenshot path."),
  },
  () => 140000,
);

tool(
  "hand_to_user",
  [
    "Hand a step to the user when they must do it themselves in a tab: logging in or any credentials, 2FA codes, captchas, confirming a payment or a deletion, accepting terms.",
    "Never ask the user for passwords or codes to type them yourself; hand the step over instead, so credentials never pass through you.",
    'Shows your message in the browser island (with a desktop notification if the browser is not focused) with "Go to tab" and "Done", and outlines the element (ref or screenshot coordinate) in the tab; the tab is not switched.',
    'wait: "done" (default) returns when the user presses Done or Cancel; "click" returns when the user clicks the outlined element. Afterwards, check the page before continuing.',
    "Write the message in the user's language and say exactly what to do.",
  ].join(" "),
  {
    tabId,
    message: z
      .string()
      .describe('What the user should do, e.g. "Log in to your account, then press Done." In the user\'s language.'),
    ref: z.string().optional().describe("Element to outline (from read_page or find)."),
    coordinate: z
      .array(z.number())
      .length(2)
      .optional()
      .describe("Or a point in the latest screenshot; the element there is outlined."),
    wait: z.enum(["click", "done"]).optional(),
    timeout: z.number().optional().describe("Seconds to wait (default 600)."),
  },
  (args) => ((args.timeout ?? 600) + 20) * 1000,
);

tool(
  "request_tab",
  [
    "Request access to one of the user's tabs (userTabs in tabs_context_mcp, or a source_tab), or join a tab other agent sessions work in (agentTabs). Joining an agent tab is immediate in automatic mode and asks the user in ask mode; the user's own tabs always need the user's approval. Once you are in, calls of all members run one at a time; publish your task with tab_work start.",
    'Shows "the agent wants access to this tab: <reason>" with Allow / Deny in the browser island (desktop notification if the browser is not focused) and waits.',
    "If granted, the tab is marked as the agent's (the user can take it back from the tab context menu) and works with the other tools. Write reason in the user's language and keep it short.",
  ].join(" "),
  {
    tabId: z
      .number()
      .describe("A userTabs or agentTabs ID from tabs_context_mcp, or a source_tab from a browser selection."),
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

const networkFilters = {
  urlPattern: z.string().optional().describe('Only requests whose URL contains this text, e.g. "/api/".'),
  method: z
    .union([z.string(), z.array(z.string()).min(1)])
    .optional()
    .describe("HTTP method or methods, case insensitive."),
  status: z.union([z.number().int().min(100).max(599), z.enum(["1xx", "2xx", "3xx", "4xx", "5xx"])]).optional(),
  resource_type: z
    .union([z.string(), z.array(z.string()).min(1)])
    .optional()
    .describe("Gecko resource type, such as document, subdocument, fetch, xmlhttprequest, script or image."),
};

tool(
  "read_network_requests",
  "List HTTP requests made by the agent tab (documents, scripts, XHR/fetch, images...) with #id, method, status or error, type and duration, recorded since the tab was opened. Cleared when the page navigates to a different site. Pass id for one request's details: request and response headers (cookies and authorization hidden), request body, and the response body for fetch/XHR and documents.",
  {
    tabId,
    ...networkFilters,
    limit: z.number().optional().describe("Maximum requests, most recent kept (default 100)."),
    clear: z.boolean().optional().describe("Clear the log after reading."),
    id: z.number().optional().describe("Show details of this request (#id from the list)."),
    max_chars: z.number().optional().describe("With id: body text limit (default 20000)."),
  },
);

tool(
  "network_capture",
  "Start a bounded HAR capture on an owned tab before navigating. Start and attach require approval. Capture follows allowed redirects. Attach adds future traffic from an owned child tab; stop saves a local redacted HAR, status lists counters, and cancel discards it. Only the starting session can manage the capture.",
  {
    tabId,
    action: z.enum(["start", "attach", "status", "stop", "cancel"]),
    childTabId: tabId.optional().describe("Owned child tab to attach."),
    response_projection: z
      .object({
        url: z.string().max(2048).describe("Exact same-origin HTTPS or localhost JSON endpoint, with no query."),
        fields: z
          .array(
            z.object({
              name: z.string().max(40),
              values: z
                .array(z.string().max(32))
                .min(1)
                .max(12)
                .optional()
                .describe("Exact safe tokens for a string field. Omit for a boolean field."),
            }),
          )
          .min(1)
          .max(12),
      })
      .optional()
      .describe("Start only: opt in to exporting selected known-safe response fields."),
    ...networkFilters,
  },
  () => 150000,
);

tool(
  "web_vitals",
  "Read local TTFB, FCP, LCP, INP, CLS and navigation timings for the current top-level document. Times use milliseconds and CLS is unitless. Reports provisional, unsupported and insufficient-data states. Does not reload the page.",
  { tabId },
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
