/* Follow completed MT5 snapshots without changing the student's open page. */
(()=>{
  'use strict';
  const pages=new Set(['dashboard','comparacion','historial','metaapiAccountsPage']);
  const interval=15000;
  let timer=null,inFlight=false,rendering=false,renderingKey='',pending=null,applied='',requested='',requestedAt=0;
  const account=()=>typeof currentUser!=='undefined'?currentUser:null;
  function visible(){
    return account()?.role==='student'&&!document.hidden&&
      !document.getElementById('portal')?.classList.contains('hidden')&&
      pages.has(document.querySelector('#portal .page:not(.hidden)')?.id);
  }
  function schedule(delay=5000){
    clearTimeout(timer);timer=null;
    if(visible())timer=setTimeout(()=>{timer=null;void tick();},delay);
  }
  async function updateLedger(){
    if(rendering)return;
    rendering=true;
    try{
      while(pending){
        const next=pending;pending=null;
        if(account()?.id!==next.owner||!visible())continue;
        renderingKey=next.key;
        window.olonMtRecords?.invalidate?.();
        await window.render?.();
        if(account()?.id===next.owner){
          applied=next.key;
          window.dispatchEvent(new CustomEvent('olon:mt5-updated',{detail:{accountId:next.accountId}}));
        }
      }
    }catch(error){
      console.warn('[OLFX] No se pudo actualizar la vista MT5',error?.name||'error');
    }finally{rendering=false;renderingKey='';}
  }
  function received(result){
    if(!visible()||!Array.isArray(result?.accounts))return;
    if(timer===null&&!inFlight)schedule(0);
    const primary=result.accounts.find(a=>a.is_primary)||result.accounts[0];
    if(!primary||primary.status!=='active'||!primary.last_sync_at)return;
    const legacyRevision=JSON.stringify([primary.total_deals,primary.balance,primary.closed_trades,primary.wins,primary.losses,
      primary.net_profit,primary.today_net,primary.week_net,primary.month_net,primary.deposits,primary.withdrawals,
      primary.transfer_in,primary.transfer_out,primary.balance_adjustments,primary.fees,primary.last_closed_trade_at]);
    const key=[account().id,primary.id,primary.history_revision||legacyRevision,primary.source_version||1,
      window.olonMtRecords?.today?.()||''].join('|');
    if(key===applied){window.olonMtRecords?.updateSnapshot?.(primary);return;}
    if(key===pending?.key||key===renderingKey)return;
    pending={owner:account().id,key,accountId:primary.id};
    void updateLedger();
  }
  async function request(primary){
    if(!primary?.id||primary.status==='waiting')return;
    requested=primary.id;requestedAt=Date.now();
    await window.olonRequestMt5Sync(primary.id);
  }
  async function tick(force=false){
    if(inFlight||!visible())return;
    if(typeof window.olonOwnAccountStatus!=='function')return schedule();
    inFlight=true;
    const owner=account().id;
    let delay=5000;
    try{
      const state=await window.olonOwnAccountStatus();
      if(account()?.id!==owner||!visible())return;
      received(state);
      const primary=state.accounts?.find(a=>a.is_primary)||state.accounts?.[0];
      if(primary?.status==='waiting')delay=2000;
      else if(primary&&(force||primary.status==='active')&&(force||!primary.last_error)&&
        (force||((requested!==primary.id||Date.now()-requestedAt>=interval)&&Date.now()-Date.parse(primary.last_sync_at)>=interval))){
        await request(primary);
        delay=2000;
      }
    }catch(error){
      delay=10000;
      console.warn('[OLFX] Lectura MT5 pendiente',error?.name||'error');
    }finally{inFlight=false;schedule(delay);}
  }
  window.olonMt5Live={refresh:()=>tick(true)};
  window.addEventListener('olon:mt5-status',event=>received(event.detail));
  window.addEventListener('olon:pagechange',()=>schedule(0));
  window.addEventListener('pagehide',()=>{clearTimeout(timer);timer=null;});
  window.addEventListener('pageshow',()=>schedule(0));
  document.addEventListener('visibilitychange',()=>schedule(0));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>schedule(0),{once:true});
  else schedule(0);
})();
