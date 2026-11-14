/* OLFX MAINTENANCE — separate the normal loader, confirmed maintenance, and connectivity errors.
   The maintenance flag lives in Supabase and only the privileged Edge Function may change it. */
(()=>{
"use strict";
const $=id=>document.getElementById(id);
const client=()=>typeof supabaseClient!=="undefined"?supabaseClient:null;
const profile=()=>typeof currentUser!=="undefined"?currentUser:null;
let state=null,verified=false,lastError="",changing=false,checkPromise=null,lastRead=0,lastAllowedDuringMaintenance=false;
let startupConnectionFailed=false,initialized=false;
let resolveReady;
const readyPromise=new Promise(resolve=>{resolveReady=resolve;});
const authorized=(p,u)=>{
 if(!p||!u||p.status!=="active"||!u.email_confirmed_at)return false;
 const email=String(u.email||"").trim().toLowerCase();
 return (email==="erickinventus@gmail.com"&&p.role==="admin") ||
        (email==="nolotraderfx@gmail.com"&&p.role==="student");
};
const setHidden=(id,value)=>{const element=$(id);if(element)element.hidden=value;};
function withDeadline(promise,ms=8000){
 let timer;
 return Promise.race([
  Promise.resolve(promise),
  new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("Tiempo de conexión agotado.")),ms);})
 ]).finally(()=>clearTimeout(timer));
}
function connectionNotice(){
 // Remove the legacy false-alarm banner. Connectivity issues are logged and
 // displayed only when a real user action requires a network request.
 $("olonMaintenanceConnectionNotice")?.remove();
}
function displayMaintenance(message){
 const loader=$("olonLoader");if(loader){delete loader.dataset.maintenanceHold;loader.hidden=true;}
 const retry=$("olonLoaderRetry");if(retry)retry.hidden=true;
 startupConnectionFailed=false;
 document.body.classList.remove("olonMaintenancePending","olonMaintenanceOffline","olonMaintenanceAdminLogin");
 document.body.classList.add("olonMaintenanceBlocked");
 setHidden("olonConnectionGate",true);
 setHidden("olonMaintenanceGate",false);
 const label=$("olonMaintenanceStatus");
 if(label)label.textContent=message||"El Portal del Trader está temporalmente en mantenimiento.";
}
function displayConnectionError(){
 // Never trap the entire public website behind a loading overlay when network is unavailable.
 // A failed check cannot authorize a student session, but the sign-in page can remain visible.
 if(state)return; // Preserve the last confirmed maintenance/portal state on transient failures.
 startupConnectionFailed=true;
 document.body.classList.remove("olonMaintenancePending","olonMaintenanceOffline","olonMaintenanceBlocked","olonMaintenanceAdminLogin");
 setHidden("olonConnectionGate",true);
 setHidden("olonMaintenanceGate",true);
 const loader=$("olonLoader");
 if(loader){delete loader.dataset.maintenanceHold;loader.hidden=true;}
 const retry=$("olonLoaderRetry");if(retry)retry.hidden=true;
 const portalOpen=!$("portal")?.classList.contains("hidden");
 if(!portalOpen&&!profile())$("auth")?.classList.remove("hidden");
 if(!portalOpen)connectionNotice(true);
}
function allowPortal(){
 document.body.classList.remove("olonMaintenancePending","olonMaintenanceBlocked","olonMaintenanceOffline","olonMaintenanceAdminLogin");
 setHidden("olonMaintenanceGate",true);
 setHidden("olonConnectionGate",true);
 const loader=$("olonLoader");
 if(loader){delete loader.dataset.maintenanceHold;}
 const retry=$("olonLoaderRetry");
 if(retry)retry.hidden=true;
 connectionNotice(false);
 if($("portal")?.classList.contains("hidden")&&!profile())$("auth")?.classList.remove("hidden");
}
function adminLogin(){
 if(!state?.enabled)return;
 document.body.classList.remove("olonMaintenancePending","olonMaintenanceBlocked","olonMaintenanceOffline");
 document.body.classList.add("olonMaintenanceAdminLogin");
 setHidden("olonMaintenanceGate",true);
 setHidden("olonConnectionGate",true);
 $("auth")?.classList.remove("hidden");
 $("portal")?.classList.add("hidden");
 $("homeAccess")?.scrollIntoView({behavior:"smooth",block:"center"});
 $("loginCode")?.focus();
}
async function read(){
 // This is a PUBLIC boolean status endpoint. Fetch it without acquiring the
 // Supabase Auth session lock, which can be busy during login/MT5 operations.
 const db=client();
 if(!db)throw Error("El cliente de Supabase todavía no está disponible.");
 const base=typeof SUPABASE_URL!=="undefined"?SUPABASE_URL:db.supabaseUrl;
 const key=typeof SUPABASE_KEY!=="undefined"?SUPABASE_KEY:db.supabaseKey;
 if(!base||!key)throw Error("Falta la configuración de conexión.");
 let data=null,primaryError=null;
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),7000);
 try{
  const response=await fetch(base+"/rest/v1/olon_portal_maintenance?select=enabled%2Cupdated_at&id=eq.true&limit=1",{
   method:"GET",headers:{"apikey":key,"Accept":"application/json"},cache:"no-store",signal:controller.signal
  });
  if(!response.ok)throw Error("Estado HTTP "+response.status);
  const rows=await response.json();
  data=Array.isArray(rows)?rows[0]:null;
 }catch(e){primaryError=e;}
 finally{clearTimeout(timer);}
 if(typeof data?.enabled!=="boolean"){
  // Compatibility fallback for old browsers or a REST transport interruption.
  try{
   const result=await withDeadline(db.from("olon_portal_maintenance")
    .select("enabled,updated_at").eq("id",true).single(),5000);
   if(result.error)throw result.error;
   data=result.data;
  }catch(e){
   console.warn("[OLFX mantenimiento] Lectura pública no disponible",primaryError?.message||"fetch",e?.message||"fallback");
   throw Error("No se pudo consultar el estado del portal.");
  }
 }
 if(typeof data?.enabled!=="boolean")throw Error("Respuesta de mantenimiento inválida.");
 state={enabled:data.enabled,updated_at:data.updated_at};
 verified=true;lastError="";lastRead=Date.now();
 return state;
}
function updateAdmin(){
 const badge=$("olonMaintenanceAdminBadge"),button=$("olonMaintenanceToggle");
 const help=$("olonMaintenanceAdminHelp"),feedback=$("olonMaintenanceAdminMessage");
 if(!badge||!button)return;
 badge.textContent=!state?"SIN VERIFICAR":!verified?"SIN CONEXIÓN":state.enabled?"MANTENIMIENTO ACTIVO":"PORTAL ABIERTO";
 badge.dataset.enabled=String(!!state?.enabled);
 badge.dataset.verified=String(verified);
 button.textContent=state?.enabled?"Desactivar mantenimiento · Abrir portal":"Activar mantenimiento · Bloquear estudiantes";
 button.disabled=changing||!verified||!state;
 if(help)help.textContent=!verified
  ?"No se pudo confirmar el estado actual. Usa Actualizar estado cuando vuelva la conexión; no se harán cambios sin confirmación."
  :state.enabled
  ?"Mantenimiento activado en Supabase: solo el administrador principal y la cuenta de prueba autorizada pueden iniciar sesión."
  :"Mantenimiento desactivado en Supabase: el portal permite accesos según sus licencias y permisos.";
 if(lastError&&feedback)feedback.textContent=lastError;
}
async function check(){
 if(changing)return;
 if(checkPromise)return checkPromise;
 checkPromise=(async()=>{
  try{
   const current=await read();
   if(!current.enabled){
    const recoveredFromStartupError=startupConnectionFailed;
    lastAllowedDuringMaintenance=false;
    allowPortal();
    startupConnectionFailed=false;
    // If the initial status read failed, session restoration was deferred.
    // Retry it ONCE after a confirmed open status, never after scroll/focus.
    if(recoveredFromStartupError&&initialized&&!profile()&&
       $("portal")?.classList.contains("hidden")&&typeof window.olonRestoreSession==="function"){
       void window.olonRestoreSession();
    }
    return;
   }
   const db=client();
   const {data,error}=await withDeadline(db.auth.getUser());
   if(error)throw error;
   const user=data?.user||null;
   // Safari and other browsers can briefly return no user while an auth token
   // is being restored/refreshed. A background maintenance poll must NEVER
   // replace an already verified administrator's or test student's workspace
   // with the public landing page merely because of that temporary gap.
   // Supabase still enforces permissions on every private server operation.
   if(!user&&profile()&&lastAllowedDuringMaintenance){
    console.warn("[OLFX mantenimiento] Verificación temporalmente vacía; se conserva la vista autenticada.");
    return;
   }
   let p=null;
   if(user){
    const result=await withDeadline(db.from("profiles").select("role,status").eq("id",user.id).maybeSingle());
    if(result.error)throw result.error;
    p=result.data;
    // A missing profile from a transient RLS/transport read is not a
    // confirmed revocation. Let the next poll retry rather than signing out.
    if(!p&&profile()?.id===user.id){
      throw Error("No se pudo confirmar temporalmente el perfil; sesión preservada.");
    }
   }
   if(authorized(p,user)){
    lastAllowedDuringMaintenance=true;
    allowPortal();
   }else if(!user&&document.body.classList.contains("olonMaintenanceAdminLogin")){
    // An explicit admin-login attempt remains available; guard() validates the signed-in user.
   }else{
    lastAllowedDuringMaintenance=false;
    displayMaintenance("El Portal del Trader está en mantenimiento. Tu información permanece protegida.");
    if(user){
     try{await db.auth.signOut({scope:"local"});}catch{}
     if(typeof currentUser!=="undefined")currentUser=null;
     try{localStorage.removeItem("olon_current_user");}catch{}
     $("portal")?.classList.add("hidden");$("auth")?.classList.remove("hidden");
    }
   }
  }catch(error){
   verified=false;
   lastError="No se pudo actualizar el estado del portal. Comprueba tu conexión y pulsa Actualizar estado.";
   console.warn("[OLFX mantenimiento] Falló la consulta:",error);
   displayConnectionError();
  }finally{
   if(!startupConnectionFailed)document.body.classList.remove("olonMaintenancePending");
   updateAdmin();
  }
 })().finally(()=>{checkPromise=null;});
 return checkPromise;
}
async function guard(p,u){
 try{
  const current=await read();
  if(current.enabled&&!authorized(p,u)){
   lastAllowedDuringMaintenance=false;
   displayMaintenance("El Portal del Trader está en mantenimiento. Tu información permanece protegida.");
   try{await client()?.auth.signOut({scope:"local"});}catch{}
   updateAdmin();
   return false;
  }
  lastAllowedDuringMaintenance=!!current.enabled;
  allowPortal();updateAdmin();return true;
 }catch(error){
  verified=false;
  lastError="No se pudo comprobar el acceso. Revisa tu conexión e inténtalo nuevamente.";
  console.warn("[OLFX mantenimiento] No se pudo validar el acceso:",error);
  // A failed check must never open a special error screen during scrolling.
  // Keep the ordinary portal UI if already verified; otherwise use the existing boot loader.
  displayConnectionError();
  updateAdmin();
  return false;
 }
}
async function toggle(){
 if(changing)return;
 if(checkPromise)await checkPromise;
 if(!verified||!state){lastError="Actualiza el estado antes de cambiar el mantenimiento.";updateAdmin();return;}
 const enable=!state.enabled;
 if(!confirm(enable
  ?"¿Activar mantenimiento en todo el portal? Los estudiantes verán el aviso hasta que lo desactives."
  :"¿Desactivar mantenimiento? El portal volverá a abrir para estudiantes con acceso vigente."))return;
 changing=true;lastError="";updateAdmin();
 const feedback=$("olonMaintenanceAdminMessage");
 if(feedback)feedback.textContent="Guardando y verificando en Supabase…";
 try{
  const db=client();
  const {data:{user},error:authError}=await withDeadline(db.auth.getUser());
  if(authError||!user||String(user.email||"").trim().toLowerCase()!=="erickinventus@gmail.com"||profile()?.role!=="admin")
   throw Error("Solo el administrador principal puede cambiar este ajuste.");
  const {data,error}=await db.functions.invoke("olon-maintenance-control",
   {body:{action:"set-maintenance",enabled:enable}});
  if(error||data?.ok!==true||data?.enabled!==enable)
   throw Error(data?.error||"El servidor no confirmó el cambio. No se actualizó el indicador.");
  state={enabled:data.enabled,updated_at:data.updatedAt};verified=true;lastRead=Date.now();
  // Check the stored value again so a stale UI never pretends a change succeeded.
  const persisted=await read();
  if(persisted.enabled!==enable)throw Error("Supabase devolvió un estado diferente. Pulsa Actualizar estado.");
  if(feedback)feedback.textContent=enable
   ?"Mantenimiento ACTIVADO y confirmado en Supabase."
   :"Mantenimiento DESACTIVADO y confirmado. Portal abierto para accesos vigentes.";
  if(!enable)allowPortal();
 }catch(error){
  lastError=String(error?.message||"No se pudo cambiar el mantenimiento.");
  if(feedback)feedback.textContent="Cambio no confirmado: "+lastError;
  try{await read();}catch{verified=false;}
 }finally{
  changing=false;updateAdmin();
  // Reapply the state to the current session without changing the ordinary loading screen.
  if(verified)void check();
 }
}
async function init(){
 $("olonMaintenanceRetry")?.addEventListener("click",()=>void check());
 $("olonLoaderRetry")?.addEventListener("click",()=>void check());
 $("olonMaintenanceAdminLogin")?.addEventListener("click",adminLogin);
 $("olonMaintenanceToggle")?.addEventListener("click",()=>void toggle());
 $("olonMaintenanceRefresh")?.addEventListener("click",()=>void check());
 try{await check();}
 finally{
  resolveReady();
  initialized=true;
  // The boot screen is only for genuine startup/auth work, never an indefinite error state.
  const loader=$("olonLoader");
  if(loader&&!loader.dataset.managed)loader.hidden=true;
 }
 // Poll independently of scrolling, browser toolbar changes or focus events.
 // Admin toggles still apply immediately, and other sessions see changes shortly.
 setInterval(()=>{if(!document.hidden)void check();},30000);
}
window.olonMaintenance={guard,refresh:check,waitReady:()=>readyPromise,updateAdmin,needsConnection:()=>startupConnectionFailed&&!state,withDeadline};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>void init(),{once:true});
else void init();
})();