/* OLFX LICENSE MANAGER: secure gateway, student redemption, admin console */
(function(){
"use strict";
const $=id=>document.getElementById(id);
const escape=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const endpoint=()=>SUPABASE_URL+"/functions/v1/olon-license-manager";
let busy=false,adminBusy=false,generated=[],current=null,adminStudents=[],allLicenses=[];
let lastStatusAt=0,lastStudentId=null,activeStatusPromise=null;
function showGenerated(codes){generated=codes||[];const input=$("olonGeneratedCodes"),panel=$("olonLicenseResult");if(input)input.value=generated.map(x=>x.code).join("\n");if(panel)panel.hidden=!generated.length;const btn=$("olonLicenseCopy");if(btn)btn.disabled=!generated.length;}
async function copyCodes(){const text=generated.map(x=>x.code).join("\n"),input=$("olonGeneratedCodes");if(!text)return note("olonLicenseAdminFeedback","Genera primero una licencia.",true);let ok=false;try{if(window.isSecureContext&&navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);ok=true;}}catch(_){ }if(!ok&&input){input.focus();input.select();input.setSelectionRange(0,input.value.length);try{ok=document.execCommand("copy")===true;}catch(_){ }}note("olonLicenseAdminFeedback",ok?"Licencia copiada al portapapeles.":"Licencia seleccionada. Presiona Ctrl+C para copiar.",!ok);}
async function revealLicense(id){try{const r=await call("reveal",{id});if(r.legacy){const legacy=allLicenses.find(x=>x.id===id);if(legacy?.status==="available"&&legacy.issued_to){if(confirm("Esta licencia antigua no se puede mostrar porque se guardó como hash. ¿Crear un código nuevo para el MISMO estudiante con los MISMOS días? El código anterior quedará inválido.")){const fresh=await call("reissue_legacy",{id});showGenerated([{id,code:fresh.code,days:fresh.days}]);await adminRefresh();$("olonLicenseResult")?.scrollIntoView({behavior:"smooth",block:"center"});note("olonLicenseAdminFeedback","Código reemplazado. Puedes verlo y copiarlo arriba.");}return;}return note("olonLicenseAdminFeedback","El código antiguo utilizado no puede recuperarse. La licencia activa y su vencimiento siguen intactos.",true);}const code=String(r.code||"");if(!code)throw Error("Código no disponible");const dialog=document.createElement("dialog");dialog.className="olonLicenseCalendarDialog olonLicenseRevealDialog";dialog.innerHTML='<div class="olonLicenseCalendarInner"><div class="olonLicenseCalendarHead"><div><small>OLFX / ADMINISTRACIÓN</small><h3>Licencia VIP del estudiante</h3></div><button type="button" class="olonLicenseCalendarClose" data-close aria-label="Cerrar">×</button></div><p class="olonLicenseCalendarIntro">Código completo vinculado al estudiante. Compártelo únicamente con su propietario.</p><textarea readonly spellcheck="false" class="olonLicenseRevealCode" aria-label="Código VIP completo"></textarea><div class="olonLicenseCalendarActions"><button class="adminSmallButton" type="button" data-close>Ocultar</button><button class="btn" type="button" data-copy>Copiar licencia</button></div><p class="olonLicenseCalendarError" role="status" hidden></p></div>';document.body.append(dialog);const area=dialog.querySelector("textarea");area.value=code;dialog.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>dialog.close()));dialog.querySelector("[data-copy]").addEventListener("click",async()=>{let ok=false;try{if(navigator.clipboard?.writeText&&window.isSecureContext){await navigator.clipboard.writeText(code);ok=true;}}catch(_){}if(!ok){area.focus();area.select();try{ok=document.execCommand("copy")===true;}catch(_){}}const msg=dialog.querySelector("[role=status]");msg.hidden=false;msg.textContent=ok?"Licencia copiada.":"Licencia seleccionada. Utiliza Ctrl+C.";});dialog.addEventListener("close",()=>dialog.remove(),{once:true});if(typeof dialog.showModal==="function")dialog.showModal();else dialog.setAttribute("open","");}catch(e){note("olonLicenseAdminFeedback",e.message||"No se pudo mostrar la licencia.",true);}}
const licenseStatusLabel=s=>({available:"Disponible",redeemed:"Activada",revoked:"Revocada"})[s]||s;
function renderLicenseList(){const mount=$("olonLicenseList");if(!mount)return;const term=String($("olonLicenseSearch")?.value||"").toLowerCase().trim(),filter=$("olonLicenseFilter")?.value||"all";const rows=allLicenses.filter(l=>{if(filter!=="all"&&l.status!==filter)return false;const user=adminStudents.find(u=>u.id===(l.issued_to||l.redeemed_by));return !term||[user?.full_name,user?.email,l.code_hint,l.duration_days,l.status].some(v=>String(v||"").toLowerCase().includes(term));});mount.innerHTML=rows.map(l=>{const user=adminStudents.find(u=>u.id===(l.issued_to||l.redeemed_by)),owner=user?escape(user.full_name||user.email||"Estudiante"):"Sin estudiante asignado";return '<article class="olonLicenseRow"><div class="olonLicenseRowMain"><div class="olonLicenseRowTop"><strong>VIP · '+Number(l.duration_days)+' días</strong><span class="olonLicenseState" data-state="'+escape(l.status)+'">'+escape(licenseStatusLabel(l.status))+'</span></div><small>'+owner+'</small><small>•••'+escape(l.code_hint)+' · '+date(l.created_at)+'</small></div><div class="olonLicenseRowActions">'+(l.status!=="revoked"?'<button type="button" class="adminSmallButton" data-license-reveal="'+escape(l.id)+'">Ver licencia</button>':'')+(l.status==="available"&&!l.issued_to?'<button type="button" class="adminSmallButton" data-license-assign="'+escape(l.id)+'">Asignar</button>':'')+(l.status==="available"?'<button type="button" class="adminSmallButton" data-license-edit="'+escape(l.id)+'" data-license-days="'+Number(l.duration_days)+'">Editar días</button><button type="button" class="adminSmallButton" data-license-revoke="'+escape(l.id)+'">Revocar</button>':'')+(l.status==="revoked"?'<button type="button" class="adminSmallButton olonLicenseDelete" data-license-delete="'+escape(l.id)+'">Eliminar</button>':'')+'</div></article>';}).join("")||'<p class="olonLicenseEmpty">No hay licencias con este filtro.</p>';}

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
function setLicenseMode(phase){
 const restricted=["legacy_due","grace","eligible"].includes(phase);
 const checking=phase==="checking";
 document.body.classList.toggle("olonLicenseRenewalRequired",restricted);
 document.body.classList.toggle("olonLicenseChecking",checking);
 const card=$("olonLicenseStudentCard");
 if(card){card.dataset.licenseState=phase;card.setAttribute("aria-busy",String(checking));}
 const badge=$("vipPaymentBadge");
 if(badge&&restricted)badge.textContent="Renovación requerida";
 if(restricted&&typeof window.showPage==="function"&&$("dashboard")?.classList.contains("hidden")){
  const nav=document.querySelector('[data-page="dashboard"]');
  window.showPage("dashboard",nav||undefined);
 }
}
function showState(state){
 current=state;
 setLicenseMode(state.phase);
 if($("olonLicenseMyStatus"))$("olonLicenseMyStatus").textContent=phase(state.phase);
 if($("olonLicenseMyDate"))$("olonLicenseMyDate").textContent=state.expires_at?(state.managed?date(state.expires_at):state.expires_at):"No asignada";
 if($("olonLicenseMyGrace"))$("olonLicenseMyGrace").textContent=state.phase==="grace"?"Período de gracia: "+state.grace_days_remaining+" días":state.phase==="eligible"?"Revisión administrativa pendiente":"";
 const input=$("olonLicenseCode"),redeemButton=$("olonLicenseRedeem");
 if(input){input.disabled=state.phase==="active";input.placeholder=state.phase==="active"?"Licencia activa — gestionada por administración":"Pega tu licencia asignada";if(state.phase==="active")input.value="";}
 if(redeemButton){redeemButton.disabled=state.phase==="active";redeemButton.hidden=state.phase==="active";}
 const hint=$("olonLicenseProfileHint");
 if(hint)hint.textContent=state.phase==="active"?"Licencia activa y vinculada a tu cuenta. Las renovaciones y cambios anticipados se gestionan con administración.":state.phase==="legacy"?"Tu acceso actual continúa. Cuando renueves, pega aquí tu licencia.":"Tu cuenta y tus datos están guardados. Pega la licencia que recibiste después de pagar para reactivar tu VIP.";
}
async function status(force=false){
 const u=typeof currentUser!=="undefined"?currentUser:null;
 if(!u||String(u.role)!=="student"||$("portal")?.classList.contains("hidden"))return;
 if(activeStatusPromise)return activeStatusPromise;
 // Cosmetic portal class changes must never trigger repeated license requests.
 if(!force&&u.id===lastStudentId&&Date.now()-lastStatusAt<120000)return;
 const studentId=u.id;
 if(studentId!==lastStudentId){current=null;lastStudentId=studentId;lastStatusAt=0;}
 busy=true;
 if(!current)setLicenseMode("checking");
 activeStatusPromise=(async()=>{
  try{
   const result=await call("status");
   if(typeof currentUser==="undefined"||currentUser?.id!==studentId)return;
   lastStatusAt=Date.now();
   showState(result);
   note("olonLicenseStudentFeedback","");
  }catch(e){
   if(typeof currentUser!=="undefined"&&currentUser?.id===studentId){
    lastStatusAt=Date.now();
    // A network failure does not revoke an already confirmed VIP license.
    // Keep initial unverified access restricted until successful verification.
    note("olonLicenseStudentFeedback","No se pudo actualizar la licencia. Conservamos el último estado válido. Presiona Actualizar licencia para reintentar.",true);
   }
  }finally{busy=false;activeStatusPromise=null;}
 })();
 return activeStatusPromise;
}
async function redeem(event){
 event?.preventDefault();
 const el=$("olonLicenseCode"),code=String(el?.value||"").trim().toUpperCase();
 if(current?.phase==="active")return note("olonLicenseStudentFeedback","Tu licencia está activa. Solicita cualquier cambio a administración.",true);
 if(!code)return note("olonLicenseStudentFeedback","Introduce tu licencia.",true);
 const btn=$("olonLicenseRedeem");if(btn)btn.disabled=true;
 try{
  const r=await call("redeem",{code});
  if(el)el.value="";
  await status();
  if(typeof currentUser!=="undefined"&&currentUser){
   const d=new Date(r.expires_at);
   const p=Object.fromEntries(new Intl.DateTimeFormat("en-US",{year:"numeric",month:"2-digit",day:"2-digit",timeZone:"America/Puerto_Rico"}).formatToParts(d).map(v=>[v.type,v.value]));
   currentUser.next_payment_date=p.year+"-"+p.month+"-"+p.day;
   if(typeof renderVipPayment==="function")renderVipPayment(currentUser);
  }
  note("olonLicenseStudentFeedback","Licencia activada. Tu nueva fecha de vencimiento está actualizada y tus datos permanecen intactos.");
 }catch(e){note("olonLicenseStudentFeedback",e.message||"No se pudo activar.",true);}
 finally{if(btn)btn.disabled=false;}
}
async function adminRefresh(){if(adminBusy||typeof currentUser==="undefined"||currentUser?.role!=="admin")return;adminBusy=true;try{const r=await call("list");const list=$("olonLicenseList"),students=$("olonLicenseStudents");
 allLicenses=r.licenses||[];
 adminStudents=r.students||[];
 const assign=$("olonLicenseAssign");if(assign){const selected=assign.value;assign.innerHTML='<option value="">Selecciona el estudiante (obligatorio)</option>'+adminStudents.map(u=>'<option value="'+escape(u.id)+'">'+escape(u.full_name||u.email||"Estudiante")+'</option>').join("");if(adminStudents.some(u=>u.id===selected))assign.value=selected;}
 renderLicenseList();
 if(students)students.innerHTML=r.students.map(u=>'<div class="olonLicenseRow"><span><b>'+escape(u.full_name||u.email||"Estudiante")+'</b><small>'+escape(phase(u.phase))+' · '+escape(u.expires_at?(u.managed?date(u.expires_at):u.expires_at):"Sin fecha")+(u.pending_payment?" · Comprobante pendiente":"")+'</small></span>'+(u.phase==="eligible"&&!u.pending_payment?'<button type="button" class="adminSmallButton" data-license-review="'+escape(u.id)+'">Revisar eliminación</button>':'')+'</div>').join("")||"<p>No hay estudiantes.</p>";
 if($("olonLicenseAvailable"))$("olonLicenseAvailable").textContent=r.licenses.filter(l=>l.status==="available").length;
 if($("olonLicenseGrace"))$("olonLicenseGrace").textContent=r.students.filter(s=>["grace","eligible"].includes(s.phase)).length;
 if($("olonLicenseRedeemedCount"))$("olonLicenseRedeemedCount").textContent=allLicenses.filter(l=>l.status==="redeemed").length;
 if($("olonLicenseRevokedCount"))$("olonLicenseRevokedCount").textContent=allLicenses.filter(l=>l.status==="revoked").length;
 }catch(e){note("olonLicenseAdminFeedback",e.message,true);}finally{adminBusy=false;}}
