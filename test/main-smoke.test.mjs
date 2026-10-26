// main.js'i bütün olarak, gerçek .sys.mjs modülleriyle yükler. Gecko API'leri her şeye izin
// veren saplarla doldurulur; amaç davranış değil kurulum hataları (TDZ, eksik içe aktarım,
// yanlış env alanı). Bunlar tarayıcıda yalnız log'a düşer, reload eski sürümde kalır.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// her erişimde yeni sap: çağrılabilir, kurulabilir, dize/sayıya dönüşür, boş dolaşılır
function stub() {
  return new Proxy(function () {}, {
    get(_target, key) {
      if (key === Symbol.toPrimitive) return () => '';
      if (key === Symbol.iterator) return function* () {};
      if (key === 'then') return undefined; // await edilince thenable sanılmasın
      if (key === 'exists') return () => false; // ayar ve sürüm dosyası yok: varsayılanlar
      return stub();
    },
    apply: () => stub(),
    construct: () => stub(),
  });
}

const dir = new URL('../browser/', import.meta.url);
const observers = new Map();
const gecko = {
  Components: new Proxy({}, {
    get(_target, key) {
      return stub();
    },
  }),
  Services: new Proxy({}, {
    get(_target, key) {
      if (key === 'wm') return { getEnumerator: () => [], getMostRecentWindow: () => null };
      if (key === 'obs') return { addObserver: (fn, topic) => observers.set(topic, fn), removeObserver() {}, notifyObservers() {} };
      return stub();
    },
  }),
};
gecko.Cc = gecko.Components.classes;
gecko.Ci = gecko.Components.interfaces;
gecko.Cu = gecko.Components.utils;
gecko.Cr = gecko.Components.results;

// modüller kendi üst düzeylerinde ChromeUtils/Ci kullanır: içe aktarmadan önce genel olsun
const modules = new Map();
gecko.ChromeUtils = new Proxy({}, {
  get(_target, key) {
    if (key !== 'importESModule') return stub();
    return url => {
      const name = url.match(/^resource:\/\/zenmcp\/(.+?\.sys\.mjs)/)?.[1];
      if (!name) return stub(); // resource://gre/... (NetUtil, Timer)
      assert.ok(modules.has(name), `unknown module ${name}`);
      return modules.get(name);
    };
  },
});
Object.assign(globalThis, gecko);
// actors/ içe aktarılmaz, URI ile kaydedilir
for (const name of fs.readdirSync(dir)) {
  if (name.endsWith('.sys.mjs')) modules.set(name, await import(new URL(name, dir)));
}

test('main.js sets up and starts without errors', () => {
  const context = vm.createContext({ ...gecko, zenMcpDir: '/zen-mcp', zenMcpName: 'zen-mcp', console });
  vm.runInContext(fs.readFileSync(new URL('main.js', dir), 'utf8'), context, { filename: 'main.js' });
  // sapların yol açtığı hatalar (ör. ayar dosyası) sayılmaz; yalnız kurulum ve başlatma
  assert.equal(context.zenMcpStartError, undefined);
  // pencere yokken başlatma final-ui-startup'ı bekler; o anı taklit et
  const startup = observers.get('final-ui-startup');
  assert.ok(startup, 'start was not scheduled');
  startup();
  assert.equal(context.zenMcpStartError, undefined);
  assert.equal(context.zenMcpRunning, context.zenMcpVersion);
  context.zenMcpStop();
});
