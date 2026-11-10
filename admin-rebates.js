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
  let parsed=null,requestId=null,plan=null,assetPromise=null;
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
    $("rebateChoose").disabled=busy;
    $("rebateRefresh").disabled=busy||loading;
    $("rebateApply").disabled=busy||loading;
    $("rebateClear").disabled=busy;
    $("rebateImport").disabled=busy||!plan||plan.already_imported||Number(plan.new_rows)===0;
    $("rebateImport").textContent=busy?"Procesando…":plan?"Importar "+number(plan.new_rows)+" registros nuevos":"Importar y sumar";
    $("rebatePrev").disabled=loading||page===0;
    $("rebateNext").disabled=loading||(page+1)*20>=totalClients;
  }
  function clearPreview() {
    parsed=null;plan=null;requestId=null;$("rebateFile").value="";$("rebatePreview").hidden=true;
    $("rebatePreviewClients").replaceChildren();$("rebatePreviewName").textContent="";buttons();
  }
  function reset() {
    epoch++;ticket++;owner=null;page=0;totalClients=0;busy=false;loading=false;loaded=false;clearPreview();
    ["rebateTotalLots","rebateEarningLots","rebateTotalRows","rebateTotalClients","rebateRange"].forEach(id=>$(id).textContent="—");
    $("rebateTotalAmount").replaceChildren();$("rebateClientRows").replaceChildren();$("rebateReportRows").replaceChildren();
    $("rebateFrom").value="";$("rebateTo").value="";$("rebateSearch").value="";
    $("rebatePager").hidden=true;$("rebateEmpty").hidden=false;feedback();buttons();
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
      $("rebateReportRows").innerHTML=(data.reports||[]).map(row=>'<article class="rebateReport"><div><strong>'+esc(row.file_name)+'</strong><small>'+date(row.first_date)+' — '+date(row.last_date)+'</small></div><div><span>'+number(row.inserted_rows)+' nuevos</span><small>'+number(row.duplicate_rows)+' repetidos'+(row.conflict_rows?' · '+number(row.conflict_rows)+' con diferencias':"")+'</small></div></article>').join("") || '<p class="rebateHint">Cada importación aparecerá aquí con su período y los registros añadidos.</p>';
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
      await loadScript("./rebates/xlsx-reader.js?v=20261110-axi-xml-fix-1",()=>!!window.olonRebateReader);
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
    let message=plan.already_imported?"Este archivo ya se importó. Sus registros siguen incluidos una sola vez.":number(plan.duplicate_rows)+" registros ya existentes se omitirán.";
    if(plan.conflict_rows)message+=" "+number(plan.conflict_rows)+" órdenes tienen importes distintos a los guardados y se omitirán para revisión.";
    if(plan.repeated_in_file)message+=" "+number(plan.repeated_in_file)+" filas repetidas dentro del Excel se contarán una sola vez.";
    $("rebatePreviewStatus").textContent=message;
    $("rebatePreviewWarnings").textContent=parsed.warnings.join(" ");
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
  async function choose(file) {
    if(!file||!authorized()||busy)return;
    const captured=session();clearPreview();feedback();busy=true;buttons();
    $("rebateUploadStatus").textContent="Leyendo y comprobando el Excel…";
    try {
      await assets();
      const result=await window.olonRebateReader.read(file);
      if(!active(captured))return;
      parsed=result;requestId=crypto.randomUUID();
      const {data,error}=await supabaseClient.rpc("olon_import_rebate_report",rpcArgs(true));
      if(!active(captured))return;
      if(error)throw error;
      plan=data;preview();
      $("rebatePreview").scrollIntoView({behavior:"smooth",block:"start"});
    }catch(error){if(active(captured)){clearPreview();feedback(reason(error),true);}}
    finally{if(active(captured)){busy=false;$("rebateUploadStatus").textContent="Excel .xlsx · Hasta 10 MB y 5,000 registros por archivo";buttons();}}
  }
  async function importFile() {
    if(!authorized()||busy||!parsed||!plan||!Number(plan.new_rows))return;
    const captured=session();busy=true;feedback();buttons();
    try {
      const {data,error}=await supabaseClient.rpc("olon_import_rebate_report",rpcArgs(false));
      if(!active(captured))return;
      if(error)throw error;
      const message=data.already_imported?"Este archivo ya estaba importado. El acumulado se conserva sin duplicados.":number(data.new_rows)+" registros añadidos al acumulado. "+number(data.duplicate_rows)+" repetidos omitidos."+(data.conflict_rows?" "+number(data.conflict_rows)+" con diferencias se omitieron para revisión.":"");
      clearPreview();feedback(message);page=0;await dashboard();
    }catch(error){if(active(captured))feedback(reason(error),true);}
    finally{if(active(captured)){busy=false;buttons();}}
  }
  function activate() {if(authorized())void dashboard();}
  $("rebateChoose").addEventListener("click",()=>{if(authorized()&&!busy)$("rebateFile").click();});
  $("rebateFile").addEventListener("change",event=>void choose(event.target.files?.[0]));
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
