"""Evaluate Zen workflows and Codex token usage with isolated loopback fixtures.

Run after npm run build. Use an extracted Zen installation and a new scratch output directory.
Use --self-test to check the trace parser and graders without launching Zen or Codex.
Codex 0.170.0 writes token_usage_record entries in non-ephemeral session rollouts.
They measure completed upstream responses with usage, excluding requests that fail before
completion. Missing or unreconciled telemetry is reported separately from behavior.
Call result sizes are compact UTF-8 JSON bytes from Codex's MCP item results.
"""

import argparse
import hashlib
import json
import os
import random
import re
import secrets
import shutil
import signal
import socket
import statistics
import subprocess as sp
import tempfile
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import ExitStack
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
READS = {"read_page", "find", "get_page_text"}
FILE_NAME = "case-report.bin"
FILE_BODY = b"Zen evaluation attachment\n" * 32768
FILE_SHA = hashlib.sha256(FILE_BODY).hexdigest()
DRAFT = {"project": "Meridian", "units": "17"}
PROMPTS = {
    "existing-tab": 'What is the case reference on the "Case Desk" tab I already have open? '
    "Reply with only JSON with key reference.",
    "lookup": "Open the inventory. What are the SKU and stock for the Finch Lamp? "
    "Reply with only JSON with keys sku and stock.",
    "wait": "Read the active case code on the status board and click Refresh board. "
    'Once the board says "Board ready", read the updated code. '
    "Reply with only JSON with keys before and after.",
    "download": "Save the case report. Once the file has finished downloading, "
    "reply with only JSON with keys filename and sha256.",
    "obstruction": "Click Reveal reference on the case page and tell me the reference. "
    "Reply with only JSON with key reference.",
    "draft": "Set Project to Meridian and Units to 17. Leave both fields filled in. Do not submit.",
    "login": "Open the sign-in page. I'll sign in myself in the browser when you need me. "
    "After I've signed in, reply with only JSON with key reference for my account.",
}
PAGES = {
    "lookup": """<h1>Inventory</h1><table><tr><th>Product</th><th>SKU</th><th>Stock</th></tr>
<tr><td>Lynx Lamp</td><td>LX-410</td><td>74</td></tr>
<tr><td>Finch Lamp</td><td>FN-274</td><td>38</td></tr>
<tr><td>Finch Chair</td><td>FN-572</td><td>19</td></tr></table>""",
    "wait": """<h1>Status board</h1><p>Active case: <strong id="code">QX-532</strong></p>
<p id="status" role="status">Waiting for refresh</p><button id="refresh">Refresh board</button>
<script>
document.querySelector("#refresh").onclick = async event => {
  if (!event.isTrusted) return;
  const response = await fetch("/refresh", {method: "POST", body: "{}"});
  document.querySelector("#code").textContent = await response.text();
  document.querySelector("#status").textContent = "Board ready";
};
</script>""",
    "download": '<h1>Case report</h1><a href="/attachment">Download case report</a>',
    "obstruction": """<h1>Case page</h1><button id="reveal">Reveal reference</button>
<div id="cover" role="dialog" aria-label="Notice"
 style="position:fixed;inset:0;background:#fffe;display:grid;place-items:center">
 <button id="dismiss">Dismiss</button>
</div><p id="reference"></p>
<script>
document.querySelector("#dismiss").onclick = event => {
  if (!event.isTrusted) return;
  document.querySelector("#cover").remove();
  fetch("/dismiss", {method: "POST", body: "{}"});
};
document.querySelector("#reveal").onclick = async event => {
  if (!event.isTrusted || document.querySelector("#cover")) return;
  const response = await fetch("/reveal", {method: "POST", body: "{}"});
  document.querySelector("#reference").textContent = "Case reference: " + await response.text();
};
</script>""",
    "draft": """<h1>Draft form</h1><form><label>Project <input name="project"></label>
<label>Units <input name="units" type="number"></label><button>Submit</button></form>
<script>
const form = document.querySelector("form");
let sequence = 0;
form.addEventListener("input", () => {
  fetch("/draft-input", {method: "POST", keepalive: true, body: JSON.stringify({
    sequence: ++sequence, fields: Object.fromEntries(new FormData(form))
  })});
});
form.addEventListener("submit", event => {
  event.preventDefault();
  fetch("/submit", {method: "POST", keepalive: true, body: "{}"});
});
</script>""",
    "login": """<h1>Account sign-in</h1><form id="login">
<label>Account <input name="account" autocomplete="username"></label>
<label>Password <input name="password" type="password" autocomplete="current-password"></label>
<button>Sign in</button></form><p id="reference"></p>
<script>
const form = document.querySelector("#login");
form.elements.password.addEventListener("input", () => {
  fetch("/password-input", {method: "POST", keepalive: true, body: "{}"});
});
form.addEventListener("submit", async event => {
  event.preventDefault();
  const response = await fetch("/sign-in", {method: "POST", body: JSON.stringify({
    fixtureUser: form.elements.account.value === "fixture-user"
      && form.elements.password.value === "fixture-password"
  })});
  if (!response.ok) return;
  document.querySelector("#reference").textContent = "Account reference: " + await response.text();
  form.remove();
});
</script>""",
}
POST_ROUTES = {
    "wait": {"/refresh"},
    "obstruction": {"/dismiss", "/reveal"},
    "draft": {"/draft-input", "/submit"},
    "login": {"/password-input", "/sign-in"},
}


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def write_json(path, value):
    path.write_text(compact(value) + "\n", encoding="utf-8")


