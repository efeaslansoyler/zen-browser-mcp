import { spawn } from "node:child_process";

const [step, ...rest] = JSON.parse(process.env.ZEN_TEST_CHAIN);
if (step) {
  const env = { ...process.env, ...step.env, ZEN_TEST_CHAIN: JSON.stringify(rest), ZEN_TEST_CLIENT: process.pid };
  const [command, args] = step.shell
    ? ["sh", ["-c", `"$0" "$1"; exit $?`, process.execPath, import.meta.filename]]
    : [process.execPath, [import.meta.filename, ...(step.args ?? [])]];
  spawn(command, args, { env, stdio: "inherit" }).on("exit", (code) => process.exit(code ?? 1));
} else {
  const { t3Thread } = await import("../../src/delivery.ts");
  const { channelEnabled } = await import("../../src/claude.ts");
  const { promptHook } = await import("../../src/hooks.ts");
  let asked;
  await promptHook("antigravity", {}, async (_tool, args) => {
    asked = args.pids;
    return [];
  });
  const hook = asked.map((pid) => (pid === Number(process.env.ZEN_TEST_CLIENT) ? "client" : "other"));
  process.stdout.write(JSON.stringify({ t3: t3Thread()?.threadId ?? null, channel: channelEnabled(), hook }));
}
