// Chat page hook
document.addEventListener("DOMContentLoaded", function(){
  const originalShowPageForChat = typeof showPage === "function" ? showPage : null;
  if(originalShowPageForChat){
    window.showPage = function(id, btn){
      originalShowPageForChat(id, btn);
      if(id === "adminChat" && typeof loadAdminChatInbox === "function") loadAdminChatInbox();
    };
  }
});

// ===== OLON AUDIO ENGINE — REAL KEYBOARD SAMPLE (November 2026) =====
(function(){
  "use strict";
  const KEYBOARD_URL = "./assets/keyboard-click.mp3?v=20261107-keyboard-fix-2";
  let audioContext = null;
  let lastClick = 0;
  let lastKey = 0;
  let lastMessage = 0;
  let keyIndex = 0;
  const keyboardPool = [];

  function soundEnabled(){
    try { return localStorage.getItem("olon_sound_enabled") !== "false"; }
    catch { return true; }
  }

  function getCtx(){
    if(!audioContext){
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if(!AudioContextClass) return null;
      audioContext = new AudioContextClass();
    }
    return audioContext;
  }

  function unlockAudio(){
    try {
      const context = getCtx();
      if(context && context.state === "suspended"){
        context.resume().catch(() => {});
      }
    } catch(error){ /* Audio cannot prevent interaction. */ }
  }

  function tone(freq=520,duration=.05,volume=.025,type="sine",delay=0){
    if(!soundEnabled()) return;
    try{
      const ctx = getCtx();
      if(!ctx) return;
      if(ctx.state === "suspended") ctx.resume().catch(() => {});
      const when = ctx.currentTime + delay;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type=type;
      oscillator.frequency.setValueAtTime(freq,when);
      gain.gain.setValueAtTime(.0001,when);
      gain.gain.exponentialRampToValueAtTime(volume,when+.005);
      gain.gain.exponentialRampToValueAtTime(.0001,when+Math.max(.016,duration));
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(when);
      oscillator.stop(when+duration+.025);
    }catch(error){ /* Unsupported audio device. */ }
  }

  function createKeyboardSamples(){
    if(keyboardPool.length) return;
    if(typeof window.Audio !== "function") return;
    for(let i=0;i<5;i++){
      const audio = new Audio(KEYBOARD_URL);
      audio.preload="auto";
      keyboardPool.push(audio);
    }
    // Preload early so the first real user gesture can play immediately.
    keyboardPool[0].load();
  }

  function playKeyboardSample(volume=.80){
    if(!soundEnabled()) return false;
    try{
      createKeyboardSamples();
      if(!keyboardPool.length){
        tone(960,.035,.055,"triangle");
        return true;
      }
      const audio = keyboardPool[keyIndex++ % keyboardPool.length];
      audio.pause();
      try { audio.currentTime=0; } catch(error) {}
      audio.playbackRate=1;
      audio.volume=Math.max(0,Math.min(1,volume));
      // play() is called synchronously during click/keydown, before any await,
      // as required by iOS Safari and other gesture-restricted browsers.
      const promise = audio.play();
      if(promise && typeof promise.catch === "function"){
        promise.catch(() => tone(960,.035,.06,"triangle"));
      }
      return true;
    }catch(error){
      tone(960,.035,.06,"triangle");
      return true;
    }
  }

  function playMechanicalKeySound(){
    const now=Date.now();
    if(now-lastKey<38) return;
    lastKey=now;
    playKeyboardSample(.48);
  }

  function playBackspaceSound(){ playKeyboardSample(.50); }
  function playPasteSound(){ playKeyboardSample(.65); }
  function playHoverSound(){ /* Hover intentionally silent. */ }

  function playClickSound(){
    const now=Date.now();
    if(now-lastClick<75) return;
    lastClick=now;
    playKeyboardSample(.85);
  }

  function playPortalLoadingSound(){
    tone(250,.075,.016,"sine");
    tone(500,.075,.014,"triangle",.09);
  }

  function playNewMessageSound(){
    const now=Date.now();
    if(now-lastMessage<1200) return;
    lastMessage=now;
    tone(720,.075,.024,"sine");
    tone(980,.085,.021,"triangle",.09);
  }

  function testKeyboardSound(){
    if(!soundEnabled()) return false;
    // Explicit button interaction, no extra throttling.
    return playKeyboardSample(.95);
  }

  function setupAudioEvents(){
    createKeyboardSamples();
    // Only unlock once; no async unlock operation before the actual click sound.
    document.addEventListener("pointerdown",unlockAudio,{once:true,passive:true});
    document.addEventListener("touchstart",unlockAudio,{once:true,passive:true});

    document.addEventListener("click",function(e){
      if(e.target?.closest?.("#soundTestBtn")) return;
      if(e.target?.closest?.("button,a,[role='button'],.nav button,.calDay:not(.empty),.adminChatUser")){
        playClickSound();
      }
    },true);

    document.addEventListener("keydown",function(e){
      if(e.ctrlKey||e.metaKey||e.altKey||e.repeat) return;
      const target=e.target;
      const typing=target && (target.matches?.("input,textarea,[contenteditable='true']") || target.isContentEditable);
      if(typing){
        if(e.key.length===1) playMechanicalKeySound();
        else if(e.key==="Backspace"||e.key==="Delete") playBackspaceSound();
        else if(e.key==="Enter") playClickSound();
      } else if((e.key==="Enter"||e.key===" ") && target?.closest?.("button,a,[role='button']")){
        playClickSound();
      }
    });

    document.addEventListener("paste",function(e){
      const target=e.target;
      if(target?.matches?.("input,textarea,[contenteditable='true']")||target?.isContentEditable) playPasteSound();
    });
  }

  window.getOlonAudio=getCtx;
  window.unlockOlonAudio=unlockAudio;
  window.isSoundEnabled=soundEnabled;
  window.playOlonTone=tone;
  window.playMechanicalKeySound=playMechanicalKeySound;
  window.playBackspaceSound=playBackspaceSound;
  window.playPasteSound=playPasteSound;
  window.playHoverSound=playHoverSound;
  window.playClickSound=playClickSound;
  window.playPortalLoadingSound=playPortalLoadingSound;
  window.playNewMessageSound=playNewMessageSound;
  window.testOlonKeyboardSound=testKeyboardSound;

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",setupAudioEvents,{once:true});
  else setupAudioEvents();
})();

const SUPABASE_URL = "https://xanhhfashgkyrvphprts.supabase.co";
const SUPABASE_KEY = "sb_publishable_JQ9TWOn3GvY2nTth0JLHIQ_AtTgwz8B";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function showPortalLoader(message){
  const loader = $("olonLoader");
  loader.dataset.managed = "true";
  $("portalLoaderStatus").textContent = message;
  loader.hidden = false;
  $("auth").inert = true;
}

function hidePortalLoader(){
  $("olonLoader").hidden = true;
  $("auth").inert = false;
}

// Totales públicos agregados por el servidor (sin exponer perfiles ni resultados privados).
let olonMetricsRequest=null;
async function olonFetchPublicMetrics(){
 if(!olonMetricsRequest) olonMetricsRequest=supabaseClient.rpc("olon_public_portal_metrics")
  .then(({data,error})=>{if(error)throw error;return Array.isArray(data)?data[0]:data;})
  .catch(e=>{olonMetricsRequest=null;throw e;});
 return olonMetricsRequest;
}
async function updateAuthStudentCount(){
 const el=document.getElementById("authActiveStudents");
 if(!el)return;
 try{
  const data=await olonFetchPublicMetrics();
  el.textContent=Number(data?.active_students||0).toLocaleString("en-US");
 }catch(e){console.warn("No se pudo cargar total de estudiantes",e);el.textContent="—";}
}
async function updateAuthTradeCount(){
 const el=document.getElementById("authTradesRegistered");
 if(!el)return;
 try{
  const data=await olonFetchPublicMetrics();
  el.textContent=Number(data?.registered_trades||0).toLocaleString("en-US");
 }catch(e){console.warn("No se pudo cargar total de registros",e);el.textContent="—";}
}
async function loadTop3LoginStudents(){
 const box=document.getElementById("top3LoginList");
 if(box)box.innerHTML='<div class="top3Empty">El rendimiento de los estudiantes es privado. Inicia sesión para ver tu posición en el ranking.</div>';
}
function updateAuthRealStats(){
 updateAuthStudentCount();
 updateAuthTradeCount();
}

// ===== LIVE CHAT OLON SUPABASE =====
let selectedChatStudentId = null;
let chatRefreshTimer = null;


let lastStudentUnreadCount = Number(localStorage.getItem("olon_last_student_unread") || 0);
let lastAdminUnreadCount = Number(localStorage.getItem("olon_last_admin_unread") || 0);




function chatTime(value){
  try{
    return new Date(value).toLocaleString("es-PR", {month:"short", day:"numeric", hour:"numeric", minute:"2-digit"});
  }catch(e){ return ""; }
}