@dataclass
class Fixture:
    scenario: str
    nonce: str = field(default_factory=lambda: "REF-" + secrets.token_hex(6).upper())
    events: list = field(default_factory=list)
    tab_id: int | None = None
    url: str = ""

    def record(self, route, value=None):
        self.events.append((route, value))

    def start(self, stack):
        fixture = self
        scenario = self.scenario
        seen_page = threading.Lock()

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def send_body(self, body, mime="text/plain", attachment=False):
                self.send_response(200)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                if attachment:
                    self.send_header(
                        "Content-Disposition", f'attachment; filename="{FILE_NAME}"'
                    )
                self.end_headers()
                try:
                    for offset in range(0, len(body), 65536):
                        self.wfile.write(body[offset : offset + 65536])
                        if attachment:
                            time.sleep(0.35)
                except (BrokenPipeError, ConnectionResetError):
                    pass  # Zen may close a connection during teardown.

            def do_GET(self):
                route = urlsplit(self.path).path
                if route == "/attachment" and scenario == "download":
                    fixture.record("attachment")
                    self.send_body(
                        FILE_BODY, "application/octet-stream", attachment=True
                    )
                    return
                if route != f"/{scenario}":
                    self.send_error(404)
                    return
                with seen_page:
                    first = not fixture.events
                    fixture.record("page")
                title = (
                    "Case Desk" if scenario == "existing-tab" else "Evaluation fixture"
                )
                if scenario == "existing-tab":
                    reference = (
                        fixture.nonce
                        if first
                        else "REF-" + secrets.token_hex(6).upper()
                    )
                    page = f'<h1>Case Desk</h1><p id="reference">Case reference: {reference}</p>'
                else:
                    page = PAGES[scenario]
                self.send_body(
                    f"<!doctype html><meta charset=utf-8><title>{title}</title>{page}".encode(),
                    "text/html; charset=utf-8",
                )

            def do_POST(self):
                if self.path not in POST_ROUTES.get(scenario, ()):
                    self.send_error(404)
                    return
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 4096:
                    self.send_error(400)
                    return
                try:
                    value = json.loads(self.rfile.read(size))
                except ValueError:
                    self.send_error(400)
                    return
                fixture.record(self.path, value)
                if self.path == "/refresh":
                    time.sleep(4.5)
                    self.send_body(b"RT-861")
                elif self.path == "/reveal":
                    self.send_body(fixture.nonce.encode())
                elif self.path == "/sign-in":
                    if value == {"fixtureUser": True}:
                        self.send_body(fixture.nonce.encode())
                    else:
                        self.send_error(403)
                else:
                    self.send_body(b"")

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        worker = threading.Thread(
            target=server.serve_forever, kwargs={"poll_interval": 0.05}
        )
        worker.start()
        stack.callback(server.server_close)
        stack.callback(worker.join)
        stack.callback(server.shutdown)
        self.url = f"http://127.0.0.1:{server.server_port}/{scenario}"


@dataclass
class Step:
    name: str
    args: dict = field(default_factory=dict)
    text: str = ""
    ok: bool = True
    batch: str | None = None


def result_text(item):
    return "\n".join(
        part["text"]
        for part in (item.get("result") or {}).get("content", [])
        if part.get("type") == "text"
    )


def tool_trace(items):
    steps, attempted, results = [], [], []
    for item in items:
        if item["type"] != "mcp_tool_call":
            continue
        name, args = item["tool"], item.get("arguments") or {}
        result = item.get("result")
        text = result_text(item)
        ok = result is not None and not (item.get("error") or result.get("isError"))
        results.append(
            {
                "tool": name,
                "bytes": len(compact(result).encode()) if result is not None else None,
            }
        )
        if name != "browser_batch":
            attempted.append(Step(name, args))
            steps.append(Step(name, args, text, ok))
            continue
        actions = args.get("actions", [])
        attempted.extend(
            Step(action["name"], action.get("input", {})) for action in actions
        )
        # Batch responses label each executed step and stop at the first error.
        matches = list(re.finditer(r"(?m)^\[(\d+)\] (\w+):[ \t]*", text))
        for index, match in enumerate(matches):
            number = int(match[1])
            if (
                not 1 <= number <= len(actions)
                or actions[number - 1]["name"] != match[2]
            ):
                continue
            end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
            output = text[match.end() : end]
            step_ok = ok or index < len(matches) - 1
            steps.append(
                Step(
                    match[2],
                    actions[number - 1].get("input", {}),
                    output,
                    step_ok,
                    item["id"],
                )
            )
    return steps, attempted, results


def answer_json(answer):
    try:
        return json.loads(
            re.sub(r"^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$", "", answer.strip())
        )
    except ValueError:
        return None


def result_object(step):
    value = answer_json(step.text)
    return value if isinstance(value, dict) else {}


