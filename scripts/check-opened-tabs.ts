import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { call, type Content } from "../src/zen.ts";

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
let childId: number | undefined;
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
  const result = records(await call("computer", { tabId, action: "left_click", ref }));
  const notice =
    result.find((row) => row.openedTabs)?.openedTabs ?? records(await call("tabs_context_mcp"))[0].openedTabs;
  childId = notice?.find((row: { sourceTabId: number }) => row.sourceTabId === tabId)?.tabId;
  assert(childId, "No matching opener notice");
  const delayedRef = tree.text.match(/button "Open after delay" \[(ref_\w+)\]/)?.[1];
  assert(delayedRef);
  await call("computer", { tabId, action: "left_click", ref: delayedRef });
  await sleep(350);
  const delayed = records(await call("tabs_context_mcp"))[0].openedTabs;
  assert(
    delayed?.some((row: { sourceTabId: number; tabId: number }) => row.sourceTabId === tabId && row.tabId !== childId),
    "No delayed opener notice",
  );
  console.log("OK: input result and delayed tab listing report verified openers");
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
