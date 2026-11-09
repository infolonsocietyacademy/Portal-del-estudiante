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
 const info=$("olonLicenseLockInfo");if(info)info.textContent=state.phase==="eligible"?"Han transcurrido 30 días desde el vencimiento. Tu cuenta está pendiente de revisión administrativa; tus registros permanecen guardados.":state.phase==="grace"?"Tu licencia venció. Puedes renovarla durante el período de gracia de 30 días sin perder tus datos.":"Tu acceso necesita renovación. Si ya pagaste, pega tu licencia nueva aquí para continuar.";
 if($("olonLicenseMyStatus"))$("olonLicenseMyStatus").textContent=phase(state.phase);
 if($("olonLicenseMyDate"))$("olonLicenseMyDate").textContent=state.expires_at?(state.managed?date(state.expires_at):state.expires_at):"No asignada";
 if($("olonLicenseMyGrace"))$("olonLicenseMyGrace").textContent=state.phase==="grace"?"Días de gracia restantes: "+state.grace_days_remaining:state.phase==="eligible"?"Revisión administrativa requerida":"";
 if(locked)mask?.querySelector("input")?.focus();
}
async function status(){if(busy)return;const u=typeof currentUser!=="undefined"?currentUser:null;if(!u||String(u.role)!=="student")return;busy=true;try{showState(await call("status"));}catch(e){note("olonLicenseStudentFeedback",e.message,true);}finally{busy=false;}}
async function redeem(event){event?.preventDefault();const el=$("olonLicenseCode"),code=String(el?.value||"").trim().toUpperCase();if(!code)return note("olonLicenseStudentFeedback","Introduce tu licencia.",true);const btn=$("olonLicenseRedeem");if(btn)btn.disabled=true;try{const r=await call("redeem",{code});if(el)el.value="";note("olonLicenseStudentFeedback","Licencia activada. Todos tus registros se conservaron.");await status();if(typeof currentUser!=="undefined"&&currentUser){const d=new Date(r.expires_at);const p=Object.fromEntries(new Intl.DateTimeFormat("en-US",{year:"numeric",month:"2-digit",day:"2-digit",timeZone:"America/Puerto_Rico"}).formatToParts(d).map(v=>[v.type,v.value]));currentUser.next_payment_date=p.year+"-"+p.month+"-"+p.day;if(typeof renderVipPayment==="function")renderVipPayment(currentUser);}}catch(e){note("olonLicenseStudentFeedback",e.message,true);}finally{if(btn)btn.disabled=false;}}
async function adminRefresh(){if(adminBusy||typeof currentUser==="undefined"||currentUser?.role!=="admin")return;adminBusy=true;try{const r=await call("list");const list=$("olonLicenseList"),students=$("olonLicenseStudents");
 if(list)list.innerHTML=r.licenses.length?r.licenses.map(l=>'<div class="olonLicenseRow"><span><b>'+l.duration_days+' días / •••'+escape(l.code_hint)+'</b><small>'+escape(l.status)+' · '+date(l.created_at)+'</small></span>'+(l.status==="available"?'<div class="olonLicenseRowActions"><button type="button" class="adminSmallButton" data-license-edit="'+escape(l.id)+'" data-license-days="'+Number(l.duration_days)+'">Editar días</button><button type="button" class="adminSmallButton" data-license-revoke="'+escape(l.id)+'">Revocar</button></div>':'')+'</div>').join(""):"<p>No hay licencias generadas.</p>";
 adminStudents=r.students||[];
 const assign=$("olonLicenseAssign");if(assign){const selected=assign.value;assign.innerHTML='<option value="">Licencia sin asignar</option>'+adminStudents.map(u=>'<option value="'+escape(u.id)+'">'+escape(u.full_name||u.email||"Estudiante")+'</option>').join("");if(adminStudents.some(u=>u.id===selected))assign.value=selected;}
 if(students)students.innerHTML=r.students.map(u=>'<div class="olonLicenseRow"><span><b>'+escape(u.full_name||u.email||"Estudiante")+'</b><small>'+escape(phase(u.phase))+' · '+escape(u.expires_at?(u.managed?date(u.expires_at):u.expires_at):"Sin fecha")+(u.pending_payment?" · Comprobante pendiente":"")+'</small></span>'+(u.phase==="eligible"&&!u.pending_payment?'<button type="button" class="adminSmallButton" data-license-review="'+escape(u.id)+'">Revisar eliminación</button>':'')+'</div>').join("")||"<p>No hay estudiantes.</p>";
 if($("olonLicenseAvailable"))$("olonLicenseAvailable").textContent=r.licenses.filter(l=>l.status==="available").length;
 if($("olonLicenseGrace"))$("olonLicenseGrace").textContent=r.students.filter(s=>["grace","eligible"].includes(s.phase)).length;
 }catch(e){note("olonLicenseAdminFeedback",e.message,true);}finally{adminBusy=false;}}
