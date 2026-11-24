import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { approveWhile, fixtureTransportEnv, pageEval } from "./support/fixture.ts";
import { call, type Content } from "../src/zen.ts";
import { reloadBridge } from "./support/bridge.ts";
import "./support/require-sandbox.ts";
const text = (r: Content[]) =>
  r
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
const chrome = async (code: string) => JSON.parse(text(await call("chrome_eval", { code })));
const client = new Client({ name: "codex-mcp-client", version: "extension-smoke" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["src/server.ts"],
  cwd: process.cwd(),
  env: fixtureTransportEnv(),
});
async function tool(name: string, args: Record<string, unknown> = {}): Promise<Content[]> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Content[];
  if (result.isError) throw new Error(text(content));
  return content;
}
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zen-extension-fixture-"));
const extensionId = `zen-mcp-ui-${Date.now()}@local.invalid`;
fs.writeFileSync(
  path.join(directory, "manifest.json"),
  JSON.stringify({
    manifest_version: 2,
    name: "Zen disposable UI fixture",
    version: "1.0",
    browser_specific_settings: { gecko: { id: extensionId } },
    permissions: ["activeTab"],
    browser_action: { default_popup: "popup.html" },
  }),
);
fs.writeFileSync(
  path.join(directory, "popup.html"),
  '<!doctype html><meta charset="utf-8"><title>Disposable extension panel</title><style>body{width:320px;min-height:200px;font:16px sans-serif}button,textarea{display:block;margin:12px;padding:8px}</style><button id="mark">Mark target</button><button id="markdown">Make Markdown</button><textarea aria-label="Output"></textarea><script src="popup.js"></script>',
);
fs.writeFileSync(
  path.join(directory, "popup.js"),
  `document.getElementById('mark').addEventListener('click',async event=>{const [tab]=await browser.tabs.query({active:true,currentWindow:true});await browser.tabs.executeScript(tab.id,{code:'document.body.dataset.extensionTrusted='+JSON.stringify(String(event.isTrusted))});document.querySelector('textarea').value='Marked '+tab.url;});document.getElementById('markdown').addEventListener('click',async()=>{const [tab]=await browser.tabs.query({active:true,currentWindow:true});document.querySelector('textarea').value='# '+tab.title;});`,
);
const server = http.createServer((_, response) => {
  response.setHeader("Content-Type", "text/html");
  response.end("<!doctype html><title>Zen extension fixture</title><h1>Disposable source page</h1>");
});
let tabId: number | undefined,
  installed = false;
