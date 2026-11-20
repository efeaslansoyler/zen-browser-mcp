"""Compare browser MCPs on loopback fixtures using isolated Codex and Zen instances."""

import argparse
import json
import os
import random
import re
import shutil
import signal
import socket
import subprocess as sp
import sys
import tempfile
import threading
import time
from contextlib import ExitStack
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ["zen-browser-mcp", "kitsune", "zenpilot"]
TASKS = {
    "lookup": (
        "Open the inventory. Find the SKU and stock for the Finch Lamp. "
        "Reply with only a JSON object with keys sku and stock."
    ),
    "refresh": (
        "Open the status board. Read the active case code, click Refresh board, "
        "then read the updated active case code. Reply with only JSON with keys before and after."
    ),
    "draft": (
        "Open the draft form. Set Project to Meridian and Units to 17. "
        "Leave both fields filled in. Do not submit the form."
    ),
}
PAGES = {
    "lookup": """<h1>Inventory</h1><table><tr><th>Product</th><th>SKU</th><th>Stock</th></tr>
<tr><td>Lynx Lamp</td><td>LX-410</td><td>74</td></tr>
<tr><td>Finch Lamp</td><td>FN-274</td><td>38</td></tr>
<tr><td>Finch Chair</td><td>FN-572</td><td>19</td></tr></table>""",
    "refresh": """<h1>Status board</h1><p>Active case: <strong id="code">QX-532</strong></p>
<button id="refresh">Refresh board</button>
<script>document.querySelector("#refresh").onclick = async () => {
  const response = await fetch("/refresh-event", {method: "POST", body: "{}"});
  document.querySelector("#code").textContent = await response.text();
};</script>""",
    "draft": """<h1>Draft form</h1><form><label>Project <input name="project"></label>
<label>Units <input name="units" type="number"></label></form>
<script>
const form = document.querySelector("form");
form.addEventListener("submit", event => {
  event.preventDefault();
  fetch("/submit-event", {method: "POST", body: "{}"});
});
let sequence = 0;
form.addEventListener("input", () => {
  fetch("/draft-event", {method: "POST", body: JSON.stringify({
    sequence: ++sequence, fields: Object.fromEntries(new FormData(form))
  })});
});
</script>""",
}


def fixture(task):
    events = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            if urlsplit(self.path).path != f"/{task}":
                self.send_error(404)
                return
            events.append(("page", None))
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(
                (
                    "<!doctype html><title>Benchmark fixture</title>" + PAGES[task]
                ).encode()
            )

        def do_POST(self):
            content = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            events.append((self.path, json.loads(content)))
            self.send_response(200)
            self.end_headers()
            if self.path == "/refresh-event":
                self.wfile.write(b"RT-861")

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, events


def grade(task, answer, events):
    if ("page", None) not in events:
        return False
    if task == "draft":
        drafts = [body for route, body in events if route == "/draft-event"]
        return bool(
            drafts
            and max(drafts, key=lambda d: d["sequence"])["fields"]
            == {"project": "Meridian", "units": "17"}
            and not any(route == "/submit-event" for route, _ in events)
        )
    try:
        answer = json.loads(
            re.sub(r"^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$", "", answer.strip())
        )
    except ValueError:
        return False
    if task == "lookup":
        return answer == {"sku": "FN-274", "stock": 38}
    return (
        answer == {"before": "QX-532", "after": "RT-861"}
        and ("/refresh-event", {}) in events
    )


def stop(process):
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=5)
        except sp.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()


def wait_for(predicate, process=None):
    for _ in range(160):
        if process and process.poll() is not None:
            raise RuntimeError(f"Browser exited with code {process.returncode}")
        if predicate():
            return
        time.sleep(0.125)
    raise RuntimeError("Browser or bridge did not become ready")


def port_ready(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.1):
            return True
    except OSError:
        return False


