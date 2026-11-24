// why: Hit-test to avoid activating an overlay and use a watchdog so abandoned input cannot stay held.

export class InputDriver {
  #heldKeys = new Map();
  #heldButtons = new Map();
  #heldOwner = null;
  #releaseTimer = null;
  #pointer = null;

  constructor(env) {
    this.env = env;
  }

  state() {
    return { keys: [...this.#heldKeys.keys()], buttons: [...this.#heldButtons.keys()] };
  }

  #heldModifiers() {
    const mods = {};
    for (const [key, name] of [
      ["KEY_Shift", "shiftKey"],
      ["KEY_Control", "ctrlKey"],
      ["KEY_Alt", "altKey"],
      ["KEY_Meta", "metaKey"],
    ]) {
      if (this.#heldKeys.has(key)) mods[name] = true;
    }
    return mods;
  }

  #mouse(x, y, event) {
    const at = this.env.processRoot(x, y);
    this.env.eventUtils().synthesizeMouseAtPoint(at.x, at.y, event, at.win);
  }

  #armRelease(session, hold_ms = 30000) {
    if (!session) throw new Error("An exact input session is required.");
    if (this.#heldOwner && this.#heldOwner !== session) throw new Error("Held input belongs to another session.");
    if (!Number.isFinite(hold_ms) || hold_ms < 100 || hold_ms > 30000) throw new Error("hold_ms must be 100..30000.");
    this.#heldOwner = session;
    this.env.clearTimeout(this.#releaseTimer);
    this.#releaseTimer = this.env.setTimeout(() => this.release(), hold_ms);
  }

  release() {
    const win = this.env.window();
    this.env.clearTimeout(this.#releaseTimer);
    for (const [button, point] of this.#heldButtons) {
      try {
        this.#mouse(point[0], point[1], { ...this.#heldModifiers(), type: "mouseup", button });
      } catch {}
    }
    this.#heldButtons.clear();
    for (const key of [...this.#heldKeys.keys()].reverse()) {
      const sentKey = this.#heldKeys.get(key);
      this.#heldKeys.delete(key);
      try {
        this.env.eventUtils().synthesizeKey(sentKey, { ...this.#heldModifiers(), type: "keyup" }, win);
      } catch {}
    }
    this.#heldOwner = null;
    return this.state();
  }

  async #moveInput(x, y, scope, options, modifiers = {}, buttons = 0) {
    const win = this.env.window();
    const from = this.#pointer || [win.innerWidth / 2, win.innerHeight / 2];
    for (const point of this.env.mousePath(from, [x, y], options)) {
      await scope.wait(point.delay, this.env);
      scope.check();
      this.#mouse(point.x, point.y, { ...this.#heldModifiers(), ...modifiers, type: "mousemove", buttons });
      this.#pointer = [point.x, point.y];
      for (const button of this.#heldButtons.keys()) this.#heldButtons.set(button, this.#pointer);
      await this.env.cursor.move(point.x, point.y, scope, true);
    }
  }

  async input(
    {
      kind,
      x,
      y,
      to,
      button = 0,
      count = 1,
      modifiers = {},
      keys,
      text,
      dx = 0,
      dy = 0,
      multiplier = [1, 1],
      silent = false,
      ref,
      session,
      hold_ms,
      movement,
      duration_ms,
      steps,
      seed,
      typing,
      delay_ms,
    },
    scope,
  ) {
    const { cursor, L } = this.env;
    const win = this.env.window();
    const eu = this.env.eventUtils();
    if (this.#heldOwner && session !== this.#heldOwner) throw new Error("Held input belongs to another session.");
    if (kind === "key_down" || kind === "mouse_down") scope.onCancel(() => this.release());
    const motion = { movement, duration_ms, steps, seed };
    const buttons = [...this.#heldButtons.keys()].reduce((mask, button) => mask | [1, 4, 2][button], 0);
    const move = async (px, py, dragging = buttons) => {
      if (movement && movement !== "instant") await this.#moveInput(px, py, scope, motion, modifiers, dragging);
      else await cursor.move(px, py, scope, movement === "instant");
    };
    scope.onCancel(() => cursor.hide());
    const mouse = (px, py, event) => {
      scope.check();
      this.#pointer = [px, py];
      for (const button of this.#heldButtons.keys()) this.#heldButtons.set(button, this.#pointer);
      this.#mouse(px, py, { ...this.#heldModifiers(), ...modifiers, buttons, ...event });
    };
    switch (kind) {
      case "click": {
        // why: Keep the node identity across cursor animation so a moved or replaced element cannot turn into an unintended click.
        const expected = ref ? this.env.element(ref) : this.hitAt(x, y);
        const label = ref || "Coordinate target";
        this.assertHit(expected, x, y, label);
        const hit = this.env.describeHit(this.hitAt(x, y), ref && expected);
        try {
          if (!silent) {
            await move(x, y);
            cursor.press();
          }
          mouse(x, y, { type: "mousemove" });
          for (let i = 1; i <= count; i++) {
            scope.check();
            this.assertHit(expected, x, y, label);
            mouse(x, y, { type: "mousedown", button, clickCount: i });
            mouse(x, y, { type: "mouseup", button, clickCount: i });
          }
          if (button === 0) this.#focusAt(x, y);
          if (!silent) this.env.ripple(x, y);
          return { hit };
        } finally {
          cursor.unpress();
        }
      }
      case "mouse_move":
      case "hover":
        await move(x, y);
        mouse(x, y, { type: "mousemove" });
        return "done";
      case "drag": {
        await move(x, y);
        cursor.press();
        mouse(x, y, { type: "mousemove" });
        mouse(x, y, { type: "mousedown" });
        let released = false;
        let last = [x, y];
        const release = () => {
          if (released) return;
          released = true;
          const point = movement && movement !== "instant" ? this.#pointer || last : last;
          this.#mouse(...point, { ...this.#heldModifiers(), type: "mouseup" });
          cursor.unpress();
        };
        const off = scope.onCancel(release);
        try {
          if (movement && movement !== "instant") {
            await this.#moveInput(to[0], to[1], scope, motion, modifiers, 1);
            last = [to[0], to[1]];
          } else
            for (let i = 1; i <= 10; i++) {
              await scope.wait(0, this.env);
              last = [x + ((to[0] - x) * i) / 10, y + ((to[1] - y) * i) / 10];
              mouse(...last, { type: "mousemove", buttons: 1 });
            }
        } finally {
          off();
          release();
        }
        await move(to[0], to[1]);
        return "done";
      }
      case "wheel":
        await move(x, y);
        return await this.#wheel(x, y, dx, dy, multiplier, scope);
      case "mouse_down": {
        this.#armRelease(session, hold_ms);
        if (this.#heldButtons.has(button)) return this.state();
        const expected = ref ? this.env.element(ref) : this.hitAt(x, y);
        this.assertHit(expected, x, y, ref || "Coordinate target");
        const hit = this.env.describeHit(this.hitAt(x, y), ref && expected);
        await move(x, y);
        this.assertHit(expected, x, y, ref || "Coordinate target");
        mouse(x, y, { type: "mousemove" });
        mouse(x, y, { type: "mousedown", button });
        this.#heldButtons.set(button, [x, y]);
        return { ...this.state(), hit };
      }
      case "mouse_up": {
        const point = this.#heldButtons.get(button);
        if (point) {
          this.#heldButtons.delete(button);
          this.#mouse(...point, { ...this.#heldModifiers(), type: "mouseup", button });
        }
        return this.state();
      }
      case "key_down": {
        if (!keys || keys.length !== 1) throw new Error("key_down accepts one key.");
        this.#armRelease(session, hold_ms);
        const { key } = keys[0];
        if (!this.#heldKeys.has(key)) {
          const sentKey = this.#heldModifiers().shiftKey && /^[a-z]$/.test(key) ? key.toUpperCase() : key;
          eu.synthesizeKey(sentKey, { ...this.#heldModifiers(), type: "keydown" }, win);
          this.#heldKeys.set(key, sentKey);
        }
        return this.state();
      }
      case "key_up": {
        const key = keys?.[0]?.key;
        const sentKey = this.#heldKeys.get(key);
        if (this.#heldKeys.delete(key)) eu.synthesizeKey(sentKey, { ...this.#heldModifiers(), type: "keyup" }, win);
        if (!this.#heldKeys.size && !this.#heldButtons.size) this.release();
        return this.state();
      }
      case "keys":
        cursor.label(L("pressing keys", "tuşa basıyor"));
        for (const { key, mods } of keys) {
          await scope.wait(0, this.env);
          scope.check();
          const merged = { ...this.#heldModifiers(), ...mods };
          eu.synthesizeKey(merged.shiftKey && /^[a-z]$/.test(key) ? key.toUpperCase() : key, merged, win);
        }
        return "done";
      case "text":
        if (Object.keys(this.#heldModifiers()).length)
          throw new Error("Release held modifiers before typing text; use key actions for shortcuts.");
        cursor.label(L("typing…", "yazıyor…"));
        for (const chunk of this.env.typingPlan(text, { typing, delay_ms, seed })) {
          await scope.wait(chunk.delay, this.env);
          scope.check();
          if (chunk.text === "\n") eu.synthesizeKey("KEY_Enter", {}, win);
          else eu.sendString(chunk.text, win);
        }
        return "done";
      default:
        throw new Error(`Unknown input kind: ${kind}`);
    }
  }

  // why: Background clicks do not move focus (docs/gecko-pitfalls.md, Input and frames).
  #focusAt(x, y) {
    const doc = this.env.document();
    const focusable = this.env.reader.closestShown(
      this.hitAt(x, y),
      'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href], [contenteditable=""], [contenteditable="true"], [tabindex]',
    );
    if (focusable && this.env.reader.deepActiveElement(doc) !== focusable) focusable.focus();
  }

  // why: Background wheel events reach listeners but do not scroll (docs/gecko-pitfalls.md, Input and frames).
  async #wheel(x, y, dx, dy, [mx, my], scope) {
    const win = this.env.window();
    const doc = this.env.document();
    const scroller = this.#scrollerAt(x, y);
    const { scrollLeft, scrollTop } = scroller;
    const moved = () => scroller.scrollLeft !== scrollLeft || scroller.scrollTop !== scrollTop;
    const dpr = win.devicePixelRatio;
    const at = this.env.processRoot(x, y);
    this.env
      .eventUtils()
      .synthesizeWheelAtPoint(at.x, at.y, { deltaX: (dx / mx) * dpr, deltaY: (dy / my) * dpr, deltaMode: 0 }, at.win);
    if (!moved()) {
      const target = scroller === doc.scrollingElement ? doc : scroller;
      const options = { mozSystemGroup: true };
      let timer, onScroll;
      try {
        await scope.race(
          new Promise((resolve) => {
            onScroll = () => {
              if (moved()) resolve();
            };
            target.addEventListener("scroll", onScroll, options);
            timer = this.env.setTimeout(resolve, 150);
          }),
        );
      } finally {
        this.env.clearTimeout(timer);
        target.removeEventListener("scroll", onScroll, options);
      }
    }
    scope.check();
    if (!moved()) scroller.scrollBy({ left: dx, top: dy, behavior: "instant" });
    return "done";
  }

  #scrollerAt(x, y) {
    const doc = this.env.document();
    const win = this.env.window();
    const { composedParent } = this.env.reader;
    for (let el = this.hitAt(x, y); el?.nodeType === 1 && el !== doc.documentElement; el = composedParent(el)) {
      const style = win.getComputedStyle(el);
      const scrollable = /(auto|scroll|overlay)/.test(style.overflowY + style.overflowX);
      if (scrollable && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) return el;
    }
    return doc.scrollingElement || doc.documentElement;
  }

  hitAt(x, y) {
    return this.env.reader.hitAt(this.env.document(), x, y);
  }

  assertHit(expected, x, y, label) {
    const win = this.env.window();
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= win.innerWidth || y >= win.innerHeight) {
      throw new Error(`Click blocked: ${label} is outside the viewport. Refresh screenshot/read_page.`);
    }
    if (!expected?.isConnected)
      throw new Error(`Click blocked: ${label} is gone or has no hit target. Refresh screenshot/read_page.`);
    if (expected.matches?.(":disabled")) throw new Error(`Click blocked: ${label} is disabled.`);
    const hit = this.hitAt(x, y);
    // why: Use composed ancestry to accept a descendant or shadow child hit inside the intended target.
    if (this.env.reader.contains(expected, hit)) return;
    const blocker = hit ? `${this.env.elementLabel(hit)} [${this.env.ref(hit)}]` : "no element";
    throw new Error(
      `Click blocked: ${label} is covered or moved at (${Math.round(x)}, ${Math.round(y)}); hit ${blocker}. Refresh screenshot/read_page and resolve the obstruction before retrying. No click was sent to the blocker.`,
    );
  }
}
