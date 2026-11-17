// "Show me once": the review on the island after the user presses Finish. The user names the
// recipe, deletes wrong steps, marks values that change every time ("↻ Changes") and can play
// the steps back from their screenshots before saving.
//
// ReviewModel holds the state and has no DOM; renderReview builds the panel for one window
// from it. The island rebuilds the panel after clicks and keeps it while the user types.

const MAX_VARIABLE = 30;
const PLAY_EVERY = 2200; // ms per step in Play

const quote = (s) => `“${s}”`;

// The step as the user reads it on the island (their language; describeStep in Recipes.sys.mjs
// is the agent's English version).
export function stepLabel(step, L) {
  const name = step.target?.name || step.target?.text || step.target?.label || "";
  const on = name ? ` → ${name}` : "";
  switch (step.action) {
    case "click":
      return L(
        `Click ${quote(name || step.target?.label || "?")}`,
        `Tıkla: ${quote(name || step.target?.label || "?")}`,
      );
    case "type":
      return step.secret
        ? L(
            `Fill in the secret field${name ? ` ${quote(name)}` : ""}`,
            `Gizli alanı doldur${name ? `: ${quote(name)}` : ""}`,
          )
        : L(`Type ${quote(step.value ?? "")}${on}`, `Yaz: ${quote(step.value ?? "")}${on}`);
    case "select":
      return L(`Choose ${quote(step.value)}${on}`, `Seç: ${quote(step.value)}${on}`);
    case "check":
      return step.checked
        ? L(`Check ${quote(name)}`, `İşaretle: ${quote(name)}`)
        : L(`Uncheck ${quote(name)}`, `İşareti kaldır: ${quote(name)}`);
    case "upload":
      return L(`Upload ${(step.files ?? []).join(", ")}`, `Yükle: ${(step.files ?? []).join(", ")}`);
    case "key":
      return L(`Press ${step.key}`, `Bas: ${step.key}`);
    default:
      return step.action;
  }
}

// The small line under the step: the site, and the frame for steps in an iframe.
function stepDetail(step, L) {
  const host = (url) => {
    try {
      return new URL(url).host;
    } catch {
      return "";
    }
  };
  if (step.secret)
    return L(
      "secret: not recorded; the agent leaves this step to you",
      "gizli, kaydedilmedi; bu adımı agent sana bırakır",
    );
  if (step.frameUrl) return L(`in a frame from ${host(step.frameUrl)}`, `${host(step.frameUrl)} çerçevesinde`);
  return host(step.url);
}

// Play's frame (SHOT_WIDTH × SHOT_HEIGHT) shows the screenshot zoomed in around the element,
// the element in the middle where the image allows it; without focus, the whole image.
const SHOT_WIDTH = 500;
const SHOT_HEIGHT = 290;
export function zoomOn(focus) {
  const valid = focus && ["x", "y", "width", "height", "aspect"].every((k) => Number.isFinite(focus[k]));
  if (!valid) return { backgroundSize: "contain", backgroundPosition: "center" };
  // the element takes about half of the frame, between the whole image and 3×
  const fit = Math.min(SHOT_WIDTH, SHOT_HEIGHT / focus.aspect); // image width when it fits the frame
  const zoom = Math.min(3, Math.max(1, 0.5 / Math.max(focus.width, (focus.height * focus.aspect * fit) / SHOT_HEIGHT)));
  const width = fit * zoom;
  const height = width * focus.aspect;
  const at = (center, image, frame) =>
    image <= frame ? 50 : Math.min(100, Math.max(0, ((center * image - frame / 2) / (image - frame)) * 100));
  return {
    backgroundSize: `${Math.round(width)}px auto`,
    backgroundPosition: `${at(focus.x + focus.width / 2, width, SHOT_WIDTH).toFixed(1)}% ${at(focus.y + focus.height / 2, height, SHOT_HEIGHT).toFixed(1)}%`,
  };
}

export const canVary = (step) => (step.action === "type" && !step.secret) || step.action === "select";

export function cleanVariable(name) {
  return String(name ?? "")
    .replace(/[{}\n\r\t]/g, "")
    .trim()
    .slice(0, MAX_VARIABLE);
}

export class ReviewModel {
  // steps: the recording's steps; images: { thumb(step), image(step) } → URL or null
  constructor({ name, steps, existingNames = [], L, images = {} }) {
    this.L = L;
    this.name = name ?? "";
    this.note = "";
    this.existing = new Set(existingNames.map((n) => n.toLocaleLowerCase("tr")));
    this.items = steps.map((step) => ({
      step,
      text: stepLabel(step, L),
      detail: stepDetail(step, L),
      thumb: images.thumb?.(step) ?? null,
      image: images.image?.(step) ?? null,
      removed: false,
      variable: null,
    }));
    this.mode = "list"; // list | play
    this.index = 0; // the step shown in play
    this.playing = false;
  }

