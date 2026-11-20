# Browser token benchmark

On November 20, 2026, we ran Codex attempts on three browser tools using
the same Zen build: five per tool and task. The suite tests browser tool usage
on local fixtures. See [feature comparison](feature-comparison.md) for
differences in how the tools connect to a browser and work with the user.

## Results

Kitsune and ZenPilot come from the first run of 45 attempts. zen-browser-mcp
was measured again with the same setup after its round-trip and description
changes; its earlier attempts stay in the first data file. All 15 task and
repeat combinations passed for every tool, so the medians cover all attempts.

| Tool | Passed | Input tokens | Cached input | Non-cached input | Output tokens | MCP calls | Time |
|---|---:|---:|---:|---:|---:|---:|---:|
| zen-browser-mcp | 15/15 | 68.9k | 56.3k | 12.9k | 236 | 3 | 19.3 s |
| Kitsune, scripting off | 15/15 | 49.9k | 44.7k | 11.1k | 161 | 3 | 15.7 s |
| ZenPilot | 15/15 | 70.8k | 56.7k | 11.7k | 204 | 5 | 17.4 s |

Input, cached input and non-cached input are separate medians. The medians
for cached and non-cached input do not necessarily sum to the overall median.
The overall medians mix tasks of different sizes; compare tools per task.

### Input by task

Medians of five attempts, with the observed range in parentheses.
All values include cached input and are rounded to the nearest 0.1k tokens.

| Task | zen-browser-mcp | Kitsune | ZenPilot |
|---|---:|---:|---:|
| Inventory lookup | 51.4k (47.9–52.5k) | 49.9k (36.2–49.9k) | 90.2k (62.0–90.3k) |
| Dynamic board | 74.7k (67.2–95.6k) | 69.5k (49.0–69.6k) | 87.7k (61.4–110.6k) |
| Form draft | 71.0k (68.8–74.4k) | 69.8k (49.2–70.0k) | 62.1k (49.4–70.8k) |

Per task, zen-browser-mcp used 2–8% more median input than Kitsune, within
the spread of five attempts. Opening a tab with a URL can now return a page
snapshot in the same call, so a lookup takes one MCP call. Its earlier run
(revision 84b4b25) used separate tab, navigation and read calls and had a
median input of 92.7k.

Per-attempt data: [first run](benchmarks/codex-zen-2026-11-20.jsonl) and
[zen-browser-mcp rerun](benchmarks/codex-zen-2026-11-20-rerun.jsonl). They
contain outcomes, usage, call counts and durations, but no conversation
transcripts.

## Setup and scoring

Each attempt used Zen 1.24.3b (build 20261118023529), headless on Linux
x86-64, with Codex CLI 0.170.0, `gpt-6.1-sol`, and low reasoning effort.
Each started a fresh Zen process and profile, an ephemeral Codex conversation,
and an isolated Codex home with only that run's MCP server registered.
The bridge data, configs, runtime paths and localhost fixture were also new.

| Arm | Revision and settings |
|---|---|
| zen-browser-mcp 0.1.0 | [a667811](https://github.com/efeaslansoyler/zen-browser-mcp/tree/a667811083c0df0ec826b269e0c89d92e26261a1), built locally. Auto mode and a loopback-only site allowlist. |
| Kitsune 0.8.0 | [93d6e0a](https://github.com/junyeong-nero/kitsune/tree/93d6e0aaa494ceeaeef1aeed2b16a921ef8048a4), matching temporary development extension. `KITSUNE_SCRIPTING=0` uses its direct tools and disables unrestricted local Python. |
| ZenPilot 0.7.0 | [fe6b74d](https://github.com/beSaif/zenpilot/tree/fe6b74d1e83121b88dcdf48133c86d6e37583b00), connected over BiDi to the disposable browser. Loopback allowlist, with desktop prompts and auto-launch off. |

The harness runs five attempts per tool and task in a seeded shuffled order.
Codex shell and web search are disabled. The isolated client pre-approves its
one browser MCP. Each browser tool retains its product permissions.

| Task | Success condition |
|---|---|
| Inventory lookup | The fixture received a page request and Codex returned the exact SKU and stock as JSON. |
| Dynamic board | The fixture saw the refresh request and Codex returned the correct old and new codes. |
| Form draft | The latest input event carried both exact field values and the form stayed unsubmitted. |

Usage comes from Codex's `turn.completed` event. Input includes cached input.
Non-cached input is calculated per attempt by subtracting cached input.
The count includes Codex context, tool schemas and repeated model calls.
Provider-side caching can persist across fresh local sessions. These counts
do not estimate billing. Wall time starts at Codex launch, after browser setup.

These three small localhost tasks leave native approval dialogs, user-tab
focus, login reuse, real websites and recipes outside the measurement.
Kitsune's scripting-enabled default has a different tool surface. Vercel
Agent Browser uses Chrome by default and is outside this same-Zen run.
The other tools in the feature comparison have no usage figures here.

## Reproduce

Use local checkouts of the pinned competitor revisions and an extracted Zen
distribution. The harness copies the distribution into scratch space.
It needs Python 3.12 or newer, Codex CLI, Node.js and a Codex login file.
The harness uses authentication only in temporary Codex homes. Keep the
credential file outside the result directory.

```sh
npm ci
npm run build
uv sync --directory /absolute/path/to/kitsune --frozen
uv sync --directory /absolute/path/to/zenpilot --frozen

/absolute/path/to/kitsune/.venv/bin/python scripts/benchmark-browser.py \
  --browser /absolute/path/to/zen/zen \
  --kitsune /absolute/path/to/kitsune \
  --zenpilot /absolute/path/to/zenpilot \
  --auth /path/to/codex/auth.json \
  --output /tmp/zen-browser-benchmark
```

Pass `--tools zen-browser-mcp` to measure only this repository, as in the
rerun. Use a new output directory. Each run writes Codex events, fixture evidence
and browser logs there. `results.jsonl` records the metrics in run order.
