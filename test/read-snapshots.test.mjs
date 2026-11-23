import test from "node:test";
import assert from "node:assert/strict";
import { readTools } from "../browser/ReadTools.sys.mjs";
import { ReadSnapshots, linePatch } from "../browser/ReadSnapshots.sys.mjs";
import { bridgeContext } from "./support/bridge.mjs";
const context = () => ({ url: "https://fixture.test/", ownerVersion: 1, frames: [[1, {}]] });
const id = (value) => value.match(/^snapshot: (\S+)/)[1];
const body = (value) => value.slice(value.indexOf("\n\n") + 2);
const longText = Array.from({ length: 100 }, (_, i) => `${i}: ${"visible page content ".repeat(4)}`).join("\n");
function fixture(options) {
  const snapshots = new ReadSnapshots(options),
    document = context();
  const render = (text, extra = {}) =>
    snapshots.render({
      session: "A",
      tabId: 1,
      scope: ["read_page", "all", 30, null, 50000],
      context: document,
      text,
      diff: true,
      ...extra,
    });
  return { snapshots, document, render };
}
function applyPatch(before, patch) {
  const old = before.split("\n"),
    output = [];
  let cursor = 0;
  for (const line of patch.split("\n")) {
    const header = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(line);
    if (header) {
      const at = Number(header[1]) - (Number(header[2]) ? 1 : 0);
      assert(at >= cursor);
      output.push(...old.slice(cursor, at));
      cursor = at;
    } else if (line[0] === "+") output.push(line.slice(1));
    else if (line[0] === "-" || line[0] === " ") {
      assert.equal(old[cursor++], line.slice(1), "Patch must match the exact baseline");
      if (line[0] === " ") output.push(line.slice(1));
    } else assert.fail(`Invalid patch line: ${line}`);
  }
  output.push(...old.slice(cursor));
  return output.join("\n");
}

test("legacy reads retain exact text and do not build a hidden baseline", () => {
  const { snapshots, render } = fixture();
  assert.equal(render(longText, { diff: false }), longText);
  assert.equal(snapshots.entries.size, 0);
});

test("first opt-in read is full; unchanged is compact and retains the snapshot ID", () => {
  const { render } = fixture();
  const full = render(longText);
  assert.match(full, /mode: full \(no-baseline\)/);
  assert.equal(body(full), longText);
  const same = render(longText, { since: id(full) });
  assert.match(same, /mode: unchanged/);
  assert.equal(id(same), id(full));
  assert(same.length < full.length / 10);
});

test("small distant edits produce a smaller exact patch with usable refs", () => {
  const { render } = fixture();
  const full = render(longText);
  const changed = longText.replace("4: ", "button [ref_41] new label ").replace("94: ", "94: updated ");
  const delta = render(changed, { since: id(full) });
  assert.match(delta, /mode: diff/);
  assert(delta.includes("[ref_41]"));
  assert(delta.length < full.length / 4);
  assert.equal(applyPatch(longText, body(delta)), changed);
  assert.match(render(changed, { since: id(delta) }), /unchanged/);
});

test("unified patches reconstruct insertions, deletions, empty lines and Unicode", () => {
  for (const [before, after] of [
    ["", "x"],
    ["x", ""],
    ["a\nb\nc", "a\nx\nb\nc"],
    ["a\nb\nc", "a\nc"],
    ["a\na\na", "a\nb\na"],
    ["a\n", "\na"],
    ["İstanbul\n🧭\n末尾", "İzmir\n🧭\n末尾\n"],
    ["@@\n---\n+++", "+++\n@@\n---"],
  ])
    assert.equal(applyPatch(before, linePatch(before, after)), after);
});

test("seeded randomized line edits reconstruct the exact new text", () => {
  let seed = 17;
  const random = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  for (let sample = 0; sample < 500; sample++) {
    const before = Array.from({ length: 2 + random(40) }, () => ["a", "b", "", "🧭", "[ref_1]", "z"][random(6)]).join(
      "\n",
    );
    const lines = before.split("\n");
    for (let edit = 0; edit < 1 + random(8); edit++)
      lines.splice(
        random(lines.length + 1),
        random(3),
        ...Array.from({ length: random(3) }, () => ["x", "b", "", "ç"][random(4)]),
      );
    const after = lines.join("\n");
    if (before !== after) assert.equal(applyPatch(before, linePatch(before, after)), after, `sample ${sample}`);
  }
});

test("unknown, missing, old and cross-scope base IDs cause a fresh full response", () => {
  const { render } = fixture();
  const first = render(longText),
    second = render(longText.replace("0:", "changed:"), { since: id(first) });
  assert.match(render(longText, { since: id(first) }), /full \(base-unavailable\)/);
  assert.match(render(longText), /full \(no-base-id\)/);
  for (const extra of [
    { session: "B" },
    { tabId: 2 },
    { scope: ["get_page_text"] },
    { scope: ["read_page", "interactive"] },
  ]) {
    assert.match(render(longText, { since: id(second), ...extra }), /full \(no-baseline\)/);
  }
});

test("same URL document replacement, iframe replacement and owner changes reset the baseline", () => {
  for (const changed of [
    (ctx) => ({ ...ctx, frames: [[1, {}]] }),
    (ctx) => ({ ...ctx, frames: [...ctx.frames, [2, {}]] }),
    (ctx) => ({ ...ctx, ownerVersion: 3 }),
    (ctx) => ({ ...ctx, url: ctx.url + "next" }),
  ]) {
    const { render, document } = fixture();
    const first = render(longText);
    assert.match(
      render(longText, { since: id(first), context: changed(document) }),
      /full \(document-or-owner-changed\)/,
    );
  }
});

