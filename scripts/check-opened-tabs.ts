import assert from "node:assert/strict";
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
    "data:text/html," + encodeURIComponent('<a href="about:blank" target="_blank" rel="opener">Open fixture tab</a>');
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
  console.log("OK: click reports its spawned tab");
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
