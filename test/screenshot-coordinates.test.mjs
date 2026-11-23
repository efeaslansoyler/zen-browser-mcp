import test from "node:test";
import assert from "node:assert/strict";
import { inputTools } from "../browser/InputTools.sys.mjs";
import { bridgeContext } from "./support/bridge.mjs";

globalThis.Services = { wm: { getEnumerator: () => [] }, focus: {} };

// why: Only the Gecko capture and the page actor are fake; dispatch, batches and coordinates are the real bridge.
function harness({ rule = () => "allow" } = {}) {
  const prompts = [];
  const clicks = [];
  const asked = [];
  const canvas = () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => "data:image/jpeg;base64,x" });
  const browser = {
    browserId: 1,
    ownerDocument: { createElementNS: canvas, defaultView: {} },
    browsingContext: {
      id: 1,
      currentWindowGlobal: {
        drawSnapshot: async () => ({ width: 1000, height: 1000, close() {} }),
        getActor: () => ({ sendAsyncMessage() {} }),
      },
    },
  };
  const context = bridgeContext({
    screenshotCache: { unchanged: () => false },
    readConfig: () => ({ mode: "auto", sites: {} }),
    rule,
    askIsland: async (...args) => {
      prompts.push(args[3]);
      return "done";
    },
    state: { paused: false, tabs: new Set([1]) },
    findTab: () => ({ linkedBrowser: browser }),
    paintTab() {},
    hostOf: () => "page.test",
    describeAction: () => "",
    logActivity() {},
    assertSiteAccess() {},
    openDialog: () => null,
    framesOf: () => [browser.browsingContext],
    query: async (_, name, data) => {
      if (name === "frame_at") return { value: null };
      if (name === "ask_user") {
        asked.push([data.x, data.y]);
        return { value: "done" };
      }
      if (name !== "input") return { value: {} };
      clicks.push([data.x, data.y]);
      return { value: { hit: 'button "Go"' } };
    },
  });
  for (const session of ["a", "b"]) context.access.join(1, session);
  Object.assign(context.tools, inputTools(context));
  const run = async (tool, args, session = "a") => {
    const replies = [];
    context.reply = (_, __, message) => replies.push(message);
    await context.handle(JSON.stringify({ session, agent: { id: "codex" }, tool, args }), null, {});
    const [{ ok, error, content, isError }] = replies;
    const text = ok
      ? content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n")
      : error;
    return { ok: ok && !isError, text };
  };
  const computer = (args, session) => run("computer", { tabId: 1, ...args }, session);
  const shot = async (args = {}, session) =>
    (await computer({ action: "screenshot", ...args }, session)).text.match(/shot_\d+/)[0];
  const click = (coordinate, args = {}, session) => computer({ action: "left_click", coordinate, ...args }, session);
  return { run, computer, shot, click, clicks, asked, prompts };
}

test("coordinates refer to the latest viewport screenshot", async () => {
  const h = harness();
  await h.click([10, 10]);
  await h.shot({ scale: 0.5 });
  await h.click([10, 10]);
  await h.click([20, 20]);
  assert.deepEqual(h.clicks, [
    [10, 10],
    [20, 20],
    [40, 40],
  ]);
});

test("after screenshots of different scales a coordinate needs the image it comes from", async () => {
  const h = harness();
  const full = await h.shot();
  const small = await h.shot({ scale: 0.5 });
  for (const action of ["left_click", "double_click", "hover", "mouse_down", "scroll"]) {
    const refused = await h.computer({ action, coordinate: [100, 100], scroll_direction: "down" });
    assert.equal(refused.ok, false, action);
    assert.match(refused.text, new RegExp(`${full} 1000x1000.*${small} 500x500`));
  }
  assert.deepEqual(h.clicks, []);
  assert.equal((await h.click([100, 100], { screenshot: full })).ok, true);
  assert.equal((await h.click([100, 100], { screenshot: small })).ok, true);
  assert.deepEqual(h.clicks, [
    [100, 100],
    [200, 200],
  ]);
  await h.shot({ scale: 0.5 });
  assert.equal((await h.click([100, 100])).ok, true, "two images of one scale are unambiguous again");
});

