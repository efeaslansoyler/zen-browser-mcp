import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserSettings } from '../browser/BrowserSettings.sys.mjs';
function fixture(answer=true) {
  const properties=new Map(),priority=new Map();
  const source={browserId:1,fullZoom:1,style:{getPropertyValue:k=>properties.get(k)||'',getPropertyPriority:k=>priority.get(k)||'',setProperty(k,v,p){properties.set(k,v);priority.set(k,p);},removeProperty(k){properties.delete(k);priority.delete(k);}},browsingContext:{currentWindowGlobal:{},overrideDPPX:0,customUserAgent:'',touchEventsOverride:'none',prefersColorSchemeOverride:'none'}};
  const win={gBrowser:{selectedBrowser:{},getTabForBrowser:b=>({linkedBrowser:b})}};
  Object.defineProperty(win.gBrowser,'selectedTab',{set(t){this.selectedBrowser=t.linkedBrowser;}});source.ownerDocument={defaultView:win};
  let version=1;const env={check(){},context:()=>String(version),ask:async()=>typeof answer==='function'?answer():answer,wait:async()=>{}};
  return {settings:new BrowserSettings(env),source,win,env,properties,change:()=>version++};
}
test('settings mutations always ask and denial preserves selected tab and overrides',async()=>{
  const h=fixture(false),selected=h.win.gBrowser.selectedBrowser;
  await assert.rejects(h.settings.change(h.source,'A',{action:'device',device:'mobile'}),/denied/);
  assert.equal(h.win.gBrowser.selectedBrowser,selected);assert.equal(h.source.browsingContext.overrideDPPX,0);assert.equal(h.properties.size,0);
});
test('tab-local device settings can be restored without overwriting later manual edits',async()=>{
  const h=fixture();await h.settings.change(h.source,'A',{action:'device',device:'mobile'});
  assert.equal(h.properties.get('width'),'390px');assert.equal(h.source.browsingContext.overrideDPPX,3);
  h.source.browsingContext.customUserAgent='manually changed';
  h.settings.restoreTab(1);assert.equal(h.properties.size,0);assert.equal(h.source.browsingContext.overrideDPPX,0);assert.equal(h.source.browsingContext.customUserAgent,'manually changed');
});
test('changed approval contexts and invalid settings never mutate a tab',async()=>{
  const h=fixture(()=>{h.change();return true;});
  await assert.rejects(h.settings.change(h.source,'A',{action:'viewport',width:400,height:700}),/changed/);assert.equal(h.properties.size,0);
  for(const args of [{action:'viewport',width:0,height:700},{action:'device',device:'invalid'},{action:'media'}])assert.throws(()=>h.settings.validate(args));
});
