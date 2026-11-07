(() => {
  "use strict";

  const byId = id => document.getElementById(id);
  const table = name => supabaseClient.from(name);
  const storage = bucket => supabaseClient.storage.from(bucket);
  const zone = "America/Puerto_Rico";
  const vipBucket = "olon-vip-receipts";
  const journalBucket = "olon-trade-journal";
  const dateTime = new Intl.DateTimeFormat("es-PR", {dateStyle:"medium", timeStyle:"short", timeZone:zone});
  const partsFormat = new Intl.DateTimeFormat("en-CA", {
    year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23", timeZone:zone
  });
  const rulesInfo = [["schedule_rule","schedule_ok","Horario"], ["risk_rule","risk_ok","Límite de riesgo"],
    ["entry_rule","entry_ok","Confirmación"]];
  const studentPages = new Set(["academyClassesPage","academyVipPage","academyChecklistPage","academyJournalPage"]);
  const adminPages = new Set(["academyAdminClassesPage","academyAdminVipPage"]);
  const types = {
    "image/jpeg":"jpg","image/png":"png","image/webp":"webp",
    "image/heic":"heic","image/heif":"heif","application/pdf":"pdf"
  };
  const safeError = message => Object.assign(new Error(message), {safe:true});
  let classDraft = null, classCreateId = null, receiptDraft = null, journal = null;
  let rules = {}, rulesOwner = null, dayRules = {}, dayRequest = 0, dayReady = null;
  let classNotifications = null, studentClassRequest = 0, studentClassesLoading = false;

  function student(){
    return currentUser && !isAdminUser(currentUser) ? currentUser.id : null;
  }
  function admin(){
    return currentUser && isAdminUser(currentUser) ? currentUser.id : null;
  }
  function parts(value = new Date()){
    return Object.fromEntries(partsFormat.formatToParts(value).map(({type,value}) => [type,value]));
  }
  function prDate(value){
    const p = parts(value);
    return p.year + "-" + p.month + "-" + p.day;
  }
  function localClassTime(value){
    const date = new Date(value), p = parts(date);
    return prDate(date) + "T" + p.hour + ":" + p.minute;
  }
  function field(form, name){
    return form.elements.namedItem(name);
  }
  function value(form, name){
    return field(form,name).value.trim();
  }
  function node(tag, text = "", css = ""){
    const el = document.createElement(tag);
    if(text) el.textContent = text;
    if(css) el.className = css;
    return el;
  }
  function feedback(id, message = "", tone = ""){
    const box = byId(id);
    box.textContent = message;
    box.dataset.tone = tone;
    box.hidden = !message;
  }
  function listMessage(id, message){
    byId(id).replaceChildren(node("p", message, "academyEmpty"));
  }
  function setList(id, elements, empty){
    if(!elements.length) return listMessage(id, empty);
    byId(id).replaceChildren(...elements);
  }
  function button(text, onClick){
    const el = node("button", text, "btn secondary");
    el.type = "button";
    el.addEventListener("click", onClick);
    return el;
  }
  function safeUrl(text){
    if(!text) return null;
    let url;
    try{ url = new URL(text); }catch{ throw safeError("Escribe un enlace HTTPS completo."); }
    if(url.protocol !== "https:" || url.username || url.password) throw safeError("Usa un enlace HTTPS sin credenciales en la dirección.");
    return url.href;
  }
  function link(text, url){
    const el = node("a", text, "btn secondary");
    el.href = safeUrl(url);
    el.target = "_blank";
    el.rel = "noopener noreferrer";
    return el;
  }
  function unwrap(result){
    if(result.error) throw result.error;
    return result.data;
  }
  async function action(control, feedbackId, work, failure){
    if(!control || control.disabled) return;
    control.disabled = true;
    feedback(feedbackId);
    try{ await work(); }
    catch(error){
      feedback(feedbackId, error.safe ? error.message : failure, "error");
    }finally{ control.disabled = false; }
  }
  function fileInfo(file, allowed, max, message){
    if(!file || !file.size || file.size > max * 1024 * 1024) throw safeError(message);
    const ext = file.name.split(".").pop().toLowerCase();
    const byExtension = Object.keys(types).find(key => types[key] === (ext === "jpeg" ? "jpg" : ext));
    const type = file.type && file.type !== "application/octet-stream" ? file.type : byExtension;
    if(!allowed.includes(type)) throw safeError(message);
    return {type, ext:types[type]};
  }
  async function upload(bucket, path, file, type){
    const {error} = await storage(bucket).upload(path,file,{contentType:type,upsert:false});
    if(!error) return;
    if(/duplicate|already exists/i.test(error.error || error.message || "") || Number(error.statusCode) === 409){
      unwrap(await storage(bucket).createSignedUrl(path, 60));
      return;
    }
    throw error;
  }
  async function discard(bucket,path){
    if(!path) return;
    try{ await storage(bucket).remove([path]); }catch{ /* A later retry can remove an unlinked upload. */ }
  }
  function privateFile(bucket,path,noun){
    const actions = node("div","","academyActions");
    const open = node("a", "Abrir " + noun, "btn secondary");
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    open.hidden = true;
    const preview = bucket === journalBucket ? node("img","","academyChartPreview") : null;
    if(preview){ preview.alt = "Captura del gráfico"; preview.hidden = true; }
    const prepare = button("Ver " + noun, async () => {
      prepare.disabled = true;
      try{
        const data = unwrap(await storage(bucket).createSignedUrl(path, 180));
        open.href = safeUrl(data.signedUrl);
        open.hidden = false;
        if(preview){ preview.src = open.href; preview.hidden = false; }
        prepare.textContent = "Actualizar enlace";
      }catch{ prepare.textContent = "Reintentar enlace"; }
      finally{ prepare.disabled = false; }
    });
    actions.append(prepare,open);
    if(preview) actions.append(preview);
    return actions;
  }

  function classCard(item, manage = false){
    const card = node("article","","academyItem");
    const start = +new Date(item.starts_at), end = start + item.duration_minutes * 60_000;
    const now = Date.now(), upcoming = end >= now;
    const state = !item.published ? "Oculta" : upcoming ? (start <= now ? "En curso" : "Programada") : "Finalizada";
    const head = node("div","","academyItemHead");
    head.append(node("h5",item.title),node("span",state,"academyBadge"));
    card.append(head,node("p",dateTime.format(new Date(item.starts_at)) + " PR · " + item.duration_minutes + " min","academyMeta"));
    if(item.description) card.append(node("p",item.description,"academyCopy"));
    const actions = node("div","","academyActions");
    if(manage){
      actions.append(button("Editar clase", () => editClass(item)));
      const visibility = button(item.published ? "Ocultar clase" : "Publicar de nuevo", () => {
        void action(visibility,"academyClassFeedback",async () => {
          const changed = unwrap(await table("olon_classes").update({published:!item.published})
            .eq("id",item.id).eq("published",item.published).select("id").maybeSingle());
          if(!changed) throw safeError("La clase cambió. Abre Gestionar clases para cargarla de nuevo.");
          if(classDraft?.id === item.id) editClass();
          await loadClasses(true);
          feedback("academyClassFeedback",item.published ? "Clase oculta para estudiantes." : "Clase publicada.","success");
        },"No se pudo actualizar la visibilidad.");
      });
      actions.append(visibility);
    }else{
      for(const [text,url] of [["Entrar a la clase",upcoming && item.join_url],
        ["Ver grabación",item.replay_url],["Material de repaso",item.material_url]]){
        if(url){ try{ actions.append(link(text,url)); }catch{ /* An invalid link stays out of the student view. */ } }
      }
      if(upcoming && !item.join_url) card.append(node("p","Enlace de la sesión pendiente.","academyMeta"));
      if(!upcoming && !item.replay_url) card.append(node("p","Grabación pendiente.","academyMeta"));
    }
    if(actions.children.length) card.append(actions);
    return card;
  }

  function renderClassUnread(count){
    const badge = byId("classUnreadBadge");
    const dot = byId("classUnreadMenuDot");
    const detail = count === 1 ? "1 clase nueva" : count + " clases nuevas";
    badge.textContent = count > 99 ? "99+" : count ? String(count) : "";
    badge.hidden = dot.hidden = !count;
    badge.parentElement.setAttribute("aria-label", count ? "Clases, " + detail : "Clases");
    dot.parentElement.setAttribute("aria-label", count ? "Abrir menú, " + detail : "Abrir menú");
  }

  function classesVisible(){
    return !document.hidden && !byId("academyClassesPage").classList.contains("hidden");
  }

  async function refreshClassUnread(state = classNotifications, openNew = true){
    if(!state || classNotifications !== state || student() !== state.owner || document.hidden) return;
    const request = ++state.request;
    try{
      const count = Number(unwrap(await supabaseClient.rpc("olon_unread_class_count"))) || 0;
      if(classNotifications !== state || student() !== state.owner || request !== state.request) return;
      renderClassUnread(count);
      if(count && openNew && classesVisible()) void loadClasses(false, true);
    }catch(error){
      console.warn("No se pudieron actualizar los avisos de clases", error.message);
    }
  }

  function stopClassNotifications(){
    const state = classNotifications;
    classNotifications = null;
    studentClassRequest++;
    studentClassesLoading = false;
    renderClassUnread(0);
    if(!state) return;
    clearInterval(state.timer);
    void supabaseClient.removeChannel(state.channel);
  }

  function startClassNotifications(){
    const owner = student();
    if(classNotifications?.owner === owner) return;
    stopClassNotifications();
    if(!owner) return;
    const state = {owner, request:0};
    classNotifications = state;
    state.channel = supabaseClient.channel("olon-class-notifications")
      .on("postgres_changes", {event:"*",schema:"public",table:"olon_classes"}, () => void refreshClassUnread(state))
      .subscribe(status => {
        if(status === "SUBSCRIBED") void refreshClassUnread(state);
      });
    state.timer = setInterval(() => void refreshClassUnread(state), 20_000);
    void refreshClassUnread(state);
  }

  document.addEventListener("visibilitychange", () => {
    if(!document.hidden) void refreshClassUnread();
  });

  async function readClassRows(){
    const rows = [];
    const batchSize = 250;
    let batch;
    do{
      batch = unwrap(await table("olon_classes").select("*").order("starts_at").order("id")
        .range(rows.length, rows.length + batchSize - 1)) || [];
      rows.push(...batch);
    }while(batch.length === batchSize);
    return rows;
  }

  async function loadClasses(manage = false, quiet = false){
    const owner = manage ? admin() : student();
    if(!owner || (!manage && quiet && studentClassesLoading)) return;
    const request = manage ? null : ++studentClassRequest;
    if(!manage) studentClassesLoading = true;
    const sections = manage ? ["academyClassAdminList"] : ["classUpcoming","classReplay"];
    if(!quiet) sections.forEach(id => listMessage(id,"Cargando clases…"));
    try{
      const rows = await readClassRows();
      if(owner !== (manage ? admin() : student()) || (!manage && request !== studentClassRequest)) return;
      if(manage) return setList(sections[0],rows.slice().reverse().map(row=>classCard(row,true)),"Todavía no hay clases registradas.");
      const now = Date.now();
      const recent = row => +new Date(row.starts_at) + row.duration_minutes * 60_000 >= now;
      setList(sections[0],rows.filter(recent).map(row=>classCard(row)),"Todavía no hay clases programadas.");
      setList(sections[1],rows.filter(row=>!recent(row)).reverse().map(row=>classCard(row)),"Las clases pasadas aparecerán aquí.");
      if(classesVisible()){
        const publications = rows.map(row => row.publication_id).filter(Boolean);
        if(publications.length){
          const {error} = await supabaseClient.rpc("olon_mark_classes_read", {p_publications:publications});
          if(error) console.warn("No se pudieron marcar las clases como vistas", error.message);
        }
        if(student() === owner) void refreshClassUnread(classNotifications, false);
      }
    }catch{
      if(!quiet && (manage || request === studentClassRequest)){
        sections.forEach(id=>listMessage(id,"No se pudieron cargar las clases. Abre esta sección de nuevo."));
      }
    }finally{
      if(!manage && request === studentClassRequest) studentClassesLoading = false;
    }
  }

  const classForm = byId("academyClassForm");
  function editClass(item = null){
    classForm.reset();
    classDraft = item;
    classCreateId = null;
    byId("academyClassFormTitle").textContent = item ? "Editar clase" : "Programar clase";
    byId("academyClassSave").textContent = item ? "Guardar clase" : "Publicar clase";
    byId("academyClassCancel").hidden = !item;
    feedback("academyClassFeedback");
    if(!item) return;
    const fields = {title:item.title, starts:localClassTime(item.starts_at), duration:item.duration_minutes,
      description:item.description, join:item.join_url, replay:item.replay_url, material:item.material_url};
    Object.entries(fields).forEach(([name,value]) => { field(classForm,name).value = value ?? ""; });
    field(classForm,"title").focus();
  }
  classForm.addEventListener("submit",event => {
    event.preventDefault();
    if(!admin()) return;
    void action(byId("academyClassSave"),"academyClassFeedback",async()=>{
      const editing = classDraft;
      const title = value(classForm,"title"), starts = value(classForm,"starts"), duration = Number(value(classForm,"duration"));
      if(!title || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(starts) || !Number.isInteger(duration) || duration < 5 || duration > 480){
        throw safeError("Completa el título, la fecha y una duración válida.");
      }
      const data = {title, starts_at:new Date(starts + "-04:00").toISOString(), duration_minutes:duration,
        description:value(classForm,"description"), join_url:safeUrl(value(classForm,"join")),
        replay_url:safeUrl(value(classForm,"replay")), material_url:safeUrl(value(classForm,"material"))};
      if(editing) unwrap(await table("olon_classes").update(data).eq("id",editing.id).select("id").single());
      else{
        classCreateId ||= crypto.randomUUID();
        const result = await table("olon_classes").insert({id:classCreateId,...data});
        if(result.error){
          const previous = result.error.code === "23505"
            && unwrap(await table("olon_classes").select("id").eq("id",classCreateId).maybeSingle());
          if(!previous) throw result.error;
        }
      }
      editClass();
      await loadClasses(true);
      feedback("academyClassFeedback",editing ? "Cambios guardados." : "Clase publicada.","success");
    },"No se pudo guardar la clase.");
  });
  byId("academyClassCancel").addEventListener("click", () => editClass());

  const vipForm = byId("academyVipForm");
  const receiptStatus = {pending:"Pendiente",confirmed:"Confirmado",rejected:"Requiere corrección"};

  function receiptCard(row){
    const card = node("article","","academyItem");
    const head = node("div","","academyItemHead");
    const badge = node("span",receiptStatus[row.status],"academyBadge");
    badge.dataset.status = row.status;
    head.append(node("h5","Comprobante"),badge);
    card.append(head,node("p",dateTime.format(new Date(row.submitted_at)) + " PR","academyMeta"));
    if(row.next_payment_date) card.append(node("p","Próxima fecha de pago · " + vipPaymentDateLabel.format(new Date(row.next_payment_date + "T00:00:00Z")),"academyCopy"));
    if(row.review_note) card.append(node("p","Administración · " + row.review_note,"academyCopy"));
    card.append(privateFile(vipBucket,row.object_path,"comprobante"));
    return card;
  }

  async function loadVip(){
    const owner = student();
    if(!owner) return;
    listMessage("academyVipHistory","Cargando comprobantes…");
    try{
      const [proof,profile] = await Promise.all([
        table("olon_vip_receipts").select("*").eq("student_id",owner).order("submitted_at",{ascending:false}).limit(20),
        table("profiles").select("next_payment_date").eq("id",owner).maybeSingle()
      ]);
      if(student() !== owner) return;
      const rows = unwrap(proof) || [];
      if(!profile.error && profile.data) currentUser.next_payment_date = profile.data.next_payment_date;
      renderVipPayment(currentUser);
      const date = currentUser.next_payment_date;
      byId("academyVipDate").textContent = date
        ? "Próximo pago · " + vipPaymentDateLabel.format(new Date(date + "T00:00:00Z"))
        : "Administración todavía no ha asignado una próxima fecha de pago.";
      const pending = rows.some(row=>row.status==="pending");
      vipForm.hidden = pending;
      byId("academyVipPending").hidden = !pending;
      setList("academyVipHistory",rows.map(receiptCard),"Todavía no has enviado comprobantes.");
    }catch{ listMessage("academyVipHistory","No se pudieron consultar tus comprobantes."); }
  }

  vipForm.addEventListener("submit",event=>{
    event.preventDefault();
    const owner = student();
    if(!owner) return;
    void action(event.submitter || vipForm.querySelector("button"),"academyVipFeedback",async()=>{
      const file = field(vipForm,"proof").files[0];
      const info = fileInfo(file,Object.keys(types),8,"Selecciona una imagen o un PDF de hasta 8 MB.");
      if(!receiptDraft || receiptDraft.owner !== owner || receiptDraft.file !== file){
        if(receiptDraft?.owner === owner) await discard(vipBucket,receiptDraft.path);
        const id = crypto.randomUUID();
        receiptDraft = {owner,id,file,path:owner + "/" + id + "." + info.ext};
      }
      const draft = receiptDraft;
      await upload(vipBucket,draft.path,file,info.type);
      const {error} = await table("olon_vip_receipts").insert({
        id:draft.id, student_id:owner, object_path:draft.path, student_note:value(vipForm,"note")
      });
      if(error){
        const found = unwrap(await table("olon_vip_receipts").select("id").eq("id",draft.id).eq("student_id",owner).maybeSingle());
        if(!found && error.code === "23505"){
          await discard(vipBucket,draft.path);
          receiptDraft = null;
          await loadVip();
          throw safeError("Ya tienes un comprobante pendiente de revisión.");
        }
        if(!found) throw error;
      }
      receiptDraft = null;
      vipForm.reset();
      await loadVip();
      feedback("academyVipFeedback","Comprobante enviado a Administración.","success");
    },"No se confirmó el envío. Vuelve a intentar con el mismo archivo.");
  });

  function adminReceiptCard(row){
    const card = node("article","","academyItem");
    card.append(node("h5",row.profiles?.full_name || "Estudiante"),node("p",dateTime.format(new Date(row.submitted_at)) + " PR","academyMeta"));
    if(row.student_note) card.append(node("p",row.student_note,"academyCopy"));
    card.append(privateFile(vipBucket,row.object_path,"comprobante"));
    const form = node("form","","formGrid academyReviewForm");
    const dateLabel = node("label","Próxima fecha de pago","field"), date = node("input");
    date.type = "date";
    date.min = prDate(new Date(Date.now()+86_400_000));
    dateLabel.append(date);
    const noteLabel = node("label","Nota para el estudiante (opcional)","field"), note = node("textarea");
    note.maxLength = 300;
    note.rows = 2;
    noteLabel.append(note);
    const actions = node("div","","full academyActions");
    const confirm = node("button","Confirmar pago","btn"), reject = node("button","Pedir corrección","btn secondary");
    confirm.type = reject.type = "submit";
    reject.formNoValidate = true;
    actions.append(confirm,reject);
    form.append(dateLabel,noteLabel,actions);
    form.addEventListener("submit",event => {
      event.preventDefault();
      if(!admin() || confirm.disabled || reject.disabled) return;
      const approve = event.submitter !== reject;
      const active = approve ? confirm : reject, other = approve ? reject : confirm;
      other.disabled = true;
      void action(active,"academyAdminVipFeedback",async () => {
        if(approve && (!date.value || date.value < date.min)) throw safeError("Selecciona una próxima fecha de pago futura.");
        const changed = unwrap(await supabaseClient.rpc("olon_review_vip_receipt",{
          p_receipt:row.id,p_approve:approve,p_next_payment:approve ? date.value : null,p_note:note.value.trim()
        }));
        await loadAdminVip();
        if(!changed) throw safeError("Este comprobante ya fue revisado.");
        feedback("academyAdminVipFeedback",approve ? "Pago confirmado y próxima fecha actualizada." : "Se solicitó una corrección.","success");
      },"No se pudo completar la revisión.").finally(() => { other.disabled = false; });
    });
    card.append(form);
    return card;
  }

  async function loadAdminVip(){
    const owner = admin();
    if(!owner) return;
    listMessage("academyVipAdminList","Cargando comprobantes…");
    try{
      const rows = unwrap(await table("olon_vip_receipts").select("*,profiles(full_name)")
        .eq("status","pending").order("submitted_at")) || [];
      if(admin() === owner) setList("academyVipAdminList",rows.map(adminReceiptCard),"No hay comprobantes pendientes.");
    }catch{ listMessage("academyVipAdminList","No se pudieron cargar los comprobantes."); }
  }

  const journalForm = byId("academyJournalForm");
  const journalButton = journalForm.querySelector("button[type=submit]");
  async function readJournal(id,owner){
    return unwrap(await table("olon_trade_journals").select("*").eq("record_id",id).eq("student_id",owner).maybeSingle());
  }
  function showJournalFile(state){
    const box = byId("academyJournalAttachment");
    box.replaceChildren();
    box.hidden = !state.row?.image_path;
    if(box.hidden) return;
    if(state.remove){
      box.append(node("span","Se quitará la captura al guardar.","academyMeta"),
        button("Conservar captura",()=>{state.remove=false;showJournalFile(state);}));
    }else{
      box.append(privateFile(journalBucket,state.row.image_path,"captura"),
        button("Quitar captura",()=>{state.remove=true;showJournalFile(state);}));
    }
  }
  async function openJournal(recordId){
    const owner = student();
    const record = cachedRecords.find(row=>row.id===recordId);
    if(!owner || !record || !isTradingRecord(record)) return;
    const state = {owner,id:record.id,row:null,ready:false,remove:false};
    journal = state;
    journalForm.reset();
    showJournalFile(state);
    journalButton.disabled = true;
    byId("academyJournalDate").textContent = "Registro del " + vipPaymentDateLabel.format(new Date(record.date + "T00:00:00Z"));
    feedback("academyJournalFeedback","Cargando diario…");
    window.showPageById("academyJournalPage");
    try{
      const row = await readJournal(state.id,owner);
      if(journal !== state || student() !== owner) return;
      state.row = row;
      state.ready = true;
      field(journalForm,"before").value = row?.before_trade || "";
      field(journalForm,"after").value = row?.after_trade || "";
      showJournalFile(state);
      feedback("academyJournalFeedback");
      journalButton.disabled = false;
    }catch{
      if(journal === state) feedback("academyJournalFeedback","No se pudo abrir el diario. Vuelve al historial e inténtalo de nuevo.","error");
    }
  }
  journalForm.addEventListener("submit",event=>{
    event.preventDefault();
    const state = journal;
    if(!state?.ready || student() !== state.owner) return;
    void action(journalButton,"academyJournalFeedback",async()=>{
      const old = state.row?.image_path;
      const fields = {before_trade:value(journalForm,"before"),after_trade:value(journalForm,"after"),
        image_path:state.remove ? null : old || null};
      const file = field(journalForm,"chart").files[0];
      let added = null;
      if(file){
        const info = fileInfo(file,["image/jpeg","image/png","image/webp"],6,"Selecciona una captura JPG, PNG o WebP de hasta 6 MB.");
        if(state.pending?.file !== file){
          if(state.pending) await discard(journalBucket,state.pending.path);
          state.pending = {file,path:state.owner + "/" + state.id + "/" + crypto.randomUUID() + "." + info.ext};
        }
        added = state.pending.path;
        await upload(journalBucket,added,file,info.type);
        fields.image_path = added;
      }else if(state.pending){
        await discard(journalBucket,state.pending.path);
        state.pending = null;
      }
      let saved;
      try{
        const q = table("olon_trade_journals");
        const result = state.row
          ? await q.update(fields).eq("record_id",state.id).eq("student_id",state.owner)
              .eq("revision",state.row.revision).select("*").maybeSingle()
          : await q.insert({...fields,record_id:state.id,student_id:state.owner}).select("*").maybeSingle();
        if(result.error || !result.data){
          const current = await readJournal(state.id,state.owner);
          if(current && Object.keys(fields).every(key=>current[key]===fields[key])) saved = current;
          else if(result.error && result.error.code !== "23505") throw result.error;
          else throw safeError("Este diario cambió en otra sesión. Vuelve al historial y ábrelo de nuevo.");
        }else saved = result.data;
      }catch(error){
        if(added) await discard(journalBucket,added);
        throw error;
      }
      if(old && old !== saved.image_path) await discard(journalBucket,old);
      if(journal !== state || student() !== state.owner) return;
      state.row = saved;
      state.pending = null;
      state.remove = false;
      field(journalForm,"chart").value = "";
      showJournalFile(state);
      feedback("academyJournalFeedback","Diario guardado.","success");
    },"No se pudo guardar el diario. Verifica tu conexión y vuelve a intentar.");
  });

  const ruleForm = byId("academyRuleForm");
  const dayForm = byId("academyDayForm");
  const dayDate = field(dayForm,"date");
  const dayButton = dayForm.querySelector("button");
  function drawDay(row){
    dayRules = row || rules;
    const inputs = rulesInfo.filter(([key]) => dayRules[key]).map(([key,checked,label])=>{
      const item = node("label","","academyCheckItem"), box = node("input");
      box.type = "checkbox";
      box.name = checked;
      box.checked = Boolean(row?.[checked]);
      const text = node("span");
      text.append(node("b",label),node("small",dayRules[key]));
      item.append(box,text);
      return item;
    });
    dayButton.disabled = !inputs.length;
    setList("academyChecklistItems",inputs,"Guarda al menos una regla para completar tu revisión.");
  }
  async function loadDay(){
    const owner = student(), date = dayDate.value, request = ++dayRequest;
    dayReady = null;
    dayButton.disabled = true;
    if(!owner || !date) return;
    listMessage("academyChecklistItems","Cargando revisión…");
    feedback("academyDayFeedback");
    try{
      const row = unwrap(await table("olon_checklist_days").select("*").eq("student_id",owner).eq("record_date",date).maybeSingle());
      if(student() === owner && request === dayRequest){
        dayReady = owner + "/" + date;
        drawDay(row);
      }
    }catch{
      if(request === dayRequest) listMessage("academyChecklistItems","No se pudo cargar la revisión. Cambia la fecha o vuelve a abrir la sección.");
    }
  }
  async function loadChecklist(){
    const owner = student();
    if(!owner) return;
    dayReady = null;
    dayButton.disabled = true;
    if(rulesOwner !== owner){dayDate.value = prDate();rulesOwner=owner;}
    if(!dayDate.value) dayDate.value = prDate();
    try{
      const row = unwrap(await table("olon_checklist_rules").select("*").eq("student_id",owner).maybeSingle());
      if(student() !== owner) return;
      rules = row || {};
      for(const [key] of rulesInfo) field(ruleForm,key).value = rules[key] || "";
      await loadDay();
    }catch{ feedback("academyRuleFeedback","No se pudieron cargar tus reglas.","error"); }
  }
  dayDate.addEventListener("change",()=>void loadDay());
  ruleForm.addEventListener("submit",event=>{
    event.preventDefault();
    const owner = student();
    if(!owner) return;
    void action(event.submitter || ruleForm.querySelector("button"),"academyRuleFeedback",async()=>{
      const record = {student_id:owner};
      for(const [key] of rulesInfo) record[key] = value(ruleForm,key);
      unwrap(await table("olon_checklist_rules").upsert(record,{onConflict:"student_id"}));
      if(student() !== owner) return;
      rules = record;
      await loadDay();
      feedback("academyRuleFeedback","Reglas guardadas. Las revisiones ya registradas conservan sus reglas originales.","success");
    },"No se pudieron guardar tus reglas.");
  });
  dayForm.addEventListener("submit",event=>{
    event.preventDefault();
    const owner = student(), date = dayDate.value;
    if(!owner || !date || dayButton.disabled || dayReady !== owner + "/" + date) return;
    dayDate.disabled = true;
    void action(dayButton,"academyDayFeedback",async()=>{
      const record = {student_id:owner,record_date:date};
      for(const [rule,checked] of rulesInfo){
        record[rule] = dayRules[rule] || "";
        record[checked] = Boolean(record[rule] && field(dayForm,checked)?.checked);
      }
      if(!rulesInfo.some(([rule])=>record[rule])) throw safeError("Guarda al menos una regla.");
      unwrap(await table("olon_checklist_days").upsert(record,{onConflict:"student_id,record_date"}));
      if(student() === owner && dayDate.value === date) feedback("academyDayFeedback","Revisión guardada.","success");
    },"No se pudo guardar la revisión del día.").finally(()=>{ dayDate.disabled = false; });
  });

  document.addEventListener("click",event=>{
    const page = event.target.closest("[data-academy-page]")?.dataset.academyPage;
    if(page) window.showPageById(page);
    const id = event.target.closest("[data-record-journal]")?.dataset.recordJournal;
    if(id) void openJournal(id);
  });

  window.olonAcademy = {
    startClassNotifications,
    stopClassNotifications,
    allows(page){
      return studentPages.has(page) ? Boolean(student()) : adminPages.has(page) ? Boolean(admin()) : true;
    },
    openPage(page){
      if(page === "academyClassesPage") void loadClasses();
      if(page === "academyVipPage") void loadVip();
      if(page === "academyChecklistPage") void loadChecklist();
      if(page === "academyAdminClassesPage") void loadClasses(true);
      if(page === "academyAdminVipPage") void loadAdminVip();
    },
    async cleanupJournalFiles(recordId,owner){
      if(student() !== owner) return;
      try{
        const prefix = owner + "/" + recordId;
        const files = unwrap(await storage(journalBucket).list(prefix,{limit:100})) || [];
        if(files.length && student() === owner) await storage(journalBucket).remove(files.map(file=>prefix + "/" + file.name));
      }catch{ /* The record deletion remains valid if an attachment cannot be cleaned up immediately. */ }
    }
  };
})();
