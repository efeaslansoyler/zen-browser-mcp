import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { call, type Content } from "../src/zen.ts";
import { pageEval } from "./support/fixture.ts";

const agent = { id: "codex", name: "Codex" };
const text = (content: Content[]) =>
  content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
const command = async (tool: string, args: object = {}) => text(await call(tool, args, 60_000, agent));

const nest = (levels: number, inner: string) => "<div>".repeat(levels) + inner + "</div>".repeat(levels);
const inner = `<!doctype html><body>${nest(80, "<button>Framed</button>")}`;
const page = `<!doctype html><title>Deep</title><p>Near</p>${nest(60, "<button>Deep</button><iframe src='/frame'></iframe>")}
${nest(60, '<span style="display:none">hidden</span>')}
${"<p>More</p>".repeat(100)}`;
const shallow = `<!doctype html><title>Shallow</title><p>Near</p>${nest(60, "<span hidden>hidden</span><script>0</script>")}`;
const wide = `<!doctype html><title>Wide</title>${"<p>Shallow paragraph</p>".repeat(200)}${nest(5, "<button>Deep</button>")}`;
const pages: Record<string, string> = { "/frame": inner, "/shallow": shallow, "/wide": wide };
const server = http.createServer((request, response) => {
  response.setHeader("content-type", "text/html; charset=utf-8").end(pages[request.url!] ?? page);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const tabs: number[] = [];
const notice = /\(depth \d+: deeper elements are left out/;

try {
  const { tabId } = JSON.parse((await command("tabs_create_mcp", { url: "about:blank" })).split("\n")[0]);
  tabs.push(tabId);
  await command("navigate", { tabId, url: origin });
  for (const filter of ["all", "interactive"]) {
    const read = await command("read_page", { tabId, filter });
    assert.match(read, /button "Deep"/);
    assert.match(read, /button "Framed"/);
    assert.doesNotMatch(read, notice);
  }
  console.log("✓ Without a depth, elements at any depth are read, in iframes too");

  const { tabId: wideTab } = JSON.parse((await command("tabs_create_mcp", { url: "about:blank" })).split("\n")[0]);
  tabs.push(wideTab);
  await command("navigate", { tabId: wideTab, url: `${origin}/wide` });
  for (const filter of ["all", "interactive"]) {
    const top = await command("read_page", { tabId, filter, depth: 30 });
    assert.match(top, notice);
    assert.doesNotMatch(top, /"Deep"|"Framed"/);
    const frame = await command("read_page", { tabId, filter, depth: 61 });
    assert.match(frame, /button "Deep"/);
    assert.match(frame, notice);
    assert.doesNotMatch(frame, /"Framed"/);
    assert(frame.search(notice) > frame.indexOf("[iframe"), frame);
    const whole = await command("read_page", { tabId, filter, depth: 100 });
    assert.match(whole, /"Framed"/);
    assert.doesNotMatch(whole, notice);
  }
  const cut = await command("read_page", { tabId, depth: 1, max_chars: 500 });
  assert.match(cut, notice);
  assert.match(cut, /truncated at 500 characters/);
  for (const max_chars of [500, 1500]) {
    const early = await command("read_page", { tabId: wideTab, depth: 2, max_chars });
    assert.match(early, notice);
    assert.match(early, /truncated at/);
  }
  const nothing = await command("read_page", { tabId, filter: "interactive", depth: 1 });
  assert.match(nothing, notice);
  assert.doesNotMatch(nothing, /no visible elements/);
  console.log("✓ A depth that leaves something out says so, where it happened");

  await command("navigate", { tabId, url: `${origin}/shallow` });
  assert.doesNotMatch(await command("read_page", { tabId, depth: 10 }), notice);
  console.log("✓ A depth that leaves out only hidden or empty elements doesn't");

  const times = [];
  // why: Gecko itself doesn't render the bottom of the deepest one; reading it must only not fail.
  for (const levels of [1000, 20000]) {
    await pageEval(
      tabId,
      `document.body.innerHTML = "<p>Near</p>"; let at = document.body; for (let i = 0; i < ${levels}; i++) at = at.appendChild(document.createElement("div")); at.innerHTML = "<button>Bottom</button>"; 0`,
    );
    const start = performance.now();
    assert.match(await command("read_page", { tabId }), levels === 1000 ? /button "Bottom"/ : /text "Near"/);
    times.push(Math.round(performance.now() - start));
  }
  assert(
    times.every((ms) => ms < 3000),
    `${times.join(", ")} ms`,
  );
  console.log(`✓ A page of 1,000 levels is read, one of 20,000 doesn't fail (${times.join(", ")} ms)`);
  console.log("All live depth checks passed.");
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  for (const tabId of tabs) await command("tabs_close_mcp", { tabId }).catch(console.error);
  server.close();
}
