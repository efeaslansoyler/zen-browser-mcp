import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../dist/server.js";
import { identifyAgent, agentTheme, applyTheme } from "../browser/Agent.sys.mjs";

test("client identity uses initialization metadata and provides safe theme fallbacks", () => {
  assert.deepEqual(identifyAgent("codex-mcp-client"), { id: "codex", name: "Codex" });
  assert.deepEqual(identifyAgent("claude-code"), { id: "claude", name: "Claude" });
  assert.equal(identifyAgent("Other Client").name, "Other Client");
  assert.equal(identifyAgent("Proxy Client", "codex").id, "codex");
  assert.equal(agentTheme({ id: "__proto__", name: "Other" }).id, "generic");
  const props = new Map();
  const el = { style: { setProperty: (k, v) => props.set(k, v) }, setAttribute: (k, v) => props.set(k, v) };
  applyTheme(el, identifyAgent("codex"));
  assert.equal(props.get("--zen-agent-accent"), "#a7e8d0");
  applyTheme(el, identifyAgent("claude"));
  assert.equal(props.get("--zen-agent-accent"), "#d97757");
  applyTheme(el, identifyAgent("unrecognized"));
  assert.equal(props.get("data-zen-agent"), "generic");
});

for (const name of ["codex-mcp-client", "claude-code", "Example Agent"]) {
  test(`MCP tools and browser calls work with ${name}`, async () => {
    const received = [];
    const server = createServer(async (...args) => {
      received.push(args);
      return [{ type: "text", text: "browser reply" }];
    });
    const client = new Client({ name, version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const { tools } = await client.listTools();
      assert.equal(tools.length, 28);
      const computer = tools.find((t) => t.name === "computer");
      const schema = computer.inputSchema;
      for (const key of ["coordinate", "start_coordinate"]) {
        assert.deepEqual(schema.properties[key].items, { type: "number" });
        assert.equal(schema.properties[key].minItems, 2);
        assert.equal(schema.properties[key].maxItems, 2);
        assert.equal(schema.properties[key].prefixItems, undefined);
      }
      assert(!JSON.stringify(schema).includes("prefixItems"));
      for (const name of ["read_page", "get_page_text"]) {
        const readSchema = tools.find((tool) => tool.name === name).inputSchema;
        assert.equal(readSchema.properties.diff.type, "boolean");
        assert.equal(readSchema.properties.since.type, "string");
        const read = await client.callTool({ name, arguments: { tabId: 1, diff: true, since: "snapshot-fixture" } });
        assert.equal(read.isError, undefined);
        assert.equal(received.at(-1)[1].since, "snapshot-fixture");
      }
      received.length = 0;

      const result = await client.callTool({
        name: "computer",
        arguments: { action: "left_click", coordinate: [10, 20], tabId: 1 },
      });
      assert.equal(result.isError, undefined);
      assert.equal(received[0][0], "computer");
      assert.deepEqual(received[0][1].coordinate, [10, 20]);
      assert.deepEqual(received[0][3], identifyAgent(name));
      const invalid = await client.callTool({
        name: "computer",
        arguments: { action: "left_click", coordinate: [10], tabId: 1 },
      });
      assert.equal(invalid.isError, true);
      assert.equal(received.length, 1, "invalid input never reaches browser");
      await client.callTool({
        name: "browser_batch",
        arguments: { actions: [{ name: "computer", input: { action: "screenshot", tabId: 1 } }] },
      });
      assert.equal(received[1][0], "browser_batch");
      assert.deepEqual(received[1][3], identifyAgent(name));
      const inputs = {
        react: { action: "tree", tabId: 1 },
        accessibility: { tabId: 1, tags: ["wcag2a"] },
        browser_settings: { action: "get", tabId: 1 },
        clipboard: { action: "read", tabId: 1 },
        extensions: { action: "list" },
        tab_work: { action: "list" },
        tabs_context_mcp: {},
        tabs_create_mcp: {},
        tabs_close_mcp: { tabId: 1 },
        navigate: { tabId: 1, url: "https://example.test" },
        computer: { tabId: 1, action: "screenshot", scale: 0.5 },
        read_page: { tabId: 1 },
        find: { tabId: 1, query: "Submit" },
        wait_for: { tabId: 1, text: "Ready" },
        downloads: { tabId: 1, action: "list" },
        watch: { action: "list" },
        form_input: { tabId: 1, ref: "ref_1", value: "hello" },
        get_page_text: { tabId: 1 },
        ask_user: { tabId: 1, message: "Please check", coordinate: [1, 2] },
        hand_to_user: { tabId: 1, message: "Log in, then press Done" },
        request_tab: { tabId: 1, reason: "Inspect the selected element" },
        file_upload: { tabId: 1, ref: "ref_1", paths: ["/tmp/test.txt"] },
        handle_dialog: { tabId: 1, accept: false },
        read_console_messages: { tabId: 1 },
        read_network_requests: { tabId: 1 },
        javascript_tool: { tabId: 1, action: "javascript_exec", text: "document.title" },
        browser_batch: { actions: [{ name: "get_page_text", input: { tabId: 1 } }] },
      };
      for (const tool of tools) {
        assert(!JSON.stringify(tool.inputSchema).includes("prefixItems"));
        if (tool.name === "connect_session") continue;
        assert(inputs[tool.name], `Missing protocol fixture for ${tool.name}`);
        const result = await client.callTool({ name: tool.name, arguments: inputs[tool.name] });
        assert.equal(result.isError, undefined, tool.name);
        assert.deepEqual(received.at(-1)[3], identifyAgent(name));
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
}

test("browser errors retain the MCP error flag and partial batch output", async () => {
  const server = createServer(async (name) => {
    if (name === "browser_batch")
      return Object.assign([{ type: "text", text: "[1] done\n[2] failed" }], { isError: true });
    throw new Error("Browser unavailable");
  });
  const client = new Client({ name: "codex", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  try {
    const batch = await client.callTool({
      name: "browser_batch",
      arguments: { actions: [{ name: "get_page_text", input: { tabId: 1 } }] },
    });
    assert.equal(batch.isError, true);
    assert.match(batch.content[0].text, /\[1\] done/);
    const failed = await client.callTool({ name: "tabs_create_mcp", arguments: {} });
    assert.equal(failed.isError, true);
    assert.equal(failed.content[0].text, "Browser unavailable");
  } finally {
    await client.close();
    await server.close();
  }
});

test("server instructions stay well under Claude Code's 4096-character cut", async () => {
  const { channelInstructions, clientInstructions } = await import("../dist/instructions.js");
  for (const text of [channelInstructions, clientInstructions])
    assert(text.length <= 2600, `${text.length} characters`);
});
