// why: The reader needs inherited cursors, listener info and layout text, which plain object fakes keep getting wrong.
import { loadActor } from "./actor.mjs";

class Text {
  nodeType = 3;
  constructor(data) {
    this.data = data;
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
    for (const child of this.childNodes) if (child.nodeType === 1) child.parentElement = this;
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
      .filter((node) => !node.hidden)
      .map((node) =>
        node.nodeType === 3 ? node.data : node.display === "inline" ? node.innerText : `\n${node.innerText}\n`,
      )
      .join("")
      .replace(/\n+/g, "\n")
      .trim();
  }
  get display() {
    return (
      this.style.display ??
      (["span", "b", "a", "label", "img", "svg", "input", "br"].includes(this.localName) ? "inline" : "block")
    );
  }
  get cursor() {
    return this.style.cursor ?? this.parentElement?.cursor ?? "auto";
  }
  get parentNode() {
    return this.parentElement;
  }
  getRootNode() {
    return {};
  }
  getAttribute(key) {
    return this.attrs[key] ?? null;
  }
  hasAttribute(key) {
    return key in this.attrs;
  }
  checkVisibility() {
    return !this.hidden && (this.parentElement?.checkVisibility() ?? true);
  }
  getBoundingClientRect() {
    return this.box;
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
  actor.document = {
    title: "Page",
    URL: "https://page.test/",
    body,
    documentElement: root,
    getElementById: () => null,
  };
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