  get exists() {
    return this.existing.has(this.name.trim().toLocaleLowerCase("tr"));
  }

  get kept() {
    return this.items.filter((item) => !item.removed);
  }

  get canSave() {
    return !!this.name.trim() && this.kept.length > 0;
  }

  toggleRemoved(i) {
    this.items[i].removed = !this.items[i].removed;
  }

  // On: the variable's name is suggested from the field's name; off: the recorded value again.
  toggleVariable(i) {
    const item = this.items[i];
    if (!canVary(item.step)) return;
    item.variable =
      item.variable === null
        ? cleanVariable((item.step.target?.name || this.L("value", "değer")).toLocaleLowerCase("tr")) ||
          this.L("value", "değer")
        : null;
  }

  renameVariable(i, name) {
    if (this.items[i].variable !== null) this.items[i].variable = cleanVariable(name);
  }

  // What the island sends back on Save.
  result() {
    const variables = {};
    this.items.forEach((item, i) => {
      if (!item.removed && item.variable) variables[i] = item.variable;
    });
    return {
      name: this.name.trim(),
      note: this.note.trim(),
      removed: this.items.flatMap((item, i) => (item.removed ? [i] : [])),
      variables,
    };
  }

  // ---- play: the kept steps one by one ----

  play() {
    if (!this.kept.length) return;
    this.mode = "play";
    this.index = this.items.indexOf(this.kept[0]);
    this.playing = true;
  }

  // dir: 1 or -1; false at the end
  step(dir) {
    const kept = this.kept;
    const at = kept.indexOf(this.items[this.index]);
    const next = kept[at + dir];
    if (!next) return false;
    this.index = this.items.indexOf(next);
    return true;
  }

  backToList() {
    this.mode = "list";
    this.playing = false;
  }
}

