import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { call, type Content } from "../src/zen.ts";
import { pageEval } from "./support/fixture.ts";
import "./support/require-sandbox.ts";

const agent = { id: "codex", name: "Codex" };
const text = (content: Content[]) =>
  content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
const command = async (tool: string, args: object = {}) => text(await call(tool, args, 60_000, agent));

const page = (label: string) =>
  `<!doctype html><title>${label}</title><button onclick="top.hits.push('${label}')">${label}</button><input aria-label="Field ${label}"><script>top.hits??=[]</script>`;
const server = http.createServer((request, response) => {
  response.setHeader("content-type", "text/html; charset=utf-8");
  const path = request.url!.slice(1);
  response.end(
    path === "frame"
      ? `<!doctype html><title>Frame</title><script>hits=[]</script><iframe src="/Safe" width="400" height="200"></iframe>`
      : page(path),
  );
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const tabs: number[] = [];
const open = async (path: string): Promise<[number, string]> => {
  const tabId = JSON.parse((await command("tabs_create_mcp", { url: "about:blank" })).split("\n")[0]).tabId;
  tabs.push(tabId);
  return [tabId, await command("navigate", { tabId, url: origin + path, read: "interactive" })];
};
const refOf = (output: string, label: string) => {
  const ref = output.match(new RegExp(`"${label}" \\[([^\\]]+)\\]`))?.[1];
  assert(ref, `No ref for ${label} in:\n${output}`);
  return ref;
};
const click = (tabId: number, ref: string) => command("computer", { tabId, action: "left_click", ref });
const read = (tabId: number) => command("read_page", { tabId, filter: "interactive" });
const hits = async (tabId: number) => JSON.parse(await pageEval(tabId, "JSON.stringify(top.hits)"));
const refused = async (tabId: number, label: string, button: string, field: string) => {
  await assert.rejects(click(tabId, button), /not found/, `${label}: click`);
  await assert.rejects(command("form_input", { tabId, ref: field, value: "x" }), /not found/, `${label}: form_input`);
  await assert.rejects(command("read_page", { tabId, ref_id: button }), /not found/, `${label}: read_page`);
};

try {
  const [tabId, first] = await open("/Safe");
  const [safe, safeField] = [refOf(first, "Safe"), refOf(first, "Field Safe")];
  assert.match(await command("computer", { tabId, action: "screenshot", annotate: true }), new RegExp(`${safe}\\b`));
  await click(tabId, safe);
  assert.deepEqual(await hits(tabId), ["Safe"]);

  const second = await command("navigate", { tabId, url: `${origin}/Reset`, read: "interactive" });
  const [reset, resetField] = [refOf(second, "Reset"), refOf(second, "Field Reset")];
  await refused(tabId, "after a navigation", safe, safeField);
  assert.deepEqual(await hits(tabId), []);
  await click(tabId, reset);
  assert.deepEqual(await hits(tabId), ["Reset"]);
  console.log("✓ A ref from before a navigation sends no input; the new page's refs work");

  await command("navigate", { tabId, url: "back" });
  await read(tabId);
  await refused(tabId, "after going back", reset, resetField);
  assert(!(await hits(tabId)).includes("Reset"));
  const restored = await read(tabId);
  await click(tabId, refOf(restored, "Safe"));
  await command("navigate", { tabId, url: "forward" });
  await read(tabId);
  await refused(tabId, "after going forward", safe, safeField);
  console.log("✓ Back and forward don't mix up the refs of the two pages");

  const beforeReload = await read(tabId);
  await pageEval(tabId, "window.old = true; setTimeout(() => location.reload()); true");
  for (let i = 0; i < 100 && (await pageEval(tabId, "!!window.old").catch(() => "true")) !== "false"; i++)
    await sleep(50);
  await read(tabId);
  await refused(tabId, "after a reload", refOf(beforeReload, "Reset"), refOf(beforeReload, "Field Reset"));
  console.log("✓ A ref from before a reload is refused");

  const [framed, frameRead] = await open("/frame");
  const [frameSafe, frameField] = [refOf(frameRead, "Safe"), refOf(frameRead, "Field Safe")];
  await click(framed, frameSafe);
  assert.deepEqual(await hits(framed), ["Safe"]);
  await pageEval(framed, "document.querySelector('iframe').src='/Reset'");
  await command("wait_for", { tabId: framed, text: "Reset" });
  assert.match(await read(framed), /"Reset"/);
  await refused(framed, "after an iframe navigation", frameSafe, frameField);
  assert.deepEqual(await hits(framed), ["Safe"]);
  await click(framed, refOf(await read(framed), "Reset"));
  assert.deepEqual(await hits(framed), ["Safe", "Reset"]);
  console.log("✓ The same holds for an iframe that navigates inside a page that stays");

  await pageEval(
    framed,
    `(()=>{const f=document.body.appendChild(document.createElement("iframe"));f.id="late";f.contentDocument.body.innerHTML='<button>Early</button>'})()`,
  );
  const early = refOf(await read(framed), "Early");
  await pageEval(framed, "document.getElementById('late').src='/Late'");
  await command("wait_for", { tabId: framed, text: "Late" });
  const late = refOf(await read(framed), "Late");
  await refused(framed, "after the initial blank document", early, early);
  await click(framed, late);
  assert.deepEqual(await hits(framed), ["Safe", "Reset", "Late"]);
  console.log("✓ A ref from an iframe's initial blank document is refused once its page loads");

  await read(tabId);
  await refused(tabId, "from another tab", late, late);
  console.log("✓ A ref from another tab is refused");
  console.log("All live stale ref checks passed.");
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  for (const tabId of tabs) await command("tabs_close_mcp", { tabId }).catch(console.error);
  server.close();
}