function escapeHTML(str){
  return String(str || "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

function toggleStudentChat(){
  const panel = document.getElementById("studentChatPanel");
  if(panel) panel.classList.toggle("show");
  if(panel && panel.classList.contains("show")){
    loadStudentChatMessages();
    markStudentMessagesRead();
  }
  if(typeof playClickSound === "function") playClickSound();
}

async function loadStudentChatMessages(){
  if(!currentUser || isAdminUser(currentUser)) return;
  const box = document.getElementById("studentChatMessages");
  if(!box) return;

  const { data, error } = await supabaseClient
    .from("chat_messages")
    .select("*")
    .eq("student_id", currentUser.id)
    .order("created_at", {ascending:true});

  if(error){
    box.innerHTML = `<div class="top3Empty">No se pudo cargar el chat. Revisa la tabla chat_messages.</div>`;
    return;
  }

  box.innerHTML = (data || []).map(m => `
    <div class="chatBubble ${m.sender_role === "admin" ? "admin" : "student"}">
      ${escapeHTML(m.message)}
      <small>${m.sender_role === "admin" ? "Admin" : "Tú"} · ${chatTime(m.created_at)}</small>
    </div>
  `).join("") || `<div class="top3Empty">No hay mensajes todavía. Escríbele al mentor.</div>`;

  box.scrollTop = box.scrollHeight;
  updateStudentUnreadBadge(data || []);
}

async function sendStudentChatMessage(){
  if(!currentUser || isAdminUser(currentUser)) return;
  const input = document.getElementById("studentChatInput");
  const msg = input?.value.trim();
  if(!msg) return;

  const { error } = await supabaseClient
    .from("chat_messages")
    .insert([{ student_id: currentUser.id, sender_role:"student", message:msg, is_read:false }]);

  if(error){ alert("No se pudo enviar el mensaje."); console.error(error); return; }

  input.value = "";
  if(typeof playClickSound === "function") playClickSound();
  await loadStudentChatMessages();
}

async function markStudentMessagesRead(){
  lastStudentUnreadCount = 0;
  localStorage.setItem("olon_last_student_unread", "0");
  if(!currentUser || isAdminUser(currentUser)) return;
  await supabaseClient
    .from("chat_messages")
    .update({is_read:true})
    .eq("student_id", currentUser.id)
    .eq("sender_role", "admin");
  updateStudentUnreadCount();
}

function updateStudentUnreadBadge(messages){
  const badge = document.getElementById("studentChatBadge");
  if(!badge) return;
  const unread = (messages || []).filter(m => m.sender_role === "admin" && !m.is_read).length;
  badge.textContent = unread;
  badge.classList.toggle("show", unread > 0);
}

async function updateStudentUnreadCount(){
  if(!currentUser || isAdminUser(currentUser)) return;
  const { data } = await supabaseClient
    .from("chat_messages")
    .select("id,sender_role,is_read")
    .eq("student_id", currentUser.id)
    .eq("sender_role", "admin")
    .eq("is_read", false);

  const n = (data || []).length;

  if(n > lastStudentUnreadCount){
    playNewMessageSound();
  }
  lastStudentUnreadCount = n;
  localStorage.setItem("olon_last_student_unread", String(n));

  const badge = document.getElementById("studentChatBadge");
  if(badge){
    badge.textContent = n;
    badge.classList.toggle("show", n > 0);
  }
}

async function loadAdminChatInbox(){
  if(!currentUser || !isAdminUser(currentUser)) return;
  const list = document.getElementById("adminChatList");
  if(!list) return;

  const { data: messages, error } = await supabaseClient
    .from("chat_messages")
    .select("student_id,message,sender_role,is_read,created_at")
    .order("created_at", {ascending:false});

  if(error){
    list.innerHTML = `<div class="top3Empty">No se pudo cargar el inbox.</div>`;
    console.error(error);
    return;
  }

  const studentIds = [...new Set((messages || []).map(m => m.student_id).filter(Boolean))];

  if(!studentIds.length){
    list.innerHTML = `<div class="top3Empty">No hay mensajes todavía.</div>`;
    updateAdminChatBadge(0);
    return;
  }

  const { data: profiles } = await supabaseClient
    .from("profiles")
    .select("id,full_name,access_code")
    .in("id", studentIds);

  const profileMap = {};
  (profiles || []).forEach(p => profileMap[p.id] = p);

  const grouped = {};
  (messages || []).forEach(m=>{
    if(!grouped[m.student_id]){
      grouped[m.student_id] = { latest:m, unread:0 };
    }
    if(m.sender_role === "student" && !m.is_read) grouped[m.student_id].unread++;
  });

  const totalUnread = Object.values(grouped).reduce((a,x)=>a+x.unread,0);
  updateAdminChatBadge(totalUnread);

  list.innerHTML = studentIds.map(id=>{
    const p = profileMap[id] || {};
    const g = grouped[id] || {};
    const latest = g.latest || {};
    const unread = g.unread || 0;
    return `
      <button class="adminChatUser ${selectedChatStudentId === id ? "active" : ""}" onclick="selectAdminChatStudent('${id}')">
        <b>${escapeHTML(p.full_name || "Estudiante")} ${unread ? `<span class="adminUnread">${unread}</span>` : ""}</b>
        <small>${escapeHTML(latest.message || "")}</small>
        <small>${escapeHTML(p.access_code || "")} · ${chatTime(latest.created_at)}</small>
      </button>
    `;
  }).join("");
}

function updateAdminChatBadge(n){
  if(currentUser && isAdminUser(currentUser) && n > lastAdminUnreadCount){
    playNewMessageSound();
  }
  lastAdminUnreadCount = n;
  localStorage.setItem("olon_last_admin_unread", String(n));

  const badge = document.getElementById("adminChatBadge");
  if(!badge) return;
  badge.textContent = n;
  badge.style.display = n > 0 ? "inline-flex" : "none";
}

async function selectAdminChatStudent(studentId){
  lastAdminUnreadCount = 0;
  localStorage.setItem("olon_last_admin_unread", "0");
  selectedChatStudentId = studentId;
  await loadAdminChatInbox();
  await loadAdminChatMessages();
  await supabaseClient
    .from("chat_messages")
    .update({is_read:true})
    .eq("student_id", studentId)
    .eq("sender_role", "student");
  await loadAdminChatInbox();
}

async function loadAdminChatMessages(){
  if(!selectedChatStudentId) return;
  const box = document.getElementById("adminChatMessages");
  const title = document.getElementById("adminChatTitle");
  if(!box) return;

  const { data: profile } = await supabaseClient
    .from("profiles")
    .select("full_name,access_code")
    .eq("id", selectedChatStudentId)
    .maybeSingle();

  if(title){
    title.textContent = "Chat con " + (profile?.full_name || "Estudiante");
  }

  const deleteBtn = document.getElementById("deleteConversationBtn");
  if(deleteBtn) deleteBtn.style.display = "inline-flex";

  const { data, error } = await supabaseClient
    .from("chat_messages")
    .select("*")
    .eq("student_id", selectedChatStudentId)
    .order("created_at", {ascending:true});

  if(error){
    box.innerHTML = `<div class="top3Empty">No se pudo cargar esta conversación.</div>`;
    return;
  }

  box.innerHTML = (data || []).map(m => `
    <div class="chatBubble ${m.sender_role === "admin" ? "admin" : "student"}">
      ${escapeHTML(m.message)}
      <small>${m.sender_role === "admin" ? "Admin" : "Estudiante"} · ${chatTime(m.created_at)}</small>
    </div>
  `).join("");

  box.scrollTop = box.scrollHeight;
}

async function sendAdminChatMessage(){
  if(!currentUser || !isAdminUser(currentUser) || !selectedChatStudentId){
    alert("Selecciona un estudiante primero.");
    return;
  }
  const input = document.getElementById("adminChatInput");
  const msg = input?.value.trim();
  if(!msg) return;

  const { error } = await supabaseClient
    .from("chat_messages")
    .insert([{ student_id:selectedChatStudentId, sender_role:"admin", message:msg, is_read:false }]);

  if(error){ alert("No se pudo enviar la respuesta."); console.error(error); return; }

  input.value = "";
  if(typeof playClickSound === "function") playClickSound();
  await loadAdminChatMessages();
  await loadAdminChatInbox();
}


async function deleteSelectedConversation(){
  if(!currentUser || !isAdminUser(currentUser)){
    alert("No autorizado.");
    return;
  }

  if(!selectedChatStudentId){
    alert("Selecciona un estudiante primero.");
    return;
  }

  const ok = confirm("¿Seguro que quieres borrar TODA esta conversación? Esta acción no se puede deshacer.");
  if(!ok) return;

  const { error } = await supabaseClient
    .from("chat_messages")
    .delete()
    .eq("student_id", selectedChatStudentId);

  if(error){
    alert("No se pudo borrar la conversación.");
    console.error(error);
    return;
  }

  if(typeof playClickSound === "function") playClickSound();

  selectedChatStudentId = null;

  const title = document.getElementById("adminChatTitle");
  if(title) title.textContent = "Selecciona un estudiante";

  const messages = document.getElementById("adminChatMessages");
  if(messages) messages.innerHTML = `<div class="top3Empty">Conversación borrada.</div>`;

  const btn = document.getElementById("deleteConversationBtn");
  if(btn) btn.style.display = "none";

  await loadAdminChatInbox();
}

function startChatRefresh(){
  if(chatRefreshTimer) clearInterval(chatRefreshTimer);
  chatRefreshTimer = setInterval(()=>{
    if(!currentUser) return;
    if(isAdminUser(currentUser)){
      loadAdminChatInbox();
      if(selectedChatStudentId) loadAdminChatMessages();
    }else{
      updateStudentUnreadCount();
      const panel = document.getElementById("studentChatPanel");
      if(panel?.classList.contains("show")) loadStudentChatMessages();
    }
  }, 7000);
}

// La sesión válida viene exclusivamente de Supabase Auth.
localStorage.removeItem("olon_current_user");
let currentUser = null;
let chart;
let cachedRecords = [];
let cachedUsers = [];


function money(n){return "$" + Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}
function pct(n){return Number(n||0).toFixed(2) + "%"}
function showError(msg, error){ console.error(msg, error || ""); alert(msg + (error?.message ? "\n" + error.message : "")); }

// ===== LOGIN / ROLE SAFE HELPERS =====
function cleanText(value){ return String(value || "").trim(); }
function normalizeRole(value){ const role = cleanText(value).toLowerCase(); return role === "admin" ? "admin" : "student"; }
function normalizeStatus(value){ const status = cleanText(value).toLowerCase(); return status || "active"; }
function isAdminUser(user){ const role = normalizeRole(user?.role); const code = cleanText(user?.access_code).toLowerCase(); return role === "admin"; }
function isActiveUser(user){ const status = normalizeStatus(user?.status); return status === "active" || status === "approved"; }
function $(id){ return document.getElementById(id); }
function setTextSafe(id, value){ const el = $(id); if(el) el.innerText = value; }
function showSafe(id){ const el = $(id); if(el) el.classList.remove("hidden"); }
function hideSafe(id){ const el = $(id); if(el) el.classList.add("hidden"); }

let signupEmailVerified = false;
let signupVerifiedEmail = "";

function normalizeEmail(value){
  return String(value || "").trim().toLowerCase();
}

function isValidEmailFormat(email){
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function setEmailStatus(type, message){
  const box = document.getElementById("emailVerifyStatus");
  if(!box) return;
  box.className = "emailStatus " + type;
  box.innerText = message;
}

function resetEmailVerification(){
  signupEmailVerified = false;
  signupVerifiedEmail = "";
  const email = normalizeEmail(document.getElementById("signupEmail")?.value);
  const confirm = normalizeEmail(document.getElementById("signupEmailConfirm")?.value);
  if(!email && !confirm){ setEmailStatus("neutral", "Escribe y confirma tu email."); return; }
  if(email && !isValidEmailFormat(email)){ setEmailStatus("invalid", "Email no válido. Revisa que tenga @ y dominio correcto."); return; }
  if(confirm && email !== confirm){ setEmailStatus("invalid", "Los emails no coinciden."); return; }
  if(email && confirm && email === confirm){ setEmailStatus("neutral", "Correos coinciden. Pulsa Comprobar correo."); return; }
  setEmailStatus("neutral", "Confirma tu email para verificarlo.");
}

async function verifySignupEmail(){
  const email = normalizeEmail(document.getElementById("signupEmail")?.value);
  const confirm = normalizeEmail(document.getElementById("signupEmailConfirm")?.value);
  signupEmailVerified = false;
  signupVerifiedEmail = "";
  if(!email || !confirm){ setEmailStatus("invalid", "Debes escribir y confirmar tu correo."); return false; }
  if(!isValidEmailFormat(email)){ setEmailStatus("invalid", "Escribe un correo válido."); return false; }
  if(email !== confirm){ setEmailStatus("invalid", "Los correos no coinciden."); return false; }
  signupEmailVerified = true;
  signupVerifiedEmail = email;
  setEmailStatus("valid", "Los correos coinciden. Esto no comprueba todavía que seas propietario de ese correo; el administrador revisará la solicitud.");
  return true;
}

function setupEmailVerificationListeners(){
  const email = document.getElementById("signupEmail");
  const confirm = document.getElementById("signupEmailConfirm");
  if(email) email.addEventListener("input", resetEmailVerification);
  if(confirm) confirm.addEventListener("input", resetEmailVerification);
}

function getStudentFirstName(user){
  const fullName = (user?.full_name || "Estudiante").trim();
  return fullName.split(" ")[0] || "Estudiante";
}

const puertoRicoBillingDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Puerto_Rico", year: "numeric", month: "2-digit", day: "2-digit"
});
const vipPaymentDateLabel = new Intl.DateTimeFormat("es-PR", {dateStyle: "long", timeZone: "UTC"});

function getVipPayment(value, now = new Date()){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const date = new Date(value + "T00:00:00Z");
  if(!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;

  const {year, month, day} = Object.fromEntries(
    puertoRicoBillingDate.formatToParts(now).map(({type, value}) => [type, value])
  );
  const today = Date.parse(year + "-" + month + "-" + day + "T00:00:00Z");
  return {date, days: (date.getTime() - today) / 86400000};
}

function renderVipPayment(profile){
  if(!profile || isAdminUser(profile)) return;
  const card = $("vipPayment");
  const payment = getVipPayment(profile.next_payment_date);
  if(!payment){
    card.dataset.state = "unassigned";
    setTextSafe("vipPaymentBadge", "Fecha pendiente");
    setTextSafe("vipPaymentDate", "Sin fecha asignada");
    setTextSafe("vipPaymentDays", "—");
    return;
  }

  const remaining = Math.max(0, payment.days);
  card.dataset.state = payment.days < 0 ? "overdue" : payment.days <= 5 ? "upcoming" : "current";
  setTextSafe("vipPaymentBadge", payment.days < 0 ? "Pago vencido" : payment.days === 0 ? "Vence hoy" : payment.days <= 5 ? "Pago próximo" : "Al día");
  setTextSafe("vipPaymentDate", vipPaymentDateLabel.format(payment.date));
  setTextSafe("vipPaymentDays", remaining + (remaining === 1 ? " día" : " días"));
}

function updatePortalWelcome(){
  if(!currentUser) return;

  renderVipPayment(currentUser);
  const adminView = isAdminUser(currentUser);

  // Topbar principal: evita duplicar el saludo.
  const pageTitle = document.getElementById("pageTitle");
  if(pageTitle){
    pageTitle.innerText = adminView ? "Administración" : "Resumen de rendimiento";
  }

  const pageSubtitle = document.getElementById("pageSubtitle");
  if(pageSubtitle){
    pageSubtitle.innerText = adminView
      ? "Gestión de miembros, solicitudes y mensajes."
      : "Control privado de rendimiento, disciplina, reportes y progreso del trader.";
  }

  const welcomeCard = document.getElementById("portalWelcomeCard");
  if(welcomeCard){ welcomeCard.classList.toggle("hidden", adminView); }
}


function toggleAuth(mode){
  document.getElementById("tabLogin").classList.toggle("active", mode==="login");
  document.getElementById("tabSignup").classList.toggle("active", mode==="signup");
  document.getElementById("loginForm").classList.toggle("active", mode==="login");
  document.getElementById("signupForm").classList.toggle("active", mode==="signup");
}

async function login(){ return window.olonSecureLogin(); }

function generateAccessCode(){
  const random = Math.floor(10000 + Math.random() * 90000);
  return "OLON-" + random;
}

async function createUniqueAccessCode(){
  for(let i = 0; i < 10; i++){
    const code = generateAccessCode();
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("id")
      .eq("access_code", code)
      .maybeSingle();

    if(error){ console.error(error); }
    if(!data) return code;
  }
  return "OLON-" + Date.now().toString().slice(-5);
}

async function signup(){ return window.olonSecureSignup(); }

function copyGeneratedCode(){
  const code = document.getElementById("generatedCodeText").innerText;
  navigator.clipboard.writeText(code).then(() => {
    alert("Código copiado: " + code);
  }).catch(() => {
    alert("Tu código es: " + code);
  });
}

function backToLogin(){
  document.getElementById("codeResult").classList.add("hidden");
  document.getElementById("auth").classList.remove("hidden");
  toggleAuth("login");
}

async function enterPortal(){
  if(!currentUser) return;

  const admin = isAdminUser(currentUser);
  document.getElementById("portal")?.classList.toggle("admin-mode",admin);
  currentUser.role = admin ? "admin" : "student";
  currentUser.status = admin ? "active" : normalizeStatus(currentUser.status);
  localStorage.setItem("olon_current_user", JSON.stringify(currentUser));

  setTextSafe("studentName", currentUser.full_name || "Estudiante");
  setTextSafe("avatarText", currentUser.full_name?.[0]?.toUpperCase() || "O");
  setTextSafe("userCodeText", "Código: " + (currentUser.access_code || "OLON"));
  setTextSafe("planBadge", admin ? "ADMIN" : "VIP");
  setTextSafe("accessStatus", admin ? "Administrador activo" : "Membresía VIP");

  hideSafe("auth");
  hideSafe("codeResult");
  showSafe("portal");
  const portal = $("portal");
  if(portal) portal.classList.add("portalReady");

  setTextSafe("portalMode", admin ? "Administración" : "Portal del Trader");
  document.querySelectorAll(".studentNav").forEach(el => el.classList.toggle("hidden", admin));
  document.querySelectorAll(".adminNav").forEach(el => el.classList.toggle("hidden", !admin));
  document.querySelectorAll(".studentOnly").forEach(el => el.classList.toggle("hidden", admin));

  showPageById(admin ? "admin" : "dashboard");
  updatePortalWelcome();

  try{ await render(); }
  catch(err){ console.error("Render error después del login", err); }

  try{
    startChatRefresh();
    if(admin) loadAdminChatInbox(); else updateStudentUnreadCount();
  }catch(err){ console.warn("Chat refresh no iniciado", err); }
}

function logout(){
  localStorage.removeItem("olon_current_user");
  currentUser = null; cachedRecords = []; cachedUsers = [];
  document.getElementById("portal").classList.add("hidden");
  document.getElementById("auth").classList.remove("hidden");
}
function showPage(id,btn){
  document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));
  const targetPage = document.getElementById(id);
  if(targetPage) targetPage.classList.remove("hidden");

  const title = document.getElementById("pageTitle");
  if(title){
    title.innerText = btn ? btn.textContent.replace(/[^\wÁÉÍÓÚáéíóúñÑ ]/g,"").trim() : id;
  }

  if(id === "dashboard" && currentUser){ updatePortalWelcome(); }

  document.querySelectorAll(".nav button").forEach(b=>b.classList.remove("active"));
  if(btn) btn.classList.add("active");


  if(id === "adminChat" && typeof loadAdminChatInbox === "function"){
    setTimeout(loadAdminChatInbox, 150);
  }
}
function showPageById(id){
  const buttons = [...document.querySelectorAll(".nav button")];
  const btn = buttons.find(b=>b.getAttribute("onclick") && b.getAttribute("onclick").includes("'" + id + "'"));
  showPage(id,btn);
}

