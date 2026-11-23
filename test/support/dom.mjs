// why: The reader needs inherited cursors, listener info and layout text, which plain object fakes keep getting wrong.
import { loadActor } from "./actor.mjs";

// why: As in Gecko, native text and visibility know slotted nodes but never enter a shadow root.
const slotOf = (node) => {
  const root = node.parentElement?.openOrClosedShadowRoot;
  const name = node.attrs?.slot ?? "";
  return root?.querySelectorAll("slot").find((slot) => (slot.attrs.name ?? "") === name) ?? null;
};
const shownParent = (node) =>
  node.parentElement?.openOrClosedShadowRoot ? slotOf(node) : (node.parentElement ?? node.parentNode?.host ?? null);
const isLeftOut = (node) => !!node.parentElement?.openOrClosedShadowRoot && !slotOf(node);

class Text {
  nodeType = 3;
  parentElement = null;
  constructor(data) {
    this.data = data;
  }
  get openOrClosedAssignedSlot() {
    return slotOf(this);
  }
  get textContent() {
    return this.data;
  }
}

class Element {
  nodeType = 1;
  isConnected = true;
  parentElement = null;
  listeners = [];
  style = {};
  box = { top: 0, left: 0, bottom: 10, right: 10, width: 10, height: 10 };

  constructor(tag, attrs, children) {
    this.localName = tag;
    this.tagName = tag.toUpperCase();
    const { on = [], style = {}, box, ...rest } = attrs;
    this.listeners = [].concat(on);
    this.style = style;
    if (box) this.box = { ...this.box, ...box };
    this.attrs = rest;
    this.classList = (rest.class ?? "").split(" ").filter(Boolean);
    this.childNodes = children.map((child) => (typeof child === "string" ? new Text(child) : child));
    for (const child of this.childNodes) child.parentElement = this;
  }
  get openOrClosedAssignedSlot() {
    return slotOf(this);
  }
  assignedNodes() {
    const { host } = this.getRootNode();
    return (host?.childNodes ?? []).filter((node) => slotOf(node) === this);
  }
  get id() {
    return this.attrs.id ?? "";
  }
  get type() {
    return this.attrs.type ?? (this.localName === "input" ? "text" : undefined);
  }
  get children() {
    return this.childNodes.filter((node) => node.nodeType === 1);
  }
  get hidden() {
    return "hidden" in this.attrs;
  }
  get tabIndex() {
    return Number(this.attrs.tabindex ?? -1);
  }
  get textContent() {
    return this.childNodes.map((node) => node.textContent).join("");
  }
  get innerText() {
    if (this.localName === "br") return "\n";
    return this.childNodes
      .filter((node) => !node.hidden && !isLeftOut(node))
      .map((node) =>
        node.nodeType === 3 ? node.data : node.display === "inline" ? node.innerText : `\n${node.innerText}\n`,
      )
      .join("")
      .replace(/\n+/g, "\n")
      .trim();
  }
  get display() {
    if (this.localName === "slot") return "contents";
    return (
      this.style.display ??
      (["span", "b", "a", "label", "img", "svg", "input", "br"].includes(this.localName) ? "inline" : "block")
    );
  }
  get cursor() {
    return this.style.cursor ?? shownParent(this)?.cursor ?? "auto";
  }
  get parentNode() {
    return this.parentElement ?? this.shadow ?? null;
  }
  get ownerDocument() {
    const root = this.getRootNode();
    return root.host ? root.host.ownerDocument : root;
  }
  getRootNode() {
    if (this.parentNode) return this.parentElement?.getRootNode() ?? this.shadow;
    return (this.document ??= {
      nodeType: 9,
      defaultView: {
        getComputedStyle: (el) => ({
          cursor: el.cursor,
          display: el.display,
          visibility: "visible",
          whiteSpace: "normal",
        }),
      },
      createRange: () => ({ selectNodeContents() {}, getClientRects: () => [this.box] }),
      getElementById: (id) => this.querySelectorAll("*").find((el) => el.id === id) ?? null,
      querySelectorAll: (selector) => this.querySelectorAll(selector),
    });
  }
  getAttribute(key) {
    return this.attrs[key] ?? null;
  }
  hasAttribute(key) {
    return key in this.attrs;
  }
  get rendered() {
    return !this.hidden && !isLeftOut(this) && (shownParent(this)?.rendered ?? true);
  }
  checkVisibility() {
    return this.rendered && this.display !== "contents";
  }
  getBoundingClientRect() {
    return this.display === "contents" ? { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 } : this.box;
  }
  getClientRects() {
    return this.display === "contents" ? [] : [this.box];
  }
  scrollIntoView() {}
  dispatchEvent() {}
  querySelectorAll(selector) {
    const all = this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
    return selector === "*" ? all : all.filter((el) => el.matches(selector));
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  matches(selector) {
    return selector.split(",").some((part) => {
      const [, tag, attr, value] = part.trim().match(/^(\w*)(?:\[([\w-]+)(?:="?([^"\]]*)"?)?\])?$/) ?? [];
      if (!tag && !attr) return false;
      if (tag && tag !== this.localName) return false;
      return !attr || (value === undefined ? this.hasAttribute(attr) : this.getAttribute(attr) === value);
    });
  }
  closest(selector) {
    return this.matches(selector) ? this : (this.parentElement?.closest(selector) ?? null);
  }
  contains(other) {
    for (let el = other; el; el = el.parentElement) if (el === this) return true;
    return false;
  }
}

class ShadowRoot {
  nodeType = 11;
  parentNode = null;
  constructor(host, children) {
    this.host = host;
    const holder = new Element("holder", {}, children);
    this.childNodes = holder.childNodes;
    this.querySelectorAll = (selector) => holder.querySelectorAll(selector);
    for (const child of this.childNodes) {
      child.parentElement = null;
      child.shadow = this;
    }
  }
  isUAWidget() {
    return false;
  }
  getElementById(id) {
    return this.querySelectorAll("*").find((el) => el.id === id) ?? null;
  }
}

export function shadow(host, ...children) {
  host.openOrClosedShadowRoot = new ShadowRoot(host, children);
  return host;
}

export const h = (tag, attrs = {}, ...children) => new Element(tag, attrs, children);

export function page(...children) {
  const root = h("html", {}, h("body", {}, ...children));
  const body = root.children[0];
  const events = [];
  const Actor = loadActor({
    Ci: {},
    Cc: {},
    Services: {
      scriptloader: {
        loadSubScript(_, eu) {
          eu.synthesizeMouseAtPoint = (x, y, event) => events.push(event.type);
        },
      },
      locale: { appLocaleAsBCP47: "en" },
      els: { getListenerInfoFor: (el) => el.listeners.map((type) => ({ type, inSystemEventGroup: false })) },
    },
  });
  const actor = new Actor();
  actor.contentWindow = {
    innerWidth: 800,
    innerHeight: 600,
    Event: class {},
    getComputedStyle: (el) => ({ cursor: el.cursor, display: el.display }),
  };
  actor.document = Object.assign(root.ownerDocument, {
    title: "Page",
    URL: "https://page.test/",
    body,
    documentElement: root,
  });
  const send = async (name, data = {}) => {
    const result = await actor.receiveMessage({ name, data: { documentNumber: 1, ...data } });
    if (result.error) throw new Error(result.error);
    return result.value;
  };
  return {
    actor,
    body,
    events,
    // why: Answers the click's hit test with this element.
    async click(el, data = {}) {
      actor.document.elementFromPoint = () => el;
      const { hit } = await send("input", { kind: "click", x: 5, y: 5, silent: true, session: "a", ...data });
      return hit.replace(/ref_\d+[a-z]+/, "ref");
    },
    async ref(query) {
      return (await send("find", { query }))[0].line.match(/ref_\d+[a-z]+/)[0];
    },
    send,
    read: async (data = {}) =>
      (await send("read_page", { bare: true, ...data }))
        .replace(/ref_\d+[a-z]+/g, "ref")
        .split("\n")
        .filter(Boolean),
    find: async (query) =>
      (await send("find", { query }))
        .sort((a, b) => b.score - a.score)
        .map((hit) => hit.line.replace(/ref_\d+[a-z]+/g, "ref")),
  };
}
