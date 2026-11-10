"use strict";

window.createInvoicePdf = async function createInvoicePdf(invoice, logoSource) {
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const pdf = await PDFDocument.create();
  pdf.setTitle("Factura " + invoice.number);
  pdf.setAuthor("OLON Society Academy");
  const [regular, strong, logo] = await Promise.all([
    pdf.embedFont(StandardFonts.Helvetica),
    pdf.embedFont(StandardFonts.HelveticaBold),
    pdf.embedPng(logoSource)
  ]);

  const width = 612;
  const height = 792;
  const left = 44;
  const right = width - left;
  const bodyWidth = right - left;
  const contentBottom = 728;
  const palette = {
    navy: "#101d2e",
    ink: "#182a40",
    muted: "#546477",
    line: "#dbe3eb",
    pale: "#f5f8fb",
    gold: "#bd934b",
    goldInk: "#755119",
    goldLight: "#f8eedb",
    credit: "#1f6045",
    danger: "#882c28",
    white: "#ffffff"
  };
  const colors = Object.fromEntries(Object.entries(palette).map(([name, hex]) => {
    const [r, g, b] = hex.slice(1).match(/../g).map(part => Number.parseInt(part, 16) / 255);
    return [name, rgb(r, g, b)];
  }));
  const characterSet = new Set(regular.getCharacterSet());
  const pendingImages = [];
  let measuringContext;
  let page;
  let cursor;

  function supportedByFont(value) {
    return Array.from(value).every(character => characterSet.has(character.codePointAt(0)));
  }

  function canvasFont(size, bold) {
    return (bold ? "700 " : "400 ") + size + "px system-ui, sans-serif";
  }

  function textWidth(value, size, bold) {
    if (supportedByFont(value)) {
      return (bold ? strong : regular).widthOfTextAtSize(value, size);
    }
    measuringContext ??= document.createElement("canvas").getContext("2d");
    measuringContext.font = canvasFont(size, bold);
    return measuringContext.measureText(value).width;
  }

  function write(value, x, top, { size = 11, bold = false, tone = "ink", align = "left" } = {}) {
    if (!value) return;
    const baseline = height - top - size;
    const measuredWidth = textWidth(value, size, bold);
    const start = align === "right" ? x - measuredWidth : x;
    if (supportedByFont(value)) {
      page.drawText(value, { x: start, y: baseline, size, font: bold ? strong : regular, color: colors[tone] });
      return;
    }

    // Keep customer-entered glyphs outside the PDF font visible with the browser's fonts.
    const canvas = document.createElement("canvas");
    const imageWidth = Math.ceil(measuredWidth + 6);
    const imageHeight = Math.ceil(size * 1.65 + 4);
    const scale = 3;
    canvas.width = imageWidth * scale;
    canvas.height = imageHeight * scale;
    const context = canvas.getContext("2d");
    context.scale(scale, scale);
    context.font = canvasFont(size, bold);
    context.fillStyle = palette[tone];
    context.fillText(value, 3, size + 3);
    const targetPage = page;
    pendingImages.push(pdf.embedPng(canvas.toDataURL("image/png")).then(image => {
      targetPage.drawImage(image, {
        x: start - 3,
        y: baseline + size + 3 - imageHeight,
        width: imageWidth,
        height: imageHeight
      });
    }));
  }

  function wrap(value, maxWidth, size, bold = false) {
    const lines = [];
    const paragraphs = value.normalize("NFC").replace(/\t/g, "    ").split(/\r\n?|\n/);
    for (const paragraph of paragraphs) {
      let line = "";
      for (const token of paragraph.match(/\S+|\s+/gu) ?? []) {
        if (textWidth(line + token, size, bold) <= maxWidth) {
          line += token;
          continue;
        }
        if (line.trimEnd()) lines.push(line.trimEnd());
        line = "";
        // Long links and names also need to wrap when they have no spaces.
        for (const character of token.trimStart()) {
          if (line && textWidth(line + character, size, bold) > maxWidth) {
            lines.push(line);
            line = "";
          }
          line += character;
        }
      }
      lines.push(line.trimEnd());
    }
    return lines;
  }

  function rectangle(x, top, rectWidth, rectHeight, tone) {
    page.drawRectangle({ x, y: height - top - rectHeight, width: rectWidth, height: rectHeight, color: colors[tone] });
  }

  function rule(x, top, ruleWidth) {
    rectangle(x, top, ruleWidth, 0.7, "line");
  }

  function addPage() {
    page = pdf.addPage([width, height]);
    rectangle(left, 42, bodyWidth, 3, "gold");
    const logoHeight = 49;
    page.drawImage(logo, {
      x: left, y: height - 56 - logoHeight, width: logo.width * logoHeight / logo.height, height: logoHeight
    });
    write("OLON SOCIETY ACADEMY", left + 59, 66, { size: 10, bold: true });
    write("Educación · Trading · Mentoría", left + 59, 82, { size: 9, tone: "muted" });
    write("Factura", right, 56, { size: 26, bold: true, align: "right" });
    write(invoice.number, right, 89, { size: 10, bold: true, tone: "goldInk", align: "right" });
    rule(left, 116, bodyWidth);
    cursor = 132;
  }

  function textSection(label, values) {
    const lines = values.filter(Boolean).flatMap(value => wrap(value, bodyWidth, 10.5));
    if (!lines.length) return;
    cursor += 18;
    if (cursor + 32 > contentBottom) addPage();
    rule(left, cursor, bodyWidth);
    write(label, left, cursor + 8, { size: 9, bold: true, tone: "muted" });
    cursor += 24;
    for (const line of lines) {
      if (cursor + 15 > contentBottom) {
        addPage();
        write(label + " (continuación)", left, cursor, { size: 9, bold: true, tone: "muted" });
        cursor += 17;
      }
      write(line, left, cursor, { size: 10.5 });
      cursor += 15;
    }
  }

  addPage();

  const clientWidth = bodyWidth - 176;
  const clientLines = wrap(invoice.client, clientWidth - 16, 13, true);
  const detailLines = invoice.detail ? wrap(invoice.detail, clientWidth - 16, 9.5) : [];
  const dates = [["Emisión", invoice.issueDate]];
  if (invoice.dueDate) dates.push(["Vencimiento", invoice.dueDate]);
  const clientHeight = Math.max(62, 34 + clientLines.length * 16 + detailLines.length * 13, 27 + dates.length * 16);
  rectangle(left, cursor, bodyWidth, clientHeight, "pale");
  write("FACTURAR A", left + 13, cursor + 10, { size: 8.5, bold: true, tone: "muted" });
  let clientTop = cursor + 25;
  for (const line of clientLines) {
    write(line, left + 13, clientTop, { size: 13, bold: true });
    clientTop += 16;
  }
  for (const line of detailLines) {
    write(line, left + 13, clientTop, { size: 9.5, tone: "muted" });
    clientTop += 13;
  }
  let dateTop = cursor + 11;
  const statusTone = { pending: "goldInk", paid: "credit", cancelled: "danger" }[invoice.status];
  for (const [label, value] of dates) {
    write(label, right - 143, dateTop, { size: 9, tone: "muted" });
    write(value, right - 13, dateTop, { size: 9, bold: true, align: "right" });
    dateTop += 16;
  }
  write("Estado", right - 143, dateTop, { size: 9, tone: "muted" });
  write(invoice.statusLabel, right - 13, dateTop, { size: 9, bold: true, tone: statusTone, align: "right" });
  cursor += clientHeight + 23;

  write("Detalle de servicios", left, cursor, { size: 12, bold: true });
  write("Moneda USD", right, cursor + 3, { size: 9, tone: "muted", align: "right" });
  cursor += 22;
  rectangle(left, cursor, bodyWidth, 24, "navy");
  write("Descripción", left + 10, cursor + 6, { size: 9, bold: true, tone: "white" });
  write("Importe", right - 10, cursor + 6, { size: 9, bold: true, tone: "white", align: "right" });
  cursor += 24;

  const items = [{ label: invoice.service, value: invoice.regularPrice, tone: "ink" }];
  if (invoice.hasDiscount) {
    items.push({ label: invoice.discountLabel, detail: invoice.discountDetail, value: invoice.discountValue, tone: "credit" });
  }
  if (invoice.benefit) {
    items.push({ label: invoice.benefit, detail: "Valor de referencia " + invoice.benefitValue, value: "Incluido", tone: "goldInk" });
  }
  for (const item of items) {
    const labelLines = wrap(item.label, bodyWidth - 116, 10.5, true);
    const detail = item.detail ? wrap(item.detail, bodyWidth - 116, 9) : [];
    const rowHeight = 15 + labelLines.length * 14 + detail.length * 12;
    write(item.value, right - 10, cursor + 7, { size: 10.5, bold: true, tone: item.tone, align: "right" });
    let lineTop = cursor + 7;
    for (const line of labelLines) {
      write(line, left + 10, lineTop, { size: 10.5, bold: true });
      lineTop += 14;
    }
    for (const line of detail) {
      write(line, left + 10, lineTop, { size: 9, tone: "muted" });
      lineTop += 12;
    }
    cursor += rowHeight;
    rule(left, cursor, bodyWidth);
  }

  cursor += 15;
  const totalLeft = right - 230;
  write("Precio regular", totalLeft + 10, cursor, { size: 10 });
  write(invoice.regularPrice, right - 10, cursor, { size: 10, bold: true, align: "right" });
  cursor += 17;
  if (invoice.hasDiscount) {
    write("Descuento", totalLeft + 10, cursor, { size: 10 });
    write(invoice.discountValue, right - 10, cursor, { size: 10, bold: true, tone: "credit", align: "right" });
    cursor += 17;
  }
  rectangle(totalLeft, cursor, 230, 33, "goldLight");
  write("Total a pagar", totalLeft + 10, cursor + 10, { size: 10, bold: true });
  write(invoice.total, right - 10, cursor + 7, { size: 15, bold: true, align: "right" });
  cursor += 33;

  if(invoice.installment){
    const payment=invoice.installment;
    textSection("Reserva de clase · Abonos",[
      "Total abonado: "+payment.received,
      "Saldo pendiente: "+payment.balance,
      "Estado: "+invoice.statusLabel
    ]);
    if(payment.payments?.length){
      const rows=payment.payments.map(p=>{
        const amount=(Number(p.amount_cents)/100).toLocaleString("en-US",{style:"currency",currency:"USD"});
        return p.paid_on+" · "+p.method+" · "+amount+(p.reference?" · Ref. "+p.reference:"");
      });
      textSection("Historial de abonos",rows);
    }
  }
  textSection("Métodos de pago", [invoice.methods, invoice.paymentDetails]);
  textSection("Notas", [invoice.notes]);

  const pages = pdf.getPages();
  for (const [index, current] of pages.entries()) {
    page = current;
    rule(left, 746, bodyWidth);
    write("OLON Society Academy", left, 754, { size: 8.5, bold: true });
    const footer = pages.length === 1 ? "Gracias por tu confianza" : "Página " + (index + 1) + " de " + pages.length;
    write(footer, right, 754, { size: 8.5, tone: "muted", align: "right" });
  }

  await Promise.all(pendingImages);
  return pdf.save();
};
