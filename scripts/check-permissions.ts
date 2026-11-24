// why: Use loopback fixtures and restore config because this check exercises permission mode changes.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { call, type Content } from "../src/zen.ts";
import { normalizeConfig } from "../browser/SiteRules.sys.mjs";
import { reloadBridge } from "./support/bridge.ts";
import "./support/require-sandbox.ts";
const text = (result: Content[]) =>
  result
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
const chrome = async (code: string) => JSON.parse(text(await call("chrome_eval", { code })));
const command = (tool: string, args: object = {}) => call(tool, args, 30_000, { id: "codex", name: "Codex" });
const configFile = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "zen-mcp/config.json");
const token = `zen-permission-test-${Date.now()}`;
let tabId: number | undefined,
  modified = false,
  temporary = "",
  backupFile: string | undefined;
const original = fs.existsSync(configFile) ? fs.readFileSync(configFile) : undefined;
let otherURL = "";
const server = http.createServer((request, response) => {
  if (request.url === "/redirect") {
    response.writeHead(302, { Location: otherURL });
    response.end();
    return;
  }
  if (request.url === "/embed") {
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><title>Embedded fixture</title><iframe src="${otherURL}"></iframe>`);
    return;
  }
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(
    '<!doctype html><title>Zen permission test</title><h1>Disposable permission test</h1><p id="result">untouched</p>',
  );
});
const write = () => ({
  name: "javascript_tool",
  input: { tabId, text: `document.getElementById("result").textContent=${JSON.stringify(token)}` },
});
const settle = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ value, error: undefined }),
    (error) => ({ value: undefined, error }),
  );
async function answer(result: "done" | "cancelled") {
  for (let i = 0; i < 100; i++) {
    const clicked = await chrome(`(() => {
      if(h.island.state!=="ask") return false;
      const el=h.findTab(${tabId}).ownerDocument.getElementById("zen-mcp-island");
      if(!el.textContent.includes(${JSON.stringify(token)})) return false;
      el.querySelector(${JSON.stringify(result === "done" ? ".ok" : ".cancel")}).click();
      return true;
    })()`);
    if (clicked) return;
    await sleep(50);
  }
  throw new Error("Expected permission prompt for the disposable fixture did not appear.");
}
try {
  const state = await chrome("({version:h.version,paused:h.state.paused})");
  assert(!state.paused, "Resume automation before running this test.");
  const settings = normalizeConfig(original ? JSON.parse(original.toString()) : {});
  assert(settings.mode === "auto", "This test requires the auto mode; no settings have been changed.");
  assert(
    settings.sites.mode === "blocklist" &&
      !settings.sites.blocklist.some((host: string) => ["localhost", "127.0.0.1"].includes(host)),
    "This test needs a blocklist without the local fixture hosts; no settings have been changed.",
  );
  console.log(text(await reloadBridge()));
  let ready = false;
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    try {
      if (await chrome(`h.version>${state.version}`)) {
        ready = true;
        break;
      }
    } catch {}
  }
  assert(ready, "Bridge reload failed; check $XDG_RUNTIME_DIR/zen-mcp.log.");
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  const ordinaryURL = `http://localhost:${address.port}/`;
  // why: Use another host name on the same fixture server to produce a different origin.
  otherURL = `http://127.0.0.1:${address.port}/`;
  tabId = JSON.parse(text(await command("tabs_create_mcp"))).tabId;
  await command("navigate", { tabId, url: ordinaryURL });
  temporary = JSON.stringify(settings, null, 2) + "\n";
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  if (original) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zen-permission-backup-"));
    backupFile = path.join(dir, "config.json");
    fs.writeFileSync(backupFile, original, { mode: 0o600 });
  }
  await sleep(20); // why: Config reload detects mtime, so make the fixture's revisions distinct.
  fs.writeFileSync(configFile, temporary, { mode: 0o600 });
  modified = true;
  for (const redirect of [false, true]) {
    await command("navigate", { tabId, url: ordinaryURL });
    const pending = settle(
      command("browser_batch", {
        actions: [
          { name: "navigate", input: { tabId, url: redirect ? ordinaryURL + "redirect" : otherURL } },
          write(),
          write(),
        ],
      }),
    );
    await answer("cancelled");
    const result = await pending;
    assert(!result.error, String(result.error));
    assert(result.value?.isError, "Denied action must fail the batch");
    assert.match(text(result.value), /remaining 1 step/);
    const content = text(await command("get_page_text", { tabId }));
    assert(content.includes("untouched") && !content.includes(token), "A denied write ran");
    console.log(
      `✓ After ${redirect ? "an HTTP redirect" : "navigation"} to another origin, risky writes ask there; denial blocks the rest`,
    );
  }
  await command("navigate", { tabId, url: ordinaryURL });
  const allowed = settle(
    command("browser_batch", {
      actions: [{ name: "navigate", input: { tabId, url: otherURL } }, write(), write()],
    }),
  );
  await answer("done");
  const result = await allowed;
  assert(!result.error && !result.value?.isError, "Same-document writes failed after approval");
  assert(text(await command("get_page_text", { tabId })).includes(token));
  console.log("✓ Approval allows grouped writes on the unchanged destination document");
  temporary = JSON.stringify({ ...settings, mode: "ask" }, null, 2) + "\n";
  await sleep(20);
  fs.writeFileSync(configFile, temporary, { mode: 0o600 });
  const extensionAttempt = settle(command("extensions", { tabId, action: "open", extensionId: token }));
  await answer("cancelled");
  const extensionDenied = await extensionAttempt;
  assert(
    extensionDenied.error && /denied/.test(String(extensionDenied.error)),
    "Extension invocation must use source-site approval",
  );
  console.log("✓ Extension toolbar invocation respects source-site approval and denial");
  temporary = JSON.stringify(settings, null, 2) + "\n";
  await sleep(20);
  fs.writeFileSync(configFile, temporary, { mode: 0o600 });

  const ordinaryTab = JSON.parse(text(await command("tabs_create_mcp"))).tabId;
  const embeddedTab = JSON.parse(text(await command("tabs_create_mcp"))).tabId;
  try {
    await command("navigate", { tabId: ordinaryTab, url: ordinaryURL });
    await command("navigate", { tabId: embeddedTab, url: ordinaryURL + "embed" });
    temporary =
      JSON.stringify(
        { ...settings, sites: { ...settings.sites, blocklist: [...settings.sites.blocklist, "127.0.0.1"] } },
        null,
        2,
      ) + "\n";
    await sleep(20);
    fs.writeFileSync(configFile, temporary, { mode: 0o600 });
    for (const tool of ["get_page_text", "read_page", "javascript_tool", "computer"]) {
      const result = await settle(command(tool, { tabId, text: "document.title", action: "screenshot" }));
      assert(result.error && /blocked/.test(String(result.error)), `${tool} must reject blocked page`);
    }
    console.log("✓ Blocked page rejects text/tree reads, JavaScript and screenshots");
    const blockedExtension = await settle(
      command("extensions", { tabId, action: "open", extensionId: "uBlock0@raymondhill.net" }),
    );
    assert(blockedExtension.error && /blocked/.test(String(blockedExtension.error)));
    console.log("✓ Blocked source site cannot be accessed through an extension panel");

    const embedded = await settle(command("computer", { tabId: embeddedTab, action: "screenshot" }));
    assert(
      embedded.error && /blocked/.test(String(embedded.error)),
      "A blocked iframe must prevent parent screenshots",
    );
    console.log("✓ Loaded blocked iframe prevents screenshot access to its ordinary parent page");
    for (const url of [otherURL, ordinaryURL + "redirect"]) {
      const result = await settle(command("navigate", { tabId: ordinaryTab, url }));
      assert(result.error && /blocked/.test(String(result.error)), `Navigation must reject ${url}: ${result.error}`);
    }
    console.log("✓ Direct navigation and HTTP redirect to blocked site rejected");
    const listing = JSON.parse(text(await command("tabs_context_mcp")));
    const blocked = listing.tabs.find((tab: any) => tab.tabId === tabId);
    assert(blocked.blocked && !blocked.title && !blocked.url);
    console.log("✓ Blocked tab title and URL are redacted from agent tab list");
    const menu = await chrome(`(() => {
      const tab=h.findTab(${tabId}); const win=tab.ownerDocument.defaultView;
      h.prepareTabMenu(win,[tab]);
      const menu=win.document.getElementById('tabContextMenu');
      const labels=menu.querySelector('#zen-mcp-context-give-permissions');
      if (!labels) return null;
      const site=labels.querySelector('[data-zen-site]');
      return {
        lists: [...labels.querySelectorAll('[data-zen-site-list]')].map(el=>el.getAttribute('checked')),
        site: { label: site.getAttribute('label'), checked: site.getAttribute('checked') },
      };
    })()`);
    assert.deepEqual(menu?.lists, ["true", null], JSON.stringify(menu));
    assert.deepEqual(menu?.site, { label: "Block 127.0.0.1", checked: "true" }, JSON.stringify(menu));
    console.log("✓ Real tab context menu shows the blocklist and this site blocked");
  } finally {
    await command("tabs_close_mcp", { tabId: embeddedTab });
    await command("tabs_close_mcp", { tabId: ordinaryTab });
  }
  console.log("All live permission and site-list checks passed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  // why: Answer only the fixture's prompt so failure cannot leave the tool queue blocked.
  if (tabId !== undefined) {
    await chrome(`(() => {
      const el=h.findTab(${tabId})?.ownerDocument.getElementById("zen-mcp-island");
      if(h.island.state==="ask" && el?.textContent.includes(${JSON.stringify(token)})) el.querySelector('.cancel').click();
      return true;
    })()`).catch(() => {});
  }
  if (modified) {
    if (fs.readFileSync(configFile, "utf8") === temporary) {
      if (original) fs.writeFileSync(configFile, original);
      else fs.unlinkSync(configFile);
      console.log("Original permission configuration restored.");
      if (backupFile) fs.rmSync(path.dirname(backupFile), { recursive: true });
    } else {
      console.error(
        `Configuration changed during test; left it intact. Original backup: ${backupFile || "(no original file)"}`,
      );
      process.exitCode = 1;
    }
  }
  if (tabId !== undefined)
    await command("tabs_close_mcp", { tabId }).catch((error) => {
      console.error("Test tab cleanup failed:", error);
      process.exitCode = 1;
    });
  server.closeAllConnections();
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
}
