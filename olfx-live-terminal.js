/* OLFX LIVE TERMINAL — virtual trading uses explicitly entered prices, not TradingView quotes. */
(()=>{"use strict";
const SYMBOLS={XAUUSD:"OANDA:XAUUSD",NASDAQ:"NASDAQ:NDX",EURUSD:"FX:EURUSD",USDJPY:"FX:USDJPY",BTCUSD:"BITSTAMP:BTCUSD"};
const SIZES=[200,300,500,750,1000];
const usd=n=>Number(n).toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2});
const fmt=n=>Number(n).toLocaleString("en-US",{maximumFractionDigits:5});
const valid=n=>Number.isFinite(Number(n))&&Number(n)>0;
const round=n=>Math.round(n*100)/100;
const user=()=>{try{return typeof currentUser!=="undefined"&&currentUser&&currentUser.id?String(currentUser.id):""}catch(e){return ""}};
function init(){
 const page=document.getElementById("olfxLiveTerminalPage"),portal=document.getElementById("portal");if(!page||!portal||page.dataset.olfxReady)return;
 page.dataset.olfxReady="1";portal.append(page);
 const $=id=>page.querySelector("#"+id),symbol=$("olfxChartSymbol"),interval=$("olfxChartInterval"),mount=$("olfxChartMount"),status=$("olfxChartStatus"),panel=$("olfxSimPanel");
 let chartKey="",active=false,owner="",size=200,ledger={trades:[],marks:{}},persistent=true;
 const key=()=> "olfx-demo-v3:"+owner+":"+size;
 function normalizeTrade(x){
  if(!x||!Object.prototype.hasOwnProperty.call(SYMBOLS,x.symbol)||!["BUY","SELL"].includes(x.side)||!valid(x.entry)||!valid(x.qty)||!valid(x.factor)||!["open","closed"].includes(x.status))return null;
  const t={id:String(x.id||""),symbol:x.symbol,side:x.side,entry:Number(x.entry),qty:Number(x.qty),factor:Number(x.factor),stop:valid(x.stop)?Number(x.stop):null,take:valid(x.take)?Number(x.take):null,status:x.status,exit:null,result:0};
  if(t.status==="closed"){if(!valid(x.exit))return null;t.exit=Number(x.exit);t.result=round((t.exit-t.entry)*t.qty*t.factor*(t.side==="BUY"?1:-1))}
  return t;
 }
 function loadLedger(){
  try{const data=JSON.parse(localStorage.getItem(key())||"null");persistent=true;
   if(!data||typeof data!=="object")return {trades:[],marks:{}};
   const marks={};for(const s of Object.keys(SYMBOLS))if(data.marks&&valid(data.marks[s]))marks[s]=Number(data.marks[s]);
   return {trades:Array.isArray(data.trades)?data.trades.slice(-300).map(normalizeTrade).filter(Boolean):[],marks};
  }catch(e){persistent=false;return {trades:[],marks:{}}}
 }
 function save(){try{localStorage.setItem(key(),JSON.stringify(ledger));persistent=true}catch(e){persistent=false}}
 function profit(t,price){return valid(price)?round((Number(price)-t.entry)*t.qty*t.factor*(t.side==="BUY"?1:-1)):0}
 function balance(){return round(size+ledger.trades.filter(t=>t.status==="closed").reduce((n,t)=>n+t.result,0))}
 function equity(){return round(balance()+ledger.trades.filter(t=>t.status==="open").reduce((n,t)=>n+profit(t,ledger.marks[t.symbol]),0))}
 function message(s,error=false){const el=$("olfxDemoMessage");el.textContent=s;el.dataset.error=error?"yes":"no"}
 function line(parent,items,handler){
  const row=document.createElement("div");row.className="olfxTradeRow";
  for(const item of items){const span=document.createElement("span");span.textContent=item;row.append(span)}
  if(handler){const b=document.createElement("button");b.type="button";b.textContent="Cerrar";b.addEventListener("click",handler);row.append(b)}
  parent.append(row);
 }
 function render(){
  $("olfxBalance").textContent=usd(balance());$("olfxEquity").textContent=usd(equity());
  $("olfxAccountBadge").textContent="DEMO "+usd(size)+" | "+usd(equity());
  $("olfxLocalNote").textContent=persistent?"Guardado en este navegador, separado por estudiante y cuenta.":"Tu navegador bloqueó el guardado local.";
  const opened=ledger.trades.filter(t=>t.status==="open"),closed=ledger.trades.filter(t=>t.status==="closed");
  $("olfxOpenCount").textContent=opened.length;$("olfxClosedCount").textContent=closed.length;
  const op=$("olfxOpenTrades"),hist=$("olfxTradeHistory");op.replaceChildren();hist.replaceChildren();
  if(!opened.length)line(op,["Sin posiciones abiertas"]);
  for(const t of opened.slice().reverse())line(op,[t.symbol+" "+t.side,fmt(t.entry)+" · "+fmt(t.qty)+" uds","P/L "+usd(profit(t,ledger.marks[t.symbol]))+"*"],()=>closeTrade(t.id));
  if(!closed.length)line(hist,["Sin operaciones cerradas"]);
  for(const t of closed.slice(-8).reverse())line(hist,[t.symbol+" "+t.side,fmt(t.entry)+" → "+fmt(t.exit),usd(t.result)]);
  const mark=ledger.marks[symbol.value];$("olfxLastMark").textContent=valid(mark)?fmt(mark):"Sin referencia";
  if(document.activeElement!==$("olfxMarkPrice"))$("olfxMarkPrice").value=valid(mark)?String(mark):"";
 }
 function authorize(){
  const id=user();
  if(!id){owner="";ledger={trades:[],marks:{}};render();message("Debes iniciar sesión para practicar.",true);return false}
  if(owner!==id){owner=id;size=200;$("olfxDemoAccount").value="200";ledger=loadLedger();render();message("Operaciones virtuales. Ingresa precios manuales tomados de la gráfica.")}
  return true;
 }
 function openTrade(side){
  if(!authorize())return;
  const price=Number($("olfxEntryPrice").value),qty=Number($("olfxDemoQty").value),factor=Number($("olfxDemoFactor").value),sl=Number($("olfxDemoStop").value),tp=$("olfxDemoTake").value.trim()?Number($("olfxDemoTake").value):null;
  if(!valid(price)||!valid(qty)||!valid(factor)||!valid(sl)||(tp!==null&&!valid(tp))){message("Indica entrada, unidades, valor por punto y SL válidos.",true);return}
  if(side==="BUY"?(sl>=price||(tp!==null&&tp<=price)):(sl<=price||(tp!==null&&tp>=price))){message("BUY: SL abajo/TP arriba. SELL: SL arriba/TP abajo.",true);return}
  if(ledger.trades.filter(t=>t.status==="open").length>=5){message("Límite: cinco posiciones abiertas.",true);return}
  const risk=Math.abs(price-sl)*qty*factor,limit=Math.max(0,balance())*.05;
  if(balance()<=0||risk>limit+1e-9){message("Riesgo "+usd(risk)+" supera el 5% del balance ("+usd(limit)+").",true);return}
  const id=Date.now()+"-"+Math.random().toString(36).slice(2);
  ledger.trades.push({id,symbol:symbol.value,side,entry:price,qty,factor,stop:sl,take:tp,status:"open",exit:null,result:0});
  ledger.marks[symbol.value]=price;save();render();
  message(side+" virtual registrado a "+fmt(price)+". Riesgo teórico hasta SL: "+usd(risk)+".");
 }
 function closeTrade(id){
  if(!authorize())return;
  const t=ledger.trades.find(x=>x.id===id&&x.status==="open");if(!t)return;
  if(t.symbol!==symbol.value){symbol.value=t.symbol;chart(true);render();message("Cambié a "+t.symbol+". Introduce un precio de salida y vuelve a Cerrar.",true);return}
  const price=Number($("olfxMarkPrice").value);
  if(!valid(price)){message("Indica primero el precio manual de salida.",true);return}
  t.status="closed";t.exit=price;t.result=profit(t,price);ledger.marks[t.symbol]=price;
  save();render();message("Cierre virtual a "+fmt(price)+": "+usd(t.result)+".");
 }
 function chart(force){
  if(!active)return;
  const k=SYMBOLS[symbol.value]+"|"+interval.value;if(k===chartKey&&!force)return;
  chartKey=k;mount.replaceChildren();status.textContent="Conectando con TradingView…";
  const host=document.createElement("div");host.className="tradingview-widget-container olfxTvHost";
  const body=document.createElement("div");body.className="tradingview-widget-container__widget olfxTvWidget";host.append(body);
  const credit=document.createElement("div");credit.className="tradingview-widget-copyright olfxTvCredit";
  const a=document.createElement("a");a.href="https://www.tradingview.com/";a.target="_blank";a.rel="noopener noreferrer nofollow";a.textContent="Gráfica por TradingView";credit.append(a);host.append(credit);mount.append(host);
  const script=document.createElement("script");script.async=true;script.src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
  script.textContent=JSON.stringify({autosize:true,symbol:SYMBOLS[symbol.value],interval:interval.value,timezone:"America/New_York",theme:"dark",style:"1",locale:"es",allow_symbol_change:false,hide_side_toolbar:false,hide_top_toolbar:false,save_image:true,calendar:false,support_host:"https://www.tradingview.com"});
  script.addEventListener("load",()=>{if(chartKey===k)status.textContent="TradingView cargado · datos pueden tener retraso · órdenes 100% virtuales"},{once:true});
  script.addEventListener("error",()=>{if(chartKey===k)status.textContent="No se pudo cargar TradingView. Pulsa ↻."},{once:true});
  host.append(script);
 }
 function visibility(){
  const vis=!page.classList.contains("hidden")&&!portal.classList.contains("hidden");if(vis===active)return;
  active=vis;document.body.classList.toggle("olfx-terminal-active",vis);
  if(vis){authorize();chart(false);render()}
  else{chartKey="";mount.replaceChildren();panel.hidden=true;$("olfxSimToggle").setAttribute("aria-expanded","false");if(document.fullscreenElement===page&&document.exitFullscreen)document.exitFullscreen().catch(()=>{})}
 }
 $("olfxExitTerminal").addEventListener("click",()=>{if(document.fullscreenElement===page&&document.exitFullscreen)document.exitFullscreen().catch(()=>{});if(typeof showPage==="function"){const b=document.querySelector('#portal .nav [data-page="dashboard"]');showPage("dashboard",b||null)}else page.classList.add("hidden");visibility()});
 $("olfxFullscreenToggle").addEventListener("click",async()=>{try{if(document.fullscreenElement===page)await document.exitFullscreen();else if(page.requestFullscreen)await page.requestFullscreen();else message("El navegador no permite fullscreen nativo; ya ocupa la ventana.")}catch(e){message("El navegador no permitió fullscreen; ya ocupa la ventana.",true)}});
 $("olfxSimToggle").addEventListener("click",()=>{panel.hidden=!panel.hidden;$("olfxSimToggle").setAttribute("aria-expanded",String(!panel.hidden));if(!panel.hidden){authorize();render()}});
 $("olfxPanelClose").addEventListener("click",()=>{panel.hidden=true;$("olfxSimToggle").setAttribute("aria-expanded","false")});
 symbol.addEventListener("change",()=>{chart(true);render()});interval.addEventListener("change",()=>chart(true));$("olfxChartReload").addEventListener("click",()=>chart(true));
 $("olfxDemoBuy").addEventListener("click",()=>openTrade("BUY"));$("olfxDemoSell").addEventListener("click",()=>openTrade("SELL"));
 $("olfxMarkSet").addEventListener("click",()=>{if(!authorize())return;const price=Number($("olfxMarkPrice").value);if(!valid(price)){message("Marca un precio válido.",true);return}ledger.marks[symbol.value]=price;save();render();message("Precio de referencia manual actualizado a "+fmt(price)+".")});
 $("olfxDemoAccount").addEventListener("change",()=>{if(!authorize())return;const v=Number($("olfxDemoAccount").value);if(!SIZES.includes(v))return;size=v;ledger=loadLedger();render();message("Cuenta virtual "+usd(size)+" activada con historial independiente.")});
 $("olfxResetAccount").addEventListener("click",()=>{if(!authorize()||!confirm("¿Borrar todas las operaciones de la cuenta virtual "+usd(size)+" en este dispositivo?"))return;ledger={trades:[],marks:{}};save();render();message("Cuenta virtual reiniciada.")});
 const mo=new MutationObserver(visibility);mo.observe(page,{attributes:true,attributeFilter:["class"]});mo.observe(portal,{attributes:true,attributeFilter:["class"]});visibility();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();