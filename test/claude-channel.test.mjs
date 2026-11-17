import test from "node:test";
import assert from "node:assert/strict";
import { channelArgs } from "../src/claude.ts";

test("a channel needs the flag with this server, in an interactive Claude Code", () => {
  const flag = ["--dangerously-load-development-channels", "server:zen"];
  assert.equal(channelArgs(["claude", ...flag]), true);
  assert.equal(channelArgs(["claude", "--channels", "server:other"]), false);
  // Claude Code ignores the flag under the Agent SDK (T3 Code) and in -p mode
  assert.equal(
    channelArgs(["claude", "--output-format", "stream-json", "--input-format", "stream-json", ...flag]),
    false,
  );
  assert.equal(channelArgs(["claude", "--input-format=stream-json", ...flag]), false);
  assert.equal(channelArgs(["claude", "-p", "hi", ...flag]), false);
});
