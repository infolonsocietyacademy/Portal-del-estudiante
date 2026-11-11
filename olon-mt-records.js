/* OLFX / MT4-MT5 read-only accounting. Student manual rows remain untouched in Supabase. */
(() => {
  "use strict";
  const PR = "America/Puerto_Rico";
  const core = window.olonAnalyticsCore;
  const body = document.getElementById("portal");
  const $ = id => document.getElementById(id);
  const dateParts = new Intl.DateTimeFormat("en-US", {timeZone:PR,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
  let owner=null,linked=false,account=null,syncState=null,lastSync=0,syncing=false,lastRows=[],error=null;
  let requestNumber=0;
  function prDate(value) {
    const timestamp=new Date(value);
    if(!Number.isFinite(timestamp.valueOf()))return null;
    const parts=Object.fromEntries(dateParts.formatToParts(timestamp).map(item=>[item.type,item.value]));
    return {date:parts.year+"-"+parts.month+"-"+parts.day,time:parts.hour+":"+parts.minute};
  }
  const number=x=>Number.isFinite(Number(x))?Number(x):0;
  function safeText(s){return String(s??"").slice(0,120)}
  const isTradeType=t=>t==="DEAL_TYPE_BUY"||t==="DEAL_TYPE_SELL"||t==="BUY"||t==="SELL";
  const isClose=e=>["DEAL_ENTRY_OUT","DEAL_ENTRY_OUT_BY","DEAL_ENTRY_INOUT"].includes(String(e||""));
  function normalize(deals) {
    const entryFees=new Map(),rows=[];
    const sorted=deals.slice().sort((a,b)=>String(a.occurred_at).localeCompare(String(b.occurred_at))||String(a.deal_id).localeCompare(String(b.deal_id)));
    for(const deal of sorted){
      const when=prDate(deal.occurred_at);
      if(!when)continue;
      const type=String(deal.deal_type||"").toUpperCase();
      const profit=number(deal.profit),commission=number(deal.commission),swap=number(deal.swap),fee=number(deal.fee);
      const position=safeText(deal.position_id||deal.order_id||deal.deal_id);
      const id="mt-"+safeText(deal.id);
      if(type==="DEAL_TYPE_BALANCE"||type==="BALANCE"){
        if(profit===0)continue;
        rows.push({id,date:when.date,created_at:deal.occurred_at,mt_record:true,kind:profit>0?"deposit":"withdrawal",
          entry_scope:"daily",deposit:Math.max(0,profit),withdrawal:Math.max(0,-profit),gain:0,loss:0,
          note:"Movimiento MT · "+(deal.comment?safeText(deal.comment):"balance")+" · #"+safeText(deal.deal_id)});
        continue;
      }
      if(!isTradeType(type))continue; // Credit, bonus, and broker adjustments are not trading results.
      let net=profit+commission+swap+fee;
      if(!isClose(deal.entry_type)){
        // Entry-side fees belong to their position; do not count entries as losing trades.
        if(net)entryFees.set(position,(entryFees.get(position)||0)+net);
        // Some MT4 brokers report closing deals without entryType.
        if(deal.entry_type || Math.abs(profit)<0.0000001)continue;
      }
      if(entryFees.has(position)){net+=entryFees.get(position);entryFees.delete(position);}
      const gain=Math.max(0,net),loss=Math.max(0,-net);
      rows.push({id,date:when.date,created_at:deal.occurred_at,mt_record:true,kind:"trading",entry_scope:"trade",
        trade_instrument:safeText(deal.symbol||"").toUpperCase(),trade_side:type.includes("BUY")?"sell":"buy",
        trade_time:when.time,trade_strategy:"",trade_session:"other",trade_risk:null,
        deposit:0,withdrawal:0,gain,loss,
        note:"Cierre MT · deal #"+safeText(deal.deal_id)+(deal.position_id?" · posición #"+safeText(deal.position_id):"")});
    }
    return rows.sort((a,b)=>a.date.localeCompare(b.date)||String(a.created_at).localeCompare(String(b.created_at))||a.id.localeCompare(b.id));
  }
  function setLinked(next) {
    linked=Boolean(next);
    body?.classList.toggle("olonMtLinked",linked);
    const heading=$("mtSyncStatus");
    if(heading)heading.hidden=!linked;
    if(linked && document.querySelector("#portal .page:not(.hidden)")?.id==="registro"){
      window.showPageById?.("historial");
    }
  }
  function showStatus() {
    const box=$("mtSyncStatus");
    if(!box)return;
    box.hidden=!linked;
    if(!linked)return;
    const synced=syncState?.last_success_at?new Date(syncState.last_success_at).toLocaleString("es-PR",{timeZone:PR}):"sin sincronizar";
    const coverage=syncState?.backfill_done?"Historial importado":"Importando historial antiguo por etapas";
    const extras=syncState?.last_error?" · Error de sincronización: "+safeText(syncState.last_error):"";
    box.textContent="MT4/MT5: fuente automática de resultados · "+coverage+" · Última actualización: "+synced+" · "+lastRows.length+" movimientos visibles"+extras;
  }
  async function loadData(id) {
    const results=[];
    const limit=750;
    for(let offset=0;offset<200000;offset+=limit){
      const {data,error}=await supabaseClient.from("olon_mt_deals")
        .select("id,deal_id,position_id,order_id,occurred_at,deal_type,entry_type,symbol,volume,profit,commission,swap,fee,comment")
        .eq("provider_account_id",account.provider_account_id)
        .order("occurred_at",{ascending:true}).order("id",{ascending:true})
        .range(offset,offset+limit-1);
      if(error)throw error;
      if(id!==owner)return [];
      results.push(...data||[]);
      if((data||[]).length<limit)break;
    }
    return results;
  }
  async function fetch(id) {
    if(!id||!core){setLinked(false);return null;}
    if(id!==owner){
      owner=id;account=null;syncState=null;lastRows=[];lastSync=0;error=null;setLinked(false);requestNumber++;
    }
    const request=++requestNumber;
    const {data:link,error:linkError}=await supabaseClient.from("olon_metaapi_accounts")
      .select("provider_account_id,provider_state,connection_status,platform,broker_server")
      .eq("student_id",id).maybeSingle();
    if(request!==requestNumber)return [];
    if(linkError){error="No se pudo comprobar la cuenta MT";setLinked(false);return null;}
    const usable=!!link?.provider_account_id && !["DRAFT","PENDING"].includes(String(link.provider_state||"").toUpperCase());
    if(!usable){account=null;lastRows=[];setLinked(false);return null;}
    account=link;setLinked(true);
    try{
      const {data:state}=await supabaseClient.from("olon_mt_sync_state").select("*")
        .eq("provider_account_id",account.provider_account_id).maybeSingle();
      if(request!==requestNumber)return [];
      syncState=state;
      const deals=await loadData(id);
      if(request!==requestNumber)return [];
      lastRows=normalize(deals);
      showStatus();
    }catch(e){
      error="No se pudieron cargar los resultados reales.";
      showStatus();
      // Never fall back to legacy manual totals for a linked MT account.
    }
    if(Date.now()-lastSync>180000 && !syncing && link.connection_status==="CONNECTED"){
      lastSync=Date.now();
      void refresh(id);
    }
    return lastRows.slice();
  }
  async function refresh(id=owner) {
    if(syncing||!linked||id!==owner)return;
    syncing=true;
    showStatus();
    try{
      const {data,error:callError}=await supabaseClient.functions.invoke("olon-mt-history",{body:{action:"sync"}});
      if(callError||data?.error)throw new Error(data?.error||"Sincronización temporalmente no disponible");
      if(id===owner && !data?.throttled && !data?.error)await window.render?.();
    }catch(e){error=String(e?.message||e).slice(0,160);console.warn("OLFX MT data sync:",error);}
    finally{syncing=false;showStatus();}
  }
  function afterRender(){
    if(!linked)return;
    // Real account balance should not be approximated from historical deposit records.
    const element=$("mBalance");
    if(element&&syncState?.balance!=null) {
      const currency=String(syncState.currency||"USD");
      element.textContent=new Intl.NumberFormat("en-US",{style:"currency",currency:currency==="USD"?"USD":"USD"}).format(number(syncState.balance))+(currency==="USD"?"":" "+currency);
      element.title="Balance consultado directamente desde MT4/MT5, no calculado desde depósitos manuales";
    }
  }
  function linkedNow(){return linked;}
  document.addEventListener("click",event=>{
    if(!linked)return;
    const link=event.target.closest("[data-record-open],[data-record-edit],[data-record-delete]");
    if(link){event.preventDefault();event.stopImmediatePropagation();window.showPageById?.("historial");}
  },true);
  window.olonMtRecords={fetch,refresh,afterRender,linked:linkedNow};
})();
