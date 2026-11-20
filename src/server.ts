// The MCP server: tool definitions are in tools.ts; the work is done by the bridge in the
// browser (browser/main.js), reached over a Unix socket (zen.ts).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { call, subscribe } from "./zen.ts";
import { browserResolver, deliveryScope } from "./instances.ts";
import { SERVER_NAME, VERSION } from "./paths.ts";
import { syncBrowserFiles } from "./install.ts";
import { ensureCodexRelay } from "./codex-relay.ts";
import { ensureCodexWatch } from "./codex-watch.ts";
import { NO_PUSH, THREAD_ID, runT3Send, t3Message, t3Thread } from "./delivery.ts";
import { channelEnabled, claudeTitle } from "./claude.ts";
import { antigravityHookInstalled, claudeHookInstalled } from "./hooks.ts";
import { openCodePluginInstalled, pushToOpenCode } from "./opencode.ts";
import { channelInstructions, clientInstructions } from "./instructions.ts";
import { TOOLS, callTimeout } from "./tools.ts";
import { identifyAgent } from "../browser/Agent.sys.mjs";

const channel = channelEnabled();
const t3 = channel ? null : t3Thread();
// OpenCode (OPENCODE_PID is our parent) with the zen plugin: it pushes into the session
const opencode = !channel && !t3 && process.env.OPENCODE_PID === String(process.ppid) && openCodePluginInstalled();

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

// The session's one connection to the browser: it owns the session's tabs and receives what
// the user sends from the browser. An event this process can't push into the conversation is
// refused with NO_PUSH and waits in the browser's inbox for the next tool result.
let ownerSubscription: ReturnType<typeof subscribe> | undefined;
let ownerAgent: { id: string; name: string } | undefined;
let title = claudeTitle();
function connectOwner(agent: { id: string; name: string }) {
  ownerAgent = agent;
  ownerSubscription = subscribe(push, {
    cwd: process.cwd(),
    toolsOnly: true,
    ack: true,
    agent,
    title,
    push: channel ? "channel" : t3 ? "t3" : opencode ? "opencode" : null,
    // prompt hooks find the conversation by the client's own ID, or by the client's process
    clientPid: process.ppid,
    ...(agent.id === "claude" && process.env.CLAUDE_CODE_SESSION_ID
      ? { clientSession: process.env.CLAUDE_CODE_SESSION_ID, hook: claudeHookInstalled() }
      : agent.id === "antigravity"
        ? { hook: antigravityHookInstalled() }
        : opencode
          ? { hook: true }
          : {}),
  });
}
async function push(event: any) {
  if (event?.event !== "channel") return;
  if (channel)
    await server.server.notification({
      method: "notifications/claude/channel",
      params: { content: event.content, meta: event.meta },
    });
  else if (t3) await runT3Send(t3.cli, t3.threadId, t3Message(event));
  else if (!opencode || !(await pushToOpenCode(t3Message(event)))) throw new Error(NO_PUSH);
}
let watchScope: string | undefined;
let watchStarting = false;
async function connectCodexWatch() {
  if (watchStarting) return;
  watchStarting = true;
  try {
    const target = await browserResolver.resolve();
    const scope = deliveryScope(target);
    if (scope !== watchScope) {
      await ensureCodexWatch(target);
      watchScope = scope;
    }
  } catch {
    // The browser may be closed at initialize; try again when tools are used.
  } finally {
    watchStarting = false;
  }
}
const callWithDelivery: typeof call = async (...args) => {
  try {
    return await call(...args);
  } finally {
    if (args[3]?.id === "codex") void connectCodexWatch();
  }
};
const server = createServer(callWithDelivery, async ({ threadId, label }) => {
  const change = browserResolver.browserChange(await browserResolver.resolve());
  if (change) throw new Error(change);
  await ensureCodexRelay({ threadId, label, cwd: process.cwd() });
});

export async function serve() {
  server.server.oninitialized = () => {
    const agent = identifyAgent(server.server.getClientVersion()?.name, process.env.ZEN_MCP_AGENT);
    // Codex's MCP process lives in a background service, independent of conversations;
    // codex-watch connects Codex conversations, and a process session would mislead in menus.
    if (agent.id === "codex") {
      void connectCodexWatch();
      return;
    }
    connectOwner(agent);
  };
  await server.connect(new StdioServerTransport());
  // Browser files older than this version are updated and the bridge reloads.
  syncBrowserFiles().catch(() => {});

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
  }, 15_000).unref();
  // stdin closes when Claude Code exits; the browser connection must not keep the process alive.
  process.stdin.on("close", () => {
    ownerSubscription?.close();
    process.exit(0);
  });
}

// Directly during development: node src/server.ts
if ((import.meta as { main?: boolean }).main) await serve();
