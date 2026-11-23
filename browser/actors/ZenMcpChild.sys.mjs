const load = (name) =>
  ChromeUtils.importESModule(new URL(name, import.meta.url).href + new URL(import.meta.url).search);
const { agentTheme, applyTheme } = load("../Agent.sys.mjs");
const { mousePath, typingPlan } = load("../InputMotion.sys.mjs");
const { Cancellation } = load("../Cancellation.sys.mjs");
const reader = load("./PageReader.sys.mjs");
const info = load("./ElementInfo.sys.mjs");
const { VirtualCursor, ripple, outlineAndWait, highlight } = load("./Overlays.sys.mjs");
const { Picker } = load("./Picker.sys.mjs");
const { InputDriver } = load("./InputDriver.sys.mjs");
const { Recorder } = load("./Recorder.sys.mjs");
const { WebVitals } = load("./WebVitals.sys.mjs");
const { setTimeout, clearTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");

// why: InspectorUtils is exposed only to window globals (docs/gecko-pitfalls.md, Source locations and styles).
let inspector;
const inspectorUtils = () =>
  (inspector ??= Cu.Sandbox(Services.scriptSecurityManager.getSystemPrincipal(), {
    wantGlobalProperties: ["InspectorUtils"],
  }).InspectorUtils);

// why: Localize user-facing UI while keeping agent-facing output in English.
const L = (en, tr) => (Services.locale.appLocaleAsBCP47.startsWith("tr") ? tr : en);

const MAX_TEXT = 100000;
const RECORDING_KEY = "zen-mcp:recording";
const RECORD_EVENTS = new Set(["click", "change", "keydown", "input", "pagehide"]);

// why: Letters keep refs short; these form no words and none looks like a digit in an annotated screenshot.
const REF_LETTERS = "bcdfghjkmnpqrstvwxyz";
function refLetters(n) {
  let letters = "";
  for (; n >= 0; n = Math.floor(n / REF_LETTERS.length) - 1) letters = REF_LETTERS[n % REF_LETTERS.length] + letters;
  return letters;
}

// why: A sandbox inherits the document's principal; on a browser-internal page that is chrome privilege.
function pageSandbox(win) {
  if (!win.document.nodePrincipal.isContentPrincipal && !win.document.nodePrincipal.isNullPrincipal)
    throw new Error("Agents can't run code in browser-internal pages.");
  return Cu.Sandbox(win, { sandboxPrototype: win, wantXrays: false, sameZoneAs: win });
}

export class ZenMcpChild extends JSWindowActorChild {
  #operations = new Map();
  #refs = new Map();
  #ids = new WeakMap();
  #next = 0;
  #documentNumber;
  #agent = agentTheme({ id: "claude" });
  #eventUtils = null;
  #consoleSince = 0;
  #ask = null;
  #contextTarget = null;
  #vitals;
  #restoredAt = 0;

  #env = {
    document: () => this.document,
    window: () => this.contentWindow,
    agent: () => this.#agent,
    element: (ref) => this.#element(ref),
    ref: (el) => this.#ref(el),
    eventUtils: () => this.#eu(),
    contextTarget: () => this.#contextTarget?.deref(),
    unwrap: (value) => Cu.waiveXrays(value),
    inspector: () => inspectorUtils(),
    listenerTypes: (el) =>
      Services.els
        .getListenerInfoFor(el)
        .filter((listener) => !listener.inSystemEventGroup)
        .map((listener) => listener.type),
    applyTheme,
    mousePath,
    typingPlan,
    L,
    mac: () => Services.appinfo?.OS === "Darwin",
    setTimeout,
    clearTimeout,
    reader,
    info,
    elementLabel: reader.elementLabel,
    describeHit: (el, expected) => this.#reader.describeHit(el, expected),
    ripple: (x, y) => ripple(this.#env, x, y),
  };
  #reader = new reader.PageReader(this.#env);
  #cursor = (this.#env.cursor = new VirtualCursor(this.#env));
  #input = new InputDriver(this.#env);
  #picker = new Picker(this.#env);
  #recorder = new Recorder({
    ...this.#env,
    post: (step, el) => {
      this.sendAsyncMessage("record_step", step);
      if (el) this.#flash(el);
    },
  });
  #flashes = new Set();

  handleEvent(event) {
    if (RECORD_EVENTS.has(event.type) && event.isTrusted && this.#recording()) {
      try {
        this.#recorder.handle(event);
      } catch (e) {
        console.error("zen-mcp recorder", e);
      }
    }
    if (event.type === "DOMContentLoaded" && event.target === this.document) {
      info.rememberSourceAttributes(this.document);
      return;
    }
    if (event.type === "pageshow" && event.persisted) {
      this.#vitals?.destroy();
      this.#vitals = null;
      this.#restoredAt = this.contentWindow.performance.now();
    }
    if (event.type === "pagehide") {
      this.#input.release();
      return;
    }
    // why: Ignore page-generated events when setting the context menu's picked element.
    if (event.type !== "contextmenu" || !event.isTrusted) return;
    let target = event.composedPath()[0] ?? event.target;
    if (target?.nodeType !== 1) target = target?.parentElement;
    this.#contextTarget = target ? new WeakRef(target) : null;
  }

  #recording() {
    try {
      return !!Services.cpmm.sharedData.get(RECORDING_KEY)?.includes(this.browsingContext.browserId);
    } catch {
      return false;
    }
  }

  async receiveMessage({ name, data }) {
    const scope = new Cancellation();
    if (name === "cancel_operation") {
      this.#operations.get(data.requestId)?.cancel();
      return null;
    }
    if (data?.requestId != null) this.#operations.set(data.requestId, scope);
    try {
      if (data?.agent) {
        this.#agent = agentTheme(data.agent);
        this.#cursor.paint();
      }
      if (data?.documentNumber) this.#documentNumber = data.documentNumber;
      switch (name) {
        case "annotate":
          return { value: this.#annotate(data.enabled) };
        case "capture_bounds": {
          const win = this.contentWindow;
          const root = this.document.scrollingElement;
          return {
            value: [
              Math.max(win.innerWidth, root?.scrollWidth ?? 0),
              Math.max(win.innerHeight, root?.scrollHeight ?? 0),
            ],
          };
        }
        case "capture_geometry": {
          const win = this.contentWindow;
          return { value: [win.scrollX, win.scrollY, win.devicePixelRatio, win.innerWidth, win.innerHeight] };
        }
        case "web_vitals": {
          this.#vitals ??= new WebVitals(this.contentWindow, this.#restoredAt);
          return { value: this.#vitals.read() };
        }
        case "browser_metrics":
          return { value: this.#pageMetrics() };
        case "release_inputs":
          return { value: this.#input.release() };
        case "input_state":
          return { value: this.#input.state() };
        case "text":
          return this.#text();
        case "agent_storage": {
          const win = this.contentWindow;
          if (this.document.nodePrincipal.originNoSuffix !== data.origin)
            throw new Error("The storage origin changed.");
          const storage = data.area === "local" ? win.localStorage : win.sessionStorage;
          switch (data.action) {
            case "get": {
              const value = storage.getItem(data.key);
              if (value?.length > 65536) throw new Error("Storage value exceeds 65536 characters.");
              return { value };
            }
            case "set":
              storage.setItem(data.key, data.value);
              break;
            case "remove":
              storage.removeItem(data.key);
              break;
            case "clear":
              storage.clear();
              break;
          }
          return { value: true };
        }
        case "eval":
          return { value: await this.#eval(data.code) };
        case "react": {
          const { inspectReact } = load("../ReactInspect.sys.mjs");
          return {
            value: inspectReact({
              ...data,
              document: this.document,
              element: data.ref ? this.#element(data.ref) : null,
              unwrap: (value) => Cu.waiveXrays(value),
              refFor: (el) => this.#ref(el),
            }),
          };
        }
        case "axe":
          return { value: await this.#axe(data, scope) };
        case "read_page":
          return { value: this.#reader.readPage(data) };
        case "find":
          return { value: this.#reader.find(data.query) };
        case "frame_rect":
          return this.#frameRect(data.bcId, data.scroll !== false);
        case "frame_at":
          return { value: this.#frameAt(data.x, data.y) };
        case "active_frame":
          return { value: reader.frameIdOf(this.document.activeElement) };
        case "check":
          return { value: this.#reader.check(data) };
        case "sample":
          return { value: this.#reader.sample(data) };
        case "describe":
          return { value: this.#reader.describeTarget(data) };
        case "risk":
          return { value: this.#reader.risk(data) };
        case "form_input":
          return { value: this.#formInput(data.ref, data.value) };
        case "locate":
          return this.#locate(data.ref, data.forClick);
        case "frame_hit": {
          const el = this.#frameElement(data.bcId);
          if (!el) throw new Error("Target iframe is gone; refresh read_page.");
          this.#input.assertHit(el, data.x, data.y, "Target iframe");
          return { value: true };
        }
        case "clipboard_prepare":
          return { value: this.#clipboardPrepare(data) };
        case "clipboard_execute":
          scope.check();
          return { value: this.#clipboardExecute(data) };
        case "input":
          return { value: await this.#input.input(data, scope) };
        case "console":
          return { value: this.#console(data) };
        case "ask_user": {
          const off = scope.onCancel(() => this.#ask?.finish("stopped"));
          try {
            return { value: await this.#askUser(data) };
          } finally {
            off();
          }
        }
        case "overlays":
          return { value: this.#overlays(data.hidden) };
        case "highlight":
          return { value: this.#highlight(data.items ?? []) };
        case "record_flush":
          this.#recorder.flush();
          return { value: true };
        case "cancel_ask":
          this.#ask?.finish(data?.result ?? "stopped");
          return null;
        case "file_upload":
          return { value: this.#fileUpload(data.ref, data.files) };
        case "pick_start":
          return await this.#picker.start(data);
        case "pick_theme":
          this.#picker.retheme();
          return null;
        case "pick_end":
          this.#picker.cancel();
          this.#picker.end();
          return null;
        default:
          return { error: `Unknown message: ${name}` };
      }
    } catch (e) {
      return { error: String(e?.message ?? e) };
    } finally {
      if (data?.requestId != null) this.#operations.delete(data.requestId);
    }
  }

  didDestroy() {
    this.#vitals?.destroy();
    this.#highlights?.remove();
    for (const shown of this.#flashes) shown.remove();
    this.#input.release();
    this.#annotation?.remove();
    for (const scope of this.#operations.values()) scope.cancel();
    this.#operations.clear();
    this.#cursor.destroy();
    this.#ask?.finish("navigated");
    this.#picker.cancel();
    this.#picker.end();
  }

  #text() {
    const doc = this.document;
    const root = doc.querySelector("main, article, [role=main]") || doc.body;
    let text = root ? reader.pageText(root) : "";
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + "\n…(truncated)";
    return { title: doc.title, url: doc.URL, text };
  }

  // why: Gecko's privileged reads can bypass content emulation overrides.
  #pageMetrics() {
    const win = this.contentWindow;
    const sandbox = pageSandbox(win);
    try {
      return JSON.parse(
        Cu.evalInSandbox(
          `JSON.stringify({ width: innerWidth, height: innerHeight,
        dpr: devicePixelRatio, userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints,
        colorScheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
        webdriver: navigator.webdriver })`,
          sandbox,
          null,
          "zen-mcp-metrics",
          1,
        ),
      );
    } finally {
      Cu.nukeSandbox(sandbox);
    }
  }

  async #eval(code) {
    const win = this.contentWindow;
    const sandbox = pageSandbox(win);
    let value = Cu.evalInSandbox(code, sandbox, null, "zen-mcp", 1);
    if (value && typeof value.then === "function") value = await value;
    return info.describe(value);
  }

  #axeRunning = false;
  async #axe({ ref, tags, max_nodes = 10, max_rules = 100, timeout_ms = 20000 }, scope) {
    if (this.#axeRunning) throw new Error("An accessibility scan is already running in this frame.");
    this.#axeRunning = true;
    // why: Use a fresh content-principal realm so axe neither trusts nor overwrites page-owned state.
    const win = this.contentWindow;
    let sandbox, timer;
    try {
      sandbox = pageSandbox(win);
      Object.defineProperty(sandbox, "window", { value: sandbox });
      Object.defineProperty(sandbox, "document", { value: Cu.waiveXrays(this.document) });
      sandbox.scanTarget = ref ? Cu.waiveXrays(this.#element(ref)) : sandbox.document;
      sandbox.scanOptions = Cu.cloneInto(
        {
          iframes: false,
          elementRef: true,
          resultTypes: ["violations", "incomplete"],
          preload: false,
          ...(tags?.length ? { runOnly: { type: "tag", values: tags } } : {}),
        },
        sandbox,
      );
      Services.scriptloader.loadSubScript(new URL("../vendor/axe.min.js", import.meta.url).href, sandbox);
      const pending = Cu.evalInSandbox("axe.run(scanTarget, scanOptions)", sandbox, null, "zen-mcp-axe", 1);
      const results = await scope.race(
        Promise.race([
          pending,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Accessibility scan timed out.")),
              Math.max(1, Math.min(20000, timeout_ms)),
            );
          }),
        ]),
      );
      scope.check();
      const cap = Math.max(1, Math.min(50, max_nodes));
      const ruleCap = Math.max(1, Math.min(200, max_rules));
      const summarize = (list) =>
        list.slice(0, ruleCap).map((rule) => ({
          id: rule.id,
          impact: rule.impact,
          description: rule.description,
          help: rule.help,
          helpUrl: rule.helpUrl,
          tags: Array.from(rule.tags),
          nodeCount: rule.nodes.length,
          nodes: rule.nodes.slice(0, cap).map((node) => ({
            ref: node.element ? this.#ref(node.element) : undefined,
            target: Array.from(node.target, (selector) => String(selector).slice(0, 500)),
            html: String(node.html).slice(0, 1000),
            failureSummary: String(node.failureSummary || "").slice(0, 2000),
          })),
          truncated: rule.nodes.length > cap,
        }));
      return {
        engine: { name: "axe-core", version: String(results.testEngine.version) },
        counts: {
          violations: results.violations.length,
          incomplete: results.incomplete.length,
          passes: results.passes.length,
          inapplicable: results.inapplicable.length,
        },
        violations: summarize(results.violations),
        incomplete: summarize(results.incomplete),
        truncated: results.violations.length > ruleCap || results.incomplete.length > ruleCap,
        note: "Automated checks only. Incomplete results require manual review; zero violations does not establish accessibility compliance.",
      };
    } finally {
      clearTimeout(timer);
      try {
        if (sandbox) Cu.nukeSandbox(sandbox);
      } finally {
        this.#axeRunning = false;
      }
    }
  }

  #clipboardPending = new Map();
  #clipboardSequence = 0;
  #clipboardState(element) {
    const selection = this.contentWindow.getSelection();
    return {
      element,
      value: element.value,
      start: element.selectionStart,
      end: element.selectionEnd,
      anchor: selection?.anchorNode,
      anchorOffset: selection?.anchorOffset,
      focus: selection?.focusNode,
      focusOffset: selection?.focusOffset,
    };
  }
  #clipboardPrepare({ action, ref }) {
    if (!["copy", "paste", "cut"].includes(action)) throw new Error("Unsupported clipboard command.");
    const element = ref ? this.#element(ref) : this.document.activeElement;
    if (!element) throw new Error("No clipboard target.");
    if (
      (action === "paste" || action === "cut") &&
      (!(element.localName === "input" || element.localName === "textarea" || element.isContentEditable) ||
        element.disabled ||
        element.readOnly)
    ) {
      throw new Error("Clipboard target must be an editable field.");
    }
    const token = `clipboard_${++this.#clipboardSequence}`;
    this.#clipboardPending.clear();
    this.#clipboardPending.set(token, { action, ref, state: this.#clipboardState(element) });
    return { token };
  }
  #clipboardExecute({ action, token }) {
    const pending = this.#clipboardPending.get(token);
    this.#clipboardPending.delete(token);
    if (!pending || pending.action !== action) throw new Error("Clipboard approval target expired; try again.");
    const expected = pending.state;
    if (!expected.element.isConnected || (!pending.ref && this.document.activeElement !== expected.element))
      throw new Error("Clipboard focus changed; nothing was done.");
    const current = this.#clipboardState(expected.element);
    if (Object.keys(expected).some((key) => current[key] !== expected[key]))
      throw new Error("Clipboard target/selection changed; nothing was done.");
    if (pending.ref) expected.element.focus({ preventScroll: true });
    if (!this.document.execCommand(action)) throw new Error(`Native clipboard ${action} was not available.`);
    return "done";
  }

  #annotation = null;
  #annotate(enabled) {
    this.#annotation?.remove();
    this.#annotation = null;
    if (!enabled) return [];
    const host = this.document.createElement("zen-mcp-annotations");
    host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
    const root = host.attachShadow({ mode: "closed" });
    const refs = [];
    const controls = 'a[href],button,input,textarea,select,[role="button"],[tabindex]';
    for (const element of this.#reader.targets(controls)) {
      if (!reader.isVisible(element) || !reader.inViewport(element, this.contentWindow)) continue;
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const ref = this.#ref(element),
        label = this.document.createElement("span");
      label.textContent = ref;
      label.style.cssText = `position:absolute;left:${Math.max(0, box.left)}px;top:${Math.max(0, box.top)}px;background:#111;color:#fff;font:12px/16px monospace;border:1px solid #fff;padding:1px 3px;pointer-events:none`;
      root.append(label);
      refs.push(ref);
      if (refs.length >= 80) break;
    }
    this.document.documentElement.append(host);
    this.#annotation = host;
    return refs;
  }

  #ref(el) {
    let id = this.#ids.get(el);
    if (!id) {
      id = `ref_${this.#documentNumber}${refLetters(this.#next++)}`;
      this.#ids.set(el, id);
      this.#refs.set(id, new WeakRef(el));
    }
    return id;
  }

  #element(ref) {
    const el = this.#refs.get(ref)?.deref();
    if (!el || !el.isConnected) {
      throw new Error(`${ref} not found (the page may have changed); get refs again with read_page or find.`);
    }
    return el;
  }

  #frameElement(bcId) {
    for (const el of this.document.querySelectorAll("iframe, frame")) {
      if (reader.frameIdOf(el) === bcId) return el;
    }
    return null;
  }

  // why: Recordings must not scroll the user's page to locate a frame.
  #frameRect(bcId, scroll = true) {
    const el = this.#frameElement(bcId);
    if (!el) throw new Error("iframe not found (the page may have changed).");
    if (scroll && !reader.fullyInViewport(el, this.contentWindow))
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    return this.#contentOrigin(el);
  }

  #contentOrigin(el) {
    const r = el.getBoundingClientRect();
    const s = this.contentWindow.getComputedStyle(el);
    return {
      x: r.left + el.clientLeft + parseFloat(s.paddingLeft),
      y: r.top + el.clientTop + parseFloat(s.paddingTop),
    };
  }

  #frameAt(x, y) {
    const el = this.document.elementFromPoint(x, y);
    const bcId = reader.frameIdOf(el);
    if (!bcId) return null;
    const o = this.#contentOrigin(el);
    return { bcId, x: x - o.x, y: y - o.y };
  }

  #locate(ref, forClick = false) {
    const el = this.#element(ref);
    const win = this.contentWindow;
    if (!reader.fullyInViewport(el, win)) el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) throw new Error(`${ref} is not visible (no size).`);
    // why: Use the visible portion so large elements do not target a point outside the viewport.
    const x = (Math.max(0, r.left) + Math.min(win.innerWidth, r.right)) / 2;
    const y = (Math.max(0, r.top) + Math.min(win.innerHeight, r.bottom)) / 2;
    if (forClick) this.#input.assertHit(el, x, y, ref);
    return { x, y };
  }

  #formInput(ref, value) {
    const el = this.#element(ref);
    const win = this.contentWindow;
    const tag = el.tagName.toUpperCase();
    const fire = (type) => el.dispatchEvent(new win.Event(type, { bubbles: true }));

    if (tag === "SELECT") {
      const wanted = String(value);
      const opt =
        [...el.options].find((o) => o.value === wanted) ||
        [...el.options].find((o) => reader.clean(o.text) === reader.clean(wanted)) ||
        [...el.options].find((o) => reader.normalize(o.text) === reader.normalize(wanted));
      if (!opt)
        // why: Errors reach the activity log, which must not keep what the agent typed.
        throw new Error(`No such option. Options: ${[...el.options].map((o) => o.text.trim()).join(", ")}`);
      el.value = opt.value;
      fire("input");
      fire("change");
      return `${ref}: selected "${opt.text.trim()}".`;
    }
    if (tag === "INPUT" && (el.type === "checkbox" || el.type === "radio")) {
      const checked = value === true || value === "true" || value === 1 || value === "1" || value === "on";
      // why: Use a click so page listeners and native radio/label behavior run.
      if (el.checked !== checked) el.click();
      return `${ref}: ${el.checked ? "checked" : "unchecked"}.`;
    }
    if (tag === "INPUT" || tag === "TEXTAREA") {
      el.focus();
      // why: A chrome-privileged value setter on a file input attaches the named local file, bypassing file_upload. Check after focus, whose handlers can change the type.
      if (el.type === "file") throw new Error(`${ref} is a file input; use file_upload.`);
      // why: The Xray setter bypasses React's value tracker so the input event reports a change.
      el.value = String(value);
      fire("input");
      fire("change");
      return `${ref}: value set.`;
    }
    if (el.isContentEditable) {
      el.focus();
      this.document.execCommand("selectAll");
      this.document.execCommand("insertText", false, String(value));
      return `${ref}: content set.`;
    }
    throw new Error(`${ref} is not a form field (${reader.roleOf(el) || tag.toLowerCase()}).`);
  }

  #fileUpload(ref, files) {
    const input = this.#fileInputNear(this.#element(ref));
    if (!input) throw new Error(`No file input (input type=file) near ${ref}.`);
    if (files.length > 1 && !input.multiple) throw new Error("This field accepts a single file.");
    const win = this.contentWindow;
    const list = files.map(
      (f) => new win.File([Cu.cloneInto(f.bytes, win)], f.name, { type: f.type, lastModified: f.lastModified }),
    );
    input.mozSetFileArray(list);
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
    input.dispatchEvent(new win.Event("change", { bubbles: true }));
    return `${files.length} file(s) uploaded: ${files.map((f) => f.name).join(", ")}`;
  }

  #fileInputNear(el) {
    const isFile = (node) => node?.localName === "input" && node.type === "file";
    if (isFile(el)) return el;
    if (isFile(el.control)) return el.control;
    for (let node = el, depth = 0; node && depth < 5; node = node.parentElement, depth++) {
      const found = node.querySelector?.('input[type="file"]');
      if (found) return found;
    }
    return null;
  }

  #askUser({ ref, x, y, wait = "done", timeout = 300 }) {
    this.#ask?.finish("replaced");
    const doc = this.document;
    const target = ref ? this.#element(ref) : x != null ? doc.elementFromPoint(x, y) : null;
    if (target && !reader.fullyInViewport(target, this.contentWindow))
      target.scrollIntoView({ block: "center", behavior: "instant" });
    const ask = outlineAndWait(this.#env, { target, wait, timeout });
    this.#ask = ask;
    return ask.answer.finally(() => {
      if (this.#ask === ask) this.#ask = null;
    });
  }

  #highlights = null;
  #highlight(items) {
    const resolved = items.map(({ ref, x, y, label, number }) => {
      const element = ref ? this.#element(ref) : this.document.elementFromPoint(x, y);
      if (!element) throw new Error(`Nothing to highlight at (${Math.round(x)}, ${Math.round(y)}).`);
      return { element, label, number };
    });
    this.#highlights?.remove();
    this.#highlights = resolved.length ? highlight(this.#env, resolved) : null;
    const first = resolved[0]?.element;
    if (first && !reader.inViewport(first, this.contentWindow))
      first.scrollIntoView({ block: "center", behavior: "instant" });
    return resolved.length;
  }

  #flash(element) {
    let shown;
    try {
      shown = highlight(this.#env, [{ element, label: "", number: "✓" }]);
    } catch {
      return;
    }
    this.#flashes.add(shown);
    setTimeout(() => {
      shown.remove();
      this.#flashes.delete(shown);
    }, 900);
  }

  // why: Remove transient overlays from agent-facing screenshots so they cannot cover page content.
  #overlays(hidden) {
    this.#cursor.setHidden(hidden);
    if (hidden) for (const ripple of this.document.querySelectorAll("zen-mcp-ripple")) ripple.remove();
    for (const pick of this.document.querySelectorAll("zen-mcp-pick, zen-mcp-highlight")) {
      pick.style.setProperty("visibility", hidden ? "hidden" : "visible", "important");
    }
    return "done";
  }

  #console({ onlyErrors = false, pattern, limit = 100, clear = false }) {
    const innerId = this.manager.innerWindowId;
    const entries = [];
    const unwrap = (value) => Cu.waiveXrays(value);

    const storage = Cc["@mozilla.org/consoleAPI-storage;1"].getService(Ci.nsIConsoleAPIStorage);
    for (const event of storage.getEvents(String(innerId))) {
      const level = event.level === "warn" ? "warning" : event.level;
      if (onlyErrors && level !== "error" && level !== "assert") continue;
      const message = [...(event.arguments ?? [])].map((arg) => info.formatArg(arg, unwrap)).join(" ");
      entries.push({
        time: event.timeStamp,
        level,
        message,
        source: event.filename && `${event.filename}:${event.lineNumber}`,
      });
    }

    for (const m of Services.console.getMessageArray() ?? []) {
      if (!(m instanceof Ci.nsIScriptError) || m.innerWindowID !== innerId) continue;
      const isWarning = m.flags & Ci.nsIScriptError.warningFlag;
      if (onlyErrors && isWarning) continue;
      entries.push({
        time: m.timeStamp,
        level: isWarning ? "warning" : "error",
        message: m.errorMessage,
        source: m.sourceName && `${m.sourceName}:${m.lineNumber}`,
      });
    }

    let list = entries.filter((e) => e.time > this.#consoleSince).sort((a, b) => a.time - b.time);
    if (pattern) {
      const re = new RegExp(pattern, "i");
      list = list.filter((e) => re.test(e.message) || re.test(e.source ?? ""));
    }
    if (clear) this.#consoleSince = Date.now();
    if (!list.length) return "No console messages" + (pattern || onlyErrors ? " matching the filter." : ".");
    const shown = list.slice(-limit);
    const lines = shown.map((e) => {
      const time = new Date(e.time).toTimeString().slice(0, 8);
      return `[${e.level}] ${time} ${reader.truncate(e.message, 2000)}${e.source ? `  (${e.source})` : ""}`;
    });
    if (list.length > shown.length) lines.unshift(`…${list.length - shown.length} earlier message(s) not shown`);
    return lines.join("\n");
  }

  #eu() {
    if (!this.#eventUtils) {
      const win = this.contentWindow;
      const eu = { window: win, parent: win, _EU_Ci: Ci, _EU_Cc: Cc };
      Services.scriptloader.loadSubScript("chrome://remote/content/external/EventUtils.js", eu);
      this.#eventUtils = eu;
    }
    return this.#eventUtils;
  }
}
