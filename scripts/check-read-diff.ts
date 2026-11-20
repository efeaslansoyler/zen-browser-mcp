// Real MCP read/diff tests in disposable tabs. Run: node scripts/check-read-diff.ts
// Requires existing auto mode. Never modifies permission settings or non-fixture tabs.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { pageEval } from "./support/fixture.ts";
import { call } from "../src/zen.ts";
const text = (result: { content: any[] }) =>
  result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
const chrome = async (code: string) => JSON.parse(text({ content: await call("chrome_eval", { code }) }));
const id = (value: string) => {
  const match = /^snapshot: (\S+)/.exec(value);
  assert(match, value);
  return match[1];
};
const clients: Client[] = [],
  tabs = new Set<number>();
async function tool(client: Client, name: string, args: object = {}, error = false) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 40_000 });
  assert.equal(Boolean(result.isError), error, text(result));
  return text(result);
}
async function connect(name: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const client = new Client({ name, version: "read-diff-test" });
  clients.push(client);
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["src/server.ts"],
      cwd: process.cwd(),
      env: { ...env, ZEN_MCP_CHANNEL: "0" },
    }),
  );
  return client;
}
try {
  const configFile = path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
    "zen-mcp/config.json",
  );
  const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, "utf8")) : {};
  assert(config.mode !== "ask", "Requires your existing auto mode; no settings changed.");
  const before = await chrome("({version:h.version,paused:h.state.paused})");
  assert(!before.paused, "Resume browser automation before testing.");
  console.log(text({ content: await call("reload") }));
  let ready = false;
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    try {
      if (await chrome(`h.version>${before.version}`)) {
        ready = true;
        break;
      }
    } catch {}
  }
  assert(ready, "Read snapshot bridge did not reload.");
  const a = await connect("codex-mcp-client"),
    b = await connect("claude-code");
  const html = `<!doctype html><meta charset="utf-8"><title>Read diff fixture</title><h1>Read diff fixture</h1>
    <script>for (let i = 0; i < 200; i++) document.write('<p id="row' + i + '">Row ' + i + ': stable visible fixture content.</p>');</script>
    <div id="controls"></div>`;
  const url = "data:text/html;charset=utf-8," + encodeURIComponent(html);
  const formUrl =
    "data:text/html;charset=utf-8," +
    encodeURIComponent(
      '<label>Fixture name <input id="fixture-name"></label><button onclick="document.querySelector(\'#answer\').textContent=document.querySelector(\'#fixture-name\').value">Show name</button><p id="answer"></p>',
    );
  const opened = await tool(a, "tabs_create_mcp", { url: formUrl, read: "interactive" });
  const first = JSON.parse(opened.split("\n", 1)[0]);
  tabs.add(first.tabId);
  const second = JSON.parse(await tool(b, "tabs_create_mcp"));
  tabs.add(second.tabId);
  const sessionB = JSON.parse(await tool(b, "tabs_context_mcp")).session.id;
  const tabId = first.tabId;
  assert.equal(first.url, formUrl);
  const field = /textbox "Fixture name" \[([^\]]+)\]/.exec(opened)?.[1];
  const button = /button "Show name" \[([^\]]+)\]/.exec(opened)?.[1];
  assert(field && button, opened);
  await tool(a, "form_input", { tabId, ref: field, value: "Name from embedded refs" });
  await tool(a, "computer", { tabId, action: "left_click", ref: button });
  assert.match(await tool(a, "get_page_text", { tabId }), /Name from embedded refs/);
  const navigated = await tool(a, "navigate", { tabId, url, read: "all" });
  assert.match(navigated, /heading "Read diff fixture"/);
  assert.match(navigated, /Row 0: stable visible fixture content/);
  assert.match(navigated, /truncated at 8000 characters/);
  console.log("✓ Create and navigate return destination content with refs usable for form input and clicks");
  const page = (code: string) => pageEval(tabId, code);
  const read = (name: string, args: object = {}) => tool(a, name, { tabId, ...args });
  const fullText = await read("get_page_text", { diff: true });
  assert.match(fullText, /mode: full/);
  assert(!/^snapshot:/.test(await read("get_page_text")), "Plain-text compatibility regressed.");
  assert.match(await read("get_page_text", { diff: true, since: id(fullText) }), /mode: unchanged/);
  await page(
    'document.getElementById("row10").textContent="Edited first row";document.getElementById("row180").textContent="Edited distant row"',
  );
  const changed = await read("get_page_text", { diff: true, since: id(fullText) });
  assert.match(changed, /mode: diff/);
  assert.match(changed, /\+Edited first row/);
  assert.match(changed, /\+Edited distant row/);
  assert(changed.length < fullText.length / 4, "Delta was not substantially smaller than the full output.");
  console.log(
    `✓ Text: plain format preserved; unchanged compact; distant edits ${fullText.length} → ${changed.length} characters`,
  );

  const tree = await read("read_page", { diff: true });
  await page(
    'const button=document.createElement("button");button.textContent="New diff action";button.onclick=()=>document.getElementById("row0").textContent="Diff button clicked";document.getElementById("controls").append(button)',
  );
  const delta = await read("read_page", { diff: true, since: id(tree) });
  assert.match(delta, /mode: diff/);
  const ref = /\+.*button "New diff action" \[([^\]]+)\]/.exec(delta)?.[1];
  assert(ref, delta);
  await tool(a, "computer", { tabId, action: "left_click", ref });
  assert((await read("get_page_text")).includes("Diff button clicked"));
  assert.match(
    await read("read_page", { diff: true, filter: "interactive", since: id(delta) }),
    /mode: full \(no-baseline\)/,
  );
  assert.match(
    await read("read_page", { diff: true, max_chars: 2000, since: id(delta) }),
    /mode: full \(no-baseline\)/,
  );
  assert.match(await read("read_page", { diff: true, since: "missing-snapshot" }), /mode: full \(base-unavailable\)/);
  console.log(
    "✓ Tree: new control appears in delta with actionable ref; options and invalid IDs return a fresh full baseline",
  );

  const beforeReload = await read("get_page_text", { diff: true });
  await tool(a, "navigate", { tabId, url });
  assert.match(
    await read("get_page_text", { diff: true, since: id(beforeReload) }),
    /mode: full \(document-or-owner-changed\)/,
  );
  // Frame identity changes must invalidate even when the frame is empty.
  const iframe = "data:text/html," + encodeURIComponent("<p>Child fixture</p>");
  await page(
    `const frame=document.createElement('iframe');frame.id='fixture-frame';frame.src=${JSON.stringify(iframe)};document.body.append(frame);'added'`,
  );
  await tool(a, "computer", { tabId, action: "wait", duration: 1 });
  const framed = await read("get_page_text", { diff: true });
  await page('document.getElementById("fixture-frame").remove()');
  assert.match(
    await read("get_page_text", { diff: true, since: id(framed) }),
    /mode: full \(document-or-owner-changed\)/,
  );
  console.log("✓ Same-URL document reload and iframe removal invalidate the baseline");

  const owned = await read("read_page", { diff: true });
  await tool(b, "read_page", { tabId, diff: true, since: id(owned) }, true);
  await tool(b, "navigate", { tabId: second.tabId, url });
  assert.match(
    await tool(b, "read_page", { tabId: second.tabId, diff: true, since: id(owned) }),
    /mode: full \(no-baseline\)/,
  );
  await chrome(`(() => {
    const tab=h.findTab(${tabId}), win=tab.ownerDocument.defaultView;
    h.prepareTabMenu(win,[tab]);
    const item=[...win.document.getElementById('tabContextMenu').querySelectorAll('[data-zen-session]')].find(item=>item.getAttribute('data-zen-session')===${JSON.stringify(sessionB)});
    if(!item)throw new Error('Fixture session menu missing');item.doCommand();return true;
  })()`);
  // shared now: both read it, and each keeps its own baselines
  assert.match(await tool(b, "read_page", { tabId, diff: true, since: id(owned) }), /mode: full \(no-baseline\)/);
  assert.doesNotMatch(await tool(a, "read_page", { tabId, diff: true, since: id(owned) }), /mode: full/);
  console.log(
    "✓ Real Codex/Claude MCP sessions cannot read foreign tabs or reuse another session’s baseline after sharing",
  );
  console.log("All live read-diff checks passed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await Promise.allSettled(clients.map((client) => client.close()));
  for (const tabId of tabs) {
    await chrome(
      `(() => {const tab=h.findTab(${tabId});if(tab)tab.ownerDocument.defaultView.gBrowser.removeTab(tab,{animate:false,skipPermitUnload:true});return true;})()`,
    ).catch((error) => {
      console.error(`Could not close fixture tab ${tabId}:`, error);
      process.exitCode = 1;
    });
  }
  if (tabs.size) console.log("Disposable test tabs closed; permission settings unchanged.");
}
