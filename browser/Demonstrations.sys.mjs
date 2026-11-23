export const MAX_SHOW_TIMEOUT = 3600;
const PAGE_MENU_ID = "zen-mcp-context-record";
const TRY_NOW =
  "The user asks you to try this recipe now: open a new tab (tabs_create_mcp, clean: true if the site needs no login), follow the steps with your own tools, hand secret steps to the user (hand_to_user), and report what happened.";

let recordingId = 0;

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

export async function demonstrate(
  ctx,
  browser,
  { message, name, timeout, wait, targets = null, notify = true, agent },
) {
  const { L } = ctx;
  if (ctx.recordings.isRecording(browser.browserId)) throw new Error("This tab is already being recorded.");
  const dir = `${ctx.runtimeDir}/${ctx.app}-recordings/${Date.now()}-${++recordingId}`;
  const title = (n) =>
    n === 0
      ? L("Recording · do it in the tab", "Kaydediliyor · sekmede yap")
      : L(`Recording · ${n} step${n === 1 ? "" : "s"}`, `Kaydediliyor · ${n} adım`);
  ctx.island?.recording(browser, title(0), message);
  const notified = notify && ctx.notifyAsk(browser, message, agent);
  ctx.recordings.start(browser, { dir, onStep: (r) => ctx.island?.recordingProgress(title(r.steps.length)) });
  const discard = () => ctx.recipes.io.remove(dir).catch(() => {});
  let answer, recording;
  try {
    answer = await wait(timeout);
  } catch (e) {
    ctx.island?.askEnded();
    discard();
    throw e;
  } finally {
    await Promise.all(
      browser.browsingContext.getAllBrowsingContextsInSubtree().map(async (bc) => {
        try {
          await bc.currentWindowGlobal?.getActor("ZenMcp").sendQuery("record_flush", {});
        } catch {}
      }),
    );
    recording = await ctx.recordings.stop(browser.browserId);
    if (notified) ctx.closeAskAlert();
  }
  const end = async (status) => {
    ctx.island?.askEnded();
    await discard();
    return { status };
  };
  const statusOf = (a) => a?.status ?? a;
  if (statusOf(answer) !== "done") return end(statusOf(answer) === "timeout" ? "timeout" : "cancelled");
  if (!recording?.steps.length) return end("empty");

  const existing = await ctx.recipes.list();
  const image = (file) => (file ? ctx.fileURL(`${dir}/${file}`) : null);
  const model = new ctx.ReviewModel({
    name: name?.trim() || browser.contentTitle || hostOf(recording.startUrl) || "Recipe",
    steps: recording.steps,
    existingNames: existing.map((r) => r.name),
    targets,
    L,
    images: { thumb: (step) => image(step.crop ?? step.image), image: (step) => image(step.image) },
  });
  const n = recording.steps.length;
  ctx.island?.review(
    browser,
    L(`Review the recording · ${n} step${n === 1 ? "" : "s"}`, `Kaydı gözden geçir · ${n} adım`),
    model,
  );
  let review;
  try {
    review = await wait(MAX_SHOW_TIMEOUT);
  } catch (e) {
    await discard();
    throw e;
  } finally {
    ctx.island?.askEnded();
  }
  if (statusOf(review) !== "done" || !review.choice)
    return end(statusOf(review) === "timeout" ? "timeout" : "cancelled");
  const { choice } = review;
  const replace = existing.find((r) => r.name.toLocaleLowerCase("tr") === String(choice.name).toLocaleLowerCase("tr"));
  const recipe = await ctx.recipes.save(recording, {
    name: choice.name,
    note: choice.note,
    removed: choice.removed,
    variables: choice.variables,
    replace: replace?.id ?? null,
    imagesDir: dir,
  });
  await discard();
  return { status: "saved", recipe, recording, choice };
}

export function demonstrationTools(ctx) {
  const { text } = ctx;
  return {
    async show_me({ tabId, message, name, timeout = 900 }, call) {
      const browser = ctx.browserFor(call, tabId);
      if (typeof message !== "string" || !message.trim()) throw new Error("message must say what to show.");
      timeout = Math.min(Math.max(Number(timeout) || 900, 30), MAX_SHOW_TIMEOUT);
      // why: The user can demonstrate only one task at a time, so other requests queue cancellably.
      const busy = ctx.locks.busy("recording");
      const turn = ctx.locks.acquire(["recording"]);
      let result;
      try {
        if (busy) {
          const { L } = ctx;
          const key = {};
          const card = ctx.island?.ask(
            browser,
            `${ctx.hostOf(browser)} — ${L("waits to record", "kayıt için bekliyor")}`,
            L(
              `${message}\n\nAnother recording is running; this one starts when it ends.`,
              `${message}\n\nŞu an başka bir kayıt sürüyor; bu kayıt o bitince başlayacak.`,
            ),
            false,
            {},
            [],
            { key, agent: call.agent, session: call.session },
          );
          const gaveUp = ctx.waitIslandAnswer(call, timeout, key);
          let first;
          try {
            first = await Promise.race([turn.ready.then(() => "ready"), gaveUp]);
          } finally {
            if (card != null) ctx.island?.askEnded(card);
            ctx.tabRequests.get(key)?.("replaced");
          }
          if (first !== "ready")
            return text(
              first === "timeout"
                ? `The user did not show it within ${timeout} s.`
                : "The user cancelled; nothing was saved.",
            );
        } else await ctx.guard(turn.ready, call);
        result = await demonstrate(ctx, browser, {
          message,
          name,
          timeout,
          wait: (seconds) => ctx.waitIslandAnswer(call, seconds, browser),
          agent: call.agent,
        });
      } finally {
        turn.release();
      }
      if (result.status === "timeout") return text(`The user did not finish within ${timeout} s; nothing was saved.`);
      if (result.status === "cancelled") return text("The user cancelled; nothing was saved.");
      if (result.status === "empty") return text("The user finished without doing any steps; nothing was saved.");
      const { recipe, recording, choice } = result;
      return text(
        [
          `Saved the demonstration as recipe ${recipe.id}${recording.truncated ? " (cut at the step limit)" : ""}.`,
          ctx.recipes.text(recipe),
          ...(choice.tryNow ? ["", TRY_NOW] : []),
        ].join("\n"),
      );
    },
  };
}