// The panel for one window. hooks: { changed() (rebuild), save(), cancel(), setTimeout,
// clearTimeout }. Returns { node, dispose() }.
export function renderReview(doc, model, hooks) {
  const { L } = model;
  const XHTML = "http://www.w3.org/1999/xhtml";
  const node = (tag, cls, text) => {
    const n = doc.createElementNS(XHTML, tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const button = (cls, text, onClick, title) => {
    const b = node("button", cls, text);
    if (title) b.title = title;
    b.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
    return b;
  };
  const root = node("div", "review");
  let timer = null;
  const dispose = () => hooks.clearTimeout(timer);

  if (model.mode === "play") {
    const item = model.items[model.index];
    const kept = model.kept;
    const at = kept.indexOf(item);
    const shot = node("div", "shot");
    if (item.image) {
      const img = node("div", "img");
      img.style.backgroundImage = `url("${item.image}")`;
      Object.assign(img.style, zoomOn(item.step.focus));
      shot.append(img);
    } else shot.append(node("div", "no-shot", item.step.secret ? "🔒" : L("No screenshot", "Görüntü yok")));
    const caption = node("div", "caption");
    const back = () => {
      model.backToList();
      hooks.changed();
    };
    caption.append(
      button("", "←", back, L("Back to the list (Esc)", "Listeye dön (Esc)")),
      node("span", "count", `${at + 1} / ${kept.length}`),
      node("span", "text", item.text),
    );
    const dots = node("span", "dots");
    for (const k of kept) dots.append(node("i", k === item ? "on" : ""));
    const go = (dir) => {
      model.playing = false;
      if (model.step(dir)) hooks.changed();
    };
    caption.append(
      dots,
      button("", "◀", () => go(-1), L("Previous (←)", "Önceki (←)")),
      button("", model.playing ? "❚❚" : "▶", () => {
        model.playing = !model.playing;
        hooks.changed();
      }),
      button("", "▶", () => go(1), L("Next (→)", "Sonraki (→)")),
    );
    root.append(shot, caption);
    root.setAttribute("mode", "play");
    if (model.playing)
      timer = hooks.setTimeout(() => {
        if (!model.step(1)) model.playing = false;
        hooks.changed();
      }, PLAY_EVERY);
    root.tabIndex = -1;
    root.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") go(-1);
      else if (event.key === "ArrowRight") go(1);
      else if (event.key === "Escape") back();
      else return;
      event.preventDefault();
    });
    return { node: root, dispose, focus: () => root.focus() };
  }

  // name
  const field = node("label", "name-field");
  field.append(node("span", "", L("Recipe name", "Tarif adı")));
  const name = node("input", "name");
  name.value = model.name;
  name.maxLength = 80;
  field.append(name);
  const warn = node(
    "div",
    "warn",
    L("A recipe with this name exists; saving overwrites it.", "Bu isimde bir tarif var; kaydedersen üzerine yazılır."),
  );
  root.append(field, warn);

  // steps
  const list = node("div", "steps");
  model.items.forEach((item, i) => {
    const row = node("div", "step");
    row.toggleAttribute("removed", item.removed);
    row.append(node("span", "n", String(i + 1)));
    const thumb = node("div", "thumb");
    if (item.step.secret) thumb.append(node("span", "lock", "🔒"));
    else if (item.thumb) {
      const img = node("img");
      img.src = item.thumb;
      thumb.append(img);
    }
    row.append(thumb);
    const what = node("div", "what");
    const text = node("div", "text", item.text);
    if (item.variable !== null) text.classList.add("varied");
    what.append(text);
    if (item.variable !== null) {
      const chip = node("label", "var");
      chip.append(node("span", "", "↻"));
      const input = node("input");
      input.value = item.variable;
      input.maxLength = MAX_VARIABLE;
      input.title = L("What changes: the agent asks you for it", "Değişen şey: agent bunu sana sorar");
      input.addEventListener("input", () => model.renameVariable(i, input.value));
      input.addEventListener("click", (event) => event.stopPropagation());
      chip.append(input, node("span", "example", L(`example: ${item.step.value}`, `örnek: ${item.step.value}`)));
      what.append(chip);
    } else if (item.detail) what.append(node("small", "", item.detail));
    row.append(what);
    const tools = node("div", "tools");
    if (canVary(item.step) && !item.removed)
      tools.append(
        button(
          `vary${item.variable !== null ? " active" : ""}`,
          L("↻ Changes", "↻ Değişir"),
          () => {
            model.toggleVariable(i);
            hooks.changed();
          },
          L("Changes every time", "Her seferinde değişsin"),
        ),
      );
    tools.append(
      button(
        "remove",
        item.removed ? "↶" : "✕",
        () => {
          model.toggleRemoved(i);
          hooks.changed();
        },
        item.removed ? L("Keep this step", "Bu adımı geri al") : L("Delete this step", "Bu adımı sil"),
      ),
    );
    row.append(tools);
    list.append(row);
  });
  root.append(list);

  const note = node("textarea", "review-note");
  note.placeholder = L(
    "Note: what the agent should know (optional)",
    "Not: agent'ın bilmesi gerekenler (isteğe bağlı)",
  );
  note.maxLength = 2000;
  note.value = model.note;
  note.addEventListener("input", () => (model.note = note.value));
  root.append(note);

  const footer = node("div", "footer");
  const play = button("", L("▶ Play", "▶ Oynat"), () => {
    model.play();
    hooks.changed();
  });
  play.disabled = !model.kept.length;
  const save = button("primary", "", () => {
    if (model.canSave) hooks.save();
  });
  const refresh = () => {
    warn.hidden = !model.exists;
    save.textContent = model.exists ? L("Overwrite", "Üzerine yaz") : L("Save", "Kaydet");
    save.disabled = !model.canSave;
  };
  name.addEventListener("input", () => {
    model.name = name.value;
    refresh();
  });
  name.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && model.canSave) hooks.save();
  });
  footer.append(
    play,
    node("span", "spacer"),
    button("", L("Cancel", "Vazgeç"), () => hooks.cancel()),
    save,
  );
  root.append(footer);
  refresh();
  return { node: root, dispose, focus: () => name.focus() };
}

