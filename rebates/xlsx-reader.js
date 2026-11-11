/* Read-only XLSX import. JSZip 3.10.1; formulas and macros are never executed. */
(() => {
  "use strict";
  const MAX_ROWS = 5000;
  const norm = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
  const headers = {
    referral_id:["Referral ID","Referido ID","Reffered by","Referred by"], customer_id:["Customer ID","Client ID","Cliente ID","A/C Number","Account Number"],
    customer_name:["Customer Name","Client Name","Nombre del cliente","Cliente"],
    account_name:["A/C Name","Account Name","Nombre de cuenta","Referral Name"],
    order_id:["Order ID","Order","Ticket","Orden ID"],
    close_time:["Close Time","Close Date","Fecha de cierre"],
    open_time:["Open Time","Open Date","Fecha de apertura"],
    lots:["Size","Lots","Lotaje","Volume (lots)","Volumen (lotes)"],
    symbol:["Symbol","Símbolo","Instrumento"], side:["Type","Side","Tipo"],
    rebate:["Rebate Earnings","Rebates Generated","Rebates","Rebates generados"],
    rebate_id:["Rebate ID"], wallet_id:["Rebate Wallet ID","Wallet ID"],
    currency:["Rebate Wallet","Rebate Currency","Currency","Moneda"], platform:["Platform","Trading Platform","Plataforma"],
    settlement_status:["Settlement Status"], settlement_reference:["Settlement Reference Number"], profit:["Profit"]
  };
  const aliases = Object.fromEntries(Object.entries(headers).map(([key,list]) => [key,list.map(norm)]));
  function xml(text,component="componente interno") {
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw Error("El Excel contiene XML no compatible en " + component + ".");
    const doc = new DOMParser().parseFromString(text.replace(/^\uFEFF/,""),"application/xml");
    const parserError = doc.getElementsByTagName("parsererror")[0];
    if (parserError) {
      const details = (parserError.textContent || "").trim().replace(/\s+/g," ").slice(0,200);
      throw Error("No se pudo interpretar " + component + " del Excel. " + details + " Exporta nuevamente el reporte original desde Axi.");
    }
    return doc;
  }
  const nodes = (parent,name) => Array.from(parent.getElementsByTagNameNS("*",name));
  function zipLimits(buffer) {
    const view = new DataView(buffer);
    let end = -1;
    for (let i = buffer.byteLength - 22; i >= Math.max(0,buffer.byteLength - 65557); i--) {
      if (view.getUint32(i,true) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw Error("Selecciona un archivo Excel .xlsx válido.");
    const count = view.getUint16(end + 10,true);
    let cursor = view.getUint32(end + 16,true), total = 0;
    if (count > 256 || count === 65535) throw Error("El Excel tiene demasiadas hojas o archivos internos.");
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > buffer.byteLength || view.getUint32(cursor,true) !== 0x02014b50) throw Error("El archivo Excel está incompleto.");
      const unpacked = view.getUint32(cursor + 24,true);
      total += unpacked;
      if (unpacked > 16 * 1024 * 1024 || total > 32 * 1024 * 1024) throw Error("Este Excel es demasiado grande. Exporta un período más corto.");
      cursor += 46 + view.getUint16(cursor + 28,true) + view.getUint16(cursor + 30,true) + view.getUint16(cursor + 32,true);
    }
  }
  function decimal(value,label,negative=false) {
    // Axi Settled commonly exports seven decimal places (e.g. 0.3600000).
    // Extra zeroes are formatting, not additional precision: remove them
    // losslessly before mapping to the database's six-decimal NUMERIC fields.
    let text=String(value ?? "").trim().replace(/\s/g,"");
    if (/^-?\d+,\d{1,12}$/.test(text)) text=text.replace(",",".");
    const pattern=negative ? /^-?\d{1,9}(?:\.\d{1,12})?$/ : /^\d{1,9}(?:\.\d{1,12})?$/;
    if (!pattern.test(text)) throw Error(label+": formato numérico no válido.");
    const sign=text.startsWith("-")?"-":"";
    const [whole,rawFraction=""]=text.replace(/^-/,"").split(".");
    const precision=rawFraction.replace(/0+$/,"");
    if (precision.length>6) throw Error(label+": el valor tiene más de seis decimales significativos y no se puede importar sin redondearlo.");
    const digits=String(BigInt(whole));
    const frac=precision.padEnd(6,"0");
    return (sign==="-" && (digits!=="0"||precision!=="" ) ? "-" : "") + digits + "." + frac;
  }
  function date(value,date1904) {
    const text = String(value ?? "").trim();
    let result;
    if (/^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/.test(text)) result = text.slice(0,10);
    else if (/^\d{1,5}(?:\.\d+)?$/.test(text)) {
      const epoch = date1904 ? Date.UTC(1904,0,1) : Date.UTC(1899,11,30);
      result = new Date(epoch + Math.floor(Number(text)) * 86400000).toISOString().slice(0,10);
    } else {
      const m = text.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})(?:\s|$)/);
      const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
      if (m && months.includes(m[2].slice(0,3).toLowerCase())) result = m[3]+"-"+String(months.indexOf(m[2].slice(0,3).toLowerCase())+1).padStart(2,"0")+"-"+m[1].padStart(2,"0");
    }
    if (!result || result < "2000-01-01" || result > "2100-12-31" || new Date(result+"T00:00:00Z").toISOString().slice(0,10) !== result) throw Error("Fecha de operación no válida. Conserva las fechas originales del reporte.");
    return result;
  }
  function column(reference) {
    const letters = String(reference || "").match(/^[A-Z]+/i)?.[0];
    if (!letters) throw Error("El Excel contiene una referencia de celda no válida.");
    let result = 0;
    for (const char of letters.toUpperCase()) result = result * 26 + char.charCodeAt(0) - 64;
    if (result > 256) throw Error("Este formato de Excel contiene demasiadas columnas.");
    return result - 1;
  }
  async function read(file) {
    if (!/\.xlsx$/i.test(file.name)) throw Error("Selecciona un Excel .xlsx. Si tienes un .xls, guárdalo como .xlsx.");
    if (!file.size || file.size > 10 * 1024 * 1024) throw Error("El archivo debe pesar entre 1 byte y 10 MB.");
    if (!window.JSZip) throw Error("No cargó el lector de Excel. Actualiza el portal e inténtalo de nuevo.");
    const buffer = await file.arrayBuffer();
    zipLimits(buffer);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",buffer))).map(value => value.toString(16).padStart(2,"0")).join("");
    let zip;
    try { zip = await window.JSZip.loadAsync(buffer,{checkCRC32:true}); }
    catch { throw Error("No se pudo leer el Excel. Comprueba que no esté dañado ni protegido con contraseña."); }
    const readXml = async path => {
      const entry = zip.file(path);
      if (!entry) throw Error("Falta una hoja o componente del Excel.");
      return xml(await entry.async("string"),path);
    };
    const workbook = await readXml("xl/workbook.xml");
    const relationships = await readXml("xl/_rels/workbook.xml.rels");
    const date1904 = ["1","true"].includes(nodes(workbook,"workbookPr")[0]?.getAttribute("date1904"));
    const rels = new Map(nodes(relationships,"Relationship").filter(rel => rel.getAttribute("TargetMode") !== "External").map(rel => [rel.getAttribute("Id"),rel.getAttribute("Target")]));
    const sharedFile = zip.file("xl/sharedStrings.xml");
    const shared = sharedFile ? nodes(xml(await sharedFile.async("string"),"xl/sharedStrings.xml"),"si").map(si => nodes(si,"t").map(t => t.textContent).join("")) : [];
    const result = [], sheets = [], warnings = [];
    let matched = false, skippedTotals = 0, fallbackDates = 0, settledRows = 0;
    const settlements = new Set();
    for (const sheet of nodes(workbook,"sheet")) {
      const rel = sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships","id") || sheet.getAttribute("r:id");
      let target = rels.get(rel);
      if (!target) continue;
      target = target.startsWith("/") ? target.slice(1) : "xl/" + target;
      const safeParts = [];
      for (const part of target.split("/")) { if (part === "..") safeParts.pop(); else if (part && part !== ".") safeParts.push(part); }
      const doc = await readXml(safeParts.join("/"));
      const grid = nodes(doc,"row").map(row => {
        const cells = [];
        for (const cell of Array.from(row.children).filter(item => item.localName === "c")) {
          const type = cell.getAttribute("t");
          const raw = nodes(cell,"v")[0]?.textContent ?? "";
          cells[column(cell.getAttribute("r"))] = type === "s" ? shared[Number(raw)] ?? "" : type === "inlineStr" ? nodes(cell,"t").map(t => t.textContent).join("") : raw;
        }
        return {number:Number(row.getAttribute("r")),cells};
      });
      let headerIndex = -1, mapping;
      for (let i = 0; i < Math.min(30,grid.length); i++) {
        const names = grid[i].cells.map(norm), map = {};
        for (const [key,list] of Object.entries(aliases)) map[key] = names.findIndex(name => list.includes(name));
        if (["order_id","customer_id","lots","rebate","currency"].every(key => map[key] >= 0) && (map.close_time >= 0 || map.open_time >= 0)) { headerIndex = i; mapping = map; break; }
      }
      if (headerIndex < 0) continue;
      matched = true; sheets.push(sheet.getAttribute("name") || "Hoja");
      for (const row of grid.slice(headerIndex + 1)) {
        if (!row.cells.some(value => String(value ?? "").trim())) continue;
        const get = key => String(row.cells[mapping[key]] ?? "").trim();
        if (!get("order_id") && row.cells.some(value => /^(grandtotal|total|totales|subtotal)$/.test(norm(value)))) { skippedTotals++; continue; }
        const location = (sheet.getAttribute("name") || "Hoja") + ", fila " + row.number;
        try {
          const id = (key,fallback="") => {
            const value = get(key) || fallback;
            if (!/^\d{1,40}$/.test(value)) throw Error("Falta o no es válido el identificador " + (headers[key]?.[0] || key) + ".");
            return String(BigInt(value));
          };
          const platform = (get("platform") || "REPORT").toUpperCase();
          if (!/^[A-Z0-9._-]{1,16}$/.test(platform)) throw Error("Plataforma no válida.");
          const currency = get("currency").toUpperCase();
          if (!/^[A-Z]{3}$/.test(currency)) throw Error("La moneda debe ser un código como USD.");
          const sideValue = norm(get("side"));
          const side = ({buy:"buy",sell:"sell",compra:"buy",venta:"sell"})[sideValue] || "unspecified";
          const closeDate = get("close_time"), openDate = get("open_time");
          if (!closeDate && openDate) fallbackDates++;
          if (get("settlement_status")) {
            const status=norm(get("settlement_status"));
            if(status !== "paid" && status !== "settled") throw Error("Estado de liquidación no compatible: "+get("settlement_status"));
            settledRows++;
            const ref=get("settlement_reference");
            if(ref) settlements.add(ref);
          }
          result.push({
            platform, referral_id:id("referral_id","0"), customer_id:id("customer_id"),
            customer_name:(get("customer_name") || get("account_name") || "Cliente " + id("customer_id")).slice(0,160),
            account_name:get("account_name").slice(0,160), order_id:id("order_id"), rebate_id:id("rebate_id","0"),
            wallet_id:id("wallet_id","0"), symbol:(get("symbol") || "SIN SÍMBOLO").toUpperCase().slice(0,40), side,
            trade_date:date(closeDate || openDate,date1904), lots:decimal(get("lots"),"Lotaje"),
            rebate:decimal(get("rebate"),"Rebates",true), currency
          });
        } catch (error) { throw Error(location + ": " + error.message); }
        if (result.length > MAX_ROWS) throw Error("El archivo supera 5,000 registros. Exporta un período más corto.");
      }
    }
    if (!matched) throw Error("No encontré las columnas del reporte. Se necesitan Order ID, Customer ID, Size/Lots, Rebate Earnings, moneda y fecha de cierre o apertura.");
    if (!result.length) throw Error("El reporte no contiene registros para importar.");
    if (skippedTotals) warnings.push(skippedTotals + " fila(s) de totales omitidas para evitar contarlas dos veces.");
    if (fallbackDates) warnings.push(fallbackDates + " registro(s) usan la fecha de apertura porque no tienen fecha de cierre.");
    if(settledRows) warnings.push("Reporte Settled de Axi: "+settledRows+" operaciones liquidadas; "+settlements.size+" referencias de liquidación. Los rebates son comisiones, no las ganancias o pérdidas de los trades.");
    const periods=Array.from(new Set(result.map(r=>r.trade_date.slice(0,7)))).sort();
    return {rows:result,hash,name:file.name,sheets,warnings,periods,kind:settledRows?"settled":"unsettled"};
  }
  window.olonRebateReader = {read};
})();
