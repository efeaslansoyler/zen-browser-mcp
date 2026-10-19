// Zen içindeki köprüyle konuşur: bağlantı başına tek satır istek, tek satır cevap.
import net from "node:net";

export const socketPath =
  process.env.ZEN_MCP_SOCKET ?? `${process.env.XDG_RUNTIME_DIR ?? "/tmp"}/zen-mcp.sock`;

export type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

type Reply = { ok: true; content: Content[] } | { ok: false; error: string };

// karşı taraf da aynısını yapar: JSON saf ASCII kalsın, kodlama sorunu çıkmasın
const ascii = (s: string) =>
  s.replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

export function call(tool: string, args: object = {}, timeout = 60_000): Promise<Content[]> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = "";
    socket.setTimeout(timeout, () => socket.destroy(new Error(`Zen ${timeout / 1000} sn içinde cevap vermedi.`)));
    socket.on("connect", () => socket.write(ascii(JSON.stringify({ tool, args })) + "\n"));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      if (buffer.includes("\n")) socket.end();
    });
    socket.on("error", (e: NodeJS.ErrnoException) =>
      reject(
        e.code === "ENOENT" || e.code === "ECONNREFUSED"
          ? new Error("Zen'e bağlanılamadı: Zen açık mı, zen.cfg köprüyü yüklüyor mu?")
          : e,
      ),
    );
    socket.on("close", () => {
      if (!buffer) return; // hata yolunda reject zaten çağrıldı
      try {
        const reply = JSON.parse(buffer) as Reply;
        if (reply.ok) resolve(reply.content);
        else reject(new Error(reply.error));
      } catch {
        reject(new Error(`Zen'den geçersiz cevap: ${buffer.slice(0, 200)}`));
      }
    });
  });
}
