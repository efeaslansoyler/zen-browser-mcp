// "Show me once" from start to end: record a tab while the user does a task, let the user
// review the steps on the island, save them as a recipe. Two ways in:
//   - an agent calls show_me in its tab and gets the recipe back;
//   - the user picks "Record steps for an agent…" in any web page's context menu, and can send
//     the saved recipe to a connected session (Claude Code channel or Codex queue), optionally
//     asking it to try the recipe at once.
// The pieces: Recordings.sys.mjs (steps and screenshots), RecordingReview.sys.mjs (the review),
// Recipes.sys.mjs (storage and the agents' text), Island.sys.mjs (recording/review states).
// They come through ctx (ctx.recipes, ctx.ReviewModel): modules don't import each other, so a
// bridge reload never mixes versions.

export const MAX_SHOW_TIMEOUT = 3600;
const PAGE_MENU_ID = "zen-mcp-context-record";
// the next step for an agent the user asked to try a recipe
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

// The shared flow. wait(timeout) resolves with the island answer for this tab; targets (the
// user's flow) adds the session picker to the review. Returns { status, recipe?, recording?,
// choice? }; status is saved, cancelled, timeout or empty.
export async function demonstrate(ctx, browser, { message, name, timeout, wait, targets = null, notify = true }) {
  const { L } = ctx;
  if (ctx.recordings.isRecording(browser.browserId)) throw new Error("This tab is already being recorded.");
  const dir = `${ctx.runtimeDir}/${ctx.app}-recordings/${Date.now()}-${++recordingId}`;
  const title = (n) =>
    n === 0
      ? L("Recording · do it in the tab", "Kaydediliyor · sekmede yap")
      : L(`Recording · ${n} step${n === 1 ? "" : "s"}`, `Kaydediliyor · ${n} adım`);
  ctx.island?.recording(browser, title(0), message);
  const notified = notify && ctx.notifyAsk(browser, message);
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
    // typed values that have no step yet, then the steps and their images
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

  // the review: name, delete steps, mark values that change, play back, choose a session
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
    // The user does the task in the agent's tab while every step is recorded; the island shows
    // one line with a live step count and Finish / Cancel (the agent's message on hover). After
    // Finish the user reviews the steps and saves. Blocks until the user saves or cancels.
    async show_me({ tabId, message, name, timeout = 900 }) {
      const browser = ctx.browserFor(tabId);
      if (typeof message !== "string" || !message.trim()) throw new Error("message must say what to show.");
      timeout = Math.min(Math.max(Number(timeout) || 900, 30), MAX_SHOW_TIMEOUT);
      const result = await demonstrate(ctx, browser, {
        message,
        name,
        timeout,
        wait: (seconds) => ctx.waitIslandAnswer(seconds, browser),
      });
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

// The user's own recordings: the page menu item, the flow, and sending the recipe.
// env: { L, ctx (the bridge context), channels, assertSiteAccess(browser), copy(text),
//        logError(where, e), paintIcon(item, agent), menuAgent() }
export class Demonstrations {
  constructor(env) {
    this.env = env;
    this.cleanups = new Set();
    this.running = new Set(); // browsers being recorded or reviewed
  }

  // Answers come from the island like an agent's question, but nothing here belongs to an
  // agent operation, so Stop or an agent's tool call doesn't end the user's recording.
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
      const targets = [...this.env.channels.subscribers.values()].map(({ id, name, agent }) => ({ id, name, agent }));
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
    const target = choice.targetId ? this.env.channels.subscribers.get(choice.targetId) : null;
    let notice = L(`Saved “${recipe.name}”`, `“${recipe.name}” kaydedildi`);
    if (choice.targetId) {
      const content = [
        `The user showed you a task in the browser and saved it as recipe ${recipe.id}.`,
        ctx.recipes.text(recipe),
        ...(choice.tryNow ? ["", TRY_NOW] : []),
      ].join("\n");
      const meta = { recipe: recipe.id, url: recipe.startUrl, source_tab: String(browser.browserId) };
      let sent = false;
      try {
        sent = target ? await this.env.channels.deliver(target, { event: "channel", content, meta }) : false;
      } catch (e) {
        this.env.logError("recipe delivery", e);
      }
      if (!sent) this.env.copy(content);
      notice = sent
        ? L(`Saved and sent to ${target.name} ✓`, `Kaydedildi, ${target.name} oturumuna gönderildi ✓`)
        : L("Saved; sending failed, copied to clipboard", "Kaydedildi; gönderilemedi, panoya kopyalandı");
    }
    ctx.island?.working(browser, notice);
    ctx.island?.idle();
  }

  // "Record steps for an agent…" in the page context menu (top frame of web pages)
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
