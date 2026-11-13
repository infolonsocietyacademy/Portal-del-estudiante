/* OLON Society Academy — TOP 3 automático con cuentas MT conectadas y sincronizadas.
   Los historiales antiguos permanecen archivados; no influyen en el podio activo.
   Los nombres se muestran según la preferencia de privacidad existente. */
(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const periods=["weekly","monthly","annual"];
  const state={publicPeriod:"weekly",publicRequest:0,adminRequest:0,adminReady:false,owner:null,nameRequest:0};
  const pad=n=>String(n).padStart(2,"0");
  const logged=()=>typeof currentUser!=="undefined"&&!!currentUser;
  const admin=()=>logged()&&typeof isAdminUser==="function"&&isAdminUser(currentUser)&&
    String(currentUser.status||"").toLowerCase()==="active";
  const visible=()=>logged()&&!$("portal")?.classList.contains("hidden");
  function todayPR(){
    const p=new Intl.DateTimeFormat("en-US",{timeZone:"America/Puerto_Rico",
      year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
    const get=k=>Number(p.find(x=>x.type===k)?.value||0);
    return {y:get("year"),m:get("month"),d:get("day")};
  }
  function currentKey(period){
    const {y,m,d}=todayPR();
    if(period==="annual")return String(y);
    if(period==="monthly")return y+"-"+pad(m);
    const date=new Date(Date.UTC(y,m-1,d));
    date.setUTCDate(date.getUTCDate()+4-(date.getUTCDay()||7));
    const year=date.getUTCFullYear();
    const jan=new Date(Date.UTC(year,0,1));
    return year+"-W"+pad(Math.ceil((((date-jan)/86400000)+1)/7));
  }
  function valid(period,key){
    return period==="weekly"?/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(key):
      period==="monthly"?/^\d{4}-(0[1-9]|1[0-2])$/.test(key):
      period==="annual"&&/^\d{4}$/.test(key);
  }
  const label=(period,key)=>(period==="weekly"?"Semana ":period==="monthly"?"Mes ":"Año ")+key;
  const percent=value=>(Number(value)>0?"+":"")+Number(value).toLocaleString("es-PR",
    {minimumFractionDigits:2,maximumFractionDigits:2})+"%";
  function initials(name){
    if(/^Trader OLON #/.test(String(name)))return "OL";
    return String(name||"?").trim().split(/\s+/).slice(0,2)
      .map(part=>part[0]).join("").toUpperCase()||"?";
  }
  async function getTop(period,key){
    const {data,error}=await supabaseClient.rpc("olon_automatic_top3",{
      p_period_type:period,p_period_key:key
    });
    if(error)throw error;
    return data||[];
  }
  function renderPodium(records,period,key){
    const holder=$("olonLeaderboard");if(!holder)return;
    const lookup=new Map(records.map(r=>[Number(r.rank),r]));
    for(const rank of [1,2,3]){
      const card=holder.querySelector('[data-leaderboard-rank="'+rank+'"]');
      if(!card)continue;
      const r=lookup.get(rank);
      card.classList.toggle("isEmpty",!r);
      card.querySelector("[data-top-name]").textContent=r?.display_name||"Sin clasificar";
      const score=card.querySelector("[data-top-percent]");
      score.textContent=r?percent(r.return_pct):"—";
      score.classList.toggle("isNegative",Boolean(r)&&Number(r.return_pct)<0);
      score.classList.toggle("isPositive",Boolean(r)&&Number(r.return_pct)>=0);
      const img=card.querySelector("[data-top-avatar]");
      const fallback=card.querySelector("[data-top-initials]");
      card.dataset.avatarStudent=r?.student_id||"";
      if(img){img.hidden=true;img.removeAttribute("src");}
      if(fallback){fallback.hidden=false;fallback.textContent=r?initials(r.display_name):"—";}
    }
    $("olonLeaderboardPeriod").textContent=label(period,key);
    $("olonLeaderboardEmpty").hidden=records.length>0;
    if(records.length===0)$("olonLeaderboardEmpty").textContent="Aún no hay cuentas MT conectadas, sincronizadas y elegibles para este período.";
  }
  async function loadPodiumPhotos(records,request){
    // Fetch only uploaded photos belonging to real-name, currently ranked students.
    // Storage remains private; signed URLs are scoped and short-lived.
    const ids=[...new Set(records.filter(row=>row.student_id&&row.display_name&&
      !/^Trader OLON #/.test(row.display_name)).map(row=>row.student_id))];
    if(!ids.length)return;
    try{
      const {data,error}=await supabaseClient.from("olon_profile_media")
        .select("student_id,avatar_path").in("student_id",ids);
      if(error)throw error;
      if(request!==state.publicRequest||!visible())return;
      const byUser=new Map((data||[]).map(row=>[row.student_id,row.avatar_path]));
      await Promise.all(records.map(async row=>{
        if(!row.student_id||!ids.includes(row.student_id))return;
        const path=byUser.get(row.student_id);
        if(!path||!path.startsWith(row.student_id+"/avatar/"))return;
        try{
          const {data:asset,error:assetError}=await supabaseClient.storage
            .from("olon-profile-media").createSignedUrl(path,600);
          if(assetError||!asset?.signedUrl||request!==state.publicRequest||!visible())return;
          const card=$("olonLeaderboard")?.querySelector(
            '[data-leaderboard-rank="'+Number(row.rank)+'"]');
          if(!card||card.dataset.avatarStudent!==row.student_id)return;
          const img=card.querySelector("[data-top-avatar]");
          const fallback=card.querySelector("[data-top-initials]");
          if(!img||!fallback)return;
          const probe=new Image();
          probe.onload=()=>{
            if(request!==state.publicRequest||!visible()||
              card.dataset.avatarStudent!==row.student_id)return;
            img.src=asset.signedUrl;
            img.hidden=false;
            fallback.hidden=true;
          };
          probe.onerror=()=>{
            if(request!==state.publicRequest||card.dataset.avatarStudent!==row.student_id)return;
            img.hidden=true;fallback.hidden=false;img.removeAttribute("src");
          };
          probe.src=asset.signedUrl;
        }catch(e){console.warn("[OLON TOP 3] Foto no disponible",e?.message);}
      }));
    }catch(e){
      console.warn("[OLON TOP 3] Fotos no disponibles",e?.message);
    }
  }
  async function publicRanking(period=state.publicPeriod){
    if(!visible()||!periods.includes(period))return;
    const request=++state.publicRequest;
    state.publicPeriod=period;
    for(const btn of document.querySelectorAll("[data-leaderboard-period]")){
      const active=btn.dataset.leaderboardPeriod===period;
      btn.classList.toggle("active",active);
      btn.setAttribute("aria-selected",String(active));
      btn.tabIndex=active?0:-1;
    }
    $("olonLeaderboardLoading").hidden=false;
    $("olonLeaderboardError").hidden=true;
    const key=currentKey(period);
    try{
      const rows=await getTop(period,key);
      if(request!==state.publicRequest||!visible())return;
      renderPodium(rows,period,key);
      void loadPodiumPhotos(rows,request);
    }catch(error){
      if(request!==state.publicRequest)return;
      // Never keep previously displayed ranks if a new period fails to load.
      renderPodium([],period,key);
      $("olonLeaderboardEmpty").hidden=true;
      $("olonLeaderboardError").textContent="No fue posible verificar el TOP 3. Reintenta la consulta.";
      $("olonLeaderboardError").hidden=false;
      console.warn("[OLON Auto TOP3] Podio",error?.message);
    }finally{
      if(request===state.publicRequest)$("olonLeaderboardLoading").hidden=true;
    }
  }
  function adminFields(){
    const period=$("olonRankPeriod")?.value;
    const input=$("olonRankKey");
    if(!input||!periods.includes(period))return;
    input.type=period==="weekly"?"week":period==="monthly"?"month":"number";
    input.min=period==="annual"?"2020":"";
    input.max=period==="annual"?"2100":"";
    input.step=period==="annual"?"1":"";
    input.value=currentKey(period);
  }
  function renderAdmin(rows,period,key){
    const holder=$("olonRankPreviewRows");
    const status=$("olonRankPreviewStatus");
    if(!holder||!status)return;
    holder.replaceChildren();
    const byRank=new Map(rows.map(row=>[Number(row.rank),row]));
    status.textContent=label(period,key)+" · "+rows.length+" clasificado(s)";
    for(let rank=1;rank<=3;rank++){
      const item=byRank.get(rank);
      const row=document.createElement("div");row.className="olonRankPreviewItem"+(item?" hasEntry":"");
      const medal=document.createElement("span");medal.className="olonRankPreviewMedal";
      medal.textContent=rank===1?"🥇":rank===2?"🥈":"🥉";
      const detail=document.createElement("span");detail.className="olonRankPreviewStudent";
      const name=document.createElement("strong");name.textContent=item?.display_name||"Puesto disponible";
      const note=document.createElement("small");
      note.textContent=item?"Calculado automáticamente con los trades registrados":"No hay otro estudiante elegible";
      detail.append(name,note);
      const score=document.createElement("strong");score.className="olonRankPreviewPercent";
      score.textContent=item?percent(item.return_pct):"—";
      score.classList.toggle("isNegative",Boolean(item)&&Number(item.return_pct)<0);
      score.classList.toggle("isPositive",Boolean(item)&&Number(item.return_pct)>=0);
      row.append(medal,detail,score);
      holder.append(row);
    }
  }
  async function adminRanking(){
    if(!visible()||!admin())return;
    const period=$("olonRankPeriod")?.value,key=String($("olonRankKey")?.value||"").trim();
    const msg=$("olonRankFeedback"),request=++state.adminRequest;
    if(!valid(period,key)){
      if(msg)msg.textContent="Selecciona un período válido.";
      return;
    }
    if(msg)msg.textContent="Calculando el TOP 3 con cuentas MT verificadas y sincronizadas…";
    try{
      const rows=await getTop(period,key);
      if(request!==state.adminRequest||!admin())return;
      renderAdmin(rows,period,key);
      if(msg)msg.textContent=rows.length?
        "Clasificación automática: "+rows.length+" puesto(s). No requiere aprobación ni publicación.":
        "No hay cuentas MT activas y sincronizadas con operaciones cerradas y capital válido en este período.";
    }catch(error){
      if(request!==state.adminRequest)return;
      renderAdmin([],period,key);
      if(msg)msg.textContent="No se pudo verificar el TOP 3: "+String(error?.message||"Revisa tu conexión.");
      console.warn("[OLON Auto TOP3] Administración",error?.message);
    }
  }
  async function loadNamePreference(){
    const input=$("olonRankingShowName"),feedback=$("olonRankingNameFeedback");
    if(!input||!logged()||admin())return;
    const uid=currentUser.id,request=++state.nameRequest;
    input.disabled=true;
    try{
      const {data,error}=await supabaseClient.from("olon_ranking_name_preferences")
        .select("show_name").eq("student_id",uid).maybeSingle();
      if(error)throw error;
      if(request!==state.nameRequest||currentUser?.id!==uid)return;
      input.checked=data?.show_name!==false;
      if(feedback)feedback.hidden=true;
    }catch(error){
      if(feedback){feedback.textContent="No se pudo consultar tu preferencia de nombre.";feedback.hidden=false;}
    }finally{if(request===state.nameRequest)input.disabled=false;}
  }
  async function updateNamePreference(){
    const input=$("olonRankingShowName"),feedback=$("olonRankingNameFeedback");
    if(!input||!logged()||admin())return;
    const requested=input.checked,uid=currentUser.id;
    input.disabled=true;
    try{
      const {error}=await supabaseClient.from("olon_ranking_name_preferences")
        .upsert({student_id:uid,show_name:requested,updated_at:new Date().toISOString()},{onConflict:"student_id"});
      if(error)throw error;
      if(feedback){
        feedback.textContent=requested?"Tu nombre aparecerá si entras al TOP 3.":
          "Tu nombre estará oculto; aparecerás como Trader OLON.";
        feedback.hidden=false;
      }
      await publicRanking(state.publicPeriod);
    }catch(error){
      input.checked=!requested;
      if(feedback){feedback.textContent="No se pudo guardar la preferencia. Reintenta.";feedback.hidden=false;}
    }finally{input.disabled=false;}
  }
  function init(){
    const portal=$("portal"),podium=$("olonLeaderboard");
    if(!portal||!podium)return;
    podium.querySelectorAll("[data-leaderboard-period]").forEach(button=>{
      button.addEventListener("click",()=>void publicRanking(button.dataset.leaderboardPeriod));
    });
    const period=$("olonRankPeriod"),key=$("olonRankKey"),reload=$("olonRankReload");
    if(period&&key){
      adminFields();
      period.addEventListener("change",()=>{adminFields();void adminRanking();});
      key.addEventListener("change",()=>void adminRanking());
      reload?.addEventListener("click",()=>void adminRanking());
      $("olonRankNav")?.addEventListener("click",()=>void adminRanking());
    }
    $("olonRankingShowName")?.addEventListener("change",()=>void updateNamePreference());
    let lastId=null,lastVisible=false;
    function synchronize(){
      const shown=visible(),uid=shown?currentUser.id:null;
      if(shown&&(!lastVisible||uid!==lastId)){
        void publicRanking(state.publicPeriod);
        if(admin()){
          void adminRanking();
        }else{
          void loadNamePreference();
        }
      }
      if(!shown){state.publicRequest++;state.adminRequest++;state.nameRequest++;}
      lastVisible=shown;lastId=uid;
    }
    new MutationObserver(synchronize).observe(portal,{attributes:true,attributeFilter:["class"]});
    document.addEventListener("visibilitychange",()=>{
      if(!document.hidden&&visible()){
        void publicRanking();
        if(admin())void adminRanking();
      }
    });
    // Poll while the portal is open; no expensive background listeners or heavy libraries.
    setInterval(()=>{
      if(document.hidden||!visible())return;
      void publicRanking();
      if(admin()&&!$("admin")?.classList.contains("hidden"))void adminRanking();
    },30000);
    synchronize();
    window.olonLeaderboardRefresh=()=>{
      if(!visible())return;
      void publicRanking();
      if(admin())void adminRanking();
    };
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})();
