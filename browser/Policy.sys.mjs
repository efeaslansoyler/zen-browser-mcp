export const RULES = ["allow", "ask", "deny"];
export const MODES = ["ask", "auto", "custom"];

// why: Section order matches the generated permissions file so it can be read in the same order.
const A = "allow";
const Q = "ask";
export const SECTIONS = [
  [
    "Reading and looking",
    [
      ["tabs_context_mcp", A, A, "List the agent's tabs and your open tabs (titles and addresses)."],
      ["read_page", A, A, "Read a page's structure and get element references."],
      ["find", A, A, "Find elements on a page by description."],
      ["get_page_text", A, A, "Read a page's text."],
      ["computer.screenshot", A, A, "Take screenshots of a page."],
      ["save_pdf", A, A, "Print an agent tab to a temporary local PDF."],
      ["record.start", A, A, "Start a short silent video of an agent tab."],
      ["record.stop", A, A, "Save a local video of an agent tab."],
      ["cookies.list", A, A, "Read first-party cookies in an agent browser profile."],
      ["storage.get", A, A, "Read a value from the tab's local or session storage in an agent browser profile."],
      ["computer.scroll", A, A, "Scroll a page or scroll an element into view."],
      ["computer.hover", A, A, "Move the pointer over an element (can open hover menus)."],
      ["computer.wait", A, A, "Wait a moment."],
      ["read_console_messages", A, A, "Read the page's console messages (can include data the page logs)."],
      [
        "read_network_requests",
        A,
        A,
        "Read the page's network requests (cookies and authorization headers are hidden).",
      ],
      ["network_capture.status", A, A, "Read the status of your HAR capture."],
      ["network_capture.stop", A, A, "Save your redacted HAR capture locally."],
      ["network_capture.cancel", A, A, "Discard your HAR capture."],
      ["web_vitals", A, A, "Read local performance metrics for the current page."],
      ["wait_for", A, A, "Wait for a page condition (text, element, URL)."],
      ["watch", A, A, "Watch a page for changes in the background."],
      ["downloads", A, A, "Follow downloads started in agent tabs."],
      ["extensions.read", A, A, "List extensions and read their open panels."],
      ["browser_settings.read", A, A, "Read a tab's viewport and emulation settings."],
      ["recipes", A, A, "List and read the recipes you recorded with show me once."],
    ],
  ],
  [
    "Talking to you and other agents",
    [
      ["ask_user", A, A, "Ask you a question on the island."],
      ["hand_to_user", A, A, "Hand you a step only you should do (logins, 2FA, payments)."],
      ["highlight", A, A, "Point out elements on a page with labelled frames."],
      ["show_me", A, A, "Ask you to show a task once and record it."],
      ["tab_work", A, A, "Tell the other agents in a shared tab what it is doing there, and read their notes."],
    ],
  ],
  [
    "Browser startup",
    [["browser.launch", Q, A, "Open the selected browser and profile when no matching bridge is running."]],
  ],
  [
    "Agent tabs",
    [
      ["tabs_create_mcp", A, A, "Open a new tab for the agent."],
      ["tabs_close_mcp", A, A, "Close one of the agent's tabs."],
      ["request_tab.agent_tab", Q, A, "Join a tab another agent works in (both then take turns in it)."],
    ],
  ],
  [
    "Acting on pages",
    [
      ["navigate", Q, A, "Go to an address, reload, or go back or forward."],
      ["computer.click", Q, A, "Click, right-click, double- or triple-click."],
      ["computer.drag", Q, A, "Drag, press or release a mouse button, move with a button held."],
      ["computer.type", Q, A, "Type text into the focused field."],
      ["computer.key", Q, A, "Press keys and shortcuts, or hold and release a key."],
      ["form_input", Q, A, "Set a form field's value, check or uncheck a box."],
      ["handle_dialog.dismiss", Q, A, "Dismiss a page's alert, confirm or prompt."],
      ["extensions.open", Q, A, "Open an extension's toolbar panel."],
      ["react", Q, A, "Inspect React components (and their props) with code run in the page."],
      ["accessibility", Q, A, "Run local axe accessibility checks with code run in the page."],
      ["cookies.set", Q, A, "Set a host-only cookie in an agent browser profile."],
      ["cookies.delete", Q, A, "Delete a host-only cookie in an agent browser profile."],
      ["storage.set", Q, A, "Set a value in the tab's local or session storage."],
      ["storage.remove", Q, A, "Remove a value from the tab's local or session storage."],
      ["storage.clear", Q, A, "Clear the tab's local or session storage."],
    ],
  ],
  [
    "Risky actions",
    [
      [
        "submit",
        Q,
        Q,
        "Submit a form: click a submit button, or press Enter or Space where that submits. Purchases, messages and deletions usually go through forms.",
      ],
      ["secret_field", Q, Q, "Type into a password, card or one-time-code field. Prefer hand_to_user for these."],
      ["javascript_tool", Q, Q, "Run any JavaScript in the page: it can read everything on the page and act as you."],
      ["network_capture.start", Q, Q, "Start recording network traffic for a local HAR."],
      ["network_capture.attach", Q, Q, "Include an owned tab in the HAR capture."],
      ["network_control.block", Q, Q, "Block matching HTTP requests in an agent-opened tab."],
      ["network_control.mock", Q, Q, "Replace matching HTTP responses in an agent-opened tab."],
      ["network_control.offline", Q, Q, "Simulate offline HTTP requests in an agent-opened tab."],
      ["network_control.clear", Q, Q, "Clear the HTTP rules in an agent-opened tab."],
      ["file_upload", Q, Q, "Upload files from your computer to a page."],
      ["handle_dialog.accept", Q, Q, 'Accept a page\'s confirm or prompt ("Delete this?" → OK).'],
      ["extensions.act", Q, Q, "Click or type inside an extension's panel (password managers, wallets…)."],
    ],
  ],
  [
    "Your things",
    [
      ["request_tab", Q, Q, "Take one of your own tabs to work in it."],
      ["clipboard.read", Q, Q, "Read your system clipboard (shared with your other applications)."],
      ["clipboard.write", Q, Q, "Replace your system clipboard with text."],
      ["clipboard.copy", Q, Q, "Copy or cut a selection on the page to your system clipboard."],
      ["clipboard.paste", Q, Q, "Paste your system clipboard into a page."],
      ["browser_settings.change", Q, Q, "Change a tab's viewport, device emulation or color scheme."],
      ["extensions.switch_tab", Q, Q, "Select another tab so an extension can work on it (changes your view)."],
      ["recipes.delete", Q, Q, "Delete one of your recipes."],
    ],
  ],
];

