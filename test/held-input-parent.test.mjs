import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../browser/main.js',import.meta.url),'utf8');
function fixture(){
  const sent=[],timers=new Set();
  const old={getActor:()=>({sendAsyncMessage:name=>sent.push(name)})};const frame={currentWindowGlobal:old};const browser={browserId:1};
  const c=vm.createContext({controlledSource:b=>b,activeSession:'A',setTimeout(fn){timers.add(fn);return fn;},clearTimeout(fn){timers.delete(fn);}});
  const start=source.indexOf('    const heldInputFrames =');const end=source.indexOf('    let operation = null;',start);
  vm.runInContext(source.slice(start,end),c);c.browser=browser;c.frame=frame;c.rememberInputs(browser,frame,{keys:['KEY_Shift'],buttons:[]},30000);
  return {c,frame,sent,timers};
}
test('parent releases all remembered actors and clears watchdogs',()=>{
  const h=fixture();h.c.releaseAllInputs();assert.deepEqual(h.sent,['release_inputs']);assert.equal(h.timers.size,0);assert.equal(h.c.heldFrame(h.c.browser),null);
});
test('document replacement and session changes cannot inherit held input',()=>{
  for(const change of [h=>{h.frame.currentWindowGlobal={};},h=>{h.c.activeSession='B';}]){
    const h=fixture();change(h);assert.equal(h.c.heldFrame(h.c.browser),null);assert.deepEqual(h.sent,['release_inputs']);assert.equal(h.timers.size,0);
  }
});
