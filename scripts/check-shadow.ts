import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { call, type Content } from "../src/zen.ts";
import { approveWhile, pageEval } from "./support/fixture.ts";

const agent = { id: "codex", name: "Codex" };
const text = (content: Content[]) =>
  content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
const command = async (tool: string, args: object = {}) => text(await call(tool, args, 60_000, agent));

const shell = (body: string, script = "") =>
  `<!doctype html><meta charset="utf-8"><title>Shadow</title><body>${body}<script>
window.hits = [];
const attach = (id, mode, html) => { const root = document.getElementById(id).attachShadow({ mode }); root.innerHTML = html; return root; };
${script}</script>`;
const page = shell(
  `<p>Before</p>
<x-card id="card"><b slot="title">Card title</b>Loose text<button onclick="hits.push('slotted')">Slotted button</button><p slot="none">gone unslotted</p></x-card>
<p>Built <x-time id="time">gone November</x-time></p>
<button id="save">Save <x-icon id="icon">gone icon</x-icon></button>
<x-form id="form"></x-form>
<label for="field">Outer label</label>
<x-frame id="frame"></x-frame>
<details open><summary>More</summary>Opened text</details>
<video controls width="120" height="40"></video><input type="date"><input type="number" aria-label="Amount">
<svg width="20" height="20"><defs><g id="g"><text>gone use</text></g></defs><use href="#g"/></svg>
<x-tree id="tree"><x-item id="item">Item text</x-item></x-tree>
<p>After</p>
<x-late id="late"></x-late>
<div style="height:4000px"></div>
<x-far id="far"></x-far>`,
  `attach("card", "open", "<style>.gone{}</style><div style='display:flex;flex-direction:column'><div><slot></slot></div><h2>Title: <slot name=title></slot></h2><slot name=empty>Fallback text</slot></div>");
attach("time", "open", "3 days ago");
attach("icon", "closed", "<span>draft</span>");
const form = attach("form", "closed", \`<p id=help>Inner help</p><label for=field>Inner label</label><input id=field><input id=named aria-labelledby=help>
<table><tr><td>Lease time</td><td><input id=lease></td></tr></table>
<div id=editor contenteditable aria-label="Editor">old</div><input id=file type=file aria-label="Upload"><div id=scroller style="height:60px;overflow:auto"><div style="height:600px">Scroll area</div></div>
<form onsubmit="hits.push('submit');return false"><button id=send>Send it</button></form><div id=clickable>Open menu</div>\`);
form.getElementById("clickable").addEventListener("click", () => hits.push("menu"));
attach("frame", "closed", "<iframe src='/frame' width=300 height=60></iframe><iframe src='" + location.href.replace("127.0.0.1", "localhost") + "frame' width=300 height=60></iframe>");
const tree = attach("tree", "open", "<x-branch><slot></slot></x-branch>");
const branch = tree.querySelector("x-branch").attachShadow({ mode: "closed" });
branch.innerHTML = "<section style='display:contents'><h3>Branch</h3><slot></slot><button>Nested button</button></section>";
branch.querySelector("button").onclick = () => hits.push("nested");
attach("item", "closed", "<a href='#item'><slot></slot></a>");
attach("late", "closed", "<p id=status hidden>Build passed</p>");
attach("far", "closed", "<div style='content-visibility:auto'><h4>Far heading</h4><a href='#far'>Far link</a></div>").host.style.display = "contents";
window.form = form;`,
);
const frame = `<!doctype html><title>Frame</title><button onclick="document.title='clicked';this.textContent='Frame clicked'">Frame button</button>`;
const plain = `<!doctype html><title>Large</title>${`<section><h2>Part</h2><p>Text <a href="#">Link</a></p><ul>${"<li><button>Do</button> row</li>".repeat(8)}</ul></section>`.repeat(400)}`;
const many = shell(
  `<main>${Array.from({ length: 2000 }, (_, i) => `<x-row><span>Row ${i}</span></x-row>`).join("")}</main>`,
  `for (const el of document.querySelectorAll("x-row")) el.attachShadow({ mode: "open" }).innerHTML = "<div><slot></slot><button>Do</button><p>more text</p></div>";`,
);
const order = shell(
  `<x-a id="host"><p slot="late">Late</p><p slot="early">Early</p><p id="unslotted" slot="none">Unslotted</p></x-a>`,
  `attach("host", "closed", "<h3>Inner</h3><div><h4>Deep</h4></div><slot name=early></slot><slot name=late></slot>");`,
);
const pages: Record<string, string> = { "/frame": frame, "/plain": plain, "/many": many, "/order": order };
const server = http.createServer((request, response) => {
  response.setHeader("content-type", "text/html; charset=utf-8").end(pages[request.url!] ?? page);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const upload = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zen-shadow-")), "upload.txt");
fs.writeFileSync(upload, "upload");
const tabs: number[] = [];
const bare = (output: string) => output.replace(/ \[ref_\w+\]| \(off-screen\)/g, "");

try {
  const { tabId } = JSON.parse((await command("tabs_create_mcp", { url: "about:blank" })).split("\n")[0]);
  tabs.push(tabId);
  await command("navigate", { tabId, url: `${origin}/` });
  const read = await command("read_page", { tabId });
  const lines = bare(read)
    .split("\n")
    .map((line) => line.trim());
  const refOf = (name: string) => {
    const ref = read.match(new RegExp(`"${name}"[^\\n]* \\[(ref_\\w+)\\]`))?.[1];
    assert(ref, `No ref for ${name} in:\n${read}`);
    return ref;
  };
  const order = [
    'text "Before"',
    'text "Loose text"',
    'button "Slotted button"',
    'heading "Title: Card title" level=2',
    'text "Fallback text"',
    'text "Built 3 days ago"',
    'button "Save draft"',
    'text "Inner help"',
    'textbox "Inner label"',
    'textbox "Inner help"',
    'textbox "Lease time" (from row)',
    'textbox "Editor" value="old"',
    'button "Send it"',
    'clickable "Open menu"',
    'text "Outer label"',
    'button "Frame button"',
    'button "More"',
    'text "Opened text"',
    'heading "Branch" level=3',
    'link "Item text" href="#item"',
    'button "Nested button"',
    'text "After"',
    'heading "Far heading" level=4',
    'link "Far link" href="#far"',
  ];
  for (let i = 0, at = -1; i < order.length; i++) {
    const next = lines.indexOf(order[i], at + 1);
    assert(next > at, `No ${order[i]} after ${order[i - 1]} in:\n${read}`);
    at = next;
  }
  assert.equal(lines.filter((line) => line === 'button "Frame button"').length, 2, read);
  for (const line of order)
    if (!/Frame button/.test(line)) assert.equal(lines.filter((l) => l === line).length, 1, line);
  assert.doesNotMatch(read, /gone/);
  // why: Parts of native controls are buttons and text in the browser's own shadow roots.
  assert.equal(lines.filter((line) => line.startsWith("button")).length, 8, read);
  console.log("✓ Open, closed and nested roots are read once, in the order in which they show; internal roots aren't");

  const article = await command("get_page_text", { tabId });
  assert.match(
    article,
    /^[^]*Before\n+Loose text\s*Slotted button\nTitle: Card title\nFallback text\n+Built 3 days ago/,
  );
  assert.match(article, /Branch\n+Item text\s*Nested button\n+After\n+Far heading\n+Far link\n/);
  assert.doesNotMatch(article, /gone/);
  console.log("✓ get_page_text shows the same content");

  const formHas = async (code: string, value: string) => assert.equal(await pageEval(tabId, `form.${code}`), value);
  for (const [query, hit, done] of [
    ["slotted button", 'button "Slotted button"', "hits.join() === 'slotted'"],
    ["nested button", 'button "Nested button"', "hits.join() === 'slotted,nested'"],
    ["open menu", 'clickable "Open menu"', "hits.join() === 'slotted,nested,menu'"],
    ["item text", 'link "Item text"', "location.hash === '#item'"],
    ["far link", 'link "Far link"', "location.hash === '#far'"],
  ]) {
    const found = (await command("find", { tabId, query })).split("\n")[0];
    assert(found.startsWith(hit), `${query}: ${found}`);
    const clicked = await command("computer", { tabId, action: "left_click", ref: found.match(/\[(ref_\w+)\]/)![1] });
    assert(clicked.includes(hit), `${query}: ${clicked}`);
    assert.equal(await pageEval(tabId, done), "true", query);
  }
  assert.match((await command("find", { tabId, query: "fallback text" })).split("\n")[0], /"Fallback text"/);
  assert.match(await command("find", { tabId, query: "gone" }), /^No/);
  console.log("✓ find returns them; clicks reach them and name what they hit");

  assert.match(await command("form_input", { tabId, ref: refOf("Inner label"), value: "one" }), /value set/);
  await formHas("getElementById('field').value", "one");
  assert.match(await command("form_input", { tabId, ref: refOf("Editor"), value: "new text" }), /content set/);
  await formHas("getElementById('editor').textContent", "new text");
  await command("computer", { tabId, action: "left_click", ref: refOf("Lease time") });
  await command("computer", { tabId, action: "type", text: "3600" });
  await formHas("getElementById('lease').value", "3600");
  await command("computer", { tabId, action: "scroll_to", ref: refOf("Upload") });
  const [x, y] = JSON.parse(
    await pageEval(
      tabId,
      "const r = form.getElementById('scroller').getBoundingClientRect(); JSON.stringify([r.left + 20, r.top + 20])",
    ),
  );
  await command("computer", {
    tabId,
    action: "scroll",
    coordinate: [x, y],
    scroll_direction: "down",
    scroll_amount: 2,
  });
  assert(Number(await pageEval(tabId, "form.getElementById('scroller').scrollTop")) > 0);
  const uploading = command("file_upload", { tabId, ref: refOf("Upload"), paths: [upload] });
  assert.match(await approveWhile(uploading, "upload"), /uploaded/);
  await formHas("getElementById('file').files[0].name", "upload.txt");
  const submitting = command("computer", { tabId, action: "left_click", ref: refOf("Send it") });
  const pause = new Promise((resolve) => setTimeout(resolve, 1500, "asking"));
  assert.equal(await Promise.race([submitting, pause]), "asking");
  assert.match(await approveWhile(submitting, "Send it"), /button "Send it"/);
  assert.equal(await pageEval(tabId, "hits.at(-1)"), "submit");
  console.log("✓ Fields, the editor, an upload, scrolling, and a submit, which is asked about, work in a closed root");

  const frames = [...read.matchAll(/"Frame button" \[(ref_\w+)\]/g)].map((match) => match[1]);
  for (const ref of frames) await command("computer", { tabId, action: "left_click", ref });
  assert.equal((await command("read_page", { tabId })).match(/"Frame clicked"/g)?.length, 2);
  console.log("✓ Iframes inside a closed root, same-site and cross-site, are read and clicked");

  const inPage = (name: string, data: object) =>
    call("chrome_eval", {
      code: `(async () => { const b = h.findTab(${tabId}).linkedBrowser; return h.backgroundQuery(b, ${JSON.stringify(name)}, ${JSON.stringify(data)}, b.browsingContext); })()`,
    });
  await command("highlight", { tabId, items: [{ ref: refOf("Nested button"), label: "here" }] });
  await command("highlight", { tabId, clear: true });
  const asking = command("ask_user", {
    tabId,
    ref: refOf("Nested button"),
    message: "Which?",
    options: ["A", "B"],
    timeout: 2,
  });
  assert.match(await asking, /did not answer/);
  await command("computer", { tabId, action: "scroll_to", ref: refOf("Nested button") });
  const handing = command("hand_to_user", {
    tabId,
    ref: refOf("Nested button"),
    message: "Click it",
    wait: "click",
    timeout: 10,
  });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const spot = JSON.parse(text(await inPage("locate", { ref: refOf("Nested button") })));
  await inPage("input", { kind: "click", ...spot, silent: true, session: "user" });
  assert.match(await handing, /clicked/i);
  console.log("✓ highlight, ask_user and hand_to_user take them, and the user's click on them is noticed");

  await assert.rejects(command("wait_for", { tabId, text: "Build passed", timeout: 1 }));
  for (const condition of [
    { selector: "h3", text: "Branch" },
    { selector: "#named" },
    { selector: "a[href='#item']", text: "Item text" },
    { text: "Inner help" },
  ])
    assert.match(await command("wait_for", { tabId, ...condition, timeout: 2 }), /^Done/);
  await assert.rejects(command("wait_for", { tabId, selector: "x-tree h3", timeout: 1 }));
  assert.match(await command("wait_for", { tabId, selector: ":scope > body", timeout: 2 }), /^Done/);
  console.log("✓ wait_for sees text and selectors inside; a selector matches within one root");

  const annotated = await command("computer", { tabId, action: "screenshot", annotate: true });
  assert.match(annotated, new RegExp(`\\b${refOf("Nested button")}\\b`));
  console.log("✓ Annotated screenshots label them");

  const stale = refOf("Nested button");
  await pageEval(tabId, "document.getElementById('tree').remove()");
  await assert.rejects(command("computer", { tabId, action: "left_click", ref: stale }), /not found/);
  await command("navigate", { tabId, url: `${origin}/` });
  await assert.rejects(command("computer", { tabId, action: "left_click", ref: refOf("Send it") }));
  assert.equal(await pageEval(tabId, "hits.length"), "0");
  console.log("✓ Their stale refs are refused");

  for (const [path, matching, others] of [
    ["/plain", [":scope > body", ":scope", ":root > body"], [":scope > button", ":host"]],
    [
      "/order",
      [":scope > body", ":scope", ":host > h3", ":host h4", ":not(:scope) > h3", "p"],
      [":scope > h3", "x-a h3", ":host", "::slotted(p)", "#unslotted"],
    ],
  ] as const) {
    await command("navigate", { tabId, url: origin + path });
    for (const selector of matching)
      assert.match(await command("wait_for", { tabId, selector, timeout: 2 }), /^Done/, selector);
    for (const selector of others)
      await assert.rejects(command("wait_for", { tabId, selector, timeout: 0.5 }), /Not met/, selector);
  }
  assert.equal(JSON.parse(text(await inPage("sample", { selector: "p" }))).value, "Early");
  console.log("✓ :scope and :host match as in a query of each root; the first match is the first shown");

  for (const [url, query] of [
    ["/plain", "row"],
    ["/many", "row 1999"],
  ]) {
    await command("navigate", { tabId, url: origin + url });
    const times = [];
    for (const [tool, args] of [
      ["read_page", {}],
      ["get_page_text", {}],
      ["find", { query }],
      ["wait_for", { selector: "button", text: "Do" }],
    ] as const) {
      const start = performance.now();
      assert.match(await command(tool, { tabId, ...args }), /row|Done/i);
      times.push(Math.round(performance.now() - start));
    }
    assert(
      times.every((ms) => ms < 3000),
      `Reading ${url} took ${times.join(", ")} ms`,
    );
    console.log(`✓ ${url} reads in ${times.join(", ")} ms (read, text, find, wait)`);
  }
  console.log("All live shadow DOM checks passed.");
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  for (const tabId of tabs) await command("tabs_close_mcp", { tabId }).catch(console.error);
  server.close();
  fs.rmSync(path.dirname(upload), { recursive: true });
}
