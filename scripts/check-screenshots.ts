import assert from "node:assert/strict";
import { createServer } from "node:http";
import { call, type Content } from "../src/zen.ts";
import { pageEval } from "./support/fixture.ts";
import "./support/require-sandbox.ts";

const json = (content: Content[]) => JSON.parse(content.find((item) => item.type === "text")!.text);
let color = "white";
const server = createServer((request, response) => {
  const fill = request.url === "/preview" ? "royalblue" : color;
  response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }).end(
    `<style>html{scrollbar-width:none}</style><body style="margin:0;height:2200px;background:${fill}">
      <div style="position:absolute;top:2000px;background:blue">end</div></body>`,
  );
});
await new Promise<void>((resolve) => server.listen(0, resolve));
const { port } = server.address() as { port: number };
const tabs: number[] = [];
const open = async () => {
  const tabId = json(await call("tabs_create_mcp")).tabId;
  tabs.push(tabId);
  return tabId;
};
const screenshot = (tabId: number, args = {}) => call("computer", { tabId, action: "screenshot", ...args });
try {
  const tabId = await open();
  const url = `http://127.0.0.1:${port}/`;
  await call("navigate", { tabId, url });
  const baseline = json(await screenshot(tabId, { diff: true, baseline_scope: "deploy" })).baseline;
  const documentBaseline = json(await screenshot(tabId, { diff: true })).baseline;
  assert.equal(json(await screenshot(tabId, { diff: true, since: baseline })).changed, 0);
  color = "black";
  await call("navigate", { tabId, url });
  const result = await screenshot(tabId, { diff: true, since: baseline });
  assert(result.some((item) => item.type === "image" && item.mimeType === "image/png"));
  assert(json(result).ratio > 0.5);
  assert.equal(json(await screenshot(tabId, { diff: true, since: documentBaseline })).compared, false);
  const preview = await open();
  await call("navigate", { tabId: preview, url: `http://localhost:${port}/preview` });
  assert(json(await screenshot(preview, { diff: true, since: baseline })).ratio > 0.5);
  console.log("OK: viewport diffs across same-URL reload and two owned tabs on different hosts");

  await pageEval(tabId, "window.scrollTo(0, 300); window.scrollY");
  await screenshot(tabId, { scale: 0.5 });
  const scale = async () =>
    json(
      await call("chrome_eval", {
        code: `[...h.state.screenshots.values()].find((entry) => entry.tabId === ${tabId}).shots.at(-1).scale`,
      }),
    );
  const previousScale = await scale();
  const position = () => pageEval(tabId, "window.scrollY");
  const previousY = await position();
  const full = await screenshot(tabId, { full_page: true });
  assert(full.some((item) => item.type === "image" && item.data.length > 100));
  assert(json(full).documentHeight >= 2200);
  assert.equal(json(full).fullPage, true);
  assert.equal(await scale(), previousScale);
  assert.equal(await position(), previousY);
  console.log("OK: full document capture preserves scroll and viewport click scale");
} finally {
  try {
    for (const tabId of tabs.reverse()) await call("tabs_close_mcp", { tabId });
  } finally {
    server.close();
  }
}
