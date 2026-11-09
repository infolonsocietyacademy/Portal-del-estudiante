/* OLON Society Academy | Access-request administration.
   A request is not a Supabase Auth account until an admin approves it. */
(function(){
"use strict";
const $=id=>document.getElementById(id);
const API=SUPABASE_URL+"/functions/v1/registration-gateway";
let busy=false;
let loading=false;
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
 $("adminPendingUsers") && ($("adminPendingUsers").textContent=String(pending.length));
 $("adminPendingCountInline") && ($("adminPendingCountInline").textContent=String(pending.length));
 window.olonAccessPendingCount=pending.length;
 if(typeof window.renderAdminAlerts==="function")window.renderAdminAlerts();
 list.innerHTML=pending.length||old.length?pending.map(requestCard).join("")+old.map(requestCard).join(""):
  '<p class="adminRequestEmpty">No hay solicitudes registradas. Cuando alguien complete “Solicita tu acceso”, aparecerá aquí sin necesidad de enviar un correo.</p>';
 list.querySelectorAll("[data-approve]").forEach(btn=>btn.addEventListener("click",()=>approve(btn.dataset.approve)));
 list.querySelectorAll("[data-reject]").forEach(btn=>btn.addEventListener("click",()=>reject(btn.dataset.reject)));
}
function showCredentials(data, isReset=false){
 const dialog=document.createElement("dialog");
 dialog.className="profileDialog traderDialog adminCredentialDialog";
 dialog.setAttribute("aria-label",isReset?"Contraseña asignada":"Credenciales temporales");
 const heading=document.createElement("h3");
 heading.textContent=isReset?"Contraseña asignada":"Cuenta creada";
 const info=document.createElement("p");
 info.textContent=isReset
  ?"Copia esta contraseña para compartirla por privado. El estudiante puede cambiarla desde su cuenta."
  :"Comparte estas credenciales por privado y solicita al estudiante que cambie la contraseña.";
 const email=document.createElement("div");email.className="adminTempField";
 const emailLabel=document.createElement("small");emailLabel.textContent="Correo de acceso";
 const emailText=document.createElement("strong");emailText.textContent=data.email;
 email.append(emailLabel,emailText);
 const pass=document.createElement("div");pass.className="adminTempField";
 const passLabel=document.createElement("small");passLabel.textContent=isReset?"Contraseña nueva":"Contraseña temporal";
 const passText=document.createElement("strong");passText.textContent=data.password;
 pass.append(passLabel,passText);
 const copy=document.createElement("button");copy.type="button";copy.className="btn";copy.textContent=isReset?"Copiar contraseña":"Copiar credenciales";
 copy.addEventListener("click",async()=>{
  const text=isReset?passText.textContent:
    ["OLON Society Academy","Portal del Trader","Correo: "+emailText.textContent,"Contraseña temporal: "+passText.textContent].join("\\n");
  try{await navigator.clipboard.writeText(text);copy.textContent="Copiado";}
  catch{copy.textContent="Selecciona el texto para copiar";}
 });
 const close=document.createElement("button");close.type="button";close.className="btn secondary";
 close.textContent="Cerrar y ocultar contraseña";
 close.addEventListener("click",()=>dialog.close());
 const actions=document.createElement("div");actions.className="profileDialogActions";actions.append(copy,close);
 dialog.addEventListener("close",()=>{passText.textContent="";dialog.remove();},{once:true});
 dialog.append(heading,info,email,pass,actions);
 document.body.append(dialog);
 dialog.showModal();
 close.focus();
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
 $("adminAccountTitle").textContent=mode==="reset"?"Cambiar contraseña":"Eliminar estudiante";
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
 const password=resetForm.elements.namedItem("password").value;
 if(mode==="delete"&&confirmation.value.trim().toLowerCase()!==target.confirmation)return;
 if(mode==="reset"&&(!password.trim()||Array.from(password).length<12||new TextEncoder().encode(password).length>72)){
  accountNote("Usa al menos 12 caracteres y un máximo de 72 bytes.",true);
  return;
 }
 const controls=accountDialog.querySelectorAll("button,input");
 accountBusy=true;
 controls.forEach(control=>{control.disabled=true;});
 accountNote(mode==="delete"?"Eliminando cuenta y archivos…":"Asignando contraseña…");
 try{
  if(mode==="reset"){
   await call("reset_student_password",{id:target.id,password});
   resetForm.reset();
   accountDialog.close();
   showCredentials({email:target.email||target.id,password},true);
   window.olonAdmin?.notify("Contraseña asignada a "+target.name+".");
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
 if(!isAdmin()||busy||loading)return;
 loading=true;
 try{
  const result=await call("list");
  last=Array.isArray(result.requests)?result.requests:[];
  render();
 }catch(e){status("No fue posible consultar las solicitudes: "+String(e.message||e),true);}
 finally{loading=false;}
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
 // Keep new access requests visible without requiring an admin page reload.
 setInterval(()=>{if(!document.hidden&&!section.classList.contains("hidden")&&isAdmin())void refresh();},6000);
}
window.olonRequests={refresh,go,manageAccount};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install);else install();
})();