def launch(stack, tool, browser, run, env, kitsune, zenpilot, harness):
    prefs = {
        "zen.welcome-screen.seen": True,
        "browser.shell.checkDefaultBrowser": False,
        "browser.startup.page": 0,
        "app.update.auto": False,
    }
    profile = run / "profile"
    if tool == "kitsune":
        bridge_home = run / "kitsune"
        bridge_home.mkdir()
        browser_home = run / "kitsune-browser"
        browser_home.mkdir()
        bridge = harness.Bridge(str(bridge_home), token=None)
        bridge.env["KITSUNE_EXTENSION_DIR"] = str(browser_home / "extension")
        stack.callback(bridge.stop)
        bridge.start()
        real = harness.RealBrowser(
            str(browser), browser_home, bridge.ws_port, prefs, {}
        )
        stack.callback(real.stop)
        real.start()
        wait_for(lambda: bridge.status().get("extension_connected"))
        for k in (
            "KITSUNE_HOME",
            "KITSUNE_HTTP_PORT",
            "KITSUNE_WS_PORT",
            "KITSUNE_EXTENSION_DIR",
        ):
            env[k] = bridge.env[k]
        env.update(
            KITSUNE_SCRIPTING="0",
            KITSUNE_NO_BRIDGE_RESTART="1",
            KITSUNE_OWNER_ID=run.name,
        )
        return [str(kitsune / ".venv/bin/kitsune")]

    profile.mkdir()
    (profile / "user.js").write_text(
        "".join(
            f"user_pref({json.dumps(k)}, {json.dumps(v)});\n" for k, v in prefs.items()
        )
    )
    flags = []
    if tool == "zen-browser-mcp":
        config = Path(env["XDG_CONFIG_HOME"]) / "zen-mcp"
        config.mkdir()
        (config / "config.json").write_text(
            json.dumps(
                {
                    "mode": "auto",
                    "sites": {"mode": "allowlist", "allowlist": ["127.0.0.1"]},
                }
            )
        )
        sp.run(
            ["node", ROOT / "dist/cli.js", "install", "--browser", browser.parent],
            env=env,
            check=True,
            capture_output=True,
        )
    else:
        port = harness._free_port()
        flags = ["--remote-debugging-port", str(port)]
        config = run / "zenpilot.toml"
        config.write_text(
            f'port = {port}\nauto_launch = false\nprompts = false\nallowlist = ["127.0.0.1"]\n'
            f'audit_log = "{run / "audit.jsonl"}"\nreport_dir = "{run / "reports"}"\n'
        )
        env.update(
            ZENPILOT_CONFIG=str(config),
            ZENPILOT_STATE=str(run / "zenpilot"),
            ZENPILOT_ZEN=str(browser),
        )
    with (run / "browser.log").open("w") as log:
        proc = sp.Popen(
            [
                browser,
                "--headless",
                "--no-remote",
                "--profile",
                profile,
                *flags,
                "about:blank",
            ],
            stdout=log,
            stderr=sp.STDOUT,
            stdin=sp.DEVNULL,
            env=env,
            start_new_session=True,
        )
    stack.callback(stop, proc)
    if tool == "zen-browser-mcp":
        wait_for(lambda: Path(env["ZEN_MCP_SOCKET"]).is_socket(), proc)
        return ["node", str(ROOT / "dist/cli.js")]
    wait_for(lambda: port_ready(port), proc)
    return [str(zenpilot / ".venv/bin/zenpilot")]


