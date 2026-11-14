(() => {
  "use strict";

  const byId = id => document.getElementById(id);
  const month = byId("historyMonth");
  const kind = byId("historyKind");
  const list = byId("historyList");
  const more = byId("historyMore");
  const empty = byId("historyEmpty");
  const periodFormat = new Intl.DateTimeFormat("es-PR",{month:"short",year:"numeric",timeZone:"UTC"});
  const dayFormat = new Intl.DateTimeFormat("es-PR",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"});
  const pageSize = 25;
  let owner = null;
  let rows = [];
  let shown = pageSize;
  let individualDates = new Set();

  function parseDate(date){
    return new Date(date + "T00:00:00Z");
  }

  function option(value,label){
    return new Option(label,value);
  }

  function setMonths(preferred=month.value){
    const selected = preferred;
    const months = Array.from(new Set([window.olonAnalyticsCore.today().slice(0,7),...rows.map(row => row.date.slice(0,7))])).sort().reverse();
    month.replaceChildren(option("","Todo el historial"),...months.map(value => {
      const label = periodFormat.format(parseDate(value + "-01"));
      return option(value,label.charAt(0).toUpperCase() + label.slice(1));
    }));
    if(months.includes(selected)) month.value = selected;
  }

  function hasKind(row){
    if(kind.value === "trading") return isTradingRecord(row);
    if(kind.value === "deposit") return row.deposit > 0;
    if(kind.value === "withdrawal") return row.withdrawal > 0;
    return !kind.value||row.kind===kind.value;
  }

  function makeRow(row){
    const trades = isTradingRecord(row);
    const net = netAmount(row.gain,row.loss);
    const flow=window.olonMt5Ledger.cashFlow(row);
    const type = trades ? row.entry_scope === "trade" ? "Operación" : "Resumen diario" : flow.label;
    const style = trades ? net > 0 ? "good" : net < 0 ? "bad" : "" : "";
    const date = parseDate(row.date);
    const parts = [];
    if(!trades&&row.trade_time)parts.push(escapeHTML(row.trade_time)+" "+escapeHTML(row.time_label||"PR"));
    if(trades && row.entry_scope !== "trade" && individualDates.has(row.date)) parts.push("Resumen excluido del saldo: hay operaciones para esta fecha");
    if(trades && row.entry_scope === "trade"){
      if(row.trade_instrument) parts.push(escapeHTML(row.trade_instrument));
      if(row.trade_strategy) parts.push(escapeHTML(row.trade_strategy));
      if(row.trade_side) parts.push(row.trade_side === "buy" ? "Compra" : "Venta");
      if(row.trade_time) parts.push(escapeHTML(row.trade_time.slice(0,5))+" "+escapeHTML(row.time_label||"PR"));
      if(row.trade_risk) parts.push("Riesgo "+money(row.trade_risk), (net/row.trade_risk).toFixed(2)+" R");
    }
    if(trades) parts.push("Ganancia " + money(row.gain),"Pérdida " + money(row.loss));
    if(row.deposit && (trades || row.withdrawal)) parts.push("Depósito " + money(row.deposit));
    if(row.withdrawal && trades) parts.push("Retiro " + money(row.withdrawal));
    const note = escapeHTML(row.note) || "Sin nota";
    const amount = trades ? signedTradeMoney(net) : signedTradeMoney(flow.amount);
    return '<li class="historyRow"><div class="historyWhen"><time datetime="' + escapeHTML(row.date) + '">' +
      escapeHTML(Number.isFinite(+date) ? dayFormat.format(date) : row.date) + '</time><span>' + type + '</span></div>' +
      '<div class="historyDetail"><p>' + note + '</p>' + (parts.length ? '<small>' + parts.join(" · ") + '</small>' : "") + '</div>' +
      '<strong class="historyAmount ' + style + '">' + amount + '</strong>' + recordHistoryActions(row) + '</li>';
  }

  function update(){
    const selected = rows.filter(row => (!month.value || row.date.startsWith(month.value)) && hasKind(row));
    const summary = totals(selected);
    const net = byId("historyNet");
    net.textContent = signedTradeMoney(summary.net);
    net.className = summary.net > 0 ? "good" : summary.net < 0 ? "bad" : "";
    byId("historyDeposits").textContent = money(summary.deposit);
    byId("historyWithdrawals").textContent = money(summary.withdrawal);
    for(const [id,value] of [["historyTransferIn",summary.transferIn],["historyTransferOut",summary.transferOut],["historyAdjustments",summary.adjustment]]){
      const cell=byId(id);if(cell)cell.textContent=money(value);
    }
    byId("historyTotal").textContent = String(selected.length);
    byId("historyRange").textContent = selected.length === 1 ? "1 registro" : selected.length + " registros";
    empty.hidden = Boolean(selected.length);
    empty.textContent = rows.length ? "No hay registros con estos filtros." : "Tus resultados, depósitos y retiros aparecerán aquí.";
    list.innerHTML = selected.slice(0,shown).map(makeRow).join("");
    more.hidden = shown >= selected.length;
    if(!more.hidden) more.textContent = "Ver más registros (" + (selected.length - shown) + ")";
  }

  function render(records){
    const id = currentUser?.id;
    const preferred=owner!==id?window.olonAnalyticsCore.today().slice(0,7):month.value;
    if(owner !== id){
      owner = id;
      month.value = kind.value = "";
      shown = pageSize;
    }
    rows = records.slice().reverse();
    individualDates = new Set(records.filter(window.olonAnalyticsCore.trade).map(row=>row.date));
    setMonths(preferred);
    update();
  }

  for(const filter of [month,kind]){
    filter.addEventListener("change", () => { shown = pageSize; update(); });
  }
  more.addEventListener("click", () => { shown += pageSize; update(); });

  window.olonHistory = {render};
})();
