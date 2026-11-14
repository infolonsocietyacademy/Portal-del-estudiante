const {test}=require('node:test');
const assert=require('node:assert/strict');
const ledger=require('../mt5-ledger.js');
const core=require('../analytics-core.js');
const source=(id,extra={})=>({id,deal_id:String(id),occurred_at:'2026-11-12T03:00:00Z',broker_time:'2026-11-12 05:00:00',
  deal_type:'DEAL_TYPE_BUY',entry_type:'DEAL_ENTRY_OUT',profit:0,commission:0,swap:0,fee:0,...extra});
test('calendar dates follow the original MT5 day across Puerto Rico midnight',()=>{
  const row=ledger.normalize([source(1,{profit:10,occurred_at:'2026-11-12T01:00:00Z',broker_time:'2026-11-12 03:00:00'})])[0];
  assert.equal(row.date,'2026-11-12');
  assert.equal(row.trade_time,'03:00');
  assert.equal(row.time_label,'MT5');
});
test('deposits, transfers, withdrawals and corrections retain separate amounts',()=>{
  const rows=ledger.normalize([
    source(1,{deal_type:'DEAL_TYPE_BALANCE',profit:60,comment:'Transfer from another-account'}),
    source(2,{deal_type:'DEAL_TYPE_BALANCE',profit:25,comment:'DEP payment-reference'}),
    source(3,{deal_type:'DEAL_TYPE_BALANCE',profit:-10,comment:'Transfer to another-account'}),
    source(4,{deal_type:'DEAL_TYPE_BALANCE',profit:-5,comment:'WDL payment-reference'}),
    source(5,{deal_type:'DEAL_TYPE_BALANCE',profit:2,comment:'NBA'})
  ]);
  assert.equal(rows.reduce((n,r)=>n+(r.deposit||0),0),25);
  assert.deepEqual(rows.map(r=>ledger.cashFlow(r).amount),[60,25,-10,-5,2]);
  assert.equal(ledger.cashFlow(rows[0]).label,'Transferencia recibida');
  assert.equal(ledger.cashFlow(rows[2]).label,'Transferencia enviada');
  assert.equal(ledger.cashFlow(rows[4]).label,'Ajuste de balance');
  assert.equal(core.stats(rows).total,0);
});
test('source fees and swaps form closed P&L without duplicating entry deals',()=>{
  const rows=ledger.normalize([
    source(1,{position_id:'p1',entry_type:'DEAL_ENTRY_IN',commission:-1}),
    source(2,{position_id:'p1',entry_type:'DEAL_ENTRY_OUT',profit:10,commission:-1,swap:-2})
  ]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].gain,6);
  assert.equal(core.stats(rows).total,1);
});
test('repeated source tickets are applied once and the newest source correction wins',()=>{
  const rows=ledger.normalize([
    source(1,{profit:10,imported_at:'2026-11-12T12:00:00Z'}),
    source(1,{profit:12,imported_at:'2026-11-12T13:00:00Z'})
  ]);
  assert.equal(rows.length,1);assert.equal(rows[0].gain,12);
});
test('the current MT5 day follows its verified summer and winter clock',()=>{
  const samples=[source(1,{occurred_at:'2026-11-11T05:00:00Z',broker_time:'2026-11-11 07:00:00'}),
    source(2,{occurred_at:'2026-07-01T12:00:00Z',broker_time:'2026-07-01 15:00:00'})];
  assert.equal(ledger.today(samples,new Date('2026-11-14T22:30:00Z')),'2026-11-15');
  assert.equal(ledger.today(samples,new Date('2026-07-01T21:30:00Z')),'2026-07-02');
});
test('malformed dates do not enter the financial calendar',()=>{
  assert.equal(ledger.timestamp(source(1,{broker_time:'2026-02-30 12:00:00'})),null);
});
