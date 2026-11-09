/* OLON Society Academy | Access-request administration.
   A request is not a Supabase Auth account until an admin approves it. */
(function(){
"use strict";
const $=id=>document.getElementById(id);
const API=SUPABASE_URL+"/functions/v1/registration-gateway";
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
  if(action!=="list"){
   const {freshAdminTotp}=await import("./security/auth.mjs?v=1");
   if(!await freshAdminTotp(supabaseClient))throw Error("Verificación cancelada.");
  }
  const {data:session,error}=await supabaseClient.auth.getSession();
  if(error||!session?.session?.access_token)throw new Error("Tu sesión expiró. Vuelve a iniciar sesión como administrador.");
  token=session.session.access_token;
 }
 const response=await fetch(API,{method:"POST",
  headers:{"Content-Type":"application/json","apikey":SUPABASE_KEY,...(token?{Authorization:"Bearer "+token}:{})},
  body:JSON.stringify({action,...data})});
 const payload=await response.json().catch(()=>({}));
 if(!response.ok)throw Object.assign(new Error(String(payload.error||"No se pudo conectar con el servidor.")),{pending:payload.pending===true});
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
const accountDialog=$("adminAccountDialog");
const resetForm=$("adminResetForm");
const deleteForm=$("adminDeleteForm");
const confirmation=deleteForm.elements.namedItem("confirmation");
const deleteButton=deleteForm.querySelector("button[type=submit]");
let account=null, accountBusy=false;

function accountNote(text="",error=false){
 const feedback=$("adminAccountFeedback");
 feedback.textContent=text;
 feedback.hidden=!text;
 feedback.dataset.error=String(error);
}

function syncDelete(){
 deleteButton.disabled=accountBusy||!account||confirmation.value.trim().toLowerCase()!==account.confirmation;
}

function manageAccount(student,mode){
 if(!isAdmin()||accountDialog.open||accountBusy||!["delete","reset"].includes(mode))return;
 const email=String(student.email||"").trim().toLowerCase();
 const hasEmail=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&email.length<=254;
 if(mode==="reset"&&student.status==="deleting")return;
 account={id:student.id,name:student.full_name||"Estudiante",email,confirmation:hasEmail?email:student.id};
 resetForm.reset();
 deleteForm.reset();
 resetForm.hidden=mode!=="reset";
 deleteForm.hidden=mode!=="delete";
 $("adminAccountTitle").textContent=mode==="reset"?"Enviar recuperación":"Eliminar estudiante";
 $("adminAccountIdentity").textContent=account.name+" · "+account.confirmation;
 $("adminDeleteConfirmationLabel").textContent=hasEmail?"Escribe el correo del estudiante para confirmar":"Escribe el ID del estudiante para confirmar";
 confirmation.inputMode=hasEmail?"email":"text";
 syncDelete();
 accountNote();
 accountDialog.showModal();
}

async function runAccountAction(event,mode){
 event.preventDefault();
 if(!isAdmin()||!account||accountBusy)return;
 const target=account;
 if(mode==="delete"&&confirmation.value.trim().toLowerCase()!==target.confirmation)return;
 const controls=accountDialog.querySelectorAll("button,input");
 accountBusy=true;
 controls.forEach(control=>{control.disabled=true;});
 accountNote(mode==="delete"?"Eliminando cuenta y archivos…":"Solicitando correo de recuperación…");
 try{
  if(mode==="reset"){
   await call("send_student_recovery",{id:target.id});
   resetForm.reset();
   accountDialog.close();
   window.olonAdmin?.notify("Supabase aceptó la solicitud de recuperación para "+target.name+".");
  }else{
   await call("delete_student",{id:target.id,confirmation:target.confirmation});
   accountDialog.close();
   await window.olonAdmin?.refresh().catch(()=>{});
   window.olonAdmin?.notify("Se eliminó la cuenta de "+target.name+".");
  }
 }catch(error){
  accountNote(error.message||"No se pudo completar la operación.",true);
  if(mode==="delete"&&error.pending)void window.olonAdmin?.refresh().catch(()=>{});
 }finally{
  accountBusy=false;
  controls.forEach(control=>{control.disabled=false;});
  syncDelete();
 }
}

confirmation.addEventListener("input",syncDelete);
resetForm.addEventListener("submit",event=>void runAccountAction(event,"reset"));
deleteForm.addEventListener("submit",event=>void runAccountAction(event,"delete"));
accountDialog.addEventListener("click",event=>{
 if(event.target.closest("[data-close-admin-account]")&&!accountBusy)accountDialog.close();
});
accountDialog.addEventListener("cancel",event=>{if(accountBusy)event.preventDefault();});
accountDialog.addEventListener("close",()=>{
 if(accountDialog.open)return;
 resetForm.reset();
 deleteForm.reset();
 account=null;
 accountNote();
});
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
 if(!window.confirm("¿Crear y activar una cuenta para "+target.full_name+" ("+target.email+")?\nSupabase enviará una invitación al correo del solicitante."))return;
 busy=true;
 try{
  await call("approve",{id});
  status("Invitación de "+target.full_name+" aceptada para envío por Supabase.");
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
window.olonRequests={refresh,go,manageAccount};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install);else install();
})();
