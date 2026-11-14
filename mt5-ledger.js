/* The account ledger retains MT5's own dates, amounts and ticket identities. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.olonMt5Ledger=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const number=v=>Number.isFinite(Number(v))?Number(v):0;
  const text=v=>String(v??'').slice(0,180);
  const round=v=>Math.round((v+Number.EPSILON)*100)/100;
  function timestamp(deal){
    const original=String(deal.broker_time||'').replace('T',' ');
    const raw=original||String(deal.occurred_at||'').replace('T',' ');
    const match=/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?/.exec(raw);
    if(!match||!Number.isFinite(Date.parse(match[1]+'T00:00:00Z'))||new Date(match[1]+'T00:00:00Z').toISOString().slice(0,10)!==match[1])return null;
    return {date:match[1],time:match[2],label:'MT5'};
  }
  function cashFlow(row){
    const amount=round(number(row.deposit)-number(row.withdrawal)+number(row.transfer_in)-number(row.transfer_out)+number(row.balance_adjustment));
    const kind=row.kind||row.record_kind;
    const label=kind==='transfer_in'?'Transferencia recibida':kind==='transfer_out'?'Transferencia enviada':
      kind==='balance_adjustment'?'Ajuste de balance':kind==='credit'?'Crédito MT5':
      number(row.withdrawal)?'Retiro':number(row.deposit)?'Depósito':'Movimiento de balance';
    return {amount:kind==='credit'?number(row.credit):amount,label};
  }
  function normalize(deals){
    const unique=new Map();
    for(const deal of deals){
      const key=String(deal.deal_id);
      const previous=unique.get(key);
      if(!previous||String(deal.imported_at||'')>=String(previous.imported_at||''))unique.set(key,deal);
    }
    const sorted=[...unique.values()].sort((a,b)=>{
      const da=timestamp(a),db=timestamp(b);
      return String(da?.date+' '+da?.time).localeCompare(String(db?.date+' '+db?.time))||
        String(a.occurred_at).localeCompare(String(b.occurred_at))||String(a.deal_id).length-String(b.deal_id).length||String(a.deal_id).localeCompare(String(b.deal_id));
    });
    const fees=new Map(),rows=[];
    for(const deal of sorted){
      const when=timestamp(deal);if(!when)continue;
      const type=String(deal.deal_type||'').toUpperCase().replace(/^DEAL_TYPE_/,'');
      const profit=number(deal.profit),cost=number(deal.commission)+number(deal.swap)+number(deal.fee);
      const base={id:'mt-'+text(deal.id||deal.deal_id),date:when.date,created_at:deal.occurred_at,
        mt_record:true,trade_time:when.time,time_label:'MT5',source_deal_id:String(deal.deal_id),
        source_profit:profit,source_commission:number(deal.commission),source_swap:number(deal.swap),source_fee:number(deal.fee)};
      if(type!=='BUY'&&type!=='SELL'){
        if(type==='CREDIT'){
          if(profit)rows.push({...base,kind:'credit',credit:profit,entry_scope:'daily',deposit:0,withdrawal:0,gain:0,loss:0,note:'Crédito MT5 · #'+text(deal.deal_id)});
          continue;
        }
        const net=round(profit+cost);if(!net)continue;
        const comment=String(deal.comment||'').trim();
        const deposit=type==='BALANCE'&&/^(DEP|DEPOSIT)\s/i.test(comment)&&profit>0?profit:0;
        const withdrawal=type==='BALANCE'&&/^(WDL|WDR|WITHDRAWAL)\s/i.test(comment)&&profit<0?-profit:0;
        const transfer_in=type==='BALANCE'&&/^Transfer from\b/i.test(comment)&&profit>0?profit:0;
        const transfer_out=type==='BALANCE'&&/^Transfer to\b/i.test(comment)&&profit<0?-profit:0;
        const balance_adjustment=round(net-deposit+withdrawal-transfer_in+transfer_out);
        rows.push({...base,kind:deposit?'deposit':withdrawal?'withdrawal':transfer_in?'transfer_in':transfer_out?'transfer_out':'balance_adjustment',
          entry_scope:'daily',deposit,withdrawal,transfer_in,transfer_out,balance_adjustment,gain:0,loss:0,
          note:'Movimiento MT5 · '+text(comment||type)+' · #'+text(deal.deal_id)});
        continue;
      }
      const position=text(deal.position_id||deal.order_id||deal.deal_id);
      let net=profit+cost;
      const closed=['DEAL_ENTRY_OUT','DEAL_ENTRY_OUT_BY','DEAL_ENTRY_INOUT'].includes(String(deal.entry_type||''));
      if(!closed&&(deal.entry_type||Math.abs(profit)<1e-7)){
        if(net)fees.set(position,(fees.get(position)||0)+net);
        if(deal.entry_type||Math.abs(profit)<1e-7)continue;
      }
      if(fees.has(position)){net+=fees.get(position);fees.delete(position);}
      net=round(net);
      rows.push({...base,kind:'trading',entry_scope:'trade',trade_instrument:text(deal.symbol||'').toUpperCase(),
        trade_side:type==='BUY'?'sell':'buy',trade_strategy:'',trade_session:'other',trade_risk:null,
        deposit:0,withdrawal:0,gain:Math.max(0,net),loss:Math.max(0,-net),
        note:'Cierre MT5 · deal #'+text(deal.deal_id)+(deal.position_id?' · posición #'+text(deal.position_id):'')});
    }
    return rows;
  }
  function today(deals,now=new Date()){
    const samples=deals.filter(d=>d.broker_time).sort((a,b)=>String(b.occurred_at).localeCompare(String(a.occurred_at)));
    if(!samples.length)return now.toISOString().slice(0,10);
    const reference=samples[0];
    const wall=Date.parse(String(reference.broker_time).replace(' ','T')+'Z');
    const offset=wall-Date.parse(reference.occurred_at);
    // Verify the recorded Axi clock against both winter and summer samples.
    const formatter=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    const ny7=instant=>{
      const p=Object.fromEntries(formatter.formatToParts(instant).map(v=>[v.type,v.value]));
      return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour+7,+p.minute,+p.second);
    };
    const candidates=[samples[0],samples.at(-1)];
    if(candidates.every(d=>Math.abs(ny7(new Date(d.occurred_at))-Date.parse(String(d.broker_time).replace(' ','T')+'Z'))<1000))
      return new Date(ny7(now)).toISOString().slice(0,10);
    return new Date(now.valueOf()+(Number.isFinite(offset)?offset:0)).toISOString().slice(0,10);
  }
  return {timestamp,normalize,cashFlow,today};
});