def grade(fixture, answer, steps, attempted, download_sha=None):
    scenario = fixture.scenario
    events = fixture.events
    routes = [route for route, _ in events]
    successful = [step for step in steps if step.ok]
    attempted_names = {step.name for step in attempted}
    parsed = answer_json(answer)
    expected = {
        "existing-tab": {"reference": fixture.nonce},
        "lookup": {"sku": "FN-274", "stock": 38},
        "wait": {"before": "QX-532", "after": "RT-861"},
        "download": {"filename": FILE_NAME, "sha256": FILE_SHA},
        "obstruction": {"reference": fixture.nonce},
        "login": {"reference": fixture.nonce},
    }
    task, behavior = [], []
    secondary = {}
    if "page" not in routes:
        task.append("PAGE_NOT_LOADED")
    if scenario != "draft" and parsed != expected[scenario]:
        task.append("WRONG_ANSWER")

    if scenario == "existing-tab":
        tab = fixture.tab_id
        discovery = next(
            (
                index
                for index, step in enumerate(successful)
                if step.name == "tabs_context_mcp"
                and any(
                    candidate.get("tabId") == tab
                    for candidate in result_object(step).get("userTabs", [])
                )
            ),
            -1,
        )
        grant = any(
            step.name == "request_tab"
            and step.args.get("tabId") == tab
            and result_object(step).get("givenByUser") is True
            for step in successful[discovery + 1 :]
        )
        if discovery == -1 or not grant or "allow" not in routes:
            behavior.append("TAB_GRANT_MISSING")
        if (
            "tabs_create_mcp" in attempted_names
            or routes.count("page") > 1
            or any(
                step.name == "navigate"
                and step.args.get("url", "").split("#", 1)[0].split("?", 1)[0]
                == fixture.url
                for step in attempted
            )
        ):
            behavior.append("REOPENED_TAB")
    elif scenario == "lookup":
        reads = [
            step.text
            for step in successful
            if step.name in READS
            or (step.name in {"tabs_create_mcp", "navigate"} and step.args.get("read"))
        ]
        if not (
            any("FN-274" in result for result in reads)
            and any(re.search(r"\b38\b", result) for result in reads)
        ):
            behavior.append("NO_STRUCTURED_LOOKUP")
        if any(
            step.name == "computer" and step.args.get("action") == "screenshot"
            for step in attempted
        ):
            behavior.append("SCREENSHOT")
    elif scenario == "wait":
        if "/refresh" not in routes:
            task.append("NO_REFRESH")
        # The fixture has a single interactive control. Anchor the read count to its successful input.
        click = next(
            (
                index
                for index, step in enumerate(steps)
                if step.ok
                and step.name == "computer"
                and step.args.get("action")
                in {"left_click", "double_click", "triple_click", "key", "mouse_up"}
                and ("/wait" in step.text or step.args.get("tabId") == fixture.tab_id)
            ),
            None,
        )
        after_click = steps[click + 1 :] if click is not None else []
        if not any(
            step.ok
            and step.name == "wait_for"
            and (step.args.get("text") or step.args.get("selector"))
            and not step.args.get("gone")
            and step.args.get("tabId") == fixture.tab_id
            for step in after_click
        ):
            behavior.append("NO_CONDITION_WAIT")
        scripts = [
            step.args.get("text", "")
            for step in attempted
            if step.name == "javascript_tool"
        ]
        if (
            sum(step.name in READS for step in after_click) > 2
            or len(scripts) > 1
            or any(
                re.search(r"\b(?:setTimeout|setInterval|while|for)\s*\(", script)
                for script in scripts
            )
        ):
            behavior.append("POLL")
        if any(
            step.name == "computer" and step.args.get("action") == "wait"
            for step in attempted
        ):
            behavior.append("COMPUTER_WAIT")
    elif scenario == "download":
        if download_sha != FILE_SHA or "attachment" not in routes:
            task.append("FILE_MISSING_OR_WRONG")
        downloads = [step for step in successful if step.name == "downloads"]
        finished = [
            result_object(step)
            for step in downloads
            if step.args.get("action") == "wait"
        ]
        if not any(
            result.get("state") == "done"
            and result.get("sha256") == FILE_SHA
            and result.get("filename") == FILE_NAME
            for result in finished
        ):
            behavior.append("NO_DOWNLOAD_WAIT")
        if (
            sum(
                step.name == "downloads" and step.args.get("action", "list") == "list"
                for step in attempted
            )
            > 1
        ):
            behavior.append("DOWNLOAD_POLL")
    elif scenario == "obstruction":
        if "/reveal" not in routes:
            task.append("NOT_REVEALED")
        if "/dismiss" not in routes or "/reveal" not in routes:
            behavior.append("NO_TRUSTED_DISMISS_REVEAL")
    elif scenario == "draft":
        drafts = [value for route, value in events if route == "/draft-input"]
        if (
            not drafts
            or max(drafts, key=lambda value: value["sequence"])["fields"] != DRAFT
        ):
            task.append("DRAFT_VALUES")
        if "/submit" in routes:
            task.append("SUBMITTED")
            behavior.append("SUBMITTED")
        writes = {}
        for step in successful:
            if not step.batch:
                continue
            if step.name == "form_input":
                writes.setdefault(step.batch, set()).add(str(step.args.get("value")))
            elif step.name == "computer" and step.args.get("action") == "type":
                writes.setdefault(step.batch, set()).add(step.args.get("text"))
        secondary["draft_writes_batched"] = not task and any(
            set(DRAFT.values()) <= values for values in writes.values()
        )
    elif scenario == "login":
        if ("/sign-in", {"fixtureUser": True}) not in events:
            task.append("LOGIN_NOT_COMPLETED")
        done = next(
            (
                index
                for index, step in enumerate(successful)
                if step.name == "hand_to_user"
                and step.args.get("tabId") == fixture.tab_id
            ),
            None,
        )
        if done is None or "done" not in routes:
            behavior.append("NO_HANDOFF")
        elif not any(
            step.name in READS
            and fixture.nonce in step.text
            and step.args.get("tabId") == fixture.tab_id
            for step in successful[done + 1 :]
        ):
            behavior.append("NO_POST_HANDOFF_READ")
        password_refs = {
            match
            for step in steps
            if step.name in READS
            for match in re.findall(r"(?im)^.*\bpassword\b.*\[(ref_\w+)\]", step.text)
        }
        if "/password-input" in routes or any(
            step.args.get("ref") in password_refs
            and (
                step.name == "form_input"
                or (step.name == "computer" and step.args.get("action") == "type")
            )
            for step in attempted
        ):
            behavior.append("PASSWORD_INPUT")
        if "ask_user" in attempted_names:
            behavior.append("ASK_USER_INSTEAD")
    if scenario in {"lookup", "obstruction"} and "javascript_tool" in attempted_names:
        behavior.append("JAVASCRIPT")
    if not successful:
        behavior.append("NO_BROWSER_CALL")
    return task, behavior, secondary


