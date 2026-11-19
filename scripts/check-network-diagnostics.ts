import assert from "node:assert/strict";
import { createServer } from "node:http";
import { call, type Content } from "../src/zen.ts";

const text = (content: Content[]) =>
  content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
const server = createServer((request, response) => {
  if (request.url === "/missing") {
    response.writeHead(404).end("Missing");
  } else {
    response.writeHead(200, { "Content-Type": "text/html" }).end("<title>Network fixture</title>");
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address() as { port: number };
let tabId: number | undefined;
try {
  tabId = JSON.parse(text(await call("tabs_create_mcp"))).tabId;
  const base = `http://127.0.0.1:${port}`;
  await call("navigate", { tabId, url: base });
  await call("navigate", { tabId, url: base + "/missing" });
  const list = (args = {}) => call("read_network_requests", { tabId, ...args }).then(text);
  assert.match(await list({ method: "get", status: "4xx", resource_type: "document" }), /GET 404 .*missing/);
  assert.match(await list({ method: "POST", status: "4xx" }), /No matching/);
  assert.match(await list({ status: 200, resource_type: "document" }), /GET 200/);
  console.log("OK: network method, status and resource type filters");
} finally {
  try {
    if (tabId !== undefined) await call("tabs_close_mcp", { tabId });
  } finally {
    server.close();
  }
}
