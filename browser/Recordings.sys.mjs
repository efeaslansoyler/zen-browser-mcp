// why: Content-process messages are untrusted, so validate the sender and bound the fields.
// why: Serialize screenshot capture and finish it before returning the recording.
// why: Skip images for secret fields so recording cannot expose their values.

export const RECORDING_KEY = "zen-mcp:recording";
export const STEP_TOPIC = "zen-mcp-record-step";
const MAX_STEPS = 300;
const ACTIONS = new Set(["click", "type", "select", "check", "upload", "key"]);
const TARGET_FIELDS = ["role", "name", "label", "selector", "text", "href", "type"];

const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : undefined);

export class Recordings {
  #active = new Map();

  constructor(env) {
    this.env = env;
  }

  start(browser, { onStep = () => {}, dir = null } = {}) {
    if (this.#active.has(browser.browserId)) throw new Error("This tab is already being recorded.");
    const recording = {
      dir,
      browserId: browser.browserId,
      startUrl: browser.currentURI?.spec ?? "",
      startedAt: this.env.now(),
      steps: [],
      truncated: false,
      onStep,
      captures: Promise.resolve(),
    };
    this.#active.set(browser.browserId, recording);
    this.#publish();
    return recording;
  }

  async stop(browserId) {
    const recording = this.#active.get(browserId);
    if (!recording) return null;
    this.#active.delete(browserId);
    this.#publish();
    await recording.captures;
    const { onStep, captures, ...result } = recording;
    return result;
  }

  stopAll() {
    for (const browserId of [...this.#active.keys()]) this.stop(browserId).catch(() => {});
  }

  isRecording(browserId) {
    return this.#active.has(browserId);
  }

  accept(message) {
    const recording = this.#active.get(message?.browserId);
    if (!recording) return;
    const step = this.#clean(message);
    if (!step) return;
    const last = recording.steps.at(-1);
    if (step.action === "type" && last?.action === "type" && sameTarget(last, step)) {
      recording.steps[recording.steps.length - 1] = { ...step, at: last.at };
    } else if (recording.steps.length >= MAX_STEPS) {
      recording.truncated = true;
      return;
    } else {
      recording.steps.push({ ...step, at: this.env.now() - recording.startedAt });
    }
    const index = recording.steps.length - 1;
    if (recording.dir && !step.secret) this.#capture(recording, index, cleanRect(message.step.rect), message.frameId);
    try {
      recording.onStep(recording, recording.steps[index]);
    } catch {}
  }

  #capture(recording, index, rect, frameId) {
    const step = recording.steps[index];
    recording.captures = recording.captures
      .then(() => this.env.capture({ recording, index, rect, frameId }))
      .then((files) => {
        // why: A merged step can replace a capture while it is pending; only the latest capture owns the filenames.
        if (files && recording.steps[index] === step) Object.assign(step, files);
      })
      .catch(() => {});
  }

  #clean({ isTop, pageUrl, step }) {
    if (!step || !ACTIONS.has(step.action)) return null;
    const clean = { action: step.action };
    if (step.target && typeof step.target === "object") {
      clean.target = {};
      for (const field of TARGET_FIELDS) {
        const value = text(step.target[field], field === "href" ? 2000 : 300);
        if (value) clean.target[field] = value;
      }
    }
    if (step.action === "type") {
      if (step.secret === true) clean.secret = true;
      else clean.value = text(step.value, 2000) ?? "";
    }
    if (step.action === "select") {
      clean.value = Array.isArray(step.value)
        ? step.value.slice(0, 50).map((v) => text(v, 300) ?? "")
        : (text(step.value, 300) ?? "");
    }
    if (step.action === "check") clean.checked = step.checked === true;
    if (step.action === "upload")
      clean.files = Array.isArray(step.files) ? step.files.slice(0, 20).map((f) => text(f, 300) ?? "") : [];
    if (step.action === "key") {
      clean.key = text(step.key, 60);
      if (!clean.key) return null;
    }
    clean.url = text(isTop ? step.url : pageUrl, 2000) ?? "";
    if (!isTop) clean.frameUrl = text(step.url, 2000) ?? "";
    const title = text(step.title, 300);
    if (isTop && title) clean.title = title;
    return clean;
  }

  #publish() {
    this.env.setShared([...this.#active.keys()]);
  }
}

function cleanRect(rect) {
  if (!rect || typeof rect !== "object") return null;
  const values = [rect.x, rect.y, rect.width, rect.height];
  if (!values.every((v) => Number.isFinite(v) && Math.abs(v) < 1e6)) return null;
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function sameTarget(a, b) {
  return a.target?.selector === b.target?.selector && a.url === b.url && a.frameUrl === b.frameUrl;
}

async function topRect(browserId, rect, frameId) {
  let frame = BrowsingContext.get(frameId);
  if (!rect || frame?.top?.browserId !== browserId) return null;
  for (; frame.parent; frame = frame.parent) {
    const o = await frame.parent.currentWindowGlobal
      ?.getActor("ZenMcp")
      .sendQuery("frame_rect", { bcId: frame.id, scroll: false })
      .catch(() => null);
    if (!o || o.error) return null;
    rect = { ...rect, x: rect.x + o.x, y: rect.y + o.y };
  }
  return rect;
}

const MAX_WIDTH = 1280;
const round = (n) => Math.round(n * 1000) / 1000;
const PAD = 16;

export async function captureStep({ recording, index, rect, frameId, color }) {
  const browser = BrowsingContext.getCurrentTopByBrowserId(recording.browserId)?.embedderElement;
  if (!browser) return null;
  rect = await topRect(recording.browserId, rect, frameId);
  const dir = recording.dir;
  const wg = browser.browsingContext?.currentWindowGlobal;
  if (!wg) return null;
  const doc = browser.ownerDocument;
  // why: Suppress transient input overlays so screenshots show the user's page.
  const frames = browser.browsingContext.getAllBrowsingContextsInSubtree();
  const overlays = (hidden) =>
    Promise.all(
      frames.map((bc) => {
        try {
          return bc.currentWindowGlobal?.getActor("ZenMcp").sendQuery("overlays", { hidden });
        } catch {}
      }),
    ).catch(() => {});
  await overlays(true);
  let bitmap;
  try {
    bitmap = await wg.drawSnapshot(null, 1, "white");
  } finally {
    overlays(false);
  }
  const s = Math.min(1, MAX_WIDTH / bitmap.width);
  const canvas = doc.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  canvas.width = Math.round(bitmap.width * s);
  canvas.height = Math.round(bitmap.height * s);
  const g = canvas.getContext("2d");
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const box = rect && {
    x: rect.x * s - 4,
    y: rect.y * s - 4,
    width: rect.width * s + 8,
    height: rect.height * s + 8,
  };
  if (box) {
    g.lineJoin = "round";
    const ring = (width, style) => {
      g.lineWidth = width;
      g.strokeStyle = style;
      g.strokeRect(box.x, box.y, box.width, box.height);
    };
    ring(7, "rgba(0, 0, 0, 0.35)");
    ring(5, color);
    ring(1.5, "rgba(255, 255, 255, 0.9)");
  }
  const jpeg = async (source) =>
    new Uint8Array(await (await new Promise((resolve) => source.toBlob(resolve, "image/jpeg", 0.85))).arrayBuffer());
  await IOUtils.makeDirectory(dir, { permissions: 0o700 });
  const name = String(index + 1).padStart(3, "0");
  const files = { image: `${name}.jpg` };
  // why: Store the element position as fractions so playback can zoom across image sizes.
  if (box)
    files.focus = {
      x: round(box.x / canvas.width),
      y: round(box.y / canvas.height),
      width: round(box.width / canvas.width),
      height: round(box.height / canvas.height),
      aspect: round(canvas.height / canvas.width),
    };
  await IOUtils.write(`${dir}/${files.image}`, await jpeg(canvas));
  if (box) {
    const left = Math.max(0, Math.floor(box.x - PAD));
    const top = Math.max(0, Math.floor(box.y - PAD));
    const width = Math.min(canvas.width, Math.ceil(box.x + box.width + PAD)) - left;
    const height = Math.min(canvas.height, Math.ceil(box.y + box.height + PAD)) - top;
    if (width > 4 && height > 4) {
      const crop = doc.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      crop.width = width;
      crop.height = height;
      crop.getContext("2d").drawImage(canvas, left, top, width, height, 0, 0, width, height);
      files.crop = `${name}-crop.jpg`;
      await IOUtils.write(`${dir}/${files.crop}`, await jpeg(crop));
    }
  }
  return files;
}
