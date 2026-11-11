/* Administrative, cumulative Excel report imports. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id), block = $("adminRebatesBlock");
  if (!block) return;
  const esc = value => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const number = value => new Intl.NumberFormat("en-US",{maximumFractionDigits:6}).format(Number(value || 0));
  const date = value => value ? value.slice(0,10).split("-").reverse().join("/") : "—";
  const amounts = values => (values || []).map(row => {
    const amount = new Intl.NumberFormat("en-US",{style:"currency",currency:row.currency,minimumFractionDigits:2,maximumFractionDigits:6}).format(Number(row.rebate));
    return '<span>'+esc(amount)+' <small>'+esc(row.currency)+'</small></span>';
  }).join("") || '<span>—</span>';
  let owner=null,epoch=0,ticket=0,page=0,totalClients=0,busy=false,loading=false,loaded=false;
  let parsed=null,requestId=null,plan=null,assetPromise=null,updateTarget=null,knownReports=new Map();
  const monthNames=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  let reportYear=2026,reportMonth=0;
  const periodPanel=document.createElement("section");
  periodPanel.className="rebatePeriodPanel";
  periodPanel.innerHTML='<div class="rebatePeriodHeader"><div><span class="rebateEyebrow">REBATe CONTROL · AÑO / MES</span><h5>Reportes históricos</h5><p>2026, 2027 y años siguientes. Los períodos se determinan por las operaciones del Excel.</p></div><label>AÑO <select id="rebateYear" aria-label="Seleccionar año de rebates"><option value="2026">2026</option><option value="2027">2027</option></select></label></div><div id="rebateAnnual" class="rebateAnnual"></div><div id="rebateMonths" class="rebateMonths"></div>';
  block.querySelector(".rebateMetrics")?.insertAdjacentElement("beforebegin",periodPanel);
  const yearControl=periodPanel.querySelector("#rebateYear");
  const annual=periodPanel.querySelector("#rebateAnnual");
  const months=periodPanel.querySelector("#rebateMonths");
  const periods=(y,m)=>m?[y+"-"+String(m).padStart(2,"0")+"-01",new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)]:[y+"-01-01",y+"-12-31"];
  const setPeriod=()=>{const [a,b]=periods(reportYear,reportMonth);$("rebateFrom").value=a;$("rebateTo").value=b;};
  const addYear=y=>{if(![...yearControl.options].some(o=>Number(o.value)===y))yearControl.add(new Option(String(y),String(y)));};
  function renderPeriod(data){
    for(const row of data.years||[])addYear(Number(row.year));
    yearControl.value=String(reportYear);
    const summary=data.annual||{};
    annual.innerHTML='<div><small>TOTAL '+reportYear+'</small><strong>'+number(summary.lots)+' lotes</strong></div><div><small>REBATES</small><strong>'+amounts(summary.currencies)+'</strong></div><div><small>OPERACIONES</small><strong>'+number(summary.row_count)+'</strong></div><div><small>CLIENTES</small><strong>'+number(summary.client_count)+'</strong></div>';
    const monthData=new Map((data.months||[]).map(r=>[Number(r.month),r]));
    const entries=[{month:0,name:"Año completo",...summary},...monthNames.map((name,i)=>({month:i+1,name,...(monthData.get(i+1)||{})}))];
    months.innerHTML=entries.map(r=>'<button type="button" class="rebateMonth'+(reportMonth===r.month?' active':'')+'" data-month="'+r.month+'" aria-pressed="'+(reportMonth===r.month)+'"><span>'+esc(r.name)+'</span><b>'+number(r.lots)+' lotes</b><small>'+amounts(r.currencies)+'</small><em>'+number(r.row_count)+' órdenes</em></button>').join("");
    const [start,end]=periods(reportYear,reportMonth);
    const reports=(data.reports||[]).filter(r=>r.first_date<=end&&r.last_date>=start);
    knownReports.clear();
    for(const r of reports)knownReports.set(r.id,{id:r.id,file_sha256:r.file_sha256,version:r.version,updated_rows:r.updated_rows});
    $("rebateReportRows").innerHTML=reports.map(row=>'<article class="rebateReport"><div><strong>'+esc(row.file_name)+'</strong><small>'+date(row.first_date)+' — '+date(row.last_date)+(row.version>1?' · v'+number(row.version):'')+'</small></div><div><span>'+number(row.inserted_rows)+' nuevos</span><small>'+number(row.duplicate_rows)+' repetidos</small></div><div class="rebateReportActions"><button type="button" class="rebateButton rebateUpdateAction" data-rebate-update="'+esc(row.id)+'">Actualizar archivo</button><button type="button" class="rebateButton rebateDeleteAction" data-rebate-delete="'+esc(row.id)+'">Eliminar</button></div></article>').join("")||'<p class="rebateHint">No hay archivos guardados para este período.</p>';
  }
  yearControl.addEventListener("change",()=>{reportYear=Number(yearControl.value);reportMonth=0;page=0;setPeriod();void dashboard();});
  months.addEventListener("click",e=>{const button=e.target.closest("[data-month]");if(!button||busy||loading)return;reportMonth=Number(button.dataset.month);page=0;setPeriod();void dashboard();});
  setPeriod();
  const updateInput=document.createElement('input');
  updateInput.type='file';updateInput.accept='.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';updateInput.hidden=true;
  updateInput.id='rebateUpdateFile';block.appendChild(updateInput);
  const comparison=document.createElement('div');comparison.id='rebateComparison';comparison.className='rebateComparison';comparison.hidden=true;
  // The preview grid is a CSS class, not an element id. A null dereference here
  // previously stopped ALL rebate actions (including the Excel file chooser).
  const previewMetrics=block.querySelector(".rebatePreviewMetrics");
  if(previewMetrics)previewMetrics.insertAdjacentElement("afterend",comparison);
  else block.querySelector("#rebatePreview")?.appendChild(comparison);
  function authorized() { return typeof currentUser!=="undefined" && !!currentUser && isAdminUser(currentUser) && currentUser.status==="active"; }
  function active(captured) { return authorized() && owner===currentUser.id && captured===epoch; }
  function feedback(message="",error=false) {
    const el=$("rebateFeedback"); el.hidden=!message;el.textContent=message;el.classList.toggle("error",error);
  }
  function reason(error) {
    const text=String(error?.message || "No se pudo completar la operación.");
    if (/42501|permission denied|row.level security/i.test(text)) return "Esta área requiere una sesión de administrador activa.";
    if (/Failed to fetch|network/i.test(text)) return "No hay conexión. Vuelve a intentarlo; los registros ya guardados no se duplicarán.";
    return text;
  }
  function buttons() {
    updateInput.disabled=busy;
    const deleteConfirm=$("rebateDeleteConfirm");if(deleteConfirm)deleteConfirm.disabled=busy;
    $("rebateChoose").disabled=busy;
    $("rebateRefresh").disabled=busy||loading;
    $("rebateApply").disabled=busy||loading;
    $("rebateClear").disabled=busy;
    const canUpdate=!!updateTarget&&!!plan?.eligible;
    $("rebateImport").disabled=busy||loading||!plan||(updateTarget?!canUpdate:plan.already_imported||Number(plan.new_rows)===0);
    $("rebateImport").textContent=busy?"Procesando…":updateTarget?"Confirmar actualización":plan?"Importar "+number(plan.new_rows)+" registros nuevos":"Importar y sumar";
    block.querySelectorAll("[data-rebate-update],[data-rebate-delete]").forEach(button=>button.disabled=busy||loading);
    yearControl.disabled=busy||loading;months.querySelectorAll("button").forEach(b=>b.disabled=busy||loading);
    $("rebatePrev").disabled=loading||page===0;
    $("rebateNext").disabled=loading||(page+1)*20>=totalClients;
  }
  function clearPreview() {
    parsed=null;plan=null;requestId=null;updateTarget=null;$("rebateFile").value="";updateInput.value="";comparison.hidden=true;comparison.replaceChildren();$("rebatePreview").hidden=true;
    $("rebatePreviewClients").replaceChildren();$("rebatePreviewName").textContent="";buttons();
  }
  function reset() {
    epoch++;ticket++;owner=null;page=0;totalClients=0;busy=false;loading=false;loaded=false;knownReports.clear();clearPreview();
    if($("rebateDeletePanel"))$("rebateDeletePanel").hidden=true;
    ["rebateTotalLots","rebateEarningLots","rebateTotalRows","rebateTotalClients","rebateRange"].forEach(id=>$(id).textContent="—");
    $("rebateTotalAmount").replaceChildren();$("rebateClientRows").replaceChildren();$("rebateReportRows").replaceChildren();
    $("rebateFrom").value="";$("rebateTo").value="";$("rebateSearch").value="";
    $("rebatePager").hidden=true;$("rebateEmpty").hidden=false;annual.replaceChildren();months.replaceChildren();feedback();buttons();
  }
  function session() {
    if (!authorized()) {reset();throw Error("Inicia sesión como administrador.");}
    if (owner!==currentUser.id) {reset();owner=currentUser.id;}
    return epoch;
  }
  async function dashboard() {
    let captured;try {captured=session();}catch{return;}
    const current=++ticket;loading=true;buttons();
    try {
      const from=$("rebateFrom").value||null,to=$("rebateTo").value||null;
      if (from&&to&&from>to) throw Error("La fecha inicial debe ser anterior o igual a la final.");
      const {data,error}=await supabaseClient.rpc("olon_rebate_dashboard",{p_from:from,p_to:to,p_search:$("rebateSearch").value.trim(),p_page:page});
      if (!active(captured)||current!==ticket)return;
      if(error)throw error;
      loaded=true;totalClients=Number(data.client_rows||0);
      if(page&&page*20>=totalClients){page=0;return await dashboard();}
      $("rebateTotalLots").textContent=number(data.lots);
      $("rebateEarningLots").textContent=number(data.earning_lots)+" lotes con rebate";
      $("rebateTotalAmount").innerHTML=amounts(data.currencies);
      $("rebateTotalRows").textContent=number(data.row_count);
      $("rebateTotalClients").textContent=number(data.client_count);
      $("rebateRange").textContent=data.first_date?date(data.first_date)+" — "+date(data.last_date):"Sin registros importados";
      const clients=data.clients||[];
      $("rebateEmpty").hidden=clients.length>0;
      $("rebateClientRows").innerHTML=clients.map(row=>'<article class="rebateClient"><div><strong>'+esc(row.customer_name)+'</strong><small>ID '+esc(row.customer_id)+' · '+esc(row.platform)+'</small></div><div><b>'+number(row.lots)+'</b><small>lotes · '+number(row.row_count)+' registros</small></div><div class="rebateClientAmount">'+amounts([row])+'</div></article>').join("");
      const period=await supabaseClient.rpc("olon_rebate_period_summary",{p_year:reportYear});
      if(!active(captured)||current!==ticket)return;
      if(period.error)throw period.error;
      renderPeriod(period.data);
      $("rebatePager").hidden=totalClients<=20;
      $("rebatePage").textContent="Página "+(page+1)+" de "+Math.max(1,Math.ceil(totalClients/20));
    } catch(error){if(active(captured)&&current===ticket)feedback(reason(error),true);}
    finally{if(active(captured)&&current===ticket){loading=false;buttons();}}
  }
  function loadScript(path,check) {
    if(check())return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const script=document.createElement("script");script.src=path;
      script.onload=()=>check()?resolve():reject(Error("No se pudo iniciar el lector de Excel."));
      script.onerror=()=>{script.remove();reject(Error("No cargó el lector de Excel. Actualiza el portal e inténtalo de nuevo."));};
      document.head.append(script);
    });
  }
  async function assets() {
    if(!assetPromise)assetPromise=(async()=>{
      await loadScript("./rebates/vendor/jszip-3.10.1.min.js",()=>!!window.JSZip);
      await loadScript("./rebates/xlsx-reader.js?v=20261111-settled-annual-1",()=>!!window.olonRebateReader);
    })().catch(error=>{assetPromise=null;throw error;});
    return assetPromise;
  }
  function rpcArgs(dryRun) {
    return {p_request_id:requestId,p_file_name:parsed.name,p_file_sha256:parsed.hash,p_rows:parsed.rows,p_dry_run:dryRun};
  }
  function preview() {
    $("rebatePreview").hidden=false;$("rebatePreviewName").textContent=parsed.name;
    $("rebatePreviewPeriod").textContent=date(plan.first_date)+" — "+date(plan.last_date)+" · "+number(plan.row_count)+" registros · "+number(plan.client_count)+" clientes";
    $("rebatePreviewLots").textContent=number(plan.lots);
    $("rebatePreviewAmount").innerHTML=amounts(plan.currencies);
    $("rebatePreviewNew").textContent=number(plan.new_rows);
    comparison.hidden=!updateTarget;
    if(updateTarget){
      const oldAmount=amounts(plan.previous_currencies);
      comparison.innerHTML='<strong>COMPARACIÓN CON EL REPORTE GUARDADO</strong>'+
        '<div class="rebateCompareGrid"><div><small>Antes · lotes</small><b>'+number(plan.previous_lots)+'</b></div>'+
        '<div><small>Nuevo · lotes</small><b>'+number(plan.lots)+'</b></div>'+
        '<div><small>Antes · rebates</small><b>'+oldAmount+'</b></div>'+
        '<div><small>Nuevo · rebates</small><b>'+amounts(plan.currencies)+'</b></div></div>'+
        '<p><b>'+number(plan.duplicate_rows)+'</b> órdenes iguales · <b>'+number(plan.new_rows)+'</b> nuevas · <b>'+number(plan.changed_rows)+'</b> modificadas</p>'+
        '<p>'+esc(plan.blocked_reason||'Los registros existentes que no estén en este Excel se conservarán. Revisa el resumen antes de confirmar.')+'</p>';
      $("rebatePreviewPeriod").textContent='Actualizando: '+updateTarget.name+' · versión '+number(updateTarget.version)+' → '+number(updateTarget.version+1)+' · '+number(plan.row_count)+' registros';
      $("rebatePreviewStatus").textContent=plan.eligible?'Cambios encontrados. Confirma solo si este Excel es una revisión correcta del reporte seleccionado.':plan.blocked_reason;
    }
    let message=plan.already_imported?"Este archivo ya se importó. Sus registros siguen incluidos una sola vez.":number(plan.duplicate_rows)+" registros ya existentes se omitirán.";
    if(plan.conflict_rows)message+=" "+number(plan.conflict_rows)+" órdenes tienen importes distintos a los guardados y se omitirán para revisión.";
    if(plan.repeated_in_file)message+=" "+number(plan.repeated_in_file)+" filas repetidas dentro del Excel se contarán una sola vez.";
    if(!updateTarget)$("rebatePreviewStatus").textContent=message;
    $("rebatePreviewWarnings").textContent=parsed.warnings.join(" ")+(parsed.periods?.length?" Períodos: "+parsed.periods.join(", ")+".":"");
    const groups=new Map(), seen=new Set();
    for(const row of parsed.rows) {
      const identity=JSON.stringify([row.platform,row.referral_id,row.customer_id,row.order_id,row.rebate_id,row.wallet_id,row.currency]);
      if(seen.has(identity))continue;
      seen.add(identity);
      const key=JSON.stringify([row.platform,row.referral_id,row.customer_id,row.currency]);
      if(!groups.has(key))groups.set(key,{name:row.customer_name,currency:row.currency,lots:0,rebate:0});
      const group=groups.get(key);group.lots+=Number(row.lots);group.rebate+=Number(row.rebate);
    }
    // Preview groups describe the file. The server's plan controls what will be added.
    $("rebatePreviewClients").innerHTML=Array.from(groups.values()).slice(0,8).map(row=>'<div class="rebatePreviewClient"><span>'+esc(row.name)+'</span><span>'+number(row.lots)+' lotes</span><span>'+amounts([row])+'</span></div>').join("");
    buttons();
  }
  async function choose(file,target=null) {
    if(!file||!authorized()||busy)return;
    const captured=session();clearPreview();updateTarget=target;feedback();busy=true;buttons();
    $("rebateUploadStatus").textContent="Leyendo y comprobando el Excel…";
    try {
      await assets();
      const result=await window.olonRebateReader.read(file);
      if(!active(captured))return;
      parsed=result;requestId=crypto.randomUUID();
      const {data,error}=updateTarget
        ?await supabaseClient.rpc("olon_update_rebate_report",{
          p_report_id:updateTarget.id,p_expected_file_sha256:updateTarget.hash,
          p_file_name:parsed.name,p_file_sha256:parsed.hash,p_rows:parsed.rows,p_dry_run:true
        })
        :await supabaseClient.rpc("olon_import_rebate_report",rpcArgs(true));
      if(!active(captured))return;
      if(error)throw error;
      plan=data;preview();
      $("rebatePreview").scrollIntoView({behavior:"smooth",block:"start"});
    }catch(error){if(active(captured)){clearPreview();feedback(reason(error),true);}}
    finally{if(active(captured)){busy=false;$("rebateUploadStatus").textContent="Excel .xlsx · Hasta 10 MB y 5,000 registros por archivo";buttons();}}
  }
  async function importFile() {
    if(!authorized()||busy||!parsed||!plan||(updateTarget?!plan.eligible:!Number(plan.new_rows)))return;
    const captured=session();busy=true;feedback();buttons();
    try {
      const {data,error}=updateTarget
        ?await supabaseClient.rpc("olon_update_rebate_report",{
          p_report_id:updateTarget.id,p_expected_file_sha256:updateTarget.hash,
          p_file_name:parsed.name,p_file_sha256:parsed.hash,p_rows:parsed.rows,p_dry_run:false
        })
        :await supabaseClient.rpc("olon_import_rebate_report",rpcArgs(false));
      if(!active(captured))return;
      if(error)throw error;
      const message=updateTarget?("Reporte actualizado a versión "+number(data.version)+": "+number(data.new_rows)+" órdenes nuevas y "+number(data.changed_rows)+" modificadas. Se conservaron los datos históricos."):data.already_imported?"Este archivo ya estaba importado. El acumulado se conserva sin duplicados.":number(data.new_rows)+" registros añadidos al acumulado. "+number(data.duplicate_rows)+" repetidos omitidos."+(data.conflict_rows?" "+number(data.conflict_rows)+" con diferencias se omitieron para revisión.":"");
      const lastDate=parsed.rows.reduce((a,r)=>r.trade_date>a?r.trade_date:a,"");
      clearPreview();feedback(message);page=0;
      if(lastDate){reportYear=Number(lastDate.slice(0,4));reportMonth=Number(lastDate.slice(5,7));addYear(reportYear);setPeriod();}
      await dashboard();
    }catch(error){if(active(captured))feedback(reason(error),true);}
    finally{if(active(captured)){busy=false;buttons();}}
  }
  // Two-stage deletion: preview counts and totals from Supabase before any write.
  const deletePanel=document.createElement("section");
  deletePanel.id="rebateDeletePanel";
  deletePanel.className="rebateDeletePanel";
  deletePanel.hidden=true;
  deletePanel.innerHTML='<strong>CONFIRMAR ELIMINACIÓN DEL REPORTE</strong>'+
    '<p id="rebateDeleteDescription"></p><p id="rebateDeleteImpact"></p>'+
    '<div class="rebateActions"><button type="button" class="rebateButton" id="rebateDeleteCancel">Cancelar</button>'+
    '<button type="button" class="rebateButton rebateDeleteConfirm" id="rebateDeleteConfirm">Eliminar definitivamente</button></div>';
  $("rebateReportRows").insertAdjacentElement("beforebegin",deletePanel);
  let deletion=null;
  function hideDelete(){
    deletion=null;deletePanel.hidden=true;
    $("rebateDeleteDescription").textContent="";
    $("rebateDeleteImpact").textContent="";
  }
  async function prepareDelete(id){
    if(!authorized()||busy||loading)return;
    const detail=knownReports.get(id);
    if(!detail?.file_sha256){feedback("Actualiza el historial antes de eliminar.",true);return;}
    const captured=session();busy=true;buttons();feedback();hideDelete();
    try {
      const {data,error}=await supabaseClient.rpc("olon_delete_rebate_report",{
        p_report_id:id,p_expected_file_sha256:detail.file_sha256,p_dry_run:true
      });
      if(!active(captured))return;
      if(error)throw error;
      deletion={id,hash:detail.file_sha256,impact:data};
      $("rebateDeleteDescription").textContent="Archivo: "+data.file_name+" · "+number(data.linked_rows)+" órdenes asociadas.";
      $("rebateDeleteImpact").textContent="Se quitarán "+number(data.removed_rows)+" órdenes exclusivas ("+
        (data.currencies_removed||[]).map(c=>number(c.rebate)+" "+c.currency).join(" · ")+
        "). Se conservarán "+number(data.preserved_rows)+" órdenes compartidas. Esta acción no se puede deshacer.";
      deletePanel.hidden=false;
      deletePanel.scrollIntoView({behavior:"smooth",block:"nearest"});
    }catch(error){if(active(captured))feedback(reason(error),true);}
    finally{if(active(captured)){busy=false;buttons();}}
  }
  async function confirmDelete(){
    if(!deletion||!authorized()||busy)return;
    const captured=session();
    const selected=deletion;
    busy=true;buttons();feedback();
    try{
      const {data,error}=await supabaseClient.rpc("olon_delete_rebate_report",{
        p_report_id:selected.id,p_expected_file_sha256:selected.hash,p_dry_run:false
      });
      if(!active(captured))return;
      if(error)throw error;
      hideDelete();clearPreview();page=0;
      await dashboard();
      feedback("Reporte eliminado. "+number(data.removed_rows)+" órdenes exclusivas eliminadas y "+
        number(data.preserved_rows)+" compartidas conservadas.");
    }catch(error){if(active(captured))feedback(reason(error),true);}
    finally{if(active(captured)){busy=false;buttons();}}
  }
  $("rebateReportRows").addEventListener("click",event=>{
    const button=event.target.closest("[data-rebate-delete]");
    if(button)void prepareDelete(button.dataset.rebateDelete);
  });
  $("rebateDeleteCancel").addEventListener("click",hideDelete);
  $("rebateDeleteConfirm").addEventListener("click",()=>void confirmDelete());
  function activate() {if(authorized())void dashboard();}
  $("rebateChoose").addEventListener("click",()=>{if(authorized()&&!busy)$("rebateFile").click();});
  $("rebateFile").addEventListener("change",event=>void choose(event.target.files?.[0]));
  let pendingUpdate=null;
  $("rebateReportRows").addEventListener("click",event=>{
    const button=event.target.closest("[data-rebate-update]");
    if(!button||busy||loading||!authorized())return;
    const item=knownReports.get(button.dataset.rebateUpdate);
    if(!item?.file_sha256){feedback("No se pudo identificar la versión del reporte. Actualiza la lista.",true);return;}
    const row=button.closest(".rebateReport");
    pendingUpdate={id:item.id,hash:item.file_sha256,version:Number(item.version||1),name:row?.querySelector("strong")?.textContent||"reporte"};
    updateInput.value="";
    updateInput.click();
  });
  updateInput.addEventListener("change",event=>{
    const file=event.target.files?.[0],target=pendingUpdate;
    pendingUpdate=null;
    if(file&&target)void choose(file,target);
  });
  $("rebateClear").addEventListener("click",()=>{if(!busy)clearPreview();});
  $("rebateImport").addEventListener("click",()=>void importFile());
  $("rebateRefresh").addEventListener("click",()=>{feedback();void dashboard();});
  $("rebateApply").addEventListener("click",()=>{page=0;feedback();void dashboard();});
  $("rebateSearch").addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();page=0;void dashboard();}});
  $("rebatePrev").addEventListener("click",()=>{if(page>0){page--;void dashboard();}});
  $("rebateNext").addEventListener("click",()=>{if((page+1)*20<totalClients){page++;void dashboard();}});
  supabaseClient.auth.onAuthStateChange(event=>{if(event==="SIGNED_OUT")reset();});
  window.olonRebates={activate,onAdminReady:()=>{if(!loaded&&!loading)activate();}};
  buttons();
})();
