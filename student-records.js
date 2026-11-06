(() => {
  "use strict";

  const byId = id => document.getElementById(id);
  const form = byId("ledgerForm");
  const storageKey = "olon_registros_pendientes_v1";
  const kinds = {
    trading: { title:"Registrar resultado", save:"Guardar resultado", hint:"Anota el resultado de tu día de trading." },
    deposit: { title:"Registrar depósito", save:"Guardar depósito", hint:"Añade al registro el capital que depositaste." },
    withdrawal: { title:"Registrar retiro", save:"Guardar retiro", hint:"Anota cuánto capital retiraste." }
  };
  let mode = "trading", editing = null, busy = false;

  function studentId(){
    return currentUser && !isAdminUser(currentUser) ? currentUser.id : null;
  }

  function today(){
    const now = new Date();
    return [now.getFullYear(), String(now.getMonth()+1).padStart(2,"0"), String(now.getDate()).padStart(2,"0")].join("-");
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
    byId("ledgerTradingDetails").hidden = Boolean(record) || kind !== "trading";
    byId("ledgerCancelEdit").hidden = !record;
    for(const button of document.querySelectorAll("[data-record-kind]")){
      button.setAttribute("aria-pressed", String(button.dataset.recordKind === kind));
    }
    notice("olonRecordStatus", "");
    syncButton();
  }

  function reset(kind = "trading"){
    form.reset();
    byId("date").value = today();
    byId("ledgerTradingDetails").open = false;
    setMode(kind);
  }

  function amount(id, label){
    const input = byId(id);
    const value = Number(input.value || 0);
    if(input.validity.badInput || !Number.isFinite(value) || value < 0){
      throw new Error("Escribe un importe válido en " + label + ".");
    }
    return value;
  }

  function fieldsForRecord(){
    const date = byId("date");
    if(!date.value || !date.validity.valid) throw new Error("Selecciona una fecha válida.");
    const deposit = byId("ledgerDepositField").hidden ? 0 : amount("deposit", "Depósito");
    const withdrawal = mode === "withdrawal" ? amount("withdrawal", "Retiro") : 0;
    const trades = !byId("ledgerTradingFields").hidden;
    const gain = trades ? amount("gain", "Ganancia") : 0;
    const loss = trades ? amount("loss", "Pérdida") : 0;
    const note = mode === "trading" && !editing ? buildJournalNote() : byId("note").value.trim();
    if((mode === "deposit" || (mode === "legacy" && !trades)) && deposit <= 0) throw new Error("El depósito debe ser mayor que $0.");
    if(mode === "withdrawal" && withdrawal <= 0) throw new Error("El retiro debe ser mayor que $0.");
    if(!editing && trades && !byId("gain").value && !byId("loss").value && !note){
      throw new Error("Anota la ganancia, la pérdida o escribe 0 para un día en break even.");
    }
    return {record_date:date.value, deposit, withdrawal, gain, loss, note};
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
    if(error.code === "23505" && await findRecord(record.id, record.student_id)) return;
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
      const target = previous ? "historial" : "dashboard";
      const message = previous ? "Cambios guardados." : kinds[mode].save.replace("Guardar ", "") + " guardado.";
      reset();
      notice(previous ? "ledgerHistoryNotice" : "ledgerNotice", message.charAt(0).toUpperCase() + message.slice(1), "success");
      window.showPageById(target);
    }catch(error){
      console.warn("Registro sin confirmación", error.code || error.name);
      if(previous){
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
