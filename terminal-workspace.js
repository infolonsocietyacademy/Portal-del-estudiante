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
    if(equityTitle) equityTitle.textContent = "Rendimiento (balance registrado)";

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
      if(!rail.querySelector(".terminalRailHeading")){
        const railHeading = document.createElement("h3");
        railHeading.className = "terminalFluidHeading terminalRailHeading";
        railHeading.textContent = "Actividad y calendario";
        rail.prepend(railHeading);
      }
    }

    // Existing live DOM nodes are moved, never copied: data bindings remain intact.
    const accountStrip = dashboard.querySelector(":scope > .ledgerMetrics");
    if(accountStrip) accountStrip.classList.add("terminalAccountStrip");
    const analytics = dashboard.querySelector(":scope > #traderAnalytics");
    function sectionHeading(label){
      const heading = document.createElement("h2");
      heading.className = "terminalFluidHeading";
      heading.textContent = label;
      return heading;
    }
    const summary = document.createDocumentFragment();
    summary.append(sectionHeading("Resumen de la cuenta"));
    if(accountStrip) summary.append(accountStrip);
    summary.append(overview, sectionHeading("Métricas de trading"), metrics);
    if(analytics) summary.append(analytics);
    const welcome = dashboard.querySelector("#portalWelcomeCard");
    if(welcome && dashboard.firstElementChild !== welcome) dashboard.prepend(welcome);
    if(welcome) welcome.after(summary);
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