let recordsRequest = 0;
let recordsLoadedFor = null;

async function fetchRecords(){
  if(!currentUser || isAdminUser(currentUser)) return [];
  const studentId=currentUser.id;
  const request=++recordsRequest;
  // The visible performance is sourced ONLY from the student's connected MT account.
  // All old student_records stay untouched in Supabase as an archival backup.
  if(!window.olonMtRecords){
    cachedRecords=[];
    return cachedRecords;
  }
  const real=await window.olonMtRecords.fetch(studentId);
  if(currentUser?.id !== studentId || request !== recordsRequest) return [];
  cachedRecords=Array.isArray(real)?real:[];
  recordsLoadedFor=studentId;
  return cachedRecords;
}

async function delRecord(id){
  const owner = currentUser?.id;
  if(!owner) return;
  const { error } = await supabaseClient.from("student_records").delete().eq("id", id).eq("student_id", owner);
  if(error){ showError("No se pudo eliminar el registro.", error); return; }
  void window.olonAcademy?.cleanupJournalFiles(id, owner);
  if(currentUser?.id === owner){ await fetchRecords(); await render(); }
}

function isTradingRecord(record){
  return record.kind ? record.kind === "trading" : !record.deposit || Boolean(record.gain || record.loss);
}

function signedTradeMoney(value){
  return (value > 0 ? "+" : value < 0 ? "−" : "") + money(Math.abs(value));
}

function netAmount(gain, loss){
  return Math.round((gain - loss) * 100) / 100;
}

function summarizeTradingDays(records){
  const days = new Map();
  for(const record of window.olonAnalyticsCore.accountingRows(records)){
    const day = days.get(record.date) || {deposit:0, withdrawal:0, gain:0, loss:0, tradeCount:0};
    day.deposit += record.deposit;
    day.withdrawal += record.withdrawal;
    day.gain += record.gain;
    day.loss += record.loss;
    if(isTradingRecord(record)) day.tradeCount++;
    days.set(record.date, day);
  }
  return days;
}

function totals(records=cachedRecords){
  let deposit = 0, withdrawal = 0, gain = 0, loss = 0;
  let positiveDays = 0, negativeDays = 0, days = 0;
  for(const day of summarizeTradingDays(records).values()){
    deposit += day.deposit;
    withdrawal += day.withdrawal;
    gain += day.gain;
    loss += day.loss;
    if(!day.tradeCount) continue;
    days++;
    const dayNet = netAmount(day.gain, day.loss);
    if(dayNet > 0) positiveDays++;
    if(dayNet < 0) negativeDays++;
  }
  const net = netAmount(gain, loss);
  const balance = deposit - withdrawal + net;
  const growth = deposit > 0 ? (net / deposit) * 100 : 0;
  return {deposit, withdrawal, gain, loss, net, balance, growth, positiveDays, negativeDays,
    avgDaily:days ? net / days : 0, days};
}

function monthRecords(offset){
  const now = new Date(); const target = new Date(now.getFullYear(), now.getMonth()+offset, 1);
  const y = target.getFullYear(), m = target.getMonth();
  return cachedRecords.filter(r=>{ const d = new Date(r.date + "T00:00:00"); return d.getFullYear() === y && d.getMonth() === m; });
}


function getMonthlyGoal(){
  return Number(localStorage.getItem("olon_monthly_goal") || 2000);
}

function saveMonthlyGoal(){
  const input = document.getElementById("monthlyGoalInput");
  const value = Number(input?.value || 2000);
  localStorage.setItem("olon_monthly_goal", Math.max(1, value));
  renderProDashboard();
}



function getYearlyGoal(){
  const stored = Number(localStorage.getItem("olon_yearly_goal"));
  return Number.isFinite(stored) && stored > 0 ? stored : 20000;
}

function saveYearlyGoal(){
  const input = document.getElementById("yearlyGoalInput");
  const raw = Number(input?.value || 0);

  if(!Number.isFinite(raw) || raw <= 0){
    alert("Escribe una meta anual válida mayor que 0.");
    return;
  }

  localStorage.setItem("olon_yearly_goal", String(raw));
  if(typeof playClickSound === "function") playClickSound();
  renderProDashboard();
}

function updateYearlyGoalUI(){
  const currentYear = yearRecords();
  const ytdTotals = totals(currentYear);
  const yearlyGoal = getYearlyGoal();
  const yearlyGoalPct = clamp(Math.round((Math.max(0, ytdTotals.net) / yearlyGoal) * 100), 0, 100);

  const yearlyGoalBar = document.getElementById("yearlyGoalBar");
  if(yearlyGoalBar) yearlyGoalBar.style.width = yearlyGoalPct + "%";

  const yearlyGoalText = document.getElementById("yearlyGoalText");
  if(yearlyGoalText) yearlyGoalText.innerText = money(ytdTotals.net) + " / " + money(yearlyGoal);

  const yearlyGoalPctEl = document.getElementById("yearlyGoalPct");
  if(yearlyGoalPctEl) yearlyGoalPctEl.innerText = yearlyGoalPct + "%";

  const yearlyGoalInput = document.getElementById("yearlyGoalInput");
  if(yearlyGoalInput && document.activeElement !== yearlyGoalInput){
    yearlyGoalInput.value = yearlyGoal;
  }
}



function buildJournalNote(){
  const pair = document.getElementById("pair")?.value.trim();
  const type = document.getElementById("tradeType")?.value.trim();
  const emotion = document.getElementById("emotion")?.value.trim();
  const mistake = document.getElementById("mistake")?.value.trim();
  const note = document.getElementById("note")?.value.trim();
  const parts = [];
  if(pair) parts.push("Par: " + pair);
  if(type) parts.push("Tipo: " + type);
  if(emotion) parts.push("Emoción: " + emotion);
  if(mistake) parts.push("Error: " + mistake);
  if(note) parts.push("Nota: " + note);
  return parts.join(" | ");
}

function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }


function recordsBetween(start, end){
  return (cachedRecords || []).filter(r=>{
    const d = new Date(r.date + "T00:00:00");
    return d >= start && d <= end;
  });
}

function yearRecords(){
  const now = new Date();
  return recordsBetween(new Date(now.getFullYear(),0,1), new Date(now.getFullYear(),11,31,23,59,59));
}

function weekRecords(){
  const now = new Date();
  const day = now.getDay();
  const start = new Date(now);
  start.setDate(now.getDate() - day);
  start.setHours(0,0,0,0);
  const end = new Date(start);
  end.setDate(start.getDate()+6);
  end.setHours(23,59,59,999);
  return recordsBetween(start,end);
}

function winRateFromRecords(records){
  return window.olonAnalyticsCore.stats(records);
}

function maxDrawdownFromRecords(records){
  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  window.olonAnalyticsCore.accountingRows(records).forEach(r=>{
    equity += netAmount(r.gain, r.loss);
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);
  });
  return maxDD;
}

function bestWorst(records){
  const results = [...summarizeTradingDays(records).values()].filter(day => day.tradeCount)
    .map(day => netAmount(day.gain, day.loss));
  return {best:results.length ? Math.max(...results) : 0, worst:results.length ? Math.min(...results) : 0};
}

function rankingLabelFromPosition(position){
  if(!position) return {label:"Sin ranking", note:"Registra datos para aparecer en el ranking"};
  if(position <= 5) return {label:"#"+position, note:"Ranking entre estudiantes por rendimiento sobre depósito"};
  return {label:"#"+position, note:"Fuera del Top 5, sigue subiendo tu rendimiento"};
}

