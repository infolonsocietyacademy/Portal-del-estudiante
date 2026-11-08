/* Official TradingView embed; no fabricated quotes or application credentials. */
(function(){
  "use strict";
  const root=document.getElementById("olonMarketTape"),mount=document.getElementById("marketTapeMount");
  if(!root || !mount) return;
  const status=document.getElementById("marketTapeStatus");
  let theme="",timer=null,generation=0;
  function render(){
    if(document.getElementById("portal")?.classList.contains("hidden") || document.getElementById("dashboard")?.classList.contains("hidden")) return;
    // Quotes stay on the requested black surface in every portal theme.
    const next="dark";
    if(next===theme) return;
    theme=next;
    const current=++generation;
    clearTimeout(timer);
    mount.replaceChildren();
    status.textContent="Cargando cotizaciones…";status.hidden=false;
    const container=document.createElement("div");container.className="tradingview-widget-container";
    const widget=document.createElement("div");widget.className="tradingview-widget-container__widget";
    const attribution=document.createElement("div");attribution.className="marketTapeAttribution";
    const link=document.createElement("a");link.href="https://www.tradingview.com/markets/";link.target="_blank";link.rel="noopener noreferrer";link.textContent="Cotizaciones por TradingView";
    attribution.append(link);
    const script=document.createElement("script");script.type="text/javascript";script.async=true;
    script.src="https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js";
    script.textContent=JSON.stringify({symbols:[
      {proName:"BITSTAMP:BTCUSD",title:"BTC"},
      {proName:"OANDA:US30USD",title:"US30"},
      {proName:"OANDA:XAUUSD",title:"XAUUSD"},
      {proName:"OANDA:EURUSD",title:"EURUSD"}
    ],showSymbolLogo:true,isTransparent:true,displayMode:"regular",colorTheme:theme,locale:"es"});
    script.onerror=()=>{if(current!==generation)return;observer.disconnect();status.hidden=false;status.textContent="No se pudieron cargar las cotizaciones. Puedes consultar los gráficos en TradingView.";};
    const observer=new MutationObserver(()=>{
      const frame=container.querySelector("iframe");
      if(!frame) return;
      frame.title="Precios de BTC, US30, XAUUSD y EURUSD · TradingView";
      frame.addEventListener("load",()=>{if(current!==generation)return;clearTimeout(timer);status.hidden=true;},{once:true});
      observer.disconnect();
    });
    observer.observe(container,{childList:true,subtree:true});
    container.append(widget,attribution,script);mount.append(container);
    timer=setTimeout(()=>{if(current===generation&&!container.querySelector("iframe")){observer.disconnect();status.textContent="Cotizaciones no disponibles en este momento. Consulta los gráficos en TradingView.";}},15000);
  }
  new MutationObserver(render).observe(document.body,{attributes:true,attributeFilter:["class"]});
  for(const id of ["portal","dashboard"]){const element=document.getElementById(id);if(element)new MutationObserver(render).observe(element,{attributes:true,attributeFilter:["class"]});}
  render();
})();
