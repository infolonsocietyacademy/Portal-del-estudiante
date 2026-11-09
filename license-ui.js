/* OLFX LICENSE MANAGER: secure gateway, student redemption, admin console */
(function(){
"use strict";
const $=id=>document.getElementById(id);
const escape=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const endpoint=()=>SUPABASE_URL+"/functions/v1/olon-license-manager";
let busy=false,adminBusy=false,generated=[],current=null,adminStudents=[];
async function call(action,data={}){
 const {data:session,error}=await supabaseClient.auth.getSession();
 if(error||!session?.session?.access_token)throw Error("Tu sesión expiró. Inicia sesión nuevamente.");
 const response=await fetch(endpoint(),{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json",apikey:SUPABASE_KEY,Authorization:"Bearer "+session.session.access_token},body:JSON.stringify({action,...data})});
 const body=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(body.error||"No se pudo consultar las licencias.");
 return body;
}
const date=v=>{if(!v)return "Sin fecha";const d=new Date(v);return Number.isFinite(+d)?d.toLocaleString("es-PR",{timeZone:"America/Puerto_Rico",dateStyle:"medium",timeStyle:"short"}):String(v)};
const phase=v=>({active:"Activa",grace:"Vencida / 30 días de gracia",eligible:"Revisión de eliminación",legacy:"Acceso anterior",legacy_due:"Renovación pendiente"})[v]||v;
function note(id,text,isError=false){const el=$(id);if(!el)return;el.hidden=!text;el.textContent=text||"";el.dataset.error=isError?"true":"false";}
function showState(state){
 current=state;const locked=["legacy_due","grace","eligible"].includes(state.phase);
 const mask=$("olonLicenseLock");if(mask){mask.hidden=!locked;document.body.classList.toggle("olonLicenseLocked",locked);}
 const title=$("olonLicenseLockHeading");if(title)title.textContent=state.phase==="eligible"?"Membresía pendiente de revisión":"Renueva tu acceso VIP";
 const info=$("olonLicenseLockInfo");if(info)info.textContent=state.phase==="eligible"?"Han transcurrido 30 días desde el vencimiento. Tu cuenta está pendiente de revisión administrativa; tus registros permanecen guardados.":state.phase==="grace"?"Tu licencia venció. Puedes renovarla durante el período de gracia de 30 días sin perder tus datos.":"Tu fecha de renovación llegó. Introduce tu primera licencia VIP para continuar.";
 if($("olonLicenseMyStatus"))$("olonLicenseMyStatus").textContent=phase(state.phase);
 if($("olonLicenseMyDate"))$("olonLicenseMyDate").textContent=state.expires_at?(state.managed?date(state.expires_at):state.expires_at):"No asignada";
 if($("olonLicenseMyGrace"))$("olonLicenseMyGrace").textContent=state.phase==="grace"?"Días de gracia restantes: "+state.grace_days_remaining:state.phase==="eligible"?"Revisión administrativa requerida":"";
 if(locked)mask?.querySelector("input")?.focus();
}
async function status(){if(busy)return;const u=typeof currentUser!=="undefined"?currentUser:null;if(!u||String(u.role)!=="student")return;busy=true;try{showState(await call("status"));}catch(e){note("olonLicenseStudentFeedback",e.message,true);}finally{busy=false;}}
async function redeem(event){event?.preventDefault();const el=$("olonLicenseCode"),code=String(el?.value||"").trim().toUpperCase();if(!code)return note("olonLicenseStudentFeedback","Introduce tu licencia.",true);const btn=$("olonLicenseRedeem");if(btn)btn.disabled=true;try{const r=await call("redeem",{code});if(el)el.value="";note("olonLicenseStudentFeedback","Licencia activada. Todos tus registros se conservaron.");await status();if(typeof currentUser!=="undefined"&&currentUser){const d=new Date(r.expires_at);const p=Object.fromEntries(new Intl.DateTimeFormat("en-US",{year:"numeric",month:"2-digit",day:"2-digit",timeZone:"America/Puerto_Rico"}).formatToParts(d).map(v=>[v.type,v.value]));currentUser.next_payment_date=p.year+"-"+p.month+"-"+p.day;if(typeof renderVipPayment==="function")renderVipPayment(currentUser);}}catch(e){note("olonLicenseStudentFeedback",e.message,true);}finally{if(btn)btn.disabled=false;}}
async function adminRefresh(){if(adminBusy||typeof currentUser==="undefined"||currentUser?.role!=="admin")return;adminBusy=true;try{const r=await call("list");const list=$("olonLicenseList"),students=$("olonLicenseStudents");
 if(list)list.innerHTML=r.licenses.length?r.licenses.map(l=>'<div class="olonLicenseRow"><span><b>'+l.duration_days+' días / •••'+escape(l.code_hint)+'</b><small>'+escape(l.status)+' · '+date(l.created_at)+'</small></span>'+(l.status==="available"?'<button type="button" class="adminSmallButton" data-license-revoke="'+escape(l.id)+'">Revocar</button>':'')+'</div>').join(""):"<p>No hay licencias generadas.</p>";
 adminStudents=r.students||[];
 const assign=$("olonLicenseAssign");if(assign){const selected=assign.value;assign.innerHTML='<option value="">Licencia sin asignar</option>'+adminStudents.map(u=>'<option value="'+escape(u.id)+'">'+escape(u.full_name||u.email||"Estudiante")+'</option>').join("");if(adminStudents.some(u=>u.id===selected))assign.value=selected;}
 if(students)students.innerHTML=r.students.map(u=>'<div class="olonLicenseRow"><span><b>'+escape(u.full_name||u.email||"Estudiante")+'</b><small>'+escape(phase(u.phase))+' · '+escape(u.expires_at?(u.managed?date(u.expires_at):u.expires_at):"Sin fecha")+(u.pending_payment?" · Comprobante pendiente":"")+'</small></span>'+(u.phase==="eligible"&&!u.pending_payment?'<button type="button" class="adminSmallButton" data-license-review="'+escape(u.id)+'">Revisar eliminación</button>':'')+'</div>').join("")||"<p>No hay estudiantes.</p>";
 if($("olonLicenseAvailable"))$("olonLicenseAvailable").textContent=r.licenses.filter(l=>l.status==="available").length;
 if($("olonLicenseGrace"))$("olonLicenseGrace").textContent=r.students.filter(s=>["grace","eligible"].includes(s.phase)).length;
 }catch(e){note("olonLicenseAdminFeedback",e.message,true);}finally{adminBusy=false;}}
async function generate(e){e?.preventDefault();const btn=$("olonLicenseGenerate");if(btn)btn.disabled=true;try{const r=await call("generate",{days:Number($("olonLicenseDays")?.value||15),quantity:Number($("olonLicenseQuantity")?.value||1),issued_to:String($("olonLicenseAssign")?.value||"")});generated=r.licenses||[];const out=$("olonGeneratedCodes");if(out){out.hidden=false;out.textContent=generated.map(c=>c.code).join("\n");}note("olonLicenseAdminFeedback","Códigos creados. Cópialos ahora: no volverán a mostrarse completos.");await adminRefresh();}catch(e){note("olonLicenseAdminFeedback",e.message,true);}finally{if(btn)btn.disabled=false;}}
async function revoke(id){if(!confirm("¿Revocar esta licencia sin utilizar?"))return;try{await call("revoke",{id});await adminRefresh();note("olonLicenseAdminFeedback","Licencia revocada.");}catch(e){note("olonLicenseAdminFeedback",e.message,true);}}
function init(){
 $("olonLicenseRedeem")?.addEventListener("click",redeem);
 $("olonLicenseLockRedeem")?.addEventListener("click",async()=>{const source=$("olonLicenseLockCode");const target=$("olonLicenseCode");if(target)target.value=source?.value||"";await redeem();const feedback=$("olonLicenseLockFeedback");if(feedback)feedback.textContent=$("olonLicenseStudentFeedback")?.textContent||"";if(source&&current?.phase==="active")source.value="";});
 $("olonLicenseLockCode")?.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();$("olonLicenseLockRedeem")?.click();}});
 $("olonLicenseLockLogout")?.addEventListener("click",()=>window.logout?.());
 $("olonLicenseCode")?.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();void redeem();}});
 $("olonLicenseGenerate")?.addEventListener("click",generate);
 $("olonLicenseRefresh")?.addEventListener("click",adminRefresh);
 $("olonLicenseCopy")?.addEventListener("click",async()=>{if(!generated.length)return;try{await navigator.clipboard.writeText(generated.map(x=>x.code).join("\n"));note("olonLicenseAdminFeedback","Códigos copiados.");}catch{note("olonLicenseAdminFeedback","Selecciona y copia los códigos manualmente.",true);}});
 $("olonLicenseList")?.addEventListener("click",e=>{const id=e.target.closest("[data-license-revoke]")?.dataset.licenseRevoke;if(id)void revoke(id);});
 $("olonLicenseStudents")?.addEventListener("click",e=>{const id=e.target.closest("[data-license-review]")?.dataset.licenseReview;const person=adminStudents.find(u=>u.id===id&&u.phase==="eligible"&&!u.pending_payment);if(person)window.olonRequests?.manageAccount(person,"delete");});
 const admin=$("admin");if(admin)new MutationObserver(()=>{if(!admin.classList.contains("hidden")&&currentUser?.role==="admin")void adminRefresh();}).observe(admin,{attributes:true,attributeFilter:["class"]});
 const portal=$("portal");if(portal)new MutationObserver(()=>{if(portal.classList.contains("hidden")){generated=[];const codes=$("olonGeneratedCodes");if(codes){codes.textContent="";codes.hidden=true;}document.body.classList.remove("olonLicenseLocked");}else if(currentUser?.role==="student")void status();}).observe(portal,{attributes:true,attributeFilter:["class"]});
 document.addEventListener("visibilitychange",()=>{if(!document.hidden&&currentUser?.role==="student")void status();});
 window.addEventListener("focus",()=>{if(currentUser?.role==="student")void status();});
 window.olonLicense={refresh:status,adminRefresh};
 if(currentUser?.role==="student"&&!portal?.classList.contains("hidden"))void status();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();