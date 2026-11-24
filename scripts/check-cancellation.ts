import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { pageEval } from "./support/fixture.ts";
import { call, type Content } from "../src/zen.ts";
import { reloadBridge } from "./support/bridge.ts";
import "./support/require-sandbox.ts";
const agent = { id: "codex", name: "Codex" };
const text = (result: Content[]) =>
  result
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
const chrome = async (code: string) => JSON.parse(text(await call("chrome_eval", { code })));
const command = (tool: string, args: object = {}) => call(tool, args, 60_000, agent);
const stopped = (error: unknown) => /user stopped browser automation/i.test(String(error));
const capture = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ value, error: undefined }),
    (error) => ({ value: undefined, error }),
  );
let tabId: number | undefined;
let ownsPause = false;
try {
  const before = await chrome("({version:h.version,paused:h.state.paused})");
  assert(!before.paused, "Automation is already stopped by the user; resume it before running this test.");
  console.log(text(await reloadBridge()));
  let ready = false;
  let lastState: unknown;
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    try {
      const state = await chrome("({version:h.version,paused:h.state.paused,stop:typeof h.stopClaude})");
      lastState = state;
      if (state.version > before.version && state.stop === "function") {
        ready = true;
        break;
      }
    } catch (error) {
      lastState = String(error);
    }
  }
  assert(
    ready,
    `Updated bridge did not become ready. Last state: ${JSON.stringify(lastState)}. Check $XDG_RUNTIME_DIR/zen-mcp.log for the reload error.`,
  );
  console.log("✓ Updated browser code loaded without restarting Zen");
  tabId = JSON.parse(text(await command("tabs_create_mcp"))).tabId;
  const fixture =
    "data:text/html;charset=utf-8," +
    encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>Zen cancellation test</title>
    <h1>Disposable cancellation test</h1><label>Message <textarea id="message"></textarea></label><p id="result">untouched</p>`);
  await command("navigate", { tabId, url: fixture });
  const tree = text(await command("read_page", { tabId }));
  const field = tree.match(/textbox "Message" \[([^\]]+)\]/)?.[1];
  assert(field, `Test field missing: ${tree}`);
  const page = (code: string) => pageEval(tabId!, code);

  const batch = capture(
    command("browser_batch", {
      actions: [
        { name: "computer", input: { tabId, action: "wait", duration: 30 } },
        { name: "form_input", input: { tabId, ref: field, value: "BAD" } },
      ],
    }),
  );
  await sleep(250);
  ownsPause = true;
  await chrome("(() => { h.stopClaude(); return h.state.paused; })()");
  const batchResult = await batch;
  assert(!batchResult.error, String(batchResult.error));
  assert(batchResult.value?.isError, "Cancelled batch did not report partial failure");
  assert.match(text(batchResult.value), /remaining 1 step/);
  await assert.rejects(command("get_page_text", { tabId }), stopped);
  await chrome("(() => { h.resumeClaude(); return h.state.paused; })()");
  ownsPause = false;
  assert.equal(await page('document.getElementById("message").value'), "", "A cancelled batch step ran");
  console.log("✓ Stop cancels active wait and batch; new work is blocked while paused");

  // why: Resume must not revive a cancellation scope that already ended.
  const waiting = capture(command("computer", { tabId, action: "wait", duration: 30 }));
  await sleep(150);
  await chrome("(() => { h.stopClaude(); h.resumeClaude(); return h.state.paused; })()");
  assert(stopped((await waiting).error), "Immediate Resume revived the old wait");
  await command("get_page_text", { tabId });
  console.log("✓ Immediate Stop/Resume cancels old work and accepts fresh requests");

  await command("computer", { tabId, action: "left_click", ref: field });
  const typing = capture(command("computer", { tabId, action: "type", text: "x".repeat(50000) }));
  // why: Inspect only the fixture directly because the tool queue is busy.
  let count = 0;
  for (let i = 0; i < 100 && count === 0; i++) {
    await sleep(20);
    count = await chrome(`(async () => {
      const actor=h.findTab(${tabId}).linkedBrowser.browsingContext.currentWindowGlobal.getActor("ZenMcp");
      const result=await actor.sendQuery("eval",{code:'document.getElementById("message").value.length'});
      if(result.error) throw new Error(result.error);
      return Number(result.value);
    })()`);
  }
  assert(count > 0 && count < 50000, "Could not catch real text input in flight");
  ownsPause = true;
  await chrome("(() => { h.stopClaude(); return h.state.paused; })()");
  assert(stopped((await typing).error), "Typing did not report cancellation");
  // why: Resume first to prove the old actor remains cancelled independently of the paused flag.
  await chrome("(() => { h.resumeClaude(); return h.state.paused; })()");
  ownsPause = false;
  const readLength = async () => Number(await page('document.getElementById("message").value.length'));
  const length = await readLength();
  assert(length > 0 && length < 50000, `Unexpected interrupted text length: ${length}`);
  await sleep(300);
  assert.equal(await readLength(), length, "Text input continued after Stop/Resume");
  await command("computer", { tabId, action: "type", text: "OK" });
  assert.equal(await readLength(), length + 2, "Fresh typing failed after Resume");
  console.log(`✓ Real typing stopped at ${length}/50000 characters; no late input; fresh typing works`);
  console.log("All live cancellation checks passed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  // why: Restore only state introduced by this test so unrelated browser state survives.
  if (ownsPause)
    await chrome("(() => { h.resumeClaude(); return true; })()").catch((error) =>
      console.error("Resume cleanup failed:", error),
    );
  if (tabId !== undefined) {
    await command("tabs_close_mcp", { tabId }).then(
      () => console.log("Test tab closed."),
      (error) => {
        console.error(`Could not close test tab ${tabId}:`, error);
        process.exitCode = 1;
      },
    );
  }
}
