import test from "node:test";
import assert from "node:assert/strict";
import { bridgeContext } from "./support/bridge.mjs";
import { loadActor } from "./support/actor.mjs";
import * as agent from "../browser/Agent.sys.mjs";

test("highlight groups items by frame, numbers unlabeled ones and clears the other frames", async () => {
  const top = { id: 1 },
    child = { id: 2 };
  const browser = { browserId: 1, browsingContext: top };
  const sent = [];
  const ctx = bridgeContext({
    browserFor: () => browser,
    framesOf: () => [top, child],
    frameOf: (_, ref) => (ref.startsWith("ref_2") ? child : top),
    toPagePoint: (_, point) => point,
    deepest: async (_, x, y) => ({ frame: top, x, y }),
    query: async (_, name, data, __, frame) => {
      sent.push({ frame: frame.id, items: data.items });
      return { value: data.items.length };
    },
    text: (value) => [{ type: "text", text: value }],
  });
  await ctx.tools.highlight({
    tabId: 1,
    items: [
      { ref: "ref_1b", label: "Username" },
      { ref: "ref_1c" },
      { ref: "ref_2b", label: " " },
      { coordinate: [5, 6] },
    ],
  });
  assert.deepEqual(sent, [
    {
      frame: 1,
      items: [
        { ref: "ref_1b", label: "Username", number: "1" },
        { ref: "ref_1c", label: "", number: "2" },
        { x: 5, y: 6, label: "", number: "4" },
      ],
    },
    { frame: 2, items: [{ ref: "ref_2b", label: "", number: "3" }] },
  ]);
  sent.length = 0;
  assert.match((await ctx.tools.highlight({ tabId: 1, clear: true }))[0].text, /removed/);
  assert.deepEqual(sent, [
    { frame: 1, items: [] },
    { frame: 2, items: [] },
  ]);
  await assert.rejects(ctx.tools.highlight({ tabId: 1, items: [] }), /1 to 20/);
  await assert.rejects(ctx.tools.highlight({ tabId: 1, items: [{ label: "x" }] }), /needs a ref or a coordinate/);
});

test("a frame that disappears doesn't fail clearing, but does fail drawing", async () => {
  const top = { id: 1 },
    gone = { id: 2 };
  const ctx = bridgeContext({
    browserFor: () => ({ browsingContext: top }),
    framesOf: () => [top, gone],
    frameOf: (_, ref) => (ref.startsWith("ref_2") ? gone : top),
    query: async (_, __, ___, ____, frame) => {
      if (frame === gone) throw new Error("The page has not loaded yet.");
      return { value: 0 };
    },
    text: (value) => [{ type: "text", text: value }],
  });
  await ctx.tools.highlight({ tabId: 1, items: [{ ref: "ref_1b" }] });
  await assert.rejects(ctx.tools.highlight({ tabId: 1, items: [{ ref: "ref_2b" }] }), /not loaded/);
});

class Node {
  children = [];
  style = {
    setProperty(key, value) {
      this[key] = value;
    },
  };
  isConnected = true;
  nodeType = 1;
  offsetWidth = 50;
  constructor(name) {
    this.localName = name;
  }
  setAttribute() {}
  getAttribute() {
    return null;
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  attachShadow() {
    return (this.shadow = new Node("#shadow"));
  }
  remove() {
    this.isConnected = false;
    this.parent?.children.splice(this.parent.children.indexOf(this), 1);
  }
  getBoundingClientRect() {
    return { left: 40, top: 60, right: 140, bottom: 90, width: 100, height: 30 };
  }
  scrollIntoView() {}
}

test("the page actor draws labeled frames, replaces them and removes them", async () => {
  const Actor = loadActor({ Cu: { waiveXrays: (value) => value } });
  const actor = new Actor();
  const button = new Node("button");
  const root = new Node("html");
  root.append = (...nodes) => {
    for (const node of nodes) node.parent = root;
    root.children.push(...nodes);
  };
  actor.document = {
    documentElement: root,
    createElement: (name) => new Node(name),
    elementFromPoint: () => button,
    querySelectorAll: (selector) => root.children.filter((n) => selector.includes(n.localName)),
  };
  button.ownerDocument = actor.document;
  actor.contentWindow = {
    innerWidth: 800,
    innerHeight: 600,
    getComputedStyle: () => ({ borderTopLeftRadius: "999px" }),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
  };
  actor.browsingContext = { id: 1 };
  const send = (name, data) =>
    actor.receiveMessage({ name, data: { agent: agent.agentTheme({ id: "claude" }), ...data } });
  const tags = () =>
    root.children.flatMap((host) =>
      host.shadow.children
        .filter((n) => n.className === "tag")
        .map((n) => n.children.map((c) => (typeof c === "string" ? c : c.textContent)).join(" ")),
    );
  assert.equal(
    (
      await send("highlight", {
        items: [
          { x: 10, y: 10, label: "Pay", number: "1" },
          { x: 20, y: 20, label: "", number: "2" },
        ],
      })
    ).value,
    2,
  );
  assert.deepEqual(tags(), ["1 Pay", "2"], "a number badge, then the optional label");
  const ring = root.children[0].shadow.children.find((n) => n.className === "ring");
  assert.equal(ring.style.borderRadius, "1002px", "the ring follows the element's corner radius");
  await send("highlight", { items: [{ x: 10, y: 10, label: "Only", number: "1" }] });
  assert.deepEqual(tags(), ["1 Only"], "a new call replaces the old highlights");
  await send("overlays", { hidden: true });
  assert.equal(root.children[0].style.visibility, "hidden", "highlights stay out of the agent's screenshots");
  await send("highlight", { items: [] });
  assert.deepEqual(root.children, []);
});
