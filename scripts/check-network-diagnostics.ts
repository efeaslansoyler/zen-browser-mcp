import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";
import { approveWhile, pageEval } from "./support/fixture.ts";
import { createServer } from "node:http";
import { call, type Content } from "../src/zen.ts";

const text = (content: Content[]) =>
  content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        healthy: true,
        status: "ready",
        nested: { secret: "fixture-secret" },
        email: "fixture-secret",
      }),
    );
  } else if (request.url?.startsWith("/redirect")) {
    response
      .writeHead(302, {
        Location: `http://localhost:${(server.address() as { port: number }).port}/target?code=fixture-secret`,
        "Set-Cookie": "session=fixture-secret",
        "X-Fake-Token": "fixture-secret",
      })
      .end("fixture-secret");
  } else if (request.url === "/missing") {
    response.writeHead(404).end("Missing");
  } else {
    response.writeHead(200, { "Content-Type": "text/html" }).end("<title>Network fixture</title>");
  }
});
await new Promise<void>((resolve) => server.listen(0, resolve));
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
  const capture = (action: string) => call("network_capture", { action, tabId }, 5000).then(text).then(JSON.parse);
  await approveWhile(capture("start"), "HAR");
  await call("navigate", { tabId, url: base + "/redirect" });
  const saved = await capture("stop");
  try {
    const raw = await readFile(saved.path, "utf8");
    const imported = await call("chrome_eval", {
      code: `(() => {
      const { require } = ChromeUtils.importESModule("resource://devtools/shared/loader/Loader.sys.mjs");
      const { HarImporter } = require("resource://devtools/client/netmonitor/src/har/har-importer.js");
      let count = 0;
      new HarImporter({ clearRequests() {}, addRequest() {}, updateRequest() { count++; }, addTimingMarker() {} })
        .import(${JSON.stringify(raw)});
      return count;
    })()`,
    });
    assert(!raw.includes("fixture-secret"));
    const entries = JSON.parse(raw).log.entries;
    assert.equal(JSON.parse(text(imported)), entries.length);
    assert(
      entries.some((entry: { response: { status: number } }) => entry.response.status === 302),
      raw,
    );
    assert(
      entries.some((entry: { request: { url: string } }) => entry.request.url.includes("localhost")),
      raw,
    );
    assert(
      entries.some((entry: { response: { headers: { name: string }[] } }) =>
        entry.response.headers.some(({ name }) => name.toLowerCase() === "content-type"),
      ),
    );
    console.log("OK: cross-host HAR, safe headers and secret redaction");
  } finally {
    await unlink(saved.path);
  }
  await call("navigate", { tabId, url: base });
  await approveWhile(
    call(
      "network_capture",
      {
        tabId,
        action: "start",
        response_projection: {
          url: base + "/health",
          fields: [{ name: "healthy" }, { name: "status", values: ["ready"] }],
        },
      },
      5000,
    ),
    "selected response fields",
  );
  await pageEval(tabId!, '(async () => (await fetch("/health")).text())()');
  const projected = await capture("stop");
  try {
    const raw = await readFile(projected.path, "utf8");
    assert(!raw.includes("fixture-secret"));
    const entry = JSON.parse(raw).log.entries.find((entry: { request: { url: string } }) =>
      entry.request.url.endsWith("/health"),
    );
    assert.deepEqual(JSON.parse(entry?.response.content.text), { healthy: true, status: "ready" });
    console.log("OK: DevTools HAR import and opt-in JSON response projection");
  } finally {
    await unlink(projected.path);
  }
} finally {
  try {
    if (tabId !== undefined) await call("tabs_close_mcp", { tabId });
  } finally {
    server.close();
  }
}
