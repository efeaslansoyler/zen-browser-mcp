// For live checks: runs code in a fixture tab's page as the check itself, not as an agent. Setup
// and inspection of fixtures must not go through javascript_tool, which asks the user in auto
// mode; the bridge's background query reaches the page without the agents' permission checks.
import { call } from "../../src/zen.ts";

export function fixtureTransportEnv() {
  const keys = [
    "XDG_RUNTIME_DIR",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "ZEN_MCP_SOCKET",
    "ZEN_MCP_BROWSER",
    "ZEN_MCP_PROFILE",
  ];
  const env = Object.fromEntries(keys.flatMap((key) => (process.env[key] ? [[key, process.env[key]!]] : [])));
  return { ...env, ZEN_MCP_CHANNEL: "0" };
}

export async function pageEval(tabId: number, code: string): Promise<string> {
  const result = await call("chrome_eval", {
    code: `(async () => {
      const browser = h.findTab(${tabId})?.linkedBrowser;
      if (!browser) throw new Error("Tab ${tabId} is closed.");
      return (await h.backgroundQuery(browser, "eval", { code: ${JSON.stringify(code)} }, browser.browsingContext)).value;
    })()`,
  });
  return result
    .filter((c) => c.type === "text")
    .map((c) => (c as { text: string }).text)
    .join("\n");
}

// Answers the island's permission card for a call the check makes on purpose (an action auto
// mode asks for), while the call runs: clicks Allow on the card whose message contains match.
export async function approveWhile<T>(running: Promise<T>, match: string): Promise<T> {
  let done = false;
  const settled = running.finally(() => {
    done = true;
  });
  const answering = (async () => {
    while (!done) {
      await call("chrome_eval", {
        code: `(() => {
          for (const win of Services.wm.getEnumerator("navigator:browser")) {
            const island = win.document.getElementById("zen-mcp-island");
            if (!island || island.hidden || island.getAttribute("state") !== "ask") continue;
            if (!island.querySelector(".message").textContent.includes(${JSON.stringify(match)})) continue;
            island.querySelector(".ok").click();
            return true;
          }
          return false;
        })()`,
      }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  })();
  try {
    return await settled;
  } finally {
    await answering;
  }
}