def trial(args, tool, task, repeat, harness, browsers, env_base):
    log_dir = args.output / f"{repeat}-{tool}-{task}"
    log_dir.mkdir(exist_ok=False)
    row = {"tool": tool, "task": task, "repeat": repeat, "success": False}
    with (
        tempfile.TemporaryDirectory(prefix="zen-bench-run-") as directory,
        ExitStack() as stack,
    ):
        run = Path(directory)
        env = env_base.copy()
        for key in (
            "HOME",
            "XDG_CONFIG_HOME",
            "XDG_DATA_HOME",
            "XDG_STATE_HOME",
            "XDG_CACHE_HOME",
            "XDG_RUNTIME_DIR",
            "CODEX_HOME",
        ):
            path = run / key.lower()
            path.mkdir(mode=0o700)
            env[key] = str(path)
        env.update(
            ZEN_MCP_SOCKET=str(Path(env["XDG_RUNTIME_DIR"]) / "zen-mcp.sock"),
            ZEN_MCP_CHANNEL="0",
        )
        work = run / "work"
        work.mkdir()
        auth = Path(env["CODEX_HOME"]) / "auth.json"
        shutil.copyfile(args.auth, auth)
        auth.chmod(0o600)
        server, events = fixture(task)
        stack.callback(server.server_close)
        stack.callback(server.shutdown)
        try:
            with patch.dict(os.environ, env, clear=True):
                command = launch(
                    stack,
                    tool,
                    browsers[tool],
                    run,
                    env,
                    args.kitsune,
                    args.zenpilot,
                    harness,
                )
            config = Path(env["CODEX_HOME"]) / "config.toml"
            config.write_text(
                'web_search = "disabled"\nmodel_reasoning_effort = "low"\n'
                "[features]\nshell_tool = false\nunified_exec = false\nplugins = false\n"
                '[mcp_servers.browser]\nstartup_timeout_sec = 30\ndefault_tools_approval_mode = "approve"\n'
                f"command = {json.dumps(command[0])}\nargs = {json.dumps(command[1:])}\n"
                "[mcp_servers.browser.env]\n"
                + "".join(
                    f"{k} = {json.dumps(v)}\n"
                    for k, v in env.items()
                    if k.startswith(("XDG_", "KITSUNE_", "ZENPILOT_", "ZEN_MCP_"))
                )
                + f"HOME = {json.dumps(env['HOME'])}\n"
            )
            prompt = (
                "Use only the configured browser MCP to complete the task. Open a new agent-owned tab "
                "if the tool supports it. Keep all browsing on this local fixture. "
                f"URL: http://127.0.0.1:{server.server_port}/{task}\n{TASKS[task]}"
            )
            start = time.monotonic()
            with (
                (log_dir / "codex.jsonl").open("w") as out,
                (log_dir / "codex.stderr").open("w") as err,
            ):
                proc = sp.Popen(
                    [
                        args.codex,
                        "exec",
                        "--ignore-rules",
                        "--ephemeral",
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
                try:
                    row["exit"] = proc.wait(timeout=args.timeout)
                except sp.TimeoutExpired:
                    stop(proc)
                    row["error"] = "agent timeout"
            row["seconds"] = round(time.monotonic() - start, 2)
        except (AssertionError, OSError, RuntimeError, sp.SubprocessError) as error:
            row["error"] = str(error)
        finally:
            auth.unlink(missing_ok=True)
            browser_log = (
                run / "kitsune-browser" if tool == "kitsune" else run
            ) / "browser.log"
            if browser_log.exists():
                shutil.copyfile(browser_log, log_dir / "browser.log")
        log = log_dir / "codex.jsonl"
        if log.exists():
            messages = [
                json.loads(line)
                for line in log.read_text().splitlines()
                if line.startswith("{")
            ]
            items = [e["item"] for e in messages if e.get("type") == "item.completed"]
            calls = [i for i in items if i.get("type") == "mcp_tool_call"]
            answers = [i["text"] for i in items if i.get("type") == "agent_message"]
            usage = next(
                (
                    e["usage"]
                    for e in reversed(messages)
                    if e.get("type") == "turn.completed"
                ),
                None,
            )
            row.update(
                usage=usage,
                calls=len(calls),
                success=bool(
                    row.get("exit") == 0
                    and usage
                    and calls
                    and not any(
                        i.get("type") in {"command_execution", "web_search"}
                        for i in items
                    )
                    and grade(task, answers[-1] if answers else "", events)
                ),
            )
        (log_dir / "fixture.json").write_text(json.dumps(events))
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("browser", "kitsune", "zenpilot", "output", "auth"):
        parser.add_argument(
            f"--{name}", required=True, type=lambda p: Path(p).resolve()
        )
    parser.add_argument("--codex", default=shutil.which("codex"))
    parser.add_argument("--model", default="gpt-6.1-sol")
    parser.add_argument("--repeats", type=int, default=5)
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--tools", nargs="+", choices=TOOLS, default=TOOLS)
    parser.add_argument("--tasks", nargs="+", choices=TASKS, default=list(TASKS))
    args = parser.parse_args()
    if args.repeats < 1 or args.timeout < 1:
        parser.error("--repeats and --timeout must be positive")
    sys.path.insert(0, str(args.kitsune / "tests"))
    import real_browser_harness as harness

    args.output.mkdir(parents=True, exist_ok=False)
    # The harness must run under the pinned Kitsune virtualenv even when testing a different tool.
    env = {
        key: os.environ[key]
        for key in ("PATH", "LANG", "SSL_CERT_FILE", "SSL_CERT_DIR")
        if key in os.environ
    }
    with tempfile.TemporaryDirectory(prefix="zen-bench-app-") as directory:
        app_dir = Path(directory)
        clean = app_dir / "competitors"
        shutil.copytree(args.browser.parent, clean, symlinks=True)
        for name in ("zen-mcp.cfg", "defaults/pref/zen-mcp-prefs.js"):
            (clean / name).unlink(missing_ok=True)
        own = app_dir / "ours"
        shutil.copytree(clean, own, symlinks=True)
        browsers = {
            tool: (own if tool == "zen-browser-mcp" else clean) / args.browser.name
            for tool in TOOLS
        }
        order = [
            (tool, task, i)
            for i in range(1, args.repeats + 1)
            for task in args.tasks
            for tool in args.tools
        ]
        random.Random(42).shuffle(order)
        with (args.output / "results.jsonl").open("w", buffering=1) as out:
            for tool, task, repeat in order:
                row = trial(args, tool, task, repeat, harness, browsers, env)
                line = json.dumps(row)
                out.write(line + "\n")
                print(line, flush=True)


if __name__ == "__main__":
    main()
