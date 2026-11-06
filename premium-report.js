(() => {
  "use strict";

  const byId = id => document.getElementById(id);
  const button = byId("reportPdfDownload");
  const save = byId("reportPdfSave");
  const open = byId("reportPdfOpen");
  const share = byId("reportPdfShare");
  const options = byId("reportPdfOptions");
  let prepared = null, loadingLibrary = null, request = 0;
  let logoData = "";
  const logo = new Image();
  logo.onload = () => {
    try{
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 96;
      const scale = Math.min(96 / logo.naturalWidth, 96 / logo.naturalHeight);
      const width = logo.naturalWidth * scale, height = logo.naturalHeight * scale;
      canvas.getContext("2d").drawImage(logo, (96-width)/2, (96-height)/2, width, height);
      logoData = canvas.toDataURL("image/png");
    }catch{ /* The report can use its text mark when the logo is unavailable. */ }
  };
  logo.src = "./assets/logo.png";

  function feedback(message, tone = ""){
    const status = byId("reportPdfStatus");
    status.textContent = message;
    status.dataset.tone = tone;
    status.hidden = !message;
  }

  function clearPrepared(){
    if(prepared){
      // Let a download or viewer that just opened finish reading its URL.
      const url = prepared.url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
    request++;
    prepared = null;
    options.hidden = true;
    open.removeAttribute("href");
    save.removeAttribute("href");
    feedback("");
  }

  function getLibrary(){
    if(window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if(!loadingLibrary){
      loadingLibrary = new Promise((resolve, reject) => {
        const fallback = document.createElement("script");
        fallback.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
        const timer = setTimeout(() => {
          fallback.remove();
          reject(new Error("PDF library timeout"));
        }, 10_000);
        fallback.onload = () => {
          clearTimeout(timer);
          if(window.jspdf?.jsPDF) resolve(window.jspdf.jsPDF);
          else reject(new Error("PDF library unavailable"));
        };
        fallback.onerror = () => {
          clearTimeout(timer);
          fallback.remove();
          reject(new Error("PDF library unavailable"));
        };
        document.head.append(fallback);
      }).finally(() => { loadingLibrary = null; });
    }
    return loadingLibrary;
  }

  function createReport(Pdf, config, records, student){
    const pdf = new Pdf({orientation:"portrait", unit:"pt", format:"a4", compress:true});
    const width = pdf.internal.pageSize.getWidth(), height = pdf.internal.pageSize.getHeight();
    const margin = 34, body = width - 2 * margin, gap = 14, column = (body - gap)/2;
    const ink = "#103229", muted = "#466458", green = "#11614a", gold = "#e8bf68";
    const light = "#f1f7f3", rule = "#d4e5db", negative = "#96342b";
    const period = totals(records), all = totals(), rate = winRateFromRecords(records), extremes = bestWorst(records);
    const date = new Intl.DateTimeFormat("es-PR", {dateStyle:"long"}).format(new Date());
    const clean = value => String(value).normalize("NFC").replace(/[‘’]/g, "'")
      .replace(/[–—−]/g, "-").replace(/[^\x20-\x7e\xa0-\xff]/gu, "");
    const amount = value => (value < 0 ? "-" : "") + money(Math.abs(value));
    const result = value => (value > 0 ? "+" : "") + amount(value);

    function text(value, x, y, {size = 11, color = ink, weight = "normal", align = "left"} = {}){
      pdf.setFont("helvetica", weight);
      pdf.setFontSize(size);
      pdf.setTextColor(color);
      pdf.text(clean(value), x, y, {align});
    }
    function box(x, y, w, h, fill, stroke = null){
      pdf.setFillColor(fill);
      if(stroke) pdf.setDrawColor(stroke);
      pdf.roundedRect(x, y, w, h, 9, 9, stroke ? "FD" : "F");
    }
    function metric(x, y, label, value, note, accent){
      box(x, y, column, 92, light, rule);
      text(label, x+14, y+22, {size:10, weight:"bold", color:muted});
      text(value, x+14, y+55, {size:23, weight:"bold", color:accent});
      text(note, x+14, y+75, {size:9, color:muted});
    }
    function section(x, y, title, rows){
      box(x, y, column, 200, "#ffffff", rule);
      text(title, x+14, y+26, {size:13, weight:"bold", color:green});
      rows.forEach(([label, value], index) => {
        const lineY = y + 49 + index * 25;
        pdf.setDrawColor(rule);
        pdf.line(x+14, lineY+7, x+column-14, lineY+7);
        text(label, x+14, lineY, {size:10, color:muted});
        text(value, x+column-14, lineY, {size:10, weight:"bold", align:"right"});
      });
    }

    pdf.setProperties({title:config.title, author:"OLON Society Academy", subject:"Reporte privado de trading"});
    pdf.setFillColor("#f9fbfa");
    pdf.rect(0, 0, width, height, "F");
    pdf.setFillColor("#103c31");
    pdf.rect(0, 0, width, 130, "F");
    pdf.setFillColor(gold);
    pdf.rect(0, 130, width, 3, "F");
    box(margin, 31, 55, 55, "#1c4f41");
    if(logoData){
      try{ pdf.addImage(logoData, "PNG", margin+4, 35, 47, 47); }
      catch{ text("OL", margin+27.5, 65, {size:17, color:gold, weight:"bold", align:"center"}); }
    }else text("OL", margin+27.5, 65, {size:17, color:gold, weight:"bold", align:"center"});
    text("OLON SOCIETY ACADEMY", margin+70, 46, {size:10, color:gold, weight:"bold"});
    text(config.title, margin+70, 76, {size:26, color:"#ffffff", weight:"bold"});
    text("Portal privado del estudiante  /  VIP", margin+70, 99, {size:10, color:"#cfe7db"});

    box(margin, 153, body, 68, "#ffffff", rule);
    text("ESTUDIANTE", margin+14, 173, {size:9, color:muted, weight:"bold"});
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14);
    const studentLines = pdf.splitTextToSize(clean(student) || "Estudiante", body-222).slice(0,2);
    studentLines.forEach((line, i) => text(line, margin+14, 191+i*16, {size:14, weight:"bold"}));
    text("EMITIDO", width-margin-14, 173, {size:9, color:muted, weight:"bold", align:"right"});
    text(date, width-margin-14, 191, {size:10, align:"right"});

    metric(margin, 238, "RESULTADO NETO DEL PERÍODO", result(period.net), "Ganancias menos pérdidas", period.net < 0 ? negative : green);
    metric(margin+column+gap, 238, "SALDO REGISTRADO", amount(all.balance), "Capital y resultado acumulados", ink);

    section(margin, 350, "Capital y resultados del período", [
      ["Depósitos", amount(period.deposit)],
      ["Retiros", amount(period.withdrawal)],
      ["Ganancias", amount(period.gain)],
      ["Pérdidas", amount(period.loss)],
      ["Promedio por día operado", result(period.avgDaily)],
      ["Rendimiento sobre depósitos", pct(period.growth)]
    ]);
    section(margin+column+gap, 350, "Desempeño de trading", [
      ["Días operados", period.days],
      ["Winrate", pct(rate.winrate)],
      ["Ganadores / perdedores", rate.wins + " / " + rate.losses],
      ["Mejor día", result(extremes.best)],
      ["Peor día", result(extremes.worst)]
    ]);

    box(margin, 561, body, 80, light, rule);
    text("Cómo se calcula el saldo registrado", margin+14, 586, {size:12, color:green, weight:"bold"});
    text("Depósitos acumulados - retiros acumulados + resultado neto acumulado.", margin+14, 606, {size:10, color:muted});
    text("Los movimientos de capital se muestran aparte del rendimiento de trading.", margin+14, 622, {size:10, color:muted});

    pdf.setDrawColor(rule);
    pdf.line(margin, height-60, width-margin, height-60);
    text("OLON Society Academy", margin, height-41, {size:10, weight:"bold", color:green});
    text("Documento privado generado desde el portal", width-margin, height-41, {size:9, color:muted, align:"right"});
    return pdf.output("blob");
  }

  function prepare(Pdf, view, user){
    const config = reportViewConfig[view];
    const blob = createReport(Pdf, config, getSelectedReportRecords(), user.full_name || "Estudiante");
    const period = config.label.toLowerCase();
    const filename = "OLON-reporte-" + period + "-premium.pdf";
    const file = typeof File === "function" ? new File([blob], filename, {type:"application/pdf"}) : null;
    const url = URL.createObjectURL(blob);
    prepared = {url, file, owner:user.id};
    open.href = save.href = url;
    save.download = filename;
    share.hidden = true;
    try{ share.hidden = !(file && navigator.share && navigator.canShare?.({files:[file]})); }
    catch{ /* Download and open are still available. */ }
    options.hidden = false;
  }

  function download(){
    const user = currentUser;
    if(!user || isAdminUser(user)) return;
    if(recordsLoadedFor !== user.id){
      feedback("Espera a que se carguen tus registros y vuelve a tocar Descargar.", "error");
      return;
    }
    clearPrepared();
    const generation = request, view = currentReportView;
    const Pdf = window.jspdf?.jsPDF;
    try{
      if(Pdf){
        prepare(Pdf, view, user);
        feedback("PDF listo. También puedes abrirlo o compartirlo.");
        save.click();
        return;
      }
      feedback("Cargando el generador de PDF…");
      getLibrary().then(Library => {
        if(generation !== request || currentUser?.id !== user.id) return;
        prepare(Library, view, user);
        feedback("PDF listo. Toca Guardar PDF o Abrir PDF.");
      }).catch(() => {
        if(generation === request) feedback("No se pudo preparar el PDF. Vuelve a tocar Descargar Reporte Premium.", "error");
      });
    }catch(error){
      console.warn("No se pudo generar el reporte", error);
      feedback("No se pudo preparar el PDF. Vuelve a intentarlo.", "error");
    }
  }

  button.addEventListener("click", download);
  share.addEventListener("click", async () => {
    if(!prepared?.file || prepared.owner !== currentUser?.id) return;
    try{ await navigator.share({files:[prepared.file]}); }
    catch(error){
      if(error.name !== "AbortError") feedback("No se pudo compartir. Usa Guardar PDF o Abrir PDF.", "error");
    }
  });
  window.clearPreparedReportPDF = clearPrepared;
})();
