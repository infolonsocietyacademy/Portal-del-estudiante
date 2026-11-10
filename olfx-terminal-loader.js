/* OLFX safety loader — do not execute terminal code at login or on Dashboard. */
(function () {
  "use strict";
  function init() {
    const portal = document.getElementById("portal");
    const page = document.getElementById("olfxLiveTerminalPage");
    if (!portal || !page) return;
    let promise = null;
    const status = page.querySelector("#olfxChartStatus");

    function visible() {
      return !portal.classList.contains("hidden") && !page.classList.contains("hidden");
    }
    function report(message) {
      if (status) status.textContent = message;
    }
    function importScript(src) {
      return new Promise(function (resolve, reject) {
        const script = document.createElement("script");
        script.src = src;
        script.async = false;
        script.onload = resolve;
        script.onerror = function () {
          script.remove();
          reject(new Error("No se pudo descargar " + src.split("/").pop()));
        };
        document.body.appendChild(script);
      });
    }
    function open() {
      if (!visible() || promise) return;
      report("Iniciando OLFX Live Terminal…");
      promise = importScript("./olfx-live-terminal.js?v=20261110-safe-1")
        .then(function () {
          return importScript("./olfx-auto-sim.js?v=20261110-safe-1");
        })
        .catch(function (error) {
          promise = null;
          report("OLFX no pudo cargar: " + error.message + ". Puedes regresar al portal sin perder tu información.");
        });
    }
    const observer = new MutationObserver(open);
    observer.observe(portal, {attributes:true,attributeFilter:["class"]});
    observer.observe(page, {attributes:true,attributeFilter:["class"]});
    open();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, {once:true});
  } else {
    init();
  }
})();
