export const FPS = 4;
export const MAX_BYTES = 16 * 1024 * 1024;
const MAX_DURATION = 30;
const INTERVAL = 1000 / FPS;

export class TabVideo {
  #tabs = new Map();
  #active = new Set();

  constructor(env) {
    this.env = env;
  }

  async start(browser, session, duration = MAX_DURATION, check = () => {}) {
    if (!Number.isFinite(duration) || duration < 1 || duration > MAX_DURATION)
      throw new Error("Recording duration must be 1–30 seconds.");
    const id = browser.browserId;
    const current = this.#tabs.get(id);
    if (current && (!current.done || current.session !== session))
      throw new Error("A recording already exists for this tab.");
    if (this.#active.size >= 2) throw new Error("At most two tab videos can be recorded at once.");
    const record = { session, frames: [], bytes: 0, captureMs: 0 };
    // why: Reserve capacity before awaiting setup so concurrent recordings cannot exceed the limit.
    this.#tabs.set(id, record);
    this.#active.add(record);
    try {
      record.encoder = await this.env.encoder();
      record.path = await this.env.path();
      check();
      if (this.#tabs.get(id) !== record || record.result) throw new Error("Recording was stopped.");
    } catch (error) {
      if (this.#tabs.get(id) === record) this.#tabs.delete(id);
      this.#active.delete(record);
      throw error;
    }
    record.release = this.env.wake(browser);
    record.started = this.env.now();
    record.deadline = this.env.setTimeout(() => this.#finish(record, "duration limit"), duration * 1000);
    void this.#capture(record, browser);
    return { path: record.path, fps: FPS, maxDuration: duration };
  }

  async #capture(record, browser) {
    try {
      const start = this.env.now();
      this.env.check(browser, record.session);
      const frame = await this.env.frame(browser);
      if (record.result) return;
      this.env.check(browser, record.session);
      if (record.bytes + frame.byteLength > MAX_BYTES) {
        this.#finish(record, "size limit");
        return;
      }
      record.frames.push(frame);
      record.bytes += frame.byteLength;
      const elapsed = this.env.now() - start;
      record.captureMs += elapsed;
      record.timer = this.env.setTimeout(() => this.#capture(record, browser), Math.max(0, INTERVAL - elapsed));
    } catch {
      this.#finish(record, "capture ended");
    }
  }

  #finish(record, reason) {
    if (record.result) return record.result;
    this.env.clearTimeout(record.timer);
    this.env.clearTimeout(record.deadline);
    record.release?.();
    const durationMs = Math.max(0, this.env.now() - (record.started ?? this.env.now()));
    const { path, encoder, frames, captureMs } = record;
    record.result = Promise.resolve()
      .then(async () => {
        if (!frames.length) throw new Error("No video frames were captured.");
        const bytes = await this.env.encode(encoder, path, frames);
        return { path, bytes, frames: frames.length, fps: FPS, durationMs, captureMs, reason };
      })
      .finally(() => {
        frames.length = 0;
        record.done = true;
        this.#active.delete(record);
      });
    // why: Lifecycle cleanup can finish a recording without a stop caller waiting for it.
    void record.result.catch(() => {});
    return record.result;
  }

  async stop(id, session) {
    const record = this.#tabs.get(id);
    if (!record || record.session !== session) throw new Error("This session has no recording for that tab.");
    try {
      return await this.#finish(record, "requested");
    } finally {
      if (this.#tabs.get(id) === record) this.#tabs.delete(id);
    }
  }

  dropTab(id, session) {
    const record = this.#tabs.get(id);
    if (!record || (session !== undefined && record.session !== session)) return;
    this.#finish(record, "tab released");
    this.#tabs.delete(id);
  }

  dropSession(session) {
    for (const id of this.#tabs.keys()) this.dropTab(id, session);
  }

  stopAll() {
    for (const record of this.#tabs.values()) this.#finish(record, "stopped");
  }
}

export function videoEnvironment(ctx) {
  const subproc = () => ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs").Subprocess;
  return {
    setTimeout: ctx.setTimeout,
    clearTimeout: ctx.clearTimeout,
    now: Date.now,
    wake: (browser) => ctx.tabWake.hold(browser),
    check(browser, session) {
      ctx.access.check(browser.browserId, session);
      ctx.assertSiteAccess(browser);
    },
    path: () => ctx.artifacts.path("video", "webm"),
    async encoder() {
      try {
        return await subproc().pathSearch("ffmpeg");
      } catch {
        throw new Error("Recording requires ffmpeg on the browser's PATH.");
      }
    },
    async frame(browser) {
      const wg = browser.browsingContext?.currentWindowGlobal;
      if (!wg) throw new Error("The page has not loaded yet.");
      const bounds = browser.getBoundingClientRect();
      const scale = Math.min(1, 640 / bounds.width, 360 / bounds.height);
      const bitmap = await wg.drawSnapshot(null, scale, "white");
      try {
        const canvas = browser.ownerDocument.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
        const fit = Math.min(1, 640 / bitmap.width, 360 / bitmap.height);
        canvas.width = Math.max(1, Math.round(bitmap.width * fit));
        canvas.height = Math.max(1, Math.round(bitmap.height * fit));
        canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
        if (!blob) throw new Error("Could not capture a video frame.");
        return await blob.arrayBuffer();
      } finally {
        bitmap.close();
      }
    },
    async encode(command, path, frames) {
      const proc = await subproc().call({
        command,
        arguments: [
          "-hide_banner",
          "-loglevel",
          "error",
          "-n",
          "-f",
          "image2pipe",
          "-framerate",
          String(FPS),
          "-vcodec",
          "mjpeg",
          "-i",
          "pipe:0",
          "-an",
          "-vf",
          "scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,setsar=1",
          "-c:v",
          "libvpx",
          "-deadline",
          "realtime",
          "-cpu-used",
          "6",
          "-threads",
          "1",
          "-fs",
          String(MAX_BYTES),
          path,
        ],
      });
      const timer = ctx.setTimeout(() => proc.kill(0), 20_000);
      try {
        for (const frame of frames) await proc.stdin.write(frame);
        await proc.stdin.close();
        if ((await proc.wait()).exitCode) throw new Error("ffmpeg could not encode the tab recording.");
        return await ctx.artifacts.save(path);
      } catch {
        await proc.kill(0);
        await ctx.artifacts.remove(path);
        throw new Error("ffmpeg could not encode the tab recording.");
      } finally {
        ctx.clearTimeout(timer);
      }
    },
  };
}

export function recordTool(ctx) {
  return async ({ tabId, action, duration }, call) => {
    const browser = ctx.browserFor(call, tabId);
    if (action === "start") return ctx.text(await ctx.video.start(browser, call.session, duration, () => call.check()));
    if (action === "stop" && duration === undefined) return ctx.text(await ctx.video.stop(tabId, call.session));
    throw new Error("Use start (with optional duration) or stop.");
  };
}
