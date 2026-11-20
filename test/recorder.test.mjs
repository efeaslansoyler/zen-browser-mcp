import test from "node:test";
import assert from "node:assert/strict";
import { Recorder } from "../browser/actors/Recorder.sys.mjs";
import { Recordings } from "../browser/Recordings.sys.mjs";
import * as reader from "../browser/actors/PageReader.sys.mjs";
import { loadActor } from "./support/actor.mjs";

class El {
  nodeType = 1;
  isConnected = true;
  children = [];
  classList = [];
  constructor(localName, attrs = {}, props = {}) {
    this.localName = localName;
    this.tagName = localName.toUpperCase();
    this.attrs = new Map(Object.entries(attrs));
    this.id = attrs.id ?? "";
    this.type = attrs.type ?? (localName === "input" ? "text" : undefined);
    this.innerText = "";
    Object.assign(this, props);
  }
  append(...kids) {
    for (const kid of kids) {
      kid.parentElement = this;
      this.children.push(kid);
    }
    return this;
  }
  getAttribute(key) {
    return this.attrs.has(key) ? this.attrs.get(key) : null;
  }
  hasAttribute(key) {
    return this.attrs.has(key);
  }
  querySelector() {
    return null;
  }
}

function setup() {
  const steps = [];
  const body = new El("body");
  const document = { URL: "https://shop.test/", title: "Shop", body, getElementById: () => null };
  const recorder = new Recorder({
    document: () => document,
    window: () => ({}),
    post: (step) => steps.push(step),
    reader,
    info: { cssPath: (el) => (el.id ? `#${el.id}` : el.localName) },
  });
  const fire = (type, target, extra = {}) =>
    recorder.handle({ type, target, composedPath: () => [target], button: 0, ...extra });
  return { steps, body, document, fire };
}

test("typing becomes one type step with the final value, before the click that follows", () => {
  const { steps, body, fire } = setup();
  const search = new El("input", { id: "q", placeholder: "Search" }, { value: "" });
  const button = new El("button", { id: "go" });
  const icon = new El("span");
  button.append(icon);
  button.innerText = "Search";
  body.append(search, button);

  search.value = "red shoes";
  fire("input", search);
  fire("click", icon); // why: Model the missing blur-time change event in an unfocused Gecko window.
  fire("change", search);

  assert.deepEqual(
    steps.map((s) => [s.action, s.target?.selector, s.value]),
    [
      ["type", "#q", "red shoes"],
      ["click", "#go", undefined],
    ],
  );
  assert.equal(steps[0].target.name, "Search");
  assert.equal(steps[1].target.role, "button");
  assert.equal(steps[0].url, "https://shop.test/");
});

test("clicks that only focus a field and clicks made by the keyboard are not recorded", () => {
  const { steps, body, fire } = setup();
  const name = new El("input", { id: "name" }, { value: "Efe" });
  const submit = new El("button", { id: "save" });
  body.append(name, submit);
  fire("click", name);
  fire("click", submit, { detail: 0 }); // why: Gecko sends a trusted click when Enter implicitly submits the form.
  assert.deepEqual(steps, []);
  fire("keydown", submit, { key: " " });
  fire("click", submit, { detail: 0 });
  assert.deepEqual(
    steps.map((s) => [s.action, s.key, s.target.selector]),
    [["key", "Space", "#save"]],
  );
});

test("secret fields never carry their value, even after a show-password toggle", () => {
  const { steps, body, fire } = setup();
  const password = new El("input", { id: "pw", type: "password" }, { value: "" });
  const otp = new El("input", { id: "otp", autocomplete: "one-time-code" }, { value: "" });
  body.append(password, otp);

  password.value = "hunter2";
  fire("input", password);
  password.type = "text"; // why: Keep a once-secret field secret after its type changes to text.
  fire("change", password);
  otp.value = "123456";
  fire("input", otp);
  fire("change", otp);

  assert.equal(steps.length, 2);
  for (const step of steps) {
    assert.equal(step.secret, true);
    assert.equal("value" in step, false);
  }
  assert.doesNotMatch(JSON.stringify(steps), /hunter2|123456/);
});

