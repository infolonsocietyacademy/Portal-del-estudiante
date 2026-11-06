(() => {
  "use strict";

  const element = id => document.getElementById(id);
  const link = element("mt5Link");
  const dashboard = document.getElementById("dashboard");
  const grid = element("tradingCalendar");
  const endpoint = SUPABASE_URL + "/functions/v1/mt5-sync";
  const formatDate = date => [
    date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")
  ].join("-");
  const thisMonth = () => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  };

  let owner = null, mode = "manual", choseSource = false, month = thisMonth();
  let manual = [], days = [], account = null, pairing = null, busy = false, loadingMonth = false;
  let monthRequest = 0, lastMonthLoad = 0, loadError = "", dayRequest = 0;

  element("mt5AllowedOrigin").textContent = SUPABASE_URL;
  const say = message => { element("mt5Status").textContent = message; };
  const activeOwner = () => currentUser?.id === owner && !isAdminUser(currentUser);
  const moneyFor = currency => new Intl.NumberFormat("es-PR", /^[A-Z]{3}$/.test(currency)
    ? { style: "currency", currency, currencyDisplay: currency === "USD" ? "symbol" : "code" }
    : { maximumFractionDigits: 8 });
  const mt5Amount = (amount, withSign = false) => {
    const number = Number(amount);
    const currency = account?.currency ?? "USD";
    const formatted = moneyFor(currency).format(number);
    return (withSign && number > 0 ? "+" : "") + formatted + (/^[A-Z]{3}$/.test(currency) ? "" : " " + currency);
  };

  async function api(action, fields = {}) {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error || !data?.session || data.session.user.id !== owner) throw new Error("session");
    const result = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + data.session.access_token },
      body: JSON.stringify({ action, ...fields })
    });
    const body = await result.json();
    if (!result.ok) throw new Error(body.error || "unavailable");
    return body;
  }

  function showPair() {
    if (pairing && pairing.until <= Date.now()) pairing = null;
    element("mt5Pair").hidden = !pairing;
    element("mt5Code").value = pairing?.code ?? "";
    element("mt5Expires").textContent = pairing
      ? "Vence a las " + new Intl.DateTimeFormat("es-PR", { hour: "numeric", minute: "2-digit" }).format(pairing.until)
      : "";
  }

  function status() {
    const badge = element("mt5Badge");
    badge.textContent = account?.connected ? "Vinculado" : "Sin vincular";
    element("mt5Disconnect").hidden = !account?.connected && !pairing;
    if (loadError) return say(loadError);
    if (!account) return say(pairing ? "Esperando que pegues el código en MT5." : "Vincula tu cuenta para ver tus operaciones en este calendario.");
    const identity = account.server + " · •••• " + account.login + " · " + account.currency;
    if (!account.connected) return say(identity + ". Desconectada. Puedes consultar el historial sincronizado.");
    if (!account.synced_at || Date.parse(account.synced_at) < Date.parse(account.linked_at)) {
      return say(identity + ". Esperando la primera sincronización.");
    }
    const last = new Intl.DateTimeFormat("es-PR", { dateStyle: "short", timeStyle: "short" }).format(new Date(account.synced_at));
    say(identity + ". Última sincronización " + last + ".");
  }

  function draw() {
    const isMt5 = mode === "mt5" && account;
    element("mt5ManualView").setAttribute("aria-pressed", String(!isMt5));
    element("mt5TradesView").setAttribute("aria-pressed", String(Boolean(isMt5)));
    element("mt5TradesView").disabled = !account;
    element("mt5MonthNav").hidden = !isMt5;
    element("mt5MonthNext").disabled = +month >= +thisMonth();
    element("mt5MonthPrev").disabled = month.getFullYear() <= 2000 && month.getMonth() === 0;
    element("mt5CalendarHint").textContent = isMt5
      ? loadingMonth ? "Cargando resultados de MT5…"
        : loadError ? loadError
        : days.length ? "Hora del bróker · Resultado neto con comisiones, swaps y cargos por operación."
        : "Todavía no hay movimientos sincronizados para este mes."
      : "Selecciona un día con registros para ver sus ganancias y pérdidas.";

    dayRequest++;
    if (!isMt5) return renderTradingCalendar(manual);
    renderTradingCalendar(days, {
      monthDate: month,
      formatMoney: mt5Amount,
      selectDay: openDay
    });
    if (loadingMonth || loadError) {
      const total = element("calendarMonthNet");
      total.textContent = "—";
      total.className = "neutral";
    }
  }

  async function loadMonth({ quiet = false } = {}) {
    const current = owner, request = ++monthRequest;
    if (!quiet) { loadingMonth = true; draw(); }
    lastMonthLoad = Date.now();
    try {
      const next = await api("month", { date: formatDate(month) });
      if (request !== monthRequest || current !== owner || !activeOwner()) return;
      const changed = next.account?.id !== account?.id
        || next.account?.connected !== account?.connected
        || next.account?.linked_at !== account?.linked_at;
      if (pairing && next.account?.connected && changed) pairing = null;
      account = next.account;
      if (account && !choseSource && (!quiet || changed)) mode = "mt5";
      const rowsChanged = JSON.stringify(days) !== JSON.stringify(next.days);
      const shouldDraw = !quiet || changed || rowsChanged || loadError;
      loadError = "";
      days = next.days;
      loadingMonth = false;
      if (shouldDraw) draw();
    } catch (error) {
      if (request !== monthRequest || current !== owner || !activeOwner()) return;
      loadError = error.message === "access" || error.message === "session"
        ? "Tu sesión o acceso al portal debe estar activo para usar MT5."
        : "No se pudo actualizar MT5. Intenta de nuevo.";
      loadingMonth = false;
      if (!quiet) draw();
    } finally {
      if (request === monthRequest && current === owner && activeOwner()) { showPair(); status(); }
    }
  }

  const labels = { buy: "Compra", sell: "Venta", commission: "Comisión", cancelled: "Cancelada" };
  const entries = { in: "Entrada", out: "Cierre", inout: "Reversión", out_by: "Cierre por posición opuesta" };

  function openDay(day, result, detail) {
    const current = owner, request = ++dayRequest, connection = account.id;
    const date = formatDate(new Date(month.getFullYear(), month.getMonth(), day));
    let offset = 0;
    const title = document.createElement("strong");
    title.textContent = "Día " + day + " · Neto " + mt5Amount(result.net, true) + " · " + result.count + " movimientos";
    const list = document.createElement("ul");
    list.className = "mt5DetailList";
    const feedback = document.createElement("p");
    const more = document.createElement("button");
    more.className = "btn secondary";
    more.type = "button";
    more.textContent = "Cargar más";
    detail.hidden = false;
    detail.replaceChildren(title, list, feedback, more);

    async function loadDeals() {
      more.hidden = true;
      feedback.textContent = "Cargando movimientos…";
      try {
        const data = await api("day", { account: connection, date, offset });
        if (request !== dayRequest || current !== owner || !activeOwner()) return;
        for (const deal of data.deals) {
          const row = document.createElement("li");
          const net = Number(deal.profit) + Number(deal.commission) + Number(deal.swap) + Number(deal.fee);
          row.textContent = [deal.broker_time.slice(11, 19), deal.symbol, labels[deal.kind],
            entries[deal.entry], mt5Amount(net, true)].filter(Boolean).join(" · ");
          const costs = document.createElement("small");
          costs.textContent = "Bruto " + mt5Amount(deal.profit) + " · Comisión " + mt5Amount(deal.commission)
            + " · Swap " + mt5Amount(deal.swap) + " · Cargo " + mt5Amount(deal.fee);
          row.append(costs);
          list.append(row);
        }
        offset += data.deals.length;
        feedback.textContent = "";
        more.textContent = "Cargar más";
        more.hidden = !data.more;
      } catch {
        if (request !== dayRequest || current !== owner || !activeOwner()) return;
        feedback.textContent = "No se pudieron cargar los movimientos.";
        more.textContent = "Reintentar";
        more.hidden = false;
      }
    }
    more.addEventListener("click", loadDeals);
    loadDeals();
  }

  async function changeConnection(action) {
    if (!activeOwner() || busy) return;
    if (action === "disconnect" && !window.confirm("¿Detener la sincronización de MT5? El historial ya importado seguirá disponible.")) return;
    const current = owner;
    busy = true;
    element("mt5Generate").disabled = element("mt5Disconnect").disabled = true;
    try {
      const data = await api(action);
      if (current !== owner || !activeOwner()) return;
      loadError = "";
      pairing = action === "code" ? { code: data.code, until: Date.parse(data.expires_at) } : null;
      showPair();
      if (action === "disconnect") await loadMonth();
      else status();
    } catch {
      if (current === owner && activeOwner()) say("No se pudo completar la operación. Intenta de nuevo.");
    } finally {
      busy = false;
      element("mt5Generate").disabled = element("mt5Disconnect").disabled = false;
    }
  }

  element("mt5Generate").addEventListener("click", () => changeConnection("code"));
  element("mt5Disconnect").addEventListener("click", () => changeConnection("disconnect"));
  element("mt5Refresh").addEventListener("click", () => loadMonth());
  element("mt5Copy").addEventListener("click", async () => {
    if (!pairing || pairing.until <= Date.now()) return showPair();
    const input = element("mt5Code");
    try { await navigator.clipboard.writeText(input.value); say("Código copiado. Pégalo en el conector de MT5."); }
    catch { input.focus(); input.select(); }
  });
  element("mt5ManualView").addEventListener("click", () => { choseSource = true; mode = "manual"; draw(); });
  element("mt5TradesView").addEventListener("click", () => { choseSource = true; mode = "mt5"; draw(); });
  element("mt5MonthPrev").addEventListener("click", () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); days = []; loadMonth(); });
  element("mt5MonthNext").addEventListener("click", () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); days = []; loadMonth(); });

  function poll() {
    if (document.hidden || dashboard.classList.contains("hidden") || !activeOwner()) return;
    if (pairing?.until <= Date.now()) { showPair(); status(); }
    if (!busy && !loadingMonth && Date.now() - lastMonthLoad >= 40_000) loadMonth({ quiet: true });
  }
  setInterval(poll, 5_000);
  document.addEventListener("visibilitychange", poll);

  window.olonMt5 = {
    render(records) {
      if (!currentUser || isAdminUser(currentUser)) return renderTradingCalendar(records);
      link.hidden = false;
      element("mt5CalendarTools").hidden = false;
      manual = records;
      if (owner === currentUser.id) {
        if (mode === "manual" || !grid.children.length) draw();
        return;
      }
      owner = currentUser.id;
      mode = "manual"; choseSource = false; month = thisMonth();
      account = null; days = []; pairing = null; loadError = "";
      link.open = false;
      showPair();
      status();
      loadMonth();
    }
  };
})();
