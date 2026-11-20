import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fixtureTransportEnv, pageEval } from "./support/fixture.ts";
import { call, type Content } from "../src/zen.ts";
import { reloadBridge } from "./support/bridge.ts";
const text = (r: Content[]) =>
  r
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
const chrome = async (code: string) => JSON.parse(text(await call("chrome_eval", { code })));
const client = new Client({ name: "codex-mcp-client", version: "input-smoke" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["src/server.ts"],
  cwd: process.cwd(),
  env: fixtureTransportEnv(),
});
async function tool(name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  const content = r.content as Content[];
  if (r.isError) throw new Error(text(content));
  return content;
}
let tabId: number | undefined;
const original = await chrome(
  'Services.wm.getMostRecentWindow("navigator:browser").gBrowser.selectedBrowser.browserId',
);
try {
  const state = await chrome("({version:h.version,paused:h.state.paused})");
  assert(!state.paused);
  console.log(text(await reloadBridge()));
  for (let i = 0; i < 50; i++) {
    await sleep(30);
    try {
      if (await chrome(`h.version>${state.version}`)) break;
    } catch {}
  }
  await client.connect(transport);
  tabId = JSON.parse(text(await tool("tabs_create_mcp"))).tabId;
  const html =
    '<!doctype html><title>Zen input fixture</title><style>body{font:18px sans-serif}textarea{margin:30px;width:240px;height:70px}button{margin:30px;padding:20px}</style><textarea aria-label="Entry"></textarea><button>Target</button><script>window.events=[];for(const type of ["keydown","keyup","mousemove","mousedown","mouseup","input"])document.addEventListener(type,e=>events.push({type,key:e.key,shift:e.shiftKey,ctrl:e.ctrlKey,trusted:e.isTrusted,x:e.clientX,y:e.clientY}));</script>';
  await tool("navigate", { tabId, url: "data:text/html," + encodeURIComponent(html) });
  const tree = text(await tool("read_page", { tabId }));
  const field = tree.match(/textbox "Entry" \[([^\]]+)\]/)?.[1],
    button = tree.match(/button "Target" \[([^\]]+)\]/)?.[1];
  assert(field && button, tree);
  const computer = (action: string, args: object = {}) => tool("computer", { tabId, action, ...args });
  const evaluate = (code: string) => pageEval(tabId!, code);
  assert.notEqual(
    await chrome('Services.wm.getMostRecentWindow("navigator:browser").gBrowser.selectedBrowser.browserId'),
    tabId,
  );
  await computer("left_click", { ref: field });
  await computer("type", { text: "Hello 世界", typing: "human", delay_ms: 2, seed: 42 });
  assert.match(text(await tool("read_page", { tabId })), /Hello 世界/);
  await computer("key_down", { text: "Shift" });
  await computer("key", { text: "a" });
  await computer("key_up", { text: "Shift" });
  let events = JSON.parse(await evaluate("JSON.stringify(events)"));
  assert(
    events.some((e: any) => e.type === "keydown" && e.key === "A" && e.shift && e.trusted),
    JSON.stringify(events.slice(-8)),
  );
  assert(events.some((e: any) => e.type === "keyup" && e.key === "Shift" && e.trusted));
  console.log("✓ Human typing and held Shift across calls produce trusted key events");
  await computer("key_down", { text: "Control" });
  const copying = computer("key", { text: "c" }).then(
    () => null,
    (error) => error,
  );
  for (let i = 0; i < 100; i++) {
    const ready = await chrome(
      `(()=>{if(h.island.state!=='ask')return false;const n=h.findTab(${tabId}).ownerDocument.getElementById('zen-mcp-island');if(!/System clipboard permission|Sistem panosu izni/.test(n.textContent))return false;n.querySelector('.cancel').click();return true;})()`,
    );
    if (ready) break;
    await sleep(20);
  }
  assert.match(String(await copying), /denied/);
  events = JSON.parse(await evaluate("JSON.stringify(events)"));
  assert(events.some((e: any) => e.type === "keyup" && e.key === "Control"));
  console.log("✓ Held Control cannot bypass clipboard consent; denied actions release held keys");

  await computer("mouse_move", { coordinate: [90, 220], movement: "human", duration_ms: 80, steps: 8, seed: 12 });
  await computer("mouse_down", { ref: button, button: "left" });
  await computer("mouse_move", { coordinate: [180, 230], movement: "smooth", duration_ms: 80, steps: 8 });
  await computer("mouse_up", { button: "left" });
  events = JSON.parse(await evaluate("JSON.stringify(events)"));
  assert(events.filter((e: any) => e.type === "mousemove" && e.trusted).length >= 16);
  assert(
    events.some((e: any) => e.type === "mousedown" && e.trusted) &&
      events.some((e: any) => e.type === "mouseup" && e.trusted),
  );
  console.log("✓ Real curved/smooth mouse paths and separate down/up work");
  await computer("key_down", { text: "Shift", hold_ms: 100 });
  await sleep(180);
  const released = await chrome(
    `(async()=>{const b=h.findTab(${tabId}).linkedBrowser;return (await b.browsingContext.currentWindowGlobal.getActor('ZenMcp').sendQuery('input_state',{})).value;})()`,
  );
  assert.equal(released.keys.length, 0);
  console.log("✓ Held-key watchdog releases input without a later key_up call");

  const frameUrl =
    "data:text/html," +
    encodeURIComponent(
      "<!doctype html><button onclick=\"if(event.isTrusted)this.textContent='Frame clicked'\">Frame target</button>",
    );
  await evaluate(
    `document.body.insertAdjacentHTML("beforeend", '<iframe id="input-frame"></iframe>');document.getElementById("input-frame").src=${JSON.stringify(frameUrl)}`,
  );
  await tool("wait_for", { tabId, text: "Frame target" });
  const frameRef = text(await tool("read_page", { tabId })).match(/button "Frame target" \[(ref_\d+_f\d+)\]/)?.[1];
  assert(frameRef, "Missing cross-origin frame button");
  await computer("left_click", { ref: frameRef, movement: "instant" });
  assert.match(text(await tool("read_page", { tabId })), /Frame clicked/);
  await evaluate('document.getElementById("input-frame").remove()');
  console.log("✓ Immediate read_page sees synchronous input effects in a background tab and cross-origin frame");

  await evaluate(`(() => {
    document.body.insertAdjacentHTML("beforeend", '<div id="scroll-area" style="overflow:auto;width:300px;height:120px"><div style="height:600px"><button>Wheel target</button></div></div>');
    const area = document.getElementById("scroll-area");
    area.addEventListener("wheel", (event) => {
      event.preventDefault();
      if (area.dataset.handler === "move") requestAnimationFrame(() => area.scrollTop = 50);
    }, { passive: false });
    area.dataset.handler = "move";
  })()`);
  const wheelRef = text(await tool("read_page", { tabId })).match(/button "Wheel target" \[([^\]]+)\]/)?.[1];
  assert(wheelRef, "Missing wheel target");
  const wheel = () => computer("scroll", { ref: wheelRef, scroll_direction: "down", scroll_amount: 1 });
  await wheel();
  assert.equal(await evaluate('document.getElementById("scroll-area").scrollTop'), "50");
  await evaluate(`(() => {
    const area = document.getElementById("scroll-area");
    area.scrollTop = 0;
    delete area.dataset.handler;
  })()`);
  await wheel();
  assert.equal(await evaluate('document.getElementById("scroll-area").scrollTop'), "100");
  await evaluate('document.getElementById("scroll-area").remove()');
  console.log("✓ Wheel acknowledges scrolling or applies the bounded fallback before returning");

  await evaluate("document.activeElement.blur()");
  await computer("screenshot", { if_changed: true });
  const same = await computer("screenshot", { if_changed: true });
  assert(JSON.parse(text(same)).unchanged);
  const annotated = await computer("screenshot", { annotate: true });
  assert(annotated.some((c) => c.type === "image"));
  assert(text(annotated).includes("Annotated refs:"));
  assert.equal(await evaluate('document.querySelectorAll("zen-mcp-annotations").length'), "0");
  console.log("✓ Unchanged screenshots skip image output; ref annotations are removed after capture");
  async function answer(allow: boolean) {
    for (let i = 0; i < 100; i++) {
      const ready = await chrome(
        `(()=>{if(h.island.state!=='ask')return false;const n=h.findTab(${tabId}).ownerDocument.getElementById('zen-mcp-island');if(!/Browser settings permission|Tarayıcı ayarı izni/.test(n.textContent))return false;n.querySelector('${allow ? ".ok" : ".cancel"}').click();return true;})()`,
      );
      if (ready) return;
      await sleep(30);
    }
    throw new Error("Settings permission did not appear");
  }
  const settings = (args: object) => tool("browser_settings", { tabId, ...args });
  const baseline = JSON.parse(text(await settings({ action: "get" })));
  const denied = settings({ action: "device", device: "mobile" }).then(
    () => null,
    (error) => error,
  );
  await answer(false);
  assert.match(String(await denied), /denied/);
  assert.equal(
    await chrome('Services.wm.getMostRecentWindow("navigator:browser").gBrowser.selectedBrowser.browserId'),
    original,
  );
  const changing = settings({ action: "device", device: "mobile" });
  await answer(true);
  const mobile = JSON.parse(text(await changing));
  assert(Math.abs(mobile.width - 390) < 1, JSON.stringify(mobile));
  assert(Math.abs(mobile.height - 844) < 1, JSON.stringify(mobile));
  assert.equal(mobile.requested.dpr, 3);
  assert.equal(await chrome(`h.findTab(${tabId}).linkedBrowser.browsingContext.overrideDPPX`), 3);
  assert.equal(mobile.webdriver, false);
  const scheme = baseline.colorScheme === "dark" ? "light" : "dark";
  const media = settings({ action: "media", color_scheme: scheme });
  await answer(true);
  assert.equal(JSON.parse(text(await media)).colorScheme, scheme);
  const resetting = settings({ action: "reset" });
  await answer(true);
  const reset = JSON.parse(text(await resetting));
  assert.equal(reset.dpr, baseline.dpr);
  assert.equal(reset.userAgent, baseline.userAgent);
  assert(!reset.emulated);
  console.log(
    "✓ Per-tab device/viewport/DPR/media changes always ask; denial preserves focus; reset restores originals",
  );
  console.log("All live input, screenshot and browser-settings checks passed.");
} finally {
  if (tabId != null) {
    await chrome(
      `(()=>{const t=h.findTab(${tabId}),n=t?.ownerDocument.getElementById('zen-mcp-island');if(h.island.state==='ask'&&n?.textContent.includes('Browser settings permission'))n.querySelector('.cancel').click();const old=h.findTab(${original});if(old&&t&&t.ownerDocument.defaultView.gBrowser.selectedTab===t)old.ownerDocument.defaultView.gBrowser.selectedTab=old;return true;})()`,
    ).catch(() => {});
    await tool("tabs_close_mcp", { tabId }).catch(console.error);
  }
  await client.close();
}
