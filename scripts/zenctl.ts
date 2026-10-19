// Geliştirme için: MCP'siz doğrudan köprüyü çağırır.
//   node scripts/zenctl.ts reload
//   node scripts/zenctl.ts eval 'gBrowser.tabs.length'      (tarayıcı tarafında, main.js kapsamında)
//   node scripts/zenctl.ts <tool> '{"tabId": 12}'           (görseller /tmp... yerine stdout'a özet)
import { writeFileSync } from "node:fs";
import { call } from "../src/zen.ts";

const [cmd, arg] = process.argv.slice(2);
if (!cmd) {
  console.error("kullanım: zenctl <reload|eval KOD|tool JSON>");
  process.exit(1);
}

try {
  const content =
    cmd === "eval" ? await call("chrome_eval", { code: arg }) : await call(cmd, arg ? JSON.parse(arg) : {});
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
