const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {JSDOM}=require('jsdom');
const ui=fs.readFileSync('admin-mt5-accounts.js','utf8');
const html=fs.readFileSync('index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const edge=stripTypeScriptTypes(fs.readFileSync('supabase/functions/olon-own-connect/index.ts','utf8').replace(/^import .*;\n/gm,''));
const actor='10000000-0000-0000-0000-000000000001',student='10000000-0000-0000-0000-000000000002',id='20000000-0000-0000-0000-000000000001';
const account={id,student_id:student,provider_account_id:'provider',vault_account_id:'vault-a',platform:'mt5',login_masked:'••••4812',broker_server:'Axi-US51-Live',status:'active',is_primary:true,last_sync_at:'2026-11-18T19:00:00Z',last_error:null};
function fixture(role='admin'){
 let handler;const calls=[],tables={profiles:[{id:actor,role,status:'active'},{id:student,full_name:'María Rivera',email:'maria@example.test'}],olon_own_accounts:[{...account,encrypted_payload:'SECRET'}],olon_mt_deals:[{id:1,student_id:student,vault_account_id:'vault-a',deal_id:'11',profit:20},{id:2,student_id:student,vault_account_id:'vault-b',deal_id:'22',profit:999}]};
 const db={auth:{getUser:async()=>({data:{user:{id:actor}}})},from(table){
  const q={table,columns:'*',filters:[],range:null,update:null};calls.push(q);
  const b={select(columns,opts){q.columns=columns;q.opts=opts;return b;},eq(k,v){q.filters.push([k,v,true]);return b;},neq(k,v){q.filters.push([k,v,false]);return b;},in(k,v){q.filters.push([k,v,'in']);return b;},order(){return b;},limit(){return b;},range(a,z){q.range=[a,z];return b;},update(value){q.update=value;return b;},maybeSingle(){q.single=true;return b;},then(resolve,reject){try{
   let data=(tables[table]||[]).filter(r=>q.filters.every(([k,v,kind])=>kind==='in'?v.includes(r[k]):kind?r[k]===v:r[k]!==v));const count=data.length;
   if(q.update)data.forEach(r=>Object.assign(r,q.update));if(q.range)data=data.slice(q.range[0],q.range[1]+1);
   data=data.map(r=>Object.fromEntries(q.columns.split(',').map(k=>[k,r[k]])));
   return Promise.resolve({data:q.single?data[0]||null:data,error:null,count}).then(resolve,reject);
  }catch(e){return Promise.reject(e).then(resolve,reject);}}};return b;
 }};
 const context={console,Request,Response,TextEncoder,Uint8Array,URL,crypto:require('node:crypto').webcrypto,createClient:()=>db,createRemoteJWKSet:()=>({}),jwtVerify:async()=>({payload:{role:'authenticated',sub:actor}}),Deno:{env:{get:k=>({SUPABASE_URL:'https://db.invalid',SUPABASE_SERVICE_ROLE_KEY:'secret-test',SUPABASE_ANON_KEY:'anon-test'})[k]},serve:fn=>handler=fn}};
 vm.runInNewContext(edge,context);
 return {calls,tables,request:(action,extra={},auth=true)=>handler(new Request('https://fn.invalid',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer signed-token'}:{})},body:JSON.stringify({action,...extra})}))};
}
test('admin directory joins owners and never selects credentials',async()=>{
 const q=fixture();const r=await q.request('admin-accounts');assert.equal(r.status,200);const data=await r.json();
 assert.equal(data.accounts[0].student.full_name,'María Rivera');assert.equal(data.accounts[0].student.email,'maria@example.test');assert.equal(data.total,1);
 assert.equal(JSON.stringify(data).includes('SECRET'),false);assert.equal(q.calls.some(c=>c.columns.includes('encrypted_payload')),false);
});
test('anonymous and students cannot list, retry, or read administrative history',async()=>{
 for(const action of ['admin-accounts','admin-retry-sync','admin-account-history']){
  const q=fixture('student');assert.equal((await q.request(action,{accountId:id})).status,403);assert.equal(q.calls.some(c=>c.table!=='profiles'),false);
  const anon=fixture();assert.equal((await anon.request(action,{accountId:id},false)).status,401);assert.equal(anon.calls.length,0);
 }
});
test('administrative history stays scoped to the selected owner and vault',async()=>{
 const q=fixture();const r=await q.request('admin-account-history',{accountId:id});const data=await r.json();
 assert.equal(r.status,200);assert.deepEqual(data.deals.map(d=>d.deal_id),['11']);assert.equal(data.total,1);
 const other=fixture('student');assert.equal((await other.request('recent-deals',{accountId:id})).status,403);
});
test('retry queues only the selected account; revoked and waiting accounts are protected',async()=>{
 const q=fixture();assert.equal((await q.request('admin-retry-sync',{accountId:id})).status,200);assert.equal(q.tables.olon_own_accounts[0].status,'waiting');
 const waiting=fixture();waiting.tables.olon_own_accounts[0].status='waiting';assert.equal((await (await waiting.request('admin-retry-sync',{accountId:id})).json()).alreadyWaiting,true);assert.equal(waiting.calls.some(c=>c.update),false);
 const revoked=fixture();revoked.tables.olon_own_accounts[0].status='revoked';assert.equal((await revoked.request('admin-retry-sync',{accountId:id})).status,409);assert.equal(revoked.calls.some(c=>c.update),false);
});
const tick=()=>new Promise(r=>setImmediate(r));
test('directory supports multiple accounts, search, details, account history, retry and student navigation',async()=>{
 const dom=new JSDOM(html,{url:'https://portal.test',runScripts:'outside-only'}),w=dom.window,d=w.document,calls=[];
 try{
  w.currentUser={id:actor,role:'admin',status:'active'};w.isAdminUser=u=>u.role==='admin';let opened;
  w.olonAdmin={render(){}};w.olonAdminSections={open:id=>opened=id};
  const a={...account,student:{full_name:'María Rivera',email:'maria@example.test'}};
  const b={...a,id:'other',login_masked:'••••8164',is_primary:false,status:'error',last_error:'Acceso rechazado'};
  w.supabaseClient={functions:{invoke:async(name,{body})=>{calls.push(body);return {data:body.action==='admin-accounts'?{accounts:[a,b],total:2,pageSize:500}:body.action==='admin-account-history'?{deals:[{deal_id:'11',profit:20,commission:-2,volume:.6}],total:1,page:0,pageSize:50}:{ok:true}};}}};
  w.eval(ui);await w.olonAdminMt5.activate();
  assert.equal(d.getElementById('amtStudents').textContent,'1');assert.equal(d.getElementById('amtAccounts').textContent,'2');assert.equal(d.querySelectorAll('#amtRows tr').length,2);
  d.getElementById('amtSearch').value='8164';d.getElementById('amtSearch').dispatchEvent(new w.Event('input'));assert.equal(d.querySelectorAll('#amtRows tr').length,1);
  d.querySelector('#amtRows button').click();assert.equal(d.getElementById('amtDetail').hidden,false);assert.match(d.getElementById('amtDetails').textContent,/María Rivera/);assert.match(d.getElementById('amtError').textContent,/rechazado/);
  d.getElementById('amtHistory').click();await tick();assert.equal(calls.at(-1).accountId,'other');assert.match(d.getElementById('amtHistoryRows').textContent,/18.00/);
  d.getElementById('amtRetry').click();await tick();assert.equal(calls.at(-1).action,'admin-retry-sync');assert.equal(calls.at(-1).accountId,'other');assert.equal(d.getElementById('amtRetry').disabled,true);
  d.getElementById('amtStudent').click();assert.equal(opened,'adminStudentsBlock');assert.equal(d.getElementById('adminSearch').value,'maria@example.test');
  w.currentUser={id:student,role:'student',status:'active'};d.getElementById('portal').classList.add('hidden');await tick();assert.equal(d.getElementById('amtRows').children.length,0);assert.equal(d.getElementById('amtDetail').hidden,true);
 }finally{w.close();}
});
