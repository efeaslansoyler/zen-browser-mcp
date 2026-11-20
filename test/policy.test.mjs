import test from "node:test";
import assert from "node:assert/strict";
import * as policy from "../browser/Policy.sys.mjs";
import { permissions } from "../browser/Permissions.sys.mjs";
import { TabAccess } from "../browser/TabAccess.sys.mjs";
import { TOOLS } from "../src/tools.ts";

const { OPERATIONS, operationOf, ruleOf, parsePermissions, examplePermissions, COMPUTER_ACTIONS } = policy;

const actionsOf = (schema) =>
  schema.action?.options ?? (schema.action?.def?.entries && Object.keys(schema.action.def.entries)) ?? [];

test("every MCP tool and action is an operation of the permission templates", () => {
  for (const { name, inputSchema } of TOOLS) {
    const actions = actionsOf(inputSchema);
    for (const action of actions.length ? actions : [undefined]) {
      if (name === "browser_batch" || (name === "extensions" && action === "close")) continue;
      if (name === "computer") assert.ok(COMPUTER_ACTIONS[action], `computer action ${action} has no operation`);
      const key = operationOf(name, { action });
      assert.ok(key && OPERATIONS.has(key), `${name}${action ? "." + action : ""} has no operation`);
    }
  }
  assert.equal(operationOf("handle_dialog", { accept: true }), "handle_dialog.accept");
  assert.equal(operationOf("handle_dialog", { accept: false }), "handle_dialog.dismiss");
  assert.equal(operationOf("clipboard", { action: "cut" }), "clipboard.copy");
  assert.equal(operationOf("extensions", { action: "computer", computerAction: "screenshot" }), "extensions.read");
  assert.equal(operationOf("extensions", { action: "computer", computerAction: "left_click" }), "extensions.act");
});

test("ask asks every action, auto only the risky ones; custom overrides its base", () => {
  assert.equal(ruleOf("read_page", "ask"), "allow");
  assert.equal(ruleOf("computer.click", "ask"), "ask");
  assert.equal(ruleOf("computer.click", "auto"), "allow");
  for (const risky of [
    "javascript_tool",
    "file_upload",
    "submit",
    "secret_field",
    "handle_dialog.accept",
    "request_tab",
  ])
    assert.equal(ruleOf(risky, "auto"), "ask", risky);
  const custom = { base: "ask", rules: { navigate: "allow", javascript_tool: "deny" } };
  assert.equal(ruleOf("navigate", "custom", custom), "allow");
  assert.equal(ruleOf("javascript_tool", "custom", custom), "deny");
  assert.equal(ruleOf("computer.type", "custom", custom), "ask");
  assert.throws(() => ruleOf("computer.type", "custom", null), /custom permission template is missing/);
  assert.throws(() => ruleOf("nope", "auto"), /Unknown permission/);
});

test("permissions.jsonc takes comments and trailing commas, and refuses typos", () => {
  const parsed = parsePermissions(`// mine
    { "base": "ask", /* start strict */ "rules": { "navigate": "allow", } }`);
  assert.deepEqual(parsed, { base: "ask", rules: { navigate: "allow" } });
  assert.throws(() => parsePermissions('{"rules": {"javascript": "deny"}}'), /unknown operation "javascript"/);
  assert.throws(() => parsePermissions('{"rules": {"navigate": "yes"}}'), /must be "allow", "ask" or "deny"/);
  assert.throws(() => parsePermissions('{"base": "custom"}'), /base must be "ask" or "auto"/);
  assert.throws(() => parsePermissions("{"), /not valid JSON/);
  // why: A fixture with comment-like string contents makes sure JSONC stripping preserves the data.
  assert.equal(policy.stripJsonComments('{"a": "x // y /* z */"}'), '{"a": "x // y /* z */"}');
});

test("the example file lists every operation with its built-in rules and parses as auto", () => {
  const text = examplePermissions();
  for (const [key, { ask, auto }] of OPERATIONS)
    assert.match(text, new RegExp(`"${key.replace(".", "\\.")}":\\s+"${auto}",\\s+// \\(${ask} / ${auto}\\)`));
  const parsed = parsePermissions(text);
  assert.equal(parsed.base, "auto");
  for (const [key, rule] of Object.entries(parsed.rules)) assert.equal(rule, ruleOf(key, "auto"));
});

