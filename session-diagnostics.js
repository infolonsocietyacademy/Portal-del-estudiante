/* OLON: opt-in, privacy-safe iPad session trace.
   Enable with ?diagnostico=1. Data stays in this browser tab, never uploaded. */
(()=>{
  "use strict";
  const FLAG="olon_trace_enabled_v1",STORE="olon_trace_events_v1";
  let enabled=false;
  try{
    const search=new URLSearchParams(location.search);
    if(search.get("diagnostico")==="1")sessionStorage.setItem(FLAG,"1");
    if(search.get("diagnostico")==="0")sessionStorage.removeItem(FLAG);
    enabled=sessionStorage.getItem(FLAG)==="1";
  }catch{}
  if(!enabled)return;
  let entries=[];
  try{entries=JSON.parse(sessionStorage.getItem(STORE)||"[]");if(!Array.isArray(entries))entries=[];}catch{}
  const $=id=>document.getElementById(id);
  const visible=id=>{
    const n=$(id);
    return !!(n&&!n.hidden&&!n.classList.contains("hidden"));
  };
  let panel=null,details=null,view=null;
  function snapshot(){
    let account=false;
    try{account=typeof currentUser!=="undefined"&&!!currentUser;}catch{}
    return {
      portal:visible("portal"),login:visible("auth"),account,
      page:document.querySelector("#portal .page:not(.hidden)")?.id||"-",
      maintenance:document.body?.classList.contains("olonMaintenanceBlocked")||false,
      logoutUrl:new URLSearchParams(location.search).has("logout")
    };
  }
  function record(event,info=""){
    const item={t:new Date().toLocaleTimeString("es-PR",{hour12:false}),event,
      ...(info?{info:String(info).slice(0,100)}:{}),...snapshot()};
    entries.push(item);entries=entries.slice(-65);
    try{sessionStorage.setItem(STORE,JSON.stringify(entries));}catch{}
    if(view)view.value=report();
    return item;
  }
  function report(){
    return "OLON TRADER — DIAGNÓSTICO LOCAL\n"+
      "Versión: ipad-trace-20261114-1\n"+
      "Navegador: "+(/iPad|iPhone/.test(navigator.userAgent)?"iPadOS/iOS Safari":"Otro")+
      "\nEventos (sin datos personales, contraseñas ni tokens):\n"+
      entries.map((e,i)=>String(i+1).padStart(2,"0")+" "+JSON.stringify(e)).join("\n");
  }
  window.olonSessionTrace={record,report};
  record("diagnostic-start",performance.getEntriesByType?.("navigation")?.[0]?.type||"unknown");
  window.addEventListener("pageshow",e=>record("pageshow",e.persisted?"bfcache":"normal"));
  window.addEventListener("pagehide",e=>record("pagehide",e.persisted?"bfcache":"leave"));
  window.addEventListener("beforeunload",()=>record("beforeunload"));
  window.addEventListener("popstate",()=>record("popstate"));
  window.addEventListener("hashchange",()=>record("hashchange"));
  window.addEventListener("error",e=>record("javascript-error",e.error?.name||"error"));
  window.addEventListener("unhandledrejection",e=>record("promise-error",e.reason?.name||"promise"));
  document.addEventListener("visibilitychange",()=>record("visibilitychange",document.visibilityState));
  let start=null,dragged=false;
  document.addEventListener("touchstart",e=>{
    const t=e.touches?.[0];
    if(!t||e.touches.length!==1){start=null;return;}
    start={x:t.clientX,y:t.clientY};
    dragged=false;
    if(e.target?.closest?.("[data-olon-logout]"))record("logout-button-touchstart");
  },{passive:true,capture:true});
  document.addEventListener("touchmove",e=>{
    if(!start||dragged)return;
    const t=e.touches?.[0];if(!t)return;
    if(Math.abs(t.clientY-start.y)>12||Math.abs(t.clientX-start.x)>12){
      dragged=true;
      record("touch-scroll",Math.abs(t.clientY-start.y)>=Math.abs(t.clientX-start.x)?"vertical":"horizontal");
    }
  },{passive:true,capture:true});
  document.addEventListener("click",e=>{
    if(e.target?.closest?.("[data-olon-logout]"))record("logout-button-click");
  },{capture:true});
  let previous="";
  function captureDOM(){
    const state=snapshot(),key=JSON.stringify(state);
    if(key!==previous){previous=key;record("screen-change");}
  }
  function mount(){
    captureDOM();
    const observer=new MutationObserver(captureDOM);
    for(const id of ["portal","auth"]){
      const n=$(id);
      if(n)observer.observe(n,{attributes:true,attributeFilter:["class","hidden","style"]});
    }
    observer.observe(document.body,{attributes:true,attributeFilter:["class"]});
    if(typeof supabaseClient!=="undefined"&&supabaseClient?.auth?.onAuthStateChange){
      try{supabaseClient.auth.onAuthStateChange((event,session)=>{
        record("supabase-auth",event+";session="+!!session);
      });}catch{record("auth-listener-error");}
    }
    const style=document.createElement("style");
    style.textContent="#olonTraceOpen{position:fixed;right:12px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:2147483646;background:#122538;color:#fff;border:1px solid #9bcaff;border-radius:10px;padding:10px 14px;font:700 13px system-ui;box-shadow:0 6px 20px #0006}#olonTracePanel{position:fixed;z-index:2147483647;inset:10% 10px auto 10px;max-width:700px;margin:auto;background:#0c1624;color:#fff;padding:15px;border:1px solid #9bcaff;border-radius:12px;box-shadow:0 10px 55px #000a;font:14px system-ui}#olonTracePanel[hidden]{display:none!important}#olonTracePanel textarea{display:block;width:100%;height:44vh;box-sizing:border-box;background:#06101b;color:#fff;font:11px/1.5 monospace;border:1px solid #7d96ae;border-radius:6px}#olonTracePanel button{min-height:42px;margin:8px 6px 0 0;padding:8px 12px;border-radius:7px;border:1px solid #98b9db;background:#16405e;color:#fff;font-weight:700}";
    document.head.append(style);
    const open=document.createElement("button");
    open.id="olonTraceOpen";open.type="button";open.textContent="Diagnóstico del portal";
    panel=document.createElement("div");panel.id="olonTracePanel";panel.hidden=true;
    const heading=document.createElement("strong");heading.textContent="Diagnóstico de sesión — Safari iPad";
    details=document.createElement("p");details.textContent="Cuando el portal te saque, abre este panel y pulsa Copiar registro. No incluye contraseñas ni tokens.";
    view=document.createElement("textarea");view.readOnly=true;view.setAttribute("aria-label","Registro de diagnóstico");
    const copy=document.createElement("button");copy.type="button";copy.textContent="Copiar registro";
    const close=document.createElement("button");close.type="button";close.textContent="Cerrar";
    panel.append(heading,details,view,copy,close);
    document.body.append(open,panel);
    open.addEventListener("click",()=>{panel.hidden=false;view.value=report();});
    close.addEventListener("click",()=>{panel.hidden=true;});
    copy.addEventListener("click",async()=>{
      const txt=report();
      try{await navigator.clipboard.writeText(txt);details.textContent="Registro copiado. Pégalo en ChatGPT.";}
      catch{view.value=txt;view.focus();view.select();details.textContent="Selecciona y copia el texto del cuadro."; }
    });
    record("diagnostic-ready");
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount,{once:true});
  else mount();
})();
