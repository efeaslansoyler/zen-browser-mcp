// MCP sunucusu: tool tanımları burada, işi Zen içindeki köprü (browser/main.js) yapar.
// Tool adları ve parametreleri Claude in Chrome ile aynı tutulur.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { call } from "./zen.ts";

const server = new McpServer({ name: "zen", version: "0.1.0" });

const tabId = z
  .number()
  .describe("Tab ID to act on. Use tabs_context_mcp first if you don't have a valid tab ID.");

function register(name: string, description: string, inputSchema: z.ZodRawShape) {
  server.registerTool(name, { description, inputSchema }, async (args: object) => {
    try {
      return { content: await call(name, args) };
    } catch (e) {
      return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
    }
  });
}

register(
  "tabs_context_mcp",
  "Get the tabs Claude controls in Zen. Call this first in a browser task to get valid tab IDs. Tabs the user opened themselves are not listed.",
  {
    createIfEmpty: z
      .boolean()
      .optional()
      .describe("Create a new tab if Claude has none yet."),
  },
);

register("tabs_create_mcp", "Open a new empty tab for Claude in Zen and return its tab ID.", {});

register(
  "navigate",
  "Navigate a tab to a URL and wait for the page to load. Use \"back\" or \"forward\" for history navigation.",
  {
    url: z.string().describe('URL to open (the scheme is added if missing), or "back" / "forward".'),
    tabId,
  },
);

register(
  "computer",
  [
    "Use the mouse and keyboard in a Zen tab and take screenshots. Input is delivered as real (trusted) browser input.",
    "Coordinates are pixels in the most recent screenshot of that tab, so take a screenshot before clicking.",
    "Instead of a coordinate, clicks, hover and scroll accept ref (from read_page or find): the element is scrolled into view and its center is used.",
    "Actions: screenshot, left_click, right_click, double_click, triple_click, hover, left_click_drag (start_coordinate → coordinate), scroll (coordinate or ref, scroll_direction, scroll_amount), scroll_to (ref), type (text), key (text, e.g. \"Return\", \"ctrl+a\", \"Tab Tab Return\"; repeat), wait (duration in seconds).",
    "For clicks, text can hold held modifiers such as \"shift\" or \"ctrl+shift\".",
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
    ]),
    coordinate: z.tuple([z.number(), z.number()]).optional().describe("[x, y] in screenshot pixels."),
    ref: z.string().optional().describe("Element reference from read_page or find (e.g. \"ref_12\"), instead of coordinate."),
    start_coordinate: z.tuple([z.number(), z.number()]).optional().describe("Drag start [x, y]."),
    text: z.string().optional().describe("Text to type, keys to press, or click modifiers."),
    scroll_direction: z.enum(["up", "down", "left", "right"]).optional(),
    scroll_amount: z.number().optional().describe("Scroll ticks (100px each). Default 3."),
    duration: z.number().optional().describe("Seconds to wait (max 30)."),
    repeat: z.number().optional().describe("How many times to repeat a key action."),
    tabId,
  },
);

register(
  "read_page",
  [
    "Get the page as an accessibility-style tree: roles, names, values and states, each element with a ref (e.g. ref_12) usable in computer, form_input and read_page.",
    "Cheaper and more precise than a screenshot for finding and operating controls. Refs stay valid until the page navigates.",
    "filter: \"interactive\" lists only controls (buttons, links, inputs...) as a flat list; default \"all\" includes headings, landmarks and text.",
  ].join(" "),
  {
    tabId,
    filter: z.enum(["all", "interactive"]).optional(),
    depth: z.number().optional().describe("Maximum DOM depth to walk (default 30)."),
    ref_id: z.string().optional().describe("Only return the subtree of this element."),
    max_chars: z.number().optional().describe("Output size limit (default 50000)."),
  },
);

register(
  "find",
  "Find elements by keywords matched against their accessible name, text, placeholder, title, id, name and href (not natural-language understanding: use words that appear on the element). Returns up to 20 matches with refs, interactive elements first.",
  {
    tabId,
    query: z.string().describe('Keywords, e.g. "search", "sign in", "email".'),
  },
);

register(
  "form_input",
  "Set a form control's value by ref: text inputs and textareas (value), selects (option value or visible text), checkboxes and radios (true/false), contenteditable (text). Fires input/change events so frameworks like React notice. To type with real keystrokes, click the field and use computer type instead.",
  {
    tabId,
    ref: z.string().describe("Element reference from read_page or find."),
    value: z.union([z.string(), z.number(), z.boolean()]),
  },
);

register(
  "get_page_text",
  "Get the readable text of the page (main/article content if present, otherwise the body), with title and URL.",
  { tabId },
);

register(
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

register(
  "read_network_requests",
  "List HTTP requests made by a Claude tab (documents, scripts, XHR/fetch, images...) with method, status or error, type and duration, recorded since the tab was opened. Cleared when the page navigates to a different site.",
  {
    tabId,
    urlPattern: z.string().optional().describe("Only requests whose URL contains this text, e.g. \"/api/\"."),
    limit: z.number().optional().describe("Maximum requests, most recent kept (default 100)."),
    clear: z.boolean().optional().describe("Clear the log after reading."),
  },
);

register(
  "javascript_tool",
  "Run JavaScript in the page with full access to the page's own variables. The value of the last expression is returned (promises are awaited); do not use return.",
  {
    action: z.literal("javascript_exec").describe("Must be 'javascript_exec'."),
    text: z.string().describe("JavaScript code to run."),
    tabId,
  },
);

await server.connect(new StdioServerTransport());
