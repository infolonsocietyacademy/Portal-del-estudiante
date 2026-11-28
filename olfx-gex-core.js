/* OLFX GEX data preparation. No provider scripts are executed. */
(function (root) {
  'use strict';
  const groups = [
    {id:'walls', label:'Call / Put', match:/^(Call|Put) Wall( \d+)?$/},
    {id:'flip', label:'GEX Flip', match:/^GEX Flip$/},
    {id:'zero', label:'0DTE', match:/0DTE/},
    {id:'dealer', label:'Dealer', match:/^(Vol Trigger|Risk Pivot|cTrans|pTrans|Vanna Flip)/},
    {id:'dex', label:'DEX', match:/^DEX/},
    {id:'pin', label:'Pin / Max Pain', match:/^(Charm Magnet|Pin Strike|Max Pain)/},
    {id:'em', label:'Expected Move', match:/^EM /},
    {id:'sr', label:'Support / Resistance', match:/^(Support|Resistance)/}
  ];
  const ny = new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',hourCycle:'h23',hour:'2-digit',minute:'2-digit',weekday:'short'});
  const validNumber = n => typeof n === 'number' && Number.isFinite(n);
  function bars(raw, minutes, session) {
    const buckets = new Map(), step = minutes * 60;
    for (const b of (Array.isArray(raw) ? raw : []).filter(Array.isArray).slice().sort((a,b) => a[0]-b[0])) {
      if (!Array.isArray(b) || b.length < 5 || !b.slice(0,5).every(validNumber) || b[0] <= 0 || b[2] < Math.max(b[1],b[3],b[4]) || b[3] > Math.min(b[1],b[2],b[4])) continue;
      if (session === 'rth') {
        const p = Object.fromEntries(ny.formatToParts(new Date(b[0]*1000)).map(x => [x.type,x.value]));
        const m = Number(p.hour)*60+Number(p.minute);
        if (p.weekday === 'Sat' || p.weekday === 'Sun' || m < 570 || m >= 960) continue;
      }
      const time = Math.floor(b[0]/step)*step, prior = buckets.get(time);
      if (prior) {prior.high=Math.max(prior.high,b[2]);prior.low=Math.min(prior.low,b[3]);prior.close=b[4];}
      else buckets.set(time,{time,open:b[1],high:b[2],low:b[3],close:b[4]});
    }
    return [...buckets.values()];
  }
  function levels(data) {
    const list = (Array.isArray(data?.levels) ? data.levels : []).filter(l => typeof l.label === 'string' && validNumber(l.price) && l.price > 0).map(l => ({label:l.label.slice(0,80),price:l.price,group:groups.find(g => g.match.test(l.label))?.id || 'dealer'}));
    if (validNumber(data?.prev_close) && validNumber(data?.em_daily) && data.em_daily > 0) {
      list.push({label:'EM High',price:data.prev_close+data.em_daily,group:'em'}, {label:'EM Low',price:data.prev_close-data.em_daily,group:'em'});
    }
    return list;
  }
  function exposure(raw) {
    const prices = new Map();
    for (const row of Array.isArray(raw) ? raw : []) {
      if (!Array.isArray(row) || row.length < 3 || !row.slice(0,3).every(validNumber) || row[0] <= 0) continue;
      const item = prices.get(row[0]) || {price:row[0],call:0,put:0};
      item.call += Math.abs(row[1]); item.put += Math.abs(row[2]); prices.set(row[0],item);
    }
    const rows = [...prices.values()].filter(r=>r.call+r.put>0).sort((a,b)=>a.price-b.price);
    const max = Math.max(1,...rows.map(r=>r.call+r.put));
    return rows.map(r=>({...r,total:r.call+r.put,strength:(r.call+r.put)/max}));
  }
  const api = {groups,bars,levels,exposure,validNumber};
  if (typeof module === 'object' && module.exports) module.exports=api;
  else root.OLFXGexData=api;
})(typeof window !== 'undefined' ? window : globalThis);
