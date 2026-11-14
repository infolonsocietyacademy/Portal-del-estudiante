const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");

const source=fs.readFileSync("maintenance.js","utf8");
function harness({enabled=true,verifiedUser=true,profileStatus="active"}={}){
  const events=new Map(), elements=new Map();
  let clock=1000000, getUserCount=0, signouts=0, unauthorized=false;
  const uid="admin-id";
  function el(id){
    if(!elements.has(id)){
      const classes=new Set();
      elements.set(id,{
        id,dataset:{},hidden:false,textContent:"",
        classList:{
          contains:name=>classes.has(name),
          add:(...names)=>names.forEach(name=>classes.add(name)),
          remove:(...names)=>names.forEach(name=>classes.delete(name)),
          toggle:(name,force)=>{if(force===false)classes.delete(name);else classes.add(name);}
        },
        addEventListener(){},remove(){},scrollIntoView(){},focus(){}
      });
    }
    return elements.get(id);
  }
  let currentUser={id:uid,role:"admin",status:"active"};
  const user={id:uid,email:"erickinventus@gmail.com",email_confirmed_at:"confirmed"};
  const client={
    supabaseUrl:"https://example.supabase.co",supabaseKey:"public",
    auth:{
      async getUser(){getUserCount++;return {data:{user:unauthorized?null:verifiedUser?user:null},error:null};},
      async signOut(){signouts++;return {error:null};}
    },
    from(){
      return {select(){return this;},eq(){return this;},
        async maybeSingle(){return {data:{role:"admin",status:profileStatus},error:null};},
        async single(){return {data:{enabled,updated_at:"now"},error:null};}
      };
    }
  };
  const document={
    readyState:"loading",hidden:false,body:el("body"),
    getElementById:el,
    addEventListener:(event,callback)=>events.set(event,callback)
  };
  const win={};
  const FakeDate=class extends Date {static now(){return clock;}};
  const fetch=async()=>({ok:true,async json(){return [{enabled,updated_at:"now"}];}});
  const ctx={
    window:win,document,currentUser,supabaseClient:client,fetch,
    AbortController,Date:FakeDate,Promise,
    console:{warn(){},error(){}},clearTimeout,
    setTimeout, setInterval(){},
    confirm(){return false;}
  };
  vm.runInNewContext(source,ctx,{filename:"maintenance.js"});
  return {
    async start(){await events.get("DOMContentLoaded")();await win.olonMaintenance.waitReady();},
    async check(){await win.olonMaintenance.refresh();},
    el,
    advance:(ms)=>{clock+=ms;},
    unauthorized:()=>{unauthorized=true;},
    get getUserCount(){return getUserCount;},
    get signouts(){return signouts;}
  };
}

test("verified administrator remains signed in across regular maintenance polls",async()=>{
  const h=harness();
  await h.start();
  const count=h.getUserCount;
  await h.check();
  assert.equal(h.getUserCount,count,"maintenance should cache an authorized session for five minutes");
  assert.equal(h.signouts,0);
  assert.equal(h.el("portal").classList.contains("hidden"),false);
  assert.equal(h.el("body").classList.contains("olonMaintenanceBlocked"),false);
});

test("temporary empty auth response does not sign out a previously verified administrator",async()=>{
  const h=harness();
  await h.start();
  h.advance(301000);
  h.unauthorized();
  await h.check();
  assert.equal(h.signouts,0);
  assert.equal(h.el("portal").classList.contains("hidden"),false);
  assert.equal(h.el("body").classList.contains("olonMaintenanceBlocked"),false);
});

test("unverified access is blocked without automatically revoking the session",async()=>{
  const h=harness({verifiedUser:false});
  await h.start();
  assert.equal(h.el("body").classList.contains("olonMaintenanceBlocked"),true);
  assert.equal(h.el("olonMaintenanceGate").hidden,false);
  assert.equal(h.signouts,0);
});

test("maintenance disabled does not log out or block valid sessions",async()=>{
  const h=harness({enabled:false});
  await h.start();await h.check();
  assert.equal(h.signouts,0);
  assert.equal(h.el("body").classList.contains("olonMaintenanceBlocked"),false);
});