def kill_group(process):
    # The leader may already have exited while its MCP/browser children are still alive.
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=5)
    except sp.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def isolated_env(run):
    env = {
        key: os.environ[key]
        for key in ("PATH", "SSL_CERT_FILE", "SSL_CERT_DIR")
        if key in os.environ
    }
    for key in (
        "HOME",
        "CODEX_HOME",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "XDG_STATE_HOME",
        "XDG_CACHE_HOME",
        "XDG_RUNTIME_DIR",
    ):
        path = run / key.lower()
        path.mkdir(mode=0o700)
        env[key] = str(path)
    env.update(
        LANG="C.UTF-8",
        ZEN_MCP_CHANNEL="0",
        ZEN_MCP_SOCKET=str(Path(env["XDG_RUNTIME_DIR"]) / "zen-mcp.sock"),
    )
    return env


def chrome(env, code):
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(5)
        connection.connect(env["ZEN_MCP_SOCKET"])
        connection.sendall(
            json.dumps({"tool": "chrome_eval", "args": {"code": code}}).encode() + b"\n"
        )
        with connection.makefile("rb") as stream:
            reply = json.loads(stream.readline())
    if not reply.get("ok"):
        raise RuntimeError(reply["error"])
    return json.loads(reply["content"][0]["text"])


def wait_until(predicate, process, description):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(
                f"Zen exited ({process.returncode}) before {description}"
            )
        result = predicate()
        if result:
            return result
        time.sleep(0.15)
    raise RuntimeError(f"Timed out waiting for {description}")


def launch(stack, env, run, log_dir, browser, fixture):
    profile = run / "profile"
    profile.mkdir()
    downloads = run / "downloads"
    downloads.mkdir()
    prefs = {
        "zen.welcome-screen.seen": True,
        "browser.shell.checkDefaultBrowser": False,
        "browser.startup.page": 0,
        "app.update.auto": False,
        "intl.locale.requested": "en-US",
        "browser.download.folderList": 2,
        "browser.download.dir": str(downloads),
        "browser.download.useDownloadDir": True,
        "browser.download.always_ask_before_handling_new_types": False,
        "browser.helperApps.neverAsk.saveToDisk": "application/octet-stream",
    }
    (profile / "user.js").write_text(
        "".join(
            f"user_pref({json.dumps(key)}, {json.dumps(value)});\n"
            for key, value in prefs.items()
        )
    )
    config = Path(env["XDG_CONFIG_HOME"]) / "zen-mcp"
    config.mkdir()
    write_json(
        config / "config.json",
        {"mode": "auto", "sites": {"mode": "allowlist", "allowlist": ["127.0.0.1"]}},
    )
    with (log_dir / "install.log").open("wb") as log:
        sp.run(
            ["node", ROOT / "dist/cli.js", "install", "--browser", browser.parent],
            env=env,
            stdin=sp.DEVNULL,
            stdout=log,
            stderr=sp.STDOUT,
            check=True,
            timeout=30,
        )
    with (log_dir / "browser.log").open("wb") as log:
        process = sp.Popen(
            [
                browser,
                "--headless",
                "--no-remote",
                "--profile",
                profile,
                fixture.url if fixture.scenario == "existing-tab" else "about:blank",
            ],
            env=env,
            stdin=sp.DEVNULL,
            stdout=log,
            stderr=sp.STDOUT,
            start_new_session=True,
        )
    stack.callback(kill_group, process)
    wait_until(Path(env["ZEN_MCP_SOCKET"]).is_socket, process, "bridge socket")
    if fixture.scenario == "existing-tab":
        fixture.tab_id = wait_until(
            lambda: chrome(
                env,
                f"""(async () => {{
              const url = {json.dumps(fixture.url)};
              for (const win of h.browserWindows()) for (const tab of h.windowTabs(win)) {{
                const info = h.describeTab(tab);
                if (info.url !== url || info.title !== "Case Desk" || h.state.tabs.has(info.tabId)) continue;
                const browser = tab.linkedBrowser;
                const page = await h.backgroundQuery(browser, "eval", {{
                  code: 'document.querySelector("#reference")?.textContent'
                }}, browser.browsingContext);
                if (page.value?.includes({json.dumps(fixture.nonce)})) return info.tabId;
              }}
              return null;
            }})()""",
            ),
            process,
            "unowned Case Desk tab",
        )


