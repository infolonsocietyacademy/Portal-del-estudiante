const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync('index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture({licenses,students,user,registration=false}={}){
 const dom=new JSDOM(html,{url:'https://portal.test/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,d=w.document,calls=[];
 const records=licenses||[{id:'l-active',status:'redeemed',duration_days:30,redeemed_by:'s1',code_hint:'USED1'},{id:'l-unassigned',status:'available',duration_days:15,code_hint:'FREE2'},{id:'l-assigned',status:'available',duration_days:30,issued_to:'s2',code_hint:'WAIT3'},{id:'l-revoked',status:'revoked',duration_days:15,issued_to:'s2',code_hint:'STOP4'}];
 const people=students||[{id:'s1',full_name:'Ana Rivera',email:'ana@example.test',phase:'active',status:'active',expires_at:'2026-12-02'},{id:'s2',full_name:'Carla Díaz',email:'carla@example.test',phase:'legacy',status:'active'}];
 w.currentUser=user||{id:'admin',role:'admin',status:'active'};
 w.SUPABASE_URL='https://db.example.test';w.SUPABASE_KEY='public-test';
 w.supabaseClient={auth:{getSession:async()=>({data:{session:{access_token:'test-session'}}})}};
 w.HTMLElement.prototype.scrollIntoView=function(){};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.confirm=()=>true;w.setInterval=()=>0;
 let request=null;
 w.fetch=async(url,options)=>{
  const body=JSON.parse(options.body);calls.push({url,...body});
  let result={ok:true};
  if(url.endsWith('registration-gateway')){
   if(body.action==='apply')request={id:'r-new',email:body.email,full_name:body.name,status:'pending'};
   if(body.action==='list')result={requests:request?[request]:[]};
   if(body.action==='approve'){people.push({id:'s-new',email:request.email,full_name:request.full_name,status:'active',phase:'legacy'});result={email:request.email,password:'fictional-temporary-secret'};}
  }else{
   if(body.action==='list')result={licenses:records,students:people};
   if(body.action==='assign')records.find(l=>l.id===body.id).issued_to=body.student_id;
   if(body.action==='revoke')records.find(l=>l.id===body.id).status='revoked';
   if(body.action==='delete_revoked')records.splice(records.findIndex(l=>l.id===body.id),1);
   if(body.action==='generate')result={licenses:[{id:'new',code:'TEST-CODE-ONLY',days:body.days}]};
   if(body.action==='reveal')result={code:'TEST-REVEALED-CODE'};
   if(body.action==='edit_days')result={active:true,days:body.days,expires_at:new Date(Date.now()+body.days*86400000).toISOString()};
  }
  return {ok:true,json:async()=>result};
 };
 d.getElementById('portal').classList.remove('hidden');
 d.getElementById('admin').classList.remove('hidden');
 if(registration)w.eval(fs.readFileSync('admin-registration.js','utf8'));
 w.eval(fs.readFileSync('license-ui.js','utf8'));
 await tick();await w.olonLicense.adminRefresh();await tick();
 return {w,d,records,people,calls,close:()=>w.close()};
}
const click=(q,selector)=>{const button=q.d.querySelector(selector);assert.ok(button,selector);button.click();};
test('VIP table joins students, escapes text and limits actions by license state',async()=>{
 const q=await fixture();try{
  assert.equal(q.d.querySelectorAll('#olonLicenseList tr').length,4);
  assert.equal(q.d.getElementById('olonLicenseTotal').textContent,'4');
  assert.ok(q.d.querySelector('[data-license-row="l-active"] [data-license-revoke]'));
  assert.ok(q.d.querySelector('[data-license-row="l-active"] [data-license-edit]'));
  assert.equal(q.d.querySelector('[data-license-row="l-assigned"] [data-license-assign]'),null);
  assert.ok(q.d.querySelector('[data-license-row="l-unassigned"] [data-license-assign]'));
  assert.ok(q.d.querySelector('[data-license-row="l-revoked"] [data-license-delete]'));
  assert.equal(q.d.querySelector('[data-license-row="l-active"]').textContent.includes('01 dic'),false);
  q.people[0].full_name='<img src=x onerror=alert(1)>';await q.w.olonLicense.adminRefresh();
  assert.equal(q.d.querySelector('#olonLicenseList img'),null);
  assert.ok(q.d.querySelector('#olonLicenseList').textContent.includes('<img src=x'));
 }finally{q.close();}
});
test('inline assignment uses its own searchable selector and the clicked license ID',async()=>{
 const q=await fixture();try{
  q.d.getElementById('olonLicenseAssign').value='s1';
  click(q,'[data-license-assign="l-unassigned"]');
  assert.equal(q.d.getElementById('olonLicenseInlineAssign').hidden,false);
  const search=q.d.getElementById('olonLicenseInlineSearch');search.value='diaz';search.dispatchEvent(new q.w.Event('input'));
  assert.equal(q.d.getElementById('olonLicenseInlineStudent').options.length,2);
  q.d.getElementById('olonLicenseInlineStudent').value='s2';
  q.d.getElementById('olonLicenseInlineAssign').dispatchEvent(new q.w.Event('submit',{bubbles:true,cancelable:true}));
  await tick();await tick();
  const assigned=q.calls.filter(c=>c.action==='assign');assert.equal(assigned.length,1);
  assert.equal(assigned[0].id,'l-unassigned');assert.equal(assigned[0].student_id,'s2');
  assert.equal(q.records.find(l=>l.id==='l-unassigned').issued_to,'s2');
  assert.equal(q.d.getElementById('olonLicenseInlineAssign').hidden,true);
 }finally{q.close();}
});
test('revoking and deleting refresh rows and never call student deletion',async()=>{
 const q=await fixture();try{
  click(q,'[data-license-revoke="l-assigned"]');await tick();await tick();
  assert.ok(q.d.querySelector('[data-license-delete="l-assigned"]'));
  click(q,'[data-license-delete="l-assigned"]');await tick();await tick();
  assert.equal(q.d.querySelector('[data-license-row="l-assigned"]'),null);
  assert.equal(q.people.length,2);assert.equal(q.calls.some(c=>c.action==='delete_student'),false);
 }finally{q.close();}
});
test('search, duration and state filters reset pagination; student tab has its own rows',async()=>{
 const licenses=Array.from({length:21},(_,i)=>({id:'l'+i,status:i%2?'available':'revoked',duration_days:i%2?15:30,code_hint:'H'+i,issued_to:'s2'}));
 const q=await fixture({licenses});try{
  assert.equal(q.d.querySelectorAll('#olonLicenseList tr').length,15);
  click(q,'#olonLicenseNext');assert.equal(q.d.querySelectorAll('#olonLicenseList tr').length,6);
  const state=q.d.getElementById('olonLicenseFilter');state.value='available';state.dispatchEvent(new q.w.Event('change'));
  assert.equal(q.d.getElementById('olonLicensePage').textContent,'1 / 1');
  const duration=q.d.getElementById('olonLicenseDurationFilter');duration.value='30';duration.dispatchEvent(new q.w.Event('change'));
  assert.match(q.d.getElementById('olonLicenseList').textContent,/No hay licencias/);
  click(q,'#olonLicenseTabStudents');
  assert.equal(q.d.getElementById('olonLicenseCatalog').hidden,true);assert.equal(q.d.querySelectorAll('#olonLicenseStudents tr').length,2);
  const search=q.d.getElementById('olonLicenseSearch');search.value='diaz';search.dispatchEvent(new q.w.Event('input'));
  assert.equal(q.d.querySelectorAll('#olonLicenseStudents tr').length,1);
  click(q,'[data-license-new-for="s2"]');assert.equal(q.d.getElementById('olonLicenseAssign').value,'s2');
 }finally{q.close();}
});
test('creation keeps its generated codes visible and hidden codes are removed',async()=>{
 const q=await fixture();try{
  click(q,'#olonLicenseToggleCreate');q.d.getElementById('olonLicenseAssign').value='s2';
  click(q,'#olonLicenseGenerate');await tick();await tick();
  const call=q.calls.find(c=>c.action==='generate');assert.equal(call.issued_to,'s2');assert.equal(call.days,15);
  assert.equal(q.d.getElementById('olonLicenseResult').hidden,false);assert.equal(q.d.getElementById('olonLicenseCreatePanel').hidden,true);
  click(q,'#olonLicenseHideCodes');assert.equal(q.d.getElementById('olonGeneratedCodes').value,'');
 }finally{q.close();}
});
test('adding a student uses the existing registration gateway and selects the new account for licensing',async()=>{
 const q=await fixture({registration:true});try{
  click(q,'#olonLicenseAddStudent');
  const form=q.d.querySelector('.licenseStudentCreateForm');assert.ok(form);
  form.elements.name.value='Eva Test';form.elements.email.value='eva@example.test';form.elements.verified.checked=true;
  form.dispatchEvent(new q.w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();await tick();
  assert.deepEqual(q.calls.filter(c=>c.url.endsWith('registration-gateway')).filter(c=>['apply','approve'].includes(c.action)).map(c=>c.action),['apply','approve']);
  assert.equal(q.d.getElementById('licenseStudentCreateDialog'),null);
  assert.ok(q.d.querySelector('.adminCredentialDialog'));
  assert.equal(q.d.getElementById('olonLicenseAssign').value,'s-new');
  assert.equal(q.calls.some(c=>c.action==='generate'),false);
 }finally{q.close();}
});
test('a failed assignment stays editable and never reports success',async()=>{
 const q=await fixture();try{
  const original=q.w.fetch;q.w.fetch=async(url,options)=>JSON.parse(options.body).action==='assign'?{ok:false,json:async()=>({error:'La licencia ya fue asignada'})}:original(url,options);
  click(q,'[data-license-assign="l-unassigned"]');q.d.getElementById('olonLicenseInlineStudent').value='s2';
  q.d.getElementById('olonLicenseInlineAssign').dispatchEvent(new q.w.Event('submit',{cancelable:true}));await tick();await tick();
  assert.equal(q.d.getElementById('olonLicenseInlineAssign').hidden,false);
  assert.match(q.d.getElementById('olonLicenseAssignmentFeedback').textContent,/ya fue asignada/);
  assert.equal(q.d.getElementById('olonLicenseSaveAssignment').disabled,false);
 }finally{q.close();}
});

test('active licenses edit their expiry without displaying a replacement code',async()=>{
 const q=await fixture();try{
  q.records[0].access_expires_at=new Date(Date.now()+10*86400000).toISOString();q.records[0].is_current=true;await q.w.olonLicense.adminRefresh();
  click(q,'[data-license-edit="l-active"]');
  const dialog=q.d.querySelector('.olonLicenseCalendarDialog');assert.match(dialog.textContent,/Editar vencimiento activo/);
  assert.match(dialog.textContent,/no se suman/);
  const next=[...dialog.querySelectorAll('[data-date]:not(:disabled)')].find(b=>b.getAttribute('aria-selected')!=='true');assert.ok(next);next.click();
  dialog.querySelector('[data-cal-save]').click();await tick();await tick();
  assert.equal(q.calls.filter(c=>c.action==='edit_days').length,1);
  assert.equal(q.d.getElementById('olonLicenseResult').hidden,true);
  assert.match(q.d.getElementById('olonLicenseAdminFeedback').textContent,/Vencimiento actualizado/);
 }finally{q.close();}
});
test('active revocation explains access suspension and cancellation sends no request',async()=>{
 const q=await fixture();try{
  let message;q.w.confirm=text=>{message=text;return false;};
  click(q,'[data-license-revoke="l-active"]');await tick();
  assert.match(message,/acceso VIP se suspenderá/);
  assert.equal(q.calls.some(c=>c.action==='revoke'),false);
  q.w.confirm=()=>true;click(q,'[data-license-revoke="l-active"]');await tick();await tick();
  assert.equal(q.calls.filter(c=>c.action==='revoke').length,1);
 }finally{q.close();}
});
test('historical redeemed codes can be revoked but cannot edit the newer access term',async()=>{
 const q=await fixture();try{
  q.records[0].is_current=false;await q.w.olonLicense.adminRefresh();
  const row=q.d.querySelector('[data-license-row="l-active"]');
  assert.equal(row.querySelector('[data-license-edit]'),null);assert.ok(row.querySelector('[data-license-revoke]'));
  assert.match(row.textContent,/Licencia anterior/);assert.match(row.textContent,/Activada anterior/);
 }finally{q.close();}
});