async function generate(e){e?.preventDefault();const btn=$("olonLicenseGenerate");const d=String($("olonLicenseDays")?.value||"").trim(),days=Number(d);if(!/^\d{1,3}$/.test(d)||!Number.isInteger(days)||days<1||days>365){note("olonLicenseAdminFeedback","Escribe una duración de 1 a 365 días.",true);return;}if(!String($("olonLicenseAssign")?.value||""))return note("olonLicenseAdminFeedback","Selecciona el estudiante que recibirá la licencia.",true);if(btn)btn.disabled=true;try{const r=await call("generate",{days,quantity:Number($("olonLicenseQuantity")?.value||1),issued_to:String($("olonLicenseAssign")?.value||"")});showGenerated(r.licenses||[]);note("olonLicenseAdminFeedback","Códigos creados. Cópialos ahora: no volverán a mostrarse completos.");await adminRefresh();}catch(e){note("olonLicenseAdminFeedback",e.message,true);}finally{if(btn)btn.disabled=false;}}
async function editDays(id,previous,creating=false){
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
 dialog.setAttribute("aria-label",creating?"Elegir días de acceso con calendario":"Editar días de licencia con calendario");
 dialog.innerHTML='<div class="olonLicenseCalendarInner">'+
  '<div class="olonLicenseCalendarHead"><div><small>OLFX / LICENSE MANAGER</small><h3>'+(creating?"Elegir días de acceso":"Editar días de licencia") +'</h3></div><button type="button" class="olonLicenseCalendarClose" data-cal-close aria-label="Cerrar calendario">×</button></div>'+
  '<p class="olonLicenseCalendarIntro">Selecciona una fecha en el calendario. Se calcularán automáticamente los días de acceso a partir de hoy (hora de Puerto Rico).</p>'+
  '<div class="olonLicenseCalendarNav"><button type="button" data-cal-prev aria-label="Mes anterior">‹</button><strong id="olonLicenseCalendarMonth"></strong><button type="button" data-cal-next aria-label="Mes siguiente">›</button></div>'+
  '<div class="olonLicenseCalendarWeek" aria-hidden="true"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>'+
  '<div class="olonLicenseCalendarGrid" role="grid" aria-label="Días disponibles para la licencia"></div>'+
  '<div class="olonLicenseCalendarSummary"><span>Fecha elegida <b id="olonLicenseCalendarDate"></b></span><span>Duración nueva <b id="olonLicenseCalendarDays"></b></span></div>'+
  '<p class="olonLicenseCalendarHelp">'+(creating?"Esta fecha determina cuántos días durará cada licencia nueva, contando desde hoy en Puerto Rico. El vencimiento real dependerá de cuándo se active y de los días acumulados.":"La fecha muestra cuándo vencería si se activa hoy sin días restantes. Si el estudiante aún tiene días pagados, se acumularán. Al editar, el código anterior será reemplazado por uno nuevo.")+'</p>'+
  '<p class="olonLicenseCalendarError" role="alert" hidden></p>'+
  '<div class="olonLicenseCalendarActions"><button type="button" class="adminSmallButton" data-cal-close>Cancelar</button><button type="button" class="btn" data-cal-save>'+(creating?"Confirmar días":"Guardar y generar nuevo código")+'</button></div>'+
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
  q("[data-cal-save]").disabled=!creating&&diff(selected)===Number(previous);
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
  if(!creating&&days===Number(previous)){showError("Selecciona una fecha diferente para modificar la licencia.");return;}
  save.disabled=true;showError("");
  try{
   if(creating){
    $("olonLicenseDays").value=String(days);
    $("olonLicenseSelectedDays").textContent=days+" día"+(days===1?"":"s");
    $("olonLicenseSelectedDate").textContent=dayFmt.format(parseISO(selected));
    dialog.close();return;
   }
   const result=await call("edit_days",{id,days});
   showGenerated([{id,code:result.code,days}]);
   dialog.close();
   note("olonLicenseAdminFeedback","Licencia actualizada a "+days+" días. Copia el código nuevo ahora; el anterior fue invalidado.");
   await adminRefresh();
  }catch(e){showError(e.message||"No se pudo editar la licencia.");save.disabled=false;}
 });
 dialog.addEventListener("close",()=>dialog.remove(),{once:true});
 renderCalendar();
 if(typeof dialog.showModal==="function")dialog.showModal();else dialog.setAttribute("open","");
}
async function deleteRevoked(id){if(!confirm("¿Eliminar definitivamente esta licencia revocada? Los estudiantes y sus datos no se eliminan."))return;try{await call("delete_revoked",{id});await adminRefresh();note("olonLicenseAdminFeedback","Licencia revocada eliminada.");}catch(e){note("olonLicenseAdminFeedback",e.message||"No se pudo eliminar.",true);}}
async function revoke(id){if(!confirm("¿Revocar esta licencia sin utilizar?"))return;try{await call("revoke",{id});await adminRefresh();note("olonLicenseAdminFeedback","Licencia revocada.");}catch(e){note("olonLicenseAdminFeedback",e.message,true);}}
function init(){
 const durationValue=Number($("olonLicenseDays")?.value)||15;
 const pickerDate=new Date(Date.now()+durationValue*86400000);
 const formatter=new Intl.DateTimeFormat("es-PR",{day:"numeric",month:"long",year:"numeric",timeZone:"America/Puerto_Rico"});
 if($("olonLicenseSelectedDate"))$("olonLicenseSelectedDate").textContent=formatter.format(pickerDate);
 if($("olonLicenseSelectedDays"))$("olonLicenseSelectedDays").textContent=durationValue+" días";
 $("olonLicenseRedeem")?.addEventListener("click",redeem);
 $("olonLicenseRefreshStudent")?.addEventListener("click",()=>void status(true));
 $("olonLicenseCode")?.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();void redeem();}});
 $("olonLicenseDatePicker")?.addEventListener("click",()=>void editDays(null,Number($("olonLicenseDays")?.value)||15,true));
 $("olonLicenseGenerate")?.addEventListener("click",generate);
 $("olonLicenseRefresh")?.addEventListener("click",adminRefresh);
 $("olonLicenseCopy")?.addEventListener("click",copyCodes);
 $("olonLicenseSelectCodes")?.addEventListener("click",()=>{const t=$("olonGeneratedCodes");if(t){t.focus();t.select();t.setSelectionRange(0,t.value.length);}note("olonLicenseAdminFeedback","Código seleccionado. Presiona Ctrl+C.");});
 $("olonLicenseSearch")?.addEventListener("input",renderLicenseList);
 $("olonLicenseFilter")?.addEventListener("change",renderLicenseList);
 $("olonLicenseList")?.addEventListener("click",e=>{const assign=e.target.closest("[data-license-assign]");if(assign){const student=String($("olonLicenseAssign")?.value||"");if(!student){note("olonLicenseAdminFeedback","Selecciona arriba el estudiante y luego presiona Asignar estudiante.",true);return;}void call("assign",{id:assign.dataset.licenseAssign,student_id:student}).then(()=>adminRefresh()).then(()=>note("olonLicenseAdminFeedback","Licencia asignada al estudiante.")).catch(err=>note("olonLicenseAdminFeedback",err.message,true));return;}const reveal=e.target.closest("[data-license-reveal]");if(reveal){void revealLicense(reveal.dataset.licenseReveal);return;}const del=e.target.closest("[data-license-delete]");if(del){void deleteRevoked(del.dataset.licenseDelete);return;}const edit=e.target.closest("[data-license-edit]");if(edit){void editDays(edit.dataset.licenseEdit,edit.dataset.licenseDays);return;}const id=e.target.closest("[data-license-revoke]")?.dataset.licenseRevoke;if(id)void revoke(id);});
 $("olonLicenseStudents")?.addEventListener("click",e=>{const id=e.target.closest("[data-license-review]")?.dataset.licenseReview;const person=adminStudents.find(u=>u.id===id&&u.phase==="eligible"&&!u.pending_payment);if(person)window.olonRequests?.manageAccount(person,"delete");});
 const admin=$("admin");if(admin)new MutationObserver(()=>{if(!admin.classList.contains("hidden")&&currentUser?.role==="admin")void adminRefresh();}).observe(admin,{attributes:true,attributeFilter:["class"]});
 const portal=$("portal");
  if(portal){
   let wasHidden=portal.classList.contains("hidden");
   new MutationObserver(()=>{
    const hidden=portal.classList.contains("hidden");
    if(hidden===wasHidden)return; // Ignore scroll, viewport resize and menu CSS.
    wasHidden=hidden;
    if(hidden){
     showGenerated([]);current=null;lastStudentId=null;lastStatusAt=0;
     document.body.classList.remove("olonLicenseRenewalRequired","olonLicenseChecking");
    }else if(currentUser?.role==="student")void status(true);
   }).observe(portal,{attributes:true,attributeFilter:["class"]});
  }
  document.addEventListener("visibilitychange",()=>{if(!document.hidden&&currentUser?.role==="student")void status();});
  window.addEventListener("focus",()=>{if(currentUser?.role==="student")void status();});
  document.addEventListener("click",event=>{
  if(!document.body.classList.contains("olonLicenseRenewalRequired")&&!document.body.classList.contains("olonLicenseChecking"))return;
  if(!currentUser||currentUser.role!=="student")return;
  const target=event.target.closest("[data-page],[data-dock-page],.portalNavLink,.portalDockLink");
  if(!target)return;
  const destination=target.dataset.page||target.dataset.dockPage;
  if(destination&&destination!=="dashboard"&&destination!=="academyVipPage"){
   event.preventDefault();event.stopImmediatePropagation();
   if(typeof window.showPage==="function")window.showPage("dashboard",document.querySelector('[data-page="dashboard"]'));
   $("olonLicenseStudentCard")?.scrollIntoView({behavior:"smooth",block:"center"});
  }
 },true);
 window.olonLicense={refresh:status,adminRefresh};
 if(currentUser?.role==="student"&&!portal?.classList.contains("hidden"))void status();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();