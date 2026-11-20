// why: The plugin runs in the process that knows the active session and can call OpenCode's API.
// why: A push before the first user message waits for the plugin's chat.message hook.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { NAME, PACKAGE_DIR, RUNTIME_DIR } from "./paths.ts";
import { call } from "./zen.ts";

export const openCodeSocket = (pid: number) => path.join(RUNTIME_DIR, `${NAME}-opencode`, `${pid}.sock`);

export function pushToOpenCode(text: string, pid = process.ppid): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(openCodeSocket(pid));
    let reply = "";
    socket.setTimeout(15_000, () => socket.destroy());
    socket.on("connect", () => socket.write(JSON.stringify({ text }) + "\n"));
    socket.on("data", (chunk) => (reply += chunk.toString()));
    socket.on("error", () => resolve(false));
    socket.on("close", () => resolve(reply.trim() === "ok"));
  });
}

type Client = {
  session: {
    promptAsync(options: {
      path: { id: string };
      body: {
        parts: { type: "text"; text: string }[];
        agent?: string;
        model?: { providerID: string; modelID: string };
      };
    }): Promise<{ error?: unknown }>;
  };
};
type ChatInput = { sessionID: string; agent?: string; model?: { providerID: string; modelID: string } };
type ChatOutput = { parts: { type: string; text?: string }[] };

export async function openCodePlugin(
  { client }: { client: Client },
  browser: typeof call = call,
  pid = process.pid,
  servers: net.Server[] = [], // why: Allow tests to close the receiver without exiting the OpenCode process.
) {
  let last: ChatInput | undefined;
  const file = openCodeSocket(pid);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  // why: Killed OpenCode processes can leave a socket behind because their exit handler did not run.
  for (const name of fs.readdirSync(path.dirname(file))) {
    const other = Number(name.replace(/\.sock$/, ""));
    if (other === pid || !Number.isInteger(other)) continue;
    try {
      process.kill(other, 0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ESRCH")
        fs.rmSync(path.join(path.dirname(file), name), { force: true });
    }
  }
  fs.rmSync(file, { force: true });
  const server = net.createServer((socket) => {
    let data = "";
    socket.setEncoding("utf8");
    socket.on("data", async (chunk) => {
      data += chunk;
      if (!data.includes("\n")) return;
      socket.removeAllListeners("data");
      let ok = false;
      try {
        const { text } = JSON.parse(data);
        if (last && typeof text === "string" && text) {
          const { sessionID, agent, model } = last;
          const result = await client.session.promptAsync({
            path: { id: sessionID },
            body: { parts: [{ type: "text", text }], agent, model },
          });
          ok = !result?.error;
        }
      } catch {}
      socket.end(ok ? "ok\n" : "no\n");
    });
    socket.on("error", () => {});
  });
  server.listen(file);
  server.unref();
  servers.push(server);
  process.once("exit", () => fs.rmSync(file, { force: true }));

  return {
    "chat.message": async (input: ChatInput, output: ChatOutput) => {
      last = { sessionID: input.sessionID, agent: input.agent, model: input.model };
      let text: string;
      try {
        const [reply] = await browser("inbox_take", { client: "opencode", pids: [pid] }, 2000);
        text = reply?.type === "text" ? reply.text : "";
      } catch {
        return; // why: A stopped browser has no live inbox to check.
      }
      const part = output.parts.find((p) => p.type === "text");
      if (text && part) part.text = `${part.text ?? ""}\n\n${text}`;
    },
  };
}

export function openCodePluginFile(env = process.env, home = os.homedir()) {
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "opencode", "plugins", "zen-browser.js");
}
const MARKER = "// zen-browser-mcp plugin";
export function openCodePluginSource() {
  const module = path.join(PACKAGE_DIR, "dist", "opencode.js");
  return `${MARKER}: delivers what you send from the browser. Remove with \`npx zen-browser-mcp hooks uninstall\`.
import { openCodePlugin } from ${JSON.stringify(module)};
export const ZenBrowser = (input) => openCodePlugin(input);
`;
}

export function configureOpenCodePlugin(action: "install" | "uninstall", file = openCodePluginFile()) {
  if (action === "install") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, openCodePluginSource());
  } else if (openCodePluginInstalled(file)) fs.rmSync(file);
  return file;
}

export function openCodePluginInstalled(file = openCodePluginFile()) {
  try {
    return fs.readFileSync(file, "utf8").startsWith(MARKER);
  } catch {
    return false;
  }
}
