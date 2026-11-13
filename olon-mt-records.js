/* OLFX / MT4-MT5 read-only accounting. Student manual rows remain untouched in Supabase. */
(() => {
  "use strict";
  const PR = "America/Puerto_Rico";
  const core = window.olonAnalyticsCore;
  const body = document.getElementById("portal");
  const $ = id => document.getElementById(id);
  const dateParts = new Intl.DateTimeFormat("en-US", {timeZone:PR,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
  let owner=null,linked=false,account=null,syncState=null,lastSync=0,syncing=false,lastRows=[],error=null;
  let requestNumber=0,viewingArchive=false,currentVault=null;
  let fetchedAt=0;
  function invalidate(){fetchedAt=0;}
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
    // Never navigate away automatically when a MetaTrader account connects or refreshes.
  }
  function showStatus() {
    const box=$("mtSyncStatus");
    if(!box)return;
    box.hidden=!linked;
    if(!linked)return;
    const synced=syncState?.last_success_at?new Date(syncState.last_success_at).toLocaleString("es-PR",{timeZone:PR}):"sin sincronizar";
    const coverage=viewingArchive?"Cuenta archivada · solo lectura":account?.source==="olfx-own"
      ?(syncState?.backfill_done?"OLFX CONNECT · historial disponible (hasta 365 días)":"OLFX CONNECT · sincronización pendiente")
      :syncState?.backfill_done?"Historial importado":"Importando historial antiguo por etapas";
    const extras=!viewingArchive&&syncState?.last_error?" · Error de sincronización: "+safeText(syncState.last_error):"";
    box.textContent="Cuenta MT5 seleccionada: "+safeText(account?.login_masked||"") +" · "+safeText(account?.broker_server||"") +" · "+coverage+(viewingArchive?"":" · Última actualización: "+synced+(account?.source==="olfx-own"?" · Próxima sincronización: cuando Python se ejecute en Windows":" · Próxima sincronización: después del cierre NY, días hábiles"))+" · "+lastRows.length+" movimientos visibles"+extras;
    const button=document.createElement("button");
    button.type="button";
    button.className="btn secondary mtManualRefresh";
    button.textContent=syncing?"Cargando…":"Recargar historial guardado";
    button.disabled=syncing||viewingArchive;
    button.hidden=viewingArchive;
    button.addEventListener("click",()=>void refresh());
    box.append(button);
  }
  async function loadData(id) {
    const results=[];
    const limit=900; // Paginar toda la cuenta para no superar límites de PostgREST.
    for(let offset=0;offset<200000;offset+=limit){
      let query=supabaseClient.from("olon_mt_deals")
        .select("id,deal_id,position_id,order_id,occurred_at,deal_type,entry_type,symbol,volume,profit,commission,swap,fee,comment")
        .eq("student_id",id);
      query=account.vault_account_id
        ? query.eq("vault_account_id",account.vault_account_id)
        : query.eq("provider_account_id",account.provider_account_id);
      const {data,error}=await query
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
    if(!id||!core){lastRows=[];account=null;setLinked(false);return [];}
    // Avoid repeating thousands of trade rows on every dashboard goal/theme redraw.
    if(id===owner&&fetchedAt&&Date.now()-fetchedAt<45000)return lastRows.slice();
    if(id!==owner){
      owner=id;account=null;syncState=null;lastRows=[];lastSync=0;error=null;
      viewingArchive=false;currentVault=null;
      fetchedAt=0;setLinked(false);requestNumber++;
    }
    const request=++requestNumber;
    // ONLY the MT5 account explicitly selected in OLFX CONNECT may populate
    // Resumen / Resultados / Calendario / Historial. Never fall back to other
    // Axi accounts or disconnected legacy MetaApi accounts.
    const {data:chosen,error:chosenError}=await supabaseClient.from("olon_own_accounts")
      .select("id,provider_account_id,vault_account_id,platform,broker_server,status,last_sync_at,is_primary")
      .eq("student_id",id).neq("status","revoked")
      .order("is_primary",{ascending:false}).order("created_at",{ascending:false}).limit(1);
    if(request!==requestNumber)return [];
    if(chosenError){
      error="No se pudo comprobar tu cuenta MT5 seleccionada.";
      lastRows=[];account=null;syncState=null;setLinked(false);return [];
    }
    const own=chosen?.[0]||null;
    const ownActive=own?.platform==="mt5"&&own.status==="active"&&
      Boolean(own.last_sync_at)&&Boolean(own.provider_account_id);
    if(!ownActive){
      account=null;lastRows=[];syncState=null;currentVault=null;
      setLinked(false);fetchedAt=Date.now();return [];
    }
    let verifiedVault=null;
    if(own.vault_account_id){
      const {data:vault,error:vaultErr}=await supabaseClient.from("olon_mt_vault_accounts")
        .select("id,student_id,platform,broker_server,login_masked,active_provider_account_id")
        .eq("id",own.vault_account_id).eq("student_id",id).eq("platform","mt5").maybeSingle();
      if(request!==requestNumber)return [];
      if(vaultErr||!vault||String(vault.broker_server).toLowerCase()!==String(own.broker_server).toLowerCase()
        ||vault.active_provider_account_id!==own.provider_account_id){
        error="La identidad de la cuenta MT5 no coincide con el historial guardado.";
        lastRows=[];account=null;syncState=null;currentVault=null;setLinked(false);return [];
      }
      verifiedVault=vault;
    }
    currentVault=verifiedVault;viewingArchive=false;
    account={
      source:"olfx-own",account_id:own.id,
      vault_account_id:verifiedVault?.id||null,
      provider_account_id:own.provider_account_id,
      broker_server:own.broker_server,
      login_masked:verifiedVault?.login_masked||"MT5",archived:false
    };
    setLinked(true);
    try{
      let state=null;
      if(!viewingArchive&&account.provider_account_id){
        const result=await supabaseClient.from("olon_mt_sync_state").select("*")
          .eq("provider_account_id",account.provider_account_id).maybeSingle();
        if(result.error)throw result.error;
        state=result.data;
      }
      if(request!==requestNumber)return [];
      syncState=state;
      const deals=await loadData(id);
      if(request!==requestNumber)return [];
      lastRows=normalize(deals);
      fetchedAt=Date.now();
      showStatus();
    }catch(e){
      error="No se pudieron cargar los resultados reales.";
      lastRows=[];showStatus();
      // An unexpected read error never falls back to old manual figures.
    }
    return lastRows.slice();
  }
  function selectVault(id=null){
    if(id!==null&&!/^[0-9a-f-]{36}$/i.test(String(id)))return;
    if(id)window.olonOwnVaultOpen?.(id);
    else{invalidate();void window.render?.();}
  }
  function selectedAccount(){return currentVault?.id??null;}
  async function refresh(id=owner) {
    if(syncing||!linked||id!==owner)return;
    syncing=true;
    showStatus();
    try {
      // Reload data already in Supabase. Do not invoke paid MetaApi while market is open.
      invalidate();
      await window.render?.();
    } catch(e) {
      error=String(e?.message||e).slice(0,160);
      console.warn("OLFX historial guardado:",error);
    } finally {
      syncing=false;
      showStatus();
    }
  }
  function afterRender(){
    if(!linked||viewingArchive)return;
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
  window.olonMtRecords={fetch,refresh,afterRender,linked:linkedNow,selectVault,selectedAccount,invalidate};
})();