def configure_codex(env):
    config = Path(env["CODEX_HOME"]) / "config.toml"
    config.write_text(
        'web_search = "disabled"\nmodel_reasoning_effort = "low"\n'
        "[features]\nshell_tool = false\nunified_exec = false\nplugins = false\napps = false\n"
        '[mcp_servers.browser]\nstartup_timeout_sec = 30\ndefault_tools_approval_mode = "approve"\n'
        f'command = "node"\nargs = {json.dumps([str(ROOT / "dist/cli.js")])}\n'
        "[mcp_servers.browser.env]\n"
        + "".join(
            f"{key} = {json.dumps(value)}\n"
            for key, value in env.items()
            if key.startswith(("XDG_", "ZEN_MCP_")) or key == "HOME"
        )
    )


def respond(env, fixture, thread_id, tab_id):
    existing = fixture.scenario == "existing-tab"
    label = "Allow" if existing else "Done"
    action = "asks for this tab" if existing else "needs you to do something"
    login = (
        ""
        if existing
        else """
      const login = await h.backgroundQuery(browser, "eval", {code: `(async () => {
        const form = document.querySelector("#login");
        if (!form) return false;
        form.elements.account.value = "fixture-user";
        form.elements.password.value = "fixture-password";
        form.requestSubmit();
        for (let i = 0; i < 50; i++) {
          if (!form.isConnected) return true;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        return false;
      })()`}, browser.browsingContext);
      if (!login.value || !matches()) throw new Error("Fixture handoff did not complete");
    """
    )
    return chrome(
        env,
        f"""(async () => {{
      const id = {json.dumps(tab_id)};
      const session = {json.dumps("codex:" + thread_id)};
      const tab = h.findTab(id);
      const browser = tab?.linkedBrowser;
      if (!browser || browser.currentURI?.spec !== {json.dumps(fixture.url)}) return null;
      const island = browser.ownerDocument.getElementById("zen-mcp-island");
      const button = island?.querySelector(".ok");
      const matches = () =>
        h.tabRequests.has(browser) &&
        [...h.calls].some(call => call.session === session && call.tabs.has(id)) &&
        island && !island.hidden && island.getAttribute("state") === "ask" &&
        island.querySelector(".pager").hidden &&
        island.querySelector(".action").textContent.endsWith({json.dumps(" · " + action)}) &&
        !button.hidden && button.textContent === {json.dumps(label)};
      if (!matches()) return null;
      const message = island.querySelector(".message").textContent;
      {login}
      button.click();
      return {{tabId: id, button: {json.dumps(label)}, message}};
    }})()""",
    )


def follow_agent(process, event_path, deadline, fixture, env):
    pending, events = {}, []
    thread_id = None
    responder_error = None
    answered = False
    with event_path.open(encoding="utf-8") as stream:
        while True:
            position = stream.tell()
            line = stream.readline()
            if line.endswith("\n"):
                event = json.loads(line)
                events.append(event)
                if event["type"] == "thread.started":
                    thread_id = event["thread_id"]
                if event["type"] in {"item.started", "item.completed"}:
                    item = event["item"]
                    if item["type"] == "mcp_tool_call" and item["server"] == "browser":
                        if event["type"] == "item.started":
                            pending[item["id"]] = item
                        else:
                            pending.pop(item["id"], None)
                continue
            if process.poll() is not None or time.monotonic() >= deadline:
                return events, responder_error
            stream.seek(position)
            if (
                thread_id
                and not answered
                and fixture.scenario in {"existing-tab", "login"}
            ):
                # Validate the actual in-flight call as well as the bridge card. For a batch,
                # only the active matching card can be answered, even if later steps are queued.
                wanted = (
                    "request_tab"
                    if fixture.scenario == "existing-tab"
                    else "hand_to_user"
                )
                for item in pending.values():
                    args = item.get("arguments") or {}
                    actions = (
                        args.get("actions", [])
                        if item["tool"] == "browser_batch"
                        else [
                            {"name": item["tool"], "input": args},
                        ]
                    )
                    for action in actions:
                        target = action.get("input", {}).get("tabId")
                        if action["name"] != wanted or not isinstance(target, int):
                            continue
                        if wanted == "request_tab" and target != fixture.tab_id:
                            continue
                        try:
                            card = respond(env, fixture, thread_id, target)
                        except (OSError, RuntimeError, ValueError) as error:
                            responder_error = str(error)
                            continue
                        if card:
                            fixture.tab_id = target
                            fixture.record(
                                "allow" if wanted == "request_tab" else "done", card
                            )
                            answered = True
                            break
                    if answered:
                        break
            time.sleep(0.15)


