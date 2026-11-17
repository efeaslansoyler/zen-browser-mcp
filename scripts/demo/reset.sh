#!/bin/sh
# reset the demo window: one user tab, the shop page, an empty cart
cd "$(dirname "$0")/../.."
node scripts/zenctl.ts eval '(()=>{const w=Services.wm.getMostRecentWindow("navigator:browser"); const g=w.gBrowser; const keep=g.addTrustedTab("http://localhost:8765/index.html"); g.selectedTab=keep; for (const t of [...g.tabs]) if (t!==keep) g.removeTab(t,{animate:false,skipPermitUnload:true}); return g.tabs.length})()'
sleep 1.5
node scripts/zenctl.ts eval '(()=>{const w=Services.wm.getMostRecentWindow("navigator:browser"); return w.gBrowser.selectedBrowser.currentURI.spec})()'
node scripts/zenctl.ts eval '(()=>{h.state.paused=false; h.island?.resumed(); return "resumed"})()'
