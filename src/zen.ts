// Zen içindeki köprüyle konuşur: bağlantı başına tek satır istek, tek satır cevap.
import net from "node:net";
import { randomUUID } from "node:crypto";
import { NAME, SOCKET as socketPath } from "./paths.ts";

export type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

// bu sunucu sürecinin kimliği: Zen olayı (öğe seçimi) Zen'i en son kullanan oturuma gönderir
export const session = randomUUID();

export type BrowserContent = Content[] & { isError?: boolean };

type Reply = { ok: true; content: Content[]; isError?: boolean } | { ok: false; error: string };

// karşı taraf da aynısını yapar: JSON saf ASCII kalsın, kodlama sorunu çıkmasın
const ascii = (s: string) =>
  s.replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

export type AgentIdentity = { id: string; name: string };

export function call(tool: string, args: object = {}, timeout = 60_000, agent?: AgentIdentity): Promise<BrowserContent> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = "";
    socket.setTimeout(timeout, () => socket.destroy(new Error(`The browser did not answer within ${timeout / 1000} s.`)));
    socket.on("connect", () => socket.write(ascii(JSON.stringify({ tool, args, session, agent })) + "\n"));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      if (buffer.includes("\n")) socket.end();
    });
    socket.on("error", (e: NodeJS.ErrnoException) =>
      reject(
        e.code === "ENOENT" || e.code === "ECONNREFUSED"
          ? new Error(`Could not connect to the browser (${e.code}, socket: ${socketPath}). Is it open? Install with \`npx ${NAME} install\`, check with \`npx ${NAME} doctor\`.`)
          : e.code === "EPERM" || e.code === "EACCES"
            ? new Error(`Access denied to the browser socket (${e.code}, socket: ${socketPath}). Check the MCP client's sandbox and socket permissions.`)
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

// Zen'e kalıcı bağlanır, Zen'in ittiği olayları (satır başına bir JSON) onEvent'e verir. Zen
// kapalıysa ya da köprü yeniden yüklenirse birkaç saniyede bir yeniden dener.
export type SubscriptionInfo = {
  cwd: string; session?: string; agent?: AgentIdentity; label?: string; threadId?: string; ack?: boolean;
};

export function subscribe(onEvent: (event: any) => void | Promise<void>, info: SubscriptionInfo) {
  let closed = false;
  let current: net.Socket | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
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
          Promise.resolve().then(() => onEvent(event)).then(
            () => { if (info.ack && event.id && !socket.destroyed) socket.write(ascii(JSON.stringify({ event: "delivery", id: event.id, ok: true })) + "\n"); },
            (error) => { if (info.ack && event.id && !socket.destroyed) socket.write(ascii(JSON.stringify({ event: "delivery", id: event.id, ok: false, error: String(error?.message ?? error).slice(0, 500) })) + "\n"); },
          );
        } catch {}
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => { if (!closed) reconnect = setTimeout(connect, 3000); });
  };
  connect();
  return {
    close() { closed = true; clearTimeout(reconnect); current?.destroy(); },
  };
}
