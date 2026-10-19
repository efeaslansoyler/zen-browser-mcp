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
    url: z.string().describe('URL to open (https:// is added if missing), or "back" / "forward".'),
    tabId,
  },
);

register(
  "computer",
  [
    "Use the mouse and keyboard in a Zen tab and take screenshots. Input is delivered as real (trusted) browser input.",
    "Coordinates are pixels in the most recent screenshot of that tab, so take a screenshot before clicking.",
    "Actions: screenshot, left_click, right_click, double_click, triple_click, hover, left_click_drag (start_coordinate → coordinate), scroll (coordinate, scroll_direction, scroll_amount), type (text), key (text, e.g. \"Return\", \"ctrl+a\", \"Tab Tab Return\"; repeat), wait (duration in seconds).",
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
      "type",
      "key",
      "wait",
    ]),
    coordinate: z.tuple([z.number(), z.number()]).optional().describe("[x, y] in screenshot pixels."),
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
  "get_page_text",
  "Get the readable text of the page (main/article content if present, otherwise the body), with title and URL.",
  { tabId },
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