function harness({ mode = "auto", custom = null, risk = {} } = {}) {
  const asked = [];
  const queries = [];
  const access = new TabAccess();
  access.join(1, "s");
  const p = permissions({
    L: (en) => en,
    DialogOpen: class extends Error {},
    Stopped: class extends Error {},
    access,
    policy,
    readConfig: () => ({ mode, sites: { mode: "blocklist", blocklist: [], allowlist: [] } }),
    readPermissions: () => custom,
    rule: (key) => ruleOf(key, mode, custom),
    isSensitive: () => false,
    hostOf: (b) => b.currentURI.host,
    assertSiteAccess() {},
    holdsButtons: () => false,
    longRef: (x) => x,
    frameOf: () => "frame",
    heldFrame: () => null,
    focusedFrame: async () => "focused-frame",
    queryRef: async () => ({ value: 'button "Pay"' }),
    query: async (_browser, name, data, _timeout, frame) => {
      queries.push([name, data, frame]);
      return { value: risk };
    },
    describeAction: (tool) => tool,
    askIsland: async (_call, _browser, title, message) => {
      asked.push([title, message]);
      return "done";
    },
  });
  const call = { check() {}, agent: { name: "Claude" } };
  const browser = {
    browserId: 1,
    browsingContext: { currentWindowGlobal: {} },
    currentURI: { host: "shop.test", prePath: "https://shop.test" },
  };
  const run = (tool, args) => p.requirePermission(call, browser, [{ tool, args }]);
  return { p, call, run, asked, queries, browser };
}

test("auto asks before a click that submits a form, and before typing into a secret field", async () => {
  const submit = harness({ risk: { submit: true } });
  await submit.run("computer", { action: "left_click", ref: "ref_1" });
  assert.deepEqual(submit.queries[0], ["risk", { ref: "ref_1" }, "frame"]);
  assert.match(submit.asked[0][0], /asks for permission \(submits a form\)/);

  // why: Focus alone must not be mistaken for typing a secret.
  const field = harness({ risk: { secret: true } });
  assert.equal((await field.run("computer", { action: "left_click", ref: "ref_2" })).asked, false);

  const plain = harness({ risk: {} });
  assert.deepEqual(await plain.run("computer", { action: "left_click", ref: "ref_1" }).then((r) => r.asked), false);

  const secret = harness({ risk: { secret: true } });
  await secret.run("computer", { action: "type", text: "hunter2" });
  assert.deepEqual(secret.queries[0], ["risk", { focused: true, enter: false }, "focused-frame"]);
  assert.match(secret.asked[0][0], /secret field/);

  const enter = harness({ risk: { submit: true } });
  await enter.run("computer", { action: "key", text: "Return" });
  assert.deepEqual(enter.queries[0][1], { focused: true, enter: true, space: false });
  assert.equal(enter.asked.length, 1);
});

test("the page is only asked when submit or secret rules could change the answer", async () => {
  // why: A stricter risk query cannot change a call that will already ask.
  const ask = harness({ mode: "ask", risk: { submit: true } });
  await ask.run("computer", { action: "left_click", ref: "ref_1" });
  assert.equal(ask.queries.length, 0);
  assert.equal(ask.asked.length, 1);
  // why: Skip the risk query when the submit rule cannot make approval stricter.
  const free = harness({ mode: "custom", custom: { base: "auto", rules: { submit: "allow", secret_field: "allow" } } });
  await free.run("computer", { action: "left_click", ref: "ref_1" });
  assert.equal(free.queries.length, 0);
  assert.equal(free.asked.length, 0);
});

