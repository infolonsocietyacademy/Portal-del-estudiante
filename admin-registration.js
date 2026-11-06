/* OLON Society Academy | Access-request administration.
   A request is not a Supabase Auth account until an admin approves it. */
(function(){
"use strict";
const $=id=>document.getElementById(id);
const API="https://xanhhfashgkyrvphprts.supabase.co/functions/v1/registration-gateway";
const KEY="sb_publishable_JQ9TWOn3GvY2nTth0JLHIQ_AtTgwz8B";
let busy=false;
let last=[];
const safe=t=>String(t==null?"":t).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function isAdmin(){
 try{return !!currentUser&&String(currentUser.role).toLowerCase()==="admin"&&String(currentUser.status).toLowerCase()==="active";}
 catch{return false;}
}
function status(text,isError=false){
 const node=$("adminRequestsFeedback");if(!node)return;
 node.hidden=false;node.className="adminActionFeedback "+(isError?"error":"success");node.textContent=text;
}
async function call(action,data={}){
 let token="";
 if(action!=="apply"){
  const {data:session,error}=await supabaseClient.auth.getSession();
  if(error||!session?.session?.access_token)throw new Error("Tu sesión expiró. Vuelve a iniciar sesión como administrador.");
  token=session.session.access_token;
 }
 const response=await fetch(API,{method:"POST",
  headers:{"Content-Type":"application/json","apikey":KEY,...(token?{Authorization:"Bearer "+token}:{})},
  body:JSON.stringify({action,...data})});
 const payload=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(String(payload.error||"No se pudo conectar con el servidor."));
 return payload;
}
function date(v){
 const d=new Date(String(v||""));
 return Number.isFinite(d.getTime())?d.toLocaleString("es-PR",{dateStyle:"medium",timeStyle:"short"}):"—";
}
function requestCard(r){
 const name=safe(r.full_name||"Sin nombre"),email=safe(r.email||"");
 const id=safe(r.id||"");
 if(r.status!=="pending")return '<article class="adminRequestRow processed"><div><b>'+name+'</b><small>'+email+'</small><span>'+date(r.created_at)+'</span></div><span class="adminRequestStatus">Procesada</span></article>';
 return '<article class="adminRequestRow"><div class="adminRequestIdentity"><b>'+name+'</b><small>'+email+'</small><span>Solicitó acceso: '+date(r.created_at)+'</span></div><div class="adminRequestActions">'+
  '<span class="adminRequestStatus">Membresía VIP</span>'+
  '<button type="button" class="adminSmallButton approve" data-approve="'+id+'">✓ Crear cuenta</button>'+
  '<button type="button" class="adminSmallButton" data-reject="'+id+'">Rechazar</button></div></article>';
}
function render(){
 const list=$("adminRequestsList");
 if(!list)return;
 const pending=last.filter(r=>r.status==="pending");
 const old=last.filter(r=>r.status==="processed").slice(0,10);
 $("adminRequestCount") && ($("adminRequestCount").textContent=String(pending.length));
 $("adminRequestsNavCount") && ($("adminRequestsNavCount").textContent=String(pending.length));
 list.innerHTML=pending.length||old.length?pending.map(requestCard).join("")+old.map(requestCard).join(""):
  '<p class="adminRequestEmpty">No hay solicitudes registradas. Cuando alguien complete “Solicita tu acceso”, aparecerá aquí sin necesidad de enviar un correo.</p>';
 list.querySelectorAll("[data-approve]").forEach(btn=>btn.addEventListener("click",()=>approve(btn.dataset.approve)));
 list.querySelectorAll("[data-reject]").forEach(btn=>btn.addEventListener("click",()=>reject(btn.dataset.reject)));
}
function showCredentials(data){
 // Credentials exist only in memory and this modal. Never store or log them.
 const overlay=document.createElement("div");overlay.className="adminTempOverlay";overlay.setAttribute("role","presentation");
 const dialog=document.createElement("div");dialog.className="adminTempDialog";dialog.setAttribute("role","dialog");
 dialog.setAttribute("aria-modal","true");dialog.setAttribute("aria-label","Credenciales temporales");
 const heading=document.createElement("h3");heading.textContent="Cuenta creada correctamente";
 const info=document.createElement("p");info.textContent="Esta contraseña temporal se mostrará una sola vez. Compártela de forma privada y solicita al estudiante que la cambie. La propiedad del correo aún debe verificarse por separado.";
 const email=document.createElement("div");email.className="adminTempField";
 const emailLabel=document.createElement("small");emailLabel.textContent="Correo de acceso";
 const emailText=document.createElement("strong");emailText.textContent=data.email;
 email.append(emailLabel,emailText);
 const pass=document.createElement("div");pass.className="adminTempField";
 const passLabel=document.createElement("small");passLabel.textContent="Contraseña temporal";
 const passText=document.createElement("strong");passText.textContent=data.password;
 pass.append(passLabel,passText);
 const copy=document.createElement("button");copy.type="button";copy.className="adminBtn adminBtnGold";copy.textContent="Copiar credenciales";
 copy.addEventListener("click",()=>{const txt="OLON Society Academy\nPortal del Estudiante\nCorreo: "+data.email+"\nContraseña temporal: "+data.password+"\nCambia la contraseña al entrar.";if(navigator.clipboard?.writeText){navigator.clipboard.writeText(txt).then(()=>{copy.textContent="✓ Copiado";}).catch(()=>{copy.textContent="Selecciona el texto para copiar";});}else{copy.textContent="Selecciona el texto para copiar";}});
 const close=document.createElement("button");close.type="button";close.className="adminBtn adminBtnOutline";close.textContent="Cerrar y ocultar contraseña";
 close.addEventListener("click",()=>{passText.textContent="";overlay.remove();});
 const actions=document.createElement("div");actions.className="adminTempActions";actions.append(copy,close);
 dialog.append(heading,info,email,pass,actions);overlay.append(dialog);document.body.append(overlay);close.focus();
}
async function refresh(){
 if(!isAdmin()||busy)return;
 try{
  const result=await call("list");
  last=Array.isArray(result.requests)?result.requests:[];
  render();
 }catch(e){status("No fue posible consultar las solicitudes: "+String(e.message||e),true);}
}
async function approve(id){
 if(!isAdmin()||busy)return;
 const target=last.find(r=>r.id===id&&r.status==="pending");
 if(!target)return;
 if(!window.confirm("¿Crear y activar una cuenta para "+target.full_name+" ("+target.email+")?\nConfirma que el solicitante controla ese correo. Se generará una contraseña temporal visible solo ahora."))return;
 busy=true;
 try{
  const result=await call("approve",{id});
  status("Cuenta de "+target.full_name+" creada y activada. Guarda sus credenciales temporales antes de cerrar.");
  showCredentials(result);
 }catch(e){status("No se pudo crear esta cuenta: "+String(e.message||e),true);}
 finally{busy=false;await refresh();if(window.olonAdmin?.refresh)void window.olonAdmin.refresh().catch(()=>{});}
}
async function reject(id){
 if(!isAdmin()||busy)return;
 const target=last.find(r=>r.id===id&&r.status==="pending");
 if(!target||!window.confirm("¿Rechazar la solicitud de "+target.full_name+"?"))return;
 busy=true;
 try{await call("reject",{id});status("Solicitud rechazada.");}
 catch(e){status("No se pudo rechazar: "+String(e.message||e),true);}
 finally{busy=false;await refresh();}
}
function go(){
 if(!isAdmin())return;
 const target=$("adminRequestsBlock");if(!target)return;
 if($("admin")?.classList.contains("hidden")&&window.showPage)window.showPage("admin",document.querySelector(".adminNav[data-page='admin']"));
 target.scrollIntoView({behavior:"smooth",block:"start"});
 void refresh();
}
function install(){
 const section=$("admin");
 if(!section)return;
 const observer=new MutationObserver(()=>{if(!section.classList.contains("hidden")&&isAdmin())void refresh();});
 observer.observe(section,{attributes:true,attributeFilter:["class"]});
 if(!section.classList.contains("hidden"))void refresh();
 document.addEventListener("visibilitychange",()=>{if(!document.hidden&&!section.classList.contains("hidden"))void refresh();});
}
window.olonRequests={refresh,go};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install);else install();
})();
