/* OLFX MAINTENANCE: state persisted in Supabase; toggle authorized server-side. */
(()=>{
"use strict";
const $=id=>document.getElementById(id);
let state=null,busy=false,lastRead=0;
let ready;const readyPromise=new Promise(resolve=>ready=resolve);
const client=()=>typeof supabaseClient!=="undefined"?supabaseClient:null;
const profile=()=>typeof currentUser!=="undefined"?currentUser:null;
const permitted=(p,u)=>!!p&&!!u&&p.role==="admin"&&p.status==="active"&&
 String(u.email||"").toLowerCase()==="nolotraderfx@gmail.com"&&!!u.email_confirmed_at;
function block(reason){
 document.body.classList.remove("olonMaintenancePending","olonMaintenanceAdminLogin");
 document.body.classList.add("olonMaintenanceBlocked");
 $("portal")?.classList.add("hidden");$("auth")?.classList.add("hidden");
 const gate=$("olonMaintenanceGate");if(gate)gate.hidden=false;
 const label=$("olonMaintenanceStatus");if(label)label.textContent=reason||"Acceso temporalmente suspendido por mantenimiento.";
}
function clear(){
 document.body.classList.remove("olonMaintenancePending","olonMaintenanceBlocked","olonMaintenanceAdminLogin");
 const gate=$("olonMaintenanceGate");if(gate)gate.hidden=true;
 if(!profile())$("auth")?.classList.remove("hidden");
}
function adminLogin(){
 $("olonMaintenanceGate").hidden=true;
 document.body.classList.remove("olonMaintenancePending","olonMaintenanceBlocked");
 document.body.classList.add("olonMaintenanceAdminLogin");
 $("auth")?.classList.remove("hidden");$("portal")?.classList.add("hidden");
 $("homeAccess")?.scrollIntoView({behavior:"smooth",block:"center"});
 $("loginCode")?.focus();
}
async function read(force=false){
 if(!force&&state&&Date.now()-lastRead<6000)return state;
 const db=client();if(!db)throw Error("Sin conexión con Supabase");
 const {data,error}=await db.from("olon_portal_maintenance").select("enabled,updated_at").eq("id",true).single();
 if(error||typeof data?.enabled!=="boolean")throw Error("Estado de mantenimiento no disponible");
 state=data;lastRead=Date.now();return state;
}
async function guard(p,u){
 try{
  const current=await read(true);
  if(current.enabled&&!permitted(p,u)){
   block("Acceso temporalmente suspendido durante las mejoras del portal.");
   try{await client()?.auth.signOut({scope:"local"});}catch{}
   return false;
  }
  clear();return true;
 }catch{
  block("No se pudo verificar el acceso. Comprueba internet y pulsa Reintentar.");
  return false;
 }
}
function updateAdmin(){
 const status=$("olonMaintenanceAdminBadge"),button=$("olonMaintenanceToggle"),help=$("olonMaintenanceAdminHelp");
 if(!status||!button)return;
 status.textContent=!state?"COMPROBANDO":state.enabled?"MANTENIMIENTO ACTIVO":"PORTAL ABIERTO";
 status.dataset.enabled=String(!!state?.enabled);
 button.textContent=state?.enabled?"Desactivar mantenimiento · Abrir portal":"Activar mantenimiento · Bloquear estudiantes";
 if(help)help.textContent=state?.enabled
  ?"Los estudiantes ven el aviso de mantenimiento. Solo tu cuenta autorizada puede entrar."
  :"El acceso funciona normalmente según los permisos y licencias de cada estudiante.";
}
async function check(){
 if(busy)return;
 busy=true;
 try{
  const current=await read(true),db=client();
  const {data:{user},error}=await db.auth.getUser();
  let p=null;
  if(!error&&user){
   const result=await db.from("profiles").select("role,status").eq("id",user.id).maybeSingle();
   if(!result.error)p=result.data;
  }
  if(current.enabled&&!permitted(p,user)){
   block("El Portal del Trader está temporalmente en mantenimiento. Tu información permanece protegida.");
   if(user)try{await db.auth.signOut({scope:"local"});}catch{}
  }else clear();
  updateAdmin();
 }catch{block("No pudimos verificar el estado del portal. Pulsa Reintentar.");}
 finally{document.body.classList.remove("olonMaintenancePending");busy=false;}
}
async function toggle(){
 if(busy||!state)return;
 const enable=!state.enabled;
 if(!confirm(enable
  ?"¿Activar mantenimiento? El acceso estudiantil se suspenderá temporalmente."
  :"¿Desactivar mantenimiento? Los estudiantes podrán entrar con sus accesos vigentes."))return;
 const button=$("olonMaintenanceToggle"),status=$("olonMaintenanceAdminMessage");
 if(button)button.disabled=true;
 if(status)status.textContent="Actualizando estado…";
 try{
  const {data,error}=await client().functions.invoke("olon-maintenance-control",{body:{action:"set-maintenance",enabled:enable}});
  if(error||!data?.ok)throw Error(data?.error||"El servidor no confirmó el cambio.");
  state={enabled:data.enabled,updated_at:data.updatedAt};lastRead=Date.now();
  updateAdmin();
  if(status)status.textContent=enable?"Modo mantenimiento activado.":"Portal abierto nuevamente para los estudiantes.";
 }catch(e){
  if(status)status.textContent=String(e.message||e);
  try{await read(true);}catch{}
  updateAdmin();
 }finally{if(button)button.disabled=false;}
}
async function init(){
 $("olonMaintenanceRetry")?.addEventListener("click",()=>void check());
 $("olonMaintenanceAdminLogin")?.addEventListener("click",adminLogin);
 $("olonMaintenanceToggle")?.addEventListener("click",()=>void toggle());
 $("olonMaintenanceRefresh")?.addEventListener("click",()=>void check());
 await check();ready();
 window.addEventListener("focus",()=>void check());
 document.addEventListener("visibilitychange",()=>{if(!document.hidden)void check();});
 setInterval(()=>{if(!document.hidden)void check();},15000);
}
window.olonMaintenance={guard,refresh:check,waitReady:()=>readyPromise,updateAdmin};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>void init(),{once:true});
else void init();
})();