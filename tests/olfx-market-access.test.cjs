const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const tick=()=>new Promise(r=>setImmediate(r));
function setup(identity){
 const section=fs.readFileSync('index.html','utf8').match(/<section id="propTraderzPage"[\s\S]*?<\/section>/)[0];
 const dom=new JSDOM('<main id="portal">'+section+'</main>',{runScripts:'outside-only',url:'https://portal.example'}),w=dom.window;
 w.document.getElementById('propTraderzPage').classList.remove('hidden');
 let callback,calls=0,reply=identity;
 w.supabaseClient={auth:{getUser:async()=>({data:{user:reply},error:null}),onAuthStateChange:fn=>{callback=fn;}}};
 w.AbortController=AbortController;w.fetch=async()=>{calls++;return {ok:true,json:async()=>({})};};
 w.localStorage.setItem('olon_current_user',JSON.stringify({email:'nolotraderfx@gmail.com',role:'admin'}));
 w.eval(fs.readFileSync('olfx-market-access.js','utf8'));
 w.eval(fs.readFileSync('proptraderz.js','utf8'));
 return {w,dom,calls:()=>calls,setUser:user=>{reply=user;callback('SIGNED_IN');}};
}
test('other users and anonymous visitors see coming soon and make no data request even with a forged saved profile',async()=>{
 for(const user of [null,{id:'other',email:'other@example.com'},{id:'other',email:'nolotraderfx@gmail.com.evil'}]){
  const s=setup(user);try{await tick();assert.equal(s.w.olfxMarketAccess.allowed(),false);assert.equal(s.w.document.getElementById('olfxMarketContent').hidden,true);assert.equal(s.w.document.getElementById('olfxMarketSoon').hidden,false);assert.equal(s.calls(),0);}finally{s.dom.window.close();}
 }
});
test('only verified account can load the section; switching accounts revokes access and clears rendered data',async()=>{
 const s=setup({id:'owner',email:'NoloTraderFX@gmail.com'});try{
  await tick();assert.equal(s.w.olfxMarketAccess.allowed(),true);assert.equal(s.w.document.getElementById('olfxMarketContent').hidden,false);assert.ok(s.calls()>0);
  const before=s.calls();s.setUser({id:'other',email:'other@example.com'});assert.equal(s.w.document.getElementById('olfxMarketContent').hidden,true);await tick();
  assert.equal(s.w.olfxMarketAccess.allowed(),false);assert.equal(s.calls(),before);assert.equal(s.w.document.getElementById('ptzFrameHost').shadowRoot.childNodes.length,0);
 }finally{s.dom.window.close();}
});
test('a stale identity verification cannot restore owner access after signout',async()=>{
 const s=setup(null);try{
  await tick();let resolve;s.w.supabaseClient.auth.getUser=()=>new Promise(r=>{resolve=r;});
  s.w.dispatchEvent(new s.w.CustomEvent('olon:pagechange',{detail:{id:'propTraderzPage'}}));
  s.w.document.getElementById('portal').classList.add('hidden');await tick();
  resolve({data:{user:{id:'owner',email:'nolotraderfx@gmail.com'}}});await tick();assert.equal(s.w.olfxMarketAccess.allowed(),false);assert.equal(s.calls(),0);
 }finally{s.dom.window.close();}
});
