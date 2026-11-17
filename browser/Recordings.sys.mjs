// "Show me once": collects the steps the user shows in a tab. Each frame's actor
// (actors/Recorder.sys.mjs) records the user's input while the tab's browserId is in the
// shared recording list; ZenMcpParent passes the steps here through an observer topic.
//
// Steps come from content processes, so they are untrusted: only known fields are kept, strings
// are cut to size and steps from tabs that aren't recorded are dropped.
//
// env: { setShared(browserIds): publishes the recorded tabs to every content process,
//        now(): ms }

export const RECORDING_KEY = "zen-mcp:recording";
export const STEP_TOPIC = "zen-mcp-record-step";
const MAX_STEPS = 300;
const ACTIONS = new Set(["click", "type", "select", "check", "upload", "key"]);
const TARGET_FIELDS = ["role", "name", "label", "selector", "text", "href", "type"];

const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : undefined);

export class Recordings {
  #active = new Map(); // browserId → recording

  constructor(env) {
    this.env = env;
  }

  // onStep(recording, step) runs after each new or merged step (live counter on the island).
  start(browser, { onStep = () => {} } = {}) {
    if (this.#active.has(browser.browserId)) throw new Error("This tab is already being recorded.");
    const recording = {
      browserId: browser.browserId,
      startUrl: browser.currentURI?.spec ?? "",
      startedAt: this.env.now(),
      steps: [],
      truncated: false,
      onStep,
    };
    this.#active.set(browser.browserId, recording);
    this.#publish();
    return recording;
  }

  // Ends the recording and returns it (null if the tab wasn't recorded).
  stop(browserId) {
    const recording = this.#active.get(browserId);
    if (!recording) return null;
    this.#active.delete(browserId);
    this.#publish();
    const { onStep, ...result } = recording;
    return result;
  }

  stopAll() {
    for (const browserId of [...this.#active.keys()]) this.stop(browserId);
  }

  isRecording(browserId) {
    return this.#active.has(browserId);
  }

  // A message from ZenMcpParent: { browserId, isTop, pageUrl, step }.
  accept(message) {
    const recording = this.#active.get(message?.browserId);
    if (!recording) return;
    const step = this.#clean(message);
    if (!step) return;
    const last = recording.steps.at(-1);
    // Typing into the same field again: keep the final value only.
    if (step.action === "type" && last?.action === "type" && sameTarget(last, step)) {
      recording.steps[recording.steps.length - 1] = { ...step, at: last.at };
    } else if (recording.steps.length >= MAX_STEPS) {
      recording.truncated = true;
      return;
    } else {
      recording.steps.push({ ...step, at: this.env.now() - recording.startedAt });
    }
    try {
      recording.onStep(recording, recording.steps.at(-1));
    } catch {}
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

function sameTarget(a, b) {
  return a.target?.selector === b.target?.selector && a.url === b.url && a.frameUrl === b.frameUrl;
}
