// Native extension UI, scoped to one agent session and the tab it was opened for.
// No extension-specific actions or background-script APIs are used.
export class ExtensionPanels {
  constructor(env) {
    this.env = env;
    this.entries = new Map();
  }
  async list() {
    return this.env.list();
  }
  discard(entry) {
    this.entries.delete(entry.window);
    try {
      entry.popup.closePopup();
    } catch {}
  }
  validate(entry, session, tabId, extensionId) {
    if (!entry || entry.session !== session || entry.tabId !== tabId || entry.extensionId !== extensionId) {
      throw new Error("No extension panel belongs to this session/tab. Open it with extensions first.");
    }
    this.env.check(entry.source, session);
    if (
      entry.window.gBrowser.selectedBrowser !== entry.source ||
      entry.source.browsingContext.currentWindowGlobal !== entry.document ||
      this.env.version(entry.source) !== entry.ownerVersion ||
      !this.env.panelAllowed(entry.popup, extensionId) ||
      entry.popup.destroyed ||
      !entry.popup.shown ||
      !entry.popup.browser?.isConnected
    ) {
      this.discard(entry);
      throw new Error("The extension panel closed or its target tab changed. Open it again and refresh refs.");
    }
    return entry;
  }
  get(source, session, tabId, extensionId) {
    return this.validate(this.entries.get(source.ownerDocument.defaultView), session, tabId, extensionId);
  }
  async open(source, session, tabId, extensionId) {
    this.env.check(source, session);
    const window = source.ownerDocument.defaultView;
    const old = this.entries.get(window);
    if (old) {
      if (old.session !== session && !old.popup.destroyed && old.popup.shown)
        throw new Error("Another session is using an extension panel in this window.");
      if (old.session === session && old.tabId === tabId && old.extensionId === extensionId) {
        try {
          return this.get(source, session, tabId, extensionId);
        } catch {
          /* expired */
        }
      }
      this.discard(old);
    }
    const extension = this.env.extension(extensionId);
    if (!extension) throw new Error("Extension not found or disabled; call extensions list for current IDs.");
    const action = this.env.action(extension);
    if (!action) throw new Error("This extension has no toolbar action; there is no panel/button to use.");
    if (this.env.busy(window))
      throw new Error("A browser menu or panel is already open. Close it before opening an extension.");
    // Extensions use the selected tab for tabs.query({active:true}) and activeTab grants.
    if (window.gBrowser.selectedBrowser !== source) {
      const selected = window.gBrowser.selectedBrowser;
      const document = source.browsingContext.currentWindowGlobal;
      const ownerVersion = this.env.version(source);
      if (!(await this.env.confirmSwitch(source, extension)))
        throw new Error("The user denied switching tabs; the extension was not invoked.");
      this.env.check(source, session);
      if (
        window.gBrowser.selectedBrowser !== selected ||
        source.browsingContext.currentWindowGlobal !== document ||
        this.env.version(source) !== ownerVersion ||
        this.env.busy(window)
      ) {
        throw new Error(
          "The tab or browser UI changed during the switch request. Nothing was switched; retry if still needed.",
        );
      }
      window.gBrowser.selectedTab = window.gBrowser.getTabForBrowser(source);
      // Let native tab/focus handlers finish before opening the toolbar popup.
      await this.env.wait(50);
      this.env.check(source, session);
      if (
        window.gBrowser.selectedBrowser !== source ||
        source.browsingContext.currentWindowGlobal !== document ||
        this.env.version(source) !== ownerVersion
      )
        throw new Error("Target changed after the approved switch; the extension was not invoked.");
    }
    this.env.check(source, session);
    const document = source.browsingContext.currentWindowGlobal;
    const popupURL = action.action.getPopupUrl(window.gBrowser.selectedTab);
    action.triggerAction(window);
    if (!popupURL) return { invoked: true, hasPopup: false, extensionId, tabId };
    let popup;
    try {
      for (let i = 0; i < 100; i++) {
        this.env.check(source, session);
        if (window.gBrowser.selectedBrowser !== source || source.browsingContext.currentWindowGlobal !== document)
          throw new Error("Target tab changed while opening the extension.");
        popup = this.env.popup(extension, window);
        if (popup?.shown && popup.browser?.browsingContext?.currentWindowGlobal) break;
        await this.env.wait(50);
      }
      if (!popup?.shown || !popup.browser?.browsingContext?.currentWindowGlobal)
        throw new Error("Extension panel did not open.");
      const entry = {
        popup,
        source,
        document,
        window,
        session,
        tabId,
        extensionId,
        ownerVersion: this.env.version(source),
      };
      this.entries.set(window, entry);
      return this.validate(entry, session, tabId, extensionId);
    } catch (error) {
      try {
        (popup || this.env.popup(extension, window))?.closePopup();
      } catch {}
      throw error;
    }
  }
  close(source, session, tabId, extensionId) {
    const entry = this.entries.get(source.ownerDocument.defaultView);
    if (!entry) return;
    if (entry.session !== session || entry.tabId !== tabId || entry.extensionId !== extensionId)
      throw new Error("This extension panel belongs to another session or tab.");
    this.discard(entry);
  }
  releaseTab(tabId) {
    for (const entry of this.entries.values()) if (entry.tabId === tabId) this.discard(entry);
  }
  releaseSession(session) {
    for (const entry of this.entries.values()) if (entry.session === session) this.discard(entry);
  }
  destroy() {
    for (const entry of this.entries.values()) this.discard(entry);
  }
}
