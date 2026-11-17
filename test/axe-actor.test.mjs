import test from 'node:test';
import { loadActor } from './support/actor.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
function harness(run) {
  const sandboxes = [], timers = new Set();
  const timerStub = { setTimeout(fn, ms) { const t=setTimeout(fn,ms);timers.add(t);return t; }, clearTimeout(t) {timers.delete(t);clearTimeout(t);} };
  const Actor = loadActor({
    Services: { locale: { appLocaleAsBCP47: 'en' }, scriptloader: { loadSubScript(url, sandbox) {
      assert(url.includes('/vendor/axe.min.js')); sandbox.loaded = true;
    } } },
    Cu: { Sandbox() { const sandbox={};sandboxes.push(sandbox);return sandbox; }, waiveXrays: value => value,
      cloneInto: value => value, nukeSandbox: sandbox => {sandbox.nuked = true;},
      evalInSandbox(code,sandbox) { assert.equal(code,'axe.run(scanTarget, scanOptions)');return run(sandbox); } },
  }, { timers: timerStub });
  const actor=new Actor(); actor.document={};actor.contentWindow={};actor.browsingContext={id:1};
  return { actor, sandboxes, timers, send: (name,data={})=>actor.receiveMessage({name,data}) };
}
const result = nodes => ({testEngine:{version:'test'},violations:[{id:'image-alt',tags:['wcag2a'],nodes}],incomplete:[],passes:[],inapplicable:[]});
test('axe actor scopes its sandbox, disables iframe messaging and bounds output with refs',async()=>{
  const element={isConnected:true};
  const h=harness(sandbox=>{
    assert.equal(sandbox.window,sandbox);assert.equal(sandbox.scanTarget,h.actor.document);
    assert.equal(sandbox.scanOptions.iframes,false);assert.equal(sandbox.scanOptions.preload,false);
    return result(Array.from({length:4},()=>({element,target:['img'],html:'x'.repeat(2000),failureSummary:'missing alt'})));
  });
  const reply=await h.send('axe',{max_nodes:2,tags:['wcag2a']});assert(!reply.error,reply.error);
  assert.equal(reply.value.violations[0].nodes.length,2);assert(reply.value.violations[0].truncated);
  assert.equal(reply.value.violations[0].nodes[0].ref,'ref_1');
  assert.equal(reply.value.violations[0].nodes[0].html.length,1000);
  assert(h.sandboxes[0].nuked);assert.equal(h.timers.size,0);
});
test('cancelling an axe scan destroys its realm and permits a fresh scan',async()=>{
  let resolve;
  const h=harness(()=>new Promise(r=>{resolve=r;}));
  const pending=h.send('axe',{requestId:42});
  assert.match((await h.send('axe')).error,/already running/);
  await h.send('cancel_operation',{requestId:42});
  assert.match((await pending).error,/cancelled/);
  assert(h.sandboxes[0].nuked);assert.equal(h.timers.size,0);
  resolve(result([]));
  const next=h.send('axe',{requestId:43});resolve(result([]));
  assert(!(await next).error);assert.equal(h.sandboxes.length,2);
});
test('axe timeout destroys its realm rather than leaving a concurrent scanner',async()=>{
  const h=harness(()=>new Promise(()=>{}));
  const reply=await h.send('axe',{timeout_ms:1});assert.match(reply.error,/timed out/);
  assert(h.sandboxes[0].nuked);assert.equal(h.timers.size,0);
});

test('bundled axe distribution and license exactly match the locked npm dependency',()=>{
  for (const [bundle,upstream] of [['axe.min.js','axe.min.js'],['axe-LICENSE','LICENSE']]) {
    assert.deepEqual(fs.readFileSync(new URL(`../browser/vendor/${bundle}`,import.meta.url)),fs.readFileSync(new URL(`../node_modules/axe-core/${upstream}`,import.meta.url)));
  }
});
