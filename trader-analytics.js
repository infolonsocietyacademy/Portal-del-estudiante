(function(){
  "use strict";
  const core=window.olonAnalyticsCore,root=document.getElementById("traderAnalytics");
  if(!core || !root) return;
  const $=id=>root.querySelector("#"+id);
  const number=n=>new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(n);
  const cash=n=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(n);
  const signed=n=>(n>0?"+":n<0?"−":"")+cash(Math.abs(n));
  const percent=n=>n===null ? "—" : number(n)+"%";
  const ratio=n=>n===null ? "—" : n===Infinity ? "∞" : number(n);
  let rows=[],owner=null,dimension="instrument",expanded=false;
  let selection={period:"month",instrument:"",strategy:"",side:"",session:"",from:"",to:""};
  function text(id,value){$(id).textContent=value;}
  function tone(id,n){$(id).dataset.tone=n>0?"positive":n<0?"negative":"";}
  function options(id,field,label){
    const select=$(id),previous=select.value;
    const values=[...new Set(rows.filter(core.trade).map(r=>core.key(r[field])).filter(Boolean))].sort();
    select.replaceChildren(new Option(label,""),...values.map(v=>new Option(v,v)));
    select.value=values.includes(previous)?previous:"";
    return select.value;
  }
  function status(message,error=false){
    text("analyticsStatus",message);$("analyticsStatus").hidden=!message;$("analyticsStatus").dataset.tone=error?"error":"";
  }
  function drawGroups(selected){
    const groups=core.groups(selected,dimension),body=$("analyticsBreakdownBody");
    body.replaceChildren();
    text("analyticsGroupCount",groups.length ? groups.length+(groups.length===1?" grupo":" grupos") : "Sin operaciones");
    text("analyticsGroupHeading",{instrument:"Activo",strategy:"Estrategia",session:"Sesión",hour:"Hora PR"}[dimension]);
    if(!groups.length){
      const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=5;td.className="analyticsEmpty";
      td.textContent="Tus operaciones aparecerán aquí. Registra cada entrada para descubrir qué activo, estrategia y horario te funcionan mejor.";tr.append(td);body.append(tr);
    }
    for(const group of groups.slice(0,expanded?groups.length:8)){
      const tr=document.createElement("tr");
      for(const [i,value] of [group.label,String(group.total),percent(group.winrate),signed(group.net),group.avgR===null?"—":number(group.avgR)+" R"].entries()){
        const td=document.createElement("td");td.textContent=value;
        if(i===3) td.dataset.tone=group.net>0?"positive":group.net<0?"negative":"";
        if(i===4) td.title=group.rCount+" de "+group.total+" operaciones con riesgo inicial";
        tr.append(td);
      }
      body.append(tr);
    }
    $("analyticsMoreGroups").hidden=groups.length<=8;
    text("analyticsMoreGroups",expanded?"Mostrar menos":"Ver todos los grupos ("+groups.length+")");
  }
  function update(){
    const bounds=core.range(selection.period,core.today(),selection.from,selection.to);
    $("analyticsCustomDates").hidden=selection.period!=="custom";
    for(const button of root.querySelectorAll("[data-analytics-period]")) button.setAttribute("aria-pressed",String(button.dataset.analyticsPeriod===selection.period));
    const filtered=core.filter(rows,selection),stats=core.stats(filtered),days=core.days(filtered);
    const legacy=filtered.filter(r=>!core.trade(r)).length;
    const metadataFilter=Boolean(selection.instrument||selection.strategy||selection.side||selection.session);
    text("analyticsPeriodLabel",bounds.valid ? (bounds.start || "Inicio del historial")+" → "+bounds.end+" · PR" : "Selecciona un rango válido");
    text("analyticsWinrate",percent(stats.winrate));
    text("analyticsWins",stats.wins);text("analyticsLosses",stats.losses);text("analyticsFlat",stats.flat);
    $("analyticsWinArc").style.strokeDashoffset=String(213.63*(1-(stats.winrate || 0)/100));
    text("analyticsSample",stats.total+" operaciones cerradas · BE fuera del porcentaje");
    text("analyticsNet",stats.total ? signed(stats.net) : "—");tone("analyticsNet",stats.net);
    text("analyticsNetNote",stats.total ? "Suma de resultados netos registrados" : "Registra una operación para comenzar");
    text("analyticsProfitFactor",ratio(stats.profitFactor));
    text("analyticsFactorNote",stats.profitFactor===Infinity ? "Hay ganancias; aún no hay pérdidas" : stats.total ? "Ganancias acumuladas ÷ pérdidas acumuladas" : "Necesita operaciones registradas");
    text("analyticsExpectancy",stats.expectancy===null ? "—" : signed(stats.expectancy));tone("analyticsExpectancy",stats.expectancy || 0);
    text("analyticsAverageR",stats.avgR===null ? "—" : number(stats.avgR)+" R");tone("analyticsAverageR",stats.avgR || 0);
    text("analyticsRiskCoverage",stats.rCount+" de "+stats.total+" operaciones con riesgo inicial");
    text("analyticsAvgWin",stats.avgWin===null ? "—" : "+"+cash(stats.avgWin));
    text("analyticsAvgLoss",stats.avgLoss===null ? "—" : "−"+cash(stats.avgLoss));
    text("analyticsDrawdown",stats.total ? cash(stats.drawdown) : "—");
    text("analyticsDrawdownNote","Pico a valle · operaciones seleccionadas");
    text("analyticsStreakWin",stats.maxWins+" G");text("analyticsStreakLoss",stats.maxLosses+" P");
    text("analyticsStreakNote",stats.currentStreak.count ? "Actual: "+stats.currentStreak.count+(stats.currentStreak.type==="win"?" ganadas":stats.currentStreak.type==="loss"?" perdidas":" break even") : "Las rachas comienzan con tu primer trade");
    text("analyticsDayRate",percent(days.winrate));text("analyticsDayCount",days.total+" días registrados");
    text("analyticsDaysPositive",days.wins);text("analyticsDaysNegative",days.losses);text("analyticsDaysFlat",days.flat);
    text("analyticsBestDay",days.best===null ? "—" : signed(days.best));tone("analyticsBestDay",days.best || 0);
    text("analyticsWorstDay",days.worst===null ? "—" : signed(days.worst));tone("analyticsWorstDay",days.worst || 0);
    text("analyticsDailyNet",days.total ? signed(days.net) : "—");tone("analyticsDailyNet",days.net);
    $("analyticsDayPositiveBar").style.width=(days.total?days.wins/days.total*100:0)+"%";
    $("analyticsDayNegativeBar").style.width=(days.total?days.losses/days.total*100:0)+"%";
    text("analyticsDailyNote",metadataFilter ? "Resultados diarios de las operaciones que coinciden con tus filtros." : "Agrupa operaciones y resúmenes diarios por fecha. Depósitos y retiros se excluyen del resultado.");
    const dd=core.accountDrawdown(rows,bounds);
    text("analyticsAccountDD",!bounds.valid || metadataFilter ? "—" : dd.percent===null ? "Sin base de capital" : percent(dd.percent));
    text("analyticsAccountDDLabel",metadataFilter ? "DD de cuenta disponible sin filtros de activo, estrategia, dirección o sesión" : "DD de cuenta · saldo cerrado ajustado por depósitos y retiros");
    const times=filtered.filter(r=>core.trade(r)&&r.trade_time).length;
    text("analyticsTimeCoverage",times+" de "+stats.total+" operaciones con hora PR");
    text("analyticsLegacyCoverage",legacy+" resúmenes diarios conservados");
    if(!bounds.valid) status("Selecciona una fecha inicial y final válidas. La fecha final debe ser igual o posterior a la inicial.",true);
    else if(!stats.total && legacy) status("Tus "+legacy+" resúmenes diarios se conservan en Resultados diarios. El Win Rate por operación comenzará cuando registres cada trade.");
    else if(!stats.total) status(rows.some(core.trade)?"No hay operaciones que coincidan con estos filtros.":"Comienza registrando una operación. Tus estadísticas se calcularán con tus propios resultados.");
    else status(legacy ? legacy+" resúmenes diarios se muestran por separado y no cuentan como operaciones." : "");
    drawGroups(filtered);
  }
  function render(records=[],id=null){
    if(owner!==id){
      owner=id;selection={period:"month",instrument:"",strategy:"",side:"",session:"",from:"",to:""};
      $("analyticsSide").value=$("analyticsSession").value="";dimension="instrument";expanded=false;
      for(const button of root.querySelectorAll("[data-analytics-dimension]")) button.setAttribute("aria-pressed",String(button.dataset.analyticsDimension===dimension));
      $("analyticsFrom").value=core.today().slice(0,7)+"-01";$("analyticsTo").value=core.today();
    }
    rows=records.slice();
    selection.instrument=options("analyticsInstrument","trade_instrument","Todos");
    selection.strategy=options("analyticsStrategy","trade_strategy","Todas");
    selection.from=$("analyticsFrom").value;selection.to=$("analyticsTo").value;
    update();
  }
  root.addEventListener("click",event=>{
    const period=event.target.closest("[data-analytics-period]")?.dataset.analyticsPeriod;
    const group=event.target.closest("[data-analytics-dimension]")?.dataset.analyticsDimension;
    if(period){selection.period=period;expanded=false;update();}
    if(group){dimension=group;expanded=false;for(const button of root.querySelectorAll("[data-analytics-dimension]"))button.setAttribute("aria-pressed",String(button.dataset.analyticsDimension===group));update();}
  });
  for(const [id,field] of [["analyticsInstrument","instrument"],["analyticsStrategy","strategy"],["analyticsSide","side"],["analyticsSession","session"],["analyticsFrom","from"],["analyticsTo","to"]]){
    $(id).addEventListener("change",()=>{selection[field]=$(id).value;expanded=false;update();});
  }
  $("analyticsMoreGroups").addEventListener("click",()=>{expanded=!expanded;update();});
  window.olonAnalytics={render};
  render(typeof cachedRecords!=="undefined"?cachedRecords:[],typeof currentUser!=="undefined"?currentUser?.id:null);
})();
