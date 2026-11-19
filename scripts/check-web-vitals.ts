import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { call } from "../src/zen.ts";

const server = createServer(async (_request, response) => {
  await sleep(80);
  response
    .writeHead(200, { "Content-Type": "text/html" })
    .end(
      '<title>Vitals fixture</title><h1>Visible content</h1><button onclick="const until=performance.now()+120; while(performance.now()<until){}">Slow fixture</button>',
    );
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address() as { port: number };
const parse = (items: Awaited<ReturnType<typeof call>>) => JSON.parse(items.find((item) => item.type === "text")!.text);
let tabId: number | undefined;
try {
  tabId = parse(await call("tabs_create_mcp")).tabId;
  await call("navigate", { tabId, url: `http://127.0.0.1:${port}` });
  const vitals = async () => parse(await call("web_vitals", { tabId }));
  const initial = await vitals();
  assert.equal(initial.scope, "top-level document");
  assert(initial.metrics.ttfb.value >= 60, JSON.stringify(initial));
  assert.equal(initial.metrics.cls.status, "unsupported");
  assert(["unsupported", "insufficient-data"].includes(initial.metrics.inp.status));
  const tree = (await call("read_page", { tabId }))[0];
  assert(tree.type === "text");
  const ref = tree.text.match(/button "Slow fixture" \[(ref_\w+)\]/)?.[1];
  assert(ref);
  await call("computer", { action: "left_click", tabId, ref });
  await sleep(400);
  const after = await vitals();
  if (after.metrics.inp.status === "provisional") assert(after.metrics.inp.value >= 100);
  console.log(JSON.stringify(after));
  console.log("OK: local navigation and Web Vitals capability states");
} finally {
  try {
    if (tabId !== undefined) await call("tabs_close_mcp", { tabId });
  } finally {
    server.close();
  }
}