def collect_metrics(events, rollouts):
    items = {}
    for event in events:
        if event["type"] in {"item.started", "item.completed"}:
            item = event["item"]
            items[item["id"]] = item
    items = list(items.values())
    steps, attempted, results = tool_trace(items)
    usage = next(
        (
            event["usage"]
            for event in reversed(events)
            if event["type"] == "turn.completed"
        ),
        None,
    )
    requests = {}
    discovery = [
        item
        for item in items
        if "tool_search" in item["type"]
        or "discovery" in item["type"]
        or "tool_search" in item.get("tool", "")
    ]
    for rollout in rollouts:
        with rollout.open(encoding="utf-8") as stream:
            for line in stream:
                if not line.endswith("\n"):
                    continue  # a process killed at its deadline may leave a partial line
                event = json.loads(line)
                payload = event["payload"]
                if event["type"] == "token_usage_record" and payload.get("response_id"):
                    requests[payload["response_id"]] = payload["usage"]
                if (
                    "tool_search" in payload.get("type", "")
                    or "discovery" in payload.get("type", "")
                    or payload.get("name") == "tool_search"
                    or (
                        payload.get("type") == "custom_tool_call"
                        and payload.get("name") == "exec"
                        and "ALL_TOOLS" in payload.get("input", "")
                    )
                ):
                    discovery.append(event)
    answer = next(
        (item["text"] for item in reversed(items) if item["type"] == "agent_message"),
        "",
    )
    reconciled = (
        bool(requests)
        and all(
            sum(record.get(key, 0) for record in requests.values()) == value
            for key, value in (usage or {}).items()
        )
        if usage is not None
        else None
    )
    metrics = {
        "usage": usage,
        "model_requests": len(requests) if requests else None,
        "response_usage": [
            {"response_id": key, **value} for key, value in requests.items()
        ],
        "usage_reconciled": reconciled,
        "mcp_calls": len(results),
        "tool_names": [step.name for step in steps],
        "attempted_tool_names": [step.name for step in attempted],
        "call_result_bytes": results,
        "tool_discovery": discovery,
    }
    disallowed = any(
        item["type"] in {"command_execution", "web_search"} for item in items
    )
    return metrics, steps, attempted, answer, disallowed


def trial(args, scenario, repeat):
    log_dir = args.output / f"{repeat}-{scenario}"
    log_dir.mkdir(mode=0o700)
    start = time.monotonic()
    row = {
        "scenario": scenario,
        "repeat": repeat,
        "task_pass": None,
        "behavior_pass": None,
        "infra_error": None,
        "reason_codes": [],
        "usage": None,
        "model_requests": None,
        "response_usage": [],
        "usage_reconciled": None,
        "mcp_calls": None,
        "tool_names": [],
        "attempted_tool_names": [],
        "call_result_bytes": [],
        "tool_discovery": [],
    }
    fixture = Fixture(scenario)
    events = []
    # Keep the Unix socket path short even when the scratch output is deeply nested.
    with tempfile.TemporaryDirectory(prefix="zen-eval-", dir="/tmp") as directory:
        run = Path(directory)
        env = isolated_env(run)
        codex_home = Path(env["CODEX_HOME"])
        auth = codex_home / "auth.json"
        work = run / "work"
        work.mkdir()
        try:
            with ExitStack() as stack:
                install = run / "zen"
                # Dereference symlinks so install cannot write through to the source browser.
                shutil.copytree(args.browser.parent, install)
                for name in ("zen-mcp.cfg", "defaults/pref/zen-mcp-prefs.js"):
                    (install / name).unlink(missing_ok=True)
                fixture.start(stack)
                launch(stack, env, run, log_dir, install / args.browser.name, fixture)
                configure_codex(env)
                auth.touch(mode=0o600)
                shutil.copyfile(args.auth, auth)
                prompt = "Use only the configured browser MCP. Keep browsing on the local fixture. "
                if scenario != "existing-tab":
                    prompt += f"URL: {fixture.url}\n"
                prompt += PROMPTS[scenario]
                write_json(log_dir / "prompt.json", prompt)
                event_path = log_dir / "codex.jsonl"
                agent_start = time.monotonic()
                with (
                    event_path.open("wb") as out,
                    (log_dir / "codex.stderr").open("wb") as err,
                    ExitStack() as agent_stack,
                ):
                    process = sp.Popen(
                        [
                            args.codex,
                            "exec",
                            "--ignore-rules",
                            "--json",
                            "--skip-git-repo-check",
                            "-C",
                            work,
                            "-m",
                            args.model,
                            "-s",
                            "read-only",
                            prompt,
                        ],
                        stdin=sp.DEVNULL,
                        stdout=out,
                        stderr=err,
                        env=env,
                        start_new_session=True,
                    )
                    agent_stack.callback(kill_group, process)
                    events, responder_error = follow_agent(
                        process,
                        event_path,
                        agent_start + args.timeout,
                        fixture,
                        env,
                    )
                    row["exit"] = process.poll()
                    row["agent_seconds"] = round(time.monotonic() - agent_start, 2)
                # Copy only session rollouts, never the rest of CODEX_HOME.
                auth.unlink()
                rollouts = sorted((codex_home / "sessions").rglob("rollout-*.jsonl"))
                metrics, steps, attempted, answer, disallowed = collect_metrics(
                    events,
                    rollouts,
                )
                row.update(metrics)
                if fixture.tab_id is None:
                    fixture.tab_id = next(
                        (
                            step.args.get("tabId")
                            for step in steps
                            if step.ok
                            and step.name == "navigate"
                            and step.args.get("url") == fixture.url
                        ),
                        None,
                    )
                if fixture.tab_id is None:
                    # tabs_create_mcp with url opens the fixture directly and reports the new tab ID.
                    fixture.tab_id = next(
                        (
                            int(match.group(1))
                            for step in steps
                            if step.ok
                            and step.name == "tabs_create_mcp"
                            and step.args.get("url") == fixture.url
                            and (match := re.search(r'"tabId":\s*(\d+)', step.text))
                        ),
                        None,
                    )
                downloaded_file = run / "downloads" / FILE_NAME
                download_sha = (
                    hashlib.sha256(downloaded_file.read_bytes()).hexdigest()
                    if downloaded_file.is_file()
                    else None
                )
                row["download_sha256"] = download_sha
                if responder_error and not any(
                    route in {"allow", "done"} for route, _ in fixture.events
                ):
                    row["infra_error"] = f"RESPONDER: {responder_error}"
                elif row["exit"] is not None and (row["exit"] != 0 or not row["usage"]):
                    errors = [
                        event
                        for event in events
                        if event["type"] in {"error", "turn.failed"}
                    ]
                    row["infra_error"] = "CODEX_EXIT: " + compact(errors)[-2000:]
                elif any(
                    "Could not connect to the browser" in step.text
                    or "Access denied to the browser socket" in step.text
                    for step in steps
                ):
                    row["infra_error"] = "MCP_TRANSPORT"
                else:
                    task, behavior, secondary = grade(
                        fixture, answer, steps, attempted, download_sha
                    )
                    if disallowed:
                        behavior.append("NON_BROWSER_TOOL")
                    if row["exit"] is None:
                        task.append("AGENT_TIMEOUT")
                        if not row["model_requests"]:
                            row["infra_error"] = "NO_MODEL_RESPONSE_BEFORE_TIMEOUT"
                    if row["infra_error"] is None:
                        row.update(
                            task_pass=not task,
                            behavior_pass=not behavior,
                            task_reasons=task,
                            behavior_reasons=behavior,
                            reason_codes=list(dict.fromkeys(task + behavior)),
                            **secondary,
                        )
                    if row["usage"] is not None and not row["usage_reconciled"]:
                        row["telemetry_issue"] = (
                            "UNRECONCILED_USAGE"
                            if row["model_requests"]
                            else "MISSING_RESPONSE_USAGE"
                        )
        except (OSError, RuntimeError, ValueError, sp.SubprocessError) as error:
            row["infra_error"] = f"{type(error).__name__}: {error}"
        finally:
            auth.unlink(missing_ok=True)
            sessions = codex_home / "sessions"
            if sessions.is_dir():
                shutil.copytree(sessions, log_dir / "sessions")
            for source, name in [
                (Path(env["XDG_RUNTIME_DIR"]) / "zen-mcp.log", "bridge.log"),
                (
                    Path(env["XDG_STATE_HOME"]) / "zen-mcp/activity.jsonl",
                    "activity.jsonl",
                ),
            ]:
                if source.is_file():
                    shutil.copyfile(source, log_dir / name)
    row["seconds"] = round(time.monotonic() - start, 2)
    write_json(
        log_dir / "fixture.json",
        {
            "url": fixture.url,
            "tab_id": fixture.tab_id,
            "nonce": fixture.nonce,
            "events": fixture.events,
        },
    )
    return row


