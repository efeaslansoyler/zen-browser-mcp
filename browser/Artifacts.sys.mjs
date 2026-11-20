const TTL = 5 * 60_000;

export class Artifacts {
  constructor(dir, timers) {
    this.dir = dir;
    this.timers = timers;
  }

  async sweep() {
    await IOUtils.makeDirectory(this.dir, { permissions: 0o700 });
    for (const path of await IOUtils.getChildren(this.dir)) {
      if (!/^(page|video)-[0-9a-f-]+\.(pdf|webm)$/.test(PathUtils.filename(path))) continue;
      const info = await IOUtils.stat(path).catch(() => null);
      if (info?.type === "regular" && Date.now() - info.lastModified > TTL) await IOUtils.remove(path).catch(() => {});
    }
  }

  async path(prefix, extension) {
    await IOUtils.makeDirectory(this.dir, { permissions: 0o700 });
    const id = Services.uuid.generateUUID().toString().slice(1, -1);
    return PathUtils.join(this.dir, `${prefix}-${id}.${extension}`);
  }

  async save(path) {
    const { size } = await IOUtils.stat(path);
    if (!size) throw new Error("The exported file is empty.");
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(path);
    file.permissions = 0o600;
    this.timers.setTimeout(() => this.remove(path), TTL);
    return size;
  }

  remove(path) {
    return IOUtils.remove(path, { ignoreAbsent: true }).catch(() => {});
  }
}

export function pagePDF(ctx) {
  return async ({ tabId }, call) => {
    const browser = ctx.browserFor(call, tabId);
    const bc = browser.browsingContext;
    if (!bc?.currentWindowGlobal) throw new Error("The page has not loaded yet.");
    const path = await ctx.artifacts.path("page", "pdf");
    const settings = Cc["@mozilla.org/gfx/printsettings-service;1"]
      .getService(Ci.nsIPrintSettingsService)
      .createNewPrintSettings();
    const constants = Ci.nsIPrintSettings;
    settings.isInitializedFromPrefs = true;
    settings.isInitializedFromPrinter = true;
    settings.printSilent = true;
    settings.outputFormat = constants.kOutputFormatPDF;
    settings.outputDestination = constants.kOutputDestinationFile;
    settings.toFileName = path;
    settings.usePageRuleSizeAsPaperSize = true;
    for (const side of ["Left", "Center", "Right"]) {
      settings["headerStr" + side] = "";
      settings["footerStr" + side] = "";
    }
    call.check();
    const document = bc.currentWindowGlobal;
    // Gecko completes the print before settling its promise and does not return a page count.
    const printing = bc.print(settings);
    let timer;
    try {
      const timeout = new Promise((_, reject) => {
        timer = ctx.setTimeout(() => reject(new Error("The page did not finish printing within 30 s.")), 30_000);
      });
      await ctx.guard(Promise.race([printing, timeout]), call);
      ctx.assertSiteAccess(browser);
      if (browser.browsingContext?.currentWindowGlobal !== document)
        throw new Error("The page changed during printing.");
      const bytes = await ctx.artifacts.save(path);
      call.check();
      return ctx.text({ path, bytes });
    } catch (error) {
      // On Stop the platform print can still finish writing asynchronously.
      void printing.finally(() => ctx.artifacts.remove(path)).catch(() => {});
      throw error;
    } finally {
      ctx.clearTimeout(timer);
    }
  };
}
