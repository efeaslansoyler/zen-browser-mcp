// Talks to the bridge in the browser: one request line and one reply line per connection.
import net from "node:net";
import { randomUUID } from "node:crypto";
import { PACKAGE } from "./paths.ts";
import { browserResolver, instanceLabel, type Selection } from "./instances.ts";

export type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

// this server process's identity: browser events (picks) go to the session that used the browser last
export const session = randomUUID();

export type BrowserContent = Content[] & { isError?: boolean };

type Reply = { ok: true; content: Content[]; isError?: boolean } | { ok: false; error: string };

// the other side does the same: JSON stays pure ASCII, so encodings never matter
const ascii = (s: string) => s.replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

export type AgentIdentity = { id: string; name: string };

// as: the session of this call (such as a Codex conversation); defaults to this MCP process's session
export async function call(
  tool: string,
  args: object = {},
  timeout = 60_000,
  agent?: AgentIdentity,
  as: string = session,
  selection?: Selection,
): Promise<BrowserContent> {
  const target = selection ?? (await browserResolver.resolve());
  const socketPath = target.socket;
  const change = agent && browserResolver.browserChange(target);
  if (change) throw new Error(change);
  const content = await request(socketPath, tool, args, timeout, agent, as);
  if (tool === "inbox_take" && content[0]?.type === "text" && !content[0].text) {
    // Prompt hooks run outside the MCP process. Its existing session can be sticky to a
    // different browser. The bridge only releases picks for the exact client ID or PID.
    const other = (await browserResolver.list()).filter((entry) => entry.socket !== socketPath);
    const replies = await Promise.allSettled(
      other.map((entry) => request(entry.socket, tool, args, timeout, agent, as)),
    );
    const messages = replies.flatMap((reply) => {
      const first = reply.status === "fulfilled" ? reply.value[0] : undefined;
      return first?.type === "text" && first.text ? [first.text] : [];
    });
    if (messages.length) content[0].text = messages.join("\n");
  }

  if (tool === "tabs_context_mcp" && target.instance && !content.isError && content[0]?.type === "text") {
    const instances = await browserResolver.list().catch(() => []);
    if (instances.length > 1) {
      const entry = { ...JSON.parse(content[0].text), browser: instanceLabel(target.instance) };
      content[0].text = JSON.stringify(entry);
    }
  }
  return content;
}

function request(
  socketPath: string,
  tool: string,
  args: object,
  timeout: number,
  agent: AgentIdentity | undefined,
  as: string,
): Promise<BrowserContent> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = "";
    socket.setTimeout(timeout, () =>
      socket.destroy(new Error(`The browser did not answer within ${timeout / 1000} s.`)),
    );
    socket.on("connect", () => socket.write(ascii(JSON.stringify({ tool, args, session: as, agent })) + "\n"));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      if (buffer.includes("\n")) socket.end();
    });
    socket.on("error", (e: NodeJS.ErrnoException) =>
      reject(
        e.code === "ENOENT" || e.code === "ECONNREFUSED"
          ? new Error(
              `Could not connect to the browser (${e.code}, socket: ${socketPath}). Is it open? Install with \`npx ${PACKAGE} install\`, check with \`npx ${PACKAGE} doctor\`.`,
            )
          : e.code === "EPERM" || e.code === "EACCES"
            ? new Error(
                `Access denied to the browser socket (${e.code}, socket: ${socketPath}). Check the MCP client's sandbox and socket permissions.`,
              )
            : e,
      ),
    );
    socket.on("close", () => {
      if (!buffer) {
        reject(new Error(`The browser closed the connection without a reply (socket: ${socketPath}).`));
        return;
      }
      try {
        const reply = JSON.parse(buffer) as Reply;
        if (reply.ok) resolve(Object.assign(reply.content, reply.isError ? { isError: true } : {}));
        else reject(new Error(reply.error));
      } catch {
        reject(new Error(`Invalid reply from the browser: ${buffer.slice(0, 200)}`));
      }
    });
  });
}

// Keeps a connection to the browser and hands pushed events (one JSON per line) to onEvent.
// If the browser is closed or the bridge reloads, it retries every few seconds.
export type SubscriptionInfo = {
  cwd: string;
  session?: string;
  agent?: AgentIdentity;
  label?: string;
  title?: string;
  threadId?: string;
  ack?: boolean;
  toolsOnly?: boolean;
  // how this process delivers pushed events now ("channel"), or null: they wait in the inbox
  push?: string | null;
  // the client's own conversation ID (Claude Code: CLAUDE_CODE_SESSION_ID), for prompt hooks
  clientSession?: string;
  // the client's process: prompt hooks without a conversation ID find it among their ancestors
  clientPid?: number;
  // the client has the zen prompt hook installed (hooks install)
  hook?: boolean;
};

export function subscribe(onEvent: (event: any) => void | Promise<void>, info: SubscriptionInfo) {
  let closed = false;
  let current: net.Socket | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  const connect = async () => {
    if (closed) return;
    let socketPath: string;
    try {
      ({ socket: socketPath } = await browserResolver.resolve());
    } catch {
      if (!closed) reconnect = setTimeout(connect, 3000);
      return;
    }
    if (closed) return;
    const socket = net.createConnection(socketPath);
    current = socket;
    let buffer = "";
    socket.on("connect", () =>
      socket.write(ascii(JSON.stringify({ tool: "subscribe", args: { session, ...info } })) + "\n"),
    );
    socket.on("data", (chunk) => {
      if (closed) return;
      buffer += chunk.toString("latin1");
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          const event = JSON.parse(line);
          Promise.resolve()
            .then(() => onEvent(event))
            .then(
              () => {
                if (info.ack && event.id && !socket.destroyed)
                  socket.write(ascii(JSON.stringify({ event: "delivery", id: event.id, ok: true })) + "\n");
              },
              (error) => {
                if (info.ack && event.id && !socket.destroyed)
                  socket.write(
                    ascii(
                      JSON.stringify({
                        event: "delivery",
                        id: event.id,
                        ok: false,
                        error: String(error?.message ?? error).slice(0, 500),
                      }),
                    ) + "\n",
                  );
              },
            );
        } catch {}
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      if (!closed) reconnect = setTimeout(connect, 3000);
    });
  };
  connect();
  return {
    close() {
      closed = true;
      clearTimeout(reconnect);
      current?.destroy();
    },
  };
}
