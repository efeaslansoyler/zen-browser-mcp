import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { call, type Content } from "../src/zen.ts";
import { pageEval } from "./support/fixture.ts";
import "./support/require-sandbox.ts";

const agent = { id: "codex", name: "Codex" };
const text = (content: Content[]) =>
  content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
const command = async (tool: string, args: object = {}) => text(await call(tool, args, 60_000, agent));

const gap = (height: number) => `<p style="height:${height}px;margin:0">gap</p>`;
const button = `<button onclick="parent.postMessage('hit','*')">Pay now</button>`;
const box = (inner: string, style = "overflow:auto") =>
  `<div class="box" style="height:120px;width:300px;${style}">${gap(150)}${inner}${gap(400)}</div>`;
const frame = (url: string, height: number) =>
  `<iframe src="${url}" style="border:0;height:${height}px;width:250px"></iframe>`;
const inShadow = (content: string, light = "") =>
  `<div id="host">${light}</div><script>host.attachShadow({mode:"open"}).innerHTML=\`${content.replace("</script>", "")}\`</script>`;
const inner = (): Record<string, string> => ({ button, listed: box(button) });
const reached = (): Record<string, string> => ({
  auto: box(button),
  scroll: box(button, "overflow:scroll"),
  smooth: box(button, "overflow:auto;scroll-behavior:smooth"),
  clipX: box(button, "overflow-x:hidden;overflow-y:auto"),
  sideways: `<div class="box" style="overflow:auto;width:200px;white-space:nowrap"><i style="display:inline-block;width:400px"></i>${button}<i style="display:inline-block;width:400px"></i></div>`,
  nested: box(box(button)),
  modal: `${gap(3000)}<div style="position:fixed;top:30px;left:30px">${box(button)}</div>`,
  body: `<style>html,body{height:100%;margin:0;overflow:hidden}body{height:120px;overflow:auto}</style>${gap(150)}${button}${gap(400)}<script>document.body.className="box"</script>`,
  tallTarget: box(`<button style="height:200px" onclick="parent.postMessage('hit','*')">Pay now</button>`),
  boxless: box(`<span style="display:contents" onclick="parent.postMessage('hit','*')">Pay now</span>`),
  shadow: inShadow(box(button)),
  slotted: inShadow(box("<slot></slot>"), button),
  inFrame: frame("/listed", 300),
  crossFrame: frame(`${cross}/listed`, 300),
  framed: box(frame("/button", 60)),
  framedCross: box(frame(`${cross}/button`, 60)),
  framedTwice: box(frame("/listed", 200)),
});
const refused = (): Record<string, string> => ({
  covered: box(button).replace(gap(150), "") + `<div style="position:fixed;inset:0;background:red"></div>`,
  coveredBody: `<style>body{height:100px;overflow-x:hidden}</style>${gap(150)}${button}${gap(3000)}<div style="position:fixed;inset:0;background:red"></div>`,
  collapsed: box(button, "overflow:hidden;height:0"),
  clip: box(button, "overflow:clip"),
});
const server = http.createServer((request, response) => {
  const name = request.url!.slice(1);
  const body = reached()[name] ?? refused()[name] ?? inner()[name] ?? "";
  response
    .setHeader("content-type", "text/html; charset=utf-8")
    .end(
      `<!doctype html><title>${name}</title><script>hits=0;addEventListener("message",()=>{hits++;if(parent!==window)parent.postMessage("hit","*")})</script>${body}`,
    );
});
await new Promise<void>((resolve) => server.listen(0, resolve));
const { port } = server.address() as AddressInfo;
const cross = `http://localhost:${port}`;
const { tabId } = JSON.parse((await command("tabs_create_mcp", { url: "about:blank" })).split("\n")[0]);
const boxes = `[...document.querySelectorAll(".box"), ...(document.querySelector("#host")?.shadowRoot.querySelectorAll(".box") ?? [])]`;
const at = () =>
  pageEval(
    tabId,
    `JSON.stringify([scrollY, ...${boxes}.flatMap((el) => [el.scrollLeft, el.scrollTop])].map(Math.round))`,
  );
const back = () =>
  pageEval(tabId, `for (const el of ${boxes}) el.scrollTo({ left: 0, top: 0, behavior: "instant" }); 1`);
const hits = async (expected: string, name: string) => {
  for (let i = 0; i < 20 && (await pageEval(tabId, "String(hits)")) !== expected; i++) await sleep(50);
  assert.equal(await pageEval(tabId, "String(hits)"), expected, name);
};
async function open(name: string) {
  await command("navigate", { tabId, url: `http://127.0.0.1:${port}/${name}` });
  for (let i = 0; i < 30; i++) {
    const ref = (await command("find", { tabId, query: "pay now" })).match(/"Pay now" \[(ref_\w+)\]/)?.[1];
    if (ref) return ref;
    await sleep(150);
  }
  throw new Error(`No target in ${name}`);
}

try {
  const failed: string[] = [];
  for (const name of Object.keys(reached()))
    try {
      const ref = await open(name);
      const start = await at();
      await command("computer", { tabId, action: "left_click", ref });
      await hits("1", name);
      const clicked = await at();
      await command("computer", { tabId, action: "left_click", ref });
      await hits("2", name);
      assert.equal(await at(), clicked, `${name}: a shown element was scrolled`);

      if (name.endsWith("Frame")) continue;
      assert.notEqual(clicked, start, name);
      for (const [tool, args] of [
        ["computer", { action: "scroll_to", ref }],
        ["computer", { action: "hover", ref }],
        ["highlight", { items: [{ ref, label: "here" }] }],
        ["ask_user", { ref, message: "This one?", options: ["A", "B"], timeout: 1 }],
      ] as const) {
        await back();
        await command(tool, { tabId, ...args });
        assert.notEqual(await at(), start, `${name}: ${tool} ${"action" in args ? args.action : ""} didn't scroll`);
        if (tool === "highlight") await command("highlight", { tabId, clear: true });
      }
    } catch (error) {
      failed.push(`${name}: ${(error as Error).message.split("\n")[0]}`);
    }
  assert.deepEqual(failed, []);
  console.log("✓ Elements clipped by a scroller are scrolled to, clicked, hovered, highlighted and asked about");
  console.log("✓ An element that shows already isn't scrolled");

  for (const name of Object.keys(refused())) {
    const ref = await open(name);
    const start = await at();
    await assert.rejects(command("computer", { tabId, action: "left_click", ref }), /Click blocked/, name);
    assert.equal(await at(), start, `${name} was scrolled`);
    await hits("0", name);
  }
  console.log("✓ A covered element, and one the user can't scroll to, is refused and nothing scrolls");
  console.log("All live scroller checks passed.");
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  await command("tabs_close_mcp", { tabId }).catch(console.error);
  server.close();
}
