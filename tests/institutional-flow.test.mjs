import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {validateSnapshot, sourceState, createSnapshotClient, CACHE_TTL} from '../institutional-flow/data-client.mjs';

const real = JSON.parse(await readFile(new URL('../institutional-flow/data/GC/0.json', import.meta.url)));
const response = (data = real, status = 200) => new Response(JSON.stringify(data), {status, headers:{'content-type':'application/json'}});
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a; reject=b;}); return {promise,resolve,reject}; };
const drain = async () => { for(let i=0;i<12;i++) await Promise.resolve(); };

test('All shipped snapshots have verified identities, dates, bounded pages and continuous history', async () => {
  for(const market of ['GC','NQ']) {
    const dates = [];
    for(let page=0;page<4;page++) {
      const data = JSON.parse(await readFile(new URL(`../institutional-flow/data/${market}/${page}.json`, import.meta.url)));
      validateSnapshot(data,market,page); dates.push(...data.records.map(x=>x.date));
      assert.equal(data.nextPage,page===3?null:page+1);
    }
    assert.equal(dates.length,52); assert.equal(new Set(dates).size,52);
    assert.deepEqual(dates,[...dates].sort().reverse());
  }
});
test('Unverified numbers, wrong contracts, combined options and malformed dates never become data', () => {
  for(const update of [{market:'NQ'},{cftcCode:'209747'},{reportType:'COMBINED'}, {page:9}, {nextPage:9},
    {records:[{...real.records[0],openInterest:null}]}, {records:[{...real.records[0],openInterest:'399169'}]},
    {records:[{...real.records[0],openInterest:-1}]}, {records:[{...real.records[0],date:'2026-02-30'}]},
    {records:[real.records[0],real.records[0]]}, {records:[]}, {records:Array(14).fill(real.records[0])}]) {
    assert.throws(()=>validateSnapshot({...real,...update},'GC',0));
  }
});
test('Weekly and older archive pages can only be HISTORICAL; stale or missing sources are OFFLINE', () => {
  const now = Date.parse(real.checkedAt);
  assert.equal(sourceState(real,now),'HISTORICAL');
  assert.equal(sourceState({...real,records:[{...real.records[0],date:'2020-01-07'}]},now),'HISTORICAL');
  assert.equal(sourceState(real,now+4*86400000),'OFFLINE');
  assert.equal(sourceState({...real,latestReportDate:'2020-01-07'},now),'OFFLINE');
  assert.equal(sourceState(null),'OFFLINE');
});
test('Concurrent repeated clicks coalesce and cache survives module remounts', async () => {
  let calls=0; const waiting=deferred(), cache=new Map();
  const fetcher=async()=>{calls++;await waiting.promise;return response();};
  const client=createSnapshotClient({fetcher,cache});
  const a=client.load('GC'),b=client.load('GC',0,{force:true});
  assert.equal(a,b); assert.equal(calls,1); waiting.resolve(); await a;
  client.dispose(); const second=createSnapshotClient({fetcher,cache});
  assert.deepEqual(await second.load('GC'),real); assert.equal(calls,1); second.dispose();
});
test('Cache revalidates after TTL and forced refresh, with a fixed eight-page limit', async () => {
  let calls=0, clock=0; const cache=new Map(Array.from({length:8},(_,i)=>['old'+i,{savedAt:0,data:real}]));
  const client=createSnapshotClient({cache,now:()=>clock,fetcher:async()=>{calls++;return response();}});
  await client.load('GC'); assert.equal(cache.size,8);
  await client.load('GC'); assert.equal(calls,1);
  clock=CACHE_TTL+1; await client.load('GC'); assert.equal(calls,2);
  await client.load('GC',0,{force:true}); assert.equal(calls,3); client.dispose();
});
test('Transient errors retry once; 404 and invalid data do not retry', async () => {
  let calls=0;
  const a=createSnapshotClient({cache:new Map(),retryDelay:1,fetcher:async()=>++calls===1?response({},503):response()});
  await a.load('GC'); assert.equal(calls,2); a.dispose();
  calls=0;
  const b=createSnapshotClient({cache:new Map(),retryDelay:1,fetcher:async()=>{calls++;return response({},404);}});
  await assert.rejects(b.load('GC')); assert.equal(calls,1); b.dispose();
  calls=0;
  const c=createSnapshotClient({cache:new Map(),retryDelay:1,fetcher:async()=>{calls++;return response({...real,source:'UNKNOWN'});}});
  await assert.rejects(c.load('GC')); assert.equal(calls,1); c.dispose();
});
test('Invalid JSON and oversized or non-JSON responses fail closed', async () => {
  for(const bad of [new Response('<html>',{headers:{'content-type':'text/html'}}),
    new Response('{bad',{headers:{'content-type':'application/json'}}),
    new Response(' '.repeat(33000),{headers:{'content-type':'application/json'}})]) {
    let calls=0; const client=createSnapshotClient({cache:new Map(),fetcher:async()=>{calls++;return bad;}});
    await assert.rejects(client.load('GC')); assert.equal(calls,1); client.dispose();
  }
});
test('Leaving aborts in-flight requests and prevents retries or late cache writes', async () => {
  let signal,calls=0; const cache=new Map();
  const client=createSnapshotClient({cache,fetcher:(_,options)=>new Promise((resolve,reject)=>{
    calls++;signal=options.signal;signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
  })});
  const request=client.load('GC'); assert.equal(client.pendingCount,1);
  client.dispose(); await assert.rejects(request,{name:'AbortError'});
  assert.equal(signal.aborted,true); assert.equal(client.pendingCount,0); assert.equal(calls,1); assert.equal(cache.size,0);
  await assert.rejects(client.load('GC'),{name:'AbortError'});
});
test('Leaving during backoff cancels the retry timer', async () => {
  let calls=0; const failed=deferred();
  const client=createSnapshotClient({cache:new Map(),retryDelay:60000,fetcher:async()=>{calls++;failed.resolve();throw new TypeError('Network');}});
  const request=client.load('GC'); await failed.promise; await drain();
  client.dispose(); await assert.rejects(request,{name:'AbortError'}); assert.equal(calls,1);
});
test('Timeout bounds an unresponsive source and retry count', async () => {
  let calls=0;
  const client=createSnapshotClient({cache:new Map(),timeout:5,retryDelay:1,fetcher:(_,options)=>new Promise((resolve,reject)=>{
    calls++; options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
  })});
  await assert.rejects(client.load('GC')); assert.equal(calls,2); assert.equal(client.pendingCount,0); client.dispose();
});
test('Unapproved markets and unbounded history requests never reach the network', async () => {
  let calls=0; const client=createSnapshotClient({fetcher:()=>{calls++;}});
  for(const [market,page] of [['BTC',0],['GC',4],['GC',-1],['GC',1.5]]) await assert.rejects(client.load(market,page));
  assert.equal(calls,0); client.dispose();
});

