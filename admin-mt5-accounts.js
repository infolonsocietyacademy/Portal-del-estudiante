/* Administrator directory: masked identities only, using authenticated server actions. */
(() => {
  "use strict";
  const $=id=>document.getElementById(id), root=$("adminMt5AccountsBlock");
  if(!root)return;
  const allowed=()=>typeof currentUser!=="undefined"&&currentUser?.status==="active"&&typeof isAdminUser==="function"&&isAdminUser(currentUser);
  const owner=()=>allowed()?currentUser.id:null;
  const text=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=String(value??"—");if(cls)e.className=cls;return e;};
  const norm=v=>String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  const date=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString("es-PR",{timeZone:"America/Puerto_Rico",dateStyle:"short",timeStyle:"short"}):"Sin sincronizar";
  let accounts=[],selected=null,loading=false,working=false,generation=0,historyGeneration=0,historyPage=0,historyTotal=0,historyLoading=false;
  const labels={active:"Sincronizada",waiting:"En espera",registered:"Sin verificar",error:"Error de conexión",revoked:"Desconectada"};
  const attention=a=>!!a.last_error||["registered","error"].includes(a.status);
  const state=a=>a.last_error&&a.status==="active"?"Sincronizada · con aviso":labels[a.status]||"Sin verificar";
  function feedback(message,error=false){$("amtFeedback").textContent=message;$("amtFeedback").dataset.error=String(error);}
  async function invoke(body){
    if(!allowed())throw Error("Solo el administrador puede consultar estas cuentas.");
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),22000);
    try{
      const {data,error}=await supabaseClient.functions.invoke("olon-own-connect",{body,signal:controller.signal});
      if(error){let detail=data?.error;try{detail=detail||(await error.context?.clone?.().json())?.error;}catch{}throw Error(detail||"No se pudo completar la solicitud. Actualiza e intenta nuevamente.");}
      if(data?.error)throw Error(data.error);
      return data;
    }finally{clearTimeout(timer);}
  }
  function empty(body,message,cols){const tr=text("tr",""),td=text("td",message);td.colSpan=cols;tr.append(td);body.replaceChildren(tr);}
  function paint(){
    if(!allowed())return;
    $("amtStudents").textContent=new Set(accounts.map(a=>a.student_id)).size;
    $("amtAccounts").textContent=accounts.length;
    $("amtPending").textContent=accounts.filter(a=>["registered","waiting","error"].includes(a.status)).length;
    const query=norm($("amtSearch").value),filter=$("amtFilter").value;
    const list=accounts.filter(a=>(filter==="all"||(filter==="attention"?attention(a):a.status===filter))&&norm([a.student?.full_name,a.student?.email,a.login_masked,a.broker_server].join(" ")).includes(query));
    list.sort((a,b)=>String(a.student?.full_name||a.student_id).localeCompare(String(b.student?.full_name||b.student_id),"es")||Number(b.is_primary)-Number(a.is_primary)||String(a.id).localeCompare(String(b.id)));
    const body=$("amtRows");body.replaceChildren();
    for(const a of list){
      const tr=document.createElement("tr");tr.dataset.selected=String(a.id===selected);
      const student=text("td","");student.append(text("strong",a.student?.full_name||"Estudiante no disponible"),text("small",a.student?.email||"Correo no disponible"));
      const account=text("td","");account.append(text("strong",a.login_masked));if(a.is_primary)account.append(text("small","Principal","amtPrimary"));
      const status=text("td","");status.append(text("span",state(a),"amtBadge "+(attention(a)?"warning":a.status)));
      const action=text("td","");const button=text("button","Ver detalle","btn");button.type="button";button.dataset.accountId=a.id;button.setAttribute("aria-label","Ver detalle de "+(a.student?.full_name||"estudiante")+" · "+a.login_masked);button.setAttribute("aria-expanded",String(a.id===selected));action.append(button);
      const remove=text("button","Eliminar","btn secondary amtDelete");remove.type="button";remove.dataset.deleteAccountId=a.id;remove.disabled=working;remove.setAttribute("aria-label","Eliminar cuenta "+a.login_masked+" de "+(a.student?.full_name||"estudiante"));action.append(remove);
      tr.append(student,account,text("td",a.broker_server),status,text("td",date(a.last_sync_at)),action);body.append(tr);
    }
    if(!list.length)empty(body,accounts.length?"No hay cuentas que coincidan con estos filtros.":"Todavía no hay cuentas MT5 registradas.",6);
  }
  function detail(id,focus=false){
    const a=accounts.find(x=>x.id===id);selected=a?.id||null;historyGeneration++;historyLoading=false;
    $("amtDetail").hidden=!a;$("amtHistoryPanel").hidden=true;
    $("amtHistoryRows").replaceChildren();
    if(!a)return;
    $("amtDetailTitle").textContent="Detalle de la cuenta · "+a.login_masked;
    const dl=$("amtDetails");dl.replaceChildren();
    for(const [key,value] of [["Estudiante",a.student?.full_name],["Correo",a.student?.email],["Plataforma","MetaTrader 5"],["Servidor",a.broker_server],["Estado",state(a)],["Cuenta principal",a.is_primary?"Sí":"No"],["Última sincronización (PR)",date(a.last_sync_at)]]){const pair=document.createElement("div");pair.append(text("dt",key),text("dd",value));dl.append(pair);}
    $("amtError").textContent=a.last_error?"Último aviso: "+a.last_error:"";
    $("amtRetry").disabled=working||a.status==="revoked"||a.status==="waiting";
    $("amtRetry").textContent=a.status==="waiting"?"Sincronización solicitada":"Reintentar conexión";
    $("amtDelete").disabled=working;
    $("amtStudent").disabled=!a.student;
    paint();if(focus)$("amtDetailTitle").focus();
  }
  async function refresh(){
    if(!allowed()||loading)return;
    const user=owner(),ticket=++generation;loading=true;$("amtRefresh").disabled=true;
    feedback("Consultando cuentas MT5…");
    try{
      const all=[];let page=0,total=0;
      do{
        const data=await invoke({action:"admin-accounts",page});
        if(ticket!==generation||owner()!==user)return;
        if(!Array.isArray(data?.accounts)||!Number.isFinite(data.total))throw Error("La respuesta no contiene una lista válida de cuentas.");
        all.push(...data.accounts);total=data.total;page++;
        if(!data.accounts.length&&all.length<total)throw Error("El listado cambió durante la consulta. Actualiza nuevamente.");
      }while(all.length<total);
      accounts=[...new Map(all.map(a=>[a.id,a])).values()];
      detail(selected);paint();feedback(accounts.length+" cuentas · actualizado "+date(new Date().toISOString())+" (PR)");
    }catch(e){if(ticket===generation&&owner()===user)feedback(e.message,true);}
    finally{if(ticket===generation){loading=false;$("amtRefresh").disabled=false;}}
  }
  async function history(page=0){
    const a=accounts.find(x=>x.id===selected);if(!a||!allowed()||historyLoading)return;
    const user=owner(),ticket=++historyGeneration,id=a.id;
    historyLoading=true;$("amtHistoryPanel").hidden=false;
    $("amtPrev").disabled=true;$("amtNext").disabled=true;$("amtHistoryCount").textContent="Consultando historial…";
    empty($("amtHistoryRows"),"Consultando operaciones de esta cuenta…",6);
    try{
      const data=await invoke({action:"admin-account-history",accountId:id,page});
      if(ticket!==historyGeneration||selected!==id||owner()!==user)return;
      if(!Array.isArray(data?.deals))throw Error("Historial no disponible.");
      historyPage=data.page;historyTotal=data.total;const rows=$("amtHistoryRows");rows.replaceChildren();
      for(const d of data.deals){
        const tr=document.createElement("tr"),net=[d.profit,d.commission,d.swap,d.fee].reduce((n,v)=>n+Number(v||0),0);
        tr.append(text("td",date(d.occurred_at)),text("td",d.deal_id),text("td",String(d.deal_type).replace("DEAL_TYPE_","")),text("td",d.symbol||"—"),text("td",d.volume),text("td",net.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})));rows.append(tr);
      }
      if(!data.deals.length)empty(rows,"Esta cuenta todavía no tiene movimientos sincronizados.",6);
      $("amtHistoryCount").textContent=historyTotal?"Página "+(historyPage+1)+" · "+historyTotal+" movimientos":"Sin movimientos";
      $("amtPrev").disabled=historyPage===0;$("amtNext").disabled=(historyPage+1)*data.pageSize>=historyTotal;
    }catch(e){if(ticket===historyGeneration&&owner()===user){empty($("amtHistoryRows"),e.message,6);$("amtHistoryCount").textContent="No se pudo cargar el historial";}}
    finally{if(ticket===historyGeneration)historyLoading=false;}
  }
  $("amtSearch").addEventListener("input",paint);$("amtFilter").addEventListener("change",paint);
  $("amtRefresh").addEventListener("click",()=>void refresh());
  $("amtRows").addEventListener("click",e=>{const remove=e.target.closest("[data-delete-account-id]");if(remove&&allowed()&&!working){detail(remove.dataset.deleteAccountId);$("amtDelete").click();return;}const button=e.target.closest("[data-account-id]");if(button&&allowed())detail(button.dataset.accountId,true);});
  $("amtHistory").addEventListener("click",()=>void history());
  $("amtPrev").addEventListener("click",()=>void history(Math.max(0,historyPage-1)));
  $("amtNext").addEventListener("click",()=>void history(historyPage+1));
  $("amtStudent").addEventListener("click",()=>{
    if(!allowed())return;const a=accounts.find(x=>x.id===selected);if(!a)return;
    $("adminSearch").value=a.student?.email||a.student?.full_name||"";$("adminStatusFilter").value="all";
    window.olonAdmin?.render?.();window.olonAdminSections?.open?.("adminStudentsBlock",{focus:true});
  });
  $("amtRetry").addEventListener("click",async()=>{
    if(!allowed()||working)return;const a=accounts.find(x=>x.id===selected);if(!a||["revoked","waiting"].includes(a.status))return;
    const user=owner();working=true;detail(selected);
    try{await invoke({action:"admin-retry-sync",accountId:a.id});if(owner()!==user)return;a.status="waiting";a.last_error=null;detail(selected);feedback("Solicitud enviada al agente Windows para "+a.login_masked+". Actualiza estados para comprobar el resultado.");}
    catch(e){if(owner()===user)feedback(e.message,true);}
    finally{working=false;if(owner()===user)detail(selected);}
  });
  $("amtDelete").addEventListener("click",async()=>{
    if(!allowed()||working)return;
    const a=accounts.find(x=>x.id===selected);if(!a)return;
    if(!window.confirm("¿Eliminar la conexión MT5 "+a.login_masked+" · "+a.broker_server+" de "+(a.student?.full_name||"este estudiante")+"? El estudiante podrá conectarla nuevamente. Su historial se conservará."))return;
    const user=owner();working=true;detail(selected);
    try{
      await invoke({action:"admin-delete-account",accountId:a.id});
      if(owner()!==user)return;
      accounts=accounts.filter(x=>x.id!==a.id);
      detail(null);paint();window.olonMtRecords?.invalidate?.();
      await refresh();
      if(owner()===user)feedback("Cuenta eliminada. El estudiante ya puede conectarla nuevamente. Su historial se conserva.");
    }catch(e){if(owner()===user)feedback(e.message,true);}
    finally{working=false;if(owner()===user)detail(selected);}
  });
  window.olonAdminMt5={activate:refresh};
  new MutationObserver(()=>{
    if(allowed())return;
    generation++;historyGeneration++;loading=false;historyLoading=false;accounts=[];selected=null;
    $("amtRows").replaceChildren();$("amtDetails").replaceChildren();$("amtHistoryRows").replaceChildren();$("amtDetail").hidden=true;
    $("amtRefresh").disabled=false;for(const id of ["amtStudents","amtAccounts","amtPending"])$(id).textContent="—";
    feedback("Abre esta sección para consultar las cuentas.");
  }).observe($("portal"),{attributes:true,attributeFilter:["class"]});
})();