export const REVIEW_CSS = `
  & .recdot { display: none; flex: none; width: 9px; height: 9px; margin: 0 2px; border-radius: 50%;
    background: #ff5a4f; box-shadow: 0 0 0 3px rgba(255, 90, 79, 0.25); animation: zen-mcp-rec 1.6s ease-in-out infinite; }
  &[state="recording"] .recdot { display: block; }
  &:is([state="recording"], [state="review"]) .spark { display: none; }
  & .rec-button { display: none; }
  &[state="recording"] .rec-button { display: block; }
  /* recording: one line that leaves the page free; the message shows on hover (and before the first step) */
  &[state="recording"] .detail { display: none; }
  &[state="recording"]:is(:hover, [fresh]) .detail { display: flex; }
  &[state="recording"] :is(.answer-note, .buttons, .choices) { display: none !important; }
  &[state="recording"] .stop, &[state="review"] .stop { display: none; }

  & .review-host { display: none; }
  &[state="review"] .review-host { display: block; }
  & .review { display: flex; flex-direction: column; gap: 9px; width: 470px; max-width: 100%; padding: 0 12px 12px 33px; box-sizing: border-box; outline: none; }
  & .review[mode="play"] { width: 520px; padding: 0 10px 10px; align-items: center; }
  & .review[mode="play"] .caption { align-self: stretch; }
  & .name-field { display: flex; align-items: center; gap: 8px; }
  & .name-field > span { flex: none; opacity: 0.55; font-size: 11.5px; white-space: nowrap; }
  & .review input { appearance: none; box-sizing: border-box; border: none; outline: none; color: inherit; font: inherit; }
  & .review input.name { flex: 1; height: 28px; padding: 0 9px; border-radius: 9px; background: rgba(255, 255, 255, 0.08);
    box-shadow: inset 0 0 0 1px rgba(var(--zen-agent-rgb, 217, 119, 87), 0.7); }
  & .warn { margin: -4px 0 0; color: #f0b27a; font-size: 11.5px; }
  & .warn[hidden] { display: none; }
  & .steps { display: flex; flex-direction: column; gap: 3px; max-height: min(330px, 45vh); overflow-y: auto; margin-left: -6px; }
  & .step { display: flex; align-items: center; gap: 9px; padding: 4px 6px 4px 4px; border-radius: 10px; }
  & .step:hover { background: rgba(255, 255, 255, 0.06); }
  & .step[removed] > :not(.tools) { opacity: 0.35; }
  & .step[removed] .text { text-decoration: line-through; }
  & .step .n { flex: none; width: 16px; text-align: right; opacity: 0.45; font-size: 11px; font-variant-numeric: tabular-nums; }
  & .thumb { flex: none; display: grid; place-items: center; width: 64px; height: 38px; overflow: hidden; border-radius: 6px;
    background: rgba(255, 255, 255, 0.06); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12); }
  & .thumb img { width: 100%; height: 100%; object-fit: cover; }
  & .what { flex: 1; min-width: 0; line-height: 1.3; }
  & .what .text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  & .what .text.varied { opacity: 0.5; text-decoration: line-through; }
  & .what small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.5; font-size: 11px; }
  & .var { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; margin-top: 4px; padding: 2px 8px 2px 8px; border-radius: 999px;
    background: rgba(var(--zen-agent-rgb, 217, 119, 87), 0.2); color: #ffc3ac; font-size: 11.5px; font-weight: 600; }
  & .var input { width: 96px; height: 20px; padding: 0 8px; border-radius: 999px; background: rgba(0, 0, 0, 0.35);
    box-shadow: inset 0 0 0 1px rgba(var(--zen-agent-rgb, 217, 119, 87), 0.8); }
  & .var .example { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; opacity: 0.75; }
  & .tools { display: flex; gap: 2px; opacity: 0; }
  & .step:is(:hover, :focus-within, [removed]) .tools, & .tools:has(.active) { opacity: 1; }
  & .tools button { padding: 0 8px; background: none; opacity: 0.8; font-weight: 600; }
  & .tools button:hover { background: rgba(255, 255, 255, 0.12); opacity: 1; }
  & .tools .vary.active { background: rgba(var(--zen-agent-rgb, 217, 119, 87), 0.25); color: #ffc3ac; opacity: 1; }
  & .review-note { width: 100%; height: 32px; }
  & .review .footer { display: flex; align-items: center; gap: 6px; }
  & .review .spacer { flex: 1; }
  & .review button:disabled { opacity: 0.4; cursor: default; }
  & .shot { display: grid; place-items: center; width: 500px; height: 290px; overflow: hidden; border-radius: 11px; background: #fff; }
  & .shot .img { width: 100%; height: 100%; background-color: #fff; background-repeat: no-repeat; }
  & .no-shot { color: #666; font-size: 13px; }
  & .caption { display: flex; align-items: center; gap: 6px; }
  & .caption .count { flex: none; opacity: 0.5; font-size: 11px; font-variant-numeric: tabular-nums; }
  & .caption .text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  & .dots { display: flex; gap: 4px; margin: 0 6px; }
  & .dots i { width: 6px; height: 6px; border-radius: 50%; background: rgba(255, 255, 255, 0.22); }
  & .dots i.on { width: 16px; border-radius: 3px; background: var(--zen-agent-accent, #d97757); }
`;
