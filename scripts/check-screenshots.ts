import assert from "node:assert/strict";
import { call, type Content } from "../src/zen.ts";

const json = (content: Content[]) => JSON.parse(content.find((item) => item.type === "text")!.text);
const tabId = json(await call("tabs_create_mcp")).tabId;
const screenshot = (args = {}) => call("computer", { tabId, action: "screenshot", ...args });
const page = (color: string) =>
  "data:text/html," +
  encodeURIComponent(
    `<body style="margin:0;height:2200px;background:${color}"><div style="position:absolute;top:2000px;background:blue">end</div></body>`,
  );
try {
  await call("navigate", { tabId, url: page("white") });
  const baseline = json(await screenshot({ diff: true, baseline_scope: "deploy" })).baseline;
  assert.equal(json(await screenshot({ diff: true, since: baseline })).changed, 0);
  await call("navigate", { tabId, url: page("black") });
  const result = await screenshot({ diff: true, since: baseline });
  assert(result.some((item) => item.type === "image" && item.mimeType === "image/png"));
  assert(json(result).ratio > 0.5);
  console.log("OK: unchanged and cross-document viewport comparisons");
  const full = await screenshot({ full_page: true });
  assert(full.some((item) => item.type === "image" && item.data.length > 100));
  assert(json(full).documentHeight >= 2200);
  assert.equal(json(full).fullPage, true);
  console.log("OK: full document capture");
} finally {
  await call("tabs_close_mcp", { tabId });
}
