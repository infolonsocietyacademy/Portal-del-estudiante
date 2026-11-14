const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const src=fs.readFileSync("session-diagnostics.js","utf8");
const html=fs.readFileSync("index.html","utf8");
test("diagnostics are opt-in and do not register listeners by default",()=>{
 let listeners=0;
 const ctx={window:{},location:{search:""},URLSearchParams,sessionStorage:{getItem(){return null;}},document:{addEventListener(){listeners++;}}};
 vm.runInNewContext(src,ctx);
 assert.equal(listeners,0);assert.equal(ctx.window.olonSessionTrace,undefined);
});
test("diagnostics can be enabled without reading Supabase tokens or passwords",()=>{
 const events={};const stored=new Map(),portal={hidden:false,classList:{contains:()=>false}};
 const elements={portal,auth:{hidden:true,classList:{contains:()=>true}}};
 const doc={body:{classList:{contains:()=>false}},readyState:"loading",hidden:false,
  getElementById:id=>elements[id]||null,querySelector:()=>null,addEventListener:(name,fn)=>{events[name]=fn;}};
 const win={addEventListener:(name,fn)=>{events[name]=fn;}};
 const ctx={window:win,document:doc,location:{search:"?diagnostico=1"},
  sessionStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},
  URLSearchParams,Date,performance:{getEntriesByType:()=>[]},navigator:{userAgent:"iPad"},console};
 vm.runInNewContext(src,ctx);
 assert.ok(win.olonSessionTrace);
 assert.ok(win.olonSessionTrace.report().includes("diagnostic-start"));
 assert.ok(!win.olonSessionTrace.report().includes("access_token"));
 assert.ok(!win.olonSessionTrace.report().includes("password"));
 assert.ok(events.pagehide);
 assert.ok(events.touchmove);
});
test("script loaded before maintenance and main portal scripts",()=>{
 const diag=html.indexOf("session-diagnostics.js?v=");
 assert.ok(diag>0);
 assert.ok(diag<html.indexOf("maintenance.js?v="));
 assert.ok(diag<html.indexOf("script.js?v="));
});
