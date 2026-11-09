/* OLON Market Stream / TradingView. One widget per visible screen, never both at once. */
(function(){
  "use strict";
  const symbols=[
    {proName:"BITSTAMP:BTCUSD",title:"BTC"},
    {proName:"OANDA:US30USD",title:"US30"},
    {proName:"OANDA:NAS100USD",title:"NAS100"},
    {proName:"OANDA:XAUUSD",title:"XAUUSD"},
    {proName:"OANDA:EURUSD",title:"EURUSD"}
  ];
  const views=[
    ["homeMarketTape","homeMarketTapeMount","homeMarketTapeStatus","auth"],
    ["olonMarketTape","marketTapeMount","marketTapeStatus","portal"]
  ].map(([rootId,mountId,statusId,screenId])=>({
    root:document.getElementById(rootId),mount:document.getElementById(mountId),
    status:document.getElementById(statusId),screen:document.getElementById(screenId),
    active:false,nonce:0,timer:null,observer:null
  })).filter(v=>v.root&&v.mount&&v.status&&v.screen);
  function dispose(v){
    v.nonce++;
    if(v.timer)clearTimeout(v.timer);
    if(v.observer)v.observer.disconnect();
    v.timer=null;v.observer=null;
    v.mount.replaceChildren();
    v.status.hidden=true;v.active=false;
  }
  function load(v){
    v.active=true;
    const nonce=++v.nonce;
    v.status.textContent="Cargando cotizaciones…";v.status.hidden=false;
    const container=document.createElement("div");container.className="tradingview-widget-container";
    const mount=document.createElement("div");mount.className="tradingview-widget-container__widget";
    const credit=document.createElement("div");credit.className="marketTapeAttribution";
    const a=document.createElement("a");a.href="https://www.tradingview.com/markets/";
    a.target="_blank";a.rel="noopener noreferrer";a.textContent="Cotizaciones por TradingView";
    credit.append(a);
    const src=document.createElement("script");src.async=true;src.type="text/javascript";
    src.src="https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js";
    src.textContent=JSON.stringify({symbols,showSymbolLogo:true,isTransparent:true,displayMode:"regular",colorTheme:"dark",locale:"es"});
    src.onerror=()=>{
      if(nonce!==v.nonce)return;
      v.observer?.disconnect();
      v.status.hidden=false;v.status.textContent="No se pudieron cargar las cotizaciones.";
    };
    v.observer=new MutationObserver(()=>{
      const frame=container.querySelector("iframe");
      if(!frame)return;
      frame.title="Precios BTC, US30, NAS100, XAUUSD y EURUSD · TradingView";
      frame.addEventListener("load",()=>{if(nonce!==v.nonce)return;clearTimeout(v.timer);v.status.hidden=true;},{once:true});
      v.observer?.disconnect();v.observer=null;
    });
    v.observer.observe(container,{childList:true,subtree:true});
    container.append(mount,credit,src);
    v.mount.append(container);
    v.timer=setTimeout(()=>{
      if(nonce===v.nonce&&!container.querySelector("iframe")){
        v.observer?.disconnect();v.observer=null;
        v.status.hidden=false;v.status.textContent="Cotizaciones temporalmente no disponibles.";
      }
    },15000);
  }
  function sync(){
    for(const v of views){
      const visible=!v.screen.classList.contains("hidden");
      if(visible&&!v.active)load(v);
      if(!visible&&v.active)dispose(v);
    }
  }
  for(const v of views)new MutationObserver(sync).observe(v.screen,{attributes:true,attributeFilter:["class"]});
  sync();
})();
