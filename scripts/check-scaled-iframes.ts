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

const button = (name: string, left: number, top: number) =>
  `<button style="position:absolute;left:${left}px;top:${top}px;width:40px;height:20px;padding:0;font-size:8px" onclick="parent.postMessage('${name}','*')">${name}</button>`;
const drag = `<script>onmousedown=(e)=>(from=e.target);onmouseup=(e)=>{if(e.target!==from)parent.postMessage(from.textContent+">"+e.target.textContent,"*")}</script>`;
const inner = `<body style="margin:0">${drag}${button("near", 10, 10)}${button("far", 350, 70)}<div onscroll="parent.postMessage('scrolled','*')" style="position:absolute;left:200px;top:40px;width:50px;height:50px;overflow:auto"><p style="height:500px"></p></div>`;
const frame = (style: string, wrap = "", url = "/inner") =>
  `<div style="position:absolute;left:100px;top:50px;${wrap}"><iframe src="${url}" style="display:block;width:400px;height:100px;border:0;transform-origin:0 0;${style}"></iframe></div>`;
type Point = [number, number];
const scaled =
  (x: number, y = x) =>
  (p: Point): Point => [100 + p[0] * x, 50 + p[1] * y];
const cases = (): Record<string, [html: string, at: (p: Point) => Point]> => ({
  plain: [frame(""), scaled(1)],
  padded: [frame("border:5px solid;padding:7px"), ([x, y]) => [112 + x, 62 + y]],
  paddedScaled: [frame("border:5px solid;padding:7px;transform:scale(.5)"), ([x, y]) => [106 + x / 2, 56 + y / 2]],
  half: [frame("transform:scale(.5)"), scaled(0.5)],
  larger: [frame("transform:scale(1.5)"), scaled(1.5)],
  stretched: [frame("transform:scale(1.2,.6)"), scaled(1.2, 0.6)],
  ancestor: [frame("", "transform:scale(.5);transform-origin:0 0"), scaled(0.5)],
  scaleProperty: [frame("scale:.5"), scaled(0.5)],
  zoom: [frame("zoom:.5"), scaled(0.5)],
  zoomed: [frame("", "zoom:.5;left:200px;top:100px"), scaled(0.5)],
  borderBox: [
    frame("box-sizing:border-box;padding:10px;width:420px;height:120px;transform:scale(.5)"),
    ([x, y]) => [105 + x / 2, 55 + y / 2],
  ],
  quarter: [frame("transform:rotate(90deg)", "left:300px"), ([x, y]) => [300 - y, 50 + x]],
  mirrored: [frame("transform:scaleX(-1)", "left:600px"), ([x, y]) => [600 - x, 50 + y]],
  skewed: [frame("transform:skewX(20deg)"), ([x, y]) => [100 + x + y * Math.tan(Math.PI / 9), 50 + y]],
  cross: [frame("transform:scale(.5)", "", `${other}/inner`), scaled(0.5)],
  nested: [
    frame("transform:scale(.8);width:600px;height:250px", "", "/half"),
    ([x, y]) => [100 + (100 + x / 2) * 0.8, 50 + (50 + y / 2) * 0.8],
  ],
  nestedCross: [
    frame("transform:scale(.8);width:600px;height:250px", "", `${other}/crossBack`),
    ([x, y]) => [100 + (100 + x / 2) * 0.8, 50 + (50 + y / 2) * 0.8],
  ],
});
const server = http.createServer((request, response) => {
  const name = request.url!.slice(1);
  const body =
    name === "inner"
      ? inner
      : name.startsWith("tiny")
        ? frame(`width:900px;zoom:${name.slice(4)}`, "", "/small")
        : name === "small"
          ? `<body style="margin:0"><button aria-label="tiny" style="position:absolute;left:800px;top:20px;width:8px;height:8px;padding:0" onclick="parent.postMessage('tiny','*')"></button>`
          : name === "crossBack"
            ? frame("transform:scale(.5)", "", `http://127.0.0.1:${port}/inner`)
            : (cases()[name]?.[0] ?? "");
  response
    .setHeader("content-type", "text/html; charset=utf-8")
    .end(
      `<!doctype html><title>${name}</title><script>hits=[];addEventListener("message",(e)=>{hits.push(e.data);if(parent!==window)parent.postMessage(e.data,"*")})</script>${body}`,
    );
});
await new Promise<void>((resolve) => server.listen(0, resolve));
const { port } = server.address() as AddressInfo;
const other = `http://localhost:${port}`;
const { tabId } = JSON.parse((await command("tabs_create_mcp", { url: "about:blank" })).split("\n")[0]);
const hit = async (name: string) => {
  for (let i = 0; i < 20 && (await pageEval(tabId, "String(hits)")) === ""; i++) await sleep(50);
  assert.equal(await pageEval(tabId, "hits.splice(0).join()"), name);
};

try {
  const failed: string[] = [];
  for (const [name, [, at]] of Object.entries(cases())) {
    await command("navigate", { tabId, url: `http://127.0.0.1:${port}/${name}` });
    let found = "";
    for (let i = 0; i < 30 && !/"far"/.test(found); i++) {
      found = (await command("read_page", { tabId, filter: "interactive" })).replace(/\[iframe .*\]/g, "");
      if (!/"far"/.test(found)) await sleep(150);
    }
    await sleep(300);
    for (const [target, point] of [
      ["near", [30, 20]],
      ["far", [370, 80]],
    ] as [string, Point][])
      for (const args of [
        { ref: found.match(new RegExp(`"${target}" \\[(ref_\\w+)\\]`))![1] },
        { coordinate: at(point) },
      ])
        try {
          await command("computer", { tabId, action: "left_click", ...args });
          await hit(target);
        } catch (error) {
          failed.push(
            `${name} ${target} ${JSON.stringify(args)}: ${(error as Error).message.split(". ")[0].replace(/\n+/g, " ")}`,
          );
        }
    try {
      const ends = { start_coordinate: at([30, 20]), coordinate: at([370, 80]) };
      await command("computer", { tabId, action: "left_click_drag", ...ends });
      await hit("near>far");
      await command("computer", { tabId, action: "scroll", coordinate: at([220, 60]), scroll_direction: "down" });
      await hit("scrolled");
    } catch (error) {
      failed.push(`${name} drag or scroll: ${(error as Error).message.split(". ")[0].replace(/\n+/g, " ")}`);
    }
  }
  assert.deepEqual(failed, []);
  // why: With these Gecko rounds the zoom, which moves a point at 800 px by more than the button's width.
  for (const name of ["tiny0.77", "tiny1.1"]) {
    await command("navigate", { tabId, url: `http://127.0.0.1:${port}/${name}` });
    await sleep(500);
    const ref = (await command("find", { tabId, query: "tiny" })).match(/button "tiny" \[(ref_\w+)\]/)![1];
    await command("computer", { tabId, action: "left_click", ref });
    await hit("tiny");
  }
  console.log(
    "✓ Refs, coordinates, drags and the wheel reach what shows there in scaled, zoomed, rotated, mirrored and nested iframes",
  );
  console.log("All live scaled iframe checks passed.");
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  await command("tabs_close_mcp", { tabId }).catch(console.error);
  server.close();
}
