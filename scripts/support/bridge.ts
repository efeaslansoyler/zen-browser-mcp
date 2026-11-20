// why: Verify the bridge path because reloading an installed copy may run code from another checkout.
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "../../src/paths.ts";
import { call, type Content } from "../../src/zen.ts";

const CHECKOUT = fileURLToPath(new URL("../../browser", import.meta.url));
const text = (content: Content[]) => content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n");

function differingFiles(dir: string): string[] {
  const read = (file: string) => {
    try {
      return readFileSync(file);
    } catch {
      return null;
    }
  };
  return readdirSync(CHECKOUT, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(CHECKOUT, path.join(entry.parentPath, entry.name)))
    .filter((file) => !read(path.join(dir, file))?.equals(read(path.join(CHECKOUT, file))!));
}

export async function assertBridgeRunsCheckout(): Promise<void> {
  const { dir = DATA_DIR } = JSON.parse(text(await call("ping", {}, 1000)));
  if (realpathSync(dir) === realpathSync(CHECKOUT)) return;
  const differ = differingFiles(dir);
  if (differ.length)
    throw new Error(
      `The bridge loads ${dir}, a copy that differs from this checkout's browser/ in ${differ.length} files ` +
        `(${differ.slice(0, 3).join(", ")}). Copy browser/ there (cp -a browser/. ${dir}/) or link it ` +
        `(CONTRIBUTING.md), then reload.`,
    );
}

export async function reloadBridge(): Promise<Content[]> {
  await assertBridgeRunsCheckout();
  return call("reload");
}