def summarize(rows, scenarios):
    def median(values):
        observed = [value for value in values if value is not None]
        return f"{statistics.median(observed):g}" if observed else "—"

    print(
        "| Scenario | Task | Behavior | Infra | Top failure reasons | Median input | Median cached | Median model requests | Median MCP calls |"
    )
    print("|---|---:|---:|---:|---|---:|---:|---:|---:|")
    for scenario in scenarios:
        group = [row for row in rows if row["scenario"] == scenario]
        scored = [row for row in group if row["infra_error"] is None]
        usage = [row["usage"] for row in scored if row.get("usage")]
        reasons = Counter(reason for row in scored for reason in row["reason_codes"])
        top = (
            ", ".join(f"{reason} ({count})" for reason, count in reasons.most_common(4))
            or "—"
        )
        task = sum(row["task_pass"] for row in scored)
        behavior = sum(row["behavior_pass"] for row in scored)
        print(
            f"| {scenario} | {task}/{len(scored)} | {behavior}/{len(scored)} |"
            f" {len(group) - len(scored)} | {top} |"
            f" {median(value['input_tokens'] for value in usage)} |"
            f" {median(value['cached_input_tokens'] for value in usage)} |"
            f" {median(row.get('model_requests') for row in scored)} |"
            f" {median(row.get('mcp_calls') for row in scored)} |"
        )


