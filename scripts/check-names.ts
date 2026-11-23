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

const panel = `<!doctype html><meta charset="utf-8"><title>Panel</title>
<style>.item{cursor:pointer;width:40px;height:20px}.item span{display:none}</style>
<table>
<tr><td>DHCP Server</td><td><input type="checkbox" id="dhcp" checked></td></tr>
<tr><td><font>Lease time</font></td><td><div><input id="lease" value="3600"> seconds (60-86400)</div></td></tr>
<tr><td>Mode</td><td>:</td><td><select id="mode"><option>Auto</option><option>Manual</option></select></td></tr>
<tr><td>Comment <button style="width:20px;height:20px"><svg></svg></button></td><td><textarea id="comment">note</textarea></td></tr>
<tr><td style="display:none">Hidden cell</td><td>Firmware</td><td><input type="file" id="firmware"></td></tr>
<tr><td>Guest mode</td><td><div role="switch" aria-checked="false" tabindex="0" id="guest"></div></td></tr>
<tr><td>Passphrase</td><td><input type="password" id="pass" value="secret"><input type="hidden"><input style="display:none"></td></tr>
</table>
<table id="kept">
<tr><td>Row A</td><td><input id="aria" aria-label="Declared aria"></td></tr>
<tr><td>Row B</td><td><label for="labelled">Declared label</label><input id="labelled"></td></tr>
<tr><td>Row C</td><td><input id="placeholder" placeholder="Declared placeholder"></td></tr>
<tr><td>Row D</td><td><input id="title" title="Declared title"></td></tr>
</table>
<table id="unnamed">
<tr><td>Address</td><td><input id="ip1"></td><td><input id="ip2"></td></tr>
<tr><td>Band</td><td><input type="radio" id="r1">2.4 GHz <input type="radio" id="r2">5 GHz</td></tr>
<tr><td>phone</td><td>192.168.1.5</td><td><input type="checkbox" id="record"></td></tr>
<tr><td><input type="checkbox" id="first"></td><td>After</td></tr>
<tr><td><div>Home</div><div>About</div></td><td><input id="layout1"></td></tr>
<tr><td><a href="#">Logo</a></td><td><input id="layout2"></td></tr>
<tr><td>Sidebar</td><td><h2>Content</h2><input id="layout3"></td></tr>
<tr><td>Outer</td><td><table><tr><td><input id="nested"></td></tr></table></td></tr>
</table>
<div class="item" id="MainPage" onclick="0"><span>Ana Sayfa</span></div>
<div class="item" id="Tipped" title="Tip wins"><span>Hidden</span></div>
<div class="item" id="Submenu"><span>One</span><span>Two</span></div>
<div class="item" id="Nested"><span><a href="#">Delete</a></span></div>
<div class="item" id="Long"><span>${"long ".repeat(30)}</span></div>
<div class="item" id="Code"><script>0</script><style>b{}</style></div>
<div class="item" id="Shown">Visible<span>Hidden</span></div>
<button id="icon"><svg width="10" height="10"></svg><span style="display:none">Save</span></button>
<a id="link" href="/x"><svg width="10" height="10"></svg><span hidden>Profile</span></a>
<div style="height:5000px"></div>
<section style="content-visibility:auto;contain-intrinsic-size:100px"><a href="/later">Not rendered yet</a></section>`;
const grid = `<!doctype html><title>Grid</title><table><tr><td>Names</td><td>${'<input size="1">'.repeat(3000)}</td></tr>${"<tr><td>Label</td><td><input></td></tr>".repeat(2000)}</table>`;
const server = http.createServer((request, response) => {
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(request.url === "/grid" ? grid : panel);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const tabs: number[] = [];

try {
  const tabId = JSON.parse((await command("tabs_create_mcp", { url: "about:blank" })).split("\n")[0]).tabId;
  tabs.push(tabId);
  const read = await command("navigate", { tabId, url: `${origin}/panel`, read: "interactive" });
  const all = await command("read_page", { tabId });

  for (const output of [read, all]) {
    assert.match(output, /checkbox "DHCP Server" \(from row\) \[ref_\w+\] checked/);
    assert.match(output, /textbox "Lease time" \(from row\) \[ref_\w+\] value="3600"/);
    assert.match(output, /combobox "Mode" \(from row\) \[ref_\w+\] value="Auto"/);
    assert.match(output, /textbox "Comment" \(from row\) \[ref_\w+\] value="note"/);
    assert.match(output, /button "Firmware" \(from row\) \[ref_/);
    assert.match(output, /switch "Guest mode" \(from row\) \[ref_/);
    assert.match(output, /textbox "Passphrase" \(from row\) \[ref_\w+\] type=password/);
    assert.doesNotMatch(output, /secret/);
  }
  const found = (await command("find", { tabId, query: "lease time" })).split("\n");
  assert.match(found[0], /^textbox "Lease time" \(from row\) \[ref_\w+\]/);
  await command("computer", { tabId, action: "left_click", ref: found[0].match(/\[(ref_\w+)\]/)![1] });
  assert.equal(await pageEval(tabId, "document.activeElement.id"), "lease");
  console.log("✓ A field takes the label in its table row; find returns the right field");

  for (const label of ["aria", "label", "placeholder", "title"])
    assert.match(read, new RegExp(`textbox "Declared ${label}" \\[ref_`));
  assert.equal(read.match(/\(from row\)/g)!.length, 7);
  console.log("✓ Declared names stay; several fields, records and layout tables give no name");

  assert.match(read, /clickable "Ana Sayfa" \(hidden text\) \[ref_/);
  assert.match(read, /clickable "Tip wins" \[ref_/);
  for (const id of ["Submenu", "Nested", "Long", "Code"])
    assert.match(read, new RegExp(`clickable div#${id}\\.item \\[`));
  assert.match(read, /clickable "Visible" \[ref_/);
  assert.match(read, /button "Save" \(hidden text\) \[ref_/);
  assert.match(read, /link "Profile" \(hidden text\) \[ref_/);
  assert.equal(await pageEval(tabId, "document.querySelector('[href=\"/later\"]').innerText"), "");
  assert.equal(read.match(/\(hidden text\)/g)!.length, 3);
  assert.match((await command("find", { tabId, query: "ana sayfa" })).split("\n")[0], /^clickable "Ana Sayfa"/);
  console.log("✓ Icon entries take their title or their own hidden text, never that of a submenu or an inner control");

  await command("navigate", { tabId, url: `${origin}/grid` });
  const times = [];
  for (const [tool, args] of [
    ["read_page", { filter: "interactive" }],
    ["find", { query: "label" }],
  ] as const) {
    const start = performance.now();
    await command(tool, { tabId, ...args });
    times.push(Math.round(performance.now() - start));
  }
  assert(
    times.every((ms) => ms < 3000),
    `Reading 5,000 fields took ${times.join(", ")} ms`,
  );
  console.log(`✓ 5,000 unnamed fields, 3,000 of them in one row, read in ${times.join(", ")} ms (interactive, find)`);
  console.log("All live name checks passed.");
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  for (const tabId of tabs) await command("tabs_close_mcp", { tabId }).catch(console.error);
  server.close();
}