export class Demonstrations {
  constructor(env) {
    this.env = env;
    this.cleanups = new Set();
    this.running = new Set();
  }

  // why: User-started recordings are independent of agent calls and must survive agent Stop.
  #wait(browser, seconds) {
    const { ctx } = this.env;
    return new Promise((resolve) => {
      ctx.tabRequests.get(browser)?.("replaced");
      const timer = ctx.setTimeout(() => done("timeout"), seconds * 1000);
      const done = (answer) => {
        ctx.clearTimeout(timer);
        if (ctx.tabRequests.get(browser) === done) ctx.tabRequests.delete(browser);
        resolve(answer);
      };
      ctx.tabRequests.set(browser, done);
    });
  }

  async start(browser) {
    const { L, ctx } = this.env;
    this.env.assertSiteAccess(browser);
    if (this.running.has(browser)) return;
    this.running.add(browser);
    try {
      const targets = ctx.sendTargets().map(({ id, label, agent }) => ({ id, name: label, agent }));
      const result = await demonstrate(ctx, browser, {
        message: L(
          "Do the task in this tab; every click and entry is recorded (passwords are not). Press Finish when done.",
          "İşi bu sekmede yap; her tıklama ve giriş kaydedilir (şifreler hariç). Bitince Bitir'e bas.",
        ),
        timeout: MAX_SHOW_TIMEOUT,
        wait: (seconds) => this.#wait(browser, seconds),
        targets,
        notify: false,
      });
      if (result.status === "saved") await this.#deliver(browser, result);
    } catch (e) {
      this.env.logError("recording", e);
    } finally {
      this.running.delete(browser);
    }
  }

  async #deliver(browser, { recipe, choice }) {
    const { L, ctx } = this.env;
    const target = choice.targetId ? ctx.sendTargets().find((t) => t.id === choice.targetId) : null;
    let notice = L(`Saved “${recipe.name}”`, `“${recipe.name}” kaydedildi`);
    if (choice.targetId) {
      const content = [
        `The user showed you a task in the browser and saved it as recipe ${recipe.id}.`,
        ctx.recipes.text(recipe),
        ...(choice.tryNow ? ["", TRY_NOW] : []),
      ].join("\n");
      const meta = { recipe: recipe.id, url: recipe.startUrl, source_tab: String(browser.browserId) };
      let status = "missing";
      try {
        status = await ctx.inbox.send(choice.targetId, { kind: "recipe", content, meta });
      } catch (e) {
        this.env.logError("recipe delivery", e);
      }
      if (status === "missing") this.env.copy(content);
      notice = L(`Saved; ${ctx.sentNotice(status, target)}`, `Kaydedildi; ${ctx.sentNotice(status, target)}`);
    }
    ctx.island?.working(browser, notice, { session: "recording-notice", agent: ctx.lastAgent });
    ctx.island?.finished("recording-notice");
  }

  attachPageMenu(win) {
    const { L } = this.env;
    const doc = win.document;
    const menu = doc.getElementById("contentAreaContextMenu");
    if (!menu || doc.getElementById(PAGE_MENU_ID)) return;
    const item = doc.createXULElement("menuitem");
    item.id = PAGE_MENU_ID;
    item.className = "menuitem-iconic";
    item.setAttribute("label", L("Record steps for an agent…", "Ajan için adımları kaydet…"));
    const anchor = doc.getElementById("inspect-separator");
    menu.insertBefore(item, anchor?.parentNode === menu ? anchor : null);
    let browser = null;
    const onShowing = (event) => {
      if (event.target !== menu) return;
      this.env.paintIcon(item, this.env.menuAgent());
      const context = win.gContextMenu;
      browser = context?.browser ?? null;
      let web = false;
      try {
        web = /^(https?|file)$/.test(browser.currentURI.scheme);
      } catch {}
      item.hidden = !web || !!context.browsingContext?.parent;
      item.disabled = this.running.has(browser);
    };
    const onCommand = () => {
      if (browser) this.start(browser);
    };
    menu.addEventListener("popupshowing", onShowing);
    item.addEventListener("command", onCommand);
    this.cleanups.add(() => {
      menu.removeEventListener("popupshowing", onShowing);
      item.remove();
    });
  }

  destroy() {
    for (const cleanup of this.cleanups) {
      try {
        cleanup();
      } catch {}
    }
    this.cleanups.clear();
  }
}
