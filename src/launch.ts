import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { launchRule, setLaunchPreference } from "./config.ts";
import { browserAt, findBrowsers, type Browser } from "./install.ts";
import {
  canonicalPath,
  installationDirectory,
  matchesProfile,
  profileDirectory,
  type BrowserChoice,
  type Instance,
} from "./instances.ts";
import { LOG_FILE, PACKAGE } from "./paths.ts";

type LaunchRequest = {
  installation: Browser;
  profile?: string;
  headless: boolean;
  extraArgs?: string[];
  extraEnv?: NodeJS.ProcessEnv;
};

export type LaunchApproval = (label: string) => Promise<"open" | "always" | "declined">;
type StartBrowser = (file: string, args: string[], options: SpawnOptions) => ChildProcess;

function installationFor(browser: string | undefined, installed: () => Browser[]): Browser {
  if (browser?.includes("/")) {
    const installation = browserAt(installationDirectory(browser));
    if (installation) return installation;
  } else {
    const installation = installed().find((entry) => !browser || entry.name.toLowerCase() === browser.toLowerCase());
    if (installation) return installation;
  }
  throw new Error(
    `No browser installation found${browser ? ` for "${browser}"` : ""}. Check with \`npx ${PACKAGE} doctor\` or set ` +
      `the folder containing application.ini with \`npx ${PACKAGE} config browser <dir>\`.`,
  );
}

export function browserExecutable(installation: Browser, platform = process.platform): string {
  const { dir, name } = installation;
  if (platform !== "linux" && platform !== "darwin")
    throw new Error("On-demand browser startup is supported on Linux and macOS.");
  const binDir = platform === "darwin" ? path.join(dir, "..", "MacOS") : dir;
  const ini = fs.readFileSync(path.join(dir, "application.ini"), "utf8");
  const remote = /^RemotingName=(.+)$/m.exec(ini)?.[1].trim();
  const app = name.toLowerCase();
  // Some distro builds use a channel-specific remoting name and a plain executable name.
  for (const candidate of [app, remote, app.replaceAll(" ", "-"), path.basename(dir)]) {
    if (!candidate || !/^[a-z0-9][a-z0-9 ._-]*$/i.test(candidate)) continue;
    const file = path.join(binDir, candidate);
    try {
      if (!fs.statSync(file).isFile()) continue;
      fs.accessSync(file, fs.constants.X_OK);
      return file;
    } catch {}
  }
  throw new Error(`No executable for ${name} found in ${binDir}. Check with \`npx ${PACKAGE} doctor\`.`);
}

function startBrowser(request: LaunchRequest, start: StartBrowser) {
  const dir = profileDirectory(request.profile);
  const profileArgs = dir ? ["--profile", dir] : request.profile ? ["-P", request.profile] : [];
  const env = { ...process.env, ...request.extraEnv };
  delete env.ZEN_MCP_BROWSER;
  delete env.ZEN_MCP_PROFILE;
  const args = [...profileArgs, ...(request.headless ? ["--headless"] : []), ...(request.extraArgs ?? [])];
  return start(browserExecutable(request.installation), args, { env, detached: true, stdio: "ignore" });
}

export function createBrowserLauncher({
  find = findBrowsers,
  start = spawn,
  timeout = 30_000,
  extraArgs,
  extraEnv,
}: {
  find?: typeof findBrowsers;
  start?: StartBrowser;
  timeout?: number;
  extraArgs?: string[];
  extraEnv?: NodeJS.ProcessEnv;
} = {}) {
  // A process that outlasts its startup timeout still owns its profile. Don't spawn again.
  const starting = new Map<string, ChildProcess>();
  const instructions =
    `Check with \`npx ${PACKAGE} doctor\`, install the loader with \`npx ${PACKAGE} install\` and restart the browser. ` +
    `Bridge log: ${LOG_FILE}.`;
  return async (
    { browser, profile }: BrowserChoice,
    list: () => Promise<Instance[]>,
    approve?: LaunchApproval,
  ): Promise<Instance> => {
    const installation = installationFor(browser, find);
    const label = `${installation.name} / ${profile ?? "default profile"}`;
    const key = JSON.stringify([installation.dir, profileDirectory(profile) ?? profile]);
    const matching = async (pid?: number) =>
      (await list()).find(
        (entry) =>
          (pid === undefined || entry.pid === pid) &&
          canonicalPath(entry.installationDir) === installation.dir &&
          matchesProfile(entry, profile),
      );

    const running = await matching();
    if (running) return running;
    if (starting.has(key)) throw new Error(`${label} is already running without a live bridge. ${instructions}`);
    const denied = () => new Error(`Opening ${label} is denied by the user's browser.launch permission.`);
    const rule = launchRule();
    if (rule === "deny") throw denied();
    if (rule === "ask") {
      if (!approve)
        throw new Error(
          `${label} is closed and this MCP client cannot ask for launch approval. Ask the user to open it, ` +
            `or they can run \`npx ${PACKAGE} config launch allow\` to allow startup.`,
        );
      const answer = await approve(label);
      if (answer === "declined") throw new Error(`The user declined to open ${label}.`);
      if (launchRule() === "deny") throw denied();
      if (answer === "always") setLaunchPreference("allow");
      // A matching bridge may have started while the user was answering.
      const opened = await matching();
      if (opened) return opened;
    }

    const child = startBrowser({ installation, profile, headless: false, extraArgs, extraEnv }, start);
    starting.set(key, child);
    const clear = () => {
      if (starting.get(key) === child) starting.delete(key);
    };
    let spawnError: Error | undefined;
    child.once("error", (error) => {
      spawnError = error;
      clear();
    });
    child.once("exit", clear);
    child.unref();
    const deadline = performance.now() + timeout;
    while (true) {
      if (spawnError) throw new Error(`Could not start ${label}: ${spawnError.message}`);
      const instance = child.pid === undefined ? undefined : await matching(child.pid);
      if (instance) {
        clear();
        return instance;
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        clear();
        const status = child.exitCode === 0 ? "may already be running" : "failed to start or is already running";
        throw new Error(`${label} ${status} without a live bridge. ${instructions}`);
      }
      const remaining = deadline - performance.now();
      if (remaining <= 0)
        throw new Error(
          `Timed out waiting for the bridge for ${label}. The profile may already be running. ${instructions}`,
        );
      await sleep(Math.min(200, remaining));
    }
  };
}
