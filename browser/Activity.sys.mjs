// What agents are doing: the short description shown on the island, and the activity log in
// ~/.local/state/<app>/activity.jsonl (one line per tool call, rotated to activity.1.jsonl
// past 5 MB) that the tab menu's history views read.
const MAX_ACTIVITY = 5 * 1048576;

export function activity(ctx) {
  // The island text: "example.com — clicking"
  function describeAction(tool, args, browser, withHost = true) {
    const { L } = ctx;
    let host = "";
    try {
      host = browser.currentURI.host;
    } catch {}
    const what =
      {
        navigate: () => {
          if (args.url === "back") return L("going back", "geri gidiyor");
          if (args.url === "forward") return L("going forward", "ileri gidiyor");
          try {
            host = Services.uriFixup.getFixupURIInfo(args.url).preferredURI.host;
          } catch {}
          return L("opening the page", "sayfayı açıyor");
        },
        computer: () =>
          ({
            screenshot: L("looking at the page", "ekrana bakıyor"),
            left_click: L("clicking", "tıklıyor"),
            right_click: L("right-clicking", "sağ tıklıyor"),
            double_click: L("double-clicking", "çift tıklıyor"),
            triple_click: L("clicking", "tıklıyor"),
            hover: L("hovering", "fareyi gezdiriyor"),
            left_click_drag: L("dragging", "sürüklüyor"),
            scroll: L("scrolling", "kaydırıyor"),
            scroll_to: L("scrolling", "kaydırıyor"),
            type: L("typing", "yazıyor"),
            key: L("pressing keys", "tuşa basıyor"),
            wait: L("waiting", "bekliyor"),
          })[args.action] ?? L("working", "çalışıyor"),
        read_page: () => L("reading the page", "sayfayı okuyor"),
        react: () => L("inspecting React components", "React bileşenlerini inceliyor"),
        accessibility: () => L("checking accessibility", "erişilebilirliği denetliyor"),
        get_page_text: () => L("reading the page", "sayfayı okuyor"),
        find: () => L(`looking for "${args.query}"`, `"${args.query}" arıyor`),
        form_input: () => L("filling in the form", "formu dolduruyor"),
        file_upload: () => L("uploading a file", "dosya yüklüyor"),
        javascript_tool: () => L("running code on the page", "sayfada kod çalıştırıyor"),
        read_console_messages: () => L("reading the console", "konsolu okuyor"),
        read_network_requests: () => L("checking network requests", "ağ isteklerine bakıyor"),
        handle_dialog: () => L("answering a dialog", "diyaloğu cevaplıyor"),
        ask_user: () => L("needs you", "senden bir şey istiyor"),
        request_tab: () => L("asks for this tab", "sekmeye erişmek istiyor"),
        tabs_close_mcp: () => L("closing the tab", "sekmeyi kapatıyor"),
        wait_for: () => L("waiting", "bekliyor"),
        watch: () =>
          args.action === "stop"
            ? L("stopping a watch", "izlemeyi bitiriyor")
            : args.action === "list"
              ? L("checking watches", "izlemelere bakıyor")
              : L("starting to watch the page", "sayfayı izlemeye başlıyor"),
        downloads: () =>
          args.action === "wait"
            ? L("waiting for a download", "indirmeyi bekliyor")
            : args.action === "cancel"
              ? L("canceling a download", "indirmeyi iptal ediyor")
              : L("checking downloads", "indirmelere bakıyor"),
        extensions: () => L("using extension UI", "eklenti arayüzünü kullanıyor"),
        clipboard: () => L("requesting clipboard access", "pano erişimi istiyor"),
      }[tool]?.() ?? L("working", "çalışıyor");
    return host && withHost ? `${host} — ${what}` : what;
  }

  function logActivity(entry) {
    try {
      const file = ctx.localFile(ctx.activityPath);
      if (file.exists() && file.fileSize > MAX_ACTIVITY) file.moveTo(null, "activity.1.jsonl");
      ctx.writeTextFile(ctx.localFile(ctx.activityPath), JSON.stringify(entry) + "\n", { append: true });
    } catch (e) {
      ctx.logError("activity log", e);
    }
  }

  // Tab IDs are reused after a browser restart, so history starts at this browser launch.
  async function tabHistory(tabId, limit = 15) {
    const { readRecent, formatLine } = ctx.activityView;
    const entries = await readRecent(ctx.activityPath);
    return entries
      .filter((e) => e.tab === tabId && Date.parse(e.t) >= ctx.browserStart)
      .slice(-limit)
      .reverse()
      .map((e) => formatLine(e, ctx.L));
  }

  // Written to a local file and opened in a new tab for the user (never given to an agent).
  async function openHistory(win) {
    const { readRecent, renderPage } = ctx.activityView;
    const entries = (await readRecent(ctx.activityPath, 2 * 1048576)).slice(-500);
    const path = `${ctx.runtimeDir}/${ctx.app}-history.html`;
    await IOUtils.writeUTF8(path, renderPage(entries, ctx.L, ctx.activityPath), { mode: "overwrite" });
    await IOUtils.setPermissions(path, 0o600).catch(() => {});
    const tab = win.gBrowser.addTrustedTab(Services.io.newFileURI(ctx.localFile(path)).spec, { inBackground: false });
    win.gBrowser.selectedTab = tab;
  }

  return { describeAction, logActivity, tabHistory, openHistory };
}
