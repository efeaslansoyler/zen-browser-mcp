import { writeFileSync } from "node:fs";
import { callTimeout } from "../src/tools.ts";
import { call } from "../src/zen.ts";
import { LOG_FILE } from "../src/paths.ts";
import { reloadBridge } from "./support/bridge.ts";

const argv = process.argv.slice(2);
const named = argv[0] === "--session" ? argv.splice(0, 2)[1] : undefined;
const session = named ? `zenctl:${named}` : undefined;
const [cmd, arg] = argv;
if (!cmd) {
  console.error("usage: zenctl [--session NAME] <reload|eval CODE|TOOL JSON>");
  process.exit(1);
}

type Ping = { bridge?: number; startError?: string };
const ping = async (): Promise<Ping> => JSON.parse(((await call("ping", {}, 1000))[0] as { text: string }).text);

// why: The old bridge sends the reload reply; ping the new bridge to verify it actually started.
async function reload() {
  const before = await ping();
  await reloadBridge();
  for (let i = 0; i < 50; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    let now: Ping;
    try {
      now = await ping();
    } catch {
      continue;
    }
    if (now.bridge === before.bridge) {
      // why: Poll until generation changes or the old bridge reports a failed reload.
      if (now.startError && now.startError !== before.startError) break;
      continue;
    }
    if (now.startError || !(now.bridge! > before.bridge!)) break;
    console.log(`reloaded: v${before.bridge} → v${now.bridge}`);
    return;
  }
  const now = await ping().catch(() => ({}) as Ping);
  throw new Error(
    `reload failed, bridge is on v${now.bridge ?? "?"}: ${now.startError ?? "new version did not answer"}\nlog: ${LOG_FILE}`,
  );
}

try {
  if (cmd === "reload") {
    await reload();
    process.exit(0);
  }
  const args = cmd === "eval" ? {} : arg ? JSON.parse(arg) : {};
  // why: Use the real tool timeout because interactions such as recording may wait for minutes.
  const content =
    cmd === "eval"
      ? await call("chrome_eval", { code: arg })
      : await call(cmd, args, callTimeout(cmd, args), undefined, session);
  for (const c of content) {
    if (c.type === "text") console.log(c.text);
    else {
      const file = `${process.env.ZENCTL_OUT ?? "/tmp"}/zen-mcp-shot.jpg`;
      writeFileSync(file, Buffer.from(c.data, "base64"));
      console.log(`[image: ${file}]`);
    }
  }
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
