/* OLFX · Asistente de conexión MT4/MT5. Sin contraseñas ni tokens en el navegador. */
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
    for (const id of ["metaapiConnect", "metaapiChange", "metaapiRefresh", "metaapiDisconnect"]) {
      const button = $(id);
      if (button) button.disabled = flag;
    }
    const btn = $("metaapiConnect");
    if (btn) btn.textContent = flag ? "Preparando conexión…" : "Continuar de forma segura";
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

  function showLink(url) {
    const anchor = $("metaapiOpenLink");
    if (!anchor) throw new Error("No encontramos el botón del formulario seguro.");
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error("MetaApi devolvió un enlace inválido."); }
    if (parsed.protocol !== "https:" || parsed.hostname !== "app.metaapi.cloud") {
      throw new Error("MetaApi devolvió un enlace inesperado. No abras ese enlace.");
    }
    anchor.href = parsed.href;
    anchor.hidden = false;
    feedback("Enlace listo. Pulsa «Abrir formulario seguro», introduce tu número de cuenta y contraseña de inversor y regresa aquí para comprobar la conexión.", "success");
    anchor.focus();
  }

  function render(data = {}) {
    const connectedArea = $("metaapiConnected");
    const form = $("metaapiConnectForm");
    const badge = $("metaapiConnectionBadge");
    if (!connectedArea || !form || !badge) return;
    const account = data.account || null;
    lastAccount = account;

    form.hidden = !!account;
    connectedArea.hidden = !account;
    const link = $("metaapiOpenLink");
    if (!account && link) { link.hidden = true; link.removeAttribute("href"); }
    if (!account) {
      badge.textContent = "Sin vincular";
      badge.dataset.status = "off";
      return;
    }

    const isConnected = statusCode(account.connectionStatus) === "CONNECTED";
    const isWaiting = !isConnected;
    const status = statusCode(account.connectionStatus);
    badge.dataset.status = isConnected ? "on" : "wait";
    badge.textContent = isConnected ? "Cuenta conectada" : "Conexión pendiente";

    $("metaapiAccountPlatform").textContent = statusCode(account.platform) || "—";
    $("metaapiAccountBroker").textContent = clean(account.brokerServer) || "—";
    $("metaapiAccountLogin").textContent = clean(account.loginMasked) || "Pendiente de configurar";
    $("metaapiAccountState").textContent = isConnected ? "En línea" : status === "DISCONNECTED" ? "Desconectada del bróker" : "En preparación";
    $("metaapiConnectedTitle").textContent = isConnected ? "¡Tu cuenta está conectada!" : "Ya casi terminamos";
    $("metaapiConnectedSubtitle").textContent = isConnected
      ? "La vinculación con MetaApi está activa. Pronto podrás consultar estadísticas desde el portal."
      : "Completa el formulario seguro y verifica la conexión cuando regreses.";
    $("metaapiConnectedIcon").textContent = isConnected ? "✓" : "2";
    $("metaapiChange").textContent = account.state === "PENDING"
      ? "Continuar la conexión"
      : "Generar enlace seguro";
    $("metaapiConnectedNext").hidden = !isWaiting;
    $("metaapiManageDetails").hidden = !isConnected;
    if (isConnected && link) { link.hidden = true; link.removeAttribute("href"); }
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
      } else if (data.account) {
        feedback("La cuenta aún no aparece conectada. Completa el formulario seguro y pulsa «Ya terminé, comprobar».", "info");
      } else {
        const box = $("metaapiFeedback");
        if (box) box.hidden = true;
      }
    });
  }

  async function prepareAccount() {
    await withBusy(async () => {
      const platform = clean($("metaapiPlatform").value);
      const brokerServer = clean($("metaapiServer").value);
      if (!/^[a-z0-9_ .+/-]{2,120}$/i.test(brokerServer)) {
        throw new Error("Escribe el nombre exacto del servidor de tu bróker, sin añadir un enlace web.");
      }
      const result = await callServer({ action: "connect", platform, brokerServer });
      if (result.account) render(result);
      if (result.configurationUrl) showLink(result.configurationUrl);
      else feedback(result.message || "Estamos preparando la conexión. Pulsa «Continuar la conexión» después.", "info");
    });
  }

  async function continueAccount() {
    if (!lastAccount) return;
    await withBusy(async () => {
      const a = lastAccount;
      const payload = a.state === "PENDING"
        ? { action: "connect", platform: a.platform, brokerServer: a.brokerServer }
        : { action: "configuration-link" };
      const data = await callServer(payload);
      if (data.account) render(data);
      if (data.configurationUrl) showLink(data.configurationUrl);
      else feedback(data.message || "La conexión sigue preparándose. Intenta nuevamente un poco más tarde.", "info");
    });
  }

  async function unlink() {
    if (!confirm("¿Desconectar esta cuenta del portal? No borra tu cuenta en el bróker.")) return;
    await withBusy(async () => {
      await callServer({ action: "disconnect" });
      render({ account: null });
      feedback("Se desvinculó tu cuenta del portal. Tu cuenta del bróker permanece intacta.", "success");
      $("metaapiManageDetails").open = false;
    });
  }

  function selectPlatform(value) {
    $("metaapiPlatform").value = value;
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
    form.addEventListener("submit", event => { event.preventDefault(); void prepareAccount(); });
    $("metaapiChange")?.addEventListener("click", () => void continueAccount());
    $("metaapiRefresh")?.addEventListener("click", () => void checkStatus(true));
    $("metaapiDisconnect")?.addEventListener("click", () => void unlink());
    $("metaapiOpenLink")?.addEventListener("click", () => {
      feedback("Completa el formulario en la pestaña segura de MetaApi. Al regresar, verificaremos la conexión.", "info");
    });
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
    if (isPageOpen()) void checkStatus();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
