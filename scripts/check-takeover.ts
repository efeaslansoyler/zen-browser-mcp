import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { call, type Content } from "../src/zen.ts";
import { pageEval } from "./support/fixture.ts";

const text = (content: Content[]) =>
  content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
const as = (id: string, name: string) => (tool: string, args: object) =>
  call(tool, args, 120_000, { id, name }, `check-takeover:${id}`).then(text);
const claude = as("claude", "Claude");
const codex = as("codex", "Codex");
// why: A directory argument keeps pictures of every island state to look at.
const pictures = process.argv[2];

let slow!: http.ServerResponse;
const server = http.createServer((request, response) => {
  response.setHeader("content-type", "text/html; charset=utf-8");
  if (request.url!.startsWith("/data")) return void response.end("{}");
  if (request.url === "/slow") {
    response.setHeader("content-type", "text/plain");
    slow = response;
    return void response.write("before,");
  }
  response.end(
    `<!doctype html><title>Shop ${request.url}</title><h1>Cart</h1><input id="field" style="display:block;margin:120px"><button onclick="hits++">Buy</button><script>hits=0</script>`,
  );
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
const open = async (agent: typeof claude, where = url) =>
  JSON.parse((await agent("tabs_create_mcp", { url: where })).split("\n")[0]).tabId as number;
const tabId = await open(claude);
const other = await open(codex, `${url}other`);

const chrome = async (code: string) =>
  JSON.parse(
    text(
      await call("chrome_eval", {
        code: `(async () => {
          const tab = h.findTab(${tabId}), win = (tab ?? h.findTab(${other})).ownerDocument.defaultView;
          const island = win.document.getElementById("zen-mcp-island");
          const box = (el) => el.getBoundingClientRect();
          const mouse = (type, x, y) =>
            win.synthesizeMouseEvent(type, x, y, { button: 0, buttons: type === "mousedown" ? 1 : 0, clickCount: type === "mousemove" ? 0 : 1 });
          const click = (x, y) => { mouse("mousemove", x, y); mouse("mousedown", x, y); mouse("mouseup", x, y); };
          const middle = (el) => [box(el).left + box(el).width / 2, box(el).top + box(el).height / 2];
          ${code}
        })()`,
      }),
    ),
  );
const select = (id: number) =>
  chrome(
    `win.gBrowser.selectedTab = h.findTab(${id}); Services.focus.activeWindow !== win && win.focus(); return true;`,
  );
const state = () =>
  chrome(`
    const shown = (cls) => [...island.querySelectorAll(cls)].some((el) => el.checkVisibility({ visibilityProperty: true }) && box(el).height > 0);
    const take = island.querySelector(".take");
    return { hidden: island.hidden, state: island.getAttribute("state"), height: Math.round(box(island).height), text: island.querySelector(".workers .action").textContent,
      take: !island.hidden && shown(".take") ? take.textContent : null, on: take.hasAttribute("on"), note: shown(".back-field"), stop: shown(".stop") };`);
const until = async (what: string, check: (s: any) => boolean, ms = 8000) => {
  let s: any, height: number | undefined;
  for (const end = Date.now() + ms; Date.now() < end;) {
    s = await state();
    if (check(s) && s.height === height) return s;
    height = s.height;
    await sleep(60);
  }
  assert.fail(`${what}: ${JSON.stringify(s)}`);
};
const point = (selector: string) => chrome(`return middle(island.querySelector(${JSON.stringify(selector)}));`);
const move = ([x, y]: number[]) => chrome(`mouse("mousemove", ${x}, ${y}); return true;`);
const press = ([x, y]: number[]) => chrome(`click(${x}, ${y}); return true;`);
const page = () => chrome(`const r = box(win.gBrowser.tabpanels); return [r.left + 200, r.top + 500];`);
const picture = async (name: string) => {
  if (!pictures) return;
  await sleep(500);
  const data = await chrome(`
    const bitmap = await win.browsingContext.currentWindowGlobal.drawSnapshot(new win.DOMRect(box(island).left - 60, box(island).top - 20, box(island).width + 120, box(island).height + 60), 2, "white");
    const canvas = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height; canvas.getContext("2d").drawImage(bitmap, 0, 0);
    return JSON.stringify(canvas.toDataURL("image/png").split(",")[1]);`);
  fs.mkdirSync(pictures, { recursive: true });
  fs.writeFileSync(path.join(pictures, `${name}.png`), Buffer.from(data, "base64"));
};
const takeOver = async () => {
  await press(await point(".take"));
  await until("the tab is taken over", (s) => s.take && s.on);
  await move(await page());
};
const giveBack = async () => {
  await press(await point(".take"));
  await until("the tab is given back", (s) => !s.on);
  await move(await page());
};

try {
  await select(tabId);
  await move(await page());
  await claude("read_page", { tabId });
  await until("the button is on the row", (s) => s.take && !s.on && s.height === 34);
  await picture("1-working");
  await sleep(6000);
  const thinking = await until("the row stays while the agent thinks", (s) => s.take && s.state === "working");
  assert.match(thinking.text, /waiting|bekliyor/);
  await picture("2-waiting");
  await codex("read_page", { tabId: other });
  assert.match((await until("this tab's agent has the row", (s) => s.take)).text, /^Claude/);
  await select(other);
  await until("the other tab has its own agent", (s) => s.take && /^Codex/.test(s.text));
  await sleep(5500);
  await select(tabId);
  await until("the row is back", (s) => s.take && /^Claude/.test(s.text));
  console.log("✓ The row of the tab's agent has the button and stays while the agent thinks");

  const watch = await claude("watch", { tabId, text: "Typed by the user", interval: 0.5, timeout: 600 });
  const events = watch.match(/"events":"([^"]+)"/)![1];
  const interrupted = assert.rejects(
    claude("computer", { tabId, action: "wait", duration: 30 }),
    /took over.*partly happened/s,
  );
  const elsewhere = codex("computer", { tabId: other, action: "wait", duration: 4 });
  await sleep(700);
  await takeOver();
  await interrupted;
  assert.match(await elsewhere, /./);
  const taken = await state();
  assert.match(taken.text, /you have control|kontrol sende/);
  assert(!(await chrome(`return island.textContent.includes("undefined");`)), "stray text on the island");
  assert.equal(taken.height, 34, "taking over keeps the island on one line");
  await picture("3-taken");
  console.log("✓ Taking over interrupts the call in that tab, not the one in another tab");

  const context = await claude("tabs_context_mcp", {});
  const mine = JSON.parse(context.split("\n")[0]).tabs.find((t: any) => t.tabId === tabId);
  assert.deepEqual([mine.userControl, mine.url, mine.title], [true, undefined, undefined]);
  await chrome(
    `await h.backgroundQuery(tab.linkedBrowser, "eval", { code: "fetch('/data?secret')" }, tab.linkedBrowser.browsingContext); return true;`,
  );
  const reading = claude("read_page", { tabId });
  await chrome(
    `await h.backgroundQuery(tab.linkedBrowser, "eval", { code: "document.body.append('Typed by the user')" }, tab.linkedBrowser.browsingContext); return true;`,
  );
  let answered = false;
  void reading.then(() => (answered = true));
  await sleep(1500);
  assert(!answered, "a read answered while the user had the tab");
  assert.doesNotMatch(fs.readFileSync(events, "utf8"), /matched/);

  await move(await point(".take"));
  const hovered = await until("the note unfolds on hover", (s) => s.note && s.height > 60);
  assert.equal(hovered.take, taken.take, "the button stays");
  const before = await point(".take");
  await picture("4-note");
  await chrome(
    `const f = island.querySelector(".back-field"); f.focus(); f.value = "Keep the second address"; f.dispatchEvent(new win.Event("input", { bubbles: true })); return true;`,
  );
  assert.deepEqual(await point(".take"), before, "the button moved under the pointer");
  await chrome(`island.querySelector(".back-field").blur(); return true;`);
  await move(await page());
  assert.match((await until("it folds again", (s) => !s.note && s.height === 34)).text, /^✎ /);
  await picture("5-draft");
  await giveBack();
  const read = await reading;
  assert.match(read, /Cart[^]*"userMessage":"Keep the second address"/);
  for (let i = 0; i < 30 && !/matched/.test(fs.readFileSync(events, "utf8")); i++) await sleep(100);
  assert.match(fs.readFileSync(events, "utf8"), /matched/);
  console.log(
    "✓ The tab is hidden meanwhile, also from a watch; a waiting read goes on with the note, whose draft stays",
  );

  assert.doesNotMatch(await claude("read_network_requests", { tabId }), /secret/);
  assert.match(await claude("read_network_requests", { tabId }), /./);
  console.log("✓ Requests made meanwhile aren't in the network log");

  for (const [name, finish] of [
    ["during", () => slow.end("typed by the user")],
    ["after", () => slow.write("typed by the user,")],
  ] as const) {
    await chrome(
      `await h.backgroundQuery(tab.linkedBrowser, "eval", { code: "void fetch('/slow').then((r) => r.text())" }, tab.linkedBrowser.browsingContext); return true;`,
    );
    await sleep(800);
    await takeOver();
    finish();
    await sleep(500);
    const hold = await claude("watch", { tabId, hold: true, timeout: 60 });
    assert.match(hold, /"by":"the user"/);
    await giveBack();
    if (name === "after") slow.end("after");
    await sleep(800);
    const released = hold.match(/"events":"([^"]+)"/)![1];
    for (let i = 0; i < 40 && !/released/.test(fs.readFileSync(released, "utf8")); i++) await sleep(100);
    assert.match(fs.readFileSync(released, "utf8"), /released/);
    await claude("read_page", { tabId });
    const list = await claude("read_network_requests", { tabId });
    const id = Number(
      list
        .split("\n")
        .filter((line) => line.includes("/slow"))
        .at(-1)!
        .match(/#(\d+)/)![1],
    );
    const details = await claude("read_network_requests", { tabId, id });
    assert.match(details, /not recorded \(the user took over/);
    assert.doesNotMatch(details, /typed by the user|before,/);
  }
  console.log("✓ A response that was running when the user took over isn't in the log; a hold watch reports the end");

  const ref = (await claude("find", { tabId, query: "buy" })).match(/\[(ref_\w+)\]/)![1];
  await takeOver();
  await giveBack();
  await assert.rejects(claude("computer", { tabId, action: "left_click", ref }), /read it again/);
  await assert.rejects(claude("computer", { tabId, action: "hover", ref }), /read it again/);
  assert.equal(await pageEval(tabId, "hits"), "0");
  await claude("read_page", { tabId });
  await claude("computer", { tabId, action: "left_click", ref });
  assert.equal(await pageEval(tabId, "hits"), "1");
  console.log("✓ Acting needs a read first");

  const started = JSON.parse(
    (
      await claude("record", { tabId, action: "start" }).catch((e) => `{"error":${JSON.stringify(String(e.message))}}`)
    ).split("\n")[0],
  );
  if (!started.error) {
    await sleep(1500);
    await takeOver();
    await sleep(1500);
    await giveBack();
    assert.match(await claude("record", { tabId, action: "stop" }), /the user took over/);
    console.log("✓ A video recording ends when the user takes over");
  } else console.log(`- No video check: ${started.error}`);

  await takeOver();
  await select(other);
  const away = await until("another tab has no Give back", (s) => !s.on);
  assert(!away.on);
  const asking = codex("ask_user", { tabId: other, message: "Which one?", options: ["A", "B"], timeout: 60 });
  await until("the card shows", (s) => s.state === "ask");
  await select(tabId);
  await until("Give back stays below the card", (s) => s.state === "ask" && s.take && s.on);
  await picture("6-card");
  await giveBack();
  await chrome(`island.querySelector(".choice").click(); return true;`);
  assert.match(await asking, /"choice":"A"/);
  console.log("✓ Give back stays in reach while a card of another tab shows, and only on the taken tab");

  await claude("read_page", { tabId });
  await until("the button is back", (s) => s.take && !s.on);
  await takeOver();
  await call("reload");
  await sleep(3000);
  await until("the takeover survives a reload", (s) => s.take && s.on, 15_000);
  const start = Date.now();
  const status = JSON.parse((await claude("read_page", { tabId }).catch((e) => e.message)).split("\n")[0]);
  assert.equal(status.status, "user_control");
  assert(Date.now() - start > 44_000 && Date.now() - start < 48_000);
  await chrome(`h.stopClaude(); return true;`);
  assert((await until("Stop keeps it", (s) => s.state === "stopped" && s.on)).take);
  await picture("7-stopped");
  await chrome(`h.resumeClaude(); return true;`);
  await giveBack();
  console.log("✓ It survives a reload and Stop; a call returns its status after 45 s");

  await claude("read_page", { tabId });
  await until("the button is back", (s) => s.take && !s.on);
  await takeOver();
  const waiting = claude("read_page", { tabId });
  const refused = assert.rejects(waiting, /changed|not assigned|not an agent tab/);
  await sleep(500);
  await chrome(`h.unmark(tab); return true;`);
  await refused;
  await until("no button on a tab without agents", (s) => !s.take);
  console.log("✓ Taking the tab back ends it");
  console.log("All live takeover checks passed.");
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  await chrome(
    `h.state.paused && h.resumeClaude(); for (const id of [${tabId}, ${other}]) { const t = h.findTab(id); if (t) { h.unmark(t); win.gBrowser.removeTab(t, { animate: false, skipPermitUnload: true }); } } return true;`,
  ).catch(console.error);
  server.close();
}
