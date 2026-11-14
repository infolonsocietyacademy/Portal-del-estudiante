const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto');
const {stripTypeScriptTypes}=require('node:module');
const ids={account:'11111111-1111-4111-8111-111111111111',student:'22222222-2222-4222-8222-222222222222',
  vault:'33333333-3333-4333-8333-333333333333',agent:'44444444-4444-4444-8444-444444444444',
  provider:'55555555-5555-4555-8555-555555555555',oldProvider:'66666666-6666-4666-8666-666666666666'};
const token='olfx_'+'a'.repeat(64);
const previousTime='2026-11-10T12:00:00Z';
const raw=fs.readFileSync('supabase/functions/olon-own-connect/index.ts','utf8').replace(/^import .*;\n/gm,'');
const source=stripTypeScriptTypes(raw);

function harness(){
  const tables={
    olon_own_agents:[{id:ids.agent,status:'paired',created_by:ids.student,token_hash:createHash('sha256').update(token).digest('hex')}],
    olon_own_accounts:[{id:ids.account,student_id:ids.student,agent_id:ids.agent,provider_account_id:ids.provider,
      vault_account_id:ids.vault,platform:'mt5',broker_server:'Test-Server',status:'waiting',last_sync_at:previousTime}],
    olon_mt_sync_state:[{provider_account_id:ids.provider,student_id:ids.student,vault_account_id:ids.vault,
      source_version:1,last_success_at:previousTime,last_attempt_at:previousTime,balance:100,equity:100,backfill_done:true}],
    olon_mt_deals:[],profiles:[{id:ids.student,role:'student',status:'active'}]
  };
  class Query {
    constructor(table){this.table=table;this.filters=[];this.options={};this.action='read';}
    select(fields,options={}){this.options=options;this.selected=true;return this;}
    eq(key,value){this.filters.push(r=>r[key]===value);return this;}
    neq(key,value){this.filters.push(r=>r[key]!==value);return this;}
    in(key,values){this.filters.push(r=>values.includes(r[key]));return this;}
    not(key,operator,value){this.filters.push(r=>r[key]!=null);return this;}
    order(key,{ascending=true}={}){this.sort={key,ascending};return this;}
    limit(value){this.max=value;return this;}
    update(value){this.action='update';this.value=value;return this;}
    upsert(value,options){this.action='upsert';this.value=value;this.conflict=options;return this;}
    async maybeSingle(){const result=await this.run();return {...result,data:result.data?.[0]||null};}
    async run(){
      const rows=tables[this.table]||(tables[this.table]=[]);
      let data=rows.filter(r=>this.filters.every(f=>f(r)));
      if(this.action==='update')data.forEach(r=>Object.assign(r,this.value));
      if(this.action==='upsert'){
        const entries=Array.isArray(this.value)?this.value:[this.value];
        const keys=this.conflict.onConflict.split(',');
        for(const entry of entries){
          const existing=rows.find(r=>keys.every(k=>r[k]===entry[k]));
          if(existing){if(!this.conflict.ignoreDuplicates)Object.assign(existing,entry);}
          else rows.push({...entry});
        }
        data=entries;
      }
      if(this.sort)data.sort((a,b)=>String(a[this.sort.key]).localeCompare(String(b[this.sort.key]))*(this.sort.ascending?1:-1));
      const count=data.length;
      if(this.max!=null)data=data.slice(0,this.max);
      return {data:this.options.head?null:JSON.parse(JSON.stringify(data)),count,error:null};
    }
    then(resolve,reject){return this.run().then(resolve,reject);}
  }
  const db={from:name=>new Query(name),rpc:async()=>({data:ids.vault,error:null})};
  let handler;
  vm.runInNewContext(source,{Request,Response,URL,TextEncoder,Date,Number,Array,Map,Promise,crypto:webcrypto,
    console:{warn(){},error(){}},createClient:()=>db,createRemoteJWKSet:()=>({}),jwtVerify:async()=>({payload:{role:'authenticated',sub:ids.student}}),
    Deno:{env:{get:key=>key==='SUPABASE_URL'?'https://example.supabase.co':'test-only'},serve:fn=>handler=fn}});
  return {tables,async push(changes={}){
    const response=await handler(new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json','x-olfx-agent-token':token},
      body:JSON.stringify({action:'agent-push',accountId:ids.account,login:'12345678',server:'Test-Server',balance:103,equity:103,currency:'USD',
        deals:[],finished:false,sourceVersion:2,clockMode:'server',historyRevision:'a'.repeat(64),...changes})}));
    return {status:response.status,body:await response.json()};
  }};
}
const deal=(id,profit)=>({deal_id:String(id),occurred_at:'2026-11-11T05:24:43.712Z',broker_time:'2026-11-11T07:24:43.712',
  deal_type:'DEAL_TYPE_BUY',entry_type:'DEAL_ENTRY_OUT',volume:.1,profit,commission:0,swap:0,fee:0});