test("an unknown image, another session's or a full-page one is refused", async () => {
  const h = harness();
  await h.shot();
  const theirs = await h.shot({}, "b");
  for (const screenshot of ["shot_99", theirs]) {
    const refused = await h.click([5, 5], { screenshot });
    assert.match(refused.text, new RegExp(`${screenshot} is not one of your recent viewport screenshots`));
  }
  assert.deepEqual(h.clicks, []);
});

test("another session's screenshot does not change how this session's coordinates are read", async () => {
  const h = harness();
  await h.shot();
  await h.shot({ scale: 0.5 }, "b");
  await h.click([30, 30]);
  await h.click([30, 30], {}, "b");
  assert.deepEqual(h.clicks, [
    [30, 30],
    [60, 60],
  ]);
});

test("batch coordinates refer to the screenshot taken before the batch", async () => {
  const h = harness();
  await h.shot();
  const step = (input) => ({ name: "computer", input: { tabId: 1, ...input } });
  const result = await h.run("browser_batch", {
    actions: [
      step({ action: "screenshot", scale: 0.5 }),
      step({ action: "left_click", coordinate: [50, 50] }),
      step({ action: "screenshot", scale: 0.2 }),
      step({ action: "left_click", coordinate: [60, 60] }),
    ],
  });
  assert.equal(result.ok, true, result.text);
  assert.deepEqual(h.clicks, [
    [50, 50],
    [60, 60],
  ]);
  assert.equal((await h.click([50, 50])).ok, false, "the batch left images of different scales");
});

test("a batch keeps its image however many it takes, and can't name one it has yet to take", async () => {
  const h = harness();
  await h.shot({ scale: 0.5 });
  const step = (input) => ({ name: "computer", input: { tabId: 1, ...input } });
  const many = Array.from({ length: 12 }, () => step({ action: "screenshot", scale: 0.5 }));
  await h.run("browser_batch", { actions: [...many, step({ action: "left_click", coordinate: [50, 50] })] });
  assert.deepEqual(h.clicks, [[100, 100]]);
  const guessed = await h.run("browser_batch", {
    actions: [
      step({ action: "screenshot" }),
      step({ action: "left_click", coordinate: [50, 50], screenshot: "shot_14" }),
    ],
  });
  assert.equal(guessed.ok, false);
  assert.match(guessed.text, /shot_14 is not one of your recent viewport screenshots/);
  assert.equal(h.clicks.length, 1);
});

test("the user is not asked about a coordinate that can't be placed", async () => {
  const h = harness({ rule: (key) => (key === "computer.screenshot" ? "allow" : "ask") });
  const guessed = await h.run("browser_batch", {
    actions: [
      { name: "computer", input: { tabId: 1, action: "screenshot" } },
      { name: "computer", input: { tabId: 1, action: "left_click", coordinate: [5, 5], screenshot: "shot_1" } },
    ],
  });
  assert.equal(guessed.ok, false);
  assert.deepEqual([h.prompts, h.clicks], [[], []]);
  assert.equal((await h.click([5, 5])).ok, true);
  assert.equal(h.prompts.length, 1);
});

test("questions to the user outline the point of the given image", async () => {
  const h = harness();
  await h.shot();
  const small = await h.shot({ scale: 0.5 });
  assert.equal((await h.run("hand_to_user", { tabId: 1, message: "x", coordinate: [5, 5] })).ok, false);
  await h.run("hand_to_user", { tabId: 1, message: "x", wait: "click", coordinate: [5, 5], screenshot: small });
  assert.deepEqual(h.asked, [[10, 10]]);
});

test("a click result says what was hit", async () => {
  const h = harness();
  assert.equal((await h.click([1, 1])).text, 'left_click done: button "Go".');
});