const originalSelected = await chrome(
  'Services.wm.getMostRecentWindow("navigator:browser").gBrowser.selectedBrowser.browserId',
);
try {
  const state = await chrome("({paused:h.state.paused,version:h.version})");
  assert(!state.paused, "Resume automation before running this test.");
  console.log(text(await reloadBridge()));
  for (let i = 0; i < 50; i++) {
    await sleep(50);
    try {
      if (await chrome(`h.version>${state.version}`)) break;
    } catch {}
  }
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  await chrome(
    `(async()=>{const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');const f=Components.classes['@mozilla.org/file/local;1'].createInstance(Components.interfaces.nsIFile);f.initWithPath(${JSON.stringify(directory)});await AddonManager.installTemporaryAddon(f);return true;})()`,
  );
  installed = true;
  await client.connect(transport);
  const list = JSON.parse(text(await tool("extensions", { action: "list" })));
  assert(list.extensions.some((e: any) => e.id === extensionId && e.hasToolbarAction));
  tabId = JSON.parse(text(await tool("tabs_create_mcp"))).tabId;
  await tool("navigate", { tabId, url: `http://127.0.0.1:${address.port}/` });
  const ext = (action: string, args: object = {}) => tool("extensions", { action, tabId, extensionId, ...args });
  // why: Auto mode still asks for extension actions, so answer only this check's own prompts.
  const act = (action: string, args: object = {}) => approveWhile(ext(action, args), "wants to");
  async function answerSwitch(allow: boolean) {
    for (let i = 0; i < 100; i++) {
      const answered = await chrome(
        `(()=>{if(h.island.state!=="ask")return false;const node=h.findTab(${tabId}).ownerDocument.getElementById('zen-mcp-island');if(!node.textContent.includes('Zen disposable UI fixture'))return false;node.querySelector(${JSON.stringify(allow ? ".ok" : ".cancel")}).click();return true;})()`,
      );
      if (answered) return;
      await sleep(50);
    }
    throw new Error("Expected tab-switch permission did not appear");
  }
  const denied = ext("open").then(
    () => null,
    (error) => error,
  );
  await answerSwitch(false);
  assert.match(String(await denied), /denied switching/);
  assert.equal(
    await chrome('Services.wm.getMostRecentWindow("navigator:browser").gBrowser.selectedBrowser.browserId'),
    originalSelected,
  );
  console.log("✓ Auto mode still asks before switching; denial preserves the selected tab");
  const opening = ext("open");
  await answerSwitch(true);
  assert(JSON.parse(text(await opening)).opened);
  console.log("✓ Explicit island approval allows the switch and extension invocation");
  const tree = text(await ext("read"));
  const ref = tree.match(/button "Mark target" \[([^\]]+)\]/)?.[1];
  assert(ref, tree);
  assert(ref.startsWith("panel_"), "Panel refs must be isolated from page refs");
  await assert.rejects(
    act("computer", { computerAction: "left_click", ref: "ref_1" }),
    /not from the current extension panel/,
  );
  const shot = await ext("computer", { computerAction: "screenshot", scale: 0.5 });
  assert(shot.some((c) => c.type === "image"));
  await act("computer", { computerAction: "left_click", ref });
  await sleep(100);
  const source = await pageEval(tabId!, "document.body.dataset.extensionTrusted");
  assert(source.includes("true"), source);
  console.log(
    "✓ Extension discovery → native popup → isolated refs → screenshot → trusted click with activeTab access",
  );
  const markdownRef = text(await ext("read")).match(/button "Make Markdown" \[([^\]]+)\]/)?.[1];
  assert(markdownRef);
  await act("computer", { computerAction: "left_click", ref: markdownRef });
  await sleep(50);
  assert(text(await ext("read")).includes("# Zen extension fixture"));
  console.log("✓ Agent can use a generic conversion UI and read its result");
  const outputRef = text(await ext("read")).match(/textbox "Output" \[([^\]]+)\]/)?.[1];
  assert(outputRef);
  await act("form_input", { ref: outputRef, value: "editable output" });
  await act("computer", { computerAction: "left_click", ref: outputRef });
  await act("computer", { computerAction: "key", text: "ctrl+a" });
  await act("computer", { computerAction: "type", text: "typed through extension UI" });
  assert(text(await ext("read")).includes("typed through extension UI"));
  console.log("✓ Panel form input, keyboard shortcuts and trusted typing work");

  await ext("close");
  await assert.rejects(ext("read"), /No extension panel/);
  if (list.extensions.some((e: any) => e.id === "uBlock0@raymondhill.net" && e.enabled)) {
    await tool("extensions", { action: "open", tabId, extensionId: "uBlock0@raymondhill.net" });
    assert(
      text(await tool("extensions", { action: "read", tabId, extensionId: "uBlock0@raymondhill.net" })).includes(
        "uBlock",
      ),
    );
    await tool("extensions", { action: "close", tabId, extensionId: "uBlock0@raymondhill.net" });
    console.log("✓ Existing uBlock Origin panel can be read without changing its settings");
  }
  console.log("All live extension UI checks passed.");
} finally {
  if (tabId !== undefined) {
    await tool("extensions", { action: "close", tabId, extensionId }).catch(() => {});
    await chrome(
      `(()=>{const tab=h.findTab(${originalSelected});const test=h.findTab(${tabId});if(tab&&test&&test.ownerDocument.defaultView.gBrowser.selectedTab===test)tab.ownerDocument.defaultView.gBrowser.selectedTab=tab;return true;})()`,
    ).catch(() => {});
    await tool("tabs_close_mcp", { tabId }).catch(console.error);
  }
  await client.close();
  if (installed)
    await chrome(
      `(async()=>{const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');await(await AddonManager.getAddonByID(${JSON.stringify(extensionId)}))?.uninstall();return true;})()`,
    );
  server.closeAllConnections();
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(directory, { recursive: true });
}
