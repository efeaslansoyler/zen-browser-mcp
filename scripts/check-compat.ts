// why: Open only test-owned tabs and avoid writing the user's permission config.
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { call, type AgentIdentity, type Content } from "../src/zen.ts";
import { identifyAgent } from "../browser/Agent.sys.mjs";
import { reloadBridge } from "./support/bridge.ts";

const text = (content: Content[]) =>
  content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
const parse = (content: Content[]) => JSON.parse(text(content));
const command = (agent: AgentIdentity, tool: string, args: object = {}) => call(tool, args, 60_000, agent);
const fixture =
  "data:text/html;charset=utf-8," +
  encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>Zen MCP compatibility test</title>
<style>body{font:20px system-ui;padding:40px;background:#fafafa}input,button{font:inherit;padding:12px}</style>
<h1>Zen MCP compatibility test</h1><label>Message <input id="message"></label>
<button onclick="document.getElementById('result').textContent='Result: '+document.getElementById('message').value">Run test</button><p id="result">Waiting</p>`);

if (process.argv.includes("--reload")) {
  console.log(text(await reloadBridge()));
  let ready = false;
  for (let i = 0; i < 30; i++) {
    await sleep(100);
    try {
      await call("ping", {}, 1000);
      ready = true;
      break;
    } catch {}
  }
  assert(ready, "Bridge did not restart");
}

for (const name of ["claude-code", "codex-mcp-client", "Example Agent"]) {
  const agent = identifyAgent(name);
  const created = parse(await command(agent, "tabs_create_mcp"));
  const tabId = created.tabId;
  try {
    const navigated = parse(await command(agent, "navigate", { tabId, url: fixture }));
    assert.equal(navigated.url, fixture, "navigate returned before leaving the initial blank page");
    const tree = text(await command(agent, "read_page", { tabId }));
    const field = tree.match(/textbox "Message" \[([^\]]+)\]/)?.[1];
    const button = tree.match(/button "Run test" \[([^\]]+)\]/)?.[1];
    assert(field && button, `Missing test controls: ${tree}`);
    await command(agent, "form_input", { tabId, ref: field, value: "form test" });
    await command(agent, "computer", { tabId, action: "left_click", ref: field });
    await command(agent, "computer", { tabId, action: "key", text: "ctrl+a" });
    await command(agent, "computer", { tabId, action: "type", text: agent.name });
    await command(agent, "computer", { tabId, action: "left_click", ref: button });
    assert(text(await command(agent, "get_page_text", { tabId })).includes(`Result: ${agent.name}`));
    const screenshot = await command(agent, "computer", { tabId, action: "screenshot", scale: 0.5 });
    assert(
      screenshot.some((c) => c.type === "image" && c.data.length > 100),
      "No screenshot",
    );
    // why: Page JavaScript cannot inspect privileged chrome, so use the existing development command.
    const presentation = parse(
      await call("chrome_eval", {
        code: `(() => {
      const tab=h.findTab(${tabId});
      const island=tab.ownerDocument.getElementById('zen-mcp-island');
      return {tabAgent:tab.getAttribute('data-zen-agent'),islandAgent:island.getAttribute('data-zen-agent'),label:island.getAttribute('aria-label'),accent:tab.style.getPropertyValue('--zen-agent-accent')};
    })()`,
      }),
    );
    assert.equal(presentation.tabAgent, agent.id);
    assert.equal(presentation.islandAgent, agent.id);
    assert.equal(presentation.label, agent.name);
    assert(presentation.accent.startsWith("#"));
    const batch = await command(agent, "browser_batch", {
      actions: [
        { name: "get_page_text", input: { tabId } },
        { name: "nonexistent_tool", input: { tabId } },
        {
          name: "javascript_tool",
          input: { tabId, action: "javascript_exec", text: 'document.title="SHOULD NOT RUN"' },
        },
      ],
    });
    assert.equal(batch.isError, true, "Failed batch must report isError");
    assert(!text(await command(agent, "get_page_text", { tabId })).startsWith("SHOULD NOT RUN"));
    console.log(`✓ ${agent.name}: navigate, read, form, mouse, keys, type, screenshot, island/tab theme, batch errors`);
  } finally {
    await command(agent, "tabs_close_mcp", { tabId });
  }
}
console.log("All compatibility smoke checks passed. Test tabs closed; permission settings unchanged.");