async function generate(e){e?.preventDefault();const btn=$("olonLicenseGenerate");const d=String($("olonLicenseDays")?.value||"").trim(),days=Number(d);if(!/^\\d{1,3}$/.test(d)||!Number.isInteger(days)||days<1||days>365){note("olonLicenseAdminFeedback","Escribe una duración de 1 a 365 días.",true);return;}if(btn)btn.disabled=true;try{const r=await call("generate",{days,quantity:Number($("olonLicenseQuantity")?.value||1),issued_to:String($("olonLicenseAssign")?.value||"")});generated=r.licenses||[];const out=$("olonGeneratedCodes");if(out){out.hidden=false;out.textContent=generated.map(c=>c.code).join("\n");}note("olonLicenseAdminFeedback","Códigos creados. Cópialos ahora: no volverán a mostrarse completos.");await adminRefresh();}catch(e){note("olonLicenseAdminFeedback",e.message,true);}finally{if(btn)btn.disabled=false;}}
async function editDays(id,previous){
 // Editor visual: el calendario calcula días a partir de hoy en Puerto Rico.
 // La fecha indicada es ilustrativa si el código se activa hoy sin saldo previo.
 const inPR=new Intl.DateTimeFormat("en-US",{timeZone:"America/Puerto_Rico",year:"numeric",month:"2-digit",day:"2-digit"});
 const parts=Object.fromEntries(inPR.formatToParts(new Date()).map(x=>[x.type,x.value]));
 const today=parts.year+"-"+parts.month+"-"+parts.day;
 const parseISO=v=>new Date(v+"T00:00:00Z");
 const addDays=(v,n)=>new Date(parseISO(v).getTime()+n*86400000).toISOString().slice(0,10);
 const diff=v=>Math.round((parseISO(v).getTime()-parseISO(today).getTime())/86400000);
 const max=addDays(today,365);
 let selected=addDays(today,Math.max(1,Math.min(365,Number(previous)||15)));
 let month=selected.slice(0,7);
 const dialog=document.createElement("dialog");
 dialog.className="olonLicenseCalendarDialog";
 dialog.setAttribute("aria-label","Editar días de licencia con calendario");
 dialog.innerHTML='<div class="olonLicenseCalendarInner">'+
  '<div class="olonLicenseCalendarHead"><div><small>OLFX / LICENSE MANAGER</small><h3>Editar días de licencia</h3></div><button type="button" class="olonLicenseCalendarClose" data-cal-close aria-label="Cerrar calendario">×</button></div>'+
  '<p class="olonLicenseCalendarIntro">Selecciona una fecha en el calendario. Se calcularán automáticamente los días de acceso a partir de hoy (hora de Puerto Rico).</p>'+
  '<div class="olonLicenseCalendarNav"><button type="button" data-cal-prev aria-label="Mes anterior">‹</button><strong id="olonLicenseCalendarMonth"></strong><button type="button" data-cal-next aria-label="Mes siguiente">›</button></div>'+
  '<div class="olonLicenseCalendarWeek" aria-hidden="true"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>'+
  '<div class="olonLicenseCalendarGrid" role="grid" aria-label="Días disponibles para la licencia"></div>'+
  '<div class="olonLicenseCalendarSummary"><span>Fecha elegida <b id="olonLicenseCalendarDate"></b></span><span>Duración nueva <b id="olonLicenseCalendarDays"></b></span></div>'+
  '<p class="olonLicenseCalendarHelp">La fecha muestra cuándo vencería si se activa hoy sin días restantes. Si el estudiante aún tiene días pagados, se acumularán. Al editar, el código anterior será reemplazado por uno nuevo.</p>'+
  '<p class="olonLicenseCalendarError" role="alert" hidden></p>'+
  '<div class="olonLicenseCalendarActions"><button type="button" class="adminSmallButton" data-cal-close>Cancelar</button><button type="button" class="btn" data-cal-save>Guardar y generar nuevo código</button></div>'+
  '</div>';
 document.body.append(dialog);
 const q=selector=>dialog.querySelector(selector);
 const monthFmt=new Intl.DateTimeFormat("es-PR",{month:"long",year:"numeric",timeZone:"UTC"});
 const dayFmt=new Intl.DateTimeFormat("es-PR",{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"});
 const error=q(".olonLicenseCalendarError");
 const showError=message=>{error.hidden=!message;error.textContent=message||"";};
 function renderCalendar(){
  const [y,m]=month.split("-").map(Number);
  q("#olonLicenseCalendarMonth").textContent=monthFmt.format(new Date(Date.UTC(y,m-1,1)));
  const startDay=(new Date(Date.UTC(y,m-1,1)).getUTCDay()+6)%7;
  const daysInMonth=new Date(Date.UTC(y,m,0)).getUTCDate();
  const grid=q(".olonLicenseCalendarGrid");
  grid.innerHTML="";
  for(let k=0;k<startDay;k++){const filler=document.createElement("span");filler.className="olonLicenseCalendarBlank";grid.append(filler);}
  for(let d=1;d<=daysInMonth;d++){
   const iso=month+"-"+String(d).padStart(2,"0"),possible=iso>today&&iso<=max;
   const btn=document.createElement("button");
   btn.type="button";btn.className="olonLicenseCalendarDay";
   btn.textContent=String(d);btn.dataset.date=iso;btn.disabled=!possible;
   btn.setAttribute("aria-label",dayFmt.format(parseISO(iso)));
   btn.setAttribute("aria-selected",String(iso===selected));
   if(iso===selected)btn.classList.add("selected");
   if(iso===today)btn.classList.add("today");
   grid.append(btn);
  }
  q("#olonLicenseCalendarDate").textContent=dayFmt.format(parseISO(selected));
  q("#olonLicenseCalendarDays").textContent=diff(selected)+" días";
  q("[data-cal-prev]").disabled=month<=today.slice(0,7);
  q("[data-cal-next]").disabled=month>=max.slice(0,7);
  q("[data-cal-save]").disabled=diff(selected)===Number(previous);
 }
 q("[data-cal-prev]").addEventListener("click",()=>{month=addDays(month+"-01",-1).slice(0,7);renderCalendar();});
 q("[data-cal-next]").addEventListener("click",()=>{const [y,m]=month.split("-").map(Number);month=new Date(Date.UTC(y,m,1)).toISOString().slice(0,7);renderCalendar();});
 q(".olonLicenseCalendarGrid").addEventListener("click",event=>{
  const button=event.target.closest("button[data-date]");
  if(!button||button.disabled)return;
  selected=button.dataset.date;showError("");renderCalendar();
 });
 dialog.querySelectorAll("[data-cal-close]").forEach(button=>button.addEventListener("click",()=>dialog.close()));
 q("[data-cal-save]").addEventListener("click",async()=>{
  const days=diff(selected),save=q("[data-cal-save]");
  if(!Number.isInteger(days)||days<1||days>365){showError("Selecciona una fecha entre mañana y los próximos 365 días.");return;}
  if(days===Number(previous)){showError("Selecciona una fecha diferente para modificar la licencia.");return;}
  save.disabled=true;showError("");
  try{
   const result=await call("edit_days",{id,days});
   generated=[{id,code:result.code,days}];
   const out=$("olonGeneratedCodes");
   if(out){out.hidden=false;out.textContent=result.code;}
   dialog.close();
   note("olonLicenseAdminFeedback","Licencia actualizada a "+days+" días. Copia el código nuevo ahora; el anterior fue invalidado.");
   await adminRefresh();
  }catch(e){showError(e.message||"No se pudo editar la licencia.");save.disabled=false;}
 });
 dialog.addEventListener("close",()=>dialog.remove(),{once:true});
 renderCalendar();
 if(typeof dialog.showModal==="function")dialog.showModal();else dialog.setAttribute("open","");
}
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
 $("olonLicenseList")?.addEventListener("click",e=>{const edit=e.target.closest("[data-license-edit]");if(edit){void editDays(edit.dataset.licenseEdit,edit.dataset.licenseDays);return;}const id=e.target.closest("[data-license-revoke]")?.dataset.licenseRevoke;if(id)void revoke(id);});
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