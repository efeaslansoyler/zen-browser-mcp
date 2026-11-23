import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { call, type Content } from "../src/zen.ts";
import { pageEval } from "./support/fixture.ts";

const agent = { id: "codex", name: "Codex" };
const text = (content: Content[]) =>
  content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
const command = async (tool: string, args: object = {}) => text(await call(tool, args, 60_000, agent));

const gap = (height: number) => `<p style="height:${height}px;margin:0">gap</p>`;
const bar = (side: string) => `<div style="position:fixed;${side}:0;left:0;right:0;height:150px;background:red"></div>`;
const button = `<button onclick="parent.postMessage('hit','*')">Pay now</button>`;
const frame = (url: string, height: number, width = 500) =>
  `<iframe src="${url}" style="border:0;height:${height}px;width:${width}px"></iframe>`;
const inner = (): Record<string, string> => ({
  long: gap(1000) + button + gap(9000),
  wide: `<div style="width:9000px;white-space:nowrap"><i style="display:inline-block;width:1000px"></i>${button}</div>`,
  outer: gap(800) + frame("/long", 10100) + gap(500),
  outerCross: gap(800) + frame(`${cross}/long`, 10100) + gap(500),
});
const cases = (): Record<string, string> => ({
  plain: gap(2000) + frame("/long", 10100),
  cross: gap(2000) + frame(`${cross}/long`, 10100),
  small: gap(2000) + frame("/long", 300) + gap(2000),
  smallCross: gap(2000) + frame(`${cross}/long`, 300) + gap(2000),
  sideways: `<div style="width:12000px">${frame("/wide", 200, 9000)}</div>`,
  nested: gap(1500) + frame("/outer", 11600),
  nestedCross: gap(1500) + frame("/outerCross", 11600),
  scroller: `${gap(2000)}<div style="height:300px;overflow:auto">${frame("/long", 10100)}</div>${gap(3000)}`,
  modal: `${gap(5000)}<div style="position:fixed;inset:50px;overflow:auto">${frame("/long", 10100)}</div>`,
  bars: bar("top") + bar("bottom") + gap(2000) + frame("/long", 10100),
  smooth: `<style>html{scroll-behavior:smooth}</style>${gap(2000)}${frame("/long", 10100)}`,
  started: frame("/long", 10100),
});
const server = http.createServer((request, response) => {
  const name = request.url!.slice(1);
  response
    .setHeader("content-type", "text/html; charset=utf-8")
    .end(
      `<!doctype html><title>${name}</title><script>hits=0;addEventListener("message",()=>{hits++;if(parent!==window)parent.postMessage("hit","*")})</script>${cases()[name] ?? inner()[name] ?? ""}`,
    );
});
await new Promise<void>((resolve) => server.listen(0, resolve));
const { port } = server.address() as AddressInfo;
const cross = `http://localhost:${port}`;
const { tabId } = JSON.parse((await command("tabs_create_mcp", { url: "about:blank" })).split("\n")[0]);
const at = () => pageEval(tabId, "JSON.stringify([scrollX, scrollY, hits].map(Math.round))");
const back = () =>
  pageEval(
    tabId,
    `for (const el of [document.scrollingElement, ...document.querySelectorAll("div")]) el.scrollTo({ left: 0, top: 0, behavior: "instant" }); 1`,
  );

try {
  for (const name of Object.keys(cases())) {
    await command("navigate", { tabId, url: `http://127.0.0.1:${port}/${name}` });
    let ref: string | undefined;
    for (let i = 0; i < 30 && !ref; i++) {
      ref = (await command("find", { tabId, query: "pay now" })).match(/button "Pay now" \[(ref_\w+)\]/)?.[1];
      if (!ref) await sleep(150);
    }
    assert(ref, `No button in ${name}`);
    await command("computer", { tabId, action: "left_click", ref });
    for (let i = 0; i < 20 && (await pageEval(tabId, "String(hits)")) !== "1"; i++) await sleep(50);
    assert.equal(await pageEval(tabId, "String(hits)"), "1", name);
    const clicked = await at();
    await command("computer", { tabId, action: "left_click", ref });
    for (let i = 0; i < 20 && (await pageEval(tabId, "String(hits)")) !== "2"; i++) await sleep(50);
    assert.equal(await at(), clicked.replace(/1\]$/, "2]"), `${name}: a shown element was scrolled`);

    await back();
    await command("computer", { tabId, action: "scroll_to", ref });
    const scrolled = await at();
    await back();
    await command("highlight", { tabId, items: [{ ref, label: "here" }] });
    assert.equal(await at(), scrolled, `${name}: highlight and scroll_to differ`);
    await command("highlight", { tabId, clear: true });
    await back();
    const asking = command("ask_user", { tabId, ref, message: "This one?", options: ["A", "B"], timeout: 2 });
    for (let i = 0; i < 20 && (await at()) !== scrolled; i++) await sleep(50);
    assert.equal(await at(), scrolled, `${name}: ask_user and scroll_to differ`);
    await asking;
  }
  console.log(
    "✓ Refs in tall, wide, nested and cross-origin iframes are scrolled to, clicked, highlighted and asked about",
  );
  console.log("✓ An element that shows already isn't scrolled");
  console.log("All live tall iframe checks passed.");
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  await command("tabs_close_mcp", { tabId }).catch(console.error);
  server.close();
}
