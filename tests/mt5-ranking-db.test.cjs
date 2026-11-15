const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const db=new PGlite();
const user=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261115073127_verified_ranking_account_history.sql'),'utf8');
const sql=async q=>(await db.query(q)).rows;
async function asUser(n){await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[n?user(n):'']);}
async function fixture(fn){
  await db.exec('BEGIN');
  try{await asUser(1);await fn();}finally{await db.exec('ROLLBACK');}
}
before(async()=>{
  await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/mt5-ranking.sql'),'utf8'));
  await db.exec(migration);
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261115074220_private_ranking_exclusion_policy.sql'),'utf8'));
  await db.query('INSERT INTO private.olon_ranking_exclusions(student_id,reason) VALUES($1,$2)',[user(2),'Owner test account']);
});
after(()=>db.close());

test('test accounts are excluded before assigning contiguous ranks in every period',()=>fixture(async()=>{
  for(const [period,key] of [['weekly','2026-W46'],['monthly','2026-11'],['annual','2026']]){
    const rows=await db.query('SELECT * FROM private.olon_compute_automatic_top3($1,$2)',[period,key]);
    assert.deepEqual(rows.rows.map(r=>[r.rank,r.student_id,Number(r.return_pct)]),[[1,user(3),20],[2,user(4),10]]);
  }
}));
test('one MT5 vault combines provider fragments without multiplying its capital or trades',()=>fixture(async()=>{
  const row=(await sql(`SELECT * FROM public.olon_admin_student_performance('all',NULL) WHERE student_id='${user(3)}'`))[0];
  assert.deepEqual([Number(row.deposited),Number(row.net),Number(row.trade_count),Number(row.return_pct)],[100,20,1,20]);
  const excluded=(await sql(`SELECT * FROM public.olon_admin_student_performance('all',NULL) WHERE student_id='${user(2)}'`))[0];
  assert.equal(Number(excluded.net),995);
  assert.equal(excluded.return_pct,null);
}));
test('excluded accounts have no personal rank and do not count as measured traders',()=>fixture(async()=>{
  await asUser(2);
  assert.deepEqual((await sql('SELECT * FROM public.olon_student_rank()'))[0],{rank_position:null,measured_count:2});
  await asUser(3);
  assert.deepEqual((await sql('SELECT * FROM public.olon_student_rank()'))[0],{rank_position:1,measured_count:2});
}));
test('MT5 business dates determine the period even across a Puerto Rico week boundary',()=>fixture(async()=>{
  await db.exec(`UPDATE public.olon_mt_deals SET occurred_at='2026-11-15 22:30Z',broker_time='2026-11-16 00:30:00' WHERE student_id='${user(3)}' AND deal_id='closure'`);
  const oldWeek=await sql("SELECT * FROM private.olon_compute_automatic_top3('weekly','2026-W46')");
  const newWeek=await sql("SELECT * FROM private.olon_compute_automatic_top3('weekly','2026-W47')");
  assert.deepEqual(oldWeek.map(r=>r.student_id),[user(4)]);
  assert.deepEqual(newWeek.map(r=>r.student_id),[user(3)]);
}));
test('a reconciled native snapshot supersedes legacy capital from the same vault',()=>fixture(async()=>{
  await db.exec(`UPDATE public.olon_mt_sync_state SET source_version=2 WHERE provider_account_id='10000000-0000-0000-0000-000000000003'`);
  const row=(await sql(`SELECT * FROM public.olon_admin_student_performance('all',NULL) WHERE student_id='${user(3)}'`))[0];
  assert.equal(Number(row.deposited),0);
  assert.equal(row.return_pct,null);
  assert.deepEqual((await sql("SELECT * FROM private.olon_compute_automatic_top3('annual','2026')")).map(r=>r.student_id),[user(4)]);
}));
test('a verified legacy connection also reads its complete shared vault when the native account is inactive',()=>fixture(async()=>{
  await db.exec(`UPDATE public.olon_own_accounts SET status='revoked' WHERE student_id='${user(3)}'`);
  const row=(await sql(`SELECT * FROM public.olon_admin_student_performance('all',NULL) WHERE student_id='${user(3)}'`))[0];
  assert.deepEqual([Number(row.deposited),Number(row.net),Number(row.return_pct)],[100,20,20]);
}));
test('equal percentages use net profit then student id for stable positions',()=>fixture(async()=>{
  await db.exec(`UPDATE public.olon_mt_deals SET profit=30 WHERE student_id='${user(4)}' AND deal_id='closure';
    UPDATE public.olon_mt_deals SET profit=125 WHERE student_id='${user(4)}' AND deal_id='deposit'`);
  const tied=await sql("SELECT * FROM private.olon_compute_automatic_top3('annual','2026')");
  assert.deepEqual(tied.map(r=>[r.rank,r.student_id,Number(r.return_pct)]),[[1,user(4),20],[2,user(3),20]]);
  await db.exec(`UPDATE public.olon_mt_deals SET profit=25 WHERE student_id='${user(4)}' AND deal_id='closure';
    UPDATE public.olon_mt_deals SET profit=100 WHERE student_id='${user(4)}' AND deal_id='deposit'`);
  assert.deepEqual((await sql("SELECT * FROM private.olon_compute_automatic_top3('annual','2026')")).map(r=>r.student_id),[user(3),user(4)]);
}));
test('incomplete, revoked and expired accounts cannot displace eligible students',()=>fixture(async()=>{
  await db.exec(`UPDATE public.olon_mt_sync_state SET backfill_done=false WHERE student_id='${user(3)}'`);
  assert.deepEqual((await sql("SELECT * FROM private.olon_compute_automatic_top3('annual','2026')")).map(r=>r.student_id),[user(4)]);
  await db.exec(`UPDATE public.olon_mt_sync_state SET backfill_done=true WHERE student_id='${user(3)}';
    UPDATE public.olon_own_accounts SET status='revoked' WHERE student_id='${user(3)}';
    UPDATE public.olon_metaapi_accounts SET connection_status='DISCONNECTED' WHERE student_id='${user(3)}'`);
  assert.deepEqual((await sql("SELECT * FROM private.olon_compute_automatic_top3('annual','2026')")).map(r=>r.student_id),[user(4)]);
  await db.exec(`UPDATE public.profiles SET next_payment_date='2000-01-01' WHERE id='${user(4)}'`);
  assert.equal((await sql("SELECT * FROM private.olon_compute_automatic_top3('annual','2026')")).length,0);
}));
test('name privacy and admin-only financial access remain enforced',()=>fixture(async()=>{
  await db.query('INSERT INTO public.olon_ranking_name_preferences VALUES($1,false)',[user(3)]);
  await asUser(4);
  const row=(await sql("SELECT * FROM private.olon_compute_automatic_top3('annual','2026')"))[0];
  assert.equal(row.student_id,null);assert.equal(row.display_name,'Trader OLON #1');
  await assert.rejects(sql("SELECT * FROM public.olon_admin_student_performance('all',NULL)"),{code:'42501'});
}));
test('anonymous callers cannot read ranks or financial results',()=>fixture(async()=>{
  await asUser(null);
  assert.equal((await sql("SELECT * FROM private.olon_compute_automatic_top3('annual','2026')")).length,0);
  await assert.rejects(sql('SELECT * FROM public.olon_student_rank()'),{code:'42501'});
}));
test('authenticated clients cannot edit exclusions or read the internal performance helper',()=>fixture(async()=>{
  await asUser(3);
  await db.exec('SET LOCAL ROLE authenticated');
  assert.equal((await sql("SELECT has_table_privilege(current_user,'private.olon_ranking_exclusions','SELECT') allowed"))[0].allowed,false);
  assert.equal((await sql("SELECT has_table_privilege(current_user,'private.olon_ranking_exclusions','INSERT') allowed"))[0].allowed,false);
  assert.equal((await sql("SELECT has_function_privilege(current_user,'private.olon_mt_rank_performance(text,text)','EXECUTE') allowed"))[0].allowed,false);
  assert.equal((await sql("SELECT * FROM private.olon_compute_automatic_top3('annual','2026')"))[0].rank,1);
}));
test('exclusion RLS still denies clients if a future table grant is introduced',()=>fixture(async()=>{
  await db.exec('GRANT SELECT,INSERT ON private.olon_ranking_exclusions TO authenticated');
  await asUser(3);
  await db.exec('SET LOCAL ROLE authenticated');
  assert.equal((await sql('SELECT * FROM private.olon_ranking_exclusions')).length,0);
  await assert.rejects(db.query('INSERT INTO private.olon_ranking_exclusions(student_id,reason) VALUES($1,$2)',[user(3),'Unauthorized change']),{code:'42501'});
}));
