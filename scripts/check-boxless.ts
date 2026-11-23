import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { call, type Content } from "../src/zen.ts";
import { pageEval } from "./support/fixture.ts";

const agent = { id: "codex", name: "Codex" };
const text = (content: Content[]) =>
  content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
const command = async (tool: string, args: object = {}) => text(await call(tool, args, 60_000, agent));

const page = `<!doctype html><meta charset="utf-8"><title>Boxless</title><style>.c{display:contents}</style>
<main class="c"><h2>Heading</h2><div class="c"><p>Deep text</p><button onclick="hits.push('save')">Save</button></div></main>
<a class="c" id="card" href="#card"><img alt="" width="60" height="20" style="display:none"><div style="height:20px">Card title</div><div style="height:20px">Card body</div></a>
<span class="c" id="bare" onclick="hits.push('bare')">Bare clickable</span>
<table><tr class="c"><td>Lease time</td><td><input></td></tr></table>
<div style="display:none"><div class="c">gone one<button>Gone button</button></div></div>
<div style="visibility:hidden"><div class="c">gone two</div></div>
<div class="c" aria-hidden="true">gone three</div>
<div class="c" hidden style="display:none">gone four</div>
<button class="c"><span style="display:none">gone five</span></button>
<div style="content-visibility:hidden"><div class="c">gone six</div></div>
<div class="c" style="visibility:hidden">gone seven</div>
<div style="height:5000px"></div>
<a class="c" id="far" href="#far"><div>Far link</div></a>
<script>window.hits=[]</script>`;
const gap = (height: number) => `<p style="height:${height}px">gap</p>`;
const pay = `<span class="c" onclick="hits++">Pay now</span>`;
const inTall = (inner = pay) => `<div>${gap(1000)}${inner}${gap(9000)}</div>`;
const scroller = (overflow: string) =>
  `${gap(3000)}<div style="height:200px;overflow:${overflow}">${inTall()}</div>${gap(5000)}`;
const inShadow = (content: string, light = "") =>
  `<div id="host">${light}</div><script>host.attachShadow({mode:"closed"}).innerHTML=\`<style>.c{display:contents}</style>${content}\`</script>`;
const bar = (side: string) => `<div style="position:fixed;${side}:0;left:0;right:0;height:200px;background:red"></div>`;
const tall: Record<string, string> = {
  block: inTall(),
  smooth: `<style>html{scroll-behavior:smooth}</style>${inTall()}`,
  bars: bar("top") + bar("bottom") + inTall(),
  wide: `<div style="width:9000px;white-space:nowrap"><i style="display:inline-block;width:5000px"></i>${pay}</div>`,
  auto: scroller("auto"),
  hidden: scroller("hidden"),
  before: inTall(`<span class="c" onclick="hits++">Pay now<div style="height:6000px">rest</div></span>`),
  space: inTall(`<span class="c" onclick="hits++">&nbsp;<b style="display:none">x</b>\n  Pay now</span>`),
  shadow: inShadow(inTall()),
  slotted: inShadow(inTall("<slot></slot>"), pay),
};
const server = http.createServer((request, response) => {
  const inner = tall[request.url!.slice(1)];
  response
    .setHeader("content-type", "text/html; charset=utf-8")
    .end(
      inner
        ? `<!doctype html><title>Tall</title><style>.c{display:contents}</style><b id="chosen">Chosen</b><script>hits=0;changes=0</script>${inner}`
        : page,
    );
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const tabs: number[] = [];

try {
  const { tabId } = JSON.parse((await command("tabs_create_mcp", { url: "about:blank" })).split("\n")[0]);
  tabs.push(tabId);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  await command("navigate", { tabId, url });
  const read = await command("read_page", { tabId });
  const lines = read.split("\n").map((line) => line.trim().replace(/ \[ref_\w+\]/, ""));
  for (const line of [
    "main",
    'heading "Heading" level=2',
    'text "Deep text"',
    'button "Save"',
    'link "Card title Card body" href="#card"',
    'clickable "Bare clickable"',
    'textbox "Lease time" (from row)',
    'link "Far link" href="#far" (off-screen)',
  ])
    assert(lines.includes(line), `No ${line} in:\n${read}`);
  assert.doesNotMatch(read, /gone/i);
  assert.equal(lines.filter((line) => line.startsWith("button")).length, 1, read);
  console.log("✓ What is inside a boxless element is read, and the element itself; hidden ones stay out");

  for (const [query, hit, done] of [
    ["save", 'button "Save"', "hits.join()==='save'"],
    ["card title body", 'link "Card title Card body"', "location.hash==='#card'"],
    ["bare clickable", 'clickable "Bare clickable"', "hits.join()==='save,bare'"],
    ["far link", 'link "Far link"', "location.hash==='#far'"],
  ]) {
    const found = (await command("find", { tabId, query })).split("\n")[0];
    assert(found.startsWith(hit), `${query}: ${found}`);
    await command("computer", { tabId, action: "left_click", ref: found.match(/\[(ref_\w+)\]/)![1] });
    assert.equal(await pageEval(tabId, done), "true", query);
  }
  console.log("✓ find returns them, and a click on the ref reaches them, also after scrolling");

  for (const selector of ["main", "#card", "#bare"])
    assert.match(await command("wait_for", { tabId, selector, timeout: 2 }), /^Done/);
  assert.match(await command("wait_for", { tabId, selector: "main", text: "Deep text", timeout: 2 }), /^Done/);
  await assert.rejects(command("wait_for", { tabId, selector: "[aria-hidden]", timeout: 1 }));
  await command("computer", { tabId, action: "scroll_to", ref: read.match(/button "Save" \[(ref_\w+)\]/)![1] });
  const annotated = await command("computer", { tabId, action: "screenshot", annotate: true });
  const refOf = (name: string) => read.match(new RegExp(`"${name}" \\[(ref_\\w+)\\]`))![1];
  for (const name of ["Save", "Card title Card body", "Bare clickable"])
    assert.match(annotated, new RegExp(`\\b${refOf(name)}\\b`), name);
  console.log("✓ wait_for selectors match them; annotated screenshots label them");

  for (const name of Object.keys(tall)) {
    await command("navigate", { tabId, url: url + name });
    await pageEval(
      tabId,
      `getSelection().selectAllChildren(chosen); setTimeout(() => document.addEventListener("selectionchange", () => changes++), 100); 1`,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    const ref = (await command("find", { tabId, query: "pay now" })).match(/\[(ref_\w+)\]/)![1];
    await command("computer", { tabId, action: "scroll_to", ref });
    assert.equal(await pageEval(tabId, "getSelection().toString() + changes"), "Chosen0", name);
    await command("computer", { tabId, action: "left_click", ref });
    assert.equal(await pageEval(tabId, "String(hits)"), "1", name);
  }
  console.log("✓ Text of a boxless element is scrolled to and clicked anywhere; the user's selection stays");
  console.log("All live boxless checks passed.");
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  for (const tabId of tabs) await command("tabs_close_mcp", { tabId }).catch(console.error);
  server.close();
}
