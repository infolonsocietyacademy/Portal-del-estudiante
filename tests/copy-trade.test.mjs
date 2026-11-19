import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto,createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {PGlite} from '@electric-sql/pglite';
import {validateSettings} from '../supabase/functions/olfx-copy-control/config.mjs';
const cfg=JSON.parse(fs.readFileSync('copy-trading/config.example.json'));
const actor='10000000-0000-0000-0000-000000000001',other='10000000-0000-0000-0000-000000000002';
const groupId='20000000-0000-0000-0000-000000000001',token='olfx_'+ 'a'.repeat(50);
function fixture(){
 let handler;const tables={profiles:[{id:actor,status:'active'},{id:other,status:'active'}],olon_own_agents:[{id:actor,created_by:actor,status:'paired',token_hash:createHash('sha256').update(token).digest('hex')}],olfx_copy_groups:[],olfx_copy_runtime:[]};
 const db={auth:{getUser:async jwt=>jwt==='valid'?{data:{user:{id:actor}}}:jwt==='other'?{data:{user:{id:other}}}:{data:null,error:{}}},from(table){
  let filters=[],one=false,values,kind,cols;
  const b={select(c){cols=c;return b;},eq(k,v){filters.push([k,v]);return b;},limit(){return b;},maybeSingle(){one=true;return b;},insert(v){values=v;kind='insert';return b;},update(v){values=v;kind='update';return b;},upsert(v){values=v;kind='upsert';return b;},then(resolve,reject){try{
   let rows=tables[table].filter(row=>filters.every(([k,v])=>row[k]===v));
   if(kind==='insert'){if(tables[table].some(r=>r.owner_id===values.owner_id))return Promise.resolve({error:{code:'23505'}}).then(resolve,reject);rows=[{id:groupId,revision:1,...values}];tables[table].push(...rows);}
   if(kind==='update')rows.forEach(r=>Object.assign(r,values));
   if(kind==='upsert'){const old=tables[table].find(r=>r.group_id===values.group_id);if(old)Object.assign(old,values);else tables[table].push(values);rows=[];}
   const data=rows.map(row=>cols?Object.fromEntries(cols.split(',').map(k=>[k,row[k]])):{...row});
   return Promise.resolve({data:one?data[0]||null:data,error:null}).then(resolve,reject);
  }catch(e){return Promise.reject(e).then(resolve,reject);}}};return b;
 }};
 const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/olfx-copy-control/index.ts','utf8').replace(/^import .*;\n/gm,''));
 vm.runInNewContext(source,{console,URL,Request,Response,TextEncoder,Uint8Array,crypto:webcrypto,validateSettings,createClient:()=>db,Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://test.invalid':'test-key'},serve:fn=>handler=fn}});
 return {tables,async request(action,body={},jwt='valid',agent=null){const r=await handler(new Request('https://fn.invalid',{method:'POST',headers:{...(jwt?{authorization:'Bearer '+jwt}:{}),...(agent?{'x-olfx-agent-token':agent}:{})},body:JSON.stringify({action,...body})}));return {status:r.status,data:await r.json()};}};
}
test('contract rejects duplicate accounts, executable paths, invalid numbers and strips credentials',()=>{
 assert.deepEqual(validateSettings({...cfg,password:'SECRET'}).master,cfg.master);
 const duplicate=structuredClone(cfg);duplicate.followers[0].login=cfg.master.login;duplicate.followers[0].server=cfg.master.server;
 assert.throws(()=>validateSettings(duplicate),/distintos/);
 for(const terminal_path of ['https://evil.invalid/terminal64.exe','C:\\x\\evil.exe','C:\\x\\bad|dir\\terminal64.exe'])assert.throws(()=>validateSettings({...cfg,master:{...cfg.master,terminal_path}}));
 assert.throws(()=>validateSettings({...cfg,followers:[{...cfg.followers[0],max_lots:NaN}]}));
});
test('API rejects anonymous/invalid tokens and real execution',async()=>{
 const f=fixture();assert.equal((await f.request('read',{},null)).status,401);assert.equal((await f.request('read',{},'bad')).status,401);
 assert.equal((await f.request('save',{settings:cfg,mode:'real',revision:null})).status,400);
 assert.equal(f.tables.olfx_copy_groups.length,0);
});
test('save is private, paused and rejects stale changes',async()=>{
 const f=fixture(),result=await f.request('save',{settings:{...cfg,password:'SECRET'},mode:'paper',revision:null});assert.equal(result.status,200);assert.equal(result.data.group.paused,true);
 assert.equal(JSON.stringify(result.data).includes('SECRET'),false);
 assert.equal((await f.request('read',{},'other')).data.group,null);
 assert.equal((await f.request('save',{settings:cfg,mode:'demo',revision:9})).status,409);
 assert.equal((await f.request('pause',{revision:1})).status,200);
 assert.equal((await f.request('pause',{revision:1})).status,409);
});
test('resume requires enabled receivers and matching, fresh VPS heartbeat',async()=>{
 const f=fixture(),settings=structuredClone(cfg);settings.followers[0].enabled=true;
 await f.request('save',{settings,mode:'paper',revision:null});
 assert.equal((await f.request('resume',{revision:1})).status,409);
 f.tables.olfx_copy_runtime.push({group_id:groupId,last_seen_at:new Date().toISOString(),state:'paused',revision:1});
 assert.equal((await f.request('resume',{revision:1})).status,200);
 assert.equal((await f.request('save',{settings,mode:'paper',revision:2})).status,409);
});
test('agent only consumes its owner group and heartbeat never stores arbitrary broker strings',async()=>{
 const f=fixture();await f.request('save',{settings:cfg,mode:'paper',revision:null},'other');
 assert.equal((await f.request('agent-config',{},null,token)).data.group,null);
 await f.request('save',{settings:cfg,mode:'paper',revision:null});
 assert.equal((await f.request('agent-config',{},null,'bad')).status,401);
 const result=await f.request('agent-heartbeat',{group_id:groupId,revision:1,state:'paused',followers:{DEMO_01:'SECRET password'}},null,token);
 assert.equal(result.status,200);assert.equal(JSON.stringify(f.tables.olfx_copy_runtime).includes('SECRET'),false);
 assert.equal((await f.request('agent-heartbeat',{group_id:groupId,revision:999,state:'paused',followers:{}},null,token)).status,409);
 f.tables.olon_own_agents[0].status='revoked';assert.equal((await f.request('agent-config',{},null,token)).status,401);
});
test('actual database RLS isolates owners and prohibits direct settings writes',async()=>{
 const db=new PGlite();try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create table public.profiles(id uuid primary key,status text);create table public.olon_own_agents(id uuid primary key);grant select on profiles to authenticated;insert into profiles values('${actor}','active'),('${other}','active');`);
  await db.exec(fs.readFileSync('supabase/migrations/20261119172041_olfx_copy_trade_private_pilot.sql','utf8'));
  await db.query('insert into olfx_copy_groups(owner_id,settings) values($1,$2)',[actor,cfg]);
  await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${other}',false);`);
  assert.equal((await db.query('select * from olfx_copy_groups')).rows.length,0);
  await db.exec(`select set_config('request.jwt.claim.sub','${actor}',false);`);
  assert.equal((await db.query('select * from olfx_copy_groups')).rows.length,1);
  await assert.rejects(db.query('update olfx_copy_groups set paused=false'),/permission denied/);
 }finally{await db.close();}
});
const tick=()=>new Promise(r=>setImmediate(r));
test('panel saves multiple receivers, guards dirty refresh and clears private fields on logout',async()=>{
 const html=fs.readFileSync('index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
 const dom=new JSDOM(html,{url:'https://portal.test',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,d=w.document,calls=[];
 try{
  w.currentUser={id:actor};d.getElementById('portal').classList.remove('hidden');d.getElementById('copyTradePage').classList.remove('hidden');
  w.supabaseClient={functions:{invoke:async(name,{body})=>{calls.push(body);return {data:body.action==='save'?{group:{id:groupId,revision:2,paused:true,mode:'paper',settings:body.settings}}:{group:{id:groupId,revision:1,paused:true,mode:'paper',settings:cfg},agentPaired:true}};}}};
  w.eval(fs.readFileSync('copy-trade.js','utf8'));await tick();
  assert.equal(d.querySelectorAll('.ctFollower').length,1);d.getElementById('ctAdd').click();assert.equal(d.querySelectorAll('.ctFollower').length,2);
  d.getElementById('ctRefresh').click();await tick();assert.match(d.getElementById('ctFeedback').textContent,/Guarda/);
  d.querySelectorAll('.ctFollower')[1].querySelector('button').click();
  d.getElementById('ctForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
  assert.equal(calls.find(c=>c.action==='save').settings.followers.length,1);
  w.currentUser=null;d.getElementById('portal').classList.add('hidden');await tick();
  assert.equal(d.getElementById('ctMaster').children.length,0);assert.equal(d.getElementById('ctFollowers').children.length,0);
 }finally{w.close();}
});

test('polling a new unsaved group preserves account edits',async()=>{
 const html=fs.readFileSync('index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
 const dom=new JSDOM(html,{url:'https://portal.test',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,d=w.document,timers=[];
 try{
  w.currentUser={id:actor};d.getElementById('portal').classList.remove('hidden');d.getElementById('copyTradePage').classList.remove('hidden');
  w.setTimeout=fn=>{timers.push(fn);return timers.length;};w.clearTimeout=()=>{};
  w.supabaseClient={functions:{invoke:async()=>({data:{group:null,runtime:null,agentPaired:false}})}};
  w.eval(fs.readFileSync('copy-trade.js','utf8'));await tick();
  const login=d.querySelector('#ctMaster [name=login]');login.value='999999';login.dispatchEvent(new w.Event('input',{bubbles:true}));
  await timers.shift()();await tick();
  assert.equal(d.querySelector('#ctMaster [name=login]').value,'999999');
 }finally{w.close();}
});

test('shared Copy Trade page remains visible after switching between student and admin',async()=>{
 const html=fs.readFileSync('index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
 const dom=new JSDOM(html,{url:'https://portal.test',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,d=w.document;
 try{
  w.currentUser={id:actor,role:'student',status:'active'};w.isAdminUser=u=>u.role==='admin';
  const page=d.getElementById('copyTradePage'),parent=page.parentNode;
  w.eval(fs.readFileSync('admin-shell.js','utf8'));await tick();
  assert.equal(page.parentNode,parent);
  w.currentUser.role='admin';d.getElementById('portal').classList.add('admin-mode');await tick();
  assert.equal(page.parentNode.id,'');assert.equal(page.parentNode.className,'olAdminPageHost');
  w.currentUser.role='student';d.getElementById('portal').classList.remove('admin-mode');await tick();
  assert.equal(page.parentNode,parent);
 }finally{w.close();}
});
