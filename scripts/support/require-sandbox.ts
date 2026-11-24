// why: Without a pinned socket a check finds the browser the user works in.
import { existsSync } from "node:fs";
import path from "node:path";

const { XDG_RUNTIME_DIR: runtime, ZEN_MCP_SOCKET: socket } = process.env;
const own = process.getuid && `/run/user/${process.getuid()}`;
if (
  !runtime ||
  !socket ||
  path.resolve(runtime) === own ||
  path.resolve(socket) !== path.resolve(runtime, "zen-mcp.sock") ||
  !existsSync(socket)
) {
  console.error(
    "This check opens tabs and changes settings, so it runs only in a sandbox: node scripts/sandbox.ts up, then source the env file it prints.",
  );
  process.exit(1);
}