test("deny refuses without a prompt; custom allow and deny apply to their operations", async () => {
  const h = harness({
    mode: "custom",
    custom: { base: "auto", rules: { javascript_tool: "allow", navigate: "deny" } },
  });
  assert.equal((await h.run("javascript_tool", { text: "1" })).asked, false);
  await assert.rejects(
    h.run("navigate", { url: "https://x.test" }),
    /permission settings don't allow this \(navigate\)/,
  );
  assert.equal(h.asked.length, 0);
  assert.equal(h.p.gate("clipboard.read"), false);
  const open = harness({
    mode: "custom",
    custom: { base: "auto", rules: { "clipboard.read": "allow", request_tab: "deny" } },
  });
  assert.equal(open.p.gate("clipboard.read"), true);
  assert.throws(() => open.p.gate("request_tab"), /don't allow this \(request_tab\)/);
});

test("a call without a page follows its rule too", async () => {
  const h = harness({
    mode: "custom",
    custom: { base: "auto", rules: { tabs_context_mcp: "ask", downloads: "deny" } },
  });
  await h.p.requireToolPermission(h.call, "tabs_context_mcp", {});
  assert.equal(h.asked.length, 1);
  await assert.rejects(h.p.requireToolPermission(h.call, "downloads", {}), /\(downloads\)/);
  await h.p.requireToolPermission(h.call, "recipes", { action: "list" });
  assert.equal(h.asked.length, 1);
});

test("the page tells submit buttons, Enter in a form field and secret fields apart", async () => {
  const { PageReader, submitsForm, isSecretField } = await import("../browser/actors/PageReader.sys.mjs");
  const form = {};
  const el = (props) => ({
    getAttribute: (name) => props[name] ?? null,
    closest() {
      return ["button", "input"].includes(props.localName) ? this : (props.parent ?? null);
    },
    ...props,
  });
  const button = el({ localName: "button", type: "submit", form });
  assert.equal(submitsForm(button), true);
  assert.equal(submitsForm(el({ localName: "span", parent: button })), true);
  assert.equal(submitsForm(el({ localName: "button", type: "button", form })), false);
  assert.equal(submitsForm(el({ localName: "button", type: "submit", form: null })), false);
  assert.equal(submitsForm(el({ localName: "input", type: "image", form })), true);
  assert.equal(isSecretField(el({ localName: "input", type: "password" })), true);
  assert.equal(isSecretField(el({ localName: "input", type: "text", autocomplete: "cc-number" })), true);
  assert.equal(isSecretField(el({ localName: "input", type: "text", autocomplete: "email" })), false);

  let active = el({ localName: "input", type: "text", form });
  const reader = new PageReader({ document: () => ({ activeElement: active }), element: () => button });
  assert.deepEqual(reader.risk({ focused: true, enter: true }), { submit: true, secret: false });
  assert.deepEqual(reader.risk({ focused: true, space: true }), { submit: false, secret: false });
  active = el({ localName: "textarea", form });
  assert.deepEqual(reader.risk({ focused: true, enter: true }), { submit: false, secret: false });
  active = button;
  assert.deepEqual(reader.risk({ focused: true, space: true }), { submit: true, secret: false });
  assert.deepEqual(reader.risk({ ref: "ref_1" }), { submit: true, secret: false });
});

test("CLI: custom needs a valid permissions.jsonc, init writes the example once", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zen-perms-"));
  const file = path.join(directory, "zen-mcp/permissions.jsonc");
  const run = (...args) =>
    execFileSync(process.execPath, ["dist/cli.js", "config", ...args], {
      env: { ...process.env, XDG_CONFIG_HOME: directory, LANG: "en_US.UTF-8" },
      stdio: "pipe",
      encoding: "utf8",
    });
  try {
    assert.throws(() => run("mode", "custom"), /doesn't exist/);
    run("permissions", "init", "ask");
    assert.equal(parsePermissions(fs.readFileSync(file, "utf8")).base, "ask");
    assert.throws(() => run("permissions", "init"), /already exists/);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/("navigate": +)"ask"/, '$1"allow"'));
    assert.match(run("permissions"), /navigate: ask → allow/);
    assert.match(run("mode", "custom"), /mode: custom/);
    fs.writeFileSync(file, '{"rules": {"javascrpt_tool": "deny"}}');
    assert.throws(() => run("mode", "custom"), /unknown operation "javascrpt_tool"/);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});
