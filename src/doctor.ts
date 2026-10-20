// `doctor` komutu: kurulumun her parçasını sırayla kontrol eder, sorun varsa ne yapılacağını söyler
import fs from "node:fs";
import { L } from "./i18n.ts";
import { findBrowsers, installedVersion, loaderStatus, unsupportedInstalls } from "./install.ts";
import { readConfig } from "./config.ts";
import { CONFIG_FILE, DATA_DIR, LOG_FILE, NAME, SERVER_NAME, SOCKET, VERSION } from "./paths.ts";
import { call } from "./zen.ts";

const ok = (s: string) => console.log(`✓ ${s}`);
const bad = (s: string, fix?: string) => console.log(`✗ ${s}${fix ? `\n    → ${fix}` : ""}`);

export async function doctor() {
  let problems = 0;
  const fail = (s: string, fix?: string) => {
    problems++;
    bad(s, fix);
  };
  console.log(`${NAME} ${VERSION}\n`);

  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 22) ok(`Node ${process.versions.node}`);
  else fail(`Node ${process.versions.node}`, L("Node 22 or newer is required.", "Node 22 ya da daha yenisi gerekli."));

  const browsers = findBrowsers();
  const loaded = browsers.filter((b) => loaderStatus(b.dir) !== "missing");
  for (const b of browsers) {
    const status = loaderStatus(b.dir);
    if (status === "missing") console.log(`  ${b.name} (${b.dir}): ${L("not installed", "kurulu değil")}`);
    else ok(`${b.name}: ${status === "legacy" ? L("loaded by a custom block", "elle eklenmiş blokla yükleniyor") : L("loader installed", "yükleyici kurulu")} (${b.dir})`);
  }
  if (!loaded.length) {
    const flatpak = unsupportedInstalls();
    fail(L("No browser has the loader.", "Hiçbir tarayıcıda yükleyici yok."),
      `npx ${NAME} install` + (flatpak.length ? L(` (Flatpak/Snap can't be supported: ${flatpak.join(", ")})`, ` (Flatpak/Snap desteklenemiyor: ${flatpak.join(", ")})`) : ""));
  }

  const files = installedVersion();
  if (!files || !fs.existsSync(DATA_DIR)) fail(L(`No browser files in ${DATA_DIR}.`, `${DATA_DIR} içinde tarayıcı dosyaları yok.`), `npx ${NAME} install`);
  else if (files === "dev") ok(L(`${DATA_DIR} → development symlink`, `${DATA_DIR} → geliştirme bağı`));
  else if (files !== VERSION) console.log(`  ${L(`browser files ${files}, package ${VERSION}: updated when the MCP client starts the server`, `tarayıcı dosyaları ${files}, paket ${VERSION}: MCP istemcisi sunucuyu başlatınca güncellenir`)}`);
  else ok(L(`browser files ${files}`, `tarayıcı dosyaları ${files}`));

  try {
    const [reply] = await call("ping", {}, 5000);
    const info = JSON.parse(reply.type === "text" ? reply.text : "{}");
    ok(L(`bridge running in ${info.browser} ${info.browserVersion} (files ${info.version})`, `köprü ${info.browser} ${info.browserVersion} içinde çalışıyor (dosyalar ${info.version})`));
    if (info.onDisk && info.version !== info.onDisk) {
      console.log(`  ${L(`files on disk are ${info.onDisk}; the bridge reloads them next time the MCP client starts the server`, `diskteki dosyalar ${info.onDisk}; köprü MCP istemcisi sunucuyu bir sonraki başlatışında yeniden yükler`)}`);
    }
  } catch {
    fail(L(`The bridge doesn't answer on ${SOCKET}.`, `Köprü ${SOCKET} üzerinden cevap vermiyor.`),
      L(`Is the browser open? After installing, restart it once. Errors: ${LOG_FILE}`, `Tarayıcı açık mı? Kurduktan sonra bir kez yeniden başlat. Hatalar: ${LOG_FILE}`));
  }

  const config = readConfig();
  ok(L(`mode ${config.mode}, ${Object.keys(config.sites).length} site rule(s) (${CONFIG_FILE})`, `mod ${config.mode}, ${Object.keys(config.sites).length} site kuralı (${CONFIG_FILE})`));

  console.log(L(`\nIn Claude Code: claude mcp add --scope user ${SERVER_NAME} -- npx -y ${NAME}`, `\nClaude Code'da: claude mcp add --scope user ${SERVER_NAME} -- npx -y ${NAME}`));
  console.log(`Codex: codex mcp add ${SERVER_NAME} -- npx -y ${NAME}`);
  console.log(problems ? L(`\n${problems} problem(s).`, `\n${problems} sorun var.`) : L("\nAll good.", "\nHer şey yolunda."));
  if (problems) process.exitCode = 1;
}
