import test from "node:test";
import assert from "node:assert/strict";
import { Watches } from "../browser/Watches.sys.mjs";

// a manually advanced clock and an events file that collects lines
function harness() {
  const timers = [];
  const lines = [];
  const page = { found: false, value: "a", owned: true, blocked: false };
  const browser = { currentURI: { spec: "https://shop.test/" } };
  const watches = new Watches({
    events: {
      path: (name) => `/tmp/watch-${name}.jsonl`,
      append: (file, line, { last = false } = {}) => lines.push({ file, ...line, last }),
    },
    owned: () => (page.owned ? browser : null),
    check: async () => page.found,
    sample: async () => page.value,
    assertSite: () => {
      if (page.blocked) throw new Error("Site access blocked by user rule: shop.test");
    },
    setTimeout: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout: () => {},
  });
  const tick = async () => {
    const fn = timers.shift();
    if (fn) {
      fn();
      await new Promise((r) => setImmediate(r));
    }
  };
  return { watches, page, browser, lines, tick, events: () => lines.map((l) => l.event) };
}

test("a condition watch reports the first match and ends", async () => {
  const h = harness();
  const w = h.watches.start("s", 1, h.browser, { text: "Live" });
  await h.tick();
  await h.tick();
  assert.deepEqual(h.events(), ["started"]);
  h.page.found = true;
  await h.tick();
  assert.deepEqual(h.events(), ["started", "matched"]);
  assert.equal(h.lines.at(-1).final, true);
  assert.equal(h.lines.at(-1).last, true);
  assert.deepEqual(h.watches.forSession("s"), []);
  assert.equal(w.events, "/tmp/watch-1.jsonl");
});

test("repeat reports each new match, not every check while it stays true", async () => {
  const h = harness();
  h.watches.start("s", 1, h.browser, { selector: ".badge", repeat: true });
  h.page.found = true;
  await h.tick();
  await h.tick();
  await h.tick();
  h.page.found = false;
  await h.tick();
  h.page.found = true;
  await h.tick();
  assert.deepEqual(h.events(), ["started", "matched", "matched"]);
  // gone inverts
  const g = harness();
  g.page.found = true;
  g.watches.start("s", 1, g.browser, { text: "Loading", gone: true });
  await g.tick();
  g.page.found = false;
  await g.tick();
  assert.deepEqual(g.events(), ["started", "matched"]);
});

test("change reports old and new values from the first sample on", async () => {
  const h = harness();
  h.watches.start("s", 1, h.browser, { selector: ".price", change: true });
  await h.tick();
  h.page.value = "b";
  await h.tick();
  await h.tick();
  h.page.value = null;
  await h.tick();
  const changes = h.lines.filter((l) => l.event === "changed").map((l) => [l.previous, l.value]);
  assert.deepEqual(changes, [
    ["a", "b"],
    ["b", null],
  ]);
});

test("a watch ends when its tab is lost, the site is blocked, on stop and per session", async () => {
  const h = harness();
  h.watches.start("s", 1, h.browser, { text: "x" });
  h.page.owned = false;
  await h.tick();
  assert.equal(h.lines.at(-1).reason, "tab closed or no longer owned by this session");
  const b = harness();
  b.watches.start("s", 1, b.browser, { text: "x" });
  b.page.blocked = true;
  await b.tick();
  assert.match(b.lines.at(-1).reason, /blocked/);
  const s = harness();
  s.watches.start("a", 1, s.browser, { text: "x" });
  s.watches.start("b", 2, s.browser, { text: "y" });
  s.watches.endSession("a", "session ended");
  assert.deepEqual(s.watches.forSession("a"), []);
  assert.equal(s.watches.forSession("b").length, 1);
  s.watches.endAll("stopped by the user");
  assert.equal(s.lines.at(-1).reason, "stopped by the user");
});

test("invalid specs and too many watches are refused", () => {
  const h = harness();
  assert.throws(() => h.watches.start("s", 1, h.browser, {}), /required/);
  assert.throws(() => h.watches.start("s", 1, h.browser, { change: true }), /needs a selector/);
  for (let i = 0; i < 10; i++) h.watches.start("s", 1, h.browser, { text: `t${i}` });
  assert.throws(() => h.watches.start("s", 1, h.browser, { text: "one more" }), /At most 10/);
  const summary = Watches.summary(h.watches.forSession("s")[0]);
  assert.deepEqual(Object.keys(summary).sort(), ["endsAt", "events", "id", "interval", "tabId", "text"]);
});
