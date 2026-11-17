// Real MCP Zen workspace test: with the workspace setting, a new agent tab opens in that space
// (created without switching), works there (navigate, read, click, screenshot) and the user's
// active space never changes. Restores the setting and removes the space it created.
// Run: node scripts/check-workspace.ts  (Zen only; requires existing auto mode)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { call } from "../src/zen.ts";

const text = (result: any) =>
  result.content
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("\n");
const chrome = async (code: string) => text({ content: await call("chrome_eval", { code }) });
const SPACE = `zen-mcp-check-${Date.now().toString(36)}`;
const configFile = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "zen-mcp/config.json");
const original = fs.existsSync(configFile) ? fs.readFileSync(configFile, "utf8") : null;
let client: Client | undefined;
let tabId: number | undefined;
async function tool(name: string, args: object = {}) {
  const result = await client!.callTool({ name, arguments: args }, undefined, { timeout: 60_000 });
  assert(!result.isError, text(result));
  return text(result);
}
const spaces = `Services.wm.getMostRecentWindow("navigator:browser").gZenWorkspaces`;

try {
  assert(
    original === null || JSON.parse(original).mode !== "ask",
    "Requires your existing auto mode; no settings changed.",
  );
  assert.equal(
    await chrome(`!!${spaces}?.workspaceEnabled`),
    "true",
    "Zen workspaces are not available in this browser.",
  );
  const before = await chrome(`${spaces}.activeWorkspace`);
  fs.writeFileSync(
    configFile,
    JSON.stringify({ ...(original ? JSON.parse(original) : {}), workspace: SPACE }, null, 2) + "\n",
  );

  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  client = new Client({ name: "claude-code", version: "workspace-test" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["src/server.ts"],
      cwd: process.cwd(),
      env: { ...env, ZEN_MCP_CHANNEL: "0" },
    }),
  );
  tabId = JSON.parse(await tool("tabs_create_mcp")).tabId;
  const placed = JSON.parse(
    await chrome(
      `(() => { const z = ${spaces}; const s = z.getWorkspaces().find(w => w.name === ${JSON.stringify(SPACE)}); const t = z.allStoredTabs.find(t => t.linkedBrowser?.browserId === ${tabId}); return JSON.stringify({ space: s?.uuid, tab: t?.getAttribute("zen-workspace-id"), active: z.activeWorkspace }); })()`,
    ),
  );
  assert(placed.space, "workspace was not created");
  assert.equal(placed.tab, placed.space);
  assert.equal(placed.active, before);
  console.log("ok  new agent tab opened in the configured space; your space stayed active");

  await tool("navigate", { tabId, url: "https://example.com/" });
  const ref = /\b(ref_\d+)\b/.exec(await tool("find", { tabId, query: "Learn more" }))![1];
  await tool("computer", { tabId, action: "left_click", ref });
  await tool("wait_for", { tabId, text: "Example Domains", timeout: 20 });
  const shot = await client.callTool({ name: "computer", arguments: { tabId, action: "screenshot", scale: 0.3 } });
  assert((shot.content as any[]).some((c) => c.type === "image"));
  assert.equal(await chrome(`${spaces}.activeWorkspace`), before);
  console.log("ok  navigate, find, click and screenshot work in the hidden space");

  const listed = JSON.parse(await tool("tabs_context_mcp"));
  assert(
    listed.tabs.some((t: any) => t.tabId === tabId),
    "tab missing from tabs_context_mcp",
  );
  console.log("ok  the tab stays listed while its space is hidden");
} finally {
  if (tabId != null) await tool("tabs_close_mcp", { tabId }).catch(() => {});
  await client?.close().catch(() => {});
  if (original === null) fs.rmSync(configFile, { force: true });
  else fs.writeFileSync(configFile, original);
  await chrome(
    `(async () => { const z = ${spaces}; const s = z.getWorkspaces().find(w => w.name === ${JSON.stringify(SPACE)}); if (s) await z.removeWorkspace(s.uuid); return "ok"; })()`,
  ).catch(() => {});
  console.log("Setting restored, test space removed.");
}
