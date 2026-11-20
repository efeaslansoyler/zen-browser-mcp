// why: Requests and lifecycle subscriptions must resolve to the same browser within an MCP process.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { BROWSER_MODES, isTemporaryMode, parseBrowserMode, type BrowserMode } from "../browser/SiteRules.sys.mjs";
import { agentProfile, alive, isManagedProfile, profileOwner } from "./profiles.ts";
import { readConfig } from "./config.ts";
import { INSTANCES_DIR, LEGACY_SOCKET, PACKAGE } from "./paths.ts";

export type BrowserChoice = { browser?: string; profile?: string; browserMode?: BrowserMode };

type Metadata = {
  browser: string;
  installationDir: string;
  profileDir: string;
  profileName?: string;
  pid: number;
  browserMode?: BrowserMode;
  launchedByMcp?: boolean;
  profileOwner?: string;
  bridgeVersion: string;
  bridgeGeneration: number;
  startedAt: number;
  focusedAt: number;
};
export type Instance = Metadata & { socket: string };

export const profileLabel = (entry: Instance) => entry.profileName ?? path.basename(entry.profileDir);
export const instanceLabel = (entry: Instance) => `${entry.browser} / ${profileLabel(entry)}`;

function validMetadata(entry: Metadata | null): entry is Metadata {
  return (
    !!entry &&
    [entry.browser, entry.installationDir, entry.profileDir, entry.bridgeVersion].every(
      (value) => typeof value === "string" && value.length > 0,
    ) &&
    (entry.profileName === undefined || typeof entry.profileName === "string") &&
    (entry.browserMode === undefined || BROWSER_MODES.includes(entry.browserMode)) &&
    (entry.launchedByMcp === undefined || typeof entry.launchedByMcp === "boolean") &&
    (entry.profileOwner === undefined || typeof entry.profileOwner === "string") &&
    Number.isSafeInteger(entry.pid) &&
    entry.pid > 0 &&
    entry.pid <= 0x7fffffff &&
    [entry.startedAt, entry.focusedAt, entry.bridgeGeneration].every(Number.isFinite)
  );
}

const lstat = (file: string) => fs.lstatSync(file, { throwIfNoEntry: false });

// why: Permission errors and timeouts do not establish that an endpoint is dead.
export function listening(socketPath: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.setTimeout(1000, () => socket.destroy(new Error(`Timed out probing browser socket: ${socketPath}`)));
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNREFUSED" || error.code === "ENOENT") resolve(false);
      else reject(new Error(`Could not probe browser socket ${socketPath}: ${error.message}`));
    });
  });
}

