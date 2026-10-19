// Demo scenario for the README video. Claude's actions go through the real MCP tools (via the
// bridge socket); "user" actions move the real pointer with hyprctl and click without the
// virtual cursor. Prints a timeline (seconds since start) used for captions and cuts.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { call } from "../../src/zen.ts";

const WIN = { x: 480, y: 220 }; // demo window on screen
const SITE = "http://localhost:8765";
const t0 = Date.now();
const marks = [];
const mark = (label) => {
  const t = (Date.now() - t0) / 1000;
  marks.push({ t, label });
  console.log(`${t.toFixed(1)}s ${label}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = async (tool, args, timeout) => (await call(tool, args, timeout)).filter((c) => c.type === "text").map((c) => c.text).join("\n");
const evalChrome = (code) => text("chrome_eval", { code });
const ref = (out, re) => {
  const m = out.split("\n").find((l) => re.test(l))?.match(/\[(ref_[\w]+)\]/);
  if (!m) throw new Error(`no ref for ${re} in:\n${out}`);
  return m[1];
};

// browser content area origin inside the window
const content = JSON.parse(await evalChrome('(()=>{const r=Services.wm.getMostRecentWindow("navigator:browser").gBrowser.selectedBrowser.getBoundingClientRect(); return JSON.stringify([r.left,r.top])})()'));
let cursor = JSON.parse("[" + execFileSync("hyprctl", ["cursorpos"], { encoding: "utf8" }).trim() + "]");

// smooth real pointer movement to a point in window coordinates
async function pointerTo(wx, wy, ms = 600) {
  const [sx, sy] = cursor;
  const tx = WIN.x + wx, ty = WIN.y + wy;
  const steps = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const k = i / steps, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const x = Math.round(sx + (tx - sx) * e), y = Math.round(sy + (ty - sy) * e);
    execFileSync("hyprctl", ["dispatch", `hl.dsp.cursor.move({ x = ${x}, y = ${y} })`]);
    // imleci ışınlamak pencereye fare hareketi göndermiyor; tarayıcıya ayrıca bildir (hover,
    // seçici çerçevesi, ada önizlemesi)
    if (i % 3 === 0 || i === steps) await chromeMove(x - WIN.x, y - WIN.y);
    else await sleep(ms / steps);
  }
  cursor = [tx, ty];
}
const chromeMove = (wx, wy) => evalChrome(`(()=>{const w=Services.wm.getMostRecentWindow("navigator:browser"); const eu={window:w,parent:w,_EU_Ci:Ci,_EU_Cc:Cc}; Services.scriptloader.loadSubScript("chrome://remote/content/external/EventUtils.js", eu); eu.synthesizeMouseAtPoint(${wx}, ${wy}, {type:"mousemove"}, w); return 1})()`);
const pagePoint = ([x, y]) => [content[0] + x, content[1] + y];

// click on browser chrome (island) at window coordinates
const chromeClick = (wx, wy) => evalChrome(`(()=>{const w=Services.wm.getMostRecentWindow("navigator:browser"); const eu={window:w,parent:w,_EU_Ci:Ci,_EU_Cc:Cc}; Services.scriptloader.loadSubScript("chrome://remote/content/external/EventUtils.js", eu); eu.synthesizeMouseAtPoint(${wx}, ${wy}, {}, w); return 1})()`);
const chromeKey = (key, mods) => evalChrome(`(()=>{const w=Services.wm.getMostRecentWindow("navigator:browser"); const eu={window:w,parent:w,_EU_Ci:Ci,_EU_Cc:Cc}; Services.scriptloader.loadSubScript("chrome://remote/content/external/EventUtils.js", eu); eu.synthesizeKey(${JSON.stringify(key)}, ${JSON.stringify(mods)}, w); return 1})()`);
// center of an island element (window coordinates)
const islandRect = async (sel) => JSON.parse(await evalChrome(`(()=>{const r=Services.wm.getMostRecentWindow("navigator:browser").document.querySelector("#zen-mcp-island ${sel}").getBoundingClientRect(); return JSON.stringify([r.left+r.width/2, r.top+r.height/2])})()`));
const pageTarget = async (tabId, r) => JSON.parse(await evalChrome(`(async()=>JSON.stringify(await h.target(h.findTab(${tabId}).linkedBrowser,{ref:${JSON.stringify(r)}})))()`));
const userPageClick = (tabId, [x, y]) => evalChrome(`(async()=>{await h.input(h.findTab(${tabId}).linkedBrowser,{kind:"click",x:${x},y:${y},silent:true}); return 1})()`);
const setMode = (mode) => fs.writeFileSync(`${process.env.HOME}/.config/zen-mcp/config.json`, JSON.stringify({ mode, sensitive: [] }, null, 2) + "\n");

// ---- scene ----
setMode("auto");
await pointerTo(1100, 600, 300);
mark("start");
await sleep(1500);

// 1. Claude opens its own tab in the background
mark("claude-opens-tab");
const tab = JSON.parse(await text("tabs_create_mcp", {})).tabId;
await text("navigate", { tabId: tab, url: `${SITE}/index.html` });
await sleep(400);
// hover the island: live preview, then jump to the tab
mark("hover-island");
await text("computer", { tabId: tab, action: "screenshot", scale: 0.3 }); // keeps the island busy
const info = await islandRect(".info");
await pointerTo(info[0], info[1], 700);
await sleep(2200);
await chromeClick(info[0], info[1]);
mark("go-to-tab");
await pointerTo(1450, 700, 500);
await sleep(800);

// 2. shopping with real input
mark("shopping");
const products = await text("find", { tabId: tab, query: "Add to cart" });
const adds = products.split("\n").filter((l) => /Add to cart/.test(l)).map((l) => l.match(/\[(ref_\w+)\]/)[1]);
await text("computer", { tabId: tab, action: "left_click", ref: adds[0] });
await sleep(500);
await text("computer", { tabId: tab, action: "left_click", ref: adds[2] });
await sleep(700);
const cart = await text("find", { tabId: tab, query: "Cart" });
await text("computer", { tabId: tab, action: "left_click", ref: ref(cart, /link "Cart/) });
await text("wait_for", { tabId: tab, text: "Your order" });
await sleep(500);

// 3. the form, typed with real keystrokes
mark("typing");
const form = await text("read_page", { tabId: tab, filter: "interactive" });
for (const [re, value] of [[/textbox "Full name"/, "Ada Lovelace"], [/textbox "Email"/, "ada@example.com"], [/textbox "Address"/, "12 Analytical Street, London"]]) {
  await text("computer", { tabId: tab, action: "left_click", ref: ref(form, re) });
  await text("computer", { tabId: tab, action: "type", text: value });
  await sleep(250);
}
await text("computer", { tabId: tab, action: "left_click", ref: ref(form, /radio "Express/) });
await sleep(700);

// 4. ask mode: the island asks before acting
setMode("ask");
mark("ask-mode");
const note = call("form_input", { tabId: tab, ref: ref(form, /textbox "Gift note"/), value: "Happy birthday, Charles! ☕" }, 60000);
await sleep(1200);
const allow = await islandRect(".ok");
await pointerTo(allow[0], allow[1], 800);
await sleep(900);
await chromeClick(allow[0], allow[1]);
await note;
mark("allowed");
setMode("auto");
await sleep(900);

// 5. payment handed to the user, inside the cross-site iframe
mark("ask-user");
const pay = await text("find", { tabId: tab, query: "Pay now" });
const payRef = ref(pay, /button "Pay now"/);
const asked = text("ask_user", { tabId: tab, ref: payRef, message: "Check the total, then press Pay now to confirm.", wait: "click", timeout: 60 }, 80000);
await sleep(1800);
const payPoint = await pageTarget(tab, payRef);
const [px, py] = pagePoint(payPoint);
await pointerTo(px, py, 900);
await sleep(700);
await userPageClick(tab, payPoint);
await asked;
await text("wait_for", { tabId: tab, text: "Order placed" });
mark("order-placed");
await pointerTo(1300, 760, 500);
await sleep(1500);

// 6. show Claude an element (channels)
mark("pick");
await chromeKey("F", { ctrlKey: true, shiftKey: true });
await sleep(600);
const heading = await text("find", { tabId: tab, query: "Order placed" });
const [hx, hy] = pagePoint(await pageTarget(tab, ref(heading, /heading "Order placed/)));
await pointerTo(hx - 150, hy + 60, 500);
await pointerTo(hx + 40, hy + 4, 700);
await sleep(900);
await chromeClick(hx + 40, hy + 4);
await sleep(900);
mark("compose");
const msg = "Make this heading green and add a confetti burst";
for (let i = 1; i <= msg.length; i++) {
  await evalChrome(`(()=>{const t=Services.wm.getMostRecentWindow("navigator:browser").document.querySelector("#zen-mcp-island textarea"); t.value=${JSON.stringify(msg.slice(0, i))}; return 1})()`);
  await sleep(45);
}
await sleep(500);
const send = await islandRect(".compose .primary");
await pointerTo(send[0], send[1], 600);
await sleep(400);
await chromeClick(send[0], send[1]);
mark("sent");
await sleep(2600);

// 7. stop Claude
mark("stop");
await text("navigate", { tabId: tab, url: `${SITE}/index.html` });
const scrolling = (async () => {
  for (let i = 0; i < 6; i++) await text("computer", { tabId: tab, action: "scroll", coordinate: [700, 500], scroll_direction: i % 2 ? "up" : "down", scroll_amount: 2 }).catch(() => {});
})();
await sleep(1200);
// ada metni değişince düğmeler kayıyor: yaklaştıktan sonra konumu yeniden al
let stop = await islandRect(".stop");
await pointerTo(stop[0], stop[1], 600);
await sleep(300);
stop = await islandRect(".stop");
await pointerTo(stop[0], stop[1], 120);
await chromeClick(stop[0], stop[1]);
mark("stopped");
await scrolling;
await sleep(2500);
const resume = await islandRect(".stop");
await pointerTo(resume[0], resume[1], 400);
await chromeClick(resume[0], resume[1]);
await sleep(600);
if (await evalChrome("String(h.state.paused)") === "true") console.log("WARN: still paused");
mark("end");
fs.writeFileSync(new URL("./timeline.json", import.meta.url), JSON.stringify(marks, null, 2));