// Exercise the actual bootstrap, with only its dynamic import replaced by a controlled module.
const script = await readFile(new URL('../script.js', import.meta.url),'utf8');
const bootstrap = script.slice(script.indexOf('/* Institutional Flow bootstrap:'))
  .replace("import('./institutional-flow/entry.mjs?v=1')", 'loadModule()');
function harness(module) {
  const handlers=new Map(), docHandlers=new Map(); let imports=0;
  const target={classList:{contains:()=>false},replaceChildren(){},removeAttribute(){},setAttribute(){}};
  const doc={hidden:false,getElementById:id=>id==='portal'?{classList:{contains:()=>false}}:target,
    createElement:()=>({setAttribute(){},addEventListener(){}}),addEventListener:(id,fn)=>docHandlers.set(id,fn)};
  const window={addEventListener:(id,fn)=>handlers.set(id,fn)};
  vm.runInNewContext(bootstrap,{window,document:doc,AbortController,loadModule:()=>{imports++;return Promise.resolve(module);}});
  const page=id=>handlers.get('olon:pagechange')({detail:{id}});
  return {page,doc,window,handlers,docHandlers,imports:()=>imports};
}
test('Startup/dashboard make zero imports; re-entry mounts once and cleans up on every exit', async () => {
  let mounts=0,destroys=0;
  const h=harness({prepare:async()=>{},mount:()=>{mounts++;return {destroy:()=>destroys++};}});
  assert.equal(h.imports(),0); h.page('dashboard'); await drain(); assert.equal(h.imports(),0);
  h.page('institutionalFlowPage');h.page('institutionalFlowPage');await drain();
  assert.equal(h.imports(),1); assert.equal(mounts,1);
  h.page('historial');assert.equal(destroys,1);
  h.page('institutionalFlowPage');await drain();assert.equal(mounts,2);assert.equal(h.imports(),1);
  h.window.olonInstitutionalFlow.stop();assert.equal(destroys,2);
});
test('Navigating away during lazy preparation cannot mount a hidden module', async () => {
  let mounts=0,signal; const waiting=deferred();
  const h=harness({prepare:async value=>{signal=value;await waiting.promise;},mount:()=>{mounts++;}});
  h.page('institutionalFlowPage');await drain();h.page('dashboard');waiting.resolve();await drain();
  assert.equal(mounts,0);assert.equal(signal.aborted,true);
});
test('Hidden tab and pagehide release resources, visible tab remounts without importing again', async () => {
  let mounts=0,destroys=0;
  const h=harness({prepare:async()=>{},mount:()=>{mounts++;return {destroy:()=>destroys++};}});
  h.page('institutionalFlowPage');await drain();h.doc.hidden=true;h.docHandlers.get('visibilitychange')();
  assert.equal(destroys,1);h.doc.hidden=false;h.docHandlers.get('visibilitychange')();await drain();
  assert.equal(mounts,2);assert.equal(h.imports(),1);h.handlers.get('pagehide')();assert.equal(destroys,2);
});
