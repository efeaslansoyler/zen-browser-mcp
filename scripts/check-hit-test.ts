// why: The hit-test check requires auto mode so it can leave permission settings and user tabs alone.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pageEval } from "./support/fixture.ts";
import { call, type Content } from "../src/zen.ts";
import { reloadBridge } from "./support/bridge.ts";
const agent = { id: "codex", name: "Codex" };
const text = (content: Content[]) =>
  content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
const chrome = async (code: string) => JSON.parse(text(await call("chrome_eval", { code })));
const command = (tool: string, args: object = {}) => call(tool, args, 60_000, agent);
const token = `zen-hit-${Date.now()}`;
let tabId: number | undefined;
const child = (name: string) =>
  "data:text/html;charset=utf-8," +
  encodeURIComponent(
    `<!doctype html><style>button{margin:20px;padding:15px}</style><button onclick="top.postMessage('${token}:${name}','*')">${name} action</button>`,
  );
const fixture =
  "data:text/html;charset=utf-8," +
  encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>${token}</title>
<style>body{font:18px system-ui;padding:40px}button{padding:12px}#cover{position:fixed;inset:0;z-index:9999;background:#8888}iframe{display:block;width:400px;height:160px;margin-top:30px}#shadow{width:180px;padding:20px;background:#eee}</style>
<button id="target"><span>Target action</span></button><button id="disabled" disabled>Disabled control</button>
<div id="shadow" role="button" tabindex="0" aria-label="Shadow action"></div>
<input id="before" aria-label="Before field"><input id="after" aria-label="After field">
<div id="cover" hidden>Fixture modal</div>
<iframe title="Cross origin" src="${child("Child")}"></iframe>
<iframe id="outer" title="Nested"></iframe>
<script>
window.counts={target:0,cover:0,before:0,after:0,child:0,nested:0,shadow:0};
const cover=document.getElementById('cover'),target=document.getElementById('target');
cover.addEventListener('click',()=>counts.cover++);
target.addEventListener('click',()=>{counts.target++;if(window.armFirstClick)cover.hidden=false;});
target.addEventListener('mousemove',()=>{if(window.armHover)cover.hidden=false;});
const shadow=document.getElementById('shadow');shadow.attachShadow({mode:'open'}).innerHTML='<span>Shadow icon</span>';
shadow.addEventListener('click',()=>counts.shadow++);
for(const k of ['before','after'])document.getElementById(k).addEventListener('change',()=>counts[k]++);
window.addEventListener('message',event=>{if(event.data==='${token}:Child')counts.child++;if(event.data==='${token}:Nested')counts.nested++;});
document.getElementById('outer').srcdoc=${JSON.stringify(`<iframe style="width:300px;height:120px" src="${child("Nested")}"></iframe>`)};
</script>`);
try {
  const configFile = path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
    "zen-mcp/config.json",
  );
  const settings = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, "utf8")) : {};
  assert(settings.mode !== "ask", "This test requires your existing auto mode; settings have not been changed.");
  const before = await chrome("({version:h.version,paused:h.state.paused})");
  assert(!before.paused, "Resume browser automation before running the test.");
  console.log(text(await reloadBridge()));
  let ready = false;
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    try {
      if (await chrome(`h.version>${before.version}`)) {
        ready = true;
        break;
      }
    } catch {}
  }
  assert(ready, "Updated hit-test bridge did not reload.");
  tabId = JSON.parse(text(await command("tabs_create_mcp"))).tabId;
  await command("navigate", { tabId, url: fixture });
  const page = (code: string) => pageEval(tabId!, code);
  const counts = async () => JSON.parse(await page("JSON.stringify(window.counts)"));
  const find = async (query: string) => {
    for (let i = 0; i < 50; i++) {
      const found = text(await command("find", { tabId, query }));
      const ref = found.match(/\[(ref_\d+(?:_f\d+)?)\]/)?.[1];
      if (ref) return ref;
      await sleep(100);
    }
    throw new Error(`Fixture ref not found: ${query}`);
  };
  const click = (ref: string, action = "left_click") => command("computer", { tabId, action, ref });
  const blocked = async (promise: Promise<unknown>) => assert.rejects(promise, /Click blocked/);
  const target = await find("Target action");
  const [beforeField, afterField] = [await find("Before field"), await find("After field")];
  await page('document.getElementById("cover").hidden=false');
  for (const action of ["left_click", "right_click", "double_click", "triple_click"])
    await blocked(click(target, action));
  assert.deepEqual(await counts(), { target: 0, cover: 0, before: 0, after: 0, child: 0, nested: 0, shadow: 0 });
  console.log("✓ All four ref click actions reject a covering modal without clicking either element");

  const batch = await command("browser_batch", {
    actions: [
      { name: "form_input", input: { tabId, ref: beforeField, value: "before" } },
      { name: "computer", input: { tabId, action: "left_click", ref: target } },
      { name: "form_input", input: { tabId, ref: afterField, value: "after" } },
    ],
  });
  assert(batch.isError);
  assert.match(text(batch), /remaining 1 step/);
  assert.equal((await counts()).before, 1);
  assert.equal((await counts()).after, 0);
  console.log("✓ Blocked batch retains completed output and prevents the following write");

  await page('document.getElementById("cover").hidden=true');
  await click(target);
  assert.equal((await counts()).target, 1);
  await page(
    'document.getElementById("cover").hidden=false;document.getElementById("cover").style.pointerEvents="none"',
  );
  await click(target);
  assert.equal((await counts()).target, 2);
  await page(
    'document.getElementById("cover").hidden=true;document.getElementById("cover").style.pointerEvents="auto";window.armHover=true',
  );
  await blocked(click(target));
  assert.equal((await counts()).target, 2);
  assert.equal((await counts()).cover, 0);
  await page('window.armHover=false;document.getElementById("cover").hidden=true');
  console.log(
    "✓ Descendant span is clickable; pointer-events:none overlay passes; mousemove overlay blocks before mouse-down",
  );

  await command("computer", { tabId, action: "screenshot", scale: 0.5 });
  // why: Capture limits can shrink the image further than requested; use the actual coordinate ratio.
  const effectiveScale = await chrome(`h.state.scale.get(${tabId})`);
  assert(effectiveScale > 0 && effectiveScale <= 0.5, `Invalid screenshot scale: ${effectiveScale}`);
  const coordinate = JSON.parse(
    await page(
      `JSON.stringify((()=>{const r=document.getElementById("target").getBoundingClientRect();return [(r.left+r.width/2)*${effectiveScale},(r.top+r.height/2)*${effectiveScale}]})())`,
    ),
  );
  await command("computer", { tabId, action: "left_click", coordinate });
  assert.equal((await counts()).target, 3);
  await page("window.armHover=true");
  await blocked(command("computer", { tabId, action: "left_click", coordinate }));
  assert.equal((await counts()).target, 3);
  assert.equal((await counts()).cover, 0);
  await page('window.armHover=false;document.getElementById("cover").hidden=true;window.armFirstClick=true');
  await blocked(click(target, "double_click"));
  assert.equal((await counts()).target, 4);
  assert.equal((await counts()).cover, 0);
  await page('window.armFirstClick=false;document.getElementById("cover").hidden=true');
  await blocked(click(await find("Disabled control")));
  await click(await find("Shadow action"));
  assert.equal((await counts()).shadow, 1);
  console.log(
    "✓ Scaled coordinates work; changed coordinate target, multi-click replacement and disabled refs are blocked; shadow child works",
  );

  for (const [name, field] of [
    ["Child", "child"],
    ["Nested", "nested"],
  ]) {
    const ref = await find(`${name} action`);
    await page('document.getElementById("cover").hidden=false');
    await blocked(click(ref));
    assert.equal((await counts())[field], 0);
    assert.equal((await counts()).cover, 0);
    await page('document.getElementById("cover").hidden=true');
    await click(ref);
    assert.equal((await counts())[field], 1);
  }
  console.log("✓ Cross-origin and nested iframe refs reject a parent modal and work after it is removed");
  console.log("All live hit-test checks passed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (tabId !== undefined) {
    await command("tabs_close_mcp", { tabId }).then(
      () => console.log("Disposable test tab closed; permission settings unchanged."),
      (error) => {
        console.error(`Could not close fixture tab ${tabId}:`, error);
        process.exitCode = 1;
      },
    );
  }
}
