/* OLFX MetaApi student link: never store credentials in the browser. */
(() => {
  "use strict";
  const byId = id => document.getElementById(id);
  const ENDPOINT = "olon-metaapi-connect";
  let busy = false;
  let lastAccount = null;
  const account = () => (typeof supabaseClient !== "undefined" ? supabaseClient : null);
  const fmt = v => String(v || "").toUpperCase();
  const say = (message, bad = false) => {
    const output = byId("metaapiFeedback");
    if (!output) return;
    output.hidden = false;
    output.textContent = message;
    output.style.color = bad ? "#fca5a5" : "";
  };
  function setBusy(value) {
    busy = value;
    ["metaapiConnect","metaapiRefresh","metaapiDisconnect","metaapiChange"].forEach(id => {
      const button = byId(id);
      if (button) button.disabled = value;
    });
  }
  async function invoke(payload) {
    const client = account();
    if (!client) throw new Error("Supabase aún no está disponible.");
    const { data: sessionInfo, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionInfo?.session?.access_token) throw new Error("Inicia sesión en el portal para continuar.");
    const { data, error } = await client.functions.invoke(ENDPOINT, { body: payload });
    if (error) {
      if (data?.error) throw new Error(data.error);
      // With non-2xx statuses, Supabase's FunctionsHttpError response can contain a JSON message.
      if (error.context?.json) {
        try { const detail = await error.context.json(); if (detail?.error) throw new Error(detail.error); } catch (reason) {
          if (reason instanceof Error && reason.message !== "Unexpected end of JSON input") throw reason;
        }
      }
      throw new Error("No se pudo contactar el servicio de cuentas. Revisa la conexión o avisa al administrador.");
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }
  function render(result) {
    const container = byId("metaapiConnected");
    const form = byId("metaapiConnectForm");
    const state = byId("metaapiConnectionBadge");
    const data = result?.account || null;
    lastAccount = data;
    if (!container || !form || !state) return;
    container.hidden = !data;
    form.hidden = !!data;
    const configLink = byId("metaapiOpenLink");
    if (configLink) { configLink.hidden = true; configLink.removeAttribute("href"); }
    if (!data) {
      state.textContent = "SIN CONECTAR";
      return;
    }
    const status = fmt(data.connectionStatus);
    const connected = status === "CONNECTED";
    state.textContent = connected ? "CONECTADA" : status === "DISCONNECTED" ? "DESCONECTADA" : "CONFIGURACIÓN PENDIENTE";
    byId("metaapiAccountPlatform").textContent = fmt(data.platform);
    byId("metaapiAccountBroker").textContent = data.brokerServer || "—";
    byId("metaapiAccountLogin").textContent = data.loginMasked || "Por configurar";
    byId("metaapiAccountState").textContent = (data.state || "Pendiente") + " / " + (data.connectionStatus || "Sin verificar");
    byId("metaapiRefresh").disabled = busy;
    byId("metaapiChange").textContent = data.state === "PENDING" ? "Continuar conexión" : "Abrir configuración segura";
  }
  async function withBusy(work) {
    if (busy) return;
    setBusy(true);
    try { await work(); } catch (err) { say(err instanceof Error ? err.message : "Error desconocido.", true); }
    finally { setBusy(false); }
  }
  async function refresh() {
    await withBusy(async () => {
      const data = await invoke({ action: "status" });
      render(data);
      if (data.warning) say(data.warning, true);
      else if (!data.configured) say("El administrador todavía debe guardar METAAPI_TOKEN en Supabase.", true);
      else if (!data.account) say("Selecciona MT4 o MT5, escribe el servidor exacto de tu bróker y conecta.");
      else say("Estado consultado. Si aparece pendiente, completa el enlace de configuración y vuelve a actualizar.");
    });
  }
  function openConfig(url) {
    const link = new URL(url);
    if (link.protocol !== "https:" || link.hostname !== "app.metaapi.cloud") throw new Error("MetaApi devolvió un enlace de configuración inesperado.");
    // Present a user-clickable link; browsers can block pop-ups started after async requests.
    const a = byId("metaapiOpenLink");
    if (!a) throw new Error("No se pudo mostrar el enlace de configuración.");
    a.href = link.href;
    a.hidden = false;
    say("Tu enlace de configuración está listo. Pulsa Abrir formulario seguro e introduce únicamente la contraseña de inversor. Después actualiza el estado.");
  }
  function init() {
    const form = byId("metaapiConnectForm");
    if (!form || form.dataset.bound) return;
    form.dataset.bound = "true";
    form.addEventListener("submit", ev => {
      ev.preventDefault();
      void withBusy(async () => {
        const platform = byId("metaapiPlatform").value;
        const brokerServer = byId("metaapiServer").value.trim();
        const data = await invoke({ action: "connect", platform, brokerServer });
        render(data);
        if (data.configurationUrl) openConfig(data.configurationUrl);
        else say(data.message || "MetaApi está preparando la cuenta. Presiona Conectar nuevamente en unos momentos.");
      });
    });
    byId("metaapiRefresh")?.addEventListener("click", () => void refresh());
    byId("metaapiChange")?.addEventListener("click", () => {
      void withBusy(async () => {
        const payload = lastAccount?.state === "PENDING"
          ? { action: "connect", platform: lastAccount.platform, brokerServer: lastAccount.brokerServer }
          : { action: "configuration-link" };
        const data = await invoke(payload);
        render(data);
        if (data.configurationUrl) openConfig(data.configurationUrl);
        else say(data.message || "MetaApi aún está preparando la conexión. Presiona Continuar conexión más adelante.");
      });
    });
    byId("metaapiDisconnect")?.addEventListener("click", () => {
      if (!confirm("¿Desconectar esta cuenta de MT4/MT5? Esta acción elimina la vinculación con MetaApi.")) return;
      void withBusy(async () => {
        await invoke({ action: "disconnect" });
        render({ account: null });
        say("Cuenta desvinculada correctamente.");
      });
    });
    const original = window.showPage;
    if (typeof original === "function" && !original.metaapiWrapped) {
      const wrapped = function (id, button) {
        const result = original.apply(this, arguments);
        if (id === "metaapiAccountsPage") void refresh();
        return result;
      };
      wrapped.metaapiWrapped = true;
      window.showPage = wrapped;
    }
    byId("metaapiRefresh")?.addEventListener("metaapi:show", () => void refresh());
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
