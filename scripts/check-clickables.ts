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

const menu = `<!doctype html><meta charset="utf-8"><title>Menu</title><style>.item{cursor:pointer;padding:8px}</style>
<div class="item" id="css"><span>WLAN</span></div>
<div id="attribute" onclick="hit('attribute')">LAN</div>
<div id="property">Security</div>
<div id="listener">Uygulama</div>
<div id="delegated">Delegated entry</div>
<div class="item" id="group"><div id="one">First line</div><div id="two">Second line</div></div>
<svg id="icon" class="gear" width="20" height="20" style="cursor:pointer"><path d="M0 0h20v20H0z"/></svg>
<p>Read <span class="item" id="more">more</span></p>
<label class="item"><input type="checkbox">Visible box</label>
<label class="item" id="custom"><input type="checkbox" style="display:none">Custom box</label>
<div class="item"><iframe srcdoc="<button>Framed button</button>" width="200" height="60"></iframe></div>
<button aria-label="Close">Discard draft <span hidden>secretly</span></button>
<div id="devices">Wi-Fi devices(13)</div><div class="item">Wi-Fi settings</div><svg class="item" id="wi-icon" width="20" height="20"></svg>
<div>${"<button>Wi-Fi</button>".repeat(25)}</div>
<table><tr><td id="cell">Cell <b>WIFI</b></td></tr></table>
<script>
window.hits=[];const hit=(id)=>hits.push(id);
for(const id of ['css','listener','cell'])document.getElementById(id).addEventListener('click',()=>hit(id));
for(const id of ['one','two'])document.getElementById(id).addEventListener('pointerdown',()=>hit(id));
document.getElementById('property').onclick=()=>hit('property');
document.addEventListener('click',(e)=>{if(e.target.id==='delegated')hit('delegated')});
</script>`;
const server = http.createServer((request, response) => {
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(
    request.url === "/menu"
      ? menu
      : `<!doctype html><title>Panel</title><iframe src="/menu" width="600" height="500"></iframe>${"<button>Wi-Fi</button>".repeat(25)}`,
  );
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const tabs: number[] = [];
const open = async (path: string): Promise<[number, string]> => {
  const tabId = JSON.parse((await command("tabs_create_mcp", { url: "about:blank" })).split("\n")[0]).tabId;
  tabs.push(tabId);
  return [tabId, await command("navigate", { tabId, url: origin + path, read: "interactive" })];
};
const refIn = (output: string, label: string) => {
  const line = output.split("\n").find((l) => l.includes(`"${label}"`));
  assert(line, `No line for ${label} in:\n${output}`);
  return line.match(/\[(ref_\w+)\]/)![1];
};

try {
  const [tabId, interactive] = await open("/menu");
  const clickables = [...interactive.matchAll(/clickable "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(clickables, [
    "WLAN",
    "LAN",
    "Security",
    "Uygulama",
    "First line Second line",
    "First line",
    "Second line",
    "more",
    "Wi-Fi settings",
  ]);
  assert.match(interactive, /clickable svg#icon\.gear \[ref_/);
  assert.doesNotMatch(interactive, /"Visible box".*clickable/);
  assert.match(interactive, /label "Custom box" \[ref_\w+\] clickable/);
  assert.match(interactive, /button "Framed button"/);
  console.log("✓ Pointer cursors, inline handlers, handler properties and listeners give refs; a delegated one can't");

  for (const label of ["WLAN", "LAN", "Security", "Uygulama", "Second line"])
    await command("computer", { tabId, action: "left_click", ref: refIn(interactive, label) });
  for (const [query, label] of [
    ["delegated entry", "Delegated entry"],
    ["cell wifi", "Cell WIFI"],
  ]) {
    const found = await command("find", { tabId, query });
    await command("computer", { tabId, action: "left_click", ref: refIn(found, label) });
  }
  assert.deepEqual(JSON.parse(await pageEval(tabId, "JSON.stringify(hits)")), [
    "css",
    "attribute",
    "property",
    "listener",
    "two",
    "delegated",
    "cell",
  ]);
  console.log("✓ Clicks on those refs, and on text that find returned, reach the right elements");

  const search = async (tabId: number, query: string) => (await command("find", { tabId, query })).split("\n");
  const devices = await search(tabId, "wi-fi devices");
  assert.match(devices[0], /^text "Wi-Fi devices\(13\)" \[ref_/);
  assert.equal(devices.length, 20);
  assert.match((await search(tabId, "discard draft"))[0], /^button "Close" \[ref_/);
  assert.match((await search(tabId, "secretly"))[0], /^Nothing matches/);
  console.log("✓ A full match ranks above partial ones; a control's shown text counts, its hidden text doesn't");

  const shotOf = async (scale?: number) => {
    const taken = await command("computer", { tabId, action: "screenshot", scale });
    const [, id, width] = taken.match(/(shot_\d+): (\d+)x/)!;
    return { id, ratio: Number(width) / Number(await pageEval(tabId, "innerWidth")) };
  };
  const at = async (id: string, ratio: number) =>
    JSON.parse(
      await pageEval(
        tabId,
        `JSON.stringify((({left,top,width,height})=>[(left+width/2)*${ratio},(top+height/2)*${ratio}])(document.getElementById("${id}").firstChild.getBoundingClientRect?.()??document.getElementById("${id}").getBoundingClientRect()))`,
      ),
    );
  const hits = async () => JSON.parse(await pageEval(tabId, "JSON.stringify(hits)"));
  const [big, small] = [await shotOf(), await shotOf(0.5)];
  await pageEval(tabId, "hits.length=0");
  const fromBig = { tabId, action: "left_click", coordinate: await at("listener", big.ratio) };
  await assert.rejects(command("computer", fromBig), new RegExp(`${big.id} .*${small.id} `));
  assert.deepEqual(await hits(), []);
  assert.match(
    await command("computer", { ...fromBig, screenshot: big.id }),
    /^left_click done: clickable "Uygulama" \[ref_\w+\]\.$/m,
  );
  await command("computer", { ...fromBig, coordinate: await at("listener", small.ratio), screenshot: small.id });
  assert.deepEqual(await hits(), ["listener", "listener"]);
  console.log("✓ A coordinate after screenshots of two scales needs its image; either image lands on the target");

  await shotOf();
  await shotOf();
  await pageEval(tabId, "hits.length=0");
  await Promise.all([shotOf(0.5), command("computer", fromBig)]);
  assert.deepEqual(await hits(), ["listener"]);
  console.log("✓ A click sent together with a screenshot of another scale keeps the scale from before it");

  await shotOf();
  const both = await shotOf();
  const results: Record<string, string> = {};
  for (const id of ["delegated", "css", "more"])
    results[id] = await command("computer", { tabId, action: "left_click", coordinate: await at(id, both.ratio) });
  assert.match(results.delegated, /left_click done: div#delegated \(no click handler detected\)\./);
  assert.match(results.css, /left_click done: clickable "WLAN" \[ref_/);
  assert.match(results.more, /left_click done: clickable "more" \[ref_/);
  const held = await command("computer", { tabId, action: "mouse_down", coordinate: await at("css", both.ratio) });
  await command("computer", { tabId, action: "mouse_up" });
  assert.match(held, /mouse_down done: clickable "WLAN" \[ref_/);
  console.log("✓ Click results name the clickable, or say that nothing there listens");

  const [framed] = await open("/");
  const found = await command("find", { tabId: framed, query: "WLAN" });
  assert.match(found, /^clickable "WLAN" \[ref_\w+\]/);
  assert.match((await search(framed, "wi-fi devices"))[0], /^text "Wi-Fi devices\(13\)" \[ref_/);
  const framedShot = await command("computer", { tabId: framed, action: "screenshot" });
  assert.match(framedShot, /shot_\d+: /);
  const box = JSON.parse(
    await pageEval(
      framed,
      "JSON.stringify((({left,top})=>[left,top])(document.querySelector('iframe').getBoundingClientRect()))",
    ),
  );
  const ratio = Number(framedShot.match(/: (\d+)x/)![1]) / Number(await pageEval(framed, "innerWidth"));
  const inFrame = await command("computer", {
    tabId: framed,
    action: "left_click",
    coordinate: [(box[0] + 30) * ratio, (box[1] + 25) * ratio],
  });
  assert.match(inFrame, /left_click done: clickable "WLAN" \[ref_\w+\]\./);
  const annotated = await command("computer", { tabId, action: "screenshot", annotate: true });
  assert.match(annotated, /Annotated refs: ref_/);
  console.log("✓ Clickables in an iframe are found; annotated screenshots label them");

  await pageEval(
    tabId,
    `document.body.insertAdjacentHTML("beforeend", Array.from({length:5000},(_,i)=>'<div class="'+(i%9?'':'item')+'"><span>row '+i+'</span></div>').join(""))`,
  );
  await pageEval(
    tabId,
    `document.body.insertAdjacentHTML("beforeend", '<div class="item">'+Array.from({length:3000},(_,i)=>'<div onclick="0">entry '+i+'</div>').join("")+'</div>')`,
  );
  const timed = async (tool: string, args: object) => {
    const start = performance.now();
    await command(tool, { tabId, ...args });
    return Math.round(performance.now() - start);
  };
  const times = [
    await timed("read_page", { filter: "interactive" }),
    await timed("read_page", {}),
    await timed("find", { query: "row 4999" }),
  ];
  assert(
    times.every((ms) => ms < 3000),
    `Reading 13,000 elements took ${times.join(", ")} ms`,
  );
  console.log(
    `✓ A page of 13,000 elements, 3,000 of them in one clickable list, reads in ${times.join(", ")} ms (interactive, all, find)`,
  );
  console.log("All live clickable checks passed.");
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  for (const tabId of tabs) await command("tabs_close_mcp", { tabId }).catch(console.error);
  server.close();
}
