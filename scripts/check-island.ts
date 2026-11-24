import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { call, type Content } from "../src/zen.ts";
import { pageEval } from "./support/fixture.ts";
import "./support/require-sandbox.ts";

const text = (content: Content[]) =>
  content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
const as = (id: string, name: string) => (tool: string, args: object) =>
  call(tool, args, 60_000, { id, name }, `check-island:${id}`).then(text);
const claude = as("claude", "Claude");
const codex = as("codex", "Codex");

const server = http.createServer((_request, response) => {
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(
    '<!doctype html><title>Login</title><body style="margin:0"><input id="user" style="display:block;margin:60px auto 0;width:300px;height:30px">',
  );
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
const open = async (agent: typeof claude) =>
  JSON.parse((await agent("tabs_create_mcp", { url })).split("\n")[0]).tabId as number;
const tabId = await open(claude);
const other = await open(codex);

const chrome = async (code: string) =>
  JSON.parse(
    text(
      await call("chrome_eval", {
        code: `(async () => {
          const tab = h.findTab(${tabId}), win = tab.ownerDocument.defaultView;
          const island = win.document.getElementById("zen-mcp-island");
          const box = (el) => el.getBoundingClientRect();
          const mouse = (type, x, y, button = 0) =>
            win.synthesizeMouseEvent(type, x, y, { button, buttons: type === "mousedown" ? 1 : 0, clickCount: type === "mousemove" ? 0 : 1 });
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
    return {
      open: island.hasAttribute("open"), height: Math.round(box(island).height), text: island.querySelector(".action").textContent,
      done: shown(".ok"), cancel: shown(".cancel"), others: shown(".workers"), stop: shown(".main .stop"), bottom: box(island).bottom - box(win.gBrowser.tabpanels).top,
    };`);
const point = (selector: string) => chrome(`return middle(island.querySelector(${JSON.stringify(selector)}));`);
const move = ([x, y]: number[]) => chrome(`mouse("mousemove", ${x}, ${y}); return true;`);
const press = ([x, y]: number[]) => chrome(`click(${x}, ${y}); return true;`);
const page = () => chrome(`const r = box(win.gBrowser.tabpanels); return [r.left + 200, r.top + 400];`);
// why: A click during the unfolding can land outside the part already shown.
const until = async (what: string, check: (s: any) => boolean) => {
  let s: any, height: number | undefined;
  for (let i = 0; i < 120; i++) {
    s = await state();
    if (check(s) && s.height === height) return s;
    height = s.height;
    await sleep(50);
  }
  assert.fail(`${what}: ${JSON.stringify(s)}`);
};

try {
  await select(tabId);
  await move(await page());
  // why: An agent's row stays for four seconds after its last call.
  await sleep(5000);
  const top = Number(await pageEval(tabId, "document.getElementById('user').getBoundingClientRect().top"));
  const hand = claude("hand_to_user", { tabId, message: "Log in", timeout: 50 });
  const first = await until("opens", (s) => s.open && s.height > 100);
  assert(first.bottom > top, "the open card reaches the field");
  assert(!first.others, "the asking agent isn't repeated below its card");
  const opened = Date.now();
  const closed = await until("closes by itself", (s) => !s.open && s.height === 34);
  assert(Date.now() - opened > 2500, "it closed too early");
  assert.equal(closed.text, "Claude: Log in");
  assert(closed.bottom < top, "the line leaves the field free");
  assert(closed.done && closed.cancel && closed.stop, "a hand-over keeps its buttons and Stop on the line");
  console.log("✓ A hand-over opens, then shrinks to a line that leaves the page free and keeps its buttons");

  await move(await point(".main .action"));
  await until("hover opens it", (s) => s.open && s.height > 100);
  await move(await page());
  await until("leaving closes it", (s) => !s.open && s.height === 34);
  const passing = await point(".main .action");
  await chrome(
    `mouse("mousemove", ${passing[0]}, ${passing[1]}); mouse("mousemove", ${(await page()).join()}); return true;`,
  );
  await sleep(500);
  assert(!(await state()).open, "a pointer passing by opened it");
  console.log("✓ Hover opens it after a moment, leaving closes it");

  await move(await point(".main .action"));
  await until("hover opens it", (s) => s.open && s.height > 100);
  await press(await point(".answer-note"));
  await chrome(`island.querySelector(".answer-note").value = "wait"; return true;`);
  await move(await page());
  await sleep(1000);
  assert((await state()).open, "it closed while the note had the focus");
  await press(await page());
  const draft = await until("a click on the page closes it", (s) => !s.open && s.height === 34);
  assert.match(draft.text, /^✎ /);
  console.log("✓ It stays open while a note is written; an unsent note is kept and marked");

  const done = await point(".ok");
  await move(done);
  await until("the line opens under the pointer", (s) => s.open && s.height > 100);
  assert.deepEqual(await point(".ok"), done, "Done moved away under the pointer");
  await press(done);
  assert.match(await hand, /"status":"done".*"userMessage":"wait"/);
  console.log("✓ Done doesn't move when the card opens, and the note goes with it");

  await move(await page());
  const reading = codex("computer", { action: "wait", duration: 8, tabId: other });
  const question = claude("ask_user", { tabId, message: "Which one?", options: ["A", "B"], timeout: 50 });
  await until("the question opens", (s) => s.open && s.height > 100);
  assert((await state()).others, "another agent at work has its row");
  await select(other);
  await sleep(6000);
  assert((await state()).open, "time ran while another tab was selected");
  await select(tabId);
  await sleep(4500);
  const waiting = await until("the question closes", (s) => !s.open && s.height === 34);
  assert(!waiting.done && !waiting.cancel && waiting.stop, "a question has no answers on the line");
  await move(await point(".main .action"));
  await until("hover opens it", (s) => s.open && s.height > 100);
  await press(await point(".choice"));
  assert.match(await question, /"choice":"A"/);
  await reading;
  console.log("✓ A question waits for its tab to be looked at and shows its answers only when open");
  console.log("All live island checks passed.");
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  await claude("tabs_close_mcp", { tabId }).catch(console.error);
  await codex("tabs_close_mcp", { tabId: other }).catch(console.error);
  server.close();
}
