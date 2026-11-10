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
  let reservations = new Set(), reservationIntent = false, paymentInvoice = null, payments = [], paymentBusy = false;
  const paymentCurrency = cents => currency.format(Number(cents || 0) / 100);
  const todayPR = () => new Intl.DateTimeFormat("en-CA",{timeZone:"America/Puerto_Rico",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());

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
    rows = []; students = []; reservations.clear(); paymentInvoice = null; payments = []; reservationIntent = false; paymentBusy = false; page = 0; count = 0;
    showPayments(false);
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
    block.querySelectorAll("[data-invoice-open],[data-invoice-status],[data-invoice-edit],[data-invoice-archive],[data-invoice-reserve]").forEach(el => { el.disabled = saving || paymentBusy; });
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
        const reserved = reservations.has(row.id);
        const badge = reserved ? '<small class="billingReservationTag">' + (row.status === "paid" ? "Reserva saldada" : "Reserva con abonos") + '</small>' : "";
        const reservationAction = reserved || row.status === "pending" ? '<button type="button" class="billingOpen" data-invoice-reserve="' + row.id + '">' + (reserved ? "Ver abonos" : "Separar clase") + '</button>' : "";
        return '<article class="billingInvoiceRow"><div class="billingInvoiceIdentity"><span class="billingDocIcon" aria-hidden="true">▤</span><div><strong>' + esc(row.invoice_number) +
          '</strong><small>' + esc(row.issue_date.split("-").reverse().join("/")) + '</small></div></div><div class="billingInvoiceClient"><strong>' + esc(row.client_name) +
          '</strong><small>' + esc(row.service) + '</small>' + badge + '</div><div class="billingInvoiceAmount"><strong>' + money(row.total_cents) +
          '</strong><small>' + esc(due) + '</small></div><div class="billingInvoiceActions"><select class="billingState ' + status + '" aria-label="Estado de ' + esc(row.invoice_number) +
          '" data-invoice-status="' + row.id + '">' + Object.entries(labels).map(([value,label]) => '<option value="' + value + '"' + (value === status ? " selected" : "") + '>' + label + '</option>').join("") +
          '</select><button type="button" class="billingOpen" data-invoice-edit="' + row.id + '">Editar / PDF</button>' + reservationAction + '<button type="button" class="billingOpen billingArchive" data-invoice-archive="' + row.id + '">Eliminar</button></div></article>';
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
      let query = supabaseClient.from("olon_invoices").select("*", {count:"exact"}).is("archived_at",null).order("sequence_number", {ascending:false});
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
      reservations.clear();
      if(rows.length){
        const linked = await supabaseClient.from("olon_invoice_reservations").select("invoice_id").in("invoice_id",rows.map(row=>row.id));
        if(!active(captured) || ticket!==request)return;
        if(linked.error) throw linked.error;
        reservations = new Set((linked.data || []).map(x=>x.invoice_id));
      }
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
      await loadScript("./billing/invoice-pdf.js?v=20261110-reservations-1", () => typeof window.createInvoicePdf === "function");
      await loadScript("./billing/editor.js?v=20261110-reservations-1", () => typeof window.createOlonInvoiceEditor === "function");
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
        paymentSummary,
        setBusy: value => { if (active(captured)) { saving = value; updateButtons(); } },
        saved: async row => { if (active(captured)) {
          if(reservationIntent){
            const result=await supabaseClient.rpc("olon_start_invoice_reservation",{p_invoice_id:row.id});
            if(result.error) throw Error(reason(result.error));
            reservationIntent=false;
          }
          feedback("Factura " + row.invoice_number + " guardada en tu historial."); void refresh();
        } },
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
    if(show)showPayments(false);
    if (show) $("billingEditorPanel").scrollIntoView({behavior:"smooth",block:"start"});
  }
  async function newInvoice(studentId = "", classReservation = false) {
    if (!authorized() || !mayLeave()) return;
    try {
      session(); feedback(); showEditor(true);
      const instance = await ensureEditor();
      const student = students.find(user => user.id === studentId);
      reservationIntent=classReservation;
      instance.reset(null, student);
      if(classReservation)instance.presetClass();
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
      reservationIntent=false;
      instance.reset(result.data);
      $("billingStudent").value = result.data.student_id || "";
    } catch (error) { if (active(captured)) feedback(reason(error), true); }
  }
  async function changeStatus(id, status) {
    const row = rows.find(invoice => invoice.id === id);
    if (!authorized() || saving || !row || !Object.hasOwn(labels,status)) return;
    if(reservations.has(id) && status==="paid") { feedback("Registra todos los abonos para saldar la reserva automáticamente.",true); await refresh(); return; }
    if(reservations.has(id) && status==="cancelled") { feedback("Las reservas con abonos deben conservarse para conciliación.",true); await refresh(); return; }
    saving = true; updateButtons();
    try {
      const saved = await save(id, {...row.form_data,status}, row.student_id, row.revision);
      feedback(saved.invoice_number + ": " + labels[saved.status].toLowerCase() + ".");
      await refresh();
    } catch (error) { feedback(reason(error), true); await refresh(); }
    finally { saving = false; updateButtons(); }
  }

  // Reservation installments are stored in a separate, immutable financial ledger.
  const payPanel=document.createElement("section");
  payPanel.id="olonInstallmentPanel";
  payPanel.className="billingInstallmentPanel";
  payPanel.hidden=true;
  payPanel.innerHTML=`
    <div class="billingInstallmentHead">
      <div><span class="billingReservationTag">RESERVA DE CLASE</span><h5 id="installmentTitle">Abonos y saldo</h5>
      <p id="installmentDescription">Los abonos registrados permanecen asociados a esta factura.</p></div>
      <button type="button" class="billingButton" id="installmentBack">← Volver a facturas</button>
    </div>
    <div class="billingInstallmentMetrics">
      <div><span>Total de la clase</span><strong id="installmentTotal">—</strong></div>
      <div><span>Total abonado</span><strong id="installmentReceived">—</strong></div>
      <div><span>Balance pendiente</span><strong id="installmentBalance">—</strong></div>
    </div>
    <form id="installmentForm" class="billingInstallmentForm">
      <h6>Registrar nuevo abono</h6>
      <label>Importe recibido (USD)<input name="amount" type="number" min=".01" step=".01" required placeholder="0.00"></label>
      <label>Fecha de pago<input name="date" type="date" required></label>
      <label>Método de pago<select name="method" required><option value="ATH Móvil">ATH Móvil</option><option value="Transferencia">Transferencia</option><option value="Efectivo">Efectivo</option><option value="Tarjeta">Tarjeta</option><option value="Otro">Otro</option></select></label>
      <label>Referencia (opcional)<input name="reference" maxlength="160" placeholder="Número de confirmación"></label>
      <button type="submit" class="billingButton primary">Guardar abono</button>
    </form>
    <h6>Historial de pagos</h6><div id="installmentHistory" class="billingInstallmentHistory"></div>
    <p id="installmentFeedback" class="billingFeedback" role="status" hidden></p>
  `;
  $("billingEditorPanel").after(payPanel);
  const payForm=payPanel.querySelector("#installmentForm");
  function payField(name){return payForm.elements.namedItem(name);}
  function payText(id,value){payPanel.querySelector("#"+id).textContent=value;}
  function payFeedback(message="",error=false){const el=payPanel.querySelector("#installmentFeedback");el.hidden=!message;el.textContent=message;el.classList.toggle("error",error);}
  function showPayments(show){
    if(!payPanel?.isConnected)return;
    payPanel.hidden=!show;
    if(show){
      $("billingHistoryPanel").hidden=true;$("billingEditorPanel").hidden=true;$("billingBack").hidden=true;
    }
  }
  async function paymentSummary(id){
    const [reserve,paid] = await Promise.all([
      supabaseClient.from("olon_invoice_reservations").select("invoice_id").eq("invoice_id",id).maybeSingle(),
      supabaseClient.from("olon_invoice_payments").select("id,amount_cents,paid_on,method,reference,created_at").eq("invoice_id",id).order("created_at",{ascending:true})
    ]);
    if(reserve.error)throw Error(reason(reserve.error));
    if(paid.error)throw Error(reason(paid.error));
    if(!reserve.data)return null;
    return {payments:paid.data||[],paidCents:(paid.data||[]).reduce((n,p)=>n+Number(p.amount_cents),0)};
  }
  async function renderPayments(){
    if(!paymentInvoice)return;
    const id=paymentInvoice.id;
    const [invoice,summary]=await Promise.all([
      supabaseClient.from("olon_invoices").select("*").eq("id",id).single(),paymentSummary(id)
    ]);
    if(!authorized() || paymentInvoice?.id!==id)return;
    if(invoice.error)throw Error(reason(invoice.error));
    if(invoice.data.archived_at)throw Error("Esta factura fue retirada del historial activo.");
    paymentInvoice=invoice.data;payments=summary?.payments||[];
    const received=summary?.paidCents||0;
    const balance=Math.max(0,Number(paymentInvoice.total_cents)-received);
    payText("installmentTitle",paymentInvoice.invoice_number+" · "+paymentInvoice.client_name);
    payText("installmentDescription",paymentInvoice.service);
    payText("installmentTotal",paymentCurrency(paymentInvoice.total_cents));
    payText("installmentReceived",paymentCurrency(received));
    payText("installmentBalance",paymentCurrency(balance));
    const button=payForm.querySelector('button[type="submit"]');
    button.disabled=balance===0 || paymentBusy;
    payField("amount").max=(balance/100).toFixed(2);
    payField("date").value=todayPR();payField("date").max=todayPR();
    const list=payPanel.querySelector("#installmentHistory");list.replaceChildren();
    if(!payments.length){const p=document.createElement("p");p.textContent="No se han registrado abonos todavía.";list.append(p);}
    for(const entry of payments){
      const line=document.createElement("div");line.className="billingInstallmentItem";
      const desc=document.createElement("span");desc.textContent=entry.paid_on+" · "+entry.method+(entry.reference?" · "+entry.reference:"");
      const amount=document.createElement("strong");amount.textContent=paymentCurrency(entry.amount_cents);
      line.append(desc,amount);list.append(line);
    }
    if(!balance)payFeedback("Reserva saldada. El estado de la factura se actualizó automáticamente.");
  }
  async function openPayments(id){
    if(!authorized() || saving || !validId(id) || !mayLeave())return;
    try{
      const captured=session();
      const invoice=rows.find(row=>row.id===id) || (await supabaseClient.from("olon_invoices").select("*").eq("id",id).single()).data;
      if(!active(captured) || !invoice || invoice.archived_at)return;
      if(!reservations.has(id)){
        if(invoice.status!=="pending")throw Error("Solo se pueden separar facturas pendientes.");
        if(!confirm("¿Activar una reserva de clase con abonos para "+invoice.invoice_number+"?"))return;
        const result=await supabaseClient.rpc("olon_start_invoice_reservation",{p_invoice_id:id});
        if(result.error)throw Error(reason(result.error));
        reservations.add(id);
      }
      paymentInvoice=invoice;editor?.reset();showPayments(true);payFeedback();
      await renderPayments();
      payPanel.scrollIntoView({behavior:"auto",block:"start"});
      void refresh();
    }catch(error){if(paymentInvoice){showPayments(true);payFeedback(reason(error),true);}else feedback(reason(error),true);}
  }
  async function archiveInvoice(id){
    const row=rows.find(row=>row.id===id);
    if(!authorized() || saving || !row || !mayLeave())return;
    if(!confirm("¿Eliminar "+row.invoice_number+" del historial activo? No se borrarán los abonos ni el registro de auditoría."))return;
    saving=true;updateButtons();
    try{
      const result=await supabaseClient.rpc("olon_archive_invoice",{p_invoice_id:id});
      if(result.error)throw Error(reason(result.error));
      feedback("Factura retirada del historial activo. Los registros financieros se conservaron.");
      await refresh();
    }catch(error){feedback(reason(error),true);}
    finally{saving=false;updateButtons();}
  }
  payPanel.querySelector("#installmentBack").addEventListener("click",()=>{
    paymentInvoice=null;payments=[];showPayments(false);$("billingHistoryPanel").hidden=false;payFeedback();void refresh();
  });
  payForm.addEventListener("submit",async event=>{
    event.preventDefault();
    if(!authorized() || paymentBusy || !paymentInvoice || !payForm.reportValidity())return;
    const raw=Number(payField("amount").value);
    if(!Number.isFinite(raw) || raw<=0 || Math.round(raw*100)/100!==raw){payFeedback("Indica una cantidad válida con máximo dos decimales.",true);return;}
    const cents=Math.round(raw*100);
    const remaining=Number(paymentInvoice.total_cents)-payments.reduce((n,p)=>n+Number(p.amount_cents),0);
    if(cents>remaining){payFeedback("El abono supera el saldo pendiente.",true);return;}
    if(!confirm("¿Confirmas que recibiste "+paymentCurrency(cents)+"? Los abonos se registran permanentemente."))return;
    const invoiceId=paymentInvoice.id;
    paymentBusy=true;payForm.querySelector('button[type="submit"]').disabled=true;payFeedback();
    try{
      const res=await supabaseClient.rpc("olon_add_invoice_payment",{
        p_invoice_id:invoiceId,p_payment_id:crypto.randomUUID(),p_amount_cents:cents,
        p_paid_on:payField("date").value,p_method:payField("method").value,p_reference:payField("reference").value.trim()
      });
      if(res.error)throw Error(reason(res.error));
      payField("amount").value="";payField("reference").value="";
      await renderPayments();payFeedback("Abono registrado correctamente.");void refresh();
    }catch(error){payFeedback(reason(error),true);}
    finally{paymentBusy=false;payForm.querySelector('button[type="submit"]').disabled=paymentInvoice?.status==="paid";}
  });


  function activate() {
    if (!authorized()) return;
    session(); if (window.cachedUsers) setStudents(window.cachedUsers);
    if (!loading) void refresh();
  }
  $("billingNew").addEventListener("click", () => void newInvoice());
  const reserveNew=document.createElement("button");reserveNew.type="button";reserveNew.className="billingButton";reserveNew.textContent="＋ Separar clase";
  $("billingNew").before(reserveNew);
  reserveNew.addEventListener("click",()=>void newInvoice("",true));
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
    const edit=event.target.closest("[data-invoice-edit]");
    if(edit)void openInvoice(edit.dataset.invoiceEdit);
    const reserve=event.target.closest("[data-invoice-reserve]");
    if(reserve)void openPayments(reserve.dataset.invoiceReserve);
    const archive=event.target.closest("[data-invoice-archive]");
    if(archive)void archiveInvoice(archive.dataset.invoiceArchive);
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
