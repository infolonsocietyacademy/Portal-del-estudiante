/* OLON Society Academy — TOP 3 weekly/monthly/yearly.
   Entries are published manually by an active admin; scores are never fabricated. */
(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const periods=["weekly","monthly","annual"];
  const order=[2,1,3];
  const state={selected:"weekly",loadedKey:"",fetchSeq:0,adminPeriod:"weekly",users:[],isSaving:false};
  const pad=v=>String(v).padStart(2,"0");
  function activeAdmin(){
    return typeof currentUser!=="undefined" && !!currentUser &&
      typeof isAdminUser==="function" && isAdminUser(currentUser) &&
      String(currentUser.status||"").toLowerCase()==="active";
  }
  function todayPuertoRico(){
    const parts=new Intl.DateTimeFormat("en-US",{
      timeZone:"America/Puerto_Rico",year:"numeric",month:"2-digit",day:"2-digit"
    }).formatToParts(new Date());
    const get=name=>Number(parts.find(part=>part.type===name)?.value||0);
    return {year:get("year"),month:get("month"),day:get("day")};
  }
  function currentKey(period){
    const p=todayPuertoRico();
    if(period==="annual")return String(p.year);
    if(period==="monthly")return p.year+"-"+pad(p.month);
    const date=new Date(Date.UTC(p.year,p.month-1,p.day));
    const day=date.getUTCDay()||7;
    date.setUTCDate(date.getUTCDate()+4-day);
    const isoYear=date.getUTCFullYear();
    const start=new Date(Date.UTC(isoYear,0,1));
    const week=Math.ceil((((date-start)/86400000)+1)/7);
    return isoYear+"-W"+pad(week);
  }
  function periodLabel(period,key){
    return (period==="weekly"?"Semana ":period==="monthly"?"Mes ":"Año ")+key;
  }
  function showStatus(id,message,error=false){
    const el=$(id);if(!el)return;
    el.textContent=message;el.hidden=false;
    el.dataset.error=String(error);
  }
  function initials(name){
    return String(name||"?").trim().split(/\s+/).slice(0,2).map(s=>s.charAt(0)).join("").toUpperCase()||"?";
  }
  function showPodium(entries,period,key){
    const section=$("olonLeaderboard");
    if(!section)return;
    const byRank=new Map((entries||[]).map(e=>[Number(e.rank),e]));
    order.forEach(rank=>{
      const card=section.querySelector('[data-leaderboard-rank="'+rank+'"]');
      if(!card)return;
      const entry=byRank.get(rank);
      card.classList.toggle("isEmpty",!entry);
      card.dataset.avatarStudent=entry?.student_id||"";
      const avatar=card.querySelector("[data-top-avatar]");
      const fallback=card.querySelector("[data-top-initials]");
      avatar.hidden=true;
      avatar.removeAttribute("src");
      fallback.hidden=false;
      fallback.textContent=entry?initials(entry.display_name):"—";
      card.querySelector("[data-top-name]").textContent=entry?entry.display_name:"Sin clasificar";
      card.querySelector("[data-top-percent]").textContent=entry
        ? (Number(entry.return_pct)>0?"+":"")+Number(entry.return_pct).toLocaleString("es-PR",{maximumFractionDigits:2,minimumFractionDigits:2})+"%"
        : "—";
    });
    $("olonLeaderboardPeriod").textContent=periodLabel(period,key);
    $("olonLeaderboardEmpty").hidden=byRank.size>0;
  }
  async function loadPodiumAvatars(entries,request){
    // Only published students with explicit photo consent may share an avatar.
    const approved=(entries||[]).filter(entry=>
      entry.photo_consent_confirmed===true && entry.student_id);
    if(!approved.length)return;
    try{
      const ids=[...new Set(approved.map(entry=>entry.student_id))];
      const {data,error}=await supabaseClient.from("olon_profile_media")
        .select("student_id,avatar_path").in("student_id",ids);
      if(error)throw error;
      if(request!==state.fetchSeq)return;
      const rows=new Map((data||[]).map(item=>[item.student_id,item.avatar_path]));
      await Promise.all(approved.map(async entry=>{
        const path=rows.get(entry.student_id);
        if(!path || !path.startsWith(entry.student_id+"/avatar/"))return;
        try{
          // Signed URL is temporary; the original storage bucket stays private.
          const {data:asset,error:assetError}=await supabaseClient.storage
            .from("olon-profile-media").createSignedUrl(path,600);
          if(assetError || !asset?.signedUrl || request!==state.fetchSeq)return;
          const card=$("olonLeaderboard")?.querySelector(
            '[data-leaderboard-rank="'+Number(entry.rank)+'"]');
          if(!card)return;
          const image=card.querySelector("[data-top-avatar]");
          const fallback=card.querySelector("[data-top-initials]");
          // Preload separately: a hidden <img loading="lazy"> may never load,
          // so its onload event cannot make it visible. This fixes that deadlock.
          const probe=new Image();
          probe.onload=()=>{
            if(request!==state.fetchSeq)return;
            if(card.dataset.avatarStudent!==entry.student_id)return;
            image.src=asset.signedUrl;
            image.hidden=false;
            fallback.hidden=true;
          };
          probe.onerror=()=>{
            if(request!==state.fetchSeq)return;
            image.hidden=true;
            fallback.hidden=false;
            image.removeAttribute("src");
            console.warn("[OLON TOP 3] No se pudo abrir la foto del puesto",entry.rank);
          };
          card.dataset.avatarStudent=entry.student_id;
          probe.src=asset.signedUrl;
        }catch(error){ /* Keep initials when a photo is unavailable. */ }
      }));
    }catch(error){
      // A missing/deleted image must not prevent names and percentages from loading.
      console.warn("[OLON TOP 3] Foto no disponible",error);
    }
  }
  async function loadPublic(period=state.selected){
    if(!periods.includes(period))return;
    state.selected=period;
    const key=currentKey(period);
    const request=++state.fetchSeq;
    document.querySelectorAll("[data-leaderboard-period]").forEach(button=>{
      const active=button.dataset.leaderboardPeriod===period;
      button.classList.toggle("active",active);
      button.setAttribute("aria-selected",String(active));
      button.tabIndex=active?0:-1;
    });
    $("olonLeaderboardLoading").hidden=false;
    $("olonLeaderboardEmpty").hidden=true;
    try{
      if(typeof supabaseClient==="undefined")throw Error("No hay conexión con Supabase.");
      const {data,error}=await supabaseClient.from("olon_leaderboard")
        .select("rank,student_id,display_name,return_pct,photo_consent_confirmed").eq("period_type",period)
        .eq("period_key",key).eq("published",true).order("rank",{ascending:true});
      if(request!==state.fetchSeq)return;
      if(error)throw error;
      showPodium(data||[],period,key);
      void loadPodiumAvatars(data||[],request);
      state.loadedKey=key;
      $("olonLeaderboardError").hidden=true;
    }catch(err){
      if(request!==state.fetchSeq)return;
      showPodium([],period,key);
      showStatus("olonLeaderboardError","No se pudo cargar el ranking. Vuelve a intentarlo.",true);
      console.warn("[OLON TOP 3] Error al cargar",err);
    }finally{
      if(request===state.fetchSeq)$("olonLeaderboardLoading").hidden=true;
    }
  }
  function adminPeriodFields(){
    const period=$("olonRankPeriod").value;
    state.adminPeriod=period;
    const field=$("olonRankKey");
    field.type=period==="weekly"?"week":period==="monthly"?"month":"number";
    field.min=period==="annual"?"2020":"";
    field.max=period==="annual"?"2100":"";
    field.step=period==="annual"?"1":"";
    field.value=currentKey(period);
    field.setAttribute("aria-label",period==="weekly"?"Semana":period==="monthly"?"Mes":"Año");
  }
  function validPeriodKey(period,key){
    return period==="weekly"?/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(key):
      period==="monthly"?/^\d{4}-(0[1-9]|1[0-2])$/.test(key):/^\d{4}$/.test(key);
  }
  function selectedAdminKey(){
    return String($("olonRankKey").value||"").trim();
  }
  function renderStudentOptions(){
    const users=state.users;
    for(let rank=1;rank<=3;rank++){
      const select=$("olonRankStudent"+rank);
      if(!select)continue;
      const selected=select.value;
      select.replaceChildren(new Option("Sin asignar",""));
      users.forEach(user=>{
        const detail=user.access_code?" · "+user.access_code:"";
        select.add(new Option((user.full_name||"Estudiante")+detail,user.id));
      });
      if(users.some(user=>user.id===selected))select.value=selected;
    }
  }
  async function loadAdminUsers(){
    if(!activeAdmin())return;
    try{
      // Rank choices are ALL students with current active membership, not just
      // those previously published on the leaderboard. Keep last good options
      // if an intermittent query fails.
      const {data,error}=await supabaseClient.from("profiles")
        .select("id,full_name,access_code,status,role").eq("role","student")
        .in("status",["active","approved"]).order("full_name",{ascending:true}).limit(1000);
      if(error)throw error;
      state.users=data||[];
      renderStudentOptions();
      return true;
    }catch(err){
      showStatus("olonRankFeedback","No pude cargar la lista de estudiantes. Usa Consultar período para reintentar: "+String(err?.message||"Error de conexión."),true);
      console.warn("[OLON TOP 3] Estudiantes",err);
      return false;
    }
  }
  const rankMoney=value=>Number(value||0).toLocaleString("en-US",{style:"currency",currency:"USD"});
  const rankPct=value=>value==null?"Sin capital":(Number(value)>0?"+":"")+
    Number(value).toLocaleString("es-PR",{minimumFractionDigits:2,maximumFractionDigits:2})+"%";
  async function loadRankCandidates(){
    if(!activeAdmin())return;
    const holder=$("olonRankCandidatesList"),counter=$("olonRankCandidatesCount");
    if(!holder||!counter)return;
    const period=$("olonRankPeriod")?.value,key=selectedAdminKey();
    if(!validPeriodKey(period,key)){
      holder.textContent="Selecciona una fecha válida para consultar los trades.";
      return;
    }
    const seq=(state.candidateSeq||0)+1;
    state.candidateSeq=seq;
    holder.textContent="Consultando operaciones registradas…";
    counter.textContent="Actualizando";
    try{
      const {data,error}=await supabaseClient.rpc("olon_admin_student_performance",{
        p_period_type:period,p_period_key:key
      });
      if(error)throw error;
      if(seq!==state.candidateSeq||!activeAdmin()||
        period!==$("olonRankPeriod")?.value||key!==selectedAdminKey())return;
      const perf=(data||[]).filter(item=>Number(item.trade_count)>0)
        .sort((left,right)=>{
          const a=left.return_pct==null?-Infinity:Number(left.return_pct);
          const b=right.return_pct==null?-Infinity:Number(right.return_pct);
          return b-a;
        });
      counter.textContent=perf.length+" estudiante"+(perf.length===1?"":"s")+" con trades";
      holder.replaceChildren();
      if(!perf.length){
        const p=document.createElement("p");
        p.className="olonRankCandidatesEmpty";
        p.textContent="No se registraron operaciones en este período. Prueba mensual o anual para ver resultados anteriores.";
        holder.append(p);
        return;
      }
      for(const item of perf){
        const user=state.users.find(user=>user.id===item.student_id);
        const panel=document.createElement("article");
        panel.className="olonRankCandidate";
        const detail=document.createElement("div");
        detail.className="olonRankCandidateInfo";
        const name=document.createElement("strong");
        name.textContent=user?.full_name||"Estudiante registrado";
        const meta=document.createElement("small");
        meta.textContent=item.trade_count+" trade(s) · Neto "+rankMoney(item.net)+
          " · Capital "+rankMoney(item.deposited);
        detail.append(name,meta);
        const value=document.createElement("strong");
        value.className="olonRankCandidatePct";
        value.textContent=rankPct(item.return_pct);
        if(item.return_pct!=null&&Number(item.return_pct)<0)value.dataset.loss="true";
        const select=document.createElement("button");
        select.type="button";select.className="btn secondary olonRankCandidateAdd";
        select.textContent="Agregar al TOP 3";
        const number=Number(item.return_pct);
        const eligible=Boolean(user)&&item.return_pct!=null&&
          Number(item.deposited)>0&&Number.isFinite(number)&&
          number>=-100&&number<=100000;
        select.disabled=!eligible;
        select.title=!user?"Actualiza la lista de estudiantes para poder asignar":
          item.return_pct==null||Number(item.deposited)<=0?"El estudiante debe tener un depósito registrado":
          !eligible?"El rendimiento no está dentro del rango admitido por el ranking":"Preparar este estudiante sin publicarlo";
        select.addEventListener("click",async()=>{
          if(select.disabled)return;
          select.disabled=true;
          try{await stageCandidate(item.student_id,number,period,key);}
          finally{select.disabled=false;}
        });
        panel.append(detail,value,select);
        if(!eligible){
          const note=document.createElement("small");
          note.className="olonRankCandidateReason";
          note.textContent=select.title;
          panel.append(note);
        }
        holder.append(panel);
      }
    }catch(error){
      if(seq!==state.candidateSeq)return;
      counter.textContent="No disponible";
      holder.textContent="No se pudieron cargar los trades: "+String(error?.message||"Error de conexión.")+
        ". Reintenta desde «Consultar período».";
      console.warn("[OLON TOP 3] Resultados privados",error);
    }
  }
  function showAdminPreview(entries, period, key){
    const holder=$("olonRankPreviewRows");
    const status=$("olonRankPreviewStatus");
    if(!holder||!status)return;
    holder.replaceChildren();
    status.textContent="Período: "+periodLabel(period,key);
    const byRank=new Map((entries||[]).map(entry=>[Number(entry.rank),entry]));
    for(let rank=1;rank<=3;rank++){
      const item=byRank.get(rank);
      const row=document.createElement("div");
      row.className="olonRankPreviewItem"+(item?" hasEntry":"");
      const marker=document.createElement("span");
      marker.className="olonRankPreviewMedal";
      marker.textContent=rank===1?"🥇":rank===2?"🥈":"🥉";
      const copy=document.createElement("span");
      copy.className="olonRankPreviewStudent";
      const user=state.users.find(u=>u.id===item?.student_id);
      const label=document.createElement("strong");
      label.textContent=item?(user?.full_name||"Estudiante registrado"):"Puesto disponible";
      const note=document.createElement("small");
      note.textContent=item?
        (item.published
          ? (item.photo_consent_confirmed ? "Publicado · Foto autorizada" : "Publicado · Foto pendiente de autorización")
          : "Borrador privado")
        : "Sin resultados registrados";
      copy.append(label,note);
      const pct=document.createElement("strong");
      pct.className="olonRankPreviewPercent";
      pct.textContent=item?(Number(item.return_pct)>0?"+":"")+Number(item.return_pct).toFixed(2)+"%":"—";
      row.append(marker,copy,pct);
      holder.append(row);
    }
  }
  async function loadAdmin(){
    if(!activeAdmin())return;
    const period=$("olonRankPeriod").value;
    const key=selectedAdminKey();
    if(!validPeriodKey(period,key)){
      showStatus("olonRankFeedback","Selecciona un período válido.",true);return;
    }
    showStatus("olonRankFeedback","Consultando TOP 3...");
    try{
      const {data,error}=await supabaseClient.from("olon_leaderboard")
        .select("rank,student_id,return_pct,consent_confirmed,published,photo_consent_confirmed")
        .eq("period_type",period).eq("period_key",key).order("rank",{ascending:true});
      if(error)throw error;
      // Refresh selectors before applying saved ranks; otherwise .value can
      // silently stay empty when options have not loaded on a slow connection.
      if(!state.users.length)await loadAdminUsers();
      for(let rank=1;rank<=3;rank++){
        const entry=(data||[]).find(row=>Number(row.rank)===rank);
        $("olonRankStudent"+rank).value=entry?.student_id||"";
        $("olonRankPct"+rank).value=entry?.return_pct==null?"":String(entry.return_pct);
      }
      $("olonRankConsent").checked=false;
      const publishedEntries=(data||[]).filter(item=>item.published);
      const allPhotoApproved=publishedEntries.length>0 && publishedEntries.every(item=>item.photo_consent_confirmed);
      $("olonRankPhotoConsent").checked=allPhotoApproved;
      $("olonRankSavePhotos").disabled=publishedEntries.length===0;
      showStatus("olonRankPhotoStatus", publishedEntries.length===0
        ? "Publica el ranking antes de autorizar fotos."
        : allPhotoApproved
          ? "Fotos autorizadas para el TOP 3 actual. Se mostrarán las fotos guardadas en cada perfil."
          : "Hay fotos pendientes de autorización. Marca la casilla y pulsa «Guardar permiso de fotos» cuando tengas el consentimiento.");
      showAdminPreview(data||[],period,key);
      const drafts=(data||[]).filter(entry=>!entry.published);
      const published=(data||[]).filter(entry=>entry.published);
      void loadRankCandidates();
      showStatus("olonRankFeedback",drafts.length
        ? "Borrador calculado: "+drafts.length+" puesto(s) para "+periodLabel(period,key)+". No visible a los estudiantes hasta confirmar su autorización y pulsar Publicar TOP 3."
        : published.length
        ? "Ranking publicado: "+published.length+" puesto(s) para "+periodLabel(period,key)+"."
        : "Aún no hay puestos para "+periodLabel(period,key)+".");
    }catch(err){
      const preview=$("olonRankPreviewStatus");
      if(preview)preview.textContent="Error al consultar";
      showStatus("olonRankFeedback","No se pudo consultar este ranking.",true);
      console.warn("[OLON TOP 3] Admin load",err);
    }
  }
  async function savePhotos(){
    if(!activeAdmin()||state.isSaving)return;
    const period=$("olonRankPeriod").value;
    const key=selectedAdminKey();
    if(!validPeriodKey(period,key)){
      showStatus("olonRankPhotoStatus","Elige un período válido.",true);
      return;
    }
    const approved=$("olonRankPhotoConsent").checked;
    if(approved&&!window.confirm("¿Confirmas que todos los estudiantes publicados en este TOP 3 autorizaron mostrar sus fotos de perfil a los miembros del portal?")){
      return;
    }
    state.isSaving=true;
    $("olonRankSavePhotos").disabled=true;
    showStatus("olonRankPhotoStatus",approved?"Autorizando las fotos...":"Retirando las fotos...");
    try{
      // Modify only the photo consent; existing ranks, percentages and names remain intact.
      const {data,error}=await supabaseClient.from("olon_leaderboard")
        .update({photo_consent_confirmed:approved})
        .eq("period_type",period).eq("period_key",key)
        .eq("published",true).eq("consent_confirmed",true)
        .select("rank,photo_consent_confirmed");
      if(error)throw error;
      if(!data?.length)throw new Error("No hay puestos publicados o no tienes permisos para editarlos.");
      await loadAdmin();
      if(period===state.selected&&key===currentKey(period))await loadPublic(period);
      showStatus("olonRankPhotoStatus",approved
        ? "Fotos autorizadas y guardadas. El TOP 3 ya puede mostrar las fotos de perfil de los estudiantes."
        : "Permiso retirado. El ranking mostrará las iniciales.");
    }catch(error){
      showStatus("olonRankPhotoStatus","No se pudo guardar el permiso de fotos: "+String(error?.message||"Error desconocido"),true);
    }finally{
      state.isSaving=false;
      $("olonRankSavePhotos").disabled=false;
    }
  }

  function getEntries(){
    const entries=[];
    for(let rank=1;rank<=3;rank++){
      const studentId=$("olonRankStudent"+rank).value;
      const field=$("olonRankPct"+rank);
      if(!studentId){
        if(field.value.trim())throw Error("Selecciona estudiante para el puesto "+rank+".");
        continue;
      }
      if(!field.value.trim())throw Error("Introduce el porcentaje del puesto "+rank+".");
      const pct=Number(field.value);
      if(!Number.isFinite(pct)||pct< -100||pct>100000)
        throw Error("El porcentaje del puesto "+rank+" no es válido.");
      entries.push({rank:rank,student_id:studentId,return_pct:pct});
    }
    if(new Set(entries.map(e=>e.student_id)).size!==entries.length)
      throw Error("No puedes repetir el mismo estudiante.");
    // Explicit opt-in: photos do not appear from historical publication consent alone.
    const photosAllowed=$("olonRankPhotoConsent").checked;
    return entries.map(entry=>({...entry,photo_consent_confirmed:photosAllowed}));
  }
  async function saveAdmin(clear=false){
    if(!activeAdmin()||state.isSaving)return;
    const period=$("olonRankPeriod").value,key=selectedAdminKey();
    if(!validPeriodKey(period,key)){
      showStatus("olonRankFeedback","Período inválido.",true);return;
    }
    let entries=[];
    try{if(!clear)entries=getEntries();}
    catch(error){showStatus("olonRankFeedback",error.message,true);return;}
    if(entries.length>0&&!$("olonRankConsent").checked){
      showStatus("olonRankFeedback","Confirma la autorización de todos los estudiantes antes de publicar.",true);return;
    }
    if(clear&&!confirm("¿Retirar los tres puestos de "+periodLabel(period,key)+"?"))return;
    if(!clear&&entries.length===0){
      showStatus("olonRankFeedback","Selecciona al menos un estudiante, o utiliza Retirar ranking.",true);return;
    }
    state.isSaving=true;
    $("olonRankSave").disabled=true;
    $("olonRankClear").disabled=true;
    showStatus("olonRankFeedback",clear?"Retirando ranking...":"Publicando ranking...");
    try{
      const {data,error}=await supabaseClient.rpc("olon_replace_leaderboard",{
        p_period_type:period,p_period_key:key,p_entries:entries,
        p_consent_confirmed:entries.length>0
      });
      if(error)throw error;
      showStatus("olonRankFeedback",clear?"Ranking retirado correctamente.":"Ranking publicado: "+String(data)+" puesto(s).");
      await loadAdmin();
      if(period===state.selected&&key===currentKey(period))await loadPublic(period);
    }catch(err){
      showStatus("olonRankFeedback","Error al guardar: "+String(err.message||"Sin conexión."),true);
    }finally{
      state.isSaving=false;
      $("olonRankSave").disabled=false;
      $("olonRankClear").disabled=false;
    }
  }
  async function stageCandidate(studentId,percentage,period,key){
    if(!activeAdmin()||state.isSaving)return false;
    if(!periods.includes(period)||!validPeriodKey(period,key)){
      showStatus("olonRankFeedback","Elige una semana, mes o año para preparar el TOP 3.",true);
      return false;
    }
    const numeric=Number(percentage);
    if(!Number.isFinite(numeric)||numeric < -100||numeric > 100000){
      showStatus("olonRankFeedback","El porcentaje de rendimiento no es válido.",true);
      return false;
    }
    const periodField=$("olonRankPeriod"),keyField=$("olonRankKey");
    const changed=periodField.value!==period||selectedAdminKey()!==key;
    if(changed){
      periodField.value=period;
      adminPeriodFields();
      keyField.value=key;
    }
    await loadAdminUsers();
    if(changed)await loadAdmin();
    let slot=0;
    for(let i=1;i<=3;i++){
      if($("olonRankStudent"+i).value===studentId){slot=i;break;}
    }
    if(!slot){
      for(let i=1;i<=3;i++){
        if(!$("olonRankStudent"+i).value){slot=i;break;}
      }
    }
    if(!slot){
      showStatus("olonRankFeedback","Los tres puestos están ocupados. Retira un estudiante de la selección antes de agregar otro.",true);
      $("olonRankingAdmin")?.scrollIntoView({behavior:"smooth",block:"start"});
      return false;
    }
    const select=$("olonRankStudent"+slot);
    if(!Array.from(select.options).some(o=>o.value===studentId)){
      showStatus("olonRankFeedback","Este estudiante no tiene una cuenta activa para participar en el TOP 3.",true);
      return false;
    }
    select.value=studentId;
    $("olonRankPct"+slot).value=numeric.toFixed(2);
    $("olonRankConsent").checked=false;
    $("olonRankPhotoConsent").checked=false;
    showStatus("olonRankFeedback","Estudiante preparado en el puesto #"+slot+" con "+numeric.toFixed(2)+"%. Aún NO está publicado. Confirma el consentimiento y pulsa «Publicar TOP 3» cuando corresponda.");
    $("olonRankingAdmin")?.scrollIntoView({behavior:"smooth",block:"start"});
    return true;
  }
  window.olonRankingStageCandidate=stageCandidate;
  function init(){
    const board=$("olonLeaderboard"),manager=$("olonRankingAdmin");
    if(!board||!manager)return;
    board.querySelectorAll("[data-leaderboard-period]").forEach(button=>{
      button.addEventListener("click",()=>loadPublic(button.dataset.leaderboardPeriod));
      button.addEventListener("keydown",e=>{
        if(e.key!=="ArrowLeft"&&e.key!=="ArrowRight")return;
        e.preventDefault();
        const offset=e.key==="ArrowRight"?1:-1;
        const next=periods[(periods.indexOf(state.selected)+offset+periods.length)%periods.length];
        loadPublic(next);
        board.querySelector('[data-leaderboard-period="'+next+'"]')?.focus();
      });
    });
    $("olonRankPeriod").addEventListener("change",()=>{adminPeriodFields();void loadAdmin();});
    $("olonRankKey").addEventListener("change",()=>void loadAdmin());
    $("olonRankReload").addEventListener("click",async()=>{await loadAdminUsers();await loadAdmin();});
    $("olonRankSave").addEventListener("click",()=>saveAdmin(false));
    $("olonRankSavePhotos").addEventListener("click",savePhotos);
    $("olonRankClear").addEventListener("click",()=>saveAdmin(true));
    $("olonRankNav")?.addEventListener("click",async()=>{
      $("olonRankingAdmin").scrollIntoView({behavior:"smooth",block:"start"});
      await loadAdminUsers();await loadAdmin();
    });
    adminPeriodFields();
    // The login script toggles the portal's hidden class after fetching the profile.
    let previousVisibility=false,loadedAdmin=false;
    const updateVisibility=()=>{
      const portal=$("portal"),visible=portal&&!portal.classList.contains("hidden");
      if(visible&&!previousVisibility){
        loadPublic(state.selected);
      }
      if(!visible){
        loadedAdmin=false;
        state.fetchSeq++;
      }
      previousVisibility=!!visible;
      if(visible&&activeAdmin()&&!loadedAdmin){
        loadedAdmin=true;
        loadAdminUsers().then(()=>loadAdmin());
      }
    };
    const portal=$("portal");
    const observer=new MutationObserver(updateVisibility);
    observer.observe(portal,{attributes:true,attributeFilter:["class"]});
    updateVisibility();
    // Recheck after authentication state updates that do not touch portal classes.
    document.addEventListener("click",event=>{
      if(!event.target?.closest?.("[data-page='dashboard']"))return;
      if(!$("portal").classList.contains("hidden"))loadPublic(state.selected);
    });
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})();