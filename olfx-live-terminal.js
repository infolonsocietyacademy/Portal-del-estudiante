/* OLFX Live Terminal — isolated, lazy TradingView integration. */
(function () {
  "use strict";

  function init() {
    const page = document.getElementById("olfxLiveTerminalPage");
    const portal = document.getElementById("portal");
    if (!page || !portal || page.dataset.olfxInitialized === "true") return;
    page.dataset.olfxInitialized = "true";

    const mount = page.querySelector("#olfxChartMount");
    const symbolInput = page.querySelector("#olfxChartSymbol");
    const intervalInput = page.querySelector("#olfxChartInterval");
    const reloadButton = page.querySelector("#olfxChartReload");
    const status = page.querySelector("#olfxChartStatus");

    const symbols = Object.freeze({
      XAUUSD: "OANDA:XAUUSD",
      NASDAQ: "NASDAQ:NDX",
      EURUSD: "FX:EURUSD",
      USDJPY: "FX:USDJPY",
      BTCUSD: "BITSTAMP:BTCUSD"
    });

    let currentKey = "";
    function visible() {
      return !page.classList.contains("hidden") && !portal.classList.contains("hidden");
    }

    function unload() {
      currentKey = "";
      mount.replaceChildren();
      status.textContent = "Gráfica detenida mientras esta sección está cerrada.";
    }

    function load(force) {
      if (!visible()) {
        if (currentKey) unload();
        return;
      }
      const symbol = symbols[symbolInput.value] || symbols.XAUUSD;
      const interval = intervalInput.value;
      const key = symbol + "|" + interval;
      if (!force && key === currentKey) return;
      currentKey = key;
      mount.replaceChildren();
      status.textContent = "Conectando con la gráfica de TradingView…";

      const host = document.createElement("div");
      host.className = "tradingview-widget-container olfxTvHost";
      const widget = document.createElement("div");
      widget.className = "tradingview-widget-container__widget olfxTvWidget";
      host.appendChild(widget);

      const credit = document.createElement("div");
      credit.className = "tradingview-widget-copyright olfxTvCredit";
      const creditLink = document.createElement("a");
      creditLink.href = "https://www.tradingview.com/";
      creditLink.target = "_blank";
      creditLink.rel = "noopener noreferrer nofollow";
      creditLink.textContent = "Gráficas por TradingView";
      credit.appendChild(creditLink);
      host.appendChild(credit);
      mount.appendChild(host);

      const script = document.createElement("script");
      script.type = "text/javascript";
      script.async = true;
      script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
      script.textContent = JSON.stringify({
        autosize: true,
        symbol: symbol,
        interval: interval,
        timezone: "America/New_York",
        theme: "dark",
        style: "1",
        locale: "es",
        allow_symbol_change: false,
        hide_side_toolbar: false,
        hide_top_toolbar: false,
        withdateranges: true,
        save_image: true,
        calendar: false,
        support_host: "https://www.tradingview.com"
      });
      script.addEventListener("load", function () {
        if (key === currentKey) {
          status.textContent = "Gráfica de TradingView cargada. El proveedor determina la disponibilidad y latencia de los datos.";
        }
      }, { once: true });
      script.addEventListener("error", function () {
        if (key === currentKey) {
          status.textContent = "No se pudo conectar con TradingView. Comprueba la conexión o presiona Recargar.";
        }
      }, { once: true });
      host.appendChild(script);
    }

    symbolInput.addEventListener("change", function () { load(true); });
    intervalInput.addEventListener("change", function () { load(true); });
    reloadButton.addEventListener("click", function () { load(true); });

    const observer = new MutationObserver(function () { load(false); });
    observer.observe(page, { attributes: true, attributeFilter: ["class"] });
    observer.observe(portal, { attributes: true, attributeFilter: ["class"] });
    load(false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
