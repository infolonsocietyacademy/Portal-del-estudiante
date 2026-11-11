/* OLFX · Conexión segura MT4/MT5 desde el portal; credenciales solo en tránsito. */
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const PAGE = "metaapiAccountsPage";
  const ENDPOINT = "olon-metaapi-connect";
  let busy = false;
  let lastAccount = null;
  let lastRefresh = 0;

  const isPageOpen = () => {
    const page = $(PAGE);
    return !!page && !page.classList.contains("hidden") && getComputedStyle(page).display !== "none";
  };
  const clean = value => String(value ?? "").trim();
  const statusCode = value => clean(value).toUpperCase();

  function feedback(message, type = "info") {
    const box = $("metaapiFeedback");
    if (!box) return;
    box.hidden = false;
    box.textContent = message;
    box.dataset.tone = type;
  }

  function lock(flag) {
    busy = flag;
    for (const id of ["metaapiConnect", "metaapiRefresh", "metaapiDisconnect", "metaapiCancelPending"]) {
      const button = $(id);
      if (button) button.disabled = flag;
    }
    const btn = $("metaapiConnect");
    if (btn) btn.textContent = flag ? "Procesando conexión…" : "Conectar cuenta desde el portal";
  }

  async function callServer(payload) {
    const client = typeof supabaseClient !== "undefined" ? supabaseClient : null;
    if (!client) throw new Error("El portal no pudo iniciar la conexión. Recarga e inténtalo de nuevo.");
    const { data: session, error: sessionError } = await client.auth.getSession();
    if (sessionError || !session?.session?.access_token) throw new Error("Vuelve a iniciar sesión en el portal.");
    const { data, error } = await client.functions.invoke(ENDPOINT, { body: payload });

    if (error) {
      let message = data?.error;
      if (!message && error.context && typeof error.context.clone === "function") {
        try { message = (await error.context.clone().json())?.error; } catch { /* Response may not be JSON. */ }
      }
      throw new Error(message || "No pudimos comunicarnos con MetaApi. Inténtalo otra vez.");
    }
    if (data?.error) throw new Error(data.error);
    return data ?? {};
  }

  function render(data = {}) {
    const connectedArea = $("metaapiConnected");
    const form = $("metaapiConnectForm");
    const badge = $("metaapiConnectionBadge");
    if (!connectedArea || !form || !badge) return;
    const account = data.account || null;
    lastAccount = account;

    const draft = !!account && (statusCode(account.state) === "DRAFT" || statusCode(account.state) === "PENDING" || account.needsCredentials === true);
    form.hidden = !!account && !draft;
    connectedArea.hidden = !account || draft;
    if (draft && account) {
      $("metaapiPlatform").value = account.platform || "mt5";
      document.querySelectorAll("[data-metaapi-platform]").forEach(button => {
        const selected = button.dataset.metaapiPlatform === account.platform;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
      const choices = $("metaapiServerChoices");
      if (choices && account.brokerServer) {
        choices.replaceChildren(new Option(account.brokerServer + " · vinculación pendiente", account.brokerServer));
        choices.disabled = false;
        choices.value = account.brokerServer;
        $("metaapiServerManualWrap").hidden = true;
      }
      const serverHint = $("metaapiServerHint");
      if (serverHint) serverHint.textContent = "Cuenta en borrador detectada. Completa número de cuenta y contraseña de inversor para finalizarla sin crear otra conexión.";
    }
    if (!account) {
      badge.textContent = "Sin vincular";
      badge.dataset.status = "off";
      return;
    }

    const isConnected = statusCode(account.connectionStatus) === "CONNECTED";
    const status = statusCode(account.connectionStatus);
    badge.dataset.status = isConnected ? "on" : "wait";
    badge.textContent = isConnected ? "Cuenta conectada" : "Conexión pendiente";

    $("metaapiAccountPlatform").textContent = statusCode(account.platform) || "—";
    $("metaapiAccountBroker").textContent = clean(account.brokerServer) || "—";
    $("metaapiAccountLogin").textContent = clean(account.loginMasked) || "Pendiente de verificar";
    $("metaapiAccountState").textContent = isConnected ? "En línea" : status === "DISCONNECTED" ? "Sin conexión al bróker" : "En preparación";
    $("metaapiConnectedTitle").textContent = isConnected ? "¡Tu cuenta está conectada!" : "Estamos procesando tu cuenta";
    $("metaapiConnectedSubtitle").textContent = isConnected
      ? "La conexión con MetaApi está activa. Las estadísticas se habilitarán en una próxima actualización."
      : "Puedes actualizar el estado o reiniciar la vinculación si hubo un error.";
    $("metaapiConnectedIcon").textContent = isConnected ? "✓" : "2";
    $("metaapiConnectedNext").hidden = isConnected;
    $("metaapiManageDetails").hidden = false;
    $("metaapiDisconnect").textContent = isConnected ? "Desconectar cuenta" : "Reiniciar conexión";

  }

  async function withBusy(work) {
    if (busy) return;
    lock(true);
    try {
      await work();
    } catch (error) {
      feedback(error instanceof Error ? error.message : "Error de conexión.", "error");
    } finally {
      lock(false);
    }
  }

  async function checkStatus(force = false) {
    if (!isPageOpen() || busy) return;
    const now = Date.now();
    if (!force && now - lastRefresh < 5000) return;
    lastRefresh = now;
    await withBusy(async () => {
      const data = await callServer({ action: "status" });
      render(data);
      if (!data.configured) {
        feedback("El administrador debe terminar de activar el servicio. No necesitas ningún API Token.", "error");
      } else if (data.warning) {
        feedback("No pudimos confirmar el estado con MetaApi. Puedes volver a verificar.", "error");
      } else if (data.account && statusCode(data.account.connectionStatus) === "CONNECTED") {
        feedback("¡Conexión confirmada! Ya puedes cerrar esta sección.", "success");
      } else if (data.account && (statusCode(data.account.state) === "DRAFT" || statusCode(data.account.state) === "PENDING" || data.account.needsCredentials === true)) {
        feedback("La cuenta está incompleta: introduce tu número de cuenta y contraseña de inversor abajo y pulsa Conectar. No necesitas eliminarla.", "info");
      } else if (data.account) {
        feedback("La conexión todavía no está activa. Pulsa «Actualizar estado» para comprobar si MetaApi terminó de conectarla.", "info");
      } else {
        const box = $("metaapiFeedback");
        if (box) box.hidden = true;
      }
    });
  }

  async function prepareAccount() {
    const passwordField = $("metaapiInvestorPassword");
    if (!passwordField) return;
    const login = clean($("metaapiLogin")?.value);
    const investorPassword = passwordField.value;
    // Clear the form before the request; never persist credentials in localStorage or analytics.
    passwordField.value = "";
    await withBusy(async () => {
      const platform = clean($("metaapiPlatform").value);
      const brokerServer = currentServer();
      if (!/^[a-z0-9_ .+/-]{2,120}$/i.test(brokerServer) || brokerServer === "__manual__") {
        throw new Error("Selecciona el servidor exacto de tu cuenta. AXI es el bróker, no el servidor.");
      }
      if (["AXI","AXICORP"].includes($("metaapiBroker")?.value) && (/^axiory/i.test(brokerServer) || /^axiance/i.test(brokerServer))) {
        throw new Error("Ese servidor pertenece a otro bróker, no a AXI.");
      }
      if (!/^[0-9]{4,20}$/.test(login)) throw new Error("Escribe un número de cuenta MT4/MT5 válido.");
      if (!investorPassword || investorPassword.length > 256) throw new Error("Introduce tu contraseña de inversor.");
      if (!$("metaapiInvestorConfirm")?.checked) throw new Error("Confirma que estás usando la contraseña de inversor de solo lectura.");
      const result = await callServer({
        action: "connect-direct", platform, brokerServer, broker: $("metaapiBroker")?.value,
        login, investorPassword,
      });
      if (result.account) render(result);
      feedback(result.message || "Cuenta registrada en MetaApi. Comprueba el estado para confirmar que está conectada.", "success");
    });
  }

  async function unlink() {
    if (!confirm("¿Quitar la vinculación de MetaApi y volver a elegir bróker y servidor? No borra tu cuenta en el bróker.")) return;
    await withBusy(async () => {
      await callServer({ action: "disconnect" });
      render({ account: null });
      feedback("Se desvinculó tu cuenta del portal. Tu cuenta del bróker permanece intacta.", "success");
      $("metaapiManageDetails").open = false;
    });
  }

  const serverChoices = () => $("metaapiServerChoices");
  const serverMessage = (message) => { const node = $("metaapiServerHint"); if (node) node.textContent = message; };
  const manualMode = () => serverChoices()?.value === "__manual__";
  function clearServerChoice() {
    const options = serverChoices();
    if (!options) return;
    options.replaceChildren(new Option("Pulsa Buscar servidores", ""));
    options.disabled = true;
    const manual = $("metaapiServerManualWrap");
    if (manual) manual.hidden = true;
    const field = $("metaapiServer");
    if (field) field.value = "";
  }
  function currentServer() {
    return manualMode() ? clean($("metaapiServer")?.value) : clean(serverChoices()?.value);
  }
  async function loadBrokerServers() {
    if (busy) return;
    const broker = $("metaapiBroker")?.value;
    const query = clean($("metaapiOtherBroker")?.value);
    if (broker === "OTHER" && query.length < 2) {
      feedback("Escribe al menos dos letras del nombre del bróker.", "error"); return;
    }
    clearServerChoice();
    const button = $("metaapiFindServers");
    if (button) button.disabled = true;
    serverMessage("Buscando los servidores conocidos de " + (broker === "AXICORP" ? "AxiCorp Financial Services Pty Ltd" : broker === "AXI" ? "AXI" : query) + "…");
    try {
      const result = await callServer({
        action: "search-servers",
        platform: clean($("metaapiPlatform").value),
        broker, query,
      });
      const options = serverChoices();
      options.replaceChildren(new Option("Selecciona el servidor exacto", ""));
      const servers = Array.isArray(result.servers) ? result.servers : [];
      for (const item of servers) {
        if (!item || typeof item.server !== "string") continue;
        const option = new Option(item.server + (item.company ? " · " + item.company : ""), item.server);
        options.add(option);
      }
      options.add(new Option("Mi servidor no aparece — escribirlo manualmente", "__manual__"));
      options.disabled = false;
      if (servers.length) {
        serverMessage(servers.length + " servidores encontrados. Selecciona el mismo que aparece en tu cuenta MetaTrader.");
      } else {
        serverMessage("MetaApi no devolvió servidores de ese bróker. Puedes escribir manualmente el servidor exacto que aparece en MT4/MT5. Si MetaApi no lo reconoce, el bróker puede requerir un perfil de aprovisionamiento.");
      }
    } catch (error) {
      const options = serverChoices();
      options.replaceChildren(new Option("Mi servidor no aparece — escribirlo manualmente", "__manual__"));
      options.disabled = false;
      options.value = "__manual__";
      $("metaapiServerManualWrap").hidden = false;
      serverMessage("No se pudo consultar el directorio de MetaApi. Comprueba el servidor exacto en tu bróker antes de continuar.");
      feedback(error instanceof Error ? error.message : "No se pudo consultar los servidores.", "error");
    } finally {
      if (button) button.disabled = false;
    }
  }
  function selectPlatform(value) {
    $("metaapiPlatform").value = value;
    clearServerChoice();
    serverMessage("Pulsa Buscar servidores para ver los de " + value.toUpperCase() + ".");
    document.querySelectorAll("[data-metaapi-platform]").forEach(button => {
      const active = button.dataset.metaapiPlatform === value;
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("selected", active);
    });
  }

  function init() {
    const form = $("metaapiConnectForm");
    const page = $(PAGE);
    if (!form || !page || form.dataset.ready === "1") return;
    form.dataset.ready = "1";
    document.querySelectorAll("[data-metaapi-platform]").forEach(button => {
      button.addEventListener("click", () => selectPlatform(button.dataset.metaapiPlatform));
    });
    $("metaapiBroker")?.addEventListener("change", () => {
      $("metaapiOtherBrokerWrap").hidden = $("metaapiBroker").value !== "OTHER";
      clearServerChoice();
      serverMessage("Pulsa Buscar servidores para ver las opciones del bróker.");
    });
    $("metaapiFindServers")?.addEventListener("click", () => void loadBrokerServers());
    serverChoices()?.addEventListener("change", () => {
      $("metaapiServerManualWrap").hidden = !manualMode();
    });
    form.addEventListener("submit", event => { event.preventDefault(); void prepareAccount(); });
    $("metaapiCancelPending")?.addEventListener("click", () => void unlink());
    $("metaapiRefresh")?.addEventListener("click", () => void checkStatus(true));
    $("metaapiDisconnect")?.addEventListener("click", () => void unlink());
    $("metaapiTogglePassword")?.addEventListener("click", () => {
      const field = $("metaapiInvestorPassword");
      if (!field) return;
      const visible = field.type === "password";
      field.type = visible ? "text" : "password";
      $("metaapiTogglePassword").textContent = visible ? "Ocultar" : "Mostrar";
      $("metaapiTogglePassword").setAttribute("aria-pressed", String(visible));
    });
    window.addEventListener("pagehide", () => { if ($("metaapiInvestorPassword")) $("metaapiInvestorPassword").value = ""; });
    const observer = new MutationObserver(() => {
      if (isPageOpen()) void checkStatus();
    });
    observer.observe(page, { attributes: true, attributeFilter: ["class", "style"] });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && isPageOpen()) void checkStatus(true);
    });
    window.addEventListener("focus", () => {
      if (isPageOpen()) void checkStatus();
    });
    selectPlatform("mt5");
    if ($("metaapiBroker")) $("metaapiBroker").value = "AXICORP";
    if (isPageOpen()) void checkStatus();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