test("select, checkbox and file changes become their own steps; label clicks don't duplicate them", () => {
  const { steps, body, fire } = setup();
  const size = new El("select", { id: "size" }, { selectedOptions: [{ label: "", text: " 42 " }], multiple: false });
  const terms = new El("input", { id: "terms", type: "checkbox" }, { checked: true });
  const label = new El("label", {}, { control: terms });
  const file = new El("input", { id: "cv", type: "file" }, { files: [{ name: "cv.pdf" }] });
  body.append(size, label, terms, file);

  fire("change", size);
  fire("click", label);
  fire("click", terms);
  fire("change", terms);
  fire("change", file);

  assert.deepEqual(
    steps.map((s) => [s.action, s.value ?? s.checked ?? s.files]),
    [
      ["select", "42"],
      ["check", true],
      ["upload", ["cv.pdf"]],
    ],
  );
});

test("Enter flushes the typed value first; plain keys, Tab and edit shortcuts are skipped", () => {
  const { steps, body, fire } = setup();
  const search = new El("input", { id: "q" }, { value: "" });
  const menu = new El("div", { role: "menu", id: "menu" });
  body.append(search, menu);

  search.value = "ab";
  fire("input", search);
  fire("keydown", search, { key: "a" });
  fire("keydown", search, { key: "ArrowLeft" });
  fire("keydown", search, { key: "v", ctrlKey: true });
  fire("keydown", search, { key: "Tab" });
  fire("keydown", search, { key: "Enter" });
  fire("keydown", menu, { key: "ArrowDown" });
  fire("keydown", menu, { key: "k", ctrlKey: true, shiftKey: true });

  assert.deepEqual(
    steps.map((s) => [s.action, s.value ?? s.key]),
    [
      ["type", "ab"],
      ["key", "Enter"],
      ["key", "ArrowDown"],
      ["key", "Control+Shift+k"],
    ],
  );
});

test("a click outside any control stays on the clicked element; links keep their href", () => {
  const { steps, body, fire } = setup();
  const card = new El("div", { id: "card" });
  const link = new El("a", { id: "more", href: "/more" }, { href: "https://shop.test/more" });
  const inner = new El("b");
  link.append(inner);
  body.append(card, link);
  fire("click", card);
  fire("click", inner);
  fire("click", card, { button: 2 });
  assert.deepEqual(
    steps.map((s) => [s.target.selector, s.target.href]),
    [
      ["#card", undefined],
      ["#more", "https://shop.test/more"],
    ],
  );
});

function recordings() {
  let shared = [];
  let now = 1000;
  const r = new Recordings({ setShared: (ids) => (shared = ids), now: () => now });
  return { r, shared: () => shared, tick: (ms) => (now += ms) };
}

test("Recordings publishes the recorded tabs and keeps only steps from them", async () => {
  const { r, shared, tick } = recordings();
  const live = [];
  r.start({ browserId: 7, currentURI: { spec: "https://shop.test/" } }, { onStep: (_r, s) => live.push(s) });
  assert.deepEqual(shared(), [7]);
  assert.throws(() => r.start({ browserId: 7 }), /already/);

  tick(50);
  r.accept({
    browserId: 7,
    isTop: true,
    step: { action: "click", target: { selector: "#go" }, url: "https://shop.test/" },
  });
  r.accept({ browserId: 8, isTop: true, step: { action: "click", url: "https://other.test/" } });
  r.accept({ browserId: 7, isTop: true, step: { action: "eval", code: "x" } });

  const result = await r.stop(7);
  assert.deepEqual(shared(), []);
  assert.equal(result.startUrl, "https://shop.test/");
  assert.deepEqual(result.steps, [{ action: "click", target: { selector: "#go" }, url: "https://shop.test/", at: 50 }]);
  assert.equal(live.length, 1);
  assert.equal(await r.stop(7), null);
});

