const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/olon-license-manager/index.ts','utf8').replace(/^import "jsr:[^"]*";\s*/,''));
const actor='10000000-0000-0000-0000-000000000001',student='10000000-0000-0000-0000-000000000002',license='20000000-0000-0000-0000-000000000001';
function fixture({role='admin',status='redeemed',rpc={ok:true,active:true,expires_at:'2026-12-01T12:00:00Z'},current=license}={}){
 const calls=[];let handler;
 const response=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
 const context={console,Request,Response,TextEncoder,TextDecoder,Uint8Array,btoa,atob,crypto:require('node:crypto').webcrypto,
  Deno:{env:{get:key=>({SUPABASE_URL:'https://db.invalid',SUPABASE_ANON_KEY:'anon-test',SUPABASE_SERVICE_ROLE_KEY:'service-test'})[key]},serve:fn=>{handler=fn;}},
  fetch:async(url,options={})=>{
   const body=options.body?JSON.parse(options.body):null;calls.push({url,body,method:options.method||'GET'});
   if(url.endsWith('/auth/v1/user'))return response({id:actor});
   if(url.includes('/profiles?id=eq.'+actor))return response([{id:actor,role,status:'active'}]);
   if(url.includes('rpc/olon_admin_manage_license'))return response(rpc);
   if(url.includes('/olon_licenses?id='))return response([{id:license,status,issued_to:student,redeemed_by:student,duration_days:30}]);
   if(url.includes('/olon_licenses?select='))return response([{id:license,status:'redeemed',issued_to:student,redeemed_by:student}]);
   if(url.includes('/profiles?role='))return response([{id:student,full_name:'Test',status:'active',role:'student'}]);
   if(url.includes('/olon_license_terms?select='))return response([{student_id:student,last_license_id:current,expires_at:'2026-12-01T12:00:00Z'}]);
   return response([]);
  }};
 vm.createContext(context);vm.runInContext(source,context);
 return {calls,request:(body,auth='Bearer user-test')=>handler(new Request('https://fn.invalid',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:auth}:{})},body:JSON.stringify(body)}))};
}
test('edge routes active edits and revocation through the atomic administrative RPC',async()=>{
 const q=fixture();assert.equal((await q.request({action:'edit_days',id:license,days:12})).status,200);
 assert.deepEqual(q.calls.find(c=>c.url.includes('/rpc/')).body,{p_license:license,p_actor:actor,p_action:'edit',p_days:12});
 const r=fixture({rpc:{ok:true,access_revoked:true}});const reply=await r.request({action:'revoke',id:license});
 assert.equal((await reply.json()).access_revoked,true);assert.equal(r.calls.find(c=>c.url.includes('/rpc/')).body.p_action,'revoke');
 assert.equal(r.calls.some(c=>c.method==='PATCH'),false);
});
test('edge preserves database conflict errors instead of claiming successful changes',async()=>{
 const q=fixture({rpc:{ok:false,status:409,error:'La licencia actual cambió'}});
 const response=await q.request({action:'edit_days',id:license,days:12});assert.equal(response.status,409);assert.match((await response.json()).error,/cambió/);
});
test('edge rejects anonymous and student callers before active mutation',async()=>{
 for(const auth of ['', 'Bearer anon-test']){
  const q=fixture();assert.equal((await q.request({action:'revoke',id:license},auth)).status,401);assert.equal(q.calls.some(c=>c.url.includes('/rpc/')),false);
 }
 const q=fixture({role:'student'});assert.equal((await q.request({action:'edit_days',id:license,days:10})).status,403);assert.equal(q.calls.some(c=>c.url.includes('/rpc/')),false);
});
test('license lists identify the current access owner without attaching later renewals to historical codes',async()=>{
 for(const current of [license,'20000000-0000-0000-0000-000000000099']){
  const q=fixture({current});const data=await (await q.request({action:'list'})).json();
  assert.equal(data.licenses[0].is_current,current===license);
  assert.equal(data.licenses[0].access_expires_at,current===license?'2026-12-01T12:00:00Z':null);
 }
});
test('available-day edits retain code rotation and never invoke the active-edit RPC',async()=>{
 const q=fixture({status:'available'});const response=await q.request({action:'edit_days',id:license,days:12});const result=await response.json();
 assert.equal(response.status,200);assert.match(result.code,/^OLFX-12D-/);assert.equal(q.calls.some(c=>c.url.includes('/rpc/')),false);
 const update=q.calls.find(c=>c.method==='PATCH');assert.ok(update.url.includes('status=eq.available'));assert.ok(update.body.code_ciphertext);
});
