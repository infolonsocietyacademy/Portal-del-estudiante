(() => {
  "use strict";

  const byId = id => document.getElementById(id);
  const form = byId("ledgerForm");
  const storageKey = "olon_registros_pendientes_v1";
  const kinds = {
    trading: { title:"Registrar resultado de trading", save:"Guardar resultado", hint:"Registra una operación cerrada o el resumen de un día." },
    deposit: { title:"Registrar depósito", save:"Guardar depósito", hint:"Añade al registro el capital que depositaste." },
    withdrawal: { title:"Registrar retiro", save:"Guardar retiro", hint:"Anota cuánto capital retiraste." }
  };
  let mode = "trading", editing = null, busy = false;
  const core = window.olonAnalyticsCore;
  const tradeFields = {tradeInstrument:"trade_instrument",tradeStrategy:"trade_strategy",tradeSide:"trade_side",tradeRisk:"trade_risk",tradeTime:"trade_time",tradeSession:"trade_session"};

  function studentId(){
    return currentUser && !isAdminUser(currentUser) ? currentUser.id : null;
  }

  function today(){
    return core.today();
  }

  function notice(id, message, tone = ""){
    const box = byId(id);
    box.textContent = message;
    box.dataset.tone = tone;
    box.hidden = !message;
  }

  function syncButton(){
    const button = byId("olonSaveRecordBtn");
    button.disabled = busy;
    byId("ledgerCancelEdit").disabled = busy;
    button.textContent = busy ? "Guardando…" : editing ? "Guardar cambios" : kinds[mode].save;
  }

  function setMode(kind, record = null){
    mode = kind;
    editing = record;
    byId("ledgerEntryTitle").textContent = record ? "Editar registro" : kinds[kind].title;
    byId("ledgerEntryIntro").textContent = record ? "Corrige los datos de este registro." : kinds[kind].hint;
    byId("ledgerModes").hidden = Boolean(record);
    byId("ledgerDepositField").hidden = kind !== "deposit" && !(kind === "legacy" && record?.deposit);
    byId("ledgerWithdrawalField").hidden = kind !== "withdrawal";
    byId("ledgerTradingFields").hidden = kind !== "trading" && !(kind === "legacy" && isTradingRecord(record));
    byId("tradeEntryScope").value = record?.entry_scope || "trade";
    if(record && !record.entry_scope) byId("tradeEntryScope").value = "daily";
    syncScope();
    byId("ledgerCancelEdit").hidden = !record;
    for(const button of document.querySelectorAll("[data-record-kind]")){
      button.setAttribute("aria-pressed", String(button.dataset.recordKind === kind));
    }
    notice("olonRecordStatus", "");
    syncButton();
  }

  function syncScope(){
    const trading = !byId("ledgerTradingFields").hidden;
    const operation = trading && byId("tradeEntryScope").value === "trade";
    byId("tradeScopeField").hidden = !trading;
    byId("tradeOperationFields").hidden = !operation;
    byId("tradeOperationFields").disabled = !operation;
    byId("ledgerTradingDetails").hidden = !trading || operation || Boolean(editing);
    byId("tradeGainLabel").textContent = operation ? "Ganancia neta de la operación" : "Ganancias netas del día";
    byId("tradeLossLabel").textContent = operation ? "Pérdida neta de la operación" : "Pérdidas netas del día";
    byId("tradeScopeHint").textContent = operation
      ? "Una operación cerrada por registro. Incluye los cierres parciales en su resultado final. El riesgo inicial permite calcular R."
      : "El resumen conserva tus resultados diarios. No se incluye como una operación en el Win Rate ni debe duplicarse con los trades de esa fecha.";
  }

  function reset(kind = "trading"){
    form.reset();
    byId("date").value = today();
    byId("date").max = today();
    byId("ledgerTradingDetails").open = false;
    setMode(kind);
  }

  function amount(id, label){
    const input = byId(id);
    const value = Number(input.value || 0);
    if(input.validity.badInput || input.validity.rangeOverflow || input.validity.stepMismatch || !Number.isFinite(value) || value < 0){
      throw new Error("Escribe un importe válido en " + label + ".");
    }
    return value;
  }

  function fieldsForRecord(){
    const date = byId("date");
    if(!date.value || !date.validity.valid || !core.validDate(date.value) || date.value > today()) throw new Error("Selecciona una fecha válida hasta el día de hoy.");
    const deposit = byId("ledgerDepositField").hidden ? 0 : amount("deposit", "Depósito");
    const withdrawal = mode === "withdrawal" ? amount("withdrawal", "Retiro") : 0;
    const trades = !byId("ledgerTradingFields").hidden;
    const gain = trades ? amount("gain", "Ganancia") : 0;
    const loss = trades ? amount("loss", "Pérdida") : 0;
    const entry_scope = trades ? byId("tradeEntryScope").value : "daily";
    const operation = trades && entry_scope === "trade";
    const note = mode === "trading" && !editing && !operation ? buildJournalNote() : byId("note").value.trim();
    if((mode === "deposit" || (mode === "legacy" && !trades)) && deposit <= 0) throw new Error("El depósito debe ser mayor que $0.");
    if(mode === "withdrawal" && withdrawal <= 0) throw new Error("El retiro debe ser mayor que $0.");
    if(trades && !byId("gain").value && !byId("loss").value){
      throw new Error("Anota la ganancia, la pérdida o escribe 0 para un break even.");
    }
    if(note.length > 8000) throw new Error("La nota no puede exceder 8,000 caracteres.");
    if(operation && gain>0 && loss>0) throw new Error("Para una operación, escribe una ganancia o una pérdida neta; usa el resultado final después de sus cierres parciales y costos.");
    if(operation && deposit>0) throw new Error("Este registro combina capital con un resultado antiguo. Conserva el resumen diario y registra el capital por separado antes de convertirlo en una operación.");
    const metadata = Object.fromEntries(Object.values(tradeFields).map(key=>[key,null]));
    if(operation){
      metadata.trade_instrument = core.key(byId("tradeInstrument").value);
      if(!metadata.trade_instrument || metadata.trade_instrument.length>32) throw new Error("Indica el activo de esta operación (hasta 32 caracteres).");
      metadata.trade_strategy = core.key(byId("tradeStrategy").value) || null;
      if(metadata.trade_strategy?.length>60) throw new Error("La estrategia no puede exceder 60 caracteres.");
      metadata.trade_side = byId("tradeSide").value || null;
      metadata.trade_session = byId("tradeSession").value || null;
      metadata.trade_time = byId("tradeTime").value || null;
      if(metadata.trade_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(metadata.trade_time)) throw new Error("Indica una hora de entrada válida en Puerto Rico.");
      if(byId("tradeRisk").value){
        metadata.trade_risk = amount("tradeRisk","Riesgo inicial");
        if(metadata.trade_risk<=0) throw new Error("El riesgo inicial debe ser mayor que 0. Puedes dejarlo vacío si no lo conoces.");
      }
    }
    if(trades && cachedRecords.some(r=>r.id!==editing?.id && r.date===date.value && isTradingRecord(r) && (r.entry_scope || "daily")!==entry_scope)){
      throw new Error("Esta fecha ya tiene "+(operation ? "un resumen diario" : "operaciones individuales")+". Edita esos registros antes de cambiar el tipo para evitar contar resultados dos veces.");
    }
    const storedNote=core.encodeNote(note,{entry_scope,...metadata});
    if(storedNote.length>8000) throw new Error("Acorta la nota para guardar los detalles de la operación (máximo 8,000 caracteres en total).");
    return {record_date:date.value, deposit, withdrawal, gain, loss, note:storedNote};
  }

  function readQueue(){
    try{
      const queue = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return Array.isArray(queue) ? queue.filter(item => item?.record && item?.studentId) : [];
    }catch{ return []; }
  }

  function writeQueue(queue){
    try{
      localStorage.setItem(storageKey, JSON.stringify(queue));
      return true;
    }catch{ return false; }
  }

  function sameRecord(a, b){
    return a.record_date === b.record_date && (a.record_kind ?? null) === (b.record_kind ?? null)
      && ["deposit", "withdrawal", "gain", "loss"].every(key => Number(a[key] ?? 0) === Number(b[key] ?? 0))
      && (a.note ?? "") === (b.note ?? "");
  }

  function renderQueue(){
    const box = byId("olonPendingQueue");
    const items = readQueue().filter(item => item.studentId === studentId());
    box.hidden = !items.length;
    box.replaceChildren();
    if(!items.length) return;

    const title = document.createElement("strong");
    title.textContent = "Pendientes de sincronizar (" + items.length + ")";
    const description = document.createElement("p");
    description.textContent = "Estos registros se guardaron en este dispositivo. Toca Reintentar cuando tengas conexión.";
    box.append(title, description);
    for(const item of items){
      const row = document.createElement("div");
      row.className = "ledgerPendingRow";
      const label = document.createElement("span");
      const {record} = item;
      const amounts = [];
      if(record.deposit) amounts.push("Depósito " + money(record.deposit));
      if(record.withdrawal) amounts.push("Retiro " + money(record.withdrawal));
      if(record.record_kind === "trading" || record.gain || record.loss){
        amounts.push("Resultado " + signedTradeMoney(netAmount(Number(record.gain || 0), Number(record.loss || 0))));
      }
      label.textContent = [record.record_date, ...amounts].join(" · ");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn secondary";
      button.disabled = busy;
      button.textContent = "Reintentar";
      button.addEventListener("click", () => retry(item));
      row.append(label, button);
      box.append(row);
    }
  }

  async function findRecord(id, owner){
    const {data, error} = await supabaseClient.from("student_records").select("*")
      .eq("id", id).eq("student_id", owner).maybeSingle();
    if(error) throw error;
    return data;
  }

  async function insert(record){
    const {error} = await supabaseClient.from("student_records").insert(record);
    if(!error) return;
    // An earlier attempt may have reached the server even if its response was lost.
    if(error.code === "23505"){
      const remote = await findRecord(record.id, record.student_id);
      if(remote && sameRecord(remote,record)) return;
    }
    throw error;
  }

  async function update(record, owner, fields){
    const {data, error} = await supabaseClient.from("student_records").update(fields)
      .eq("id", record.id).eq("student_id", owner).eq("revision", record.revision)
      .select("id").maybeSingle();
    if(error) throw error;
    if(data) return true;
    const latest = await findRecord(record.id, owner);
    return Boolean(latest && sameRecord(latest, {...fields, record_kind:record.kind}));
  }

  async function refresh(){
    try{ await window.render(); }
    catch(error){ console.warn("No se pudo actualizar el resumen", error); }
  }

  async function save(event){
    event.preventDefault();
    const owner = studentId();
    if(!owner || busy) return;
    let fields;
    try{ fields = fieldsForRecord(); }
    catch(error){ notice("olonRecordStatus", error.message, "error"); return; }

    const previous = editing;
    const record = previous ? null : {...fields, id:crypto.randomUUID(), student_id:owner, record_kind:mode};
    if(record && readQueue().some(item => item.studentId === owner && sameRecord(item.record, record))){
      notice("olonRecordStatus", "Ese registro ya está pendiente. Toca Reintentar para sincronizarlo.", "error");
      renderQueue();
      return;
    }

    busy = true;
    syncButton();
    notice("olonRecordStatus", "Guardando registro…");
    try{
      if(previous){
        if(!await update(previous, owner, fields)){
          notice("olonRecordStatus", "Este registro cambió en otra sesión. Vuelve al historial y ábrelo de nuevo.", "error");
          await refresh();
          return;
        }
      }else await insert(record);

      if(studentId() !== owner) return;
      await refresh();
      if(studentId() !== owner) return;
      // Refresh TOP 3 immediately after a confirmed trade/deposit update.
      window.olonLeaderboardRefresh?.();
      const target = previous ? "historial" : "dashboard";
      const message = previous ? "Cambios guardados." : kinds[mode].save.replace("Guardar ", "") + " guardado.";
      reset();
      notice(previous ? "ledgerHistoryNotice" : "ledgerNotice", message.charAt(0).toUpperCase() + message.slice(1), "success");
      window.showPageById(target);
    }catch(error){
      console.warn("Registro sin confirmación", error.code || error.name);
      if(["23514","23502","22001","22003","22P02","42501"].includes(error.code)){
        notice("olonRecordStatus",error.message?.includes("OLON_MIXED_SCOPES")
          ? "Esta fecha ya tiene otro tipo de resultado. Usa operaciones individuales o un resumen diario para evitar duplicados."
          : "No se guardó el registro. Revisa sus datos y tu acceso al portal antes de volver a intentar.","error");
      }else if(previous){
        notice("olonRecordStatus", "No se pudo confirmar la edición. Verifica tu conexión y vuelve a guardar.", "error");
      }else{
        const queue = readQueue();
        if(!queue.some(item => item.localId === record.id)) queue.push({localId:record.id, studentId:owner, record});
        const saved = writeQueue(queue);
        notice("olonRecordStatus", saved
          ? "El registro está pendiente en este dispositivo. Usa Reintentar para sincronizarlo."
          : "No se pudo guardar el registro. Conserva el formulario abierto y vuelve a intentar.", "error");
      }
    }finally{
      busy = false;
      syncButton();
      renderQueue();
    }
  }

  async function retry(item){
    const owner = studentId();
    if(busy || !owner || owner !== item.studentId || owner !== item.record.student_id) return;
    busy = true;
    syncButton();
    renderQueue();
    notice("olonRecordStatus", "Sincronizando registro…");
    try{
      let record = item.record;
      if(!record.id){
        // Older queued drafts had no database ID. Check whether they reached the server before assigning one.
        const {data, error} = await supabaseClient.from("student_records").select("*")
          .eq("student_id", owner).eq("record_date", record.record_date).is("record_kind", null);
        if(error) throw error;
        if(!(data || []).some(remote => sameRecord(remote, record))){
          const id = /^[0-9a-f-]{36}$/i.test(item.localId) ? item.localId : crypto.randomUUID();
          record = {...record, id};
          const next = readQueue().map(queued => queued.localId === item.localId ? {...queued, record} : queued);
          if(!writeQueue(next)) throw new Error("queue");
        }
      }
      if(record.id) await insert(record);
      if(!writeQueue(readQueue().filter(queued => queued.localId !== item.localId))) throw new Error("queue");
      if(studentId() === owner){
        notice("olonRecordStatus", "Registro sincronizado.", "success");
        await refresh();
      }
    }catch{
      notice("olonRecordStatus", "El registro sigue pendiente. Verifica tu conexión y vuelve a intentar.", "error");
    }finally{
      busy = false;
      syncButton();
      renderQueue();
    }
  }

  form.addEventListener("submit", save);
  byId("tradeEntryScope").addEventListener("change",syncScope);
  byId("ledgerModes").addEventListener("click", event => {
    const kind = event.target.closest("[data-record-kind]")?.dataset.recordKind;
    if(!busy && kinds[kind]) setMode(kind);
  });
  byId("ledgerCancelEdit").addEventListener("click", () => {
    reset();
    window.showPageById("historial");
  });
  document.addEventListener("click", event => {
    const open = event.target.closest("[data-record-open]")?.dataset.recordOpen;
    const editId = event.target.closest("[data-record-edit]")?.dataset.recordEdit;
    const deleteId = event.target.closest("[data-record-delete]")?.dataset.recordDelete;
    if(open && !busy && studentId()){
      notice("ledgerNotice", "");
      reset(open);
      window.showPageById("registro");
      renderQueue();
    }
    if(editId && !busy && studentId()){
      const record = cachedRecords.find(item => item.id === editId);
      if(!record) return;
      reset();
      setMode(record.kind || "legacy", record);
      byId("date").value = record.date;
      for(const key of ["deposit", "withdrawal", "gain", "loss", "note"]){
        byId(key).value = record[key];
      }
      for(const [id,key] of Object.entries(tradeFields)) byId(id).value = key === "trade_time" ? String(record[key] || "").slice(0,5) : record[key] ?? "";
      notice("ledgerHistoryNotice", "");
      window.showPageById("registro");
      renderQueue();
    }
    if(deleteId && !busy && studentId()){
      void delRecord(deleteId);
    }
    if(event.target.closest('[data-page="registro"]')) renderQueue();
  });
  window.addEventListener("storage", event => { if(event.key === storageKey) renderQueue(); });
  window.addEventListener("online", renderQueue);
  document.addEventListener("visibilitychange", () => { if(!document.hidden) renderQueue(); });
  reset();
})();