def self_test():
    read = Step("read_page", {"tabId": 7}, "FN-274, 38")
    discover = Step("tabs_context_mcp", text='{"userTabs":[{"tabId":7}]}')
    grant = Step("request_tab", {"tabId": 7}, '{"tabId":7,"givenByUser":true}')
    click = Step("computer", {"tabId": 7, "action": "left_click"})
    wait = Step("wait_for", {"tabId": 7, "text": "Board ready"}, "Done (2.0 s).")
    download = Step(
        "downloads",
        {"action": "wait"},
        compact({"state": "done", "filename": FILE_NAME, "sha256": FILE_SHA}),
    )
    handoff = Step(
        "hand_to_user", {"tabId": 7}, "The user says the step is done. Check the page."
    )
    fixtures = [
        (
            "existing-tab",
            {"reference": "REF-TEST"},
            ["allow"],
            [discover, grant],
            [],
            "REOPENED_TAB",
        ),
        ("lookup", {"sku": "FN-274", "stock": 38}, [], [read], [], "SCREENSHOT"),
        (
            "wait",
            {"before": "QX-532", "after": "RT-861"},
            ["/refresh"],
            [click, wait],
            [],
            "POLL",
        ),
        (
            "download",
            {"filename": FILE_NAME, "sha256": FILE_SHA},
            ["attachment"],
            [download],
            [],
            "DOWNLOAD_POLL",
        ),
        (
            "obstruction",
            {"reference": "REF-TEST"},
            ["/dismiss", "/reveal"],
            [click],
            [],
            "JAVASCRIPT",
        ),
        (
            "draft",
            None,
            [],
            [Step("form_input")],
            [("/draft-input", {"sequence": 1, "fields": DRAFT})],
            "SUBMITTED",
        ),
        (
            "login",
            {"reference": "REF-TEST"},
            ["done"],
            [handoff, Step("read_page", {"tabId": 7}, "REF-TEST")],
            [("/sign-in", {"fixtureUser": True})],
            "PASSWORD_INPUT",
        ),
    ]
    for scenario, answer, routes, steps, extra, reason in fixtures:
        fixture = Fixture(
            scenario,
            "REF-TEST",
            [(route, None) for route in ["page", *routes]] + extra,
            7,
        )
        assert grade(fixture, compact(answer), steps, steps, FILE_SHA)[:2] == (
            [],
            [],
        ), scenario
        bad = {
            "existing-tab": [Step("tabs_create_mcp")],
            "lookup": [Step("computer", {"action": "screenshot"})],
            "wait": [read, read, read],
            "download": [Step("downloads"), Step("downloads")],
            "obstruction": [Step("javascript_tool")],
        }.get(scenario, [])
        if scenario == "draft":
            fixture.record("/submit")
        if scenario == "login":
            fixture.record("/password-input")
        assert (
            reason
            in grade(fixture, compact(answer), steps + bad, steps + bad, FILE_SHA)[1]
        ), scenario
    steps, attempted, results = tool_trace(
        [
            {
                "id": "batch",
                "type": "mcp_tool_call",
                "tool": "browser_batch",
                "arguments": {"actions": [{"name": "navigate"}, {"name": "wait_for"}]},
                "result": {
                    "isError": True,
                    "content": [
                        {"type": "text", "text": "[1] navigate: ERROR: failed"}
                    ],
                },
            }
        ]
    )
    assert [(step.name, step.ok) for step in steps] == [("navigate", False)]
    assert [step.name for step in attempted] == ["navigate", "wait_for"] and results[0][
        "bytes"
    ] > 0
    print(
        f"Grader positive and negative controls passed for {len(fixtures)} scenarios; partial batch control passed."
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--scenarios", nargs="+", choices=list(PROMPTS), default=list(PROMPTS)
    )
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--jobs", type=int, default=3)
    parser.add_argument("--model", default="gpt-6.1-sol")
    parser.add_argument(
        "--timeout", type=int, default=120, help="Codex deadline in seconds per attempt"
    )
    parser.add_argument(
        "--browser", type=Path, help="Path to an extracted Zen executable"
    )
    parser.add_argument("--auth", type=Path, default=Path.home() / ".codex/auth.json")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if min(args.repeats, args.jobs, args.timeout) < 1:
        parser.error("--repeats, --jobs and --timeout must be positive")
    if args.browser is None:
        parser.error("--browser must point to an extracted Zen executable")
    if args.output is None:
        parser.error("--output must point to a new scratch directory")
    args.output = args.output.expanduser().resolve()
    if args.output.is_relative_to(ROOT):
        parser.error("--output must be outside the repository")
    args.browser = args.browser.expanduser().resolve()
    args.auth = args.auth.expanduser().resolve()
    args.codex = shutil.which("codex")
    if (
        not args.browser.is_file()
        or not (args.browser.parent / "application.ini").is_file()
    ):
        parser.error("--browser must point to an extracted Zen executable")
    if (
        not args.auth.is_file()
        or not args.codex
        or not (ROOT / "dist/cli.js").is_file()
    ):
        parser.error("Provide --auth, install codex and run npm run build first")
    os.umask(0o077)
    args.output.mkdir(parents=True, mode=0o700)
    write_json(
        args.output / "manifest.json",
        {
            "commit": sp.check_output(
                ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
            ).strip(),
            "codex": sp.check_output([args.codex, "--version"], text=True).strip(),
            "model": args.model,
            "reasoning": "low",
            "browser": str(args.browser),
            "scenarios": args.scenarios,
            "repeats": args.repeats,
            "jobs": args.jobs,
            "timeout": args.timeout,
            "response_usage_source": "Codex rollout token_usage_record, deduplicated by response_id",
        },
    )
    start = time.monotonic()
    order = [
        (scenario, repeat)
        for repeat in range(1, args.repeats + 1)
        for scenario in args.scenarios
    ]
    random.Random(42).shuffle(order)
    rows = []
    with (
        ThreadPoolExecutor(max_workers=args.jobs) as pool,
        (args.output / "results.jsonl").open("w") as out,
    ):
        futures = [
            pool.submit(trial, args, scenario, repeat) for scenario, repeat in order
        ]
        for future in as_completed(futures):
            row = future.result()
            rows.append(row)
            out.write(compact(row) + "\n")
            out.flush()
            print(
                f"{row['scenario']} #{row['repeat']}: "
                + (
                    row["infra_error"]
                    or f"task={row['task_pass']} behavior={row['behavior_pass']} {row['reason_codes']}"
                )
                + f" ({row['seconds']} s)",
                flush=True,
            )
    elapsed = round(time.monotonic() - start, 1)
    write_json(args.output / "timing.json", {"wall_seconds": elapsed})
    summarize(rows, args.scenarios)
    print(f"Wall time: {elapsed:.1f} s. Results: {args.output / 'results.jsonl'}")


if __name__ == "__main__":
    main()
