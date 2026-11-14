const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('mt5-live.js','utf8');
function harness({role='student'}={}){
  let now=Date.parse('2026-11-14T22:00:00Z'),next=0,reads=0,renders=0,metadata=0;
  const timers=new Map(),events=new Map(),requests=[];
  const primary={id:'mine',is_primary:true,status:'active',last_sync_at:new Date(now-30000).toISOString(),source_version:2,history_revision:'first'};
  const other={id:'other',is_primary:false,status:'active',last_sync_at:primary.last_sync_at,source_version:2,history_revision:'other'};
  const state={accounts:[primary,other]};
  const on=(name,fn)=>{if(!events.has(name))events.set(name,[]);events.get(name).push(fn);};
  const emit=(name,detail)=>{for(const fn of events.get(name)||[])fn({type:name,detail});};
  const document={hidden:false,readyState:'complete',getElementById:()=>({classList:{contains:()=>false}}),
    querySelector:()=>({id:'historial'}),addEventListener:on};
  const window={addEventListener:on,dispatchEvent:event=>emit(event.type,event.detail),
    olonOwnAccountStatus:async()=>{reads++;const result=JSON.parse(JSON.stringify(state));emit('olon:mt5-status',result);return result;},
    olonRequestMt5Sync:async id=>{requests.push(id);primary.status='waiting';},
    render:async()=>{renders++;},olonMtRecords:{invalidate(){},today:()=> '2026-11-15',updateSnapshot(){metadata++;}}};
  const FakeDate=class extends Date{static now(){return now;}};
  vm.runInNewContext(source,{window,document,currentUser:{id:'student',role},Date:FakeDate,
    CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}},
    setTimeout:(fn,delay)=>{const id=++next;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id),
    console:{warn(){}}});
  async function flush(){for(let i=0;i<40;i++)await Promise.resolve();}
  return {primary,other,document,window,timers,events,requests,emit,flush,
    async step(){const entry=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!entry)return;
      timers.delete(entry[0]);now=Math.max(now,entry[1].at);entry[1].fn();await flush();},
    now:()=>now,get reads(){return reads;},get renders(){return renders;},get metadata(){return metadata;}};
}
test('automatic refresh queues only the selected account and waits for source completion',async()=>{
  const h=harness();await h.step();
  assert.deepEqual(h.requests,['mine']);assert.equal(h.renders,1);
  await h.step();assert.deepEqual(h.requests,['mine']);assert.equal(h.renders,1);
  h.primary.status='active';h.primary.last_sync_at=new Date(h.now()).toISOString();h.primary.history_revision='new-trade';
  await h.step();assert.equal(h.renders,2);
});
test('an unchanged history updates metadata without redrawing the calendar',async()=>{
  const h=harness();await h.step();
  h.primary.status='active';h.primary.last_sync_at=new Date(h.now()).toISOString();
  await h.step();assert.equal(h.renders,1);assert.ok(h.metadata>0);
  h.other.history_revision='unrelated-trade';await h.step();assert.equal(h.renders,1);
});
test('hidden tabs and administrators do not request broker synchronizations',async()=>{
  const h=harness();h.document.hidden=true;await h.step();assert.equal(h.reads,0);
  h.document.hidden=false;h.emit('visibilitychange');await h.step();assert.equal(h.reads,1);
  const admin=harness({role:'admin'});await admin.step();assert.equal(admin.reads,0);assert.deepEqual(admin.requests,[]);
});
test('scrolling cannot reinitialize the account or calendar',async()=>{
  const h=harness();await h.step();
  assert.equal(h.events.has('scroll'),false);assert.equal(h.events.has('resize'),false);
  h.emit('scroll');h.emit('resize');await h.flush();assert.equal(h.renders,1);
});
test('a source error stops automatic retries and an explicit refresh can request another attempt',async()=>{
  const h=harness();h.primary.last_error='MT5 offline';await h.step();assert.deepEqual(h.requests,[]);
  await h.window.olonMt5Live.refresh();assert.deepEqual(h.requests,['mine']);
});