test("Recordings merges repeated typing into one field and cleans untrusted fields", async () => {
  const { r } = recordings();
  r.start({ browserId: 1 });
  const type = (value) => ({
    browserId: 1,
    isTop: false,
    pageUrl: "https://shop.test/",
    step: { action: "type", value, target: { selector: "#q", evil: "x" }, url: "https://pay.test/frame", title: "t" },
  });
  r.accept(type("a"));
  r.accept(type("ab"));
  r.accept({
    browserId: 1,
    isTop: true,
    step: { action: "type", secret: true, value: "leak", url: "https://shop.test/" },
  });
  const { steps } = await r.stop(1);
  assert.deepEqual(steps[0], {
    action: "type",
    target: { selector: "#q" },
    value: "ab",
    url: "https://shop.test/",
    frameUrl: "https://pay.test/frame",
    at: 0,
  });
  assert.deepEqual(steps[1], { action: "type", secret: true, url: "https://shop.test/", at: 0 });
});

test("the actor records only trusted events in recorded tabs and sends them to the parent", () => {
  let recorded = [];
  const Actor = loadActor({
    Services: { locale: { appLocaleAsBCP47: "en" }, cpmm: { sharedData: { get: () => recorded } } },
    console,
  });
  const sent = [];
  const button = new El("button", { id: "buy" });
  const doc = {
    URL: "https://shop.test/",
    title: "Shop",
    body: new El("body").append(button),
    getElementById: () => null,
  };
  const actor = new Actor();
  Object.defineProperties(actor, {
    document: { value: doc },
    contentWindow: { value: { CSS: { escape: (s) => s } } },
    browsingContext: { value: { browserId: 5 } },
  });
  doc.querySelectorAll = () => [button];
  doc.documentElement = new El("html");
  button.ownerDocument = doc;
  actor.sendAsyncMessage = (name, data) => sent.push([name, data]);
  const click = (isTrusted) => ({ type: "click", isTrusted, button: 0, target: button, composedPath: () => [button] });

  actor.handleEvent(click(true));
  recorded = [5];
  actor.handleEvent(click(false));
  actor.handleEvent(click(true));

  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], "record_step");
  assert.equal(sent[0][1].action, "click");
  assert.equal(sent[0][1].target.selector, "#buy");
});

test("Recordings captures each step in order and stop waits for the images", async () => {
  const calls = [];
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const r = new Recordings({
    setShared() {},
    now: () => 0,
    async capture({ index, rect, frameId }) {
      calls.push([index, rect, frameId]);
      if (index === 0) await gate;
      return { image: `${index + 1}.jpg` };
    },
  });
  r.start({ browserId: 3 }, { dir: "/tmp/rec" });
  const step = (action, value, rect) => ({
    browserId: 3,
    frameId: 9,
    isTop: true,
    step: { action, value, target: { selector: "#q" }, url: "u", rect },
  });
  r.accept(step("click", undefined, { x: 1, y: 2, width: 3, height: 4 }));
  r.accept(step("type", "a", { x: NaN, y: 0, width: 1, height: 1 }));
  r.accept(step("type", "ab"));
  r.accept({ ...step("type"), step: { action: "type", secret: true, url: "u" } });
  let done = false;
  const stopped = r.stop(3).then((result) => ((done = true), result));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(done, false);
  release();
  const { steps } = await stopped;
  assert.deepEqual(calls, [
    [0, { x: 1, y: 2, width: 3, height: 4 }, 9],
    [1, null, 9],
    [1, null, 9],
  ]);
  assert.deepEqual(
    steps.map((s) => [s.action, s.image, "rect" in s]),
    [
      ["click", "1.jpg", false],
      ["type", "2.jpg", false],
      ["type", undefined, false],
    ],
  );
});
