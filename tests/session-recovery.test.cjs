const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('script.js','utf8');
const start=source.indexOf('(function(){',source.indexOf('CONEXION SEGURA SUPABASE AUTH'));
const end=source.indexOf('\n})();',start)+6;
function harness(){
 const events={},timers=new Map(),elements=new Map(),sessionValues=new Map();let nextTimer=0,fail=true,session=true,opened=0,signouts=0,reads=0;
 function element(id){
  if(!elements.has(id)){
   const classes=new Set(id==='portal'?['hidden']:[]);
   elements.set(id,{id,hidden:false,classList:{contains:x=>classes.has(x),add:(...xs)=>xs.forEach(x=>classes.add(x)),remove:(...xs)=>xs.forEach(x=>classes.delete(x)),toggle(){}},setAttribute(){},parentNode:{appendChild(n){elements.set(n.id,n);}}});
  }
  return elements.get(id);
 }
 const context={console:{warn(){},error(){}},Date,Intl,Promise,currentUser:null,
  document:{hidden:false,readyState:'loading',getElementById:id=>id==='olonSessionRecoveryNotice'?elements.get(id):element(id),createElement:()=>({setAttribute(){}}),body:element('body'),addEventListener:(name,fn)=>events[name]=fn},
  localStorage:{setItem(){},removeItem(){}},
  sessionStorage:{getItem:key=>sessionValues.get(key)||null,setItem:(key,value)=>sessionValues.set(key,value),removeItem:key=>sessionValues.delete(key)},
  setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),setInterval(){},
  showPortalLoader(){},hidePortalLoader(){},
  supabaseClient:{auth:{async getSession(){reads++;if(fail)throw Error('Network unavailable');return {data:{session:session?{user:{id:'u1'}}:null}};},async getUser(){return {data:{user:{id:'u1'}}};},async signOut(){signouts++;return {}; }},from(){return {select(){return this;},eq(){return this;},async maybeSingle(){return {data:{id:'u1',role:'student',status:'active'}};}};}},
  window:{addEventListener:(name,fn)=>events[name]=fn,olonMaintenance:{async waitReady(){},needsConnection:()=>false,withDeadline:p=>p,guard:async()=>true},async enterPortal(){opened++;element('portal').classList.remove('hidden');}}
 };
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 return {context,events,timers,element,sessionValues,get opened(){return opened;},get reads(){return reads;},get signouts(){return signouts;},set fail(v){fail=v;},set session(v){session=v;},async restore(){await context.window.olonRestoreSession();},async tick(){const [id,timer]=timers.entries().next().value;timers.delete(id);timer.fn();for(let i=0;i<30;i++)await Promise.resolve();}};
}
test('a failed session read retries and opens the server-verified session without signing out',async()=>{
 const h=harness();await h.restore();assert.equal(h.opened,0);assert.equal(h.timers.size,1);
 h.fail=false;await h.tick();assert.equal(h.opened,1);assert.equal(h.signouts,0);assert.equal(h.timers.size,0);
 assert.equal(h.element('olonSessionRecoveryNotice').hidden,true);
});
test('no stored session stops retries and leaves the login available',async()=>{
 const h=harness();h.fail=false;h.session=false;await h.restore();assert.equal(h.opened,0);assert.equal(h.timers.size,0);
});
test('scroll, resize, online and visibility cannot restart an already open portal',async()=>{
 const h=harness();h.fail=false;await h.restore();const reads=h.reads;
 assert.equal(h.events.scroll,undefined);assert.equal(h.events.resize,undefined);
 h.events.online();h.events.visibilitychange();await h.restore();assert.equal(h.opened,1);assert.equal(h.reads,reads);
});
test('offline retries are bounded and online resumes interrupted recovery',async()=>{
 const h=harness();await h.restore();for(let i=0;i<4;i++)await h.tick();assert.equal(h.timers.size,0);assert.equal(h.opened,0);
 h.fail=false;h.events.online();for(let i=0;i<30;i++)await Promise.resolve();assert.equal(h.opened,1);
});
test('concurrent recovery callers open the portal only once',async()=>{
 const h=harness();h.fail=false;await Promise.all([h.restore(),h.restore(),h.restore()]);assert.equal(h.opened,1);
});

test('Safari transient null session retries only for a previously authenticated tab',async()=>{
 const h=harness();h.fail=false;h.session=false;
 h.sessionValues.set('olon_verified_session','1');
 await h.restore();
 assert.equal(h.opened,0);assert.equal(h.signouts,0);assert.equal(h.timers.size,1);
 h.session=true;await h.tick();
 assert.equal(h.opened,1);assert.equal(h.signouts,0);
});
test('Safari bfcache pageshow restores verified session once without repeated sign-in',async()=>{
 const h=harness();h.fail=false;
 h.events.pageshow({persisted:true});
 for(let i=0;i<30;i++)await Promise.resolve();
 assert.equal(h.opened,1);assert.equal(h.signouts,0);
 await h.events.pageshow({persisted:true});
 assert.equal(h.opened,1);
});
