import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { call, type Content } from "../src/zen.ts";
import { approveWhile, pageEval } from "./support/fixture.ts";

const agent = { id: "codex", name: "Codex" };
const text = (content: Content[]) =>
  content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
const command = async (tool: string, args: object = {}) => text(await call(tool, args, 60_000, agent));
const open = async (tabId: number) =>
  text(await call("chrome_eval", { code: `!!h.openDialog(h.findTab(${tabId}).linkedBrowser)` })) === "true";

const server = http.createServer((_request, response) => {
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end("<!doctype html><title>Dialogs</title><p>Ready</p>");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
let tabId: number | undefined;

const show = async (code: string, wait: number) => {
  await pageEval(tabId!, `window.answers = []; setTimeout(() => { ${code} }); true`);
  for (let i = 0; i < 100 && !(await open(tabId!)); i++) await sleep(50);
  assert(await open(tabId!), `No dialog from ${code}`);
  await sleep(wait);
};
const answer = (args: object, next = async (result: string) => result) =>
  approveWhile(command("handle_dialog", { tabId, ...args }).then(next), "the page's dialog");
const answers = async () => JSON.parse(await pageEval(tabId!, "JSON.stringify(answers)"));

try {
  tabId = JSON.parse((await command("tabs_create_mcp", { url })).split("\n")[0]).tabId as number;
  const cases: [string, object, unknown][] = [
    ["alert('A?')", { accept: true }, null],
    ["confirm('A?')", { accept: true }, true],
    ["confirm('A?')", { accept: false }, false],
    ["prompt('A?')", { accept: true, text: "typed" }, "typed"],
    ["prompt('A?')", { accept: false }, null],
  ];
  for (const wait of [0, 300, 2500])
    for (const [dialog, args, expected] of cases) {
      await show(`answers.push(${dialog} ?? null)`, wait);
      const next = await answer(args, () => command("get_page_text", { tabId }));
      assert.match(next, /Ready/, `${dialog} ${JSON.stringify(args)} after ${wait} ms: ${next}`);
      assert.deepEqual(await answers(), [expected]);
    }
  console.log("✓ The call right after an answered alert, confirm or prompt isn't refused");

  for (let i = 0; i < 5; i++) {
    await show("answers.push(confirm('A?')); answers.push(prompt('B?'))", i * 200);
    const started = Date.now();
    assert.match(await answer({ accept: true }), /^confirm(Check)? "A\?" accepted/);
    assert(Date.now() - started < 4000, "the second dialog was mistaken for the first");
    for (let n = 0; n < 40 && !(await open(tabId)); n++) await sleep(50);
    assert.match(await answer({ accept: true, text: "x" }), /^prompt(Check)? "B\?" accepted/);
    assert.deepEqual(await answers(), [true, "x"]);
  }
  console.log("✓ A dialog the page opens right after the answer is another one");
  console.log("All live dialog checks passed.");
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  if (tabId != null) await command("tabs_close_mcp", { tabId }).catch(console.error);
  server.close();
}
