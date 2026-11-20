import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { launchRule, setLaunchPreference } from "./config.ts";
import { browserAt, findBrowsers, type Browser } from "./install.ts";
import {
  canonicalPath,
  discoverInstances,
  installationDirectory,
  matchesProfile,
  matchesMode,
  profileDirectory,
  type BrowserChoice,
  type Instance,
} from "./instances.ts";
import { LOG_FILE, PACKAGE } from "./paths.ts";
import { isAutonomousMode, isTemporaryMode, type BrowserMode } from "../browser/SiteRules.sys.mjs";
import {
  agentProfile,
  createTemporaryProfile,
  geckoProfileInUse,
  isManagedProfile,
  prepareProfile,
  profileOwner,
  recordTemporaryBrowser,
  removeProfile,
  reserveAgentProfile,
} from "./profiles.ts";

type LaunchRequest = {
  installation: Browser;
  profile?: string;
  mode: BrowserMode;
  extraArgs?: string[];
  extraEnv?: NodeJS.ProcessEnv;
};

export type LaunchApproval = (label: string) => Promise<"open" | "always" | "declined">;
type StartBrowser = (file: string, args: string[], options: SpawnOptions) => ChildProcess;

export function installationFor(browser: string | undefined, installed: () => Browser[]): Browser {
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

export async function resetAgentProfile(browser?: string) {
  const installation = installationFor(browser, findBrowsers);
  const profile = agentProfile(canonicalPath(installation.dir));
  const running = () => new Error(`Close the agent browser before resetting its profile: ${profile}`);
  if ((await discoverInstances()).some((entry) => canonicalPath(entry.profileDir) === profile)) throw running();
  const release = reserveAgentProfile(profile);
  if (!release) throw running();
  try {
    if (geckoProfileInUse(profile)) throw running();
    removeProfile(profile);
  } finally {
    release();
  }
  return profile;
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
  delete env.ZEN_MCP_LAUNCHED_PROFILE;
  delete env.ZEN_MCP_PROFILE_OWNER;
  env.ZEN_MCP_BROWSER_MODE = request.mode;
  env.ZEN_MCP_LAUNCHED = "1";
  const dedicated = request.mode !== "together";
  if (dedicated) env.ZEN_MCP_LAUNCHED_PROFILE = dir;
  if (isTemporaryMode(request.mode)) env.ZEN_MCP_PROFILE_OWNER = profileOwner;
  const args = [
    ...profileArgs,
    ...(dedicated ? ["--new-instance", "--no-remote"] : []),
    ...(isAutonomousMode(request.mode) ? ["--headless"] : []),
    ...(request.extraArgs ?? []),
  ];
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
  const temporaryChildren = new Map<ChildProcess, Promise<void>>();
  let closed = false;

  async function launch(
    { browser, profile, browserMode: mode = "together" }: BrowserChoice,
    list: () => Promise<Instance[]>,
    approve?: LaunchApproval,
  ): Promise<Instance> {
    const installation = installationFor(browser, find);
    installation.dir = canonicalPath(installation.dir);
    const temporary = isTemporaryMode(mode);
    const persistent = mode === "agent" || mode === "autonomous-agent";
    if (persistent) profile = agentProfile(installation.dir);
    if (temporary) profile = undefined;
    const dir = profileDirectory(profile);
    if (mode === "together" && dir && isManagedProfile(dir))
      throw new Error("Use an agent browser mode to open a managed profile.");
    const label = `${installation.name} / ${mode === "together" ? (profile ?? "default profile") : mode}`;
    const key = JSON.stringify([installation.dir, dir ?? profile, mode]);
    const matching = async (pid?: number) =>
      (await list()).find(
        (entry) =>
          (pid === undefined || entry.pid === pid) &&
          canonicalPath(entry.installationDir) === installation.dir &&
          matchesMode(entry, mode) &&
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
      const opened = await matching();
      if (opened) return opened;
    }

    const deadline = performance.now() + timeout;
    const timedOut = () =>
      new Error(`Timed out waiting for the bridge for ${label}. The profile may already be running. ${instructions}`);
    const checkOpen = () => {
      if (closed) throw new Error("The MCP client disconnected before browser startup finished.");
    };
    let release: (() => void) | undefined;
    let child: ChildProcess | undefined;
    let spawnedProfile: string | undefined;
    try {
      if (persistent) {
        for (;;) {
          checkOpen();
          release = reserveAgentProfile(profile!);
          if (release && !geckoProfileInUse(profile!)) break;
          release?.();
          release = undefined;
          const started = await matching();
          if (started) return started;
          if (performance.now() >= deadline) throw timedOut();
          await sleep(200);
        }
        // A starter might have released its reservation just before we acquired it.
        const started = await matching();
        if (started) return started;
      }
      checkOpen();
      if (temporary) profile = spawnedProfile = createTemporaryProfile();
      if (mode !== "together") prepareProfile(profile!);
      child = startBrowser({ installation, profile, mode, extraArgs, extraEnv }, start);
      const processStarted = child;
      starting.set(key, child);
      const clear = () => {
        if (starting.get(key) === processStarted) starting.delete(key);
      };
      let spawnError: Error | undefined;
      child.once("error", (error) => {
        spawnError = error;
        clear();
      });
      child.once("exit", clear);
      if (spawnedProfile) {
        const profileToRemove = spawnedProfile;
        const finished = new Promise<void>((resolve) => {
          const remove = () => {
            temporaryChildren.delete(processStarted);
            try {
              removeProfile(profileToRemove);
            } catch (error) {
              console.error(`Could not remove temporary profile ${profileToRemove}: ${(error as Error).message}`);
            } finally {
              resolve();
            }
          };
          processStarted.once("exit", remove);
          processStarted.once("error", remove);
        });
        temporaryChildren.set(child, finished);
      }
      child.unref();
      if (spawnedProfile && child.pid !== undefined) recordTemporaryBrowser(spawnedProfile, child.pid);
      while (true) {
        checkOpen();
        if (spawnError) throw new Error(`Could not start ${label}: ${spawnError.message}`);
        const instance = child.pid === undefined ? undefined : await matching(persistent ? undefined : child.pid);
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
        if (remaining <= 0) throw timedOut();
        await sleep(Math.min(200, remaining));
      }
    } catch (error) {
      if (spawnedProfile) {
        if (!child) removeProfile(spawnedProfile);
        else if (!closed && child.exitCode === null && child.signalCode === null) child.kill();
      }
      throw error;
    } finally {
      release?.();
    }
  }

  return Object.assign(launch, {
    async close(quitRequested = false) {
      closed = true;
      await Promise.all(
        [...temporaryChildren].map(async ([child, finished]) => {
          // The bridge gets the first chance to quit. A failed startup might have no bridge.
          if (quitRequested) await Promise.race([finished, sleep(1800)]);
          if (!temporaryChildren.has(child)) return;
          child.kill();
          await Promise.race([finished, sleep(1200)]);
          if (temporaryChildren.has(child)) {
            child.kill("SIGKILL");
            await Promise.race([finished, sleep(500)]);
          }
        }),
      );
    },
  });
}
