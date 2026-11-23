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

const section = `
<h2>Section <b>heading</b></h2>
<p id="p">First<br>second<span style="display:none">gone one</span><span style="visibility:hidden">gone two</span><span hidden>gone three</span> line</p>
<a href="#x" id="link">Plain <span>link</span></a>
<a href="#y" aria-label="Declared">Own text</a>
<ul><li>One</li><li>Two</li></ul>
<table><tr><td>Lease time</td><td><input value="3600"></td></tr></table>
<label for="field">Labelled</label><input id="field">
<button>Save<span style="display:none">gone four</span></button>
<div style="display:contents">Boxless <i>part</i></div>
<div style="content-visibility:hidden">gone five</div>
<details><summary>More</summary>gone six</details>
<details open><summary>Opened</summary>shown inside</details>
<custom-host id="host"><span slot="taken">slotted</span>gone eight</custom-host>
<div style="content-visibility:auto;contain-intrinsic-size:20px"><p>Nested section</p></div>`;
const page = `<!doctype html><meta charset="utf-8"><title>Skipped</title><p>Before</p><div style="height:6000px"></div>
<section id="skipped" style="content-visibility:auto;contain-intrinsic-size:100px">${section}</section>
<script>document.getElementById("host").attachShadow({mode:"closed"}).innerHTML='<slot name="taken"></slot>';</script>
<p>After</p><section style="content-visibility:hidden"><p>gone seven</p></section>`;
const large = `<!doctype html><title>Large</title>${Array.from({ length: 200 }, (_, i) => `<section style="content-visibility:auto;contain-intrinsic-size:500px">${`<p><a href="#">Link ${i}</a> text</p>`.repeat(20)}</section>`).join("")}`;
const innerMain = `<!doctype html><title>Main</title><div style="height:6000px"></div><div style="content-visibility:auto"><main>Main text</main></div>`;
const pages: Record<string, string> = { "/large": large, "/inner-main": innerMain };
const server = http.createServer((request, response) => {
  response.setHeader("content-type", "text/html; charset=utf-8").end(pages[request.url!] ?? page);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const tabs: number[] = [];
const plain = (output: string) => output.replace(/ \[ref_\w+\]| \(off-screen\)/g, "");

try {
  const { tabId } = JSON.parse((await command("tabs_create_mcp", { url: "about:blank" })).split("\n")[0]);
  tabs.push(tabId);
  await command("navigate", { tabId, url: origin });
  assert.equal(await pageEval(tabId, 'document.getElementById("link").innerText'), "");

  const read = plain(await command("read_page", { tabId }));
  for (const line of [
    'heading "Section heading" level=2',
    'text "First second line"',
    'link "Plain link" href="#x"',
    'link "Declared" href="#y"',
    'text "One"',
    'textbox "Lease time" (from row) value="3600"',
    'textbox "Labelled"',
    'button "Save"',
    'text "shown inside"',
    'text "slotted"',
  ])
    assert(
      read.split("\n").some((l) => l.trim() === line),
      `No ${line} in:\n${read}`,
    );
  console.log("✓ read_page names and reads what an off-screen section shows");

  const article = await command("get_page_text", { tabId });
  assert.match(article, /Before\n+Section heading\n+First\nsecond line\n+Plain link Own text\n+One\nTwo\n+Lease time/);
  assert.match(article, /Boxless part\n+More\n+Opened\n+shown inside\n+slotted\n+Nested section\n+After$/);
  for (const output of [read, article]) assert.doesNotMatch(output, /gone/);
  assert.equal(await pageEval(tabId, 'document.getElementById("link").innerText'), "");
  console.log("✓ get_page_text keeps the order; hidden text stays out, and the section stays unrendered");

  assert.match(await command("wait_for", { tabId, text: "second line", timeout: 2 }), /^Done/);
  await assert.rejects(command("wait_for", { tabId, text: "second line", gone: true, timeout: 1 }));
  await assert.rejects(command("wait_for", { tabId, text: "gone one", timeout: 1 }));
  assert.match(await command("wait_for", { tabId, selector: "#p", text: "second line", timeout: 2 }), /^Done/);
  const found = (await command("find", { tabId, query: "plain link" })).split("\n")[0];
  assert.match(found, /^link "Plain link" \[ref_/);
  const textHit = (await command("find", { tabId, query: "first second line" })).split("\n")[0];
  assert.match(textHit, /^paragraph "First second line" \[ref_/);
  await command("computer", { tabId, action: "left_click", ref: found.match(/\[(ref_\w+)\]/)![1] });
  assert.equal(await pageEval(tabId, "location.hash"), "#x");
  console.log("✓ wait_for and find see the text; the ref can be clicked");

  assert.equal(await pageEval(tabId, 'document.getElementById("link").innerText'), "Plain link");
  const same = (output: string) => plain(output).replace(`${origin}/#x`, `${origin}/`).replace(/\s+/g, " ");
  assert.equal(same(await command("read_page", { tabId })), same(read));
  assert.equal(same(await command("get_page_text", { tabId })), same(article));
  console.log("✓ The rendered section reads the same");

  await command("navigate", { tabId, url: `${origin}/inner-main` });
  assert.match(await command("get_page_text", { tabId }), /Main text$/);
  console.log("✓ A main element inside such a section is read too");

  await command("navigate", { tabId, url: `${origin}/large` });
  const times = [];
  for (const [tool, args] of [
    ["read_page", {}],
    ["get_page_text", {}],
    ["find", { query: "link 199" }],
    ["wait_for", { text: "Link 199" }],
  ] as const) {
    const start = performance.now();
    assert.match(await command(tool, { tabId, ...args }), /Link|Done/);
    times.push(Math.round(performance.now() - start));
  }
  assert(
    times.every((ms) => ms < 3000),
    `Reading 200 sections took ${times.join(", ")} ms`,
  );
  console.log(`✓ 200 sections with 4,000 links read in ${times.join(", ")} ms (read, text, find, wait)`);
  console.log("All live skipped text checks passed.");
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  for (const tabId of tabs) await command("tabs_close_mcp", { tabId }).catch(console.error);
  server.close();
}
