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

    if(quick)register.prepend(quick);
    if(classesShortcut)byId("academyClassesPage")?.append(classesShortcut);
    if(registerShortcut)register.append(registerShortcut);

    const kpiBlock=section("olSummaryKPIsBlock","Tu rendimiento de un vistazo","Datos calculados desde tu historial personal.","comparacion");
    kpiBlock.id="olonSummaryKPIs";
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

    // Six predictable dashboard sections. Welcome remains the existing VIP profile.
    const layout=document.createDocumentFragment();
    layout.append(welcome,kpiBlock,growth,goalBlock,calendarBlock,top);
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
      refresh() {byId("olonSummaryKPIs")?.querySelectorAll("[data-kpi-source]").forEach(value=>{
        const origin=byId(value.dataset.kpiSource);
        if(!origin)return;
        value.textContent=value.dataset.kpiSource==="analyticsSample"
          ?(origin.textContent.match(/\d[\d.,]*/)?.[0]||"0")
          :origin.textContent.trim();
      });}
    };
    requestAnimationFrame(()=>window.dispatchEvent(new Event("resize")));
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})();