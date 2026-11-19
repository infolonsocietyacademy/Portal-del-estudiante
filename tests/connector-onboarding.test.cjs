const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('olon-own-connect.js','utf8');
const html=fs.readFileSync('index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('pending onboarding refreshes displayed data automatically and stops polling when finished',async()=>{
 const dom=new JSDOM(html,{url:'https://portal.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,d=w.document;
 const timers=new Map(),calls=[];let nextTimer=0,invalidations=0;
 let accounts=[{id:'new-account',platform:'mt5',broker_server:'Axi-US51-Live',login_masked:'••••0001',is_primary:true,status:'waiting',last_sync_at:null}];
 try{
  w.setTimeout=(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id;};w.clearTimeout=id=>timers.delete(id);
  w.currentUser={id:'student-a',role:'student',status:'active'};w.olonMtRecords={invalidate(){invalidations++;}};
  const query={select(){return query;},eq(){return query;},order(){return query;},limit(){return Promise.resolve({data:[],error:null});}};
  w.supabaseClient={auth:{getSession:async()=>({data:{session:{access_token:'test'}}})},from:()=>query,functions:{invoke:async(_,{body})=>{calls.push(body);return {data:body.action==='status'?{accounts:structuredClone(accounts)}:{publicKeyPem:'test-public-key'}};}}};
  w.eval(source);d.dispatchEvent(new w.Event('DOMContentLoaded'));await tick();
  d.getElementById('metaapiAccountsPage').classList.remove('hidden');await tick();await tick();
  assert.match(d.getElementById('metaapiAccountsList').textContent,/importando automáticamente/);
  let poll=[...timers].find(([,timer])=>timer.ms===5000);assert.ok(poll);
  const initialStatus=calls.filter(c=>c.action==='status').length;
  const editor=d.createElement('div');editor.className='olfxAccessUpdate';const input=d.createElement('input');editor.append(input);d.body.append(editor);input.focus();
  timers.delete(poll[0]);await poll[1].fn();await tick();
  assert.equal(calls.filter(c=>c.action==='status').length,initialStatus);
  editor.remove();poll=[...timers].find(([,timer])=>timer.ms===5000);assert.ok(poll);
  w.dispatchEvent(new w.Event('scroll'));w.dispatchEvent(new w.Event('resize'));await tick();
  assert.equal(calls.filter(c=>c.action==='status').length,initialStatus);
  accounts=[{...accounts[0],status:'active',last_sync_at:'2026-11-19T00:30:00Z',backfill_done:true,balance:0,equity:0,total_deals:0,closed_trades:0}];
  timers.delete(poll[0]);await poll[1].fn();await tick();
  assert.match(d.getElementById('metaapiAccountsList').textContent,/Datos sincronizados/);
  assert.match(d.getElementById('metaapiAccountsList').textContent,/Historial importado/);
  assert.match(d.getElementById('metaapiAccountsList').textContent,/\$0\.00/);
  assert.match(d.getElementById('metaapiFeedback').textContent,/datos MT5 se sincronizaron/);
  assert.ok(invalidations>0);
  assert.equal([...timers.values()].some(timer=>timer.ms===5000),false);
  assert.equal(calls.some(c=>['retry-sync','refresh-my-accounts'].includes(c.action)),false);
 }finally{w.close();}
});

test('hiding the accounts page cancels pending onboarding polling',async()=>{
 const dom=new JSDOM(html,{url:'https://portal.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,d=w.document,timers=new Map();let seq=0;
 try{
  w.setTimeout=(fn,ms)=>{timers.set(++seq,{fn,ms});return seq;};w.clearTimeout=id=>timers.delete(id);
  w.currentUser={id:'student-a',role:'student',status:'active'};
  const query={select(){return query;},eq(){return query;},order(){return query;},limit(){return Promise.resolve({data:[],error:null});}};
  w.supabaseClient={auth:{getSession:async()=>({data:{session:{access_token:'test'}}})},from:()=>query,functions:{invoke:async(_,{body})=>({data:body.action==='status'?{accounts:[{id:'new',status:'waiting',platform:'mt5',login_masked:'••••0001'}]}:{publicKeyPem:'test'}})}};
  w.eval(source);d.dispatchEvent(new w.Event('DOMContentLoaded'));await tick();
  d.getElementById('metaapiAccountsPage').classList.remove('hidden');await tick();await tick();
  assert.equal([...timers.values()].some(t=>t.ms===5000),true);
  d.getElementById('metaapiAccountsPage').classList.add('hidden');await tick();
  assert.equal([...timers.values()].some(t=>t.ms===5000),false);
 }finally{w.close();}
});
