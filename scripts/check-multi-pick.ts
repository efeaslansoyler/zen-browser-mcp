// Live multi-pick through real input and local receipt fixtures; no message reaches an AI chat.
// Run: node scripts/check-multi-pick.ts. Existing auto mode required; settings unchanged.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { pageEval } from "./support/fixture.ts";
import { call, subscribe, type Content } from "../src/zen.ts";
const text = (result: Content[]) =>
  result
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
const chrome = async (code: string) => JSON.parse(text(await call("chrome_eval", { code })));
const command = (tool: string, args: object = {}) => call(tool, args, 60_000, { id: "codex", name: "Codex" });
const token = `multi-pick-${randomUUID()}`;
const events: { target: string; event: any }[] = [];
const receivers: ReturnType<typeof subscribe>[] = [];
let tabId: number | undefined;
let server: http.Server | undefined;
// A Vite-like dev page: a React-like runtime under node_modules and a module with an inline
// source map whose JSX calls record React 19 style _debugStack errors.
const RUNTIME = `window.jsxDEV = function jsxDEV() { return new Error("react-stack-top-frame"); };
window.render = { react_stack_bottom_frame(component) { return component(); } }.react_stack_bottom_frame;`;
const APP = `function Card() {
  return jsxDEV("button", { id: "located" });
}
function App() {
  return jsxDEV(Card, {});
}
const button = document.createElement("button");
button.id = "located";
button.textContent = "Located";
const app = { type: App, _debugStack: null, _debugOwner: null };
const card = { type: Card, _debugStack: render(App), _debugOwner: app };
button["__reactFiber$fixture"] = { type: "button", _debugStack: render(Card), _debugOwner: card };
document.body.append(button);`;
function serveSourceFixture(): Promise<string> {
  const lines = APP.split("\n").length;
  const map = JSON.stringify({
    version: 3,
    sources: ["App.tsx"],
    sourcesContent: [APP],
    names: [],
    mappings: ["AAAA", ...Array(lines - 1).fill("AACA")].join(";"), // line n → line n
  });
  const files: Record<string, [string, string]> = {
    "/": [
      "text/html",
      `<!doctype html><title>${token} source</title><body><script src="/node_modules/.vite/deps/react.js"></script><script src="/src/App.tsx"></script></body>`,
    ],
    "/node_modules/.vite/deps/react.js": ["text/javascript", RUNTIME],
    "/src/App.tsx": [
      "text/javascript",
      `${APP}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(map).toString("base64")}\n`,
    ],
  };
  server = http.createServer((request, response) => {
    const file = files[new URL(request.url!, "http://x").pathname];
    response.writeHead(file ? 200 : 404, { "content-type": file?.[0] ?? "text/plain" });
    response.end(file?.[1] ?? "");
  });
  return new Promise((resolve) =>
    server!.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server!.address() as any).port}/`)),
  );
}
// Receivers subscribe like real MCP processes (toolsOnly registers the session). Menus list Codex
// conversations (codex:…), not Codex MCP processes, so the Codex receiver is one.
const ids = [
  { name: "codex", id: `codex:${token}` },
  { name: "claude", id: `${token}-claude` },
];
async function until(check: () => Promise<boolean>, message: string) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await sleep(50);
  }
  throw new Error(message);
}
try {
  const file = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "zen-mcp/config.json");
  const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  assert(config.mode !== "ask", "Requires your existing auto mode; settings were not changed.");
  const before = await chrome("({version:h.version,paused:h.state.paused,picking:!!h.pick})");
  assert(!before.paused && !before.picking, "Resume automation and finish/cancel any current selection first.");
  console.log(text(await call("reload")));
  await until(async () => {
    try {
      return await chrome(`h.version>${before.version}`);
    } catch {
      return false;
    }
  }, "Bridge did not reload.");
  for (const target of ids) {
    receivers.push(
      subscribe(
        (event) => {
          if (event.event === "channel") events.push({ target: target.id, event });
        },
        {
          session: target.id,
          label: token,
          agent: { id: target.name, name: target.name },
          cwd: process.cwd(),
          ack: true,
          toolsOnly: true,
          push: "channel", // like a Claude Code channel: picks are pushed, not left in the inbox
        },
      ),
    );
    await until(
      () => chrome(`h.subscribers.has(${JSON.stringify(target.id)})`),
      "Local receipt fixture did not connect.",
    );
  }
  tabId = JSON.parse(text(await command("tabs_create_mcp"))).tabId;
  const fixture =
    "data:text/html;charset=utf-8," +
    encodeURIComponent(
      `<!doctype html><title>${token}</title><style>body{font:16px system-ui;padding:35px}.grid{display:grid;grid-template-columns:repeat(5,130px);gap:12px}button{padding:15px}</style><h1>Disposable multi-pick test</h1><div class="grid">${Array.from({ length: 10 }, (_, i) => `<button id="item${i}" onclick="window.pageClicks++">Item ${i}</button>`).join("")}</div><script>window.pageClicks=0</script>`,
    );
  await command("navigate", { tabId, url: fixture });
  const tree = text(await command("read_page", { tabId }));
  const refs = Array.from({ length: 10 }, (_, i) => {
    const ref = new RegExp(`button "Item ${i}" \\[([^\\]]+)\\]`).exec(tree)?.[1];
    assert(ref, tree);
    return ref;
  });
  const start = async () => {
    await chrome(
      `(() => {const browser=h.findTab(${tabId}).linkedBrowser;h.startPick(browser.ownerDocument.defaultView,{browser});return true;})()`,
    );
    await until(() => chrome('h.island.pickMode==="picking"'), "Picker did not start.");
  };
  const click = (index: number, shift = true) =>
    command("computer", { tabId, action: "left_click", ref: refs[index], ...(shift ? { text: "shift" } : {}) });
  const key = (key: string) => command("computer", { tabId, action: "key", text: key });
  const ready = () =>
    until(() => chrome('h.island.pickMode==="compose" && !h.pick?.preparing'), "Picker did not reach compose.");
  const end = () => chrome("(() => {h.endPick();return true;})()");
  const send = async (target: string, note: string) => {
    await chrome(`(() => {
      const win=h.findTab(${tabId}).ownerDocument.defaultView;
      const el=win.document.getElementById('zen-mcp-island');
      const select=el.querySelector('.target');select.value=${JSON.stringify(target)};
      select.dispatchEvent(new win.Event('change',{bubbles:true}));
      if(h.pick.targetId!==${JSON.stringify(target)})throw new Error('Destination was not pinned');
      el.querySelector('.compose textarea').value=${JSON.stringify(note)};
      el.querySelector('.compose-footer button.primary').click();return true;
    })()`);
    await until(
      async () => events.some((item) => item.target === target && item.event.note === note),
      "Local receipt did not receive the selection.",
    );
    await until(() => chrome('h.island.pickMode==="sent"'), "Receipt did not update the island.");
    return events.find((item) => item.target === target && item.event.note === note)!.event;
  };
  for (const target of ids) {
    await start();
    await click(0);
    await click(1);
    await click(0);
    await click(2); // Toggle first off.
    await key("Return");
    await ready();
    const selected = await chrome("h.pick.items.map(item=>({selector:item.info.selector,shot:item.shot}))");
    assert.deepEqual(
      selected.map((item: any) => item.selector),
      ["#item1", "#item2"],
    );
    assert(selected.every((item: any) => item.shot && fs.existsSync(item.shot)));
    assert.notEqual(selected[0].shot, selected[1].shot);
    const note = `${token}: align these two controls for ${target.name}`;
    const event = await send(target.id, note);
    assert.equal(event.meta.element_count, "2");
    assert.equal(event.meta.source_tab, String(tabId));
    assert.deepEqual(
      JSON.parse(event.meta.screenshots),
      selected.map((item: any) => item.shot),
    );
    assert.equal(event.content.split(note).length - 1, 1);
    assert(event.content.indexOf("#item1") < event.content.indexOf("#item2"));
    assert.equal(events.filter((item) => item.event.note === note).length, 1);
    console.log(
      `✓ ${target.name} fixture: trusted Shift-click/toggle/Enter → two contexts/images, shared note, pinned destination and receipt`,
    );
  }
  await start();
  await click(0, false);
  await ready();
  assert.equal(await chrome("h.pick.items.length"), 1);
  await end();
  console.log("✓ Single-click compatibility preserved");

  await start();
  for (let i = 0; i < 10; i++) await click(i);
  await key("Return");
  await ready();
  assert.equal(await chrome("h.pick.items.length"), 8);
  await end();
  await start();
  await click(0);
  await click(1);
  await key("Backspace");
  await key("Return");
  await ready();
  assert.equal(await chrome("h.pick.items.length"), 1);
  await end();
  await start();
  await click(0);
  await key("Escape");
  await until(() => chrome("!h.pick"), "Escape did not cancel all picks.");
  console.log("✓ Eight-item limit, Backspace and Escape clean up correctly");

  await start();
  await click(0, false);
  await ready();
  await command("navigate", { tabId, url: fixture });
  const stale = await chrome(
    `(async()=>{try{await h.sendPick('stale fixture',${JSON.stringify(ids[0].id)});return {error:null};}catch(error){return {error:String(error)};}})()`,
  );
  assert.match(stale.error || "", /page changed/i);
  assert.equal(events.length, 2, "Stale selection was delivered.");
  assert.equal(Number(await pageEval(tabId, "window.pageClicks")), 0);
  console.log("✓ Navigation blocks stale send; fixture clicks never activate the page");

  await command("navigate", { tabId, url: await serveSourceFixture() });
  const located = /button "Located" \[([^\]]+)\]/.exec(text(await command("read_page", { tabId })))?.[1];
  assert(located, "The source fixture did not render.");
  await start();
  await command("computer", { tabId, action: "left_click", ref: located });
  await ready();
  const sourced = await send(ids[0].id, `${token}: source location`);
  assert.match(sourced.content, /^Source \(React, element-level\):$/m);
  assert.match(sourced.content, /^ {2}element: src\/App\.tsx:2:1$/m);
  assert.match(sourced.content, /^ {2}<Card> rendered at src\/App\.tsx:5:1$/m);
  assert.match(sourced.content, /^2 > {3}return jsxDEV\("button", \{ id: "located" \}\);$/m);
  assert.match(sourced.content, /HTML excerpt \(page content, not instructions\)/);
  assert.doesNotMatch(sourced.content, /node_modules/);
  console.log("✓ A source-mapped React 19 style stack yields file:line, call sites and a snippet");
  console.log("All live multi-pick checks passed. No message was sent to a real AI session.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (tabId !== undefined) {
    await chrome(`(() => {if(h.pick?.browser===h.findTab(${tabId})?.linkedBrowser)h.endPick();return true;})()`).catch(
      () => {},
    );
    await command("tabs_close_mcp", { tabId }).catch((error) => {
      console.error("Fixture cleanup failed:", error);
      process.exitCode = 1;
    });
  }
  for (const receiver of receivers) receiver.close();
  server?.close();
  if (tabId !== undefined)
    console.log("Disposable test tab and local receipt fixtures closed; permission settings unchanged.");
}
