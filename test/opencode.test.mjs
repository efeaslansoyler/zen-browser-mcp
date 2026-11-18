import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  openCodePlugin,
  openCodeSocket,
  pushToOpenCode,
  configureOpenCodePlugin,
  openCodePluginInstalled,
  openCodePluginSource,
} from "../src/opencode.ts";

const pid = 900000 + Math.floor(Math.random() * 90000); // a socket name no real OpenCode uses

test("the OpenCode plugin prompts the last session with what the MCP process pushes", async () => {
  const prompts = [];
  const client = {
    session: {
      async promptAsync(options) {
        prompts.push(options);
        return {};
      },
    },
  };
  const servers = [];
  const asked = [];
  const browser = async (tool, args) => {
    asked.push([tool, args]);
    return [{ type: "text", text: asked.length === 1 ? "The user sent you this…" : "" }];
  };
  // a socket left by a killed OpenCode is removed
  const stale = path.join(path.dirname(openCodeSocket(pid)), "999999999.sock");
  fs.mkdirSync(path.dirname(stale), { recursive: true });
  fs.writeFileSync(stale, "");
  const hooks = await openCodePlugin({ client }, browser, pid, servers);
  assert.equal(fs.existsSync(stale), false);
  try {
    // no session yet: refused, so it waits in the inbox
    assert.equal(await pushToOpenCode("early", pid), false);
    // the user's next message carries what waited
    const output = { parts: [{ type: "text", text: "hi" }] };
    const model = { providerID: "p", modelID: "m" };
    await hooks["chat.message"]({ sessionID: "ses_1", agent: "build", model }, output);
    assert.equal(output.parts[0].text, "hi\n\nThe user sent you this…");
    assert.deepEqual(asked[0], ["inbox_take", { client: "opencode", pids: [pid] }]);
    // now pushes become prompts in that session, with its agent and model
    assert.equal(await pushToOpenCode("[zen] picked ü", pid), true);
    assert.deepEqual(prompts, [
      { path: { id: "ses_1" }, body: { parts: [{ type: "text", text: "[zen] picked ü" }], agent: "build", model } },
    ]);
  } finally {
    for (const server of servers) server.close();
  }
  // nothing listens: refused
  assert.equal(await pushToOpenCode("late", pid), false);
});

test("hooks install writes the OpenCode plugin and uninstall removes only ours", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zen-opencode-"));
  const file = path.join(dir, "plugins", "zen-browser.js");
  assert.equal(openCodePluginInstalled(file), false);
  configureOpenCodePlugin("install", file);
  assert.equal(openCodePluginInstalled(file), true);
  assert.match(openCodePluginSource(), /import \{ openCodePlugin \} from ".*dist\/opencode\.js"/);
  configureOpenCodePlugin("uninstall", file);
  assert.equal(fs.existsSync(file), false);
  fs.writeFileSync(file, "export const Mine = async () => ({});\n");
  configureOpenCodePlugin("uninstall", file);
  assert.equal(fs.existsSync(file), true);
});
