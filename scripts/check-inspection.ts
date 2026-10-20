// Real React 18 dev/production and axe smoke test in disposable owned tabs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { call, type Content } from '../src/zen.ts';
const text = (r: Content[]) => r.filter(c => c.type === 'text').map(c => c.text).join('\n');
const chrome = async (code: string) => JSON.parse(text(await call('chrome_eval', { code })));
const client = new Client({ name: 'codex-mcp-client', version: 'inspection-smoke' });
const transport = new StdioClientTransport({ command: process.execPath, args: ['src/server.ts'], cwd: process.cwd() });
async function tool(name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(text(r.content as Content[]));
  return text(r.content as Content[]);
}
const tabs: number[] = [];
let original: number | undefined;
try {
  original = await chrome('Services.wm.getMostRecentWindow("navigator:browser").gBrowser.selectedBrowser.browserId');
  const state = await chrome('({version:h.version,paused:h.state.paused,mode:h.readConfig?.().mode})');
  assert(!state.paused);
  const config = JSON.parse(readFileSync(`${process.env.HOME}/.config/zen-mcp/config.json`, 'utf8'));
  assert.equal(config.mode, 'auto', 'Smoke test requires existing auto mode; does not change settings.');
  console.log(text(await call('reload')));
  for(let i=0;i<50;i++){await sleep(40);try{if(await chrome(`h.version>${state.version}`))break;}catch{}}
  await client.connect(transport);
  for (const build of ['development', 'production.min']) {
    const tabId = JSON.parse(await tool('tabs_create_mcp')).tabId; tabs.push(tabId);
    const react = readFileSync(`node_modules/react/umd/react.${build}.js`, 'utf8');
    const dom = readFileSync(`node_modules/react-dom/umd/react-dom.${build}.js`, 'utf8');
    const html = `<!doctype html><html lang="en"><title>Inspection fixture</title><div id="root"></div><script>${react}</script><script>${dom}</script><script>
      window.axe={sentinel:true}; window.getterCalls=0;
      function Card(props){return React.createElement('main',null,React.createElement('button',{id:'target'},props.label),React.createElement('img',{src:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='}),React.createElement('input',{id:'unlabelled'}));}
      function App(props){return React.createElement(Card,{label:props.label||'React target',count:42});}
      window.fixtureRoot=ReactDOM.createRoot(document.getElementById('root'));fixtureRoot.render(React.createElement(App));
      </script></html>`;
    await tool('navigate',{tabId,url:'data:text/html,'+encodeURIComponent(html)});
    await tool('wait_for',{tabId,text:'React target'});
    const tree = JSON.parse(await tool('react',{tabId,action:'tree',include_props:true}));
    assert(tree.frames[0].detected,JSON.stringify(tree));
    assert(tree.frames[0].components.some((c:any)=>c.name==='Card'&&c.props.label==='React target'),JSON.stringify(tree));
    const page = await tool('find',{tabId,query:'React target'});
    const ref = page.match(/button "React target" \[([^\]]+)\]/)?.[1]; assert(ref,page);
    const inspect = JSON.parse(await tool('react',{tabId,action:'inspect',ref,include_props:true}));
    assert(inspect.frames[0].components.some((c:any)=>c.name==='Card'));
    const scan = JSON.parse(await tool('accessibility',{tabId,tags:['wcag2a'],max_nodes:2}));
    assert(scan.frames[0].violations.some((v:any)=>v.id==='image-alt'),JSON.stringify(scan));
    assert(scan.frames[0].violations.some((v:any)=>v.id==='label'),JSON.stringify(scan));
    assert(scan.frames[0].violations.find((v:any)=>v.id==='image-alt').nodes[0].ref);
    const intact = await tool('javascript_tool',{tabId,action:'javascript_exec',text:'window.axe.sentinel'});
    assert.equal(intact,'true');
    const scoped = JSON.parse(await tool('accessibility',{tabId,ref,tags:['wcag2a']}));
    assert(!scoped.frames[0].violations.some((v:any)=>v.id==='image-alt'));
    await tool('javascript_tool',{tabId,action:'javascript_exec',text:`(()=>{const f=document.createElement('iframe');f.title='Child';f.src='data:text/html,'+encodeURIComponent('<!doctype html><html lang="en"><title>Frame</title><main><img src="missing"></main></html>');document.body.append(f);return true;})()`});
    let framed:any;
    for(let i=0;i<30;i++){
      try { framed=JSON.parse(await tool('react',{tabId,action:'tree'})); } catch(error) { if(!String(error).includes('changed during'))throw error; await sleep(50);continue; }
      if(framed.frames.length===2&&!framed.frames.some((f:any)=>f.error))break;
      await sleep(50);
    }
    assert.equal(framed.frames.length,2,JSON.stringify(framed));
    const frameScan=JSON.parse(await tool('accessibility',{tabId,tags:['wcag2a']}));
    assert.equal(frameScan.frames.length,2,JSON.stringify(frameScan));
    assert(frameScan.frames[1].violations.some((v:any)=>v.id==='image-alt'),JSON.stringify(frameScan));
    const childRef=frameScan.frames[1].violations.find((v:any)=>v.id==='image-alt').nodes[0].ref;
    assert.match(childRef,/_f\d+$/);
    const childScan=JSON.parse(await tool('accessibility',{tabId,ref:childRef,tags:['wcag2a']}));
    assert(childScan.frames[0].violations.some((v:any)=>v.id==='image-alt'));
    assert.equal(childScan.frames.length,1);
    await tool('javascript_tool',{tabId,action:'javascript_exec',text:"fixtureRoot.render(React.createElement(App,{label:'Updated target'}));'scheduled'"});
    await tool('wait_for',{tabId,text:'Updated target'});
    const updatedPage=await tool('find',{tabId,query:'Updated target'});
    const updatedRef=updatedPage.match(/button "Updated target" \[([^\]]+)\]/)?.[1];assert(updatedRef,updatedPage);
    const updated=JSON.parse(await tool('react',{tabId,action:'inspect',ref:updatedRef,include_props:true}));
    assert(updated.frames[0].components.some((c:any)=>c.name==='Card'&&c.props.label==='Updated target'),JSON.stringify(updated));
    console.log(`✓ React ${build}: tree, ancestor props, updated committed props, real axe violations/refs, cross-origin iframe/subtree scans and original window.axe preserved`);
  }
} finally {
  for (const tabId of tabs) { try { await tool('tabs_close_mcp',{tabId}); } catch {} }
  if (original) await chrome(`(()=>{const tab=h.findTab(${original});if(tab)tab.ownerGlobal.gBrowser.selectedTab=tab;return true;})()`).catch(()=>{});
  await client.close(); await transport.close();
}
