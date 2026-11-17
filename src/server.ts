// The MCP server: tool definitions are in tools.ts; the work is done by the bridge in the
// browser (browser/main.js), reached over a Unix socket (zen.ts).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { call, subscribe } from "./zen.ts";
import { SERVER_NAME, VERSION } from "./paths.ts";
import { syncBrowserFiles } from "./install.ts";
import { ensureCodexRelay } from "./codex-relay.ts";
import { ensureCodexWatch } from "./codex-watch.ts";
import { THREAD_ID } from "./delivery.ts";
import { channelEnabled, claudeTitle } from "./claude.ts";
import { channelInstructions, clientInstructions } from "./instructions.ts";
import { TOOLS, callTimeout } from "./tools.ts";
import { identifyAgent } from "../browser/Agent.sys.mjs";

const channel = channelEnabled();

type ConnectSession = (
  input: { threadId: string; label?: string },
  agent: { id: string; name: string },
) => void | Promise<void>;

// Codex sends the conversation ID in each call's _meta. One Codex MCP process can serve several
// conversations, so ownership belongs to the conversation (the same session ID that receives picks).
export function codexSession(agent: { id: string }, meta: any) {
  const threadId = meta?.threadId ?? meta?.["x-codex-turn-metadata"]?.thread_id;
  return agent.id === "codex" && typeof threadId === "string" && THREAD_ID.test(threadId)
    ? `codex:${threadId}`
    : undefined;
}

export function createServer(callBrowser: typeof call = call, connectSession?: ConnectSession) {
  const server = new McpServer(
    { name: SERVER_NAME, version: VERSION },
    channel
      ? { capabilities: { experimental: { "claude/channel": {} } }, instructions: channelInstructions }
      : { instructions: clientInstructions },
  );

  server.registerTool(
    "connect_session",
    {
      description:
        "Bind browser element picks to this Codex conversation. Before using the browser, read CODEX_THREAD_ID from your command environment and pass that exact UUID here; never guess a conversation ID. Manual fallback when automatic Codex lifecycle hooks are unavailable. The user selects the destination in the browser island. Does not grant tab access. Claude channels connect automatically.",
      inputSchema: {
        threadId: z.string().regex(THREAD_ID).describe("Exact current CODEX_THREAD_ID UUID."),
        label: z
          .string()
          .min(1)
          .max(80)
          .optional()
          .describe("Short human-readable session label, usually the project name."),
      },
    },
    async (input) => {
      const agent = identifyAgent(server.server.getClientVersion()?.name, process.env.ZEN_MCP_AGENT);
      if (agent.id !== "codex")
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Explicit conversation binding is currently supported for Codex. Claude channels connect automatically.",
            },
          ],
        };
      if (!connectSession)
        return {
          isError: true,
          content: [{ type: "text", text: "Session delivery is not enabled in this server instance." }],
        };
      await connectSession(input, agent);
      return {
        content: [
          {
            type: "text",
            text: `Browser picks bound to Codex thread ${input.threadId}. The destination appears in the browser picker once connected.`,
          },
        ],
      };
    },
  );

  for (const { name, description, inputSchema } of TOOLS) {
    server.registerTool(name, { description, inputSchema }, async (args: object, extra: any) => {
      try {
        const agent = identifyAgent(server.server.getClientVersion()?.name, process.env.ZEN_MCP_AGENT);
        const content = await callBrowser(
          name,
          args,
          callTimeout(name, args),
          agent,
          codexSession(agent, extra?._meta),
        );
        return { content, ...(content.isError ? { isError: true } : {}) };
      } catch (e) {
        return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
      }
    });
  }

  return server;
}

let subscription: ReturnType<typeof subscribe> | undefined;
let ownerSubscription: ReturnType<typeof subscribe> | undefined;
let ownerAgent: { id: string; name: string } | undefined;
let title = claudeTitle();
function connectOwner(agent: { id: string; name: string }) {
  ownerAgent = agent;
  ownerSubscription = subscribe(() => {}, { cwd: process.cwd(), toolsOnly: true, agent, title });
}
function connectChannel() {
  subscription = subscribe(
    async (event) => {
      if (event?.event !== "channel") return;
      await server.server.notification({
        method: "notifications/claude/channel",
        params: { content: event.content, meta: event.meta },
      });
    },
    { cwd: process.cwd(), agent: { id: "claude", name: "Claude" }, ack: true, title },
  );
}
const server = createServer(call, async ({ threadId, label }) => {
  await ensureCodexRelay({ threadId, label, cwd: process.cwd() });
});

export async function serve() {
  server.server.oninitialized = () => {
    const agent = identifyAgent(server.server.getClientVersion()?.name, process.env.ZEN_MCP_AGENT);
    // Codex's MCP process lives in a background service, independent of conversations;
    // codex-watch connects Codex conversations, and a process session would mislead in menus.
    if (agent.id === "codex") {
      ensureCodexWatch().catch(() => {});
      return;
    }
    connectOwner(agent);
  };
  await server.connect(new StdioServerTransport());
  // Browser files older than this version are updated and the bridge reloads.
  syncBrowserFiles().catch(() => {});

  if (channel) connectChannel();
  // The title appears during the conversation and changes with /rename and /clear: reconnect
  // with the new name when it does.
  setInterval(() => {
    const now = claudeTitle();
    if (now === title) return;
    title = now;
    if (ownerSubscription) {
      ownerSubscription.close();
      connectOwner(ownerAgent!);
    }
    if (subscription) {
      subscription.close();
      connectChannel();
    }
  }, 15_000).unref();
  // stdin closes when Claude Code exits; the browser connection must not keep the process alive.
  process.stdin.on("close", () => {
    ownerSubscription?.close();
    subscription?.close();
    process.exit(0);
  });
}

// Directly during development: node src/server.ts
if ((import.meta as { main?: boolean }).main) await serve();
