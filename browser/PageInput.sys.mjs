// why: Page actors dispatch trusted events in the right process without selecting the tab.

// why: Scale images before the client does to retain the mapping from image pixels to page coordinates.
export const MAX_EDGE = 1568;
const MAX_PIXELS = 1150000;

// why: Accept xdotool names used by existing Claude in Chrome clients.
const KEYS = {
  return: "KEY_Enter",
  enter: "KEY_Enter",
  tab: "KEY_Tab",
  escape: "KEY_Escape",
  esc: "KEY_Escape",
  shift: "KEY_Shift",
  control: "KEY_Control",
  ctrl: "KEY_Control",
  alt: "KEY_Alt",
  meta: "KEY_Meta",
  cmd: "KEY_Meta",
  super: "KEY_Meta",
  backspace: "KEY_Backspace",
  delete: "KEY_Delete",
  space: " ",
  insert: "KEY_Insert",
  up: "KEY_ArrowUp",
  down: "KEY_ArrowDown",
  left: "KEY_ArrowLeft",
  right: "KEY_ArrowRight",
  arrowup: "KEY_ArrowUp",
  arrowdown: "KEY_ArrowDown",
  arrowleft: "KEY_ArrowLeft",
  arrowright: "KEY_ArrowRight",
  home: "KEY_Home",
  end: "KEY_End",
  page_up: "KEY_PageUp",
  page_down: "KEY_PageDown",
  pageup: "KEY_PageUp",
  pagedown: "KEY_PageDown",
};

export function keyName(name) {
  const lower = name.toLowerCase();
  if (KEYS[lower]) return KEYS[lower];
  if (/^f([1-9]|1[0-2])$/.test(lower)) return "KEY_" + lower.toUpperCase();
  if ([...name].length === 1) return name;
  throw new Error(`Unknown key: ${name}`);
}

export function parseModifiers(text) {
  const mods = {};
  for (const m of (text || "").toLowerCase().split("+").filter(Boolean)) {
    if (m === "ctrl" || m === "control") mods.ctrlKey = true;
    else if (m === "shift") mods.shiftKey = true;
    else if (m === "alt" || m === "option") mods.altKey = true;
    else if (m === "meta" || m === "super" || m === "cmd" || m === "command") mods.metaKey = true;
    else throw new Error(`Unknown modifier: ${m}`);
  }
  return mods;
}

