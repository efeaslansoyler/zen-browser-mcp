// The `doctor` command: checks each part of the setup in turn and says what to do about problems
import fs from "node:fs";
import path from "node:path";
import { L } from "./i18n.ts";
import { skillStatus } from "./skill.ts";
import { claudeHookInstalled, claudeSettingsFile } from "./hooks.ts";
import { openCodePluginFile, openCodePluginInstalled } from "./opencode.ts";
import { findBrowsers, installedVersion, loaderStatus, unsupportedInstalls } from "./install.ts";
import { installationFor } from "./launch.ts";
import { agentProfile, PROFILES_DIR } from "./profiles.ts";
import { readConfig, readPermissions } from "./config.ts";
import { CONFIG_FILE, DATA_DIR, LOG_FILE, PACKAGE, PERMISSIONS_FILE, SERVER_NAME, VERSION } from "./paths.ts";
import { call } from "./zen.ts";
import { browserResolver, instanceLabel } from "./instances.ts";

const ok = (s: string) => console.log(`✓ ${s}`);
const bad = (s: string, fix?: string) => console.log(`✗ ${s}${fix ? `\n    → ${fix}` : ""}`);

export async function doctor() {
  let problems = 0;
  const fail = (s: string, fix?: string) => {
    problems++;
    bad(s, fix);
  };
  console.log(`${PACKAGE} ${VERSION}\n`);

  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 22) ok(`Node ${process.versions.node}`);
  else fail(`Node ${process.versions.node}`, L("Node 22 or newer is required.", "Node 22 ya da daha yenisi gerekli."));

  const browsers = findBrowsers();
  const loaded = browsers.filter((b) => loaderStatus(b.dir) !== "missing");
  for (const b of browsers) {
    const status = loaderStatus(b.dir);
    if (status === "missing") console.log(`  ${b.name} (${b.dir}): ${L("not installed", "kurulu değil")}`);
    else
      ok(
        `${b.name}: ${status === "legacy" ? L("loaded by a custom block", "elle eklenmiş blokla yükleniyor") : L("loader installed", "yükleyici kurulu")} (${b.dir})`,
      );
  }
  if (!loaded.length) {
    const flatpak = unsupportedInstalls();
    fail(
      L("No browser has the loader.", "Hiçbir tarayıcıda yükleyici yok."),
      `npx ${PACKAGE} install` +
        (flatpak.length
          ? L(
              ` (Flatpak/Snap can't be supported: ${flatpak.join(", ")})`,
              ` (Flatpak/Snap desteklenemiyor: ${flatpak.join(", ")})`,
            )
          : ""),
    );
  }

  const files = installedVersion();
  if (!files || !fs.existsSync(DATA_DIR))
    fail(L(`No browser files in ${DATA_DIR}.`, `${DATA_DIR} içinde tarayıcı dosyaları yok.`), `npx ${PACKAGE} install`);
  else if (files === "dev") ok(L(`${DATA_DIR} → development symlink`, `${DATA_DIR} → geliştirme bağı`));
  else if (files !== VERSION)
    console.log(
      `  ${L(`browser files ${files}, package ${VERSION}: updated when the MCP client starts the server`, `tarayıcı dosyaları ${files}, paket ${VERSION}: MCP istemcisi sunucuyu başlatınca güncellenir`)}`,
    );
  else ok(L(`browser files ${files}`, `tarayıcı dosyaları ${files}`));

  // The prompt hook is optional too: without it, what the user sends waits for the next tool call.
  if (fs.existsSync(path.dirname(claudeSettingsFile())))
    if (claudeHookInstalled()) ok(L("Claude Code: prompt hook installed", "Claude Code: prompt hook'u kurulu"));
    else
      console.log(
        `  Claude Code: ${L("prompt hook not installed", "prompt hook'u kurulu değil")} → npx ${PACKAGE} hooks install`,
      );
  if (fs.existsSync(path.dirname(path.dirname(openCodePluginFile()))))
    if (openCodePluginInstalled()) ok(L("OpenCode: plugin installed", "OpenCode: plugin kurulu"));
    else console.log(`  OpenCode: ${L("plugin not installed", "plugin kurulu değil")} → npx ${PACKAGE} hooks install`);

  // The skill is optional: report it, but never count it as a problem.
  for (const { client, status } of skillStatus()) {
    if (status === "current") ok(L(`${client}: skill installed`, `${client}: skill kurulu`));
    else
      console.log(
        `  ${client}: ${status === "missing" ? L("skill not installed", "skill kurulu değil") : L("skill outdated", "skill eski")} → npx ${PACKAGE} skill install`,
      );
  }

  try {
    const instances = await browserResolver.list();
    const { choice } = browserResolver.choice();
    console.log(`Browser mode: ${choice.browserMode}`);
    if (instances.length) console.log("Running browser instances:");
    for (const entry of instances)
      console.log(
        `  ${instanceLabel(entry)} (pid ${entry.pid}) — ${entry.browserMode ?? "together"} — ${entry.installationDir} — ${entry.profileDir}`,
      );
    const selected = await browserResolver.resolve().catch(() => undefined);
    let installation = selected?.instance?.installationDir;
    if (!installation) {
      try {
        installation = installationFor(choice.browser, () => browsers).dir;
      } catch {}
    }
    console.log(
      `Agent profile: ${installation ? agentProfile(installation) : path.join(PROFILES_DIR, "<installation>", "agent")}`,
    );
    const { socket, instance, reason } = selected ?? (await browserResolver.resolve());
    console.log(`Selected: ${instance ? `${instanceLabel(instance)} (pid ${instance.pid})` : socket} (${reason})`);
    const [reply] = await call("ping", {}, 5000);
    const info = JSON.parse(reply.type === "text" ? reply.text : "{}");
    ok(
      L(
        `bridge running in ${info.browser} ${info.browserVersion} (files ${info.version})`,
        `köprü ${info.browser} ${info.browserVersion} içinde çalışıyor (dosyalar ${info.version})`,
      ),
    );
    if (info.onDisk && info.version !== info.onDisk) {
      console.log(
        `  ${L(`files on disk are ${info.onDisk}; the bridge reloads them next time the MCP client starts the server`, `diskteki dosyalar ${info.onDisk}; köprü MCP istemcisi sunucuyu bir sonraki başlatışında yeniden yükler`)}`,
      );
    }
  } catch (error) {
    fail(
      (error as Error).message,
      L(
        `Is the browser open? After installing, restart it once. Errors: ${LOG_FILE}`,
        `Tarayıcı açık mı? Kurduktan sonra bir kez yeniden başlat. Hatalar: ${LOG_FILE}`,
      ),
    );
  }

  const config = readConfig();
  if (config.mode === "custom")
    try {
      readPermissions();
      ok(L(`custom permissions: ${PERMISSIONS_FILE}`, `özel izinler: ${PERMISSIONS_FILE}`));
    } catch (e) {
      fail(
        (e as Error).message,
        L(`fix the file, or: npx ${PACKAGE} config mode auto`, `dosyayı düzelt ya da: npx ${PACKAGE} config mode auto`),
      );
    }
  ok(
    L(
      `mode ${config.mode}, ${config.sites.mode} of ${config.sites[config.sites.mode].length} site(s) (${CONFIG_FILE})`,
      `mod ${config.mode}, ${config.sites[config.sites.mode].length} siteli ${config.sites.mode} (${CONFIG_FILE})`,
    ),
  );

  console.log(
    L(
      `\nIn Claude Code: claude mcp add --scope user ${SERVER_NAME} -- npx -y ${PACKAGE}`,
      `\nClaude Code'da: claude mcp add --scope user ${SERVER_NAME} -- npx -y ${PACKAGE}`,
    ),
  );
  console.log(`Codex: codex mcp add ${SERVER_NAME} -- npx -y ${PACKAGE}`);
  console.log(
    problems ? L(`\n${problems} problem(s).`, `\n${problems} sorun var.`) : L("\nAll good.", "\nHer şey yolunda."),
  );
  if (problems) process.exitCode = 1;
}