function removeIfSame(file: string, previous: fs.Stats | undefined) {
  const current = lstat(file);
  if (previous && current?.ino === previous.ino && current.dev === previous.dev) {
    try {
      fs.unlinkSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export async function discoverInstances(dir = INSTANCES_DIR): Promise<Instance[]> {
  const directory = lstat(dir);
  if (!directory) return [];
  if (
    !directory.isDirectory() ||
    (directory.mode & 0o077) !== 0 ||
    (process.getuid && directory.uid !== process.getuid())
  )
    throw new Error(`Instance directory must belong to the current user and be private (0700): ${dir}`);

  const entries = await Promise.all(
    fs
      .readdirSync(dir)
      .filter((name) => /^[a-f0-9]{16}\.json$/.test(name))
      .map(async (name) => {
        const metadataPath = path.join(dir, name);
        const metadataStat = lstat(metadataPath);
        if (!metadataStat?.isFile() || (metadataStat.mode & 0o077) !== 0) return null;
        let entry: Metadata;
        try {
          entry = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
        } catch (error) {
          if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw error;
        }
        if (!validMetadata(entry)) return null;
        const socket = path.join(dir, name.replace(/\.json$/, ".sock"));
        const socketStat = lstat(socket);
        if (socketStat && !socketStat.isSocket()) return null;
        if (alive(entry.pid) && socketStat && (await listening(socket))) return { ...entry, socket };
        // why: Recheck metadata because it can change while probing.
        removeIfSame(socket, socketStat);
        removeIfSame(metadataPath, metadataStat);
        return null;
      }),
  );
  return entries.filter((entry) => entry !== null);
}

export function parseBrowserFlags(args: string[]): BrowserChoice {
  const choice: BrowserChoice = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1]?.trim();
    if (!["--browser", "--profile", "--browser-mode"].includes(flag) || !value || value.startsWith("--"))
      throw new Error(
        "Use: zen-browser-mcp [serve|doctor] [--browser <name|dir>] [--profile <name|dir>] [--browser-mode <mode>]",
      );
    if (flag === "--browser-mode") choice.browserMode = parseBrowserMode(value);
    else choice[flag === "--browser" ? "browser" : "profile"] = value;
  }
  return choice;
}

export function canonicalPath(input: string) {
  const dir = path.resolve(input.replace(/^~(?=\/|$)/, os.homedir()));
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
}

export function installationDirectory(input: string) {
  const dir = canonicalPath(input);
  return dir.endsWith(".app") ? canonicalPath(path.join(dir, "Contents", "Resources")) : dir;
}

export const profileDirectory = (profile?: string) => (profile?.includes("/") ? canonicalPath(profile) : undefined);

export function matchesProfile(entry: Instance, profile?: string) {
  const dir = profileDirectory(profile);
  return !profile || (dir ? canonicalPath(entry.profileDir) === dir : profileLabel(entry) === profile);
}

export function matchesMode(entry: Instance, mode: BrowserMode = "together") {
  const profile = canonicalPath(entry.profileDir);
  const actual = entry.browserMode ?? "together";
  if (mode === "together") return actual === mode && !isManagedProfile(profile);
  if (isTemporaryMode(mode)) return actual === mode && entry.launchedByMcp && entry.profileOwner === profileOwner;
  return (
    (actual === "agent" || actual === "autonomous-agent") &&
    profile === agentProfile(canonicalPath(entry.installationDir))
  );
}

function selectInstance(instances: Instance[], choice: BrowserChoice, source: string) {
  const { browser, profile, browserMode } = choice;
  const installation = browser && installationDirectory(browser);
  const matching = instances.filter(
    (entry) =>
      (!browser ||
        entry.browser.toLowerCase() === browser.toLowerCase() ||
        canonicalPath(entry.installationDir) === installation) &&
      matchesMode(entry, browserMode) &&
      matchesProfile(entry, profile),
  );
  const instance = matching.sort(
    (a, b) => b.focusedAt - a.focusedAt || b.startedAt - a.startedAt || a.socket.localeCompare(b.socket),
  )[0];
  if (!instance) return undefined;
  const reason =
    browser || profile ? source : matching.length === 1 ? "only running instance" : "most recently focused";
  return {
    socket: instance.socket,
    instance,
    reason: matching.length > 1 && (browser || profile) ? `${reason}, most recently focused match` : reason,
  };
}

export type Selection = { socket: string; instance?: Instance; reason: string };
type MissingSelection = { choice: BrowserChoice; source: string };
type LaunchSelection = (choice: BrowserChoice, list: () => Promise<Instance[]>) => Promise<Instance>;
const sameBrowser = (a: Selection, b: Selection) =>
  a.instance && b.instance
    ? a.instance.pid === b.instance.pid &&
      a.instance.startedAt === b.instance.startedAt &&
      a.instance.installationDir === b.instance.installationDir &&
      a.instance.profileDir === b.instance.profileDir
    : a.socket === b.socket;

export class BrowserResolver {
  flags: BrowserChoice = {};
  private selected?: Selection;
  private pending?: Promise<Selection | MissingSelection>;
  private pendingTool?: Promise<Selection>;
  private previous?: Selection;
  private deliveryProfile?: Instance;
  private mode?: BrowserMode;

  private readonly options: {
    dir: string;
    legacy: string;
    override?: string;
    env: NodeJS.ProcessEnv;
    config: () => BrowserChoice;
  };

  constructor(
    options: BrowserResolver["options"] = {
      dir: INSTANCES_DIR,
      legacy: LEGACY_SOCKET,
      env: process.env,
      config: readConfig,
    },
  ) {
    this.options = options;
  }

  private get override() {
    return this.options.override ?? this.options.env.ZEN_MCP_SOCKET;
  }

  list() {
    return this.override ? Promise.resolve([] as Instance[]) : discoverInstances(this.options.dir);
  }

  // why: Detached receivers follow the same profile through bridge reloads.
  pinDelivery(target: Selection) {
    if (!target.instance) return;
    this.selected = target;
    this.deliveryProfile = target.instance;
  }

  private remember(next: Selection) {
    if (this.selected && !sameBrowser(this.selected, next)) this.previous ??= this.selected;
    return (this.selected = next);
  }

  choice() {
    const { env, config } = this.options;
    const browser = this.flags.browser ?? env.ZEN_MCP_BROWSER?.trim();
    const profile = this.flags.profile ?? env.ZEN_MCP_PROFILE?.trim();
    const mode = this.flags.browserMode ?? env.ZEN_MCP_BROWSER_MODE?.trim();
    const settings = config();
    const browserMode = (this.mode ??= mode ? parseBrowserMode(mode) : (settings.browserMode ?? "together"));
    const overridden = browser || (browserMode === "together" && profile);
    return {
      choice: {
        browser: overridden ? browser : settings.browser,
        profile: browserMode === "together" ? (overridden ? profile : settings.profile) : undefined,
        browserMode,
      },
      source: overridden ? "MCP client override" : "config.json",
    };
  }

  private async select(): Promise<Selection | MissingSelection> {
    const { legacy } = this.options;
    const override = this.override;
    if (override) return { socket: override, reason: "ZEN_MCP_SOCKET" };
    const current = this.selected;
    if (current && (await listening(current.socket))) return current;
    let instances = await this.list();
    if (current?.instance) {
      const reload = () => instances.find((instance) => sameBrowser(current, { ...current, instance }));
      let reloaded = reload();
      if (!reloaded && alive(current.instance.pid)) {
        // why: Briefly tolerate a missing listener during reload because the next socket is published afterward.
        await sleep(200);
        instances = await this.list();
        reloaded = reload();
      }
      if (reloaded) return (this.selected = { ...current, instance: reloaded, socket: reloaded.socket });
    }
    if (this.deliveryProfile) {
      const profile = this.deliveryProfile;
      const instance = instances.find(
        (entry) => entry.installationDir === profile.installationDir && entry.profileDir === profile.profileDir,
      );
      if (!instance) throw new Error(`The selected browser ${instanceLabel(profile)} is not running.`);
      return (this.selected = { socket: instance.socket, instance, reason: "delivery profile" });
    }

    const { choice, source } = this.choice();
    const next = selectInstance(instances, choice, source);
    if (next) return this.remember(next);
    if (choice.browserMode === "together" && !choice.browser && !choice.profile && (await listening(legacy)))
      return this.remember({ socket: legacy, reason: "legacy socket fallback" });
    return { choice, source };
  }

  private probe() {
    return (this.pending ??= this.select().finally(() => (this.pending = undefined)));
  }

  async resolve(): Promise<Selection> {
    const next = await this.probe();
    if ("socket" in next) return next;
    const { browser, profile, browserMode } = next.choice;
    if (!browser && !profile && browserMode === "together")
      return { socket: this.options.legacy, reason: "legacy socket fallback" };
    const target = [
      browser && `browser "${browser}"`,
      profile && `profile "${profile}"`,
      browserMode !== "together" && `${browserMode} browser mode`,
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `The selected ${target} (${next.source}) is not running. Open it, or check with \`${PACKAGE} doctor\`.`,
    );
  }

  // why: Passive discovery must not prompt or auto-launch a browser.
  resolveForTool(launch: LaunchSelection): Promise<Selection> {
    return (this.pendingTool ??= this.probe()
      .then(async (next) => {
        if ("socket" in next) return next;
        const instance = await launch(next.choice, () => this.list());
        return this.remember({ socket: instance.socket, instance, reason: "on-demand browser" });
      })
      .finally(() => (this.pendingTool = undefined)));
  }

  browserChange(next: Selection) {
    if (!this.previous || next !== this.selected) return;
    const from = this.previous.instance ? instanceLabel(this.previous.instance) : this.previous.socket;
    const to = next.instance ? instanceLabel(next.instance) : next.socket;
    this.previous = undefined;
    return `The browser changed from ${from} to ${to}. Previous tab IDs and element references are invalid. Call tabs_context_mcp again.`;
  }
}

export const browserResolver = new BrowserResolver();

// why: A watcher or relay must stay bound to its original profile when another client selects another browser.
export function deliveryScope(target?: Selection) {
  const instance = target?.instance;
  const override = target ? target.reason === "ZEN_MCP_SOCKET" && target.socket : process.env.ZEN_MCP_SOCKET;
  const identity = instance ? [instance.installationDir, instance.profileDir] : override ? [override] : [];
  return identity.length ? createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 12) : "";
}
