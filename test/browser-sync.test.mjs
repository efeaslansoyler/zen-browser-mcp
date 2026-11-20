import test from "node:test";
import assert from "node:assert/strict";
import { syncBrowserFiles } from "../dist/install.js";
import { VERSION } from "../dist/paths.js";

function fakes(running) {
  const calls = [];
  let copied = 0;
  const request = async (tool) => {
    calls.push(tool);
    if (tool === "ping") {
      if (running === null) throw new Error("no browser");
      return [{ type: "text", text: JSON.stringify({ version: running }) }];
    }
    return [];
  };
  return { calls, copy: () => copied++, copied: () => copied, request };
}

test("new package files are copied and a bridge running old files is reloaded", async () => {
  const f = fakes("0.0.1");
  await syncBrowserFiles({ installed: "0.0.1", copy: f.copy, request: f.request });
  assert.equal(f.copied(), 1);
  assert.deepEqual(f.calls, ["ping", "reload"]);
});

test("a browser still on old files is reloaded even when another one already copied them", async () => {
  const f = fakes("0.0.1");
  await syncBrowserFiles({ installed: VERSION, copy: f.copy, request: f.request });
  assert.equal(f.copied(), 0);
  assert.deepEqual(f.calls, ["ping", "reload"]);
});

test("a current bridge, no browser, or a development link is left alone", async () => {
  for (const [installed, running] of [
    [VERSION, VERSION],
    [VERSION, null],
    ["dev", "0.0.1"],
    [null, "0.0.1"],
  ]) {
    const f = fakes(running);
    await syncBrowserFiles({ installed, copy: f.copy, request: f.request });
    assert.equal(f.copied(), 0);
    assert(!f.calls.includes("reload"), `${installed}/${running}`);
  }
});
