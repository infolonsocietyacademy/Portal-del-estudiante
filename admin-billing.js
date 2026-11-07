/* OLON Society Academy — private administrative invoicing. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const block = $("adminBillingBlock");
  if (!block) return;
  const pageSize = 12;
  const labels = {pending:"Pendiente",paid:"Pagada",cancelled:"Anulada"};
  const currency = new Intl.NumberFormat("en-US", {style:"currency",currency:"USD"});
  const money = cents => currency.format(Number(cents || 0) / 100);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const validId = value => /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value || "");
  let owner = null, epoch = 0, request = 0, page = 0, count = 0;
  let rows = [], students = [], editor = null, editorPromise = null;
  let assetsPromise = null, loading = false, saving = false, loaded = false;
  let searchTimer;

  function authorized() {
    return typeof currentUser !== "undefined" && !!currentUser &&
      isAdminUser(currentUser) && currentUser.status === "active";
  }
  function active(captured) { return authorized() && owner === currentUser.id && captured === epoch; }
  function feedback(message = "", error = false) {
    const el = $("billingFeedback");
    el.hidden = !message; el.textContent = message;
    el.classList.toggle("error", error);
  }
  function reason(error) {
    const message = String(error?.message || "No se pudo completar la operación.");
    if (/42501|permission denied|row.level security/i.test(message)) return "Tu sesión no tiene permiso para gestionar facturas. Entra como administrador.";
    if (/Failed to fetch|network/i.test(message)) return "No hay conexión. Comprueba internet y vuelve a intentarlo.";
    if (/PGRST202|PGRST205|42P01/i.test(message)) return "La facturación todavía no está disponible. Actualiza el portal e inténtalo de nuevo.";
    return message;
  }
  function reset() {
    epoch++; request++; owner = null; loaded = false; loading = false; saving = false;
    rows = []; students = []; page = 0; count = 0;
    editor?.dispose(); editor = null; editorPromise = null;
    $("billingEditorHost").replaceChildren();
    $("billingEditorPanel").hidden = true; $("billingHistoryPanel").hidden = false; $("billingBack").hidden = true;
    $("billingSearch").value = ""; $("billingStatus").value = "all";
    $("billingStudent").replaceChildren(new Option("Cliente particular", ""));
    ["billingPaidTotal","billingPendingTotal","billingMonthTotal","billingInvoiceCount"].forEach(id => { $(id).textContent = "—"; });
    feedback(); render(); updateButtons();
  }
  function session() {
    if (!authorized()) { reset(); throw Error("Inicia sesión como administrador."); }
    if (owner !== currentUser.id) { reset(); owner = currentUser.id; }
    return epoch;
  }
  function updateButtons() {
    $("billingRefresh").disabled = loading || saving;
    $("billingNew").disabled = saving;
    $("billingBack").disabled = saving;
    $("billingStudent").disabled = saving;
    $("billingPrev").disabled = loading || page === 0;
    $("billingNext").disabled = loading || (page + 1) * pageSize >= count;
    block.querySelectorAll("[data-invoice-open],[data-invoice-status]").forEach(el => { el.disabled = saving; });
    $("billingSync").textContent = loading ? "Sincronizando…" : loaded ? "Historial sincronizado" : "Acceso administrativo";
  }
  function render() {
    const body = $("billingRows");
    $("billingResults").textContent = loaded ? count + " factura" + (count === 1 ? "" : "s") : "Historial de facturas";
    $("billingPagination").hidden = count <= pageSize;
    $("billingPage").textContent = "Página " + (page + 1) + " de " + Math.max(1, Math.ceil(count / pageSize));
    if (!rows.length) {
      const filtered = $("billingSearch").value.trim() || $("billingStatus").value !== "all";
      body.innerHTML = '<div class="billingEmpty"><span aria-hidden="true">▤</span><strong>' +
        (loading ? "Cargando tus facturas…" : !loaded ? "Tus facturas, en un solo lugar" : filtered ? "Sin coincidencias" : "Tu primera factura empieza aquí") +
        '</strong><p>' + (filtered ? "Prueba otro nombre, número o estado." : "Crea una factura para un estudiante o un cliente y consúltala aquí cuando la necesites.") + '</p></div>';
    } else {
      body.innerHTML = rows.map(row => {
        const status = Object.hasOwn(labels, row.status) ? row.status : "pending";
        const due = row.due_date ? 'Vence ' + row.due_date.split("-").reverse().join("/") : "Sin vencimiento";
        return '<article class="billingInvoiceRow"><div class="billingInvoiceIdentity"><span class="billingDocIcon" aria-hidden="true">▤</span><div><strong>' + esc(row.invoice_number) +
          '</strong><small>' + esc(row.issue_date.split("-").reverse().join("/")) + '</small></div></div><div class="billingInvoiceClient"><strong>' + esc(row.client_name) +
          '</strong><small>' + esc(row.service) + '</small></div><div class="billingInvoiceAmount"><strong>' + money(row.total_cents) +
          '</strong><small>' + esc(due) + '</small></div><div class="billingInvoiceActions"><select class="billingState ' + status + '" aria-label="Estado de ' + esc(row.invoice_number) +
          '" data-invoice-status="' + row.id + '">' + Object.entries(labels).map(([value,label]) => '<option value="' + value + '"' + (value === status ? " selected" : "") + '>' + label + '</option>').join("") +
          '</select><button type="button" class="billingOpen" data-invoice-open="' + row.id + '">Ver / PDF <span aria-hidden="true">↗</span></button></div></article>';
      }).join("");
    }
    updateButtons();
  }
  async function refresh() {
    let captured;
    try { captured = session(); } catch { return; }
    const ticket = ++request;
    loading = true; updateButtons(); if (!loaded) render();
    try {
      let query = supabaseClient.from("olon_invoices").select("*", {count:"exact"}).order("sequence_number", {ascending:false});
      const status = $("billingStatus").value;
      if (Object.hasOwn(labels, status)) query = query.eq("status", status);
      // Strip PostgREST filter syntax; invoice content is rendered as escaped text.
      const search = $("billingSearch").value.trim().replace(/[,()%_\\"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 110);
      if (search) query = query.or("client_name.ilike.%" + search + "%,invoice_number.ilike.%" + search + "%");
      const [list, summary] = await Promise.all([
        query.range(page * pageSize, page * pageSize + pageSize - 1),
        supabaseClient.rpc("olon_invoice_summary")
      ]);
      if (!active(captured) || ticket !== request) return;
      if (list.error) throw list.error;
      if (summary.error) throw summary.error;
      count = Number(list.count || 0);
      if (page && page * pageSize >= count) { page = 0; return await refresh(); }
      rows = list.data || []; loaded = true;
      const metrics = summary.data || {};
      $("billingPaidTotal").textContent = money(metrics.paid_cents);
      $("billingPendingTotal").textContent = money(metrics.pending_cents);
      $("billingMonthTotal").textContent = money(metrics.month_cents);
      $("billingInvoiceCount").textContent = Number(metrics.invoice_count || 0);
      render();
    } catch (error) { if (active(captured) && ticket === request) feedback(reason(error), true); }
    finally { if (active(captured) && ticket === request) { loading = false; render(); } }
  }
  function setStudents(users) {
    if (!authorized()) return;
    const captured = session();
    if (!active(captured)) return;
    const selected = $("billingStudent").value;
    students = (users || []).filter(user => user.role === "student" && validId(user.id))
      .map(({id,full_name,email,next_payment_date}) => ({id,full_name,email,next_payment_date}));
    $("billingStudent").replaceChildren(new Option("Cliente particular", ""));
    students.slice().sort((a,b) => (a.full_name || "").localeCompare(b.full_name || "", "es")).forEach(student => {
      $("billingStudent").add(new Option((student.full_name || student.email || "Estudiante") + (student.email ? " · " + student.email : ""), student.id));
    });
    $("billingStudent").value = selected;
    if (!loaded && !loading) void refresh();
  }
  function loadScript(src, available) {
    if (available()) return Promise.resolve();
    return new Promise((resolve,reject) => {
      const script = document.createElement("script"); script.src = src;
      script.onload = () => available() ? resolve() : reject(Error("No se pudo iniciar el generador de facturas."));
      script.onerror = () => { script.remove(); reject(Error("No cargó el generador PDF. Comprueba internet y vuelve a intentarlo.")); };
      document.head.append(script);
    });
  }
  async function assets() {
    if (!assetsPromise) assetsPromise = (async () => {
      await loadScript("./billing/vendor/pdf-lib.min.js", () => !!window.PDFLib);
      await loadScript("./billing/invoice-pdf.js?v=20261107-integrated", () => typeof window.createInvoicePdf === "function");
      await loadScript("./billing/editor.js?v=20261107-integrated", () => typeof window.createOlonInvoiceEditor === "function");
    })().catch(error => { assetsPromise = null; throw error; });
    return assetsPromise;
  }
  async function save(id, data, studentId, revision) {
    const captured = session();
    const result = await supabaseClient.rpc("olon_save_invoice", {p_id:id,p_data:data,p_student_id:studentId,p_expected_revision:revision});
    if (!active(captured)) throw Error("La sesión cambió. Entra de nuevo para continuar.");
    if (result.error) throw Error(reason(result.error));
    const row = result.data;
    if (!row || row.id !== id || !row.invoice_number) throw Error("No se confirmó el guardado de la factura. Vuelve a intentarlo.");
    return row;
  }
  async function ensureEditor() {
    if (editor) return editor;
    if (editorPromise) return editorPromise;
    const captured = session();
    $("billingEditorLoading").hidden = false;
    editorPromise = (async () => {
      const [, response] = await Promise.all([assets(), fetch("./billing/editor-template.json?v=20261107-integrated")]);
      if (!response.ok) throw Error("No cargó el editor. Actualiza el portal e inténtalo de nuevo.");
      const {html} = await response.json();
      if (!active(captured)) throw Error("La sesión cambió.");
      const host = $("billingEditorHost");
      // This is a trusted, bundled template. Customer data only enters input values/textContent.
      const mount = document.createElement("div"); host.replaceChildren(mount);
      const root = mount.attachShadow({mode:"open"}); root.innerHTML = html;
      editor = window.createOlonInvoiceEditor(root, {
        save,
        setBusy: value => { if (active(captured)) { saving = value; updateButtons(); } },
        saved: row => { if (active(captured)) { feedback("Factura " + row.invoice_number + " guardada en tu historial."); void refresh(); } },
        newInvoice: () => void newInvoice()
      });
      return editor;
    })().finally(() => { if (active(captured)) { editorPromise = null; $("billingEditorLoading").hidden = true; } });
    return editorPromise;
  }
  function mayLeave() {
    return !saving && (!editor?.dirty() || confirm("Tienes cambios sin guardar en esta factura. ¿Descartarlos y continuar?"));
  }
  function showEditor(show) {
    $("billingEditorPanel").hidden = !show;
    $("billingHistoryPanel").hidden = show;
    $("billingBack").hidden = !show;
    if (show) $("billingEditorPanel").scrollIntoView({behavior:"smooth",block:"start"});
  }
  async function newInvoice(studentId = "") {
    if (!authorized() || !mayLeave()) return;
    try {
      session(); feedback(); showEditor(true);
      const instance = await ensureEditor();
      const student = students.find(user => user.id === studentId);
      instance.reset(null, student);
      $("billingStudent").value = student?.id || "";
    } catch (error) { feedback(reason(error), true); }
  }
  async function openInvoice(id) {
    if (!authorized() || !validId(id) || !mayLeave()) return;
    const captured = session();
    try {
      feedback(); showEditor(true);
      const [instance, result] = await Promise.all([ensureEditor(), supabaseClient.from("olon_invoices").select("*").eq("id", id).single()]);
      if (!active(captured)) return;
      if (result.error) throw result.error;
      instance.reset(result.data);
      $("billingStudent").value = result.data.student_id || "";
    } catch (error) { if (active(captured)) feedback(reason(error), true); }
  }
  async function changeStatus(id, status) {
    const row = rows.find(invoice => invoice.id === id);
    if (!authorized() || saving || !row || !Object.hasOwn(labels,status)) return;
    saving = true; updateButtons();
    try {
      const saved = await save(id, {...row.form_data,status}, row.student_id, row.revision);
      feedback(saved.invoice_number + ": " + labels[saved.status].toLowerCase() + ".");
      await refresh();
    } catch (error) { feedback(reason(error), true); await refresh(); }
    finally { saving = false; updateButtons(); }
  }
  function activate() {
    if (!authorized()) return;
    session(); if (window.cachedUsers) setStudents(window.cachedUsers);
    if (!loading) void refresh();
  }
  $("billingNew").addEventListener("click", () => void newInvoice());
  $("billingRefresh").addEventListener("click", () => { feedback(); void refresh(); });
  $("billingBack").addEventListener("click", () => { if (mayLeave()) { editor?.reset(); showEditor(false); feedback(); void refresh(); } });
  $("billingStudent").addEventListener("change", event => editor?.setClient(students.find(student => student.id === event.target.value)));
  $("billingSearch").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page = 0; void refresh(); }, 250); });
  $("billingStatus").addEventListener("change", () => { page = 0; void refresh(); });
  $("billingPrev").addEventListener("click", () => { if (page > 0) { page--; void refresh(); } });
  $("billingNext").addEventListener("click", () => { if ((page+1)*pageSize < count) { page++; void refresh(); } });
  block.addEventListener("click", event => {
    const button = event.target.closest("[data-invoice-open]");
    if (button) void openInvoice(button.dataset.invoiceOpen);
  });
  block.addEventListener("change", event => {
    const select = event.target.closest("[data-invoice-status]");
    if (select) void changeStatus(select.dataset.invoiceStatus, select.value);
  });
  document.addEventListener("click", event => {
    const button = event.target.closest("[data-billing-student]");
    if (button && authorized()) void newInvoice(button.dataset.billingStudent);
  });
  supabaseClient.auth.onAuthStateChange(event => { if (event === "SIGNED_OUT") reset(); });
  window.addEventListener("beforeunload", event => { if (authorized() && editor?.dirty()) { event.preventDefault(); event.returnValue = ""; } });
  window.olonBilling = {activate,refresh,setStudents,newInvoice};
  render();
})();
