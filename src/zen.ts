import net from "node:net";
import { randomUUID } from "node:crypto";
import { PACKAGE, foreignOwned } from "./paths.ts";
import { browserResolver, instanceLabel, type Selection } from "./instances.ts";

export type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export const session = randomUUID();

export type BrowserContent = Content[] & { isError?: boolean };

type Reply = { ok: true; content: Content[]; isError?: boolean } | { ok: false; error: string };

const ascii = (s: string) => s.replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

export type AgentIdentity = { id: string; name: string };

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
    // why: A standalone hook may select another browser, but the bridge releases items only for the exact client identity.
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
    if (foreignOwned(socketPath)) {
      reject(new Error(`Refusing the browser socket ${socketPath}: it belongs to another user.`));
      return;
    }
    const socket = net.createConnection(socketPath);
    let buffer = "";
    socket.setTimeout(timeout, () =>
      socket.destroy(
        new Error(
          `The browser did not answer within ${timeout / 1000} s. The call may still finish in the browser: check the page before you retry.`,
        ),
      ),
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
              `Could not connect to the browser (${e.code}, socket: ${socketPath}). Is it open? Install with \`${PACKAGE} install\`, check with \`${PACKAGE} doctor\`.`,
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

export type SubscriptionInfo = {
  cwd: string;
  session?: string;
  agent?: AgentIdentity;
  label?: string;
  title?: string;
  threadId?: string;
  ack?: boolean;
  toolsOnly?: boolean;
  // why: A session lacking a push path must remain reachable through the inbox.
  push?: string | null;
  // why: Prompt hooks know the native conversation ID or, failing that, their client ancestor PID.
  clientSession?: string;
  clientPid?: number;
  hook?: boolean;
};

type DeliveryResult = void | "unavailable";
type DeliveryAck = { ok: true } | { ok: false; status: "unavailable" | "failed"; error: string };
// why: Older bridges use this exact error field to recognize ordinary unavailability.
const LEGACY_NO_PUSH = "no push path";

export function subscribe(onEvent: (event: any) => DeliveryResult | Promise<DeliveryResult>, info: SubscriptionInfo) {
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
    if (foreignOwned(socketPath)) {
      reconnect = setTimeout(connect, 3000);
      return;
    }
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
          const acknowledge = (result: DeliveryAck) => {
            if (info.ack && event.id && !socket.destroyed)
              socket.write(ascii(JSON.stringify({ event: "delivery", id: event.id, ...result })) + "\n");
          };
          Promise.resolve()
            .then(() => onEvent(event))
            .then(
              (status) =>
                acknowledge(status === "unavailable" ? { ok: false, status, error: LEGACY_NO_PUSH } : { ok: true }),
              (error) => {
                const message = String(error?.message ?? error).slice(0, 500);
                acknowledge({
                  ok: false,
                  status: "failed",
                  // why: Keep a genuine failure visible even to bridges that only read the legacy error field.
                  error: message === LEGACY_NO_PUSH ? `Delivery rejected: ${message}` : message,
                });
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

// why: Dedicated profiles need a lease even for clients with no conversation or pick delivery.
export function leaseProfile(target: Selection) {
  const instance = target.instance!;
  let socket: net.Socket;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let ready = false;

  const open = (socketPath: string) => {
    ready = false;
    socket = net.createConnection(socketPath);
    const connected = new Promise<void>((resolve, reject) => {
      socket.setTimeout(2000, () => socket.destroy(new Error("Timed out connecting the browser profile lease.")));
      socket.once("connect", () =>
        socket.write(ascii(JSON.stringify({ tool: "profile_lease", owner: instance.profileOwner })) + "\n"),
      );
      let response = "";
      socket.on("data", (chunk) => {
        response += chunk.toString("latin1");
        if (!response.includes("\n")) return;
        try {
          const reply = JSON.parse(response);
          if (!reply.ok) throw new Error(reply.error);
          socket.setTimeout(0);
          ready = true;
          resolve();
        } catch (error) {
          reject(error);
          socket.destroy();
        }
      });
      socket.on("error", reject);
      socket.on("close", () => {
        ready = false;
        reject(new Error("The browser closed the profile lease."));
        if (!closed) retry = setTimeout(reconnect, 500).unref();
      });
    });
    return connected;
  };

  async function reconnect() {
    try {
      const same = (await browserResolver.list()).find(
        (entry) => entry.pid === instance.pid && entry.startedAt === instance.startedAt,
      );
      if (closed) return;
      if (same) await open(same.socket).catch(() => {});
      else retry = setTimeout(reconnect, 500).unref();
    } catch {
      if (!closed) retry = setTimeout(reconnect, 500).unref();
    }
  }

  return {
    target,
    connected: open(target.socket),
    close(quit = false) {
      closed = true;
      clearTimeout(retry);
      if (quit && ready) {
        socket.end('{"event":"release"}\n');
        return true;
      }
      socket.destroy();
      return false;
    },
  };
}