test("navigation during a read throws and discards tab snapshots", () => {
  const { render, snapshots } = fixture();
  render(longText);
  assert.throws(() => render(longText, { currentContext: context() }), /changed while reading/);
  assert.equal(snapshots.entries.size, 0);
});

test("budget exhaustion and expensive patches fall back to full text", () => {
  const { render } = fixture({ budget: 0 });
  const first = render(longText);
  assert.match(render(longText.replace("0:", "updated:"), { since: id(first) }), /full \(diff-budget\)/);
  const small = fixture();
  const tiny = small.render("a");
  assert.match(small.render("b", { since: id(tiny) }), /full \(diff-larger\)/);
});

test("cache has bounded size, LRU eviction and explicit lifecycle cleanup", () => {
  const { render, snapshots } = fixture({ maxEntries: 2, maxChars: 1000 });
  const first = render("first");
  render("second", { tabId: 2 });
  render("first", { since: id(first) });
  render("third", { tabId: 3 });
  assert.equal(snapshots.entries.size, 2);
  assert.match(render("second", { tabId: 2, since: "old" }), /no-baseline/);
  snapshots.clearTab(2);
  assert.equal(snapshots.entries.size, 1);
  snapshots.clearSession("A");
  assert.equal(snapshots.entries.size, 0);
  assert.equal(snapshots.chars, 0);
  const capped = fixture({ maxChars: 12 });
  capped.render("12345678");
  capped.render("abcdefgh", { tabId: 2 });
  assert(capped.snapshots.chars <= 12);
});

test("oversized reads are returned in full without caching or diffing", () => {
  const { render, snapshots } = fixture({ maxSnapshotChars: 10 });
  const full = render(longText);
  assert.match(full, /mode: full \(not-cached/);
  assert.equal(body(full), longText);
  assert.equal(snapshots.entries.size, 0);
});

// why: Run through the real parent tools so the test also covers diff context capture.
function parentHarness() {
  const browser = { browserId: 1, currentURI: { spec: "https://fixture.test/" }, browsingContext: {} };
  browser.browsingContext.currentWindowGlobal = {};
  browser.browsingContext.id = 1;
  const snapshots = new ReadSnapshots();
  let page = longText;
  const context = bridgeContext({
    assertSiteAccess() {},
    readSnapshots: snapshots,
    activeSession: "A",
    access: { version: () => 1, check() {} },
    MAX_PAGE_TEXT: 100000,
    browserFor: () => browser,
    framesOf: () => [browser.browsingContext],
    frameOf: () => browser.browsingContext,
    expandFrames: async (_, value) => value,
    text: (value) => [{ type: "text", text: value }],
    query: async (_, name) =>
      name === "text" ? { title: "Fixture", url: browser.currentURI.spec, text: page } : { value: page },
  });
  // why: Construct the tool per call so tests can replace captured context helpers.
  const read = async (name, args = {}) => (await readTools(context)[name]({ tabId: 1, ...args }))[0].text;
  return {
    context,
    browser,
    read,
    change: (value) => {
      page = value;
    },
  };
}

test("real read tools preserve plain output and separately cache text/tree/options", async () => {
  const h = parentHarness();
  assert.equal(await h.read("read_page"), longText);
  assert.equal(await h.read("get_page_text"), `Fixture\nhttps://fixture.test/\n\n${longText}`);
  const tree = await h.read("read_page", { diff: true });
  assert.match(await h.read("get_page_text", { diff: true, since: id(tree) }), /full \(no-baseline\)/);
  assert.match(
    await h.read("read_page", { diff: true, since: id(tree), filter: "interactive" }),
    /full \(no-baseline\)/,
  );
  h.change(longText.replace("50:", "updated:"));
  const delta = await h.read("read_page", { diff: true, since: id(tree) });
  assert.equal(applyPatch(longText, body(delta)), longText.replace("50:", "updated:"));
  h.browser.browsingContext.currentWindowGlobal = {};
  assert.match(await h.read("read_page", { diff: true, since: id(delta) }), /document-or-owner-changed/);
});

test("tab access is checked again before an output baseline can be saved", async () => {
  const h = parentHarness();
  h.context.access.check = () => {
    throw new Error("access changed");
  };
  await assert.rejects(h.read("read_page", { diff: true }), /access changed/);
  assert.equal(h.context.readSnapshots.entries.size, 0);
});

test("a long first line obeys the character limit and the delta covers only returned text", async () => {
  const h = parentHarness();
  h.change("x".repeat(1000));
  const first = await h.read("read_page", { max_chars: 50, diff: true });
  assert.equal(body(first).split("\n")[0], "x".repeat(50));
  assert(body(first).length < 200);
  h.change("x".repeat(999) + "y");
  assert.match(await h.read("read_page", { max_chars: 50, diff: true, since: id(first) }), /mode: unchanged/);
});

test("the real read tool refuses a baseline if navigation occurs during the query", async () => {
  const h = parentHarness();
  h.context.query = async () => {
    h.browser.browsingContext.currentWindowGlobal = {};
    return { value: longText };
  };
  await assert.rejects(h.read("read_page", { diff: true }), /changed while reading/);
  assert.equal(h.context.readSnapshots.entries.size, 0);
});
