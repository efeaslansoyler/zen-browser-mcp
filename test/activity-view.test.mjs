import test from "node:test";
import assert from "node:assert/strict";
import { formatLine, renderPage } from "../browser/ActivityView.sys.mjs";

const L = (en) => en;
const entry = (extra) => ({
  t: "2026-10-27T12:00:05.000Z",
  tool: "computer",
  session: "s1",
  agent: "Claude",
  tab: 5,
  host: "shop.test",
  ...extra,
});

test("a history line shows who, what, where it went and errors", () => {
  const line = formatLine(
    entry({ who: "S23 downloads · efe", what: 'button "Pay": click', to: "https://shop.test/done", error: "denied" }),
    L,
  );
  assert.match(line, /S23 downloads · efe — button "Pay": click → https:\/\/shop\.test\/done ✗ denied$/);
  // old entries: without title and description, the agent name and tool
  assert.match(
    formatLine({ t: "2026-10-27T12:00:05.000Z", tool: "computer", action: "screenshot", agent: "Codex" }, L),
    /Codex — computer screenshot$/,
  );
});

test("the history page groups by session, newest first, and escapes page-derived text", () => {
  const html = renderPage(
    [
      entry({ who: "Old", t: "2026-10-27T10:00:00.000Z", session: "a", doing: "reading the page" }),
      entry({
        who: "New <script>alert(1)</script>",
        session: "b",
        host: "<img src=x onerror=1>",
        what: 'type "</td><b>"',
      }),
    ],
    L,
    "/state/activity.jsonl",
  );
  assert(html.indexOf("New &lt;script&gt;") < html.indexOf("Old"));
  assert(!html.includes("<script>alert") && !html.includes("<img src=x") && !html.includes("</td><b>"));
  assert.match(html, /\/state\/activity\.jsonl/);
  assert.match(renderPage([], L), /Nothing yet/);
});