export const OPERATIONS = new Map(
  SECTIONS.flatMap(([, rows]) => rows.map(([key, ask, auto, about]) => [key, { ask, auto, about }])),
);

export const READS = new Set(SECTIONS[0][1].map(([key]) => key));

export const COMPUTER_ACTIONS = {
  screenshot: "computer.screenshot",
  scroll: "computer.scroll",
  scroll_to: "computer.scroll",
  hover: "computer.hover",
  wait: "computer.wait",
  left_click: "computer.click",
  right_click: "computer.click",
  double_click: "computer.click",
  triple_click: "computer.click",
  left_click_drag: "computer.drag",
  mouse_down: "computer.drag",
  mouse_up: "computer.drag",
  mouse_move: "computer.drag",
  type: "computer.type",
  key: "computer.key",
  key_down: "computer.key",
  key_up: "computer.key",
};

// why: Check each batch step under its own operation instead of applying a coarse batch approval.
export function operationOf(tool, args = {}) {
  const key = operationKey(tool, args);
  return key && OPERATIONS.has(key) ? key : null;
}

function operationKey(tool, args) {
  switch (tool) {
    case "network_capture":
    case "network_control":
    case "cookies":
    case "storage":
    case "record":
      return `${tool}.${args.action}`;
    case "browser_batch":
      return null;
    case "computer":
      return COMPUTER_ACTIONS[args.action] ?? "computer.click";
    case "clipboard":
      return args.action === "cut" ? "clipboard.copy" : `clipboard.${args.action}`;
    case "extensions":
      if (args.action === "close") return null;
      if (args.action === "open") return "extensions.open";
      if (args.action === "form_input") return "extensions.act";
      if (args.action === "computer")
        return ["screenshot", "scroll", "scroll_to", "hover", "wait"].includes(args.computerAction)
          ? "extensions.read"
          : "extensions.act";
      return "extensions.read";
    case "browser_settings":
      return ["get", "devices"].includes(args.action) ? "browser_settings.read" : "browser_settings.change";
    case "handle_dialog":
      return args.accept ? "handle_dialog.accept" : "handle_dialog.dismiss";
    case "recipes":
      return args.action === "delete" ? "recipes.delete" : "recipes";
  }
  return tool;
}

