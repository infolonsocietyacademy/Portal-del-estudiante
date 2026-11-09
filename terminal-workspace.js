/* Terminal workspace: arrange the existing dashboard without copying account data. */
(function(){
  "use strict";

  function arrangeWorkspace(){
    const dashboard = document.getElementById("dashboard");
    if(!dashboard || dashboard.dataset.terminalLayout === "ready") return;

    const metrics = dashboard.querySelector(":scope > .v3Grid");
    const overview = dashboard.querySelector(":scope > .cyberDashboardSpotlight");
    if(!metrics || !overview) return;

    dashboard.dataset.terminalLayout = "ready";
    metrics.classList.add("terminalSummaryMetrics");
    overview.classList.add("terminalOverview");
    const equityPanel = overview.querySelector(".chartBox");
    equityPanel?.classList.add("terminalEquityPanel");
    const equityTitle = equityPanel?.querySelector("h3");
    if(equityTitle) equityTitle.textContent = "Evolución de tu cuenta";

    const rail = overview.querySelector(".cyberDashboardRail");
    if(rail){
      rail.classList.add("terminalOverviewRail");
      rail.setAttribute("aria-label", "Calendario, clases y comunidad");
      const calendar = rail.querySelector(".calendarCard");
      calendar?.classList.add("terminalCalendarWidget");
      const [classesCard, actionsCard] = rail.querySelectorAll(".cyberRailCard");
      const classesTitle = classesCard?.querySelector("h3");
      const actionsTitle = actionsCard?.querySelector("h3");
      if(classesTitle) classesTitle.textContent = "Próximas clases";
      if(actionsTitle) actionsTitle.textContent = "Acceso rápido";

      const leaderboard = dashboard.querySelector("#olonLeaderboard");
      if(leaderboard){
        leaderboard.classList.add("terminalLeaderboardWidget");
      }
      // Match visual and reading order: classes, community, actions, calendar.
      [classesCard, leaderboard, actionsCard, calendar].forEach(widget => {
        if(widget) rail.append(widget);
      });
    }

    // Move the actual nodes: IDs, handlers, charts and data owners stay intact.
    const summary = document.createDocumentFragment();
    summary.append(metrics, overview);
    const marketTape = dashboard.querySelector(":scope > #olonMarketTape");
    if(marketTape) marketTape.after(summary);
    else dashboard.prepend(summary);

    // A chart may already exist by DOMContentLoaded. Let it measure its new column.
    window.requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", arrangeWorkspace, {once:true});
  }else{
    arrangeWorkspace();
  }
})();
