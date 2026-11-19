// Loads all of main.js with the real .sys.mjs modules. Gecko APIs are filled with stubs that
// allow anything; the point is setup errors, not behavior (TDZ, a missing import, a wrong env
// field). In the browser those only reach the log and a reload stays on the old version.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// a new stub on every access: callable, constructible, converts to string/number, iterates empty
function stub() {
  return new Proxy(function () {}, {
    get(_target, key) {
      if (key === Symbol.toPrimitive) return () => "";
      if (key === Symbol.iterator) return function* () {};
      if (key === "then") return undefined; // not a thenable when awaited
      if (key === "exists") return () => false; // no config or version file: defaults
      return stub();
    },
    apply: () => stub(),
    construct: () => stub(),
  });
}

const dir = new URL("../browser/", import.meta.url);
const observers = new Map();
const gecko = {
  Components: new Proxy(
    {},
    {
      get() {
        return stub();
      },
    },
  ),
  Services: new Proxy(
    {},
    {
      get(_target, key) {
        if (key === "wm") return { getEnumerator: () => [], getMostRecentWindow: () => null };
        if (key === "obs")
          return { addObserver: (fn, topic) => observers.set(topic, fn), removeObserver() {}, notifyObservers() {} };
        return stub();
      },
    },
  ),
};
gecko.Cc = gecko.Components.classes;
gecko.Ci = gecko.Components.interfaces;
gecko.Cu = gecko.Components.utils;
gecko.Cr = gecko.Components.results;

// modules use ChromeUtils/Ci at their top level: make them global before importing
const modules = new Map();
gecko.ChromeUtils = new Proxy(
  {},
  {
    get(_target, key) {
      if (key !== "importESModule") return stub();
      return (url) => {
        const name = url.match(/^resource:\/\/zenmcp\/(.+?\.sys\.mjs)/)?.[1];
        if (!name) return stub(); // resource://gre/... (NetUtil, Timer)
        assert.ok(modules.has(name), `unknown module ${name}`);
        return modules.get(name);
      };
    },
  },
);
Object.assign(globalThis, gecko);
// actors/ isn't imported; actors are registered by URI
for (const name of fs.readdirSync(dir)) {
  if (name.endsWith(".sys.mjs")) modules.set(name, await import(new URL(name, dir)));
}

for (const legacySessionStore of [false, true]) {
  test(`main.js starts with the ${legacySessionStore ? "legacy" : "current"} SessionStore path`, () => {
    let importedLegacy = false;
    const ChromeUtils = Object.create(gecko.ChromeUtils, {
      importESModule: {
        value(url) {
          if (legacySessionStore && url === "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs")
            throw new Error("SessionStore is packaged under resource:///modules/sessionstore/ on this build");
          if (url === "resource:///modules/sessionstore/SessionStore.sys.mjs") importedLegacy = true;
          return gecko.ChromeUtils.importESModule(url);
        },
      },
    });
    const context = vm.createContext({ ...gecko, ChromeUtils, zenMcpDir: "/zen-mcp", zenMcpName: "zen-mcp", console });
    vm.runInContext(fs.readFileSync(new URL("main.js", dir), "utf8"), context, { filename: "main.js" });
    // errors caused by the stubs (e.g. the config file) don't count; only setup and start
    assert.equal(context.zenMcpStartError, undefined);
    // without windows, start waits for final-ui-startup; simulate that moment
    const startup = observers.get("final-ui-startup");
    assert.ok(startup, "start was not scheduled");
    startup();
    assert.equal(context.zenMcpStartError, undefined);
    assert.equal(context.zenMcpRunning, context.zenMcpVersion);
    context.zenMcpStop();
    assert.equal(importedLegacy, legacySessionStore);
  });
}
