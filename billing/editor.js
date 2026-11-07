/* Adapted from the original OLFX invoice editor. */
window.createOlonInvoiceEditor = function(root, api) {

    "use strict";

    const element = id => root.getElementById(id);
    const fieldValue = id => element(id).value.trim();
    const fieldAmount = id => Math.max(0, element(id).valueAsNumber || 0);
    const setText = (id, text) => { element(id).textContent = text; };
    const setVisible = (id, visible) => { element(id).hidden = !visible; };
    const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
    const formatNumber = number => "OSA-P-" + String(number).padStart(6, "0");
    const maxSequence = 999999999;
    const invoiceForm = element("invoiceForm");

    const requiredTextFields = [element("client"), element("service")];

    let nextNumber = null;
    let assignedNumber = null;
    let busy = false;
    let currentId = crypto.randomUUID();
    let currentRevision = null;
    let currentStudentId = null;
    let savedSignature = "";
    let disposed = false;
    let generatedPdf = null;

    function showMessage(id, message) {
      setText(id, message);
      setVisible(id, Boolean(message));
    }

    function renderNumber() {
      const issued = assignedNumber !== null;
      const visibleNumber = assignedNumber ?? nextNumber;
      const numberLabel = visibleNumber === null
        ? "OSA-P · Automática"
        : visibleNumber > maxSequence ? "Serie agotada" : formatNumber(visibleNumber);
      setText("sequenceCaption", issued ? "Número asignado" : "Serie del portal");
      setText("sequenceNumber", numberLabel);
      setText("sequenceHint", issued
        ? "Guardada en el historial de administración."
        : "Número único asignado al guardar, desde cualquier dispositivo.");
      setText("viewNumber", issued ? formatNumber(assignedNumber) : "Borrador");
      element("viewNumber").dataset.draft = String(!issued);
    }

    function setBusy(value) {
      busy = value;
      element("invoiceFields").disabled = value;
      element("pdfButton").disabled = value;
      element("newButton").disabled = value;
      api.setBusy(value);
    }

    function today() {
      return new Intl.DateTimeFormat("en-CA", {timeZone:"America/Puerto_Rico",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    }

    function displayDate(value) {
      return value ? value.split("-").reverse().join("/") : "—";
    }

    function renderInvoice() {
      const cents = Math.round(fieldAmount("price") * 100);
      const discount = Math.min(100, fieldAmount("discount"));
      const discountCents = Math.round(cents * Math.round(discount * 100) / 10000);
      const status = element("status");
      const dueDate = fieldValue("dueDate");
      const invoice = {
        number: assignedNumber === null ? "" : formatNumber(assignedNumber),
        client: fieldValue("client"),
        detail: fieldValue("detail"),
        issueDate: displayDate(fieldValue("issueDate")),
        dueDate: dueDate ? displayDate(dueDate) : "",
        status: status.value,
        statusLabel: status.selectedOptions[0].textContent,
        service: fieldValue("service"),
        regularPrice: money.format(cents / 100),
        hasDiscount: discount > 0,
        discountLabel: fieldValue("discountLabel") || "Descuento aplicado",
        discountDetail: discount.toLocaleString("es-PR") + "% del precio regular",
        discountValue: money.format((0 - discountCents) / 100),
        benefit: fieldValue("benefit"),
        benefitValue: money.format(fieldAmount("benefitValue")),
        total: money.format((cents - discountCents) / 100),
        methods: fieldValue("paymentMethods"),
        paymentDetails: fieldValue("paymentDetails"),
        notes: fieldValue("notes")
      };

      setText("viewClient", invoice.client || "Nombre del cliente");
      setText("viewDetail", invoice.detail);
      setVisible("viewDetail", Boolean(invoice.detail));
      setText("viewIssueDate", invoice.issueDate);
      setText("viewDueDate", invoice.dueDate);
      setVisible("dueLabel", Boolean(invoice.dueDate));
      setVisible("viewDueDate", Boolean(invoice.dueDate));
      setText("viewStatus", invoice.statusLabel);
      element("viewStatus").dataset.status = invoice.status;

      setText("viewService", invoice.service || "Descripción del servicio");
      setText("viewPrice", invoice.regularPrice);
      setText("viewSubtotal", invoice.regularPrice);
      setText("viewDiscountLabel", invoice.discountLabel);
      setText("viewDiscountPct", invoice.discountDetail);
      setText("viewDiscountValue", invoice.discountValue);
      setText("viewTotalDiscount", invoice.discountValue);
      setVisible("discountRow", invoice.hasDiscount);
      setVisible("totalDiscountRow", invoice.hasDiscount);
      setText("viewBenefit", invoice.benefit);
      setText("viewBenefitValue", invoice.benefitValue);
      setVisible("benefitRow", Boolean(invoice.benefit));
      setText("viewTotal", invoice.total);
      setText("actionTotal", invoice.total);

      const hasPayment = Boolean(invoice.methods || invoice.paymentDetails);
      setText("viewPaymentMethods", invoice.methods);
      setText("viewPaymentDetails", invoice.paymentDetails);
      setText("viewNotes", invoice.notes);
      setVisible("viewPaymentMethods", Boolean(invoice.methods));
      setVisible("viewPaymentDetails", Boolean(invoice.paymentDetails));
      setVisible("paymentSection", hasPayment);
      setVisible("notesSection", Boolean(invoice.notes));
      setVisible("invoiceFoot", Boolean(hasPayment || invoice.notes));
      return invoice;
    }

    function showPdf(file) {
      let canShareFile = false;
      try {
        canShareFile = typeof navigator.share === "function" && navigator.canShare?.({ files: [file] }) === true;
      } catch {
        // File sharing is optional. The download and viewer links are always available.
      }
      const url = URL.createObjectURL(file);
      generatedPdf = { file, url };
      element("downloadPdf").href = url;
      element("downloadPdf").download = file.name;
      element("openPdf").href = url;
      setVisible("sharePdf", canShareFile);
      setVisible("pdfButton", false);
      setVisible("pdfHelp", false);
      setVisible("downloadPdf", true);
      setVisible("pdfActions", true);
      element("downloadPdf").focus({ preventScroll: true });
    }

    function updateDraft() {
      if (generatedPdf) {
        const { url } = generatedPdf;
        generatedPdf = null;
        element("downloadPdf").removeAttribute("href");
        element("openPdf").removeAttribute("href");
        setVisible("downloadPdf", false);
        setVisible("pdfActions", false);
        setVisible("pdfButton", true);
        setVisible("pdfHelp", true);
        // Let a download or a PDF viewer finish opening the old file.
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
      showMessage("invoiceFeedback", "");
      renderInvoice();
    }

    invoiceForm.addEventListener("input", event => {
      if (requiredTextFields.includes(event.target)) event.target.setCustomValidity("");
      updateDraft();
    });
    invoiceForm.addEventListener("change", updateDraft);

    invoiceForm.addEventListener("submit", async event => {
      event.preventDefault();
      if (busy || generatedPdf) return;
      for (const field of requiredTextFields) {
        field.setCustomValidity(field.value.trim() ? "" : "Completa este campo.");
      }
      if (!invoiceForm.reportValidity()) return;

      showMessage("invoiceFeedback", "");
      if (typeof window.createInvoicePdf !== "function" || !window.PDFLib) {
        showMessage("invoiceFeedback", "El generador de PDF no cargó. Recarga la página e inténtalo de nuevo.");
        return;
      }
      setBusy(true);
      setText("pdfButtonLabel", "Generando…");
      try {
        const result = await api.save(currentId, snapshot(), currentStudentId, currentRevision);
        if (disposed) return;
        currentRevision = result.revision;
        assignedNumber = result.sequence_number;
        savedSignature = signature();
        renderNumber();
        api.saved(result);
        const invoice = renderInvoice();
        const logo = root.querySelector(".brand-logo").getAttribute("src");
        const logoBytes = await fetch(logo).then(response => { if (!response.ok) throw Error("No cargó el logo de la factura."); return response.arrayBuffer(); });
        const pdf = await window.createInvoicePdf(invoice, logoBytes);
        if (disposed) return;
        showPdf(new File([pdf], "Factura-" + invoice.number + ".pdf", { type: "application/pdf" }));
        showMessage("invoiceFeedback", "Factura guardada. Tu PDF está listo para descargar.");
      } catch (error) {
        if (!disposed) showMessage("invoiceFeedback", error.message || "No se pudo generar el PDF. Vuelve a intentarlo.");
      } finally {
        if (!disposed) {
          setText("pdfButtonLabel", "Guardar y generar PDF");
          setBusy(false);
        }
      }
    });

    element("sharePdf").addEventListener("click", async () => {
      if (!generatedPdf) return;
      showMessage("invoiceFeedback", "");
      try {
        await navigator.share({ files: [generatedPdf.file] });
      } catch (error) {
        if (error.name !== "AbortError") {
          showMessage("invoiceFeedback", "Usa Descargar PDF o Abrir PDF para guardar el archivo.");
        }
      }
    });


    const formIds = ["client","detail","issueDate","dueDate","status","service","price","discount","discountLabel","benefit","benefitValue","paymentMethods","paymentDetails","notes"];
    function snapshot() {
      return Object.fromEntries(formIds.map(id => [id, element(id).value.trim()]));
    }
    function signature() { return JSON.stringify([snapshot(), currentStudentId]); }
    function dirty() { return !disposed && signature() !== savedSignature; }
    function setClient(student) {
      if (busy || disposed) return;
      currentStudentId = student?.id || null;
      if (student) {
        element("client").value = student.full_name || "";
        element("detail").value = student.email || "";
        element("dueDate").value = (student.next_payment_date || "") >= today() ? student.next_payment_date : "";
      }
      updateDraft();
    }
    function reset(record, student) {
      if (busy || disposed) return;
      invoiceForm.reset();
      for (const field of requiredTextFields) field.setCustomValidity("");
      currentId = record?.id || crypto.randomUUID();
      currentRevision = record?.revision ?? null;
      currentStudentId = record?.student_id || null;
      assignedNumber = record?.sequence_number ?? null;
      element("issueDate").value = today();
      element("service").value = "Membresía VIP · OLON Society Academy";
      if (record) formIds.forEach(id => { element(id).value = record.form_data[id] ?? ""; });
      else if (student) setClient(student);
      renderNumber();
      updateDraft();
      savedSignature = signature();
      root.querySelector("h1").textContent = record ? "Factura " + formatNumber(assignedNumber) : "Nueva factura";
    }
    element("newButton").addEventListener("click", () => api.newInvoice());
    // Shadow DOM anchors need an explicit scroll target.
    root.querySelectorAll(".jump-link").forEach(link => link.addEventListener("click", event => {
      event.preventDefault();
      root.querySelector(link.getAttribute("href"))?.scrollIntoView({behavior:"smooth",block:"start"});
    }));
    reset();
    element("pdfButton").disabled = false;
    return {
      reset, setClient, dirty,
      isBusy: () => busy,
      studentId: () => currentStudentId,
      dispose: () => {
        disposed = true;
        if (generatedPdf) URL.revokeObjectURL(generatedPdf.url);
        invoiceForm.reset();
        root.replaceChildren();
      }
    };

};
