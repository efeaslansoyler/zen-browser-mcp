// Geliştirme için: MCP'siz doğrudan köprüyü çağırır.
//   node scripts/zenctl.ts reload
//   node scripts/zenctl.ts eval 'gBrowser.tabs.length'      (tarayıcı tarafında, main.js kapsamında)
//   node scripts/zenctl.ts <tool> '{"tabId": 12}'           (görseller /tmp... yerine stdout'a özet)
//   node scripts/zenctl.ts --session dev <tool> '{…}'      (aynı adla çağrılar sekmelerini paylaşır)
import { writeFileSync } from "node:fs";
import { call } from "../src/zen.ts";

// her çağrı normalde ayrı oturumdur; --session ile ardışık çağrılar aynı sekmeleri kullanır
const argv = process.argv.slice(2);
const named = argv[0] === "--session" ? argv.splice(0, 2)[1] : undefined;
const session = named ? `zenctl:${named}` : undefined;
const [cmd, arg] = argv;
if (!cmd) {
  console.error("kullanım: zenctl <reload|eval KOD|tool JSON>");
  process.exit(1);
}

type Ping = { bridge?: number; startError?: string };
const ping = async (): Promise<Ping> => JSON.parse(((await call("ping", {}, 1000))[0] as { text: string }).text);

// reload cevabı eski sürümden gelir; yeni sürümün gerçekten başladığını ping ile doğrula
async function reload() {
  const before = await ping();
  await call("reload");
  for (let i = 0; i < 50; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    let now: Ping;
    try { now = await ping(); } catch { continue; }
    if (now.bridge === before.bridge) {
      // eski sürüm geri döndüyse hata yazılmıştır; yoksa reload henüz çalışmadı
      if (now.startError && now.startError !== before.startError) break;
      continue;
    }
    if (now.startError || !(now.bridge! > before.bridge!)) break;
    console.log(`reloaded: v${before.bridge} → v${now.bridge}`);
    return;
  }
  const now = await ping().catch(() => ({}) as Ping);
  throw new Error(`reload failed, bridge is on v${now.bridge ?? "?"}: ${now.startError ?? "new version did not answer"}\nlog: ${process.env.XDG_RUNTIME_DIR ?? "/tmp"}/zen-mcp.log`);
}

try {
  if (cmd === "reload") {
    await reload();
    process.exit(0);
  }
  const content =
    cmd === "eval" ? await call("chrome_eval", { code: arg }) : await call(cmd, arg ? JSON.parse(arg) : {}, undefined, undefined, session);
  for (const c of content) {
    if (c.type === "text") console.log(c.text);
    else {
      const file = `${process.env.ZENCTL_OUT ?? "/tmp"}/zen-mcp-shot.jpg`;
      writeFileSync(file, Buffer.from(c.data, "base64"));
      console.log(`[görsel: ${file}]`);
    }
  }
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