const STRICTNESS = { allow: 0, ask: 1, deny: 2 };
// why: A call that both clicks and submits must satisfy the stricter action rule.
export const strictest = (...rules) => rules.reduce((a, b) => (STRICTNESS[b] > STRICTNESS[a] ? b : a), "allow");

export function ruleOf(key, mode = "auto", custom = null) {
  const operation = OPERATIONS.get(key);
  if (!operation) throw new Error(`Unknown permission: ${key}`);
  if (mode === "custom") {
    if (!custom) throw new Error("The custom permission template is missing (permissions.jsonc).");
    return custom.rules[key] ?? operation[custom.base];
  }
  return operation[mode === "ask" ? "ask" : "auto"];
}

export function autonomousRule(key, rule) {
  if (key.startsWith("clipboard.")) return "deny";
  return rule === "ask" ? "allow" : rule;
}

export function assertUserPresent(autonomous, tool) {
  if (autonomous && (tool === "ask_user" || tool === "hand_to_user" || tool === "show_me"))
    throw new Error("no user is present (autonomous browser mode)");
}

// why: Reject misspelled operations and rules so a typo cannot silently leave a default in effect.
export function parsePermissions(text) {
  let raw;
  try {
    raw = JSON.parse(stripJsonComments(text));
  } catch (e) {
    throw new Error(`permissions.jsonc is not valid JSON: ${e.message}`, { cause: e });
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("permissions.jsonc must be an object.");
  const base = raw.base ?? "auto";
  if (base !== "ask" && base !== "auto")
    throw new Error(`permissions.jsonc: base must be "ask" or "auto", not ${JSON.stringify(base)}.`);
  const rules = {};
  for (const [key, rule] of Object.entries(raw.rules ?? {})) {
    if (!OPERATIONS.has(key)) throw new Error(`permissions.jsonc: unknown operation "${key}".`);
    if (!RULES.includes(rule))
      throw new Error(`permissions.jsonc: "${key}" must be "allow", "ask" or "deny", not ${JSON.stringify(rule)}.`);
    rules[key] = rule;
  }
  return { base, rules };
}

export function stripJsonComments(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

export function examplePermissions(base = "auto") {
  const width = Math.max(...[...OPERATIONS.keys()].map((key) => key.length)) + 4;
  const lines = [
    '// zen-browser-mcp: your own permission template. It is used when the mode is "custom"',
    "// (`zen-browser-mcp config mode custom`, the island or the tab menu).",
    "//",
    '// base: the built-in template you start from, "ask" or "auto". Rules below override it:',
    '//   "allow"  the agent does it without asking',
    '//   "ask"    you approve it on the island, or in the MCP client for browser.launch',
    '//   "deny"   the agent is refused',
    "// Autonomous browsers allow ask rules inside the bridge, deny system clipboard access,",
    "// and keep custom deny and site rules. Startup approval still happens in the MCP client.",
    "// Delete a line to keep the base template's rule. The comment after each line shows the",
    "// built-in rules as (ask template / auto template).",
    "//",
    '// You decide here. "allow" on a risky operation means an agent, or a page that tricks it',
    "// (prompt injection), can do it with your logins without you seeing a question first.",
    "// Sites the agent may not use at all are set separately: `config site …`.",
    "{",
    `  "base": "${base}",`,
    '  "rules": {',
  ];
  for (const [section, rows] of SECTIONS) {
    lines.push("", `    // ── ${section} ──`);
    for (const [key, ask, auto, about] of rows) {
      const rule = base === "ask" ? ask : auto;
      lines.push(
        `    ${`"${key}":`.padEnd(width)}"${rule}",${" ".repeat(7 - rule.length)}// (${ask} / ${auto}) ${about}`,
      );
    }
  }
  lines.push("  }", "}", "");
  return lines.join("\n");
}