function reportHTML(records, label){
  const t = totals(records);
  const wr = winRateFromRecords(records);
  const bw = bestWorst(records);
  return `
    <div class="reportRow"><span>Neto ${label}</span><b class="${t.net >= 0 ? 'good':'bad'}">${signedTradeMoney(t.net)}</b></div>
    <div class="reportRow"><span>Depósitos del período</span><b>${money(t.deposit)}</b></div>
    <div class="reportRow"><span>Retiros del período</span><b>${money(t.withdrawal)}</b></div>
    <div class="reportRow"><span>Win Rate por operación</span><b>${wr.winrate === null ? '—' : pct(wr.winrate)}</b></div>
    <div class="reportRow"><span>Operaciones ganadas / perdidas / BE</span><b>${wr.wins} / ${wr.losses} / ${wr.flat}</b></div>
    <div class="reportRow"><span>Mejor día</span><b>${signedTradeMoney(bw.best)}</b></div>
    <div class="reportRow"><span>Peor día</span><b>${signedTradeMoney(bw.worst)}</b></div>
    <div class="reportRow"><span>Días de trading</span><b>${t.days}</b></div>
  `;
}


async function renderStudentRanking(){
  if(!currentUser || isAdminUser(currentUser)) return;
  const rankEl=document.getElementById("topRanking");
  const noteEl=document.getElementById("topRankingNote");
  try{
    // Server returns only the caller's rank and the number of ranked members.
    // Do not read other students' private student_records from the browser.
    const { data, error }=await supabaseClient.rpc("olon_student_rank");
    if(error) throw error;
    const row=Array.isArray(data)?data[0]:data;
    const position=row?.rank_position ? Number(row.rank_position) : null;
    const measured=Number(row?.measured_count||0);
    const result=rankingLabelFromPosition(position);
    if(rankEl)rankEl.textContent=result.label;
    if(noteEl)noteEl.textContent=result.note+(measured?" · "+measured+" estudiantes medidos":"");
  }catch(e){
    console.warn("Ranking privado no disponible",e);
    if(rankEl)rankEl.textContent="Sin ranking";
    if(noteEl)noteEl.textContent="Registra resultados para participar en el ranking privado.";
  }
}

let currentReportView = "weekly";
const reportViewConfig = {
  weekly:{title:"Reporte Semanal Premium", subtitle:"Resumen ejecutivo de tu rendimiento de esta semana.", badge:"Vista Semanal", label:"semanal"},
  monthly:{title:"Reporte Mensual Premium", subtitle:"Resumen ejecutivo de tu rendimiento del mes actual.", badge:"Vista Mensual", label:"mensual"},
  ytd:{title:"Reporte YTD Premium", subtitle:"Resumen acumulado profesional desde el inicio del año.", badge:"Year To Date", label:"YTD"}
};

function getSelectedReportRecords(){
  if(currentReportView === "monthly") return monthRecords(0);
  if(currentReportView === "ytd") return yearRecords();
  return weekRecords();
}

function setReportView(view){
  currentReportView = reportViewConfig[view] ? view : "weekly";
  [["weekly","reportBtnWeekly"],["monthly","reportBtnMonthly"],["ytd","reportBtnYtd"]].forEach(([v,id])=>{
    const btn = document.getElementById(id);
    if(btn) btn.classList.toggle("active", v === currentReportView);
  });
  renderSelectedReport();
}

function renderSelectedReport(){
  const cfg = reportViewConfig[currentReportView] || reportViewConfig.weekly;
  const records = getSelectedReportRecords();
  const title = document.getElementById("selectedReportTitle");
  const sub = document.getElementById("selectedReportSubtitle");
  const badge = document.getElementById("selectedReportBadge");
  const box = document.getElementById("selectedReport");

  if(title) title.innerText = cfg.title;
  if(sub) sub.innerText = cfg.subtitle;
  if(badge) badge.innerText = cfg.badge;
  if(box) box.innerHTML = reportHTML(records, cfg.label);
  window.clearPreparedReportPDF?.();
}

function renderV3Performance(){
  renderStudentRanking();
  if(!currentUser || isAdminUser(currentUser)) return;
  const records = cachedRecords || [];
  const all = totals(records);
  const returnPct = all.deposit > 0 ? (all.net / all.deposit) * 100 : 0;

  const depositReturn = document.getElementById("depositReturn");
  if(depositReturn){
    depositReturn.innerText = pct(returnPct);
    depositReturn.className = returnPct >= 0 ? "good" : "bad";
  }

  const dd = maxDrawdownFromRecords(records);
  const maxDD = document.getElementById("maxDrawdown");
  if(maxDD) maxDD.innerText = money(dd);
  const ddPct = all.deposit > 0 ? (dd / all.deposit) * 100 : 0;
  const drawdownPct = document.getElementById("drawdownPct");
  if(drawdownPct) drawdownPct.innerText = pct(ddPct) + " del depósito";

  const ytd = yearRecords();
  const ywr = window.olonAnalyticsCore.days(ytd);
  const ytdWinrate = document.getElementById("ytdWinrate");
  if(ytdWinrate) ytdWinrate.innerText = ywr.winrate === null ? "—" : pct(ywr.winrate);
  const ytdStats = document.getElementById("ytdStats");
  if(ytdStats) ytdStats.innerText = ywr.wins + " días positivos / " + ywr.losses + " negativos";

  renderSelectedReport();
}

function renderProDashboard(){
  if(!currentUser || isAdminUser(currentUser)) return;
  const records = cachedRecords || [];
  const t = totals(records);
  const currentMonth = monthRecords(0);
  const cur = totals(currentMonth);
  const currentYear = yearRecords();
  const ytdTotals = totals(currentYear);

  const positiveDays = t.positiveDays || 0;
  const totalDays = Math.max(1, t.days || 0);
  const discipline = clamp(Math.round((positiveDays / totalDays) * 100), 0, 100);
  const consistency = clamp(Math.round((Math.min(totalDays, 20) / 20) * 100), 0, 100);
  const risk = clamp(Math.round(100 - (t.loss > 0 && t.gain > 0 ? (t.loss / Math.max(t.gain,1))*55 : t.loss > 0 ? 35 : 0)), 0, 100);
  const traderScore = Math.round((discipline * .40) + (consistency * .25) + (risk * .35));

  const scoreRing = document.getElementById("scoreRing");
  if(scoreRing) scoreRing.style.setProperty("--score", traderScore);
  const scoreEl = document.getElementById("traderScore");
  if(scoreEl) scoreEl.innerText = traderScore + "%";

  const level = traderScore >= 90 ? "Master Trader" : traderScore >= 75 ? "Elite Consistente" : traderScore >= 60 ? "Trader en Crecimiento" : "En desarrollo";
  const levelEl = document.getElementById("traderLevel");
  if(levelEl) levelEl.innerText = "Nivel: " + level;

  [["discipline",discipline],["consistency",consistency],["risk",risk]].forEach(([id,val])=>{
    const score = document.getElementById(id+"Score");
    const bar = document.getElementById(id+"Bar");
    if(score) score.innerText = val + "%";
    if(bar) bar.style.width = val + "%";
  });

  const goal = getMonthlyGoal();
  const goalPct = clamp(Math.round((Math.max(0, cur.net) / goal) * 100), 0, 100);
  const goalBar = document.getElementById("monthlyGoalBar");
  if(goalBar) goalBar.style.width = goalPct + "%";
  const goalText = document.getElementById("monthlyGoalText");
  if(goalText) goalText.innerText = money(cur.net) + " / " + money(goal);
  const goalPctEl = document.getElementById("monthlyGoalPct");
  if(goalPctEl) goalPctEl.innerText = goalPct + "%";
  const goalInput = document.getElementById("monthlyGoalInput");
  if(goalInput && document.activeElement !== goalInput) goalInput.value = goal;
  updateYearlyGoalUI();
  const ai = [];
  if(t.days === 0){
    ai.push("📌 Todavía no hay registros. Comienza registrando tu primer día.");
  }else{
    ai.push(traderScore >= 75 ? "🔥 Buen progreso: tu score muestra consistencia y control." : "⚠️ Tu score puede mejorar si registras más días y reduces pérdidas.");
    ai.push(t.net >= 0 ? "✅ Tu balance neto está positivo. Mantén la misma disciplina." : "🔴 Tu balance neto está negativo. Baja el riesgo y enfócate en calidad.");
    ai.push(t.loss > t.gain ? "⚠️ Las pérdidas superan las ganancias. Revisa entradas impulsivas o sobreoperación." : "🛡️ El control de riesgo se mantiene saludable.");
    ai.push(currentMonth.length >= 8 ? "📈 Buen hábito: tienes varios registros este mes." : "🗓️ Registra más días para que el análisis sea más preciso.");
  }
  const aiBox = document.getElementById("aiAnalysisList");
  if(aiBox) aiBox.innerHTML = ai.map(x=>`<div class="aiItem">${x}</div>`).join("");

  renderTradingCalendar(currentMonth);
  renderDailyQuote();
  renderV3Performance();
}

function renderDailyQuote(){
  const quotes = [
    "🔥 La disciplina te paga lo que la emoción te quita.",
    "📈 Un buen trader no persigue el mercado; espera su oportunidad.",
    "🛡️ Proteger capital también es ganar.",
    "💎 La consistencia se construye registro por registro.",
    "⚡ No necesitas operar más, necesitas operar mejor."
  ];
  const el = document.getElementById("dailyQuote");
  if(el){
    const day = new Date().getDate();
    el.innerText = quotes[day % quotes.length];
  }
}

function renderTradingCalendar(records){
  const box = document.getElementById("tradingCalendar");
  const detail = document.getElementById("calendarDayDetail");
  if(!box || !detail) return;
  const now = new Date(), year = now.getFullYear(), month = now.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const monthName = new Intl.DateTimeFormat("es-PR", {month:"long"}).format(now);
  const monthKey = year + "-" + String(month + 1).padStart(2, "0") + "-";
  const results = summarizeTradingDays(records);
  const total = totals(records).net;
  const monthNet = document.getElementById("calendarMonthNet");
  document.getElementById("calendarMonthLabel").textContent = monthName + " " + year;
  monthNet.textContent = signedTradeMoney(total);
  monthNet.className = total > 0 ? "positive" : total < 0 ? "negative" : "neutral";

  const fragment = document.createDocumentFragment();
  for(const name of ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]){
    const heading = document.createElement("div");
    heading.className = "calendarWeekday";
    heading.textContent = name;
    fragment.append(heading);
  }
  for(let i = 0; i < firstWeekday; i++){
    const blank = document.createElement("span");
    blank.className = "calDay empty";
    blank.setAttribute("aria-hidden", "true");
    fragment.append(blank);
  }
  for(let day = 1; day <= days; day++){
    const result = results.get(monthKey + String(day).padStart(2, "0"));
    const cell = document.createElement(result ? "button" : "div");
    cell.className = "calDay" + (day === now.getDate() ? " isToday" : "");
    const date = document.createElement("span");
    date.className = "calendarDate";
    date.textContent = String(day);
    const amount = document.createElement("span");
    amount.className = "calendarAmount";
    amount.textContent = day > now.getDate() ? "" : "—";
    cell.append(date, amount);
    if(result){
      const net = netAmount(result.gain, result.loss);
      const capitalLabel = result.deposit && result.withdrawal ? "Capital" : result.deposit ? "Depósito" : "Retiro";
      const label = result.tradeCount ? "Trading " + signedTradeMoney(net) : capitalLabel;
      cell.type = "button";
      cell.classList.add(!result.tradeCount ? "cashDay" : net > 0 ? "goodDay" : net < 0 ? "badDay" : "flatDay");
      cell.setAttribute("aria-label", day + " de " + monthName + " · " + label);
      amount.textContent = result.tradeCount ? signedTradeMoney(net) : capitalLabel;
      cell.addEventListener("click", () => {
        box.querySelector(".calDay.selected")?.classList.remove("selected");
        cell.classList.add("selected");
        const heading = document.createElement("strong");
        heading.textContent = day + " de " + monthName;
        const lines = document.createElement("div");
        lines.className = "calendarLedgerDetails";
        const values = [];
        if(result.tradeCount) values.push(["Resultado de trading", signedTradeMoney(net)]);
        if(result.deposit) values.push(["Depósitos", money(result.deposit)]);
        if(result.withdrawal) values.push(["Retiros", money(result.withdrawal)]);
        for(const [label, value] of values){
          const line = document.createElement("div");
          const title = document.createElement("span");
          const text = document.createElement("b");
          title.textContent = label;
          text.textContent = value;
          line.append(title, text);
          lines.append(line);
        }
        detail.replaceChildren(heading, lines);
        detail.hidden = false;
      });
    }
    fragment.append(cell);
  }
  box.replaceChildren(fragment);
  detail.hidden = true;
  detail.replaceChildren();
}

