/* OLON Society Academy | Admin Workspace — November 2026
   Consolidated UI controller. Does not replace Supabase Auth/RLS permissions. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const norm = v => String(v == null ? "" : v).trim().toLowerCase();
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  })[c]);
  const uuid = v => /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(String(v || ""));
  const fields = "id,email,full_name,access_code,role,plan,status,next_payment_date,created_at";
  const states = [["pending","Pendiente"],["active","Activo"],["suspended","Suspendido"],["expired","Expirado"]];
  let busy = false;
  let loadPromise = null;
  let autoTimer = null;
  let lastUsers = [];

  function authorized() {
    return typeof currentUser !== "undefined" && !!currentUser &&
      typeof isAdminUser === "function" && isAdminUser(currentUser) &&
      norm(currentUser.status) === "active";
  }
  function listUsers() {
    return lastUsers;
  }
  function students() {
    return listUsers().filter(u => norm(u.role) === "student");
  }
  function findStudent(id) {
    return students().find(u => u.id === id && uuid(id));
  }
  function setText(id,value) {
    const e=$(id); if(e)e.textContent=String(value);
  }
  function notify(message, error=false) {
    const el=$("adminActionFeedback");
    if(el) {
      el.hidden=false; el.textContent=message;
      el.className="adminActionFeedback"+(error?" error":" success");
    }
    setText("adminConnectionState",error?"● Revisar conexión":"● Conectado a Supabase");
    const state=$("adminConnectionState");
    if(state)state.classList.toggle("failure",error);
    if(error)console.warn("[OLON Admin]", message);
  }
  function errorMessage(err) {
    const msg=String(err?.message||"Error de conexión.");
    if(/row.level security|permission denied|42501|403/i.test(msg)) {
      return "Supabase rechazó esta acción por permisos. Revisa la sesión del administrador y las políticas RLS.";
    }
    if(/42P01|PGRST205|not found/i.test(msg)) {
      return "No se encontró la tabla necesaria. Comprueba las tablas de Supabase.";
    }
    if(/failed to fetch|network|fetch failed/i.test(msg)) {
      return "No hay comunicación con Supabase. Comprueba internet e inténtalo de nuevo.";
    }
    return msg;
  }
  function setLoading(value) {
    const btn=$("adminRefreshBtn"); if(btn){btn.disabled=value;btn.textContent=value?"Actualizando…":"↻ Actualizar datos";}
    const approve=$("adminApproveAllBtn"); if(approve)approve.disabled=value||busy||!students().some(u=>norm(u.status)==="pending");
  }
  function paymentRisk(user) {
    const status=norm(user.status);
    if(status==="deleting")return {text:"Eliminación pendiente",kind:"bad"};
    if(status==="suspended"||status==="expired")return {text:"Revisar acceso",kind:"bad"};
    if(status==="pending")return {text:"Por aprobar",kind:"warn"};
    if(!user.next_payment_date)return {text:"Sin fecha",kind:"neutral"};
    const payment=getVipPayment(user.next_payment_date);
    if(!payment)return {text:"Fecha inválida",kind:"neutral"};
    const {days}=payment;
    if(days<0)return {text:"Vencido "+Math.abs(days)+"d",kind:"bad"};
    if(days<=5)return {text:days===0?"Vence hoy":"Vence en "+days+"d",kind:"warn"};
    return {text:"Al día",kind:"good"};
  }
  function selector(id,selected,items,method,label) {
    return '<select class="adminInlineSelect" aria-label="'+esc(label)+'" onchange="olonAdmin.'+method+'(\''+id+'\',this.value)">'+
      items.map(([value,text])=>'<option value="'+esc(value)+'"'+(value===selected?" selected":"")+'>'+esc(text)+'</option>').join("")+'</select>';
  }
  function actionButtons(u) {
    const id=String(u.id);
    if(norm(u.role)==="admin")return '<span class="adminRoleProtected">● Cuenta protegida</span>';
    if(!uuid(id))return '<span class="adminRoleProtected">ID inválido</span>';
    const state=norm(u.status);
    const remove='<button type="button" class="adminSmallButton adminDeleteStudent" data-manage-account="delete" data-student-id="'+id+'">'+
      (state==="deleting"?"Reintentar eliminación":"Eliminar estudiante")+'</button>';
    if(state==="deleting")return '<div class="adminRowActions">'+remove+'</div>';
    return '<div class="adminRowActions">'+
      (state==="pending"?'<button type="button" class="adminSmallButton approve" onclick="olonAdmin.status(\''+id+'\',\'active\')">✓ Aprobar</button>':'')+
      (state==="suspended"?'<button type="button" class="adminSmallButton" onclick="olonAdmin.status(\''+id+'\',\'pending\')">Reabrir</button>':
       '<button type="button" class="adminSmallButton" onclick="olonAdmin.status(\''+id+'\',\'suspended\')">Suspender</button>')+
      '<button type="button" class="adminSmallButton" data-billing-student="'+id+'">Facturar</button>'+
      '<button type="button" class="adminSmallButton" data-manage-account="reset" data-student-id="'+id+'">Cambiar contraseña</button>'+remove+
      '</div>';
  }
  function row(u) {
    const risk=paymentRisk(u);
    const name=esc(u.full_name||"Sin nombre"), email=esc(u.email||"Sin email");
    const avatar=esc(String(u.full_name||"O").split(/\s+/).map(w=>w.charAt(0)).join("").slice(0,2).toUpperCase());
    const safeId=String(u.id||"");
    const isRoot=norm(u.role)==="admin";
    const deleting=norm(u.status)==="deleting";
    const membership=isRoot?'<span class="adminRoleProtected">Administrador</span>':'<span class="adminStateTag active">VIP</span>';
    const state=isRoot?'<span class="adminStateTag active">Activo · Admin</span>':deleting?'<span class="adminStateTag suspended">Bloqueado</span>':
      selector(safeId,norm(u.status)==="approved"?"active":norm(u.status),states,"status","Acceso de "+String(u.full_name||"estudiante"));
    const pay=isRoot||deleting?'—':'<div class="adminPaymentCell"><input type="date" class="adminDateInput" aria-label="Fecha próximo pago de '+name+'" value="'+esc(u.next_payment_date||"")+'"><button type="button" class="adminDateSave" title="Guardar fecha de pago" onclick="olonAdmin.payment(\''+safeId+'\',this)">Guardar</button></div>';
    return '<tr><td><div class="adminStudent"><span class="adminAvatar">'+avatar+'</span><div><b>'+name+'</b><small>'+email+'</small></div></div></td>'+
      '<td><span class="adminCode">'+esc(u.access_code||"—")+'</span></td>'+
      '<td>'+membership+'</td><td>'+state+'</td><td>'+pay+'</td>'+
      '<td><span class="adminRisk '+risk.kind+'">'+esc(risk.text)+'</span></td><td>'+actionButtons(u)+'</td></tr>';
  }
  function mobile(u) {
    const id=String(u.id),root=norm(u.role)==="admin",deleting=norm(u.status)==="deleting",risk=paymentRisk(u);
    const initials=esc(String(u.full_name||"O").split(/\s+/).map(w=>w.charAt(0)).join("").slice(0,2).toUpperCase());
    return '<article class="adminStudentMobile"><div class="adminStudentMobileTop"><span class="adminAvatar">'+initials+'</span><div><b>'+esc(u.full_name||"Sin nombre")+'</b><small>'+esc(u.email||"Sin correo")+'</small></div>'+
      '<span class="adminRisk '+risk.kind+'">'+esc(risk.text)+'</span></div>'+
      '<div class="adminStudentMobileData"><span>Código<strong>'+esc(u.access_code||"—")+'</strong></span><span>Membresía<strong>'+(root?"Administrador":"VIP")+'</strong></span></div>'+
      (deleting?'<div class="adminRoleProtected">Acceso bloqueado</div>':!root?'<div class="adminStudentMobileFields"><label>Acceso'+selector(id,norm(u.status)==="approved"?"active":norm(u.status),states,"status","Acceso")+'</label></div>'+
      '<div class="adminStudentMobilePayment"><label>Próximo pago<input type="date" class="adminDateInput" value="'+esc(u.next_payment_date||"")+'"></label><button type="button" class="adminSmallButton" onclick="olonAdmin.payment(\''+id+'\',this)">Guardar fecha</button></div>':'<div class="adminRoleProtected">Cuenta administradora protegida</div>')+
      '<div class="adminStudentMobileActions">'+actionButtons(u)+'</div></article>';
  }
  function visibleUsers() {
    const search=norm($("adminSearch")?.value);
    const status=$("adminStatusFilter")?.value||"all";
    return students().filter(u=>{
      if(status!=="all"&&norm(u.status)!==status)return false;
      if(search&&!norm([u.full_name,u.email,u.access_code].join(" ")).includes(search))return false;
      return true;
    });
  }
  function renderTable() {
    const body=$("usersBody"),mobileBox=$("usersMobileCards");
    if(!body)return;
    const users=visibleUsers();
    setText("adminCountPill",users.length+" resultado"+(users.length===1?"":"s"));
    body.innerHTML=users.length?users.map(row).join(""):'<tr><td colspan="7" class="adminEmptyTable">No hay estudiantes que coincidan con estos filtros.</td></tr>';
    if(mobileBox)mobileBox.innerHTML=users.length?users.map(mobile).join(""):'<div class="adminEmptyTable">No hay estudiantes para mostrar.</div>';
    const currentFilter=$("adminStatusFilter")?.value||"all";
    document.querySelectorAll("[data-admin-filter]").forEach(btn=>{
      const active=btn.getAttribute("data-admin-filter")===currentFilter;
      btn.classList.toggle("active",active);
      btn.setAttribute("aria-pressed",String(active));
    });
  }
  function updateStats() {
    const users=students();
    const count=state=>users.filter(u=>norm(u.status)===state).length;
    const pending=count("pending");
    setText("adminTotalUsers",users.length);
    setText("adminActiveUsers",count("active")+count("approved"));
    setText("adminPendingUsers",pending);
    setText("adminSuspendedUsers",count("suspended"));
    setText("adminUpcomingPayments",users.filter(u=>["active","approved"].includes(norm(u.status))&&paymentRisk(u).kind==="warn").length);
    setText("adminPendingCountInline",pending);
    setText("adminApproveAllBtn",pending?"✓ Aprobar "+pending+" pendiente"+(pending===1?"":"s"):"✓ Sin solicitudes");
    const approve=$("adminApproveAllBtn");if(approve)approve.disabled=pending===0||busy;
  }
  function renderAlerts() {
    const el=$("adminAlertList");if(!el)return;
    const users=students();
    const pending=users.filter(u=>norm(u.status)==="pending").length;
    const suspended=users.filter(u=>norm(u.status)==="suspended").length;
    const unpaid=users.filter(u=>paymentRisk(u).kind==="bad"&&norm(u.status)==="active").length;
    const soon=users.filter(u=>paymentRisk(u).kind==="warn"&&norm(u.status)==="active").length;
    const alerts=[];
    if(pending)alerts.push('<div class="adminAlertItem warn"><span><b>◷ '+pending+'</b> solicitud(es) por aprobar</span><button type="button" class="adminSmallButton" onclick="olonAdmin.filter(\'pending\')">Revisar</button></div>');
    if(unpaid)alerts.push('<div class="adminAlertItem bad"><span><b>! '+unpaid+'</b> fecha(s) de pago vencidas</span><button type="button" class="adminSmallButton" onclick="olonAdmin.filter(\'active\')">Estudiantes</button></div>');
    if(soon)alerts.push('<div class="adminAlertItem warn"><span><b>↗ '+soon+'</b> pago(s) próximos</span><button type="button" class="adminSmallButton" onclick="olonAdmin.filter(\'active\')">Consultar</button></div>');
    if(suspended)alerts.push('<div class="adminAlertItem"><span><b>⊘ '+suspended+'</b> estudiante(s) suspendidos</span><button type="button" class="adminSmallButton" onclick="olonAdmin.filter(\'suspended\')">Consultar</button></div>');
    if(!alerts.length)alerts.push('<div class="adminAlertItem good">✓ No hay alertas pendientes. El panel está al día.</div>');
    el.innerHTML=alerts.join("");
  }
  async function loadChatMetric(){
    if(!authorized())return;
    try{
      const {count,error}=await supabaseClient.from("chat_messages").select("id",{head:true,count:"exact"}).eq("sender_role","student").eq("is_read",false);
      if(error)throw error;
      setText("adminChatMetric",Number(count||0));setText("adminNavUnread",Number(count||0));
    }catch(e){console.warn("Chat metric",e);setText("adminChatMetric","—");setText("adminNavUnread","—");}
  }
  async function refresh() {
    if(!authorized()) { notify("Acceso exclusivo del administrador.",true);return; }
    if(loadPromise)return loadPromise;
    setLoading(true);
    setText("adminConnectionState","◌ Sincronizando…");
    loadPromise=(async()=>{
      try {
        const {data,error}=await supabaseClient.from("profiles")
          .select(fields).order("created_at",{ascending:false});
        if(error)throw error;
        lastUsers=data||[];
        // Preserve legacy globals used by other portal modules.
        window.cachedUsers=lastUsers;
        if(typeof cachedUsers!=="undefined")cachedUsers=lastUsers;
        updateStats();renderTable();renderAlerts();
        window.olonBilling?.setStudents(lastUsers);
        setText("adminLastSync","Actualizado "+new Date().toLocaleTimeString("es-PR",{hour:"numeric",minute:"2-digit"}));
        setText("adminConnectionState","● Datos sincronizados");
        const el=$("adminConnectionState");if(el)el.classList.remove("failure");
        await loadChatMetric();
        return lastUsers;
      }catch(e){
        const reason=errorMessage(e);
        notify("No se pudieron cargar las cuentas. "+reason,true);
        // Do not erase the prior list on an intermittent network failure.
        throw e;
      }finally{
        loadPromise=null;setLoading(false);
      }
    })();
    return loadPromise;
  }
  async function save(id,field,value,expected) {
    if(!authorized()){notify("No tienes una sesión de administrador activa.",true);return false;}
    if(busy)return false;
    const target=findStudent(id);
    if(!target){notify("Cuenta no válida o protegida. Actualiza el directorio.",true);return false;}
    if(field==="status"&&!states.some(([s])=>s===value)){notify("Estado no permitido.",true);return false;}
    if(field==="next_payment_date"&&value&&!getVipPayment(value)){notify("La fecha no es válida.",true);return false;}
    const newValue=field==="next_payment_date"?(value||null):value;
    if((target[field]||null)===(newValue||null))return true;
    busy=true;setLoading(true);
    try {
      const {data,error}=await supabaseClient.from("profiles")
        .update({[field]:newValue}).eq("id",id).eq("role","student")
        .select("id,"+field).maybeSingle();
      if(error)throw error;
      if(!data||String(data[field]||"")!==String(newValue||""))throw Error("Supabase no confirmó el cambio. Revisa permisos de administrador.");
      // Refresh from the server after a successful write.
      await refresh();
      notify("✓ "+(expected||"Cambio")+" guardado y confirmado en Supabase.");
      return true;
    }catch(e) {
      notify("No se pudo guardar: "+errorMessage(e),true);
      renderTable();
      return false;
    }finally{busy=false;setLoading(false);}
  }
  async function setStatus(id,state){
    const u=findStudent(id);
    if(!u)return notify("No se encuentra el estudiante.",true);
    if(state==="suspended"&&!confirm("¿Suspender el acceso de "+(u.full_name||u.email||"este estudiante")+"?")){renderTable();return;}
    if(state==="active"&&norm(u.status)==="pending"&&!confirm("¿Aprobar el acceso de "+(u.full_name||u.email||"este estudiante")+"?")){renderTable();return;}
    await save(id,"status",state,"Estado de "+(u.full_name||"estudiante"));
  }
  async function setPayment(id,button){
    const input=button.closest(".adminPaymentCell, .adminStudentMobilePayment")?.querySelector("input[type=date]");
    const u=findStudent(id);if(!input||!u)return;
    await save(id,"next_payment_date",input.value,"Fecha de pago de "+(u.full_name||"estudiante"));
  }
  async function approveAll(){
    if(!authorized())return notify("Inicia sesión como administrador.",true);
    if(busy)return;
    const pending=students().filter(u=>norm(u.status)==="pending"&&uuid(u.id));
    if(!pending.length){notify("No hay estudiantes pendientes.",false);return;}
    if(!confirm("¿Aprobar las "+pending.length+" solicitudes pendientes? Tendrán acceso a su portal."))return;
    busy=true;setLoading(true);
    try{
      const {data,error}=await supabaseClient.from("profiles")
        .update({status:"active"}).in("id",pending.map(u=>u.id))
        .eq("role","student").eq("status","pending").select("id,status");
      if(error)throw error;
      const confirmed=new Set((data||[]).filter(x=>x.status==="active").map(x=>x.id));
      await refresh();
      if(confirmed.size!==pending.length)throw Error("Solo "+confirmed.size+" de "+pending.length+" aprobaciones fueron confirmadas. Revisa la lista restante.");
      notify("✓ "+confirmed.size+" estudiante(s) aprobados y confirmados por Supabase.");
    }catch(e){notify("Error de aprobación: "+errorMessage(e),true);}
    finally{busy=false;setLoading(false);}
  }
  function go(anchor){
    if(!authorized())return;
    const section=$(anchor);
    if(anchor==="adminBillingBlock"){
      window.olonBilling?.activate();
    }
    if(section)section.scrollIntoView({behavior:"smooth",block:"start"});
  }
  function filter(status){
    if(!authorized())return;
    const input=$("adminStatusFilter");
    if(input)input.value=status;
    renderTable();go("adminStudentsBlock");
  }
  function openChat() {
    if(!authorized())return;
    const nav=document.querySelector('.nav button[data-page="adminChat"]');
    if(typeof window.showPage==="function")window.showPage("adminChat",nav);
    if(typeof window.loadAdminChatInbox==="function")void window.loadAdminChatInbox();
  }
  function init() {
    if(autoTimer)clearInterval(autoTimer);
    autoTimer=setInterval(()=>{
      if(!authorized())return;
      if(!$("admin")||$("admin").classList.contains("hidden"))return;
      if(!document.hidden&&!busy)void refresh().catch(()=>{});
    },90000);
  }

  $("adminStudentsBlock").addEventListener("click",event=>{
    const button=event.target.closest("[data-manage-account]");
    if(!button||!authorized()||busy)return;
    const student=findStudent(button.dataset.studentId);
    if(student)window.olonRequests?.manageAccount(student,button.dataset.manageAccount);
  });

  window.olonAdmin={
    refresh,render:renderTable,filter,go,openChat,notify,
    status:setStatus,approveAll,
    payment:setPayment
  };
  // Legacy onclick handlers and inline listeners stay compatible.
  window.renderUsers=()=>refresh().catch(()=>{});
  window.renderAdminTable=renderTable;
  window.updateAdminMetrics=updateStats;
  window.renderAdminAlerts=renderAlerts;
  window.updateAdminChatMetric=loadChatMetric;
  window.filterAdminUsers=filter;
  window.updateUserStatus=setStatus;
  window.approveAllPendingUsers=approveAll;

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);
  else init();
})();
