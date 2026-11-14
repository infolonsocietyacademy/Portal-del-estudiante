/* OLFX / MT4-MT5 read-only accounting. Student manual rows remain untouched in Supabase. */
(() => {
  "use strict";
  const PR = "America/Puerto_Rico";
  const core = window.olonAnalyticsCore;
  const body = document.getElementById("portal");
  const $ = id => document.getElementById(id);
  let owner=null,linked=false,account=null,syncState=null,lastSync=0,syncing=false,lastRows=[],error=null;
  let requestNumber=0,viewingArchive=false,currentVault=null;
  let fetchedAt=0;
  function invalidate(){fetchedAt=0;}
  const ledger=window.olonMt5Ledger;
  let rawDeals=[],rawScope=null,completedSnapshot=null;
  const number=x=>Number.isFinite(Number(x))?Number(x):0;
  const safeText=s=>String(s??"").slice(0,120);
  const normalize=deals=>ledger.normalize(deals);
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
  async function loadData(id,changedSince=null) {
    const results=[];
    const limit=900; // Paginar toda la cuenta para no superar límites de PostgREST.
    for(let offset=0;offset<200000;offset+=limit){
      let query=supabaseClient.from("olon_mt_deals")
        .select("id,deal_id,position_id,order_id,occurred_at,broker_time,deal_type,entry_type,symbol,volume,profit,commission,swap,fee,comment,imported_at,provider_account_id")
        .eq("student_id",id);
      query=account.vault_account_id
        ? query.eq("vault_account_id",account.vault_account_id)
        : query.eq("provider_account_id",account.provider_account_id);
      if(account.source_version>=2)query=query.eq("provider_account_id",account.provider_account_id);
      if(changedSince)query=query.gte("imported_at",changedSince);
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
    if(!id||!core||!ledger){lastRows=[];account=null;setLinked(false);return [];}
    // Avoid repeating thousands of trade rows on every dashboard goal/theme redraw.
    if(id!==owner){
      owner=id;account=null;syncState=null;lastRows=[];lastSync=0;error=null;
      rawDeals=[];rawScope=null;completedSnapshot=null;
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
    const ownActive=own?.platform==="mt5"&&["active","waiting","error"].includes(own.status)&&
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
      status:own.status,broker_server:own.broker_server,
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
      account.source_version=Number(state?.source_version||1);
      const scope=[id,account.vault_account_id,account.provider_account_id,account.source_version].join("|");
      const revision=state?.last_success_at||own.last_sync_at;
      if(scope!==rawScope||revision!==completedSnapshot){
        const incremental=scope===rawScope&&completedSnapshot;
        const since=incremental?new Date(Date.parse(completedSnapshot)-1000).toISOString():null;
        const incoming=await loadData(id,since);
        if(request!==requestNumber)return [];
        if(incremental){
          const merged=new Map(rawDeals.map(d=>[String(d.deal_id),d]));
          incoming.forEach(d=>merged.set(String(d.deal_id),d));
          rawDeals=[...merged.values()];
        }else rawDeals=incoming;
        rawScope=scope;completedSnapshot=revision;
        lastRows=normalize(rawDeals);
      }
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
  window.olonMtRecords={fetch,refresh,afterRender,linked:linkedNow,selectVault,selectedAccount,invalidate,
    today:()=>linked?ledger.today(rawDeals):null,
    updateSnapshot:next=>{
      if(!linked||next.id!==account?.account_id)return;
      if(next.history_revision?next.history_revision!==syncState?.history_revision:account.source_version>=2)return;
      syncState={...syncState,balance:next.balance,equity:next.equity,last_success_at:next.last_sync_at};
      completedSnapshot=next.last_sync_at;
      afterRender();
    },
    snapshot:()=>linked?{...syncState,provider_account_id:account?.provider_account_id}:null};
})();