async function render(){
  if(!currentUser) return;
  if(isAdminUser(currentUser)){ if(window.olonAdmin?.refresh) await window.olonAdmin.refresh(); return; }
  const studentId = currentUser.id;
  await fetchRecords();
  if(currentUser?.id !== studentId) return;
  const records = cachedRecords, t = totals(records);
  document.getElementById("mDeposited").innerText = money(t.deposit);
  document.getElementById("mWithdrawn").innerText = money(t.withdrawal);
  document.getElementById("mBalance").innerText = money(t.balance);
  document.getElementById("mNet").innerText = money(t.net);
  const netLabel = document.getElementById("mNetLabel");
  if(netLabel){
    netLabel.className = t.net >= 0 ? "good" : "bad";
    netLabel.innerText = t.net > 0 ? "Ganancia neta total" : t.net < 0 ? "Pérdida neta total" : "Ganancias menos pérdidas";
  }
  document.getElementById("mLoss").innerText = money(t.loss);
  document.getElementById("mGrowth").innerText = pct(t.growth);
  window.olonMtRecords?.afterRender();
  window.olonHistory?.render(records);
  window.olonAnalytics?.render(records, studentId);
  renderCompare(); renderChart(); renderProDashboard();
}

function recordHistoryActions(record){
  const safeId = escapeHTML(record.id);
  const journal = isTradingRecord(record)
    ? `<button type="button" class="btn secondary" data-record-journal="${safeId}">Diario visual</button>` : "";
  return `<div class="ledgerButtons ledgerHistoryActions">
    ${journal}
    <button type="button" class="btn secondary" data-record-edit="${safeId}">Editar</button>
    <button type="button" class="btn secondary" data-record-delete="${safeId}">Eliminar</button>
  </div>`;
}

