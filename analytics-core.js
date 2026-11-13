/* OLON performance math. Amounts are net, closed results in USD. */
(function(root, factory){
  const api = factory();
  if(typeof module === "object" && module.exports) module.exports = api;
  else root.olonAnalyticsCore = api;
})(typeof window !== "undefined" ? window : globalThis, function(){
  "use strict";
  const cents = n => Math.round((Number(n) || 0) * 100);
  const key = s => String(s || "").trim().replace(/\s+/g," ").toLocaleUpperCase("es");
  const trading = r => (r.kind ?? r.record_kind) ? (r.kind ?? r.record_kind) === "trading" : !Number(r.deposit) || Boolean(Number(r.gain) || Number(r.loss));
  const trade = r => trading(r) && r.entry_scope === "trade";
  const net = r => (cents(r.gain) - cents(r.loss)) / 100;
  const date = r => r.date || r.record_date || "";
  const compare = (a,b) => date(a).localeCompare(date(b))
    || String(a.trade_time || "00:00").localeCompare(String(b.trade_time || "00:00"))
    || String(a.created_at || "").localeCompare(String(b.created_at || ""))
    || String(a.id || "").localeCompare(String(b.id || ""));
  const iso = d => d.toISOString().slice(0,10);
  const notePrefix="[OLON:TRADE:1]";
  const emptyDetails=()=>({entry_scope:"daily",trade_instrument:"",trade_strategy:"",trade_side:"",trade_risk:null,trade_time:"",trade_session:""});
  // The existing private note field persists typed trade details without new DB grants.
  // Notes are decoded before display, editing, reporting or any statistics calculation.
  function decodeNote(value){
    const note=String(value || ""),fallback={note,...emptyDetails()};
    if(!note.startsWith(notePrefix)) return fallback;
    const line=note.indexOf("\n");
    if(line<0 || line>1500) return fallback;
    try{
      const meta=JSON.parse(note.slice(notePrefix.length,line));
      if(meta.entry_scope!=="trade" || typeof meta.trade_instrument!=="string" || !key(meta.trade_instrument) || key(meta.trade_instrument).length>32) return fallback;
      const risk=meta.trade_risk==null ? null : Number(meta.trade_risk);
      if(risk!==null && (!Number.isFinite(risk) || risk<=0 || risk>1e12)) return fallback;
      if(meta.trade_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(meta.trade_time)) return fallback;
      return {note:note.slice(line+1),entry_scope:"trade",trade_instrument:key(meta.trade_instrument),
        trade_strategy:typeof meta.trade_strategy==="string"?key(meta.trade_strategy).slice(0,60):"",
        trade_side:["buy","sell"].includes(meta.trade_side)?meta.trade_side:"",trade_risk:risk,
        trade_time:meta.trade_time || "",trade_session:["asia","london","ny_am","ny_pm","other"].includes(meta.trade_session)?meta.trade_session:""};
    }catch{return fallback;}
  }
  function encodeNote(note,metadata){
    if(metadata.entry_scope!=="trade") return String(note || "");
    return notePrefix+JSON.stringify({entry_scope:"trade",trade_instrument:metadata.trade_instrument,
      trade_strategy:metadata.trade_strategy || "",trade_side:metadata.trade_side || "",trade_risk:metadata.trade_risk ?? null,
      trade_time:metadata.trade_time || "",trade_session:metadata.trade_session || ""})+"\n"+String(note || "");
  }
  // If an older app session adds a daily summary after individual trades, retain
  // that record for editing but use the individual trades once in account totals.
  function accountingRows(records){
    const individualDates=new Set(records.filter(trade).map(date));
    return records.map(r=>trading(r) && !trade(r) && individualDates.has(date(r))
      ? {...r,gain:0,loss:0,kind:r.deposit?"deposit":r.withdrawal?"withdrawal":"excluded",excluded_summary:true} : r);
  }
  function today(){
    const p = new Intl.DateTimeFormat("en-US",{timeZone:"America/Puerto_Rico",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
    const v = t => p.find(x => x.type === t).value;
    return `${v("year")}-${v("month")}-${v("day")}`;
  }
  function validDate(s){
    return /^\d{4}-\d{2}-\d{2}$/.test(s || "") && Number.isFinite(Date.parse(s + "T00:00:00Z")) && iso(new Date(s + "T00:00:00Z")) === s;
  }
  function range(period, now = today(), from = "", to = ""){
    if(!validDate(now)) throw new Error("Fecha de referencia inválida");
    const d = new Date(now + "T00:00:00Z");
    if(period === "custom"){
      if(!validDate(from) || !validDate(to) || from > to) return {valid:false,start:from,end:to};
      return {valid:true,start:from,end:to};
    }
    let start = "";
    if(period === "week") { d.setUTCDate(d.getUTCDate() - (d.getUTCDay()+6)%7); start = iso(d); }
    else if(period === "month") start = now.slice(0,7) + "-01";
    else if(period === "year") start = now.slice(0,4) + "-01-01";
    return {valid:true,start,end:now};
  }
  function filter(records, selection = {}, now = today()){
    const bounds = range(selection.period || "all", now, selection.from, selection.to);
    if(!bounds.valid) return [];
    return records.filter(r => trading(r) && validDate(date(r)) && (!bounds.start || date(r) >= bounds.start) && date(r) <= bounds.end
      && (!selection.instrument || key(r.trade_instrument) === key(selection.instrument))
      && (!selection.strategy || key(r.trade_strategy) === key(selection.strategy))
      && (!selection.side || r.trade_side === selection.side)
      && (!selection.session || r.trade_session === selection.session)).sort(compare);
  }
  function stats(records){
    const rows = records.filter(trade).slice().sort(compare);
    let wins=0,losses=0,flat=0,positive=0,negative=0,equity=0,peak=0,drawdown=0;
    let winRun=0,lossRun=0,maxWins=0,maxLosses=0,rTotal=0,rCount=0;
    for(const r of rows){
      const n = cents(r.gain) - cents(r.loss);
      if(n>0){ wins++;positive+=n;winRun++;lossRun=0; }
      else if(n<0){ losses++;negative-=n;lossRun++;winRun=0; }
      else{ flat++;winRun=lossRun=0; }
      maxWins=Math.max(maxWins,winRun);maxLosses=Math.max(maxLosses,lossRun);
      equity+=n;peak=Math.max(peak,equity);drawdown=Math.max(drawdown,peak-equity);
      const risk = Number(r.trade_risk);
      if(Number.isFinite(risk) && risk>0){ rTotal+=(n/100)/risk;rCount++; }
    }
    const total=rows.length, decisive=wins+losses;
    return {total,wins,losses,flat,net:(positive-negative)/100,grossProfit:positive/100,grossLoss:negative/100,
      winrate:decisive ? wins/decisive*100 : null,
      profitFactor:negative ? positive/negative : positive ? Infinity : null,
      expectancy:total ? (positive-negative)/100/total : null,
      avgWin:wins ? positive/100/wins : null,avgLoss:losses ? negative/100/losses : null,
      avgR:rCount ? rTotal/rCount : null,rCount,drawdown:drawdown/100,maxWins,maxLosses,
      currentStreak:winRun ? {type:"win",count:winRun} : lossRun ? {type:"loss",count:lossRun} : {type:"flat",count:flat ? 1 : 0}};
  }
  function days(records){
    const map=new Map();
    for(const r of accountingRows(records).filter(trading)){
      const d=date(r);map.set(d,(map.get(d)||0)+cents(r.gain)-cents(r.loss));
    }
    const values=[...map.values()];
    const wins=values.filter(n=>n>0).length,losses=values.filter(n=>n<0).length,flat=values.filter(n=>n===0).length;
    return {total:values.length,wins,losses,flat,winrate:wins+losses ? wins/(wins+losses)*100 : null,
      net:values.reduce((s,n)=>s+n,0)/100,best:values.length ? Math.max(...values)/100 : null,worst:values.length ? Math.min(...values)/100 : null};
  }
  // Cash movements shift both balance and high-water mark; they never create a trading loss.
  // Percentages are available only while the recorded funded high-water mark is positive.
  function accountDrawdown(records, bounds){
    let balance=0,peak=0,max=0,maxPct=null,nav=1,navPeak=1,funded=false;
    for(const r of accountingRows(records).sort(compare)){
      if(date(r)>bounds.end) continue;
      const flow=cents(r.deposit)-cents(r.withdrawal)+cents(r.transfer_in)-cents(r.transfer_out)+cents(r.balance_adjustment);
      if(cents(r.deposit)>0||cents(r.transfer_in)>0) funded=true;
      balance+=flow;peak+=flow;
      if(bounds.start && date(r)<bounds.start){ balance+=trading(r) ? cents(r.gain)-cents(r.loss) : 0;peak=balance;continue; }
      if(trading(r)){
        const result=cents(r.gain)-cents(r.loss);
        if(funded && balance>0 && nav>0){
          nav*=1+result/balance;navPeak=Math.max(navPeak,nav);
          maxPct=Math.max(maxPct ?? 0,(navPeak-nav)/navPeak*100);
        }
        balance+=result;
      }
      peak=Math.max(peak,balance);
      const dd=peak-balance;max=Math.max(max,dd);
    }
    return {amount:max/100,percent:maxPct};
  }
  const sessions={asia:"Asia",london:"Londres",ny_am:"Nueva York AM",ny_pm:"Nueva York PM",other:"Otra sesión"};
  function groups(records, dimension){
    const grouped=new Map();
    for(const r of records.filter(trade)){
      let label;
      if(dimension === "strategy") label=key(r.trade_strategy)||"SIN ESTRATEGIA";
      else if(dimension === "session") label=sessions[r.trade_session]||"Sin sesión";
      else if(dimension === "hour") label=r.trade_time ? r.trade_time.slice(0,2)+":00–"+r.trade_time.slice(0,2)+":59" : "Sin hora";
      else label=key(r.trade_instrument)||"SIN ACTIVO";
      if(!grouped.has(label)) grouped.set(label,[]);
      grouped.get(label).push(r);
    }
    return [...grouped].map(([label,rows])=>({label,...stats(rows)})).sort((a,b)=>b.net-a.net || b.total-a.total || a.label.localeCompare(b.label));
  }
  return {today,validDate,range,filter,stats,days,groups,accountDrawdown,key,trading,trade,net,date,compare,sessions,decodeNote,encodeNote,accountingRows};
});
