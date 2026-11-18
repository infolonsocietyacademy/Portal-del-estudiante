const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const db=new PGlite();
const id=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
const admin=id(1),student=id(2),other=id(3),active=id(11),historical=id(12),available=id(13);
const sql=async(q,args=[])=> (await db.query(q,args)).rows;
const migration=fs.readFileSync('supabase/migrations/20261118130136_admin_manage_active_vip_licenses.sql','utf8');
before(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text,status text,next_payment_date date);
 CREATE TABLE public.olon_licenses(id uuid PRIMARY KEY,code_hash text,duration_days int CHECK(duration_days BETWEEN 1 AND 365),status text CHECK(status IN ('available','redeemed','revoked')),issued_to uuid,redeemed_by uuid,redeemed_at timestamptz,revoked_at timestamptz);
 CREATE TABLE public.olon_license_terms(student_id uuid PRIMARY KEY,expires_at timestamptz NOT NULL,activated_at timestamptz DEFAULT now(),last_license_id uuid REFERENCES public.olon_licenses(id) ON DELETE SET NULL,updated_at timestamptz DEFAULT now());
 CREATE TABLE public.olon_license_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,license_id uuid,student_id uuid,event_type text NOT NULL CONSTRAINT olon_license_audit_event_type_check CHECK(event_type IN ('generated','assigned','redeemed','revoked','reissued','viewed')),performed_by uuid);
 INSERT INTO profiles VALUES('${admin}','admin','active',NULL),('${student}','student','active',current_date+30),('${other}','student','active',current_date+40);
 INSERT INTO olon_licenses VALUES('${active}','same-original-code',30,'redeemed','${student}','${student}',now()-interval '5 days',NULL),('${historical}','older',15,'redeemed','${student}','${student}',now()-interval '35 days',NULL),('${available}','unused',15,'available','${student}',NULL,NULL,NULL);
 INSERT INTO olon_license_terms(student_id,expires_at,last_license_id) VALUES('${student}',now()+interval '30 days','${active}');`);
 await db.exec(migration);
});
after(()=>db.close());
async function fixture(fn){await db.exec('BEGIN');try{await fn();}finally{await db.exec('ROLLBACK');}}
async function manage(license,action,days=null,actor=admin){return (await sql('SELECT public.olon_admin_manage_license($1,$2,$3,$4) AS result',[license,actor,action,days]))[0].result;}
test('active editing replaces the expiry from now and retains the redeemed code',()=>fixture(async()=>{
 const result=await manage(active,'edit',7);assert.equal(result.ok,true);assert.equal(result.active,true);
 const row=(await sql(`SELECT l.*,t.expires_at,p.next_payment_date FROM olon_licenses l JOIN olon_license_terms t ON t.last_license_id=l.id JOIN profiles p ON p.id=t.student_id WHERE l.id=$1`,[active]))[0];
 assert.equal(row.status,'redeemed');assert.equal(row.code_hash,'same-original-code');assert.equal(row.duration_days,7);
 const remaining=(await sql("SELECT extract(epoch from (expires_at-now()))/86400 AS days FROM olon_license_terms WHERE student_id=$1",[student]))[0];assert.equal(Number(remaining.days),7);
 assert.equal((await sql("SELECT count(*) AS n FROM olon_license_audit WHERE event_type='edited'"))[0].n,1);
 const profile=(await sql("SELECT next_payment_date=((SELECT expires_at FROM olon_license_terms WHERE student_id=$1) at time zone 'America/Puerto_Rico')::date AS matches FROM profiles WHERE id=$1",[student]))[0];assert.equal(profile.matches,true);
}));
test('revoking the active license expires access and keeps student data',()=>fixture(async()=>{
 const result=await manage(active,'revoke');assert.equal(result.access_revoked,true);
 assert.equal((await sql('SELECT status FROM olon_licenses WHERE id=$1',[active]))[0].status,'revoked');
 assert.equal((await sql('SELECT expires_at<=now() AS expired FROM olon_license_terms WHERE student_id=$1',[student]))[0].expired,true);
 assert.equal((await sql('SELECT status FROM profiles WHERE id=$1',[student]))[0].status,'active');
 assert.equal((await sql("SELECT count(*) AS n FROM olon_license_audit WHERE event_type='revoked'"))[0].n,1);
}));
test('revoking a previous license preserves the newer renewal expiry',()=>fixture(async()=>{
 const before=(await sql('SELECT expires_at FROM olon_license_terms WHERE student_id=$1',[student]))[0].expires_at;
 const result=await manage(historical,'revoke');assert.equal(result.access_revoked,false);
 assert.deepEqual((await sql('SELECT expires_at FROM olon_license_terms WHERE student_id=$1',[student]))[0].expires_at,before);
}));
test('historical editing and an invalid actor make no changes',()=>fixture(async()=>{
 assert.equal((await manage(historical,'edit',10)).status,409);
 assert.equal((await manage(active,'edit',10,student)).status,403);
 await db.query("UPDATE profiles SET status='suspended' WHERE id=$1",[admin]);
 assert.equal((await manage(active,'revoke')).status,403);
 assert.equal((await sql('SELECT count(*) AS n FROM olon_license_audit'))[0].n,0);
}));
test('revoking available or already revoked codes never modifies the active term',()=>fixture(async()=>{
 const before=(await sql('SELECT expires_at FROM olon_license_terms WHERE student_id=$1',[student]))[0].expires_at;
 assert.equal((await manage(available,'revoke')).access_revoked,false);
 assert.equal((await manage(available,'revoke')).already_revoked,true);
 assert.deepEqual((await sql('SELECT expires_at FROM olon_license_terms WHERE student_id=$1',[student]))[0].expires_at,before);
 assert.equal((await sql('SELECT count(*) AS n FROM olon_license_audit'))[0].n,1);
}));
test('an expired current license can renew, and revoked codes cannot be edited',()=>fixture(async()=>{
 await db.query("UPDATE olon_license_terms SET expires_at=now()-interval '5 days' WHERE student_id=$1",[student]);
 assert.equal((await manage(active,'edit',1)).ok,true);
 await manage(active,'revoke');assert.equal((await manage(active,'edit',10)).status,409);
}));
test('revocation cannot move an expired term forward',()=>fixture(async()=>{
 await db.query("UPDATE olon_license_terms SET expires_at=now()-interval '10 days' WHERE student_id=$1",[student]);
 const before=(await sql('SELECT expires_at FROM olon_license_terms WHERE student_id=$1',[student]))[0].expires_at;
 await manage(active,'revoke');assert.deepEqual((await sql('SELECT expires_at FROM olon_license_terms WHERE student_id=$1',[student]))[0].expires_at,before);
}));
test('invalid days and missing licenses are rejected before audit or state changes',()=>fixture(async()=>{
 for(const days of [null,0,-1,366])assert.equal((await manage(active,'edit',days)).status,400);
 assert.equal((await manage(id(99),'revoke')).status,404);
 assert.equal((await manage(active,'other')).status,400);
 assert.equal((await sql('SELECT count(*) AS n FROM olon_license_audit'))[0].n,0);
}));
test('public clients cannot invoke administration with a forged admin id',()=>fixture(async()=>{
 for(const role of ['anon','authenticated']){
  assert.equal((await sql("SELECT has_function_privilege($1,'public.olon_admin_manage_license(uuid,uuid,text,integer)','EXECUTE') allowed",[role]))[0].allowed,false);
 }
 assert.equal((await sql("SELECT has_function_privilege('service_role','public.olon_admin_manage_license(uuid,uuid,text,integer)','EXECUTE') allowed"))[0].allowed,true);
 const fn=(await sql("SELECT prosecdef FROM pg_proc WHERE oid='public.olon_admin_manage_license(uuid,uuid,text,integer)'::regprocedure"))[0];assert.equal(fn.prosecdef,false);
}));
test('audit failure rolls back expiry, profile and code status atomically',async()=>{
 await db.exec('BEGIN');
 try{
  await db.exec("ALTER TABLE olon_license_audit ADD CONSTRAINT reject_audit_for_test CHECK (event_type<>'revoked')");
  await assert.rejects(manage(active,'revoke'));
 }finally{await db.exec('ROLLBACK');}
 assert.equal((await sql('SELECT status FROM olon_licenses WHERE id=$1',[active]))[0].status,'redeemed');
 assert.equal((await sql('SELECT expires_at>now() AS active FROM olon_license_terms WHERE student_id=$1',[student]))[0].active,true);
});
