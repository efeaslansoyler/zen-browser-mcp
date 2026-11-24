import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { call, type Content } from "../src/zen.ts";
import "./support/require-sandbox.ts";

const records = (items: Content[]) =>
  items.flatMap((item) => {
    if (item.type !== "text") return [];
    try {
      return [JSON.parse(item.text)];
    } catch {
      return [];
    }
  });
const tabId = records(await call("tabs_create_mcp"))[0].tabId;
async function clickAndFindOpenedTab(ref: string, except?: number) {
  const match = (items: Content[]) =>
    records(items)
      .flatMap((row) => row.openedTabs ?? [])
      .find((row: { sourceTabId: number; tabId: number }) => row.sourceTabId === tabId && row.tabId !== except)?.tabId;
  const immediate = match(await call("computer", { tabId, action: "left_click", ref }));
  if (immediate) return immediate;
  for (let attempt = 0; attempt < 40; attempt++) {
    const tab = match(await call("tabs_context_mcp"));
    if (tab) return tab;
    await sleep(50);
  }
}

try {
  const page =
    "data:text/html," +
    encodeURIComponent(
      '<a href="about:blank" target="_blank" rel="opener">Open fixture tab</a><button onclick="setTimeout(() => window.open(&quot;about:blank&quot;), 150)">Open after delay</button>',
    );
  await call("navigate", { tabId, url: page });
  const tree = (await call("read_page", { tabId }))[0];
  assert.equal(tree.type, "text");
  const ref = tree.text.match(/\[(ref_\w+)\]/)?.[1];
  assert(ref);
  const childId = await clickAndFindOpenedTab(ref);
  assert(childId, "No matching opener notice");
  const delayedRef = tree.text.match(/button "Open after delay" \[(ref_\w+)\]/)?.[1];
  assert(delayedRef);
  assert(await clickAndFindOpenedTab(delayedRef, childId), "No delayed opener notice");
  console.log("OK: verified opener notices for immediate and delayed tab opens");
} finally {
  const cleanup = `(() => {
    const source = h.findTab(${tabId});
    const top = source?.linkedBrowser.browsingContext?.top;
    if (!top) return;
    for (const win of h.browserWindows()) {
      for (const tab of h.windowTabs(win)) {
        if (tab.linkedBrowser?.browsingContext?.top?.opener?.top === top)
          win.gBrowser.removeTab(tab);
      }
    }
  })()`;
  await call("chrome_eval", { code: cleanup }).finally(() => call("tabs_close_mcp", { tabId }));
}