export function pageInput(ctx) {
  const held = ctx.heldInputFrames;

  function releaseInputs(browserOrId) {
    const id = typeof browserOrId === "number" ? browserOrId : ctx.controlledSource(browserOrId).browserId;
    const entry = held.get(id);
    if (!entry) return;
    ctx.clearTimeout(entry.timer);
    held.delete(id);
    try {
      entry.document?.getActor("ZenMcp").sendAsyncMessage("release_inputs", {});
    } catch {}
  }

  function releaseAllInputs() {
    for (const id of held.keys()) releaseInputs(id);
  }

  function heldFrame(browser) {
    const entry = held.get(ctx.controlledSource(browser).browserId);
    if (!entry) return null;
    if (
      entry.session !== ctx.callOf(browser)?.session ||
      !entry.frame.currentWindowGlobal ||
      entry.frame.currentWindowGlobal !== entry.document
    ) {
      releaseInputs(browser);
      return null;
    }
    return entry.frame;
  }

  function rememberInputs(browser, frame, result, hold_ms = 30000) {
    const id = ctx.controlledSource(browser).browserId;
    ctx.clearTimeout(held.get(id)?.timer);
    if (!result?.keys?.length && !result?.buttons?.length) {
      held.delete(id);
      return;
    }
    held.set(id, {
      browser,
      frame,
      document: frame.currentWindowGlobal,
      state: result,
      session: ctx.callOf(browser)?.session,
      timer: ctx.setTimeout(() => releaseInputs(id), hold_ms),
    });
  }

  const holdsButtons = (browser) => !!held.get(ctx.controlledSource(browser).browserId)?.state?.buttons?.length;

  function heldModifiers(browser) {
    ctx.heldFrame(browser);
    const keys = held.get(ctx.controlledSource(browser).browserId)?.state?.keys || [];
    return Object.fromEntries(
      [
        ["KEY_Control", "ctrlKey"],
        ["KEY_Shift", "shiftKey"],
        ["KEY_Alt", "altKey"],
        ["KEY_Meta", "metaKey"],
      ]
        .filter(([key]) => keys.includes(key))
        .map(([, name]) => [name, true]),
    );
  }

  // why: Fission input must be dispatched from the target frame, in its own coordinates.
  async function input(browser, data) {
    const inner = await ctx.deepest(browser, data.x, data.y);
    const frame = ctx.heldFrame(browser);
    if (frame && frame !== inner.frame) {
      ctx.releaseInputs(browser);
      throw new Error("Held input cannot cross frames; inputs released. Use the drag action within one frame.");
    }
    if (data.ref && inner.frame !== ctx.frameOf(browser, data.ref))
      throw new Error(
        "Click blocked: target iframe is covered or changed. Refresh screenshot/read_page; no click was sent.",
      );
    const to = data.to && (await ctx.toFrame(browser, inner.frame, ...data.to));
    const result = await ctx.query(browser, "input", { ...data, x: inner.x, y: inner.y, to }, 30000, inner.frame);
    if (data.kind === "mouse_down") ctx.rememberInputs(browser, inner.frame, result.value, data.hold_ms);
    return result;
  }

  async function click(browser, [x, y], { button = 0, count = 1, modifiers, ref, ...motion } = {}) {
    if (typeof button === "string") button = { left: 0, middle: 1, right: 2 }[button];
    const result = await ctx.input(browser, {
      ...motion,
      kind: "click",
      x,
      y,
      button,
      count,
      ref,
      modifiers: parseModifiers(modifiers),
    });
    return result.value.hit;
  }

  async function scroll(browser, [x, y], direction, amount = 3) {
    const multiplier = (axis) =>
      Services.prefs.getIntPref(`mousewheel.default.delta_multiplier_${axis}`, 100) / 100 || 1;
    const px = amount * 100;
    const delta = { up: [0, -px], down: [0, px], left: [-px, 0], right: [px, 0] }[direction];
    if (!delta) throw new Error(`Invalid scroll direction: ${direction}`);
    return ctx.input(browser, {
      kind: "wheel",
      x,
      y,
      dx: delta[0],
      dy: delta[1],
      multiplier: [multiplier("x"), multiplier("y")],
    });
  }

  async function pressKeys(browser, text) {
    const keys = text
      .trim()
      .split(/\s+/)
      .map((combo) => {
        const parts = combo.split("+");
        const key = keyName(parts.pop());
        return { key, mods: { ...heldModifiers(browser), ...parseModifiers(parts.join("+")) } };
      });
    if (!keys.some(ctx.clipboardShortcut)) return typeInFocus(browser, { kind: "keys", keys });
    for (const key of keys) {
      const action = ctx.clipboardShortcut(key);
      if (action) await ctx.performClipboard(browser, { action });
      else await typeInFocus(browser, { kind: "keys", keys: [key] });
    }
    return "done";
  }

  async function typeInFocus(browser, data) {
    const timeout =
      data.kind === "text" && data.typing === "human"
        ? Math.min(600000, 10000 + [...data.text].length * (data.delay_ms ?? 65) * 3.5)
        : 30000;
    return ctx.query(browser, "input", data, timeout, ctx.heldFrame(browser) || (await ctx.focusedFrame(browser)));
  }

  async function screenshot(browser, scale = 1, pixels = false, fullPage = false) {
    ctx.assertSiteAccess(browser);
    const wg = browser.browsingContext?.currentWindowGlobal;
    if (!wg) throw new Error("The page has not loaded yet.");
    // why: Hide input overlays during capture so the agent gets an unobstructed page image.
    const overlays = (hidden) => ctx.query(browser, "overlays", { hidden }, 2000).catch(() => {});
    let bounds,
      nativeScale = 1,
      rect = null;
    if (fullPage) {
      bounds = (await ctx.query(browser, "capture_bounds", {})).value;
      const [width, height] = bounds;
      nativeScale =
        Math.min(1, MAX_EDGE / Math.max(width, height), Math.sqrt(MAX_PIXELS / (width * height))) *
        Math.min(1, Math.max(0.1, scale));
      rect = new browser.ownerDocument.defaultView.DOMRect(0, 0, width, height);
    }
    await overlays(true);
    let bitmap;
    try {
      bitmap = await wg.drawSnapshot(rect, nativeScale, "white");
    } finally {
      try {
        wg.getActor("ZenMcp").sendAsyncMessage("overlays", { hidden: false });
      } catch {}
    }
    try {
      ctx.assertSiteAccess(browser);
      if (browser.browsingContext?.currentWindowGlobal !== wg) throw new Error("Page changed during capture.");
    } catch (error) {
      bitmap.close();
      throw error;
    }
    const { width: w, height: h } = bitmap;
    const s = fullPage
      ? 1
      : Math.min(1, MAX_EDGE / Math.max(w, h), Math.sqrt(MAX_PIXELS / (w * h))) * Math.min(1, Math.max(0.1, scale));
    const canvas = browser.ownerDocument.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
    canvas.width = Math.round(w * s);
    canvas.height = Math.round(h * s);
    const painter = canvas.getContext("2d");
    try {
      painter.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    } finally {
      bitmap.close();
    }
    const id = fullPage
      ? null
      : ctx.screenshots.add(ctx.callOf(browser)?.session, browser.browserId, {
          scale: s,
          width: canvas.width,
          height: canvas.height,
        });
    const data = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
    return {
      id,
      data,
      width: canvas.width,
      height: canvas.height,
      ...(bounds ? { bounds, nativeScale } : {}),
      ...(pixels ? { canvas, painter, pixels: painter.getImageData(0, 0, canvas.width, canvas.height), scale: s } : {}),
    };
  }

  return {
    releaseInputs,
    releaseAllInputs,
    heldFrame,
    rememberInputs,
    holdsButtons,
    heldModifiers,
    input,
    click,
    scroll,
    pressKeys,
    typeInFocus,
    screenshot,
  };
}
