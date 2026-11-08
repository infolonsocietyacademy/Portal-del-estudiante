const {test}=require("node:test");
const assert=require("node:assert/strict");
const c=require("../analytics-core.js");
let sequence=0;
const trade=(n,extra={})=>({id:String(++sequence),kind:"trading",entry_scope:"trade",date:"2026-11-05",gain:Math.max(0,n),loss:Math.max(0,-n),trade_instrument:"XAUUSD",trade_strategy:"CRT",trade_risk:100,...extra});
test("Win rate counts individual trades and excludes BE, summaries and cash flows",()=>{
  const rows=[trade(200),trade(-100),trade(0),{kind:"trading",entry_scope:"daily",date:"2026-11-04",gain:900,loss:100},{kind:"deposit",deposit:5000,date:"2026-11-03"}];
  const s=c.stats(rows);assert.equal(s.total,3);assert.equal(s.winrate,50);assert.equal(s.flat,1);assert.equal(s.profitFactor,2);assert.equal(s.net,100);assert.equal(s.expectancy,100/3);assert.equal(s.avgR,1/3);
});
test("Legacy daily results remain daily results",()=>{
  const rows=[{date:"2026-11-05",gain:100,loss:0},{date:"2026-11-05",gain:0,loss:30},{date:"2026-11-06",gain:0,loss:10},{kind:"deposit",date:"2026-11-07",deposit:1000,gain:0,loss:0}];
  assert.equal(c.stats(rows).total,0);assert.equal(c.stats(rows).winrate,null);assert.deepEqual(c.days(rows),{total:2,wins:1,losses:1,flat:0,winrate:50,net:60,best:70,worst:-10});
});
test("Empty, all BE, all wins and all losses use honest denominators",()=>{
  assert.equal(c.stats([]).profitFactor,null);assert.equal(c.stats([trade(0)]).winrate,null);
  assert.equal(c.stats([trade(10)]).profitFactor,Infinity);assert.equal(c.stats([trade(10)]).avgLoss,null);
  assert.equal(c.stats([trade(-10)]).winrate,0);assert.equal(c.stats([trade(-10)]).profitFactor,0);
});
test("R averages only trades with their original risk; partial coverage is reported",()=>{
  const s=c.stats([trade(150,{trade_risk:50}),trade(-200,{trade_risk:100}),trade(300,{trade_risk:null})]);
  assert.equal(s.rCount,2);assert.equal(s.avgR,.5);assert.equal(s.net,250);
});
test("Rounding happens in cents and BE means zero net",()=>{
  const s=c.stats([trade(.1),trade(.2),trade(-.3)]);assert.equal(s.net,0);assert.equal(s.flat,0);assert.equal(s.profitFactor,1);
});
test("Drawdown and streaks follow entry time; BE interrupts a run",()=>{
  const rows=[trade(-100,{trade_time:"11:00"}),trade(200,{trade_time:"09:00"}),trade(-50,{trade_time:"10:00"}),trade(0,{trade_time:"12:00"}),trade(80,{trade_time:"13:00"})];
  const s=c.stats(rows);assert.equal(s.drawdown,150);assert.equal(s.maxLosses,2);assert.equal(s.maxWins,1);assert.deepEqual(s.currentStreak,{type:"win",count:1});
});
test("Week is Monday through today in Puerto Rico; custom dates validate",()=>{
  assert.deepEqual(c.range("week","2026-11-08"),{valid:true,start:"2026-11-02",end:"2026-11-08"});
  assert.deepEqual(c.range("week","2026-11-09"),{valid:true,start:"2026-11-09",end:"2026-11-09"});
  assert.equal(c.range("custom","2026-11-08","2026-02-30","2026-11-08").valid,false);
  assert.equal(c.range("custom","2026-11-08","2026-11-09","2026-11-01").valid,false);
});
test("Period, asset, strategy, side and session filters intersect",()=>{
  const rows=[trade(50,{trade_side:"buy",trade_session:"ny_am"}),trade(-20,{trade_instrument:"NAS100",trade_side:"sell"}),trade(80,{date:"2026-10-31"}),trade(5,{trade_strategy:"ORB"})];
  const selection={period:"month",instrument:"xauusd",strategy:"crt",side:"buy",session:"ny_am"};
  const filtered=c.filter(rows,selection,"2026-11-08");assert.equal(filtered.length,1);assert.equal(c.stats(filtered).net,50);
  assert.equal(c.filter(rows,{period:"custom",from:"",to:""},"2026-11-08").length,0);
});
test("Group totals reconcile and unknown hours are never inferred",()=>{
  const rows=[trade(40,{trade_time:"08:15"}),trade(-10,{trade_time:"08:20"}),trade(20,{trade_time:null,created_at:"2026-11-05T17:00:00Z"})];
  const groups=c.groups(rows,"hour");assert.equal(groups.reduce((s,g)=>s+g.net,0),c.stats(rows).net);
  assert.equal(groups.find(g=>g.label==="Sin hora").total,1);assert.equal(groups.find(g=>g.label==="08:00–08:59").winrate,50);
});
test("Account drawdown excludes cash movements and uses actual funded peaks",()=>{
  const rows=[{id:"deposit",kind:"deposit",date:"2026-11-01",deposit:1000},trade(200,{date:"2026-11-02"}),trade(-120,{date:"2026-11-03"}),{id:"withdraw",kind:"withdrawal",date:"2026-11-04",withdrawal:300}];
  const dd=c.accountDrawdown(rows,c.range("all","2026-11-08"));assert.equal(dd.amount,120);assert.ok(Math.abs(dd.percent-10)<1e-10);
  assert.deepEqual(c.accountDrawdown([{kind:"deposit",date:"2026-11-01",deposit:1000},{kind:"withdrawal",date:"2026-11-02",withdrawal:500}],c.range("all","2026-11-08")),{amount:0,percent:null});
  assert.equal(c.accountDrawdown([trade(-20)],c.range("all","2026-11-08")).percent,null);
});
test("Typed metadata and free notes round-trip in the existing private note field",()=>{
  const metadata={entry_scope:"trade",trade_instrument:"XAUUSD",trade_strategy:"CRT",trade_side:"buy",trade_risk:50,trade_time:"08:15",trade_session:"ny_am"};
  const note='Barrida y retest.\nTexto libre: "paciencia" <script>alert(1)</script>';
  const stored=c.encodeNote(note,metadata),decoded=c.decodeNote(stored);
  assert.deepEqual(decoded,{note,...metadata});assert.equal(c.stats([{...trade(100),...decoded}]).avgR,2);
  assert.equal(c.decodeNote("Nota anterior").entry_scope,"daily");assert.equal(c.encodeNote("Nota anterior",{entry_scope:"daily"}),"Nota anterior");
  assert.equal(c.decodeNote("[OLON:TRADE:1]{malformed}\nno crash").entry_scope,"daily");
});
test("A daily summary never duplicates trades or removes legacy capital",()=>{
  const rows=[trade(100),trade(-30),{id:"summary",date:"2026-11-05",gain:100,loss:30,deposit:500,kind:null,entry_scope:"daily"}];
  assert.equal(c.days(rows).net,70);const effective=c.accountingRows(rows);
  assert.equal(effective.reduce((s,r)=>s+Number(r.deposit || 0),0),500);assert.equal(effective.reduce((s,r)=>s+c.net(r),0),70);
  assert.equal(rows[2].gain,100);assert.equal(rows[2].loss,30);
});
