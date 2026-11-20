// why: Use a disposable recipe so the check never alters a saved recording.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { call, type Content } from "../src/zen.ts";

const text = (items: Content[]) => items.map((item) => (item.type === "text" ? item.text : "")).join("\n");
const chrome = (code: string) => call("chrome_eval", { code }).then(text).then(JSON.parse);
const { tabId } = JSON.parse(text(await call("tabs_create_mcp")));
const name = `Recording fixture ${randomUUID()}`;
const tab = `h.findTab(${tabId})`;
const browser = `${tab}.linkedBrowser`;
const island = `${tab}.ownerDocument.getElementById("zen-mcp-island")`;
let pending: ReturnType<typeof call> | undefined;
let recipeId: string | undefined;

async function until(code: string, message: string) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await chrome(code)) return;
    await sleep(50);
  }
  throw new Error(message);
}

try {
  const html =
    "<style>button{position:absolute;left:20px;top:20px;width:120px;height:80px}</style><button>Fixture action</button>";
  await call("navigate", { tabId, url: `data:text/html,${encodeURIComponent(html)}` });
  pending = call("show_me", { tabId, name, message: name, timeout: 30 });
  void pending.catch(() => {});
  await until(`h.recordings.isRecording(${tabId})`, "Recording did not start.");
  await chrome(`(async () => {
    await h.backgroundQuery(${browser}, "input", { kind: "click", x: 50, y: 50, silent: true }, ${browser}.browsingContext);
    return true;
  })()`);
  await until(`${island}.textContent.includes("1 step")`, "The trusted click was not recorded.");
  await chrome(`(${island}.querySelector(".rec-button.primary").click(), true)`);
  await until(`!!${island}.querySelector(".review .footer .primary")`, "Recording review did not open.");
  await chrome(`(${island}.querySelector(".review .footer .primary").click(), true)`);
  const result = text(await pending);
  recipeId = result.match(/Saved the demonstration as recipe ([\w-]+)/)?.[1];
  assert(recipeId, result);
  const recipe = text(await call("recipes", { action: "get", id: recipeId, images: true }));
  assert.match(recipe, /Fixture action/);
  assert(text(await call("recipes", { action: "list" })).includes(name));
  console.log("OK: record trusted input, review, save and retrieve a recipe");
} finally {
  try {
    if (pending) {
      await chrome(`(h.tabRequests.get(${browser})?.("cancelled"), true)`).catch(() => {});
      await pending.catch(() => {});
    }
    if (recipeId) await chrome(`(async () => { await h.recipes.remove(${JSON.stringify(recipeId)}); return true; })()`);
  } finally {
    await call("tabs_close_mcp", { tabId });
  }
}