function changeBadge(value, inverse=false){
  const good = inverse ? value < 0 : value > 0, bad = inverse ? value > 0 : value < 0;
  const cls = good ? "green" : bad ? "red" : "blue", sign = value > 0 ? "+" : "";
  return `<span class="badge ${cls}">${sign}${typeof value === "number" ? value.toFixed(2) : value}</span>`;
}
function renderCompare(){
  const cur = totals(monthRecords(0)), prev = totals(monthRecords(-1));
  const rows = [["Profit Neto", money(cur.net), money(prev.net), changeBadge(cur.net-prev.net)], ["Ganancias", money(cur.gain), money(prev.gain), changeBadge(cur.gain-prev.gain)], ["Pérdidas", money(cur.loss), money(prev.loss), changeBadge(cur.loss-prev.loss, true)], ["Crecimiento %", pct(cur.growth), pct(prev.growth), changeBadge(cur.growth-prev.growth)], ["Días positivos", cur.positiveDays, prev.positiveDays, changeBadge(cur.positiveDays-prev.positiveDays)], ["Días negativos", cur.negativeDays, prev.negativeDays, changeBadge(cur.negativeDays-prev.negativeDays, true)], ["Promedio diario", money(cur.avgDaily), money(prev.avgDaily), changeBadge(cur.avgDaily-prev.avgDaily)]];
  document.getElementById("compareBody").innerHTML = rows.map(r=>`<tr><td><b>${r[0]}</b></td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join("");
}
function renderChart(){
  const ctx = document.getElementById("balanceChart");
  if(!ctx || !window.Chart) return;
  let running = 0;
  const sorted = window.olonAnalyticsCore.accountingRows(cachedRecords).sort((a,b)=>a.date.localeCompare(b.date));
  const labels = sorted.map(r=>r.date);
  const data = sorted.map(r=>{ running += r.deposit - r.withdrawal + r.gain - r.loss; return running; });
  if(chart) chart.destroy();
  const theme = getComputedStyle(document.body);
  const accent = theme.getPropertyValue("--trader-accent").trim() || "#335fa8";
  const portalTheme = getComputedStyle(document.getElementById("portal") || document.body);
  const profit = portalTheme.getPropertyValue("--cyber-profit").trim();
  const lineColor = /^#[0-9a-f]{6}$/i.test(profit) ? profit : accent;
  const ticks = {color:theme.getPropertyValue("--muted").trim()};
  const grid = {color:theme.getPropertyValue("--line").trim()};
  chart = new Chart(ctx,{
    type:"line",
    data:{labels:labels.length ? labels : ["Inicio"],datasets:[{
      label:"Balance",data:data.length ? data : [0],tension:.4,fill:true,
      borderColor:lineColor,backgroundColor:lineColor + "25"
    }]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:ticks.color}}},
      scales:{x:{ticks,grid},y:{ticks,grid}}}
  });
}
async function clearData(){
  if(!currentUser || isAdminUser(currentUser)) return;
  if(window.olonMtRecords?.linked()){
    alert("Los resultados MT se sincronizan automáticamente. Los registros anteriores se conservan y no pueden borrarse desde esta pantalla.");
    return;
  }
  if(confirm("¿Borrar todos tus registros?")){
    const { error } = await supabaseClient.from("student_records").delete().eq("student_id", currentUser.id);
    if(error){ showError("No se pudieron borrar los registros.", error); return; }
    cachedRecords = []; await render();
  }
}
setupEmailVerificationListeners();
updateAuthRealStats();
/* ===== BIENVENIDO ANIMADO PRO ===== */
(function(){
  function startWelcomeAnimation(){
    const el = document.getElementById("welcomeText");
    if(!el) return;

    const finalText = el.getAttribute("data-text") || "Bienvenido";
    el.textContent = "";

    let i = 0;
    function type(){
      if(i <= finalText.length){
        el.textContent = finalText.slice(0, i);
        i++;
        setTimeout(type, 42);
      }else{
        setTimeout(function(){
          el.style.setProperty("--cursor", "none");
        }, 900);
      }
    }
    setTimeout(type, 220);
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", startWelcomeAnimation);
  }else{
    startWelcomeAnimation();
  }
})();

function showWelcome(user){
  const name = user.full_name || "Estudiante";
  const welcome = document.getElementById("welcomeText");
  if(!welcome) return;

  let text = `BIENVENIDO, ${name.toUpperCase()}`;
  let i = 0;
  welcome.innerHTML = "";

  const typing = setInterval(()=>{
    welcome.innerHTML += text[i];
    i++;
    if(i >= text.length) clearInterval(typing);
  }, 30);
}

/* ===== ULTRA FORCE LOGIN VISIBLE FIX - FINAL =====
   Este parche evita que el loader, render, chart, chat o cualquier error visual bloquee el portal.
*/
(function(){
  function el(id){ return document.getElementById(id); }
  function val(id){ return String(el(id)?.value || '').trim(); }
  function txt(id, value){ const x = el(id); if(x) x.innerText = value; }
  function hide(id){ const x = el(id); if(x){ x.classList.add('hidden'); x.style.display = 'none'; } }
  function showPortal(){
    const p = el('portal');
    if(!p) return;
    p.classList.remove('hidden');
    p.classList.add('portalReady');
    p.style.display = window.innerWidth <= 980 ? 'block' : 'grid';
    p.style.visibility = 'visible';
    p.style.opacity = '1';
  }
  function clean(s){ return String(s || '').trim(); }
  function roleOf(u){
    const r = clean(u?.role).toLowerCase();
    const c = clean(u?.access_code).toLowerCase();
    return r === 'admin' ? 'admin' : 'student';
  }
  function statusOf(u){ return clean(u?.status).toLowerCase() || 'active'; }
  function activatePage(id){
    document.querySelectorAll('.page').forEach(p=>{p.classList.add('hidden'); p.classList.remove('forceActive'); p.style.display='none';});
    const page = el(id);
    if(page){ page.classList.remove('hidden'); page.classList.add('forceActive'); page.style.display='block'; }
    syncPortalNavigation(id);
  }
  async function safeBackgroundRender(isAdmin){
    setTimeout(async function(){
      try{ if(typeof render === 'function') await render(); }catch(e){ console.error('Render falló pero el portal queda abierto:', e); }
      try{ if(typeof startChatRefresh === 'function') startChatRefresh(); }catch(e){ console.warn(e); }
      try{ if(isAdmin && typeof loadAdminChatInbox === 'function') loadAdminChatInbox(); }catch(e){ console.warn(e); }
      try{ if(!isAdmin && typeof updateStudentUnreadCount === 'function') updateStudentUnreadCount(); }catch(e){ console.warn(e); }
    }, 200);
  }
  async function openPortal(user){
    currentUser = user;
    const role = roleOf(user);
    currentUser.role = role;
    if(role === 'admin') currentUser.status = 'active';
    localStorage.setItem('olon_current_user', JSON.stringify(currentUser));

    const isAdmin = role === 'admin';
    el('portal')?.classList.toggle('admin-mode', isAdmin);
    txt('studentName', currentUser.full_name || (isAdmin ? 'Admin' : 'Estudiante'));
    txt('avatarText', (currentUser.full_name || 'O').charAt(0).toUpperCase());
    txt('userCodeText', 'Código: ' + (currentUser.access_code || 'OLON'));
    txt('planBadge', isAdmin ? 'ADMIN' : 'VIP');
    txt('accessStatus', isAdmin ? 'Administrador activo' : 'Membresía VIP');
    txt('portalMode', isAdmin ? 'Administración' : 'Portal del Trader');
    renderVipPayment(currentUser);
    txt('pageTitle', isAdmin ? 'Administración' : 'Resumen de rendimiento');
    txt('pageSubtitle', isAdmin ? 'Gestión de miembros, solicitudes y mensajes.' : 'Control privado de rendimiento, disciplina, reportes y progreso del trader.');
    txt('portalWelcomeText', 'Hola, ' + (currentUser.full_name || 'Estudiante'));

    hide('auth');
    hide('codeResult');
    showPortal();

    document.querySelectorAll('.studentNav').forEach(x=>x.classList.toggle('hidden', isAdmin));
    document.querySelectorAll('.adminNav').forEach(x=>x.classList.toggle('hidden', !isAdmin));
    document.querySelectorAll('.studentOnly').forEach(x=>x.classList.toggle('hidden', isAdmin));

    activatePage(isAdmin ? 'admin' : 'dashboard');
    window.olonProfile?.start();
    window.olonAcademy?.startClassNotifications();
    await safeBackgroundRender(isAdmin);
  }

  window.enterPortal = async function(){
    if(currentUser) await openPortal(currentUser);
  };

  window.login = function(){ return window.olonSecureLogin(); };

    document.addEventListener('DOMContentLoaded', function(){
    const btn = [...document.querySelectorAll('button')].find(b => (b.getAttribute('onclick') || '').includes('login()'));
    if(btn){ btn.onclick = function(ev){ ev.preventDefault(); window.login(); }; }
  });
})();


/* ===== LOGIN MOVIL: un solo evento click, sin doble submit ===== */
(function(){
  function bindMobileLogin(){
    for(const id of ["loginSubmitBtn", "signupSubmitBtn"]){
      const btn=document.getElementById(id);
      if(!btn) continue;
      btn.type="button";
      btn.style.touchAction="manipulation";
    }
    // Los onclick existentes disparan el método seguro con bloqueo authBusy.
    // No añadir touchend/pointerup: algunos navegadores generan ambos y un click.
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded",bindMobileLogin);
  else bindMobileLogin();
})();


/* ===== OLON RESCUE FIX: MENU INTERACTIVO ===== */
(function(){
  function $(id){ return document.getElementById(id); }
  function clean(t){ return String(t||"").replace(/[^\wÁÉÍÓÚáéíóúñÑ# ]/g,"").replace(/\s+/g," ").trim(); }

  const subtitles = {
    dashboard:"Tu actividad y progreso en la academia.",
    institutionalFlowPage:"OLFX Institutional Contract Flow · GC y NQ · Fuentes verificables.",
    registro:"Registra depósito, ganancia, pérdida y notas del día.",
    historial:"Revisa tus resultados y movimientos de capital.",
    comparacion:"Compara tu mes actual con el mes anterior.",


    newsProPage:"Titulares y calendario económico.",
    academyClassesPage:"Próximas sesiones y material de repaso.",
    academyVipPage:"Comprobantes y próxima fecha de pago.",
    academyChecklistPage:"Tus reglas y la revisión de cada día.",
    academyJournalPage:"Captura y notas privadas de tu operación.",
    notificationsPage:"Avisos de clases y renovación VIP en tus dispositivos.",
    academyAdminClassesPage:"Agenda, acceso y grabaciones de la academia.",
    academyAdminVipPage:"Revisión de comprobantes de membresía.",
    admin:"Panel administrativo profesional.",
    adminChat:"Centro de mensajes privados."
  };

  window.showPage = function(id, btn){
    try{
      const page = $(id);
      if(!page){
        console.warn("No existe page:", id);
        return;
      }

      document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
      page.classList.remove("hidden");

      document.querySelectorAll("#sidebar .portalNavLink").forEach(b => b.classList.remove("active"));
      if(btn) btn.classList.add("active");

      const title = $("pageTitle");
      if(title) title.innerText = id === "dashboard" ? "Resumen de rendimiento" : btn ? clean(btn.querySelector(".portalNavText")?.textContent || btn.textContent) : id === "academyJournalPage" ? "Diario visual" : clean(id);

      const sub = $("pageSubtitle");
      if(sub && subtitles[id]) sub.innerText = subtitles[id];

      if(id === "newsProPage") void marketNews.load();
      if(id === "adminChat" && typeof window.loadAdminChatInbox === "function") setTimeout(window.loadAdminChatInbox, 80);
      if(id === "admin" && typeof window.renderUsers === "function") setTimeout(window.renderUsers, 80);
      if(id === "dashboard" && typeof window.updatePortalWelcome === "function") setTimeout(window.updatePortalWelcome, 80);
    }catch(err){
      console.error("RESCUE showPage error", err);
    }
  };

  window.showPageById = function(id){
    const btn = document.querySelector(`[data-page="${id}"], .nav button[onclick*="'${id}'"]`);
    window.showPage(id, btn);
  };

})();

/* =====================================================
   FIX FINAL YTD MOBILE - JS SAFE
   ===================================================== */
(function(){
  window.setReportViewSafe = function(view){
    view = String(view || "weekly").toLowerCase();
    if(!["weekly","monthly","ytd"].includes(view)) view = "weekly";

    try{
      if(typeof window.setReportView === "function"){
        window.setReportView(view);
      }else{
        window.currentReportView = view;
        if(typeof window.renderSelectedReport === "function") window.renderSelectedReport();
      }

      ["weekly","monthly","ytd"].forEach(function(v){
        const btn = document.querySelector('[data-report="'+v+'"]');
        if(btn) btn.classList.toggle("active", v === view);
      });

      const select = document.getElementById("mobileReportSelect");
      if(select && select.value !== view) select.value = view;

      const card = document.querySelector(".selectedReportCard");
      if(card && window.innerWidth <= 700){
        setTimeout(() => {
          card.scrollIntoView({behavior:"smooth", block:"nearest"});
        }, 80);
      }
    }catch(err){
      console.error("setReportViewSafe error:", err);
    }
  };

  function handleReportTap(e){
    const btn = e.target.closest("[data-report]");
    if(!btn) return;

    const view = btn.getAttribute("data-report");
    if(!view) return;

    e.preventDefault();
    e.stopPropagation();
    if(e.stopImmediatePropagation) e.stopImmediatePropagation();

    window.setReportViewSafe(view);
    return false;
  }

  ["click","pointerdown","touchstart"].forEach(function(evt){
    document.addEventListener(evt, handleReportTap, {capture:true, passive:false});
  });

  document.addEventListener("DOMContentLoaded", function(){
    const active = document.querySelector(".reportTapBtn.active,[data-report].active");
    const view = active?.getAttribute("data-report") || window.currentReportView || "weekly";
    window.setReportViewSafe(view);
  });
})();

/* =====================================================
   META ANUAL INPUT FIX
   ===================================================== */
(function(){
  document.addEventListener("keydown", function(e){
    const input = e.target && e.target.id === "yearlyGoalInput" ? e.target : null;
    if(!input) return;

    if(e.key === "Enter"){
      e.preventDefault();
      if(typeof saveYearlyGoal === "function") saveYearlyGoal();
      input.blur();
    }
  });

  document.addEventListener("blur", function(e){
    const input = e.target && e.target.id === "yearlyGoalInput" ? e.target : null;
    if(!input) return;
    if(input.value && Number(input.value) > 0 && typeof saveYearlyGoal === "function"){
      saveYearlyGoal();
    }
  }, true);
})();

const marketNews = (() => {
  const filters = Array.from($("newsProPage").querySelectorAll("[data-news-category]"));
  const categories = new Map(filters.map(button => [button.dataset.newsCategory, button.textContent.trim()]));
  const search = $("newsSearchInput");
  const refresh = $("newsRefresh");
  const container = $("newsContainer");
  const template = $("newsArticleTemplate");
  const cache = new Map();
  const cacheDuration = 4 * 60_000;
  const dateLabel = new Intl.DateTimeFormat("es-PR", {
    timeZone: "America/Puerto_Rico", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
  });
  let category = "general";
  let request = null;
  let failed = false;

  function plainText(value){
    if(typeof value !== "string") return "";
    const text = document.createElement("template");
    text.innerHTML = value;
    return text.content.textContent.replace(/\s+/g, " ").trim();
  }

  function searchText(value){
    return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  }

  function articleUrl(value){
    try{
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password ? url : null;
    }catch{
      return null;
    }
  }

  function parseArticles(data){
    const articles = [];
    for(const item of data){
      const rawHeadline = plainText(item?.headline);
      const url = articleUrl(item?.url);
      if(!rawHeadline || !url) continue;

      const isGoogleNews = url.hostname === "news.google.com";
      const separator = isGoogleNews ? rawHeadline.lastIndexOf(" - ") : -1;
      const suffix = separator > 0 ? rawHeadline.slice(separator + 3) : "";
      const hasPublisher = suffix.length > 0 && suffix.length <= 75;
      const headline = hasPublisher ? rawHeadline.slice(0, separator) : rawHeadline;
      const source = plainText(item.source) || (hasPublisher ? suffix : isGoogleNews ? "Google News" : url.hostname.replace(/^www\./, ""));
      const headlineKey = searchText(headline);

      let summary = plainText(item.summary);
      if(summary.endsWith(source)) summary = summary.slice(0, -source.length).replace(/\s*-\s*$/, "").trim();
      if(headlineKey.startsWith(searchText(summary))) summary = "";

      const seconds = Number(item.datetime);
      const datetime = seconds > 0 && Number.isFinite(new Date(seconds * 1000).getTime()) ? seconds : 0;
      articles.push({headline, source, summary, url: url.href, datetime, headlineKey, searchable: searchText([headline, source, summary].join(" "))});
    }

    articles.sort((first, second) => second.datetime - first.datetime);
    const headlines = new Set();
    const urls = new Set();
    return articles.filter(article => {
      if(headlines.has(article.headlineKey) || urls.has(article.url)) return false;
      headlines.add(article.headlineKey);
      urls.add(article.url);
      return true;
    }).slice(0, 24);
  }

  function articleCard(article, index, featured){
    const card = template.content.cloneNode(true);
    card.firstElementChild.classList.toggle("newsCardLead", featured);
    card.querySelector(".newsLeadLabel").hidden = !featured || !article.datetime;

    const title = card.querySelector(".newsHeadline");
    title.id = "newsHeadline-" + index;
    title.textContent = article.headline;
    const link = card.querySelector(".newsCardLink");
    link.href = article.url;
    link.setAttribute("aria-labelledby", title.id);
    card.querySelector(".newsSource").textContent = article.source;

    if(article.datetime){
      const time = card.querySelector(".newsArticleTime");
      const published = new Date(article.datetime * 1000);
      time.dateTime = published.toISOString();
      time.textContent = dateLabel.format(published);
      time.hidden = false;
    }
    if(article.summary){
      const summary = card.querySelector(".newsSummary");
      summary.textContent = article.summary;
      summary.hidden = false;
    }
    return card;
  }

  function render(){
    const entry = cache.get(category);
    const articles = entry?.articles || [];
    const words = searchText(search.value.trim()).split(/\s+/).filter(Boolean);
    const visible = articles.filter(article => words.every(word => article.searchable.includes(word)));
    filters.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.newsCategory === category)));
    refresh.disabled = Boolean(request);
    container.setAttribute("aria-busy", String(Boolean(request)));

    const status = $("newsStatus");
    status.textContent = request ? "Consultando titulares…" :
      failed ? (entry ? "Actualización interrumpida · Mostrando la última consulta" : "Conexión con noticias interrumpida") :
      visible.length + (visible.length === 1 ? " titular" : " titulares") + " · " + categories.get(category);
    status.dataset.error = String(failed);

    $("newsUpdated").hidden = !entry;
    if(entry){
      const time = $("newsUpdatedAt");
      time.dateTime = entry.loadedAt.toISOString();
      time.textContent = dateLabel.format(entry.loadedAt);
    }

    $("newsEmptyState").hidden = Boolean(request || visible.length);
    if(!request && !visible.length){
      const unavailable = failed && !entry;
      $("newsEmptyTitle").textContent = unavailable ? "Noticias no disponibles" : words.length ? "Sin coincidencias" : "Sin publicaciones recientes";
      $("newsEmptyText").textContent = unavailable ? "Pulsa Actualizar para volver a consultar." : words.length ? "Prueba con otro titular o fuente." : "Explora otra categoría o actualiza la consulta.";
    }

    if(request && !articles.length){
      const placeholders = Array.from({length: 3}, () => {
        const placeholder = document.createElement("div");
        placeholder.className = "newsSkeleton";
        placeholder.setAttribute("aria-hidden", "true");
        return placeholder;
      });
      container.replaceChildren(...placeholders);
      return;
    }
    container.replaceChildren(...visible.map((article, index) => articleCard(article, index, index === 0 && !words.length)));
  }

  async function load(next = category, force = false){
    if(!categories.has(next) || request?.category === next) return;
    request?.controller.abort();
    request = null;
    category = next;
    failed = false;

    const entry = cache.get(category);
    if(entry && !force && Date.now() - entry.loadedAt.getTime() < cacheDuration){
      window.olonLatestNewsList = entry.articles;
      render();
      return;
    }

    const controller = new AbortController();
    const pending = {category, controller};
    request = pending;
    render();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try{
      const endpoint = SUPABASE_URL + "/functions/v1/quick-worker?category=" + encodeURIComponent(next);
      const response = await fetch(endpoint, {signal: controller.signal, cache: force ? "reload" : "default"});
      if(!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      if(!Array.isArray(data)) throw new Error("Respuesta de noticias inválida");
      if(request !== pending) return;

      const articles = parseArticles(data);
      cache.set(next, {articles, loadedAt: new Date()});
      window.olonLatestNewsList = articles;
    }catch(error){
      if(request !== pending) return;
      failed = true;
      console.warn("Error consultando noticias:", error);
    }finally{
      clearTimeout(timeout);
      if(request === pending){
        request = null;
        render();
      }
    }
  }

  filters.forEach(button => button.addEventListener("click", () => void load(button.dataset.newsCategory)));
  search.addEventListener("input", render);
  refresh.addEventListener("click", () => void load(category, true));
  return {load};
})();

/* =====================================================
   OLON SOCIETY ACADEMY — LOGIN NIVEL DIOS JS
   Pega este JS AL FINAL de tu script.js
   ===================================================== */

function olonGodAnimateNumber(id, target, options = {}){
  const el = document.getElementById(id);
  if(!el) return;

  const prefix = options.prefix || "";
  const suffix = options.suffix || "";
  const duration = options.duration || 1500;
  const start = Number(options.start || 0);
  const startTime = performance.now();

  function frame(now){
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = Math.floor(start + (Number(target || 0) - start) * eased);
    el.innerText = prefix + value.toLocaleString("en-US") + suffix;

    if(progress < 1){
      requestAnimationFrame(frame);
    }
  }

  requestAnimationFrame(frame);
}

function olonGodDailyVerse(){
  const verses = [
    "Filipenses 4:13 — Todo lo puedo en Cristo que me fortalece.",
    "Salmo 23:1 — El Señor es mi pastor; nada me faltará.",
    "Proverbios 3:5 — Confía en el Señor con todo tu corazón.",
    "Josué 1:9 — Sé fuerte y valiente; Dios está contigo.",
    "Romanos 8:28 — Dios obra para bien en quienes le aman.",
    "Isaías 41:10 — No temas, porque Dios está contigo.",
    "Mateo 6:33 — Busca primero el reino de Dios.",
    "Jeremías 29:11 — Yo sé los planes que tengo para ustedes, planes de bienestar.",
    "Salmo 37:5 — Encomienda al Señor tu camino; confía en él.",
    "2 Timoteo 1:7 — Dios no nos ha dado espíritu de cobardía, sino de poder."
  ];

  const dayIndex = new Date().getDate() % verses.length;
  const verseText = verses[dayIndex];

  const targets = [
    document.getElementById("loginDailyVerse"),
    document.getElementById("dailyBibleVerse")
  ].filter(Boolean);

  targets.forEach(el => {
    el.innerText = verseText;
  });
}

function olonGodLoginCounters(){
  const activeStudents = document.getElementById("authActiveStudents");
  const trades = document.getElementById("authTradesRegistered");

  // Las cifras reales se consultan en Supabase; nunca se inventan totales.
  // La portada pública no tiene permiso para consultar datos privados con RLS.
  if(!activeStudents?.textContent?.trim()) activeStudents.textContent="0";
  if(!trades?.textContent?.trim()) trades.textContent="+0";
  const discipline=document.getElementById("authDisciplinePercent");
  if(discipline) discipline.textContent="—";
}

function olonGodInputMicroInteractions(){
  document.querySelectorAll(".authPanel input, .authPanel select").forEach(el => {
    el.addEventListener("focus", () => {
      const field = el.closest(".field");
      if(field) field.classList.add("fieldActive");
    });
    el.addEventListener("blur", () => {
      const field = el.closest(".field");
      if(field) field.classList.remove("fieldActive");
    });
  });
}

document.addEventListener("DOMContentLoaded", function(){
  olonGodDailyVerse();
  olonGodInputMicroInteractions();

  setTimeout(() => {
    olonGodLoginCounters();
  }, 700);
});



/* ============================================================
   OLON SOCIETY | CONEXION SEGURA SUPABASE AUTH (2026-11-04)
   - Inicio de sesión por EMAIL + contraseña de Supabase Auth.
   - El código OLON sigue siendo un identificador, no una contraseña.
   - La identidad, el rol y el estado se leen del servidor (RLS).
   - Nunca se consulta ni se muestra profiles.password.
   - Requiere el SQL de reconstrucción y Auth Email activado.
   ============================================================ */
(function(){
  "use strict";
  let authBusy = false;
  const $auth = id => document.getElementById(id);
  const PROFILE_FIELDS = "id,email,full_name,access_code,role,plan,status,next_payment_date,created_at";

  function showAuthError(error, fallback){
    console.error("OLON Auth:", error);
    const msg = String(error?.message || "").toLowerCase();
    if(msg.includes("invalid login credentials")) return "Correo o contraseña incorrectos.";
    if(msg.includes("jwt") || msg.includes("session expired")) return "Tu sesión expiró. Inicia sesión de nuevo.";
    if(msg.includes("row-level security") || msg.includes("permission denied") || msg.includes("42501")) return "Supabase bloqueó la operación por permisos RLS. Verifica el SQL y la aprobación de la cuenta.";
    if(msg.includes("email not confirmed")) return "Confirma tu correo electrónico antes de iniciar sesión.";
    if(msg.includes("failed to fetch") || msg.includes("network")) return "No se pudo conectar con Supabase. Comprueba internet y la URL del proyecto.";
    if(msg.includes("user already registered")) return "Este correo ya tiene una cuenta. Inicia sesión o recupera tu contraseña.";
    if(msg.includes("email rate limit exceeded") || msg.includes("over_email_send_rate_limit") || Number(error?.status)===429)
      return "El servicio de correo de OLON alcanzó temporalmente su límite de envíos. No vuelvas a crear la cuenta repetidamente: espera a que se restablezca el servicio o contacta soporte. El administrador debe configurar correo SMTP propio para permitir más registros.";
    if(msg.includes("email address not authorized") || msg.includes("email_address_not_authorized"))
      return "El servicio de correo aún no está configurado para enviar mensajes a este destinatario. Contacta soporte para activar el correo oficial de OLON Society Academy.";
    return fallback + (error?.message ? "\n" + error.message : "");
  }
  async function profileForAuthenticatedUser(user){
    if(!user?.id) throw new Error("No hay sesión autenticada.");
    const {data,error} = await supabaseClient.from("profiles")
      .select(PROFILE_FIELDS).eq("id",user.id).maybeSingle();
    if(error) throw error;
    if(!data) throw new Error("Tu usuario existe en Auth, pero falta su perfil. Revisa el trigger olon_auth_user_created en SQL Editor.");
    return data;
  }
  function membershipExpired(profile, now = new Date()){
    if(!profile || String(profile.role||"").toLowerCase()==="admin") return false;
    const due=String(profile.next_payment_date||"");
    if(!/^\d{4}-\d{2}-\d{2}$/.test(due))return false;
    const valid=new Date(due+"T00:00:00Z");
    if(!Number.isFinite(valid.getTime())||valid.toISOString().slice(0,10)!==due)return false;
    const fmt=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Puerto_Rico",year:"numeric",month:"2-digit",day:"2-digit"});
    const pr=Object.fromEntries(fmt.formatToParts(now).map(part=>[part.type,part.value]));
    const today=pr.year+"-"+pr.month+"-"+pr.day;
    return due<=today;
  }
  function showMembershipExpiredNotice(){
    const notice=$auth("membershipExpiredNotice");
    if(notice)notice.hidden=false;
    $auth("homeAccess")?.scrollIntoView({behavior:"smooth",block:"center"});
  }
  function canUsePortal(profile){
    return !!profile && ["active","approved"].includes(String(profile.status||"").toLowerCase()); // VIP expiry is handled by OLFX License Manager while data are retained.
  }
  async function openVerifiedProfile(profile,user){
    currentUser = profile;
    window.olonAppearance?.setAccount(user);
    // Aislar la distribución del administrador de la interfaz del estudiante.
    const portalElement = document.getElementById("portal");
    if(portalElement) portalElement.classList.toggle("admin-mode", String(profile?.role||"").trim().toLowerCase()==="admin");
    localStorage.setItem("olon_current_user", JSON.stringify(profile));
    // Keep private VIP content gated during license verification, without a loading overlay.
    if(String(profile.role).toLowerCase()!=="admin")document.body.classList.add("olonLicenseChecking");
    else document.body.classList.remove("olonLicenseChecking","olonLicenseRenewalRequired");
    showPortalLoader("Preparando tu espacio…");
    await window.enterPortal();
  }
  function setBusy(busy){
    authBusy = busy;
    for(const id of ["loginSubmitBtn","signupSubmitBtn"]){
      const btn = $auth(id); if(btn) btn.disabled = busy;
    }
  }
  window.olonSecureLogin = async function(){
    if(authBusy) return;
    const identifier = String($auth("loginCode")?.value||"").trim().toLowerCase();
    // Alias de comodidad, no es un privilegio ni evita la autenticación real.
    // Supabase Auth sigue verificando la contraseña y el perfil del servidor.
    const email = identifier === "admin" ? "erickinventus@gmail.com" : identifier;
    const password = String($auth("loginPass")?.value||"");
    if(!identifier || !password){ alert("Escribe tu usuario o correo y contraseña."); return; }
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
      alert("Usa tu correo electrónico o el usuario admin. El acceso se verifica con Supabase Auth.");
      return;
    }
    setBusy(true);
    showPortalLoader("Verificando tu acceso…");
    if(typeof window.playPortalLoadingSound === "function") window.playPortalLoadingSound();
    try{
      const {data,error} = await supabaseClient.auth.signInWithPassword({email,password});
      if(error) throw error;
      const profile = await profileForAuthenticatedUser(data.user);
      const expiredNotice=$auth("membershipExpiredNotice");
      if(expiredNotice)expiredNotice.hidden=true;
      if(!canUsePortal(profile)){
        await supabaseClient.auth.signOut();
        const status = String(profile.status||"").toLowerCase();
        if(membershipExpired(profile)){
          showMembershipExpiredNotice();
        }else{
          alert(status === "pending"
            ? "Tu cuenta está pendiente de aprobación por el administrador. Tu código de referencia es: " + (profile.access_code||"pendiente")
            : "Tu cuenta no está activa. Contacta al administrador.");
        }
        return;
      }
      await openVerifiedProfile(profile,data.user);
    }catch(error){
      alert(showAuthError(error,"No se pudo iniciar sesión."));
      await supabaseClient.auth.signOut().catch(()=>{});
    }finally{
      setBusy(false);
      hidePortalLoader();
    }
  };

  window.olonSecureSignup = async function(){
    if(authBusy)return;
    const name=String($auth("signupName")?.value||"").trim();
    const email=String($auth("signupEmail")?.value||"").trim().toLowerCase();
    const confirm=String($auth("signupEmailConfirm")?.value||"").trim().toLowerCase();
    const website=String($auth("signupWebsite")?.value||"");
    if(name.length<2 || name.length>120){alert("Escribe tu nombre completo.");return;}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254){alert("Escribe un correo electrónico válido.");return;}
    if(email!==confirm){alert("Los correos electrónicos no coinciden.");return;}
    setBusy(true);
    try{
      // Una solicitud no es una cuenta de acceso. El administrador verificará
      // la petición y generará credenciales temporales por un canal privado.
      const response=await fetch(SUPABASE_URL+"/functions/v1/registration-gateway",{
        method:"POST",
        headers:{"Content-Type":"application/json","apikey":SUPABASE_KEY},
        body:JSON.stringify({action:"apply",name,email,website})
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||"No se pudo enviar la solicitud.");
      const card=$auth("signupRequestResult");
      if(card){
        card.hidden=false;
        card.textContent="✓ "+(result.message||"Solicitud recibida. Un administrador revisará tu acceso.");
      }
      const send=$auth("signupSubmitBtn");
      if(send)send.textContent="✓ Solicitud recibida";
      alert("Solicitud enviada a OLON Society Academy. El administrador la revisará y te comunicará los datos de acceso. Este proceso NO requiere un correo automático.");
    }catch(error){
      alert(showAuthError(error,"No se pudo enviar la solicitud."));
    }finally{
      setBusy(false);
    }
  };
  // Anular todos los logins heredados y delegar al sistema seguro.
  window.login = window.olonSecureLogin;
  window.signup = window.olonSecureSignup;
  let logoutInProgress=false;
  window.logout = async function(){
    if(logoutInProgress)return;
    logoutInProgress=true;
    const buttons=document.querySelectorAll("[data-olon-logout]");
    buttons.forEach(button=>{button.disabled=true;button.setAttribute("aria-busy","true");});
    try{
      await window.olonPush?.beforeLogout();
      const {error}=await supabaseClient.auth.signOut({scope:"local"});
      if(error)throw error;
      window.olonInstitutionalFlow?.stop();
      localStorage.removeItem("olon_current_user");
      currentUser=null;cachedRecords=[];cachedUsers=[];
      window.olonCommunity?.clear();
      window.olonProfile?.clear();
      window.olonAppearance?.setAccount(null);
      window.olonAcademy?.stopClassNotifications();
      setPortalMenu(false);
      document.getElementById("portal")?.classList.add("hidden");
      document.getElementById("auth")?.classList.remove("hidden");
      window.scrollTo(0,0);
      window.location.replace(window.location.pathname+"?logout=1");
    }catch(error){
      console.error("Error cerrando sesión:",error);
      alert("No se pudo cerrar sesión. Comprueba tu conexión e inténtalo nuevamente.");
    }finally{
      logoutInProgress=false;
      buttons.forEach(button=>{button.disabled=false;button.removeAttribute("aria-busy");});
    }
  };

  async function restoreSupabaseSession(){
    showPortalLoader("Comprobando tu sesión…");
    try{
      const {data,error} = await supabaseClient.auth.getUser();
      if(error || !data?.user) return;
      const profile = await profileForAuthenticatedUser(data.user);
      if(!canUsePortal(profile)){
        await supabaseClient.auth.signOut();
        if(membershipExpired(profile))showMembershipExpiredNotice();
        return;
      }
      await openVerifiedProfile(profile,data.user);
    }catch(error){
      console.warn("OLON: no se restauró la sesión Auth",error);
      currentUser=null;
      localStorage.removeItem("olon_current_user");
    }finally{
      hidePortalLoader();
    }
  }
  let lastMembershipCheck=0;
  async function recheckMembership(){
    if(!currentUser || String(currentUser.role||"").toLowerCase()==="admin" ||
      document.getElementById("portal")?.classList.contains("hidden"))return;
    if(Date.now()-lastMembershipCheck<30000)return;
    lastMembershipCheck=Date.now();
    const {data,error}=await supabaseClient.auth.getUser();
    if(error||!data?.user)return;
    const profile=await profileForAuthenticatedUser(data.user);
    if(canUsePortal(profile)){currentUser.next_payment_date=profile.next_payment_date;renderVipPayment(currentUser);return;}
    await supabaseClient.auth.signOut().catch(()=>{});
    localStorage.removeItem("olon_current_user");
    currentUser=null;
    document.getElementById("portal")?.classList.add("hidden");
    document.getElementById("auth")?.classList.remove("hidden");
    if(membershipExpired(profile))showMembershipExpiredNotice();
  }
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)void recheckMembership().catch(console.warn);});
  window.addEventListener("focus",()=>void recheckMembership().catch(console.warn));
  setInterval(()=>{if(!document.hidden)void recheckMembership().catch(console.warn);},60000);
  // DOMContentLoaded se dispara después de los módulos del portal cargados con defer.
  if(document.readyState === "complete") void restoreSupabaseSession();
  else document.addEventListener("DOMContentLoaded",restoreSupabaseSession,{once:true});
})();

const portalMenuBreakpoint = window.matchMedia("(max-width: 980px)");
let portalMenuReturnFocus = null;
let portalMenuFocusFrame = null;

function positionPortalTools(){
  const portal = $("portal");
  const nav = $("portalDock");
  const toggle = $("portalMoreToggle");
  if(!portal || !nav || !toggle) return;
  const edge = nav.getBoundingClientRect();
  const trigger = toggle.getBoundingClientRect();
  const top = Math.max(8, Math.min(window.innerHeight - 120, edge.bottom + 8));
  const menuWidth = Math.min(460, window.innerWidth - 28);
  const left = Math.max(14, Math.min(trigger.left, window.innerWidth - menuWidth - 14));
  portal.style.setProperty("--terminal-menu-top", `${Math.round(top)}px`);
  portal.style.setProperty("--terminal-menu-right", `${Math.round(window.innerWidth - left - menuWidth)}px`);
}

function setPortalMenu(open, restoreFocus = false){
  const portal = $("portal");
  const sidebar = $("sidebar");
  const dock = $("portalDock");
  const wasOpen = sidebar.classList.contains("open");
  const persistentStudentNav = window.innerWidth > 980 && !portal.classList.contains("admin-mode");
  const expanded = Boolean(open && !persistentStudentNav && !portal.classList.contains("hidden"));

  if(portalMenuFocusFrame !== null){
    window.cancelAnimationFrame(portalMenuFocusFrame);
    portalMenuFocusFrame = null;
  }
  if(expanded && !wasOpen) portalMenuReturnFocus = document.activeElement;
  if(expanded) positionPortalTools();
  sidebar.classList.toggle("open", expanded);
  sidebar.inert = !expanded && !persistentStudentNav;
  sidebar.setAttribute("aria-hidden", String(!expanded && !persistentStudentNav));
  if(expanded) sidebar.setAttribute("aria-modal", "true");
  else sidebar.removeAttribute("aria-modal");
  portal.querySelector("main.main").inert = expanded;
  dock.inert = expanded;
  [$("mobileMenuToggle"), $("portalMoreToggle")].forEach(toggle => {
    toggle?.setAttribute("aria-expanded", String(expanded));
  });
  $("portalMenuBackdrop").hidden = !expanded;
  portal.classList.toggle("portalMenuOpen", expanded);

  if(expanded && !wasOpen){
    // Visibility can remain hidden during its CSS transition. Wait for the
    // actual visible state rather than assuming a single frame is sufficient.
    const focusWhenVisible = () => {
      portalMenuFocusFrame = null;
      if(!sidebar.classList.contains("open") || portal.classList.contains("hidden")) return;
      const close = $("portalMenuClose");
      if(close.getClientRects().length && getComputedStyle(close).visibility === "visible"){
        close.focus({preventScroll: true});
      }else portalMenuFocusFrame = window.requestAnimationFrame(focusWhenVisible);
    };
    portalMenuFocusFrame = window.requestAnimationFrame(focusWhenVisible);
  }
  if(!expanded && wasOpen && restoreFocus && !portal.classList.contains("hidden")){
    const previous = portalMenuReturnFocus;
    const target = previous?.isConnected && previous.getClientRects().length && !previous.closest("[inert]")
      ? previous : $("portalMoreToggle");
    target.focus({preventScroll: true});
  }
  if(!expanded) portalMenuReturnFocus = null;
}

function syncPortalNavigation(pageId){
  document.querySelectorAll("#sidebar .portalNavLink").forEach(link => {
    const active = link.dataset.page === pageId;
    link.classList.toggle("active", active);
    if(active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  let primaryPage = false;
  document.querySelectorAll("#portalDock [data-dock-page]").forEach(link => {
    const pages = (link.dataset.dockPages || link.dataset.dockPage).split(" ");
    const active = !link.classList.contains("hidden") && pages.includes(pageId);
    link.classList.toggle("active", active);
    if(active){
      primaryPage = true;
      link.setAttribute("aria-current", "page");
    }else link.removeAttribute("aria-current");
  });
  const more = $("portalMoreToggle");
  more.classList.toggle("active", Boolean(pageId && !primaryPage));
  if(pageId && !primaryPage) more.setAttribute("aria-current", "page");
  else more.removeAttribute("aria-current");
}

function installPortalNavigation(){
  const portal = $("portal");
  const sidebar = $("sidebar");
  const dock = $("portalDock");
  const more = $("portalMoreToggle");
  const closeMenu = () => setPortalMenu(false, true);
  $("mobileMenuToggle").addEventListener("click", () => setPortalMenu(true));
  more.addEventListener("click", () => setPortalMenu(!sidebar.classList.contains("open"), true));
  $("portalMenuClose").addEventListener("click", closeMenu);
  $("portalMenuBackdrop").addEventListener("click", closeMenu);
  const repositionTools = () => {
    if(sidebar.classList.contains("open")) positionPortalTools();
  };
  window.addEventListener("resize", () => {
    repositionTools();
    if(!sidebar.classList.contains("open"))setPortalMenu(false);
    else if(window.innerWidth>980)setPortalMenu(false);
  }, {passive:true});
  window.addEventListener("scroll", repositionTools, {passive:true});
  dock.addEventListener("click", event => {
    const button = event.target.closest("[data-dock-page]");
    if(!button || button.classList.contains("hidden")) return;
    const id = button.dataset.dockPage;
    const canonical = [...sidebar.querySelectorAll(".portalNavLink")].find(link => link.dataset.page === id);
    window.showPage(id, canonical || button);
  });
  // Profile editing opens its own dialog; release this panel first.
  sidebar.addEventListener("click", event => {
    if(event.target.closest("[data-edit-profile]")) setPortalMenu(false);
  }, true);
  document.addEventListener("keydown", event => {
    if(!sidebar.classList.contains("open")) return;
    if(event.key === "Escape"){
      event.preventDefault();
      closeMenu();
    }else if(event.key === "Tab"){
      const focusable = [...sidebar.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')]
        .filter(element => !element.disabled && element.tabIndex >= 0 && !element.closest("[inert]") && element.getClientRects().length);
      const first = focusable[0] || sidebar;
      const last = focusable[focusable.length - 1] || sidebar;
      if(event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))){
        event.preventDefault(); last.focus();
      }else if(!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))){
        event.preventDefault(); first.focus();
      }
    }
  });
  setPortalMenu(false);

  const showPage = window.showPage;
  window.showPage = function(id, button){
    if(window.olonAcademy?.allows(id) === false) return;
    const previous = document.querySelector("#portal .page:not(.hidden)")?.id;
    const result = showPage.call(this, id, button);
    const current = document.querySelector("#portal .page:not(.hidden)")?.id;
    if(current !== id) return result;

    syncPortalNavigation(id);
    closeMenu();
    if(portalMenuBreakpoint.matches && previous !== id) window.scrollTo({top: 0, behavior: "instant"});
    window.olonAcademy?.openPage(id);
    window.dispatchEvent(new CustomEvent("olon:pagechange", {detail:{id, previous}}));
    return result;
  };

  function syncDockBadges(){
    [["classUnreadBadge", "classes"], ["adminChatBadge", "messages"]].forEach(([sourceId, kind]) => {
      const source = $(sourceId);
      const badge = dock.querySelector(`[data-dock-badge="${kind}"]`);
      if(!source || !badge) return;
      const count = source.textContent.trim();
      const visible = !source.hidden && source.style.display !== "none" && Boolean(count && count !== "0");
      badge.textContent = count;
      badge.hidden = !visible;
      const button = badge.closest("button");
      const label = button.querySelector(".portalDockLabel").textContent;
      button.setAttribute("aria-label", visible ? `${label}: ${count} sin leer` : label);
    });
  }
  const badgeObserver = new MutationObserver(syncDockBadges);
  [$("classUnreadBadge"), $("adminChatBadge")].forEach(source => {
    if(source) badgeObserver.observe(source, {attributes:true, childList:true, characterData:true, subtree:true});
  });
  syncDockBadges();
  let previousRole = portal.classList.contains("admin-mode");
  new MutationObserver(() => {
    const admin = portal.classList.contains("admin-mode");
    if(portal.classList.contains("hidden") || previousRole !== admin) setPortalMenu(false);
    previousRole = admin;
    syncPortalNavigation(portal.querySelector(".page:not(.hidden)")?.id);
  }).observe(portal, {attributes:true, attributeFilter:["class"]});
  syncPortalNavigation(portal.querySelector(".page:not(.hidden)")?.id);
}

if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", installPortalNavigation);
else installPortalNavigation();

document.addEventListener("visibilitychange", () => {
  if(!document.hidden) renderVipPayment(currentUser);
});

/* Institutional Flow bootstrap: no module, styles, data, timers or feed at startup. */
(function(){
  const pageId = 'institutionalFlowPage';
  let modulePromise = null, mounted = null, opening = false, epoch = 0, preparing = null;
  const root = () => document.getElementById(pageId);
  const visible = () => root() && !root().classList.contains('hidden') &&
    !document.getElementById('portal')?.classList.contains('hidden') && !document.hidden;
  function stop(){
    epoch++; opening = false;
    preparing?.abort(); preparing = null;
    mounted?.destroy(); mounted = null;
    root()?.replaceChildren(); root()?.removeAttribute('aria-busy');
  }
  async function open(){
    if(!visible() || mounted || opening) return;
    opening = true;
    preparing = new AbortController();
    const signal = preparing.signal;
    const version = ++epoch, target = root();
    const status = document.createElement('p');
    status.setAttribute('role','status'); status.textContent = 'Cargando Institutional Flow…';
    target.replaceChildren(status); target.setAttribute('aria-busy','true');
    try{
      modulePromise ||= import('./institutional-flow/entry.mjs?v=1').catch(error => {modulePromise = null; throw error;});
      const module = await modulePromise;
      if(version !== epoch || !visible()) return;
      await module.prepare(signal);
      if(version !== epoch || !visible()) return;
      mounted = module.mount(target);
    }catch(error){
      if(version !== epoch || !visible()) return;
      status.textContent = 'No se pudo cargar Institutional Flow. Comprueba tu conexión.';
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Reintentar';
      retry.addEventListener('click', () => {opening = false; void open();}, {once:true});
      target.replaceChildren(status, retry); target.removeAttribute('aria-busy');
    }finally{ if(version === epoch) opening = false; }
  }
  window.olonInstitutionalFlow = Object.freeze({stop});
  window.addEventListener('olon:pagechange', event => {
    if(event.detail.id === pageId) void open();
    else if(mounted || opening) stop();
  });
  document.addEventListener('visibilitychange', () => {
    if(document.hidden) { if(mounted || opening) stop(); }
    else if(visible()) void open();
  });
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', event => {if(event.persisted && visible()) void open();});
})();
