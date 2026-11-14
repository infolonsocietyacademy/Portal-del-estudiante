const {test}=require("node:test");
const assert=require("node:assert/strict");
const vm=require("node:vm");
const fs=require("node:fs");
const script=fs.readFileSync("script.js","utf8");
const start=script.indexOf("  let logoutInProgress=false;");
const end=script.indexOf("  let restoreInFlight=",start);
assert.ok(start>0&&end>start);
const section=script.slice(start,end);
function harness(){
 const listeners={},operations=[],buttons=[];
 const logoutButton={disabled:false,setAttribute(){},removeAttribute(){},
   matches:s=>s==="[data-olon-logout]"};
 const other={closest:()=>null};
 let signedOut=0,confirmations=0,now=100000;
 const DateMock=class extends Date{static now(){return now;}};
 const portal={classList:{add:x=>operations.push("hide-portal:"+x)}};
 const auth={classList:{remove:x=>operations.push("show-auth:"+x)}};
 const url="https://example.github.io/Portal-del-estudiante/?logout=1&source=pwa";
 const win={location:{href:url,pathname:"/Portal-del-estudiante/"},
   history:{state:{},replaceState:(state,title,path)=>operations.push("replace-url:"+path)},
   scrollTo:()=>operations.push("scroll-top")};
 const ctx={Date:DateMock,URL,window:win,currentUser:{id:"test-user"},cachedRecords:[],cachedUsers:[],
   localStorage:{removeItem:key=>operations.push("local-clear:"+key)},
   sessionStorage:{removeItem:key=>operations.push("session-clear:"+key)},
   document:{addEventListener:(name,fn)=>{listeners[name]=fn;},
     querySelectorAll:()=>buttons,getElementById:id=>id==="portal"?portal:auth},
   supabaseClient:{auth:{async signOut(){signedOut++;return {error:null};}}},
   confirm:()=>{confirmations++;return true;},recoveryNotice:()=>{},
   setPortalMenu:()=>{},console:{warn(){},error(){}}
 };
 vm.runInNewContext("(function(){"+section+"})();",ctx);
 const btn={...logoutButton};buttons.push(btn);
 function touch(name,button,x=0,y=0){
  const t={clientX:x,clientY:y};
  listeners[name]?.({target:{closest:()=>button},touches:[t],changedTouches:[t]});
 }
 async function click(button=btn){
  await win.logout({type:"click",isTrusted:true,currentTarget:button});
 }
 return {btn,other,touch,click,advance:delta=>{now+=delta;},
   operations,get signedOut(){return signedOut;},get confirmations(){return confirmations;}};
}
test("iPad stationary tap on the logout button remains an intentional logout",async()=>{
 const h=harness();
 h.touch("touchstart",h.btn);
 h.touch("touchend",h.btn);
 await h.click();
 assert.equal(h.signedOut,1);
 assert.equal(h.confirmations,1);
 assert.ok(h.operations.some(x=>x.startsWith("replace-url:")));
 assert.ok(!h.operations.some(x=>x.includes("logout=1")));
});
test("iPad scroll starting on the logout control cannot trigger sign-out",async()=>{
 const h=harness();
 h.touch("touchstart",h.btn);
 h.touch("touchmove",h.btn,0,55);
 h.touch("touchend",h.btn,0,55);
 await h.click();
 assert.equal(h.signedOut,0);
 assert.equal(h.confirmations,0);
});
test("iPad scroll starting elsewhere cannot synthesize a logout click",async()=>{
 const h=harness();
 h.touch("touchstart",h.other);
 h.touch("touchmove",h.other,0,75);
 h.touch("touchend",h.other,0,75);
 await h.click();
 assert.equal(h.signedOut,0);
});
test("iPad touch on a non-logout target cannot be converted into a logout click",async()=>{
 const h=harness();
 h.touch("touchstart",h.other);
 h.touch("touchend",h.other);
 await h.click();
 assert.equal(h.signedOut,0);
});
test("a trusted keyboard click still allows intentional sign-out",async()=>{
 const h=harness();
 await h.click();
 assert.equal(h.signedOut,1);
});
test("legacy ?logout=1 is cleared without signing out at startup",()=>{
 const html=fs.readFileSync("index.html","utf8");
 const body=html.match(/<script id="olon-clean-stale-logout">([\s\S]*?)<\/script>/)?.[1];
 assert.ok(body);
 const mutations=[];
 const context={
  window:{location:{href:"https://example.github.io/Portal-del-estudiante/?logout=1&source=pwa"}},
  history:{state:null,replaceState:(state,title,path)=>mutations.push(path)},
  URL,console:{warn(){}}
 };
 vm.runInNewContext(body,context);
 assert.equal(mutations.length,1);
 assert.equal(mutations[0],"/Portal-del-estudiante/?source=pwa");
});
