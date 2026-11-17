// Runs the real ZenMcpChild actor in a VM with the browser stubbed at the platform boundary.
// The actor's imports resolve to the real modules; tests pass the Gecko globals they need
// (Services, Cu, …) and, optionally, the timers the actor imports from Timer.sys.mjs.
import fs from 'node:fs';
import vm from 'node:vm';

const browser = new URL('../../browser/', import.meta.url);
const modules = new Map();
for (const name of ['Agent', 'InputMotion', 'Cancellation', 'ReactInspect']) {
  modules.set(`${name}.sys.mjs`, await import(new URL(`${name}.sys.mjs`, browser)));
}
for (const name of fs.readdirSync(new URL('actors/', browser))) {
  if (name.endsWith('.sys.mjs') && !name.startsWith('ZenMcp')) modules.set(name, await import(new URL(`actors/${name}`, browser)));
}
const source = fs.readFileSync(new URL('actors/ZenMcpChild.sys.mjs', browser), 'utf8')
  .replaceAll('import.meta.url', JSON.stringify('file:///browser/actors/ZenMcpChild.sys.mjs'))
  .replace('export class ZenMcpChild', 'globalThis.Actor = class ZenMcpChild');

export function loadActor(globals = {}, { timers = { setTimeout, clearTimeout } } = {}) {
  const context = vm.createContext({
    JSWindowActorChild: class {}, URL, WeakRef,
    Services: { locale: { appLocaleAsBCP47: 'en' } },
    ...globals,
    ChromeUtils: { importESModule(url) {
      if (url.includes('/Timer.sys.mjs')) return timers;
      const name = new URL(url).pathname.split('/').pop();
      if (!modules.has(name)) throw new Error(`unexpected import ${url}`);
      return modules.get(name);
    } },
  });
  vm.runInContext(source, context);
  return context.Actor;
}
