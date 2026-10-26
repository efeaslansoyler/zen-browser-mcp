import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { sameReadContext } from '../browser/ReadSnapshots.sys.mjs';
import { readTools } from '../browser/ReadTools.sys.mjs';
function harness(run) {
  const top={id:1,currentWindowGlobal:{}},child={id:2,currentWindowGlobal:{}};
  const browser={browsingContext:top}, frames=[top,child];
  const document=()=>({url:'https://fixture.test/',ownerVersion:1,frames:frames.map(f=>[f.id,f.currentWindowGlobal])});
  const calls=[];let cancelled=false;
  class Stopped extends Error {};
  const context=vm.createContext({Date,JSON,Math, sameReadContext,
    browserFor:()=>browser, framesOf:()=>frames, frameOf:()=>child, longRef:x=>x, shortRefs:x=>x,text:x=>x,
    permissionContext:()=>top.currentWindowGlobal, samePermissionContext:(a,b)=>a===b, readContext:document,
    assertSiteAccess:()=>{}, operation:{check(){if(cancelled)throw new Stopped('stopped');}},
    Stopped,DialogOpen:class extends Error {},
    query:async(browser,name,args,timeout,frame)=>{calls.push({name,args,frame});return {value:await run?.({name,args,frame,top,child,cancel:()=>{cancelled=true;}})||{detected:true,violations:[]}};},
  });
  return {tools:readTools(context),calls};
}
test('inspection tools route iframe refs only to their frame',async()=>{
  const h=harness();
  for(const name of ['react','accessibility']) {
    const result=JSON.parse(await h.tools[name]({tabId:1,ref:'ref_1_f2',action:'inspect'}));
    assert.equal(result.frames.length,1);assert.equal(result.frames[0].frame,2);
  }
  assert(h.calls.every(c=>c.frame.id===2));
});
test('inspection tools explicitly report failed child frames without claiming full coverage',async()=>{
  const h=harness(({frame})=>{if(frame.id===2)throw Error('Frame unavailable');});
  for(const name of ['react','accessibility']) {
    const result=JSON.parse(await h.tools[name]({tabId:1,action:'tree'}));
    assert.equal(result.frames.length,2);assert.match(result.frames[1].error,/unavailable/);
  }
});
test('frame navigation invalidates React and axe results',async()=>{
  for(const name of ['react','accessibility']) {
    const h=harness(({child})=>{child.currentWindowGlobal={};});
    await assert.rejects(h.tools[name]({tabId:1,action:'tree'}),/changed during/);
  }
});
test('cancellation is never converted into a skipped-frame result',async()=>{
  for(const name of ['react','accessibility']) {
    const h=harness(({frame,cancel})=>{if(frame.id===2){cancel();throw Error('actor destroyed');}});
    await assert.rejects(h.tools[name]({tabId:1,action:'tree'}),/stopped/);
  }
});