test('partial source batches retain the last complete balance and checkpoint',async()=>{
  const h=harness();
  const result=await h.push({deals:[deal(1,1)]});
  assert.equal(result.status,200);
  const state=h.tables.olon_mt_sync_state[0];
  assert.equal(state.last_success_at,previousTime);
  assert.equal(state.balance,100);
  assert.equal(state.source_version,1);
  assert.equal(h.tables.olon_own_accounts[0].last_sync_at,previousTime);
  assert.equal(h.tables.olon_own_accounts[0].status,'waiting');
  assert.equal((await h.push({deals:[deal(2,2)],finished:true,expectedTotal:2})).status,200);
  assert.equal(state.balance,103);
  assert.equal(state.source_version,2);
  assert.equal(h.tables.olon_own_accounts[0].status,'active');
});
test('source updates replace changed values once and retain exact source dates',async()=>{
  const h=harness();
  h.tables.olon_mt_deals.push({...deal(1,999),vault_account_id:ids.vault,student_id:ids.student,provider_account_id:ids.oldProvider});
  for(let i=0;i<2;i++)assert.equal((await h.push({deals:[deal(1,1.25)]})).status,200);
  assert.equal(h.tables.olon_mt_deals.length,1);
  assert.equal(h.tables.olon_mt_deals[0].profit,1.25);
  assert.equal(h.tables.olon_mt_deals[0].provider_account_id,ids.provider);
  assert.equal(h.tables.olon_mt_deals[0].broker_time,'2026-11-11 07:24:43.712');
});
test('an incomplete full source count never becomes a successful snapshot',async()=>{
  const h=harness();
  const result=await h.push({deals:[deal(1,1)],finished:true,expectedTotal:2});
  assert.equal(result.status,409);
  assert.equal(h.tables.olon_mt_sync_state[0].last_success_at,previousTime);
  assert.equal(h.tables.olon_own_accounts[0].status,'waiting');
});
test('older agents cannot overwrite a reconciled v2 snapshot',async()=>{
  const h=harness();h.tables.olon_mt_sync_state[0].source_version=2;
  const result=await h.push({sourceVersion:1,finished:true,balance:999,deals:[deal(1,999)]});
  assert.equal(result.status,409);
  assert.equal(h.tables.olon_mt_deals.length,0);
  assert.equal(h.tables.olon_mt_sync_state[0].balance,100);
});
test('a different agent assignment or invalid source date rejects the batch',async()=>{
  const h=harness();h.tables.olon_own_accounts[0].agent_id=ids.oldProvider;
  assert.equal((await h.push({deals:[deal(1,1)]})).status,403);
  assert.equal(h.tables.olon_mt_deals.length,0);
  const other=harness();
  assert.equal((await other.push({deals:[{...deal(1,1),broker_time:'not-a-date'}]})).status,400);
  assert.equal(other.tables.olon_mt_deals.length,0);
});
