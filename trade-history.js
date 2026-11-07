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

  function parseDate(date){
    return new Date(date + "T00:00:00Z");
  }

  function option(value,label){
    return new Option(label,value);
  }

  function setMonths(){
    const selected = month.value;
    const months = Array.from(new Set(rows.map(row => row.date.slice(0,7))));
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
    return true;
  }

  function makeRow(row){
    const trades = isTradingRecord(row);
    const net = netAmount(row.gain,row.loss);
    const type = trades ? "Resultado" : row.withdrawal ? "Retiro" : "Depósito";
    const style = trades ? net > 0 ? "good" : net < 0 ? "bad" : "" : "";
    const date = parseDate(row.date);
    const parts = [];
    if(trades) parts.push("Ganancia " + money(row.gain),"Pérdida " + money(row.loss));
    if(row.deposit && (trades || row.withdrawal)) parts.push("Depósito " + money(row.deposit));
    if(row.withdrawal && trades) parts.push("Retiro " + money(row.withdrawal));
    const note = escapeHTML(row.note) || "Sin nota";
    const amount = trades ? signedTradeMoney(net) : row.withdrawal ? "−" + money(row.withdrawal) : "+" + money(row.deposit);
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
    if(owner !== id){
      owner = id;
      month.value = kind.value = "";
      shown = pageSize;
    }
    rows = records.slice().reverse();
    setMonths();
    update();
  }

  for(const filter of [month,kind]){
    filter.addEventListener("change", () => { shown = pageSize; update(); });
  }
  more.addEventListener("click", () => { shown += pageSize; update(); });

  window.olonHistory = {render};
})();
