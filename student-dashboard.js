/* OLON Society Academy — focused student dashboard and dedicated Results workspace.
   Move existing elements rather than cloning them: IDs, controls and stored data stay intact. */
(() => {
  "use strict";
  const byId = id => document.getElementById(id);

  function section(className, title, description, detailLink) {
    const root=document.createElement("section");
    root.className="olSummaryBlock "+className;
    const header=document.createElement("header");
    header.className="olSummaryBlockHeader";
    const copy=document.createElement("div");
    const heading=document.createElement("h3");
    heading.textContent=title;
    copy.append(heading);
    if(description) {
      const paragraph=document.createElement("p");
      paragraph.textContent=description;
      copy.append(paragraph);
    }
    header.append(copy);
    if(detailLink) {
      const button=document.createElement("button");
      button.type="button";
      button.className="olSummaryDetail";
      button.dataset.summaryGoto=detailLink;
      button.textContent="Ver detalles";
      header.append(button);
    }
    root.append(header);
    return root;
  }

  function move(node,where) {if(node&&where)where.append(node);return node;}

  function textEl(tag,value,className="") {
    const node=document.createElement(tag);
    node.textContent=String(value??"");
    if(className)node.className=className;
    return node;
  }
  function money(value, currency="USD"){
    if(value===null||value===undefined||value==="")return "—";
    const n=Number(value);
    if(!Number.isFinite(n))return "—";
    const iso=/^[A-Z]{3}$/.test(String(currency||""))?currency:"USD";
    try{return new Intl.NumberFormat("es-PR",{style:"currency",currency:iso,maximumFractionDigits:2}).format(n)}
    catch{return n.toFixed(2)+" "+iso}
  }
  function mt5Overview(){
    const block=section("olSummaryMT5Block","Mi cuenta MetaTrader 5","Balance, rendimiento y conexión de tu cuenta principal. Datos importados de MT5; sin cifras simuladas.","metaapiAccountsPage");
    block.id="olonSummaryMT5";
    const top=document.createElement("div");
    top.className="olSummaryMT5Top";
    const state=textEl("div","Consultando cuentas vinculadas…","olSummaryMT5Status");
    state.id="olonSummaryMT5Status";
    state.setAttribute("role","status");
    top.append(state);
    const refresh=document.createElement("button");
    refresh.type="button";
    refresh.textContent="Actualizar datos";
    refresh.className="olSummaryMT5Refresh";
    refresh.addEventListener("click",()=>void load(true));
    top.append(refresh);block.append(top);
    const grid=document.createElement("div");
    grid.className="olSummaryMT5Metrics";
    const fields=[
      ["balance","Balance"],["equity","Equity"],["winrate","WinRate"],
      ["trades","Operaciones cerradas"],["month","Resultado mensual"],["today","Resultado de hoy"],
      ["week","Resultado semanal"],["net","P&L importado"]
    ];
    const nodes={};
    fields.forEach(([key,label])=>{
      const cell=document.createElement("div");cell.className="olSummaryMT5Metric";
      cell.append(textEl("span",label));
      const value=textEl("strong","—");value.dataset.mtMetric=key;
      nodes[key]=value;cell.append(value);grid.append(cell);
    });
    block.append(grid);
    const foot=textEl("p","Selecciona una cuenta MT5 para que sus estadísticas aparezcan aquí.","olSummaryMT5Foot");
    block.append(foot);
    let loading=false,lastRequest=0;
    function clear(){
      Object.values(nodes).forEach(node=>{node.textContent="—";node.classList.remove("negative")});
    }
    function set(key,value,negative=false){
      const node=nodes[key];if(!node)return;
      node.textContent=String(value??"—");
      node.classList.toggle("negative",Boolean(negative));
    }
    async function load(force=false){
      if(loading||document.visibilityState==="hidden")return;
      if(!force&&Date.now()-lastRequest<25000)return;
      if(!window.olonOwnAccountStatus){
        state.textContent="Conector no disponible. Abre Mis cuentas MT4/MT5.";
        return;
      }
      loading=true;lastRequest=Date.now();refresh.disabled=true;
      try{
        const result=await window.olonOwnAccountStatus();
        const accounts=Array.isArray(result?.accounts)?result.accounts:[];
        const primary=accounts.find(a=>a.is_primary)||accounts[0];
        if(!primary){
          clear();
          state.textContent="Sin cuenta MT5 vinculada";
          foot.textContent="Conecta tu propia cuenta en Mis cuentas MT4/MT5. Los historiales antiguos no se incluyen.";
          return;
        }
        const ready=primary.status==="active"&&Boolean(primary.last_sync_at);
        state.textContent=(primary.broker_server||"MT5")+" · "+(primary.login_masked||"Cuenta")
          +(ready?" · Sincronizada":primary.status==="error"?" · Requiere revisión":" · Pendiente de primera sincronización");
        if(!ready){
          clear();
          foot.textContent=primary.status==="error"
            ?"La sincronización presentó un error. Abre Mis cuentas MT4/MT5 para ver el detalle."
            :"La cuenta ya está vinculada. Abre el agente OLFX CONNECT en Windows para importar el balance y las operaciones.";
          return;
        }
        const currency=primary.currency||"USD";
        set("balance",money(primary.balance,currency));
        set("equity",money(primary.equity,currency));
        set("winrate",primary.win_rate==null?"—":Number(primary.win_rate).toFixed(2)+"%");
        set("trades",String(primary.closed_trades??"—"));
        for(const [key,field] of [["month","month_net"],["today","today_net"],["week","week_net"],["net","net_profit"]]){
          const val=primary[field];
          set(key,money(val,currency),Number(val)<0);
        }
        const updated=new Date(primary.last_sync_at);
        foot.textContent="Última sincronización: "+(Number.isFinite(updated.getTime())
          ?updated.toLocaleString("es-PR",{timeZone:"America/Puerto_Rico"}):"—")
          +" · Solo datos reales. Para detalles y otras cuentas, abre Mis cuentas MT4/MT5.";
      }catch(e){
        state.textContent="No se pudieron consultar las estadísticas de MT5";
        foot.textContent="Comprueba tu sesión o abre Mis cuentas MT4/MT5. "+String(e?.message||"Error").slice(0,110);
      }finally{loading=false;refresh.disabled=false;}
    }
    // Poll only the lightweight status endpoint when the student visits Resumen.
    const timer=setInterval(()=>{
      if(!byId("dashboard")?.classList.contains("hidden"))void load();
    },30000);
    window.addEventListener("pagehide",()=>clearInterval(timer),{once:true});
    document.addEventListener("visibilitychange",()=>{
      if(document.visibilityState==="visible"&&!byId("dashboard")?.classList.contains("hidden"))void load();
    });
    window.olonSummaryMt5Refresh=()=>load(true);
    return {block,load};
  }
  function quickLinks(){
    const block=section("olSummaryQuickBlock","Todo tu portal en un lugar","Abre cualquiera de tus herramientas sin sobrecargar el Resumen.");
    block.id="olonSummaryQuickLinks";
    const links=[
      ["Mis cuentas MT4/MT5","metaapiAccountsPage","Conecta y revisa cuentas"],
      ["Resultados","comparacion","Estadísticas y reportes"],
      ["Historial","historial","Operaciones y calendario"],
      ["Checklist","academyChecklistPage","Rutina y disciplina"],
      ["Clases","academyClassesPage","Contenido educativo"],
      ["Renovación VIP","academyVipPage","Acceso y pagos"],
      ["Noticias","newsProPage","Eventos del mercado"],
      ["Notificaciones","notificationsPage","Mensajes importantes"],
      ["Institutional Flow","institutionalFlowPage","Herramientas institucionales"]
    ];
    const grid=document.createElement("div");grid.className="olSummaryQuickGrid";
    links.forEach(([label,page,description])=>{
      const button=document.createElement("button");
      button.type="button";button.dataset.summaryGoto=page;
      button.className="olSummaryQuickLink";
      button.append(textEl("strong",label),textEl("span",description));
      grid.append(button);
    });
    block.append(grid);
    return block;
  }

  function init() {
    const dashboard=byId("dashboard"), results=byId("comparacion"), register=byId("registro");
    if(!dashboard||!results||!register||byId("olonSummaryKPIs"))return;

    const welcome=byId("portalWelcomeCard");
    const equity=dashboard.querySelector(".terminalEquityPanel")||dashboard.querySelector(".chartBox");
    const calendar=dashboard.querySelector(".calendarCard");
    const leaderboard=byId("olonLeaderboard");
    const goals=Array.from(dashboard.querySelectorAll(".goalCard"));
    const analytics=byId("traderAnalytics");
    if(!welcome||!equity||!calendar||!leaderboard||goals.length!==2||!analytics)return;

    const detailed=document.createElement("div");
    detailed.id="olonDetailedResults";
    detailed.className="olDetailedResults";
    const detailsIntro=document.createElement("div");
    detailsIntro.className="olDetailedResultsIntro";
    const detailsH=document.createElement("h3");
    detailsH.textContent="Análisis completo de trading";
    const detailsP=document.createElement("p");
    detailsP.textContent="Estadísticas avanzadas, reportes, Trader Score, capital y comparativas en una sola página.";
    detailsIntro.append(detailsH,detailsP);
    detailed.append(detailsIntro);
    results.append(detailed);

    const metrics=dashboard.querySelector(".terminalSummaryMetrics")||dashboard.querySelector(":scope > .v3Grid");
    const ledger=dashboard.querySelector(".terminalAccountStrip")||dashboard.querySelector(":scope > .ledgerMetrics");
    const report=dashboard.querySelector(".selectedReportCard");
    const score=dashboard.querySelector(".traderScoreCard");
    const ai=dashboard.querySelector(".aiCard");
    const quote=byId("dailyQuote");
    const privateNote=dashboard.querySelector(":scope > .layout");
    const quick=dashboard.querySelector(".ledgerQuickActions");
    const rails=dashboard.querySelectorAll(".cyberRailCard");
    const classesShortcut=rails[0], registerShortcut=rails[1];

    // Results: same live charts, reports and analytic controls, no duplicated IDs.
    move(analytics,detailed);
    if(metrics){
      const block=section("olDetailedBlock","Indicadores de rendimiento","Ranking, crecimiento y drawdown histórico.");
      move(metrics,block);detailed.append(block);
    }
    if(ledger){
      const block=section("olDetailedBlock","Capital y movimientos","Depósitos, retiros, resultado neto y balance registrado.");
      move(ledger,block);detailed.append(block);
    }
    if(report){
      const block=section("olDetailedBlock","Reportes semanales, mensuales y anuales","Consulta o descarga tu reporte premium.");
      move(report,block);detailed.append(block);
    }
    if(score){
      const block=section("olDetailedBlock","Psicología y Trader Score","Disciplina, consistencia y control de riesgo.");
      move(score,block);detailed.append(block);
    }
    if(ai){
      const block=section("olDetailedBlock","Análisis automático","Revisa las recomendaciones que genera tu historial.");
      move(ai,block);detailed.append(block);
    }
    if(privateNote)move(privateNote,detailed);
    if(quote)move(quote,detailed);
    // Keep the live risk calculator and any additional functioning widgets.
    const calculator=byId("olonRiskCalculator");
    if(calculator) {
      const block=section("olDetailedBlock","Calculadora de riesgo","Calcula el tamaño de posición con tus propios parámetros.");
      move(calculator,block);
      detailed.append(block);
    }
    const terminalIntro=dashboard.querySelector(".olonTerminalIntro");
    if(terminalIntro)move(terminalIntro,detailed);

    if(quick)register.prepend(quick);
    if(classesShortcut)byId("academyClassesPage")?.append(classesShortcut);
    if(registerShortcut)register.append(registerShortcut);
    // License activation remains in the student's profile card inside the welcome
    // area. Renewal VIP is reserved for payment proofs and their approval history.

    const kpiBlock=section("olSummaryKPIsBlock","Tu rendimiento de un vistazo","Datos calculados desde tu historial personal.","comparacion");
    kpiBlock.id="olonSummaryKPIs";
    const connectionNote=document.createElement("p");
    connectionNote.id="olonSummaryConnectionNotice";
    connectionNote.setAttribute("role","status");
    connectionNote.className="metaapi-muted";
    connectionNote.textContent="Comprobando conexión MT5…";
    kpiBlock.append(connectionNote);
    const kpiGrid=document.createElement("div");
    kpiGrid.className="olSummaryKPIGrid";
    const kpiItems=[
      {label:"Saldo registrado",source:"mBalance",empty:"$0.00"},
      {label:"Resultado del mes",source:"calendarMonthNet",empty:"$0.00"},
      {label:"WinRate registrado",source:"analyticsWinrate",empty:"—"},
      {label:"Operaciones del período",source:"analyticsSample",empty:"0",operation:true}
    ];
    const mirrors=[];
    for(const item of kpiItems){
      const card=document.createElement("div");
      card.className="olSummaryKPI";
      const name=document.createElement("span");
      name.textContent=item.label;
      const value=document.createElement("strong");
      value.textContent=item.empty;
      value.dataset.kpiSource=item.source;
      card.append(name,value);
      kpiGrid.append(card);
      const original=byId(item.source);
      if(!original)continue;
      const update=()=>{
        const sourceValue=original.textContent.trim();
        if(item.operation) {
          const count=sourceValue.match(/\d[\d.,]*/)?.[0];
          value.textContent=count||"0";
        } else value.textContent=sourceValue||item.empty;
        card.classList.toggle("negative",/^[−-]/.test(value.textContent));
      };
      update();
      const observer=new MutationObserver(update);
      observer.observe(original,{subtree:true,childList:true,characterData:true});
      mirrors.push(observer);
    }
    kpiBlock.append(kpiGrid);

    const mtOverview=mt5Overview();
    const shortcutPanel=quickLinks();

    const growth=section("olSummaryGrowthBlock","Evolución de tu cuenta","Gráfica del balance registrado.","comparacion");
    growth.id="olonSummaryGrowth";
    move(equity,growth);

    const goalBlock=section("olSummaryGoalsBlock","Tus metas","Control de progreso mensual y anual.");
    goalBlock.id="olonSummaryGoals";
    const goalGrid=document.createElement("div");
    goalGrid.className="olSummaryGoalsGrid";
    goals.forEach(goal=>move(goal,goalGrid));
    goalBlock.append(goalGrid);

    const calendarBlock=section("olSummaryCalendarBlock","Calendario del mes","Tus ganancias y pérdidas por día.","historial");
    calendarBlock.id="olonSummaryCalendar";
    move(calendar,calendarBlock);

    const top=section("olSummaryRankingBlock","Comunidad OLON","TOP 3 semanal, mensual y anual.");
    top.id="olonSummaryRanking";
    move(leaderboard,top);

    // Preserve any other functional modules added by external portal scripts.
    for(const extra of Array.from(dashboard.children)) {
      if(extra===welcome)continue;
      if(extra.querySelector("button,input,select,textarea,canvas,[id]")) {
        const block=section("olDetailedBlock","Otras herramientas","Funciones complementarias del portal.");
        move(extra,block);
        detailed.append(block);
      }
    }

    // Cohesive dashboard: VIP profile, KPIs, MT5, chart, goals, calendar, Top 3 and shortcuts.
    const layout=document.createDocumentFragment();
    layout.append(welcome,kpiBlock,mtOverview.block,growth,goalBlock,calendarBlock,top,shortcutPanel);
    dashboard.replaceChildren(layout);
    dashboard.classList.add("olSummaryFocused");

    dashboard.addEventListener("click",event=>{
      const trigger=event.target.closest("[data-summary-goto]");
      if(!trigger)return;
      const page=trigger.dataset.summaryGoto;
      const button=document.querySelector('#sidebar .portalNavLink[data-page="'+page+'"]');
      if(typeof window.showPage==="function")window.showPage(page,button);
    });

    window.olonStudentSummary={
      setConnectionState(connected){
        const hint=byId("olonSummaryConnectionNotice");
        if(hint)hint.textContent=connected
          ?"Datos obtenidos de una cuenta MT conectada."
          :"Sin cuenta MT conectada. Los historiales antiguos se conservan en Account Vault, pero no se incluyen en Resumen.";
        byId("dashboard")?.classList.toggle("olonSummaryDisconnected",!connected);
        if(!connected){
          byId("olonSummaryKPIs")?.querySelectorAll("[data-kpi-source]").forEach(value=>{
            value.textContent="—";value.classList.remove("negative");
          });
        }else this.refresh();
      },
      refresh() {
        if(!window.olonMtRecords?.linked?.()){
          this.setConnectionState(false);return;
        }
        byId("olonSummaryKPIs")?.querySelectorAll("[data-kpi-source]").forEach(value=>{
        const origin=byId(value.dataset.kpiSource);
        if(!origin)return;
        value.textContent=value.dataset.kpiSource==="analyticsSample"
          ?(origin.textContent.match(/\d[\d.,]*/)?.[0]||"0")
          :origin.textContent.trim();
      });}
    };
    void mtOverview.load(true);
    requestAnimationFrame(()=>window.dispatchEvent(new Event("resize")));
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})();