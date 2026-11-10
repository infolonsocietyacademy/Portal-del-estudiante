/* OLFX chart-side demo orders — Coinbase BTC-USD market-feed only.
 * Real market quotes; executions are VIRTUAL and kept on this device.
 */
(function(){
"use strict";
const CHART_LIB="https://cdn.jsdelivr.net/npm/lightweight-charts@5.0.9/dist/lightweight-charts.standalone.production.js";
const SOCKET_URL="wss://ws-feed.exchange.coinbase.com";
const CANDLES_URL="https://api.exchange.coinbase.com/products/BTC-USD/candles";
const sizes=[200,300,500,750,1000];
const money=n=>Number(n).toLocaleString("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2});
const format=n=>Number(n).toLocaleString("en-US",{maximumFractionDigits:2});
const good=n=>Number.isFinite(n)&&n>0;
const r2=n=>Math.round((n+Number.EPSILON)*100)/100;
function uid(){try{return typeof currentUser!=="undefined"&&currentUser?.id?String(currentUser.id):""}catch(_){return ""}}
let loader;
function loadLibrary(){
 if(window.LightweightCharts)return Promise.resolve(window.LightweightCharts);
 if(!loader)loader=new Promise((resolve,reject)=>{
  const script=document.createElement("script");script.src=CHART_LIB;script.async=true;
  script.onload=()=>window.LightweightCharts?resolve(window.LightweightCharts):reject(new Error("No se pudo iniciar la librería de gráficas."));
  script.onerror=()=>reject(new Error("No se pudo descargar la librería de gráficas."));
  document.head.append(script);
 }).catch(error=>{loader=null;throw error});
 return loader;
}
function init(){
 const page=document.getElementById("olfxLiveTerminalPage"), portal=document.getElementById("portal");
 if(!page||!portal||page.dataset.olfxAutoReady)return;
 page.dataset.olfxAutoReady="1";
 const symbol=page.querySelector("#olfxChartSymbol"),interval=page.querySelector("#olfxChartInterval"), mount=page.querySelector("#olfxChartMount");
 const oldToggle=page.querySelector("#olfxSimToggle"), oldPanel=page.querySelector("#olfxSimPanel"), badge=page.querySelector("#olfxAccountBadge");
 const status=page.querySelector("#olfxChartStatus");
 const native=document.createElement("div");native.id="olfxNativeStage";native.hidden=true;
 const chartArea=document.createElement("div");chartArea.className="olfxNativeCanvas";native.append(chartArea);
 const controls=document.createElement("div");controls.className="olfxQuickTrade";
 const tag=document.createElement("strong");tag.textContent="BTC-USD / COINBASE · DEMO";controls.append(tag);
 const quote=document.createElement("span");quote.className="olfxLiveQuote";quote.textContent="Sin cotización";controls.append(quote);
 const accounts=document.createElement("select");accounts.id="olfxAutoAccount";accounts.setAttribute("aria-label","Capital de práctica");
 for(const value of sizes){const opt=document.createElement("option");opt.value=String(value);opt.textContent=money(value);accounts.append(opt)}controls.append(accounts);
 const buy=document.createElement("button");buy.type="button";buy.className="olfxQuickBuy";buy.textContent="BUY";buy.disabled=true;controls.append(buy);
 const sell=document.createElement("button");sell.type="button";sell.className="olfxQuickSell";sell.textContent="SELL";sell.disabled=true;controls.append(sell);
 native.append(controls);
 const handles=document.createElement("div");handles.className="olfxPriceHandles";native.append(handles);
 const tpHandle=document.createElement("button");tpHandle.type="button";tpHandle.className="olfxPriceHandle olfxTPHandle";tpHandle.textContent="TP ↕";
 const slHandle=document.createElement("button");slHandle.type="button";slHandle.className="olfxPriceHandle olfxSLHandle";slHandle.textContent="SL ↕";
 handles.append(tpHandle,slHandle);
 const position=document.createElement("div");position.className="olfxPositionStrip";native.append(position);
 const balanceText=document.createElement("span");const tradeText=document.createElement("span");const exit=document.createElement("button");
 exit.type="button";exit.textContent="Cerrar a mercado";exit.hidden=true;position.append(balanceText,tradeText,exit);
 const copyright=document.createElement("a");copyright.className="olfxNativeAttribution";copyright.href="https://www.tradingview.com/";
 copyright.target="_blank";copyright.rel="noopener noreferrer";copyright.textContent="Gráfica: Lightweight Charts™ por TradingView";
 native.append(copyright);
 mount.append(native);
 const warning=document.createElement("div");warning.className="olfxAutoWarning";warning.textContent="BUY/SELL automático y TP/SL arrastrable disponibles con cotizaciones de BTC-USD. XAUUSD, NASDAQ y Forex requieren un proveedor de datos compatible.";
 page.querySelector(".olfxFullscreenWorkspace").append(warning);

 let session=0, chart=null,series=null, resize=null,ws=null,clock=null;
 let lastCandle=null,quotePrice=null,quoteAt=0,candleInterval=300,book={trades:[]},size=200,owner="",tpLine=null,slLine=null,entryLine=null,drag=null;
 const active=()=>!page.classList.contains("hidden")&&!portal.classList.contains("hidden");
 const selected=()=>symbol.value==="BTCUSD";
 const key=()=> "olfx-native-btc-v1:"+owner+":"+size;
 const closeSocket=()=>{if(ws){const socket=ws;ws=null;socket.onclose=null;socket.onerror=null;socket.onmessage=null;socket.close()}};
 function note(text){status.textContent=text}
 function resetChart(){
  if(resize){resize.disconnect();resize=null}
  if(chart){chart.remove();chart=null}
  series=null;lastCandle=null;tpLine=null;slLine=null;entryLine=null;quotePrice=null;quoteAt=0;
  chartArea.replaceChildren();
  tpHandle.hidden=true;slHandle.hidden=true;
 }
 function tradeValid(t){
  if(!t||!["BUY","SELL"].includes(t.side)||!good(Number(t.entry))||!good(Number(t.qty))||!good(Number(t.sl))||!good(Number(t.tp)))return false;
  return t.side==="BUY"?(t.sl<t.entry&&t.entry<t.tp):(t.tp<t.entry&&t.entry<t.sl);
 }
 function loadAccount(){
  book={trades:[]};
  if(!owner)return;
  try{
   const parsed=JSON.parse(localStorage.getItem(key())||"null");
   if(parsed && Array.isArray(parsed.trades))book.trades=parsed.trades.slice(-150).filter(tradeValid).map(t=>({
    id:String(t.id||""),side:t.side,entry:Number(t.entry),qty:Number(t.qty),sl:Number(t.sl),tp:Number(t.tp),
    status:t.status==="closed"?"closed":"open",exit:good(Number(t.exit))?Number(t.exit):null,
    reason:String(t.reason||"").slice(0,36),openedAt:String(t.openedAt||""),closedAt:String(t.closedAt||"")
   })).filter(t=>t.status==="open"||good(t.exit));
  }catch(_){note("No se pudo leer el historial local. No se han generado precios ficticios.")}
 }
 function saveAccount(){try{localStorage.setItem(key(),JSON.stringify(book));return true}catch(_){note("El navegador no permite guardar operaciones. Revisa el almacenamiento.");return false}}
 function pnl(t,price){return (Number(price)-t.entry)*t.qty*(t.side==="BUY"?1:-1)}
 function balance(){return r2(size+book.trades.filter(t=>t.status==="closed").reduce((n,t)=>n+pnl(t,t.exit),0))}
 const openTrade=()=>book.trades.find(t=>t.status==="open");
 function fresh(){return active()&&selected()&&ws&&ws.readyState===WebSocket.OPEN&&good(quotePrice)&&Date.now()-quoteAt<30000}
 function updateStats(){
  const t=openTrade();
  balanceText.textContent="BAL "+money(balance())+" · EQUITY "+money(balance()+(t&&good(quotePrice)?pnl(t,quotePrice):0));
  tradeText.textContent=t?(t.side+" @ "+format(t.entry)+" · "+(good(quotePrice)?money(pnl(t,quotePrice)):"sin precio")+" · SL "+format(t.sl)+" · TP "+format(t.tp)):"Sin posición virtual abierta";
  exit.hidden=!t;buy.disabled=!fresh()||!!t||balance()<=0;sell.disabled=buy.disabled;
  quote.textContent=fresh()?money(quotePrice)+" · LIVE":good(quotePrice)?money(quotePrice)+" · SIN CONEXIÓN":"Esperando precio…";
  badge.textContent="DEMO "+money(size);
  drawLevels();
 }
 function accountOwner(){
  const id=uid();
  if(!id){owner="";book={trades:[]};updateStats();note("Inicia sesión para usar cuentas de práctica.");return false}
  if(owner!==id){owner=id;size=200;accounts.value="200";loadAccount();updateStats()}
  return true;
 }
 function cleanLines(){
  if(!series)return;
  for(const line of [tpLine,slLine,entryLine])if(line){try{series.removePriceLine(line)}catch(_){}}
  tpLine=slLine=entryLine=null;
 }
 function drawLevels(){
  const t=openTrade();
  if(!series || !t){cleanLines();tpHandle.hidden=true;slHandle.hidden=true;return}
  const opts=(price,color,title)=>({price,color,lineWidth:2,lineStyle:0,axisLabelVisible:true,title});
  if(!entryLine)entryLine=series.createPriceLine(opts(t.entry,"#60c5ee","ENTRY "+t.side));
  if(!tpLine)tpLine=series.createPriceLine(opts(t.tp,"#3de0ac","TP"));
  else tpLine.applyOptions({price:t.tp});
  if(!slLine)slLine=series.createPriceLine(opts(t.sl,"#ff7185","SL"));
  else slLine.applyOptions({price:t.sl});
  const yTP=series.priceToCoordinate(t.tp),ySL=series.priceToCoordinate(t.sl);
  const height=chartArea.clientHeight;
  tpHandle.hidden=!(Number.isFinite(yTP)&&yTP>=5&&yTP<=height-12);
  slHandle.hidden=!(Number.isFinite(ySL)&&ySL>=5&&ySL<=height-12);
  if(!tpHandle.hidden)tpHandle.style.top=yTP+"px";
  if(!slHandle.hidden)slHandle.style.top=ySL+"px";
  tpHandle.setAttribute("aria-label","Arrastrar take profit "+format(t.tp));
  slHandle.setAttribute("aria-label","Arrastrar stop loss "+format(t.sl));
 }
 function close(reason,price){
  const t=openTrade();if(!t||!good(price))return;
  t.status="closed";t.exit=price;t.reason=reason;t.closedAt=new Date().toISOString();
  saveAccount();drawLevels();updateStats();
  note("Operación virtual cerrada ("+reason+") a "+format(price)+" · P/L "+money(pnl(t,price))+". Sin ejecución real.");
 }
 function newTrade(side){
  if(!accountOwner())return;
  if(!fresh()){note("No hay precio actual verificado. BUY/SELL desactivados hasta recibir cotización.");return}
  if(openTrade()){note("Primero cierra la posición virtual actual.");return}
  const bal=balance();if(bal<=0)return;
  const entry=quotePrice;
  const sl=side==="BUY"?entry*0.995:entry*1.005;
  const tp=side==="BUY"?entry*1.01:entry*0.99;
  // 1x notional maximum; without leverage. Risk not more than 1% of virtual balance.
  const qty=Math.min(bal/entry,(bal*0.01)/Math.abs(entry-sl));
  if(!good(qty))return;
  book.trades.push({id:String(Date.now()),side,entry,qty,sl,tp,status:"open",exit:null,reason:"",openedAt:new Date().toISOString(),closedAt:""});
  saveAccount();drawLevels();updateStats();
  note(side+" DEMO @ "+format(entry)+" · TP y SL arrastrables sobre la gráfica · sin dinero real.");
 }
 function receiveTick(price,iso){
  if(!good(price))return;
  const when=Date.parse(iso);
  // Feed transport freshness is local receipt time; candle time uses provider exchange event.
  quotePrice=price;quoteAt=Date.now();
  if(series){
   const ts=Number.isFinite(when)?Math.floor(when/1000):Math.floor(Date.now()/1000);
   const bucket=Math.floor(ts/candleInterval)*candleInterval;
   if(!lastCandle||bucket>=lastCandle.time){
    if(!lastCandle||bucket>lastCandle.time)lastCandle={time:bucket,open:price,high:price,low:price,close:price};
    else lastCandle={...lastCandle,high:Math.max(lastCandle.high,price),low:Math.min(lastCandle.low,price),close:price};
    series.update(lastCandle);
   }
  }
  const t=openTrade();
  if(t){
   const hitTP=t.side==="BUY"?price>=t.tp:price<=t.tp;
   const hitSL=t.side==="BUY"?price<=t.sl:price>=t.sl;
   if(hitSL||hitTP)close(hitSL?"Stop Loss observado":"Take Profit observado",price);
  }
  updateStats();
 }
 function connect(generation){
  if(!active()||!selected()||generation!==session)return;
  closeSocket();
  try{ws=new WebSocket(SOCKET_URL)}catch(_){note("No se pudo iniciar la conexión de precios BTC-USD.");return}
  const socket=ws;
  socket.onopen=()=>{if(generation!==session)return;socket.send(JSON.stringify({type:"subscribe",product_ids:["BTC-USD"],channels:["ticker"]}));note("Conectado a Coinbase; esperando cotización BTC-USD…")};
  socket.onmessage=event=>{
   if(generation!==session||!active()||!selected())return;
   let data;try{data=JSON.parse(event.data)}catch(_){return}
   if(data.type==="ticker"&&data.product_id==="BTC-USD"){const price=Number(data.price);receiveTick(price,data.time)}
  };
  socket.onerror=()=>{if(generation===session)note("La conexión BTC-USD falló. Operaciones desactivadas hasta reconectar.")};
  socket.onclose=()=>{if(generation===session){quoteAt=0;updateStats();note("Conexión de precios perdida. Pulsa ↻ para reconectar.")}};
 }
 async function historical(generation){
  const iv=Number(interval.value);
  const granularity=iv===240?3600:interval.value==="D"?86400:iv*60;
  if(![60,300,900,3600,86400].includes(granularity))throw new Error("Temporalidad no compatible");
  const now=Math.floor(Date.now()/1000);
  const end=new Date(now*1000).toISOString(),start=new Date((now-granularity*(iv===240?300:280))*1000).toISOString();
  const url=CANDLES_URL+"?granularity="+granularity+"&start="+encodeURIComponent(start)+"&end="+encodeURIComponent(end);
  const response=await fetch(url,{headers:{Accept:"application/json"},cache:"no-store"});
  if(!response.ok)throw new Error("Histórico Coinbase HTTP "+response.status);
  const payload=await response.json();
  if(!Array.isArray(payload))throw new Error("El proveedor no devolvió velas válidas.");
  const candles=payload.map(row=>({time:Number(row[0]),low:Number(row[1]),high:Number(row[2]),open:Number(row[3]),close:Number(row[4])}))
    .filter(x=>Number.isFinite(x.time)&&[x.low,x.high,x.open,x.close].every(good))
    .sort((a,b)=>a.time-b.time);
  if(iv!==240)return candles.slice(-280);
  // Coinbase does not publish 4-hour buckets; aggregate exact 1-hour OHLC into 4-hour windows.
  const aggregated=[];for(const candle of candles){
   const bucket=Math.floor(candle.time/14400)*14400;
   const prev=aggregated[aggregated.length-1];
   if(prev&&prev.time===bucket){prev.high=Math.max(prev.high,candle.high);prev.low=Math.min(prev.low,candle.low);prev.close=candle.close}
   else aggregated.push({...candle,time:bucket});
  }
  return aggregated;
 }
 async function start(){
  if(!active()||!selected())return;
  const generation=++session;
  if(native.parentElement!==mount)mount.append(native);
  native.hidden=false;page.classList.add("olfxAutoMode");
  oldToggle.hidden=true;oldPanel.hidden=true;warning.hidden=true;
  accountOwner();note("Cargando histórico y precio en vivo BTC-USD…");updateStats();
  try{
   const lib=await loadLibrary();if(generation!==session||!active()||!selected())return;
   chart=lib.createChart(chartArea,{autoSize:true,layout:{background:{type:"solid",color:"#090e16"},textColor:"#9eacc1"},
    grid:{vertLines:{color:"#192333"},horzLines:{color:"#192333"}},
    rightPriceScale:{borderColor:"#263849"},timeScale:{timeVisible:true,secondsVisible:false,borderColor:"#263849"},
    localization:{locale:"en-US"}});
   series=chart.addSeries(lib.CandlestickSeries,{upColor:"#37c7a3",downColor:"#ef5d6d",borderVisible:false,wickUpColor:"#37c7a3",wickDownColor:"#ef5d6d",priceFormat:{type:"price",precision:2,minMove:0.01}});
   resize=new ResizeObserver(()=>drawLevels());resize.observe(chartArea);
   const candles=await historical(generation);
   if(generation!==session||!active()||!selected())return;
   if(candles.length){series.setData(candles);lastCandle=candles[candles.length-1];chart.timeScale().fitContent();}
   else note("Sin velas históricas disponibles. Esperando ticks reales.");
   connect(generation);drawLevels();
  }catch(e){if(generation===session){note("BTC-USD no disponible: "+e.message+". No se usará información inventada.");buy.disabled=true;sell.disabled=true;}}
  if(generation!==session)return;
  clock=setInterval(()=>updateStats(),5000);
 }
 function stop(){
  ++session;if(clock){clearInterval(clock);clock=null}
  closeSocket();resetChart();page.classList.remove("olfxAutoMode");native.hidden=true;warning.hidden=!active()||selected();
  oldToggle.hidden=false;
 }
 function sync(){
  if(!active()){stop();warning.hidden=true;return}
  if(!selected()){if(!native.hidden)stop();warning.hidden=false;oldToggle.hidden=true;oldPanel.hidden=true;badge.textContent="AUTO SOLO BTC-USD";return}
  if(native.hidden)start();
 }
 function priceFromPoint(event){
  if(!series)return null;
  const rect=chartArea.getBoundingClientRect(),y=event.clientY-rect.top;
  const price=Number(series.coordinateToPrice(y));
  return good(price)?price:null;
 }
 function installDrag(handle,which){
  handle.addEventListener("pointerdown",event=>{
   const t=openTrade();if(!t||!series)return;
   drag={which,id:t.id,old:t[which]};handle.setPointerCapture(event.pointerId);event.preventDefault();
  });
  handle.addEventListener("pointermove",event=>{
   if(!drag)return;const t=openTrade(),price=priceFromPoint(event);if(!t||t.id!==drag.id||!good(price))return;
   const correct=which==="sl"?(t.side==="BUY"?price<t.entry:price>t.entry):(t.side==="BUY"?price>t.entry:price<t.entry);
   if(!correct)return;
   t[which]=Math.round(price*100)/100;
   drawLevels();updateStats();
  });
  const finish=()=>{
   if(!drag)return;const t=openTrade();if(t&&t.id===drag.id){saveAccount();note(which.toUpperCase()+" movido a "+format(t[which])+" · gestión virtual, sin órdenes reales.")}
   drag=null;
  };
  handle.addEventListener("pointerup",finish);handle.addEventListener("pointercancel",finish);
 }
 installDrag(tpHandle,"tp");installDrag(slHandle,"sl");
 buy.addEventListener("click",()=>newTrade("BUY"));sell.addEventListener("click",()=>newTrade("SELL"));
 exit.addEventListener("click",()=>{if(fresh())close("Cierre manual",quotePrice);else note("No se puede cerrar sin una cotización actual.")});
 accounts.addEventListener("change",()=>{
  const val=Number(accounts.value);if(!sizes.includes(val)||!accountOwner())return;
  size=val;loadAccount();updateStats();note("Cuenta virtual "+money(size)+" seleccionada.");
 });
 symbol.addEventListener("change",sync);
 interval.addEventListener("change",()=>{if(selected()&&active()){stop();start()}});
 const reload=page.querySelector("#olfxChartReload");
 reload.addEventListener("click",()=>{if(selected()&&active()){stop();start()}});
 const observer=new MutationObserver(sync);
 observer.observe(page,{attributes:true,attributeFilter:["class"]});
 observer.observe(portal,{attributes:true,attributeFilter:["class"]});
 sync();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();