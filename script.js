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

// ===== OLON AUDIO ENGINE FIXED MULTI USER =====
(function(){
  let ctx = null;
  let unlocked = false;
  let lastKey = 0;
  let lastHover = 0;
  let lastClick = 0;
  let lastMsg = 0;

  function soundEnabled(){
    return localStorage.getItem("olon_sound_enabled") !== "false";
  }

  function getCtx(){
    if(!ctx){
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return ctx;
  }

  async function unlockAudio(){
    try{
      const audio = getCtx();
      if(audio.state === "suspended") await audio.resume();

      // silent tap to unlock audio on iPhone/iPad/Safari/Chrome
      const gain = audio.createGain();
      const osc = audio.createOscillator();
      gain.gain.value = 0.00001;
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + 0.01);

      unlocked = true;
    }catch(e){
      console.warn("Audio unlock error", e);
    }
  }

  function tone(freq = 520, duration = 0.04, volume = 0.02, type = "sine", delay = 0){
    if(!soundEnabled()) return;
    try{
      const audio = getCtx();
      if(audio.state === "suspended") audio.resume();

      const start = audio.currentTime + delay;
      const osc = audio.createOscillator();
      const gain = audio.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      osc.connect(gain);
      gain.connect(audio.destination);

      osc.start(start);
      osc.stop(start + duration + 0.02);
    }catch(e){
      console.warn("Audio tone error", e);
    }
  }

  function playMechanicalKeySound(){
    const now = Date.now();
    if(now - lastKey < 34) return;
    lastKey = now;

    tone(1120 + Math.random()*180, 0.024, 0.030, "square");
    tone(160 + Math.random()*40, 0.060, 0.024, "triangle");
  }

  function playBackspaceSound(){
    const now = Date.now();
    if(now - lastKey < 34) return;
    lastKey = now;

    tone(210, 0.048, 0.024, "triangle");
    tone(145, 0.035, 0.014, "sine", 0.018);
  }

  function playPasteSound(){
    tone(520, 0.045, 0.020, "sine");
    tone(760, 0.050, 0.016, "triangle", 0.045);
    tone(980, 0.040, 0.012, "sine", 0.090);
  }

  function playHoverSound(){
    const now = Date.now();
    if(now - lastHover < 130) return;
    lastHover = now;
    tone(410, 0.04, 0.010, "sine");
  }

  function playClickSound(){
    const now = Date.now();
    if(now - lastClick < 80) return;
    lastClick = now;
    tone(260, 0.045, 0.022, "triangle");
    tone(520, 0.032, 0.012, "sine", 0.028);
  }

  function playPortalLoadingSound(){
    tone(180, 0.12, 0.020, "sine");
    tone(360, 0.12, 0.018, "triangle", 0.150);
    tone(620, 0.16, 0.016, "sine", 0.330);
    tone(880, 0.18, 0.014, "sine", 0.560);
  }

  function playNewMessageSound(){
    const now = Date.now();
    if(now - lastMsg < 1200) return;
    lastMsg = now;
    tone(720, 0.08, 0.024, "sine");
    tone(980, 0.10, 0.020, "triangle", 0.095);
    tone(1240, 0.08, 0.016, "sine", 0.190);
  }

  function setupAudioEvents(){
    // Browser audio must be unlocked by a real user gesture on EACH device/browser.
    ["pointerdown","touchstart","mousedown","keydown","click"].forEach(evt=>{
      document.addEventListener(evt, unlockAudio, {once:false, passive:true});
    });

    document.addEventListener("keydown", function(e){
      const tag = (e.target?.tagName || "").toLowerCase();
      const isTyping = tag === "input" || tag === "textarea" || e.target?.isContentEditable;
      if(!isTyping) return;

      if(e.key.length === 1) playMechanicalKeySound();
      else if(e.key === "Backspace" || e.key === "Delete") playBackspaceSound();
      else if(e.key === "Enter") playClickSound();
    });

    document.addEventListener("paste", function(e){
      const tag = (e.target?.tagName || "").toLowerCase();
      const isTyping = tag === "input" || tag === "textarea" || e.target?.isContentEditable;
      if(isTyping) playPasteSound();
    });

    document.addEventListener("mouseover", function(e){
      const target = e.target.closest("button,.card,.nav button,.userPill,.sideBox,.calDay:not(.empty),.reportRow,.aiItem,.v3Card,.adminChatUser");
      if(target) playHoverSound();
    });

    document.addEventListener("click", function(e){
      unlockAudio();
      if(e.target.closest("button,.nav button,.calDay:not(.empty),.adminChatUser")){
        playClickSound();
      }
    }, true);
  }

  // Expose globally for existing portal functions
  window.getOlonAudio = getCtx;
  window.unlockOlonAudio = unlockAudio;
  window.isSoundEnabled = soundEnabled;
  window.playOlonTone = tone;
  window.playMechanicalKeySound = playMechanicalKeySound;
  window.playBackspaceSound = playBackspaceSound;
  window.playPasteSound = playPasteSound;
  window.playHoverSound = playHoverSound;
  window.playClickSound = playClickSound;
  window.playPortalLoadingSound = playPortalLoadingSound;
  window.playNewMessageSound = playNewMessageSound;

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", setupAudioEvents);
  }else{
    setupAudioEvents();
  }
})();

// ===== LOADER PREMIUM OLON =====
window.addEventListener("load", () => {
  const loader = document.getElementById("olonLoader");
  if(!loader) return;
  setTimeout(() => {
    loader.classList.add("hide");
    setTimeout(() => loader.remove(), 900);
  }, 1200);
});

const SUPABASE_URL = "https://bffojtcojnsvzxzwbdes.supabase.co";
const SUPABASE_KEY = "sb_publishable_1qXUiQ6gXpBsyVkWdvq-rA_GwbAotcT";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function updateAuthStudentCount(){
  const el = document.getElementById("authActiveStudents");
  if(!el) return;
  try{
    const { count, error } = await supabaseClient
      .from("profiles")
      .select("id", { count:"exact", head:true })
      .eq("role", "student");
    if(error){ throw error; }
    el.innerText = "+" + Number(count || 0).toLocaleString("en-US");
  }catch(err){
    console.warn("No se pudo contar estudiantes registrados", err);
    el.innerText = "+0";
  }
}

async function updateAuthTradeCount(){
  const el = document.getElementById("authTradesRegistered");
  if(!el) return;
  try{
    const { count, error } = await supabaseClient
      .from("student_records")
      .select("id", { count:"exact", head:true });
    if(error){ throw error; }
    el.innerText = "+" + Number(count || 0).toLocaleString("en-US");
  }catch(err){
    console.warn("No se pudo contar trades registrados", err);
    el.innerText = "+0";
  }
}


async function loadTop3LoginStudents(){
  const box = document.getElementById("top3LoginList");
  if(!box || typeof supabaseClient === "undefined") return;

  try{
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
    const end = new Date(now.getFullYear(), now.getMonth()+1, 0).toISOString().slice(0,10);

    const { data: records, error: recError } = await supabaseClient
      .from("student_records")
      .select("student_id,deposit,gain,loss,record_date")
      .gte("record_date", start)
      .lte("record_date", end);

    if(recError) throw recError;

    const grouped = {};
    (records || []).forEach(r=>{
      const id = r.student_id;
      if(!id) return;
      if(!grouped[id]) grouped[id] = {deposit:0,gain:0,loss:0};
      grouped[id].deposit += Number(r.deposit || 0);
      grouped[id].gain += Number(r.gain || 0);
      grouped[id].loss += Number(r.loss || 0);
    });

    const ids = Object.keys(grouped);
    if(!ids.length){
      box.innerHTML = `<div class="top3Empty">Todavía no hay registros este mes.</div>`;
      return;
    }

    const { data: profiles, error: profError } = await supabaseClient
      .from("profiles")
      .select("id,full_name,role,status")
      .in("id", ids);

    if(profError) throw profError;

    const profileMap = {};
    (profiles || []).forEach(p=>profileMap[p.id] = p);

    const ranking = ids.map(id=>{
      const t = grouped[id];
      const net = Number(t.gain || 0) - Number(t.loss || 0);
      const ret = Number(t.deposit || 0) > 0 ? (net / Number(t.deposit || 0)) * 100 : -999999;
      const profile = profileMap[id] || {};
      return {
        id,
        name: profile.full_name || "Estudiante",
        role: profile.role || "student",
        status: profile.status || "active",
        returnPct: ret
      };
    })
    .filter(x=>x.role !== "admin" && x.status !== "suspended" && x.returnPct > -999999)
    .sort((a,b)=>b.returnPct - a.returnPct)
    .slice(0,3);

    if(!ranking.length){
      box.innerHTML = `<div class="top3Empty">El ranking aparece cuando haya depósitos y resultados registrados.</div>`;
      return;
    }

    const cards = [
      {pos:2, cls:"silver", medal:"🥈"},
      {pos:1, cls:"gold main", medal:"🥇"},
      {pos:3, cls:"bronze", medal:"🥉"}
    ];

    const ordered = [ranking[1], ranking[0], ranking[2]];

    box.innerHTML = `<div class="top3Grid">` + ordered.map((student, idx)=>{
      const meta = cards[idx];
      if(!student){
        return `<div class="topCard ${meta.cls}">
          <div class="topMedal">${meta.medal}</div>
          <div class="topRank">#${meta.pos}</div>
          <div class="topName">---</div>
          <div class="topReturn">Sin data</div>
        </div>`;
      }

      const firstName = String(student.name || "Estudiante").trim().split(" ")[0].toUpperCase();
      const ret = Number(student.returnPct || 0).toFixed(1) + "%";

      return `<div class="topCard ${meta.cls}">
        <div class="topMedal">${meta.medal}</div>
        <div class="topRank">#${meta.pos}</div>
        <div class="topName">${firstName}</div>
        <div class="topReturn">${ret}</div>
      </div>`;
    }).join("") + `</div>`;

  }catch(err){
    console.warn("No se pudo cargar Top 3", err);
    box.innerHTML = `<div class="top3Empty">Top 3 no disponible. Revisa permisos de Supabase.</div>`;
  }
}

function updateAuthRealStats(){
  updateAuthStudentCount();
  updateAuthTradeCount();
}



function setLoaderStudentName(name, plan){
  const first = (name || "Estudiante").trim().split(" ")[0] || "Estudiante";
  const planText = (plan || "VIP Regular").toUpperCase();
  const elName = document.getElementById("loaderStudentName");
  const elPlan = document.getElementById("loaderStudentPlan");
  if(elName) elName.innerText = first.toUpperCase();
  if(elPlan) elPlan.innerText = planText.includes("PREMIUM") || planText.includes("ADMIN") ? "💎 VIP PREMIUM EXPERIENCE" : "🔥 VIP REGULAR ACCESS";
}

function showPortalEnterLoader(){
  const loader = document.getElementById("portalEnterLoader");
  if(loader) loader.classList.add("show");
  if(typeof unlockOlonAudio === "function") unlockOlonAudio();
  if(typeof playPortalLoadingSound === "function") playPortalLoadingSound();
}

function hidePortalEnterLoader(){
  const loader = document.getElementById("portalEnterLoader");
  if(loader) loader.classList.remove("show");
}

function waitPortalLoading(ms = 4000){
  return new Promise(resolve => setTimeout(resolve, ms));
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

let currentUser = JSON.parse(localStorage.getItem("olon_current_user") || "null");
let chart;
let cachedRecords = [];
let cachedUsers = [];

document.getElementById("date").valueAsDate = new Date();

function money(n){return "$" + Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}
function pct(n){return Number(n||0).toFixed(2) + "%"}
function showError(msg, error){ console.error(msg, error || ""); alert(msg + (error?.message ? "\n" + error.message : "")); }

// ===== LOGIN / ROLE SAFE HELPERS =====
function cleanText(value){ return String(value || "").trim(); }
function normalizeRole(value){ const role = cleanText(value).toLowerCase(); return role === "admin" ? "admin" : "student"; }
function normalizeStatus(value){ const status = cleanText(value).toLowerCase(); return status || "active"; }
function isAdminUser(user){ const role = normalizeRole(user?.role); const code = cleanText(user?.access_code).toLowerCase(); return role === "admin" || code === "admin-nolo"; }
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
  if(email && confirm && email === confirm){ setEmailStatus("neutral", "Email listo. Presiona Verificar Email."); return; }
  setEmailStatus("neutral", "Confirma tu email para verificarlo.");
}

async function verifySignupEmail(){
  const email = normalizeEmail(document.getElementById("signupEmail")?.value);
  const confirm = normalizeEmail(document.getElementById("signupEmailConfirm")?.value);
  signupEmailVerified = false;
  signupVerifiedEmail = "";

  if(!email || !confirm){ setEmailStatus("invalid", "Debes escribir el email y confirmarlo."); return false; }
  if(!isValidEmailFormat(email)){ setEmailStatus("invalid", "Email no válido. Ejemplo correcto: nombre@gmail.com"); return false; }
  if(email !== confirm){ setEmailStatus("invalid", "Los emails no coinciden."); return false; }

  setEmailStatus("checking", "Verificando email en Supabase...");
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id,email")
    .ilike("email", email)
    .maybeSingle();

  if(error){
    console.error(error);
    setEmailStatus("invalid", "No se pudo verificar el email. Revisa Supabase/RLS.");
    return false;
  }
  if(data){
    setEmailStatus("invalid", "Ese email ya está registrado. Usa otro email o inicia sesión.");
    return false;
  }

  signupEmailVerified = true;
  signupVerifiedEmail = email;
  setEmailStatus("valid", "✅ Email válido, confirmado y disponible.");
  return true;
}

function setupEmailVerificationListeners(){
  const email = document.getElementById("signupEmail");
  const confirm = document.getElementById("signupEmailConfirm");
  if(email) email.addEventListener("input", resetEmailVerification);
  if(confirm) confirm.addEventListener("input", resetEmailVerification);
}

function applyPlanStyle(plan){
  const cleanPlan = (plan || "VIP Regular").toLowerCase();
  document.body.classList.remove("plan-regular", "plan-premium");
  if(cleanPlan.includes("premium") || cleanPlan.includes("admin")){
    document.body.classList.add("plan-premium");
  }else{
    document.body.classList.add("plan-regular");
  }
}

function getStudentFirstName(user){
  const fullName = (user?.full_name || "Estudiante").trim();
  return fullName.split(" ")[0] || "Estudiante";
}

function typeWelcomeMessage(el, text){
  if(!el) return;
  el.textContent = "";
  let i = 0;
  const speed = 34;
  function type(){
    el.textContent = text.slice(0, i);
    i++;
    if(i <= text.length){ setTimeout(type, speed); }
  }
  type();
}

function updatePortalWelcome(){
  if(!currentUser) return;

  const fullName = currentUser.full_name || "Estudiante";
  const adminView = isAdminUser(currentUser);

  // Topbar principal: evita duplicar el saludo.
  const pageTitle = document.getElementById("pageTitle");
  if(pageTitle){
    pageTitle.innerText = adminView ? "Panel Admin Profesional" : "Panel del Trader";
  }

  const pageSubtitle = document.getElementById("pageSubtitle");
  if(pageSubtitle){
    pageSubtitle.innerText = adminView
      ? "Panel administrativo listo para gestionar estudiantes."
      : "Control manual privado de depósito, ganancia, pérdida y progreso.";
  }

  const welcomeCard = document.getElementById("portalWelcomeCard");
  if(welcomeCard){ welcomeCard.classList.toggle("hidden", adminView); }

  // Card de bienvenida: un solo saludo limpio.
  const welcomeText = document.getElementById("portalWelcomeText");
  typeWelcomeMessage(welcomeText, "Hola, " + fullName);

  const welcomeSub = document.getElementById("portalWelcomeSub");
  if(welcomeSub){
    welcomeSub.innerText = "Panel del Trader";
  }
}


function toggleAuth(mode){
  document.getElementById("tabLogin").classList.toggle("active", mode==="login");
  document.getElementById("tabSignup").classList.toggle("active", mode==="signup");
  document.getElementById("loginForm").classList.toggle("active", mode==="login");
  document.getElementById("signupForm").classList.toggle("active", mode==="signup");
}

async function login(){
  const code = cleanText($("loginCode")?.value);
  const pass = cleanText($("loginPass")?.value);

  if(!code || !pass){ alert("Escribe tu código y password."); return; }

  try{
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("*")
      .ilike("access_code", code)
      .eq("password", pass)
      .maybeSingle();

    if(error || !data){ showError("Código o password incorrecto.", error); return; }

    const admin = isAdminUser(data);
    const active = isActiveUser(data);

    if(!admin && !active){
      const status = normalizeStatus(data.status);
      const msg = status === "pending" ? "Tu cuenta está pendiente de aprobación por el admin." : "Tu cuenta no está activa. Contacta al admin.";
      alert(msg);
      return;
    }

    currentUser = { ...data, role: admin ? "admin" : "student", status: admin ? "active" : normalizeStatus(data.status) };
    localStorage.setItem("olon_current_user", JSON.stringify(currentUser));

    setLoaderStudentName(currentUser.full_name, currentUser.plan);
    showPortalEnterLoader();
    await waitPortalLoading(1200);
    await enterPortal();
  }catch(err){
    console.error("Login fatal error", err);
    alert("No se pudo entrar al portal. Revisa Supabase o la consola del navegador.");
  }finally{
    hidePortalEnterLoader();
  }
}

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

async function signup(){
  const name = document.getElementById("signupName").value.trim();
  const email = normalizeEmail(document.getElementById("signupEmail").value);
  const pass = document.getElementById("signupPass").value.trim();
  const plan = document.getElementById("signupPlan").value || "VIP Regular";
  if(!name || !email || !pass){ alert("Llena nombre, email y password."); return; }
  if(!signupEmailVerified || signupVerifiedEmail !== email){
    const ok = await verifySignupEmail();
    if(!ok){ alert("Verifica un email válido antes de crear la cuenta."); return; }
  }

  const code = await createUniqueAccessCode();

  const { data, error } = await supabaseClient
    .from("profiles")
    .insert([{ full_name:name, email:email, access_code:code, password:pass, role:"student", plan:plan, status:"pending", next_payment_date:null }])
    .select()
    .single();

  if(error){ showError("No se pudo crear la cuenta.", error); return; }

  updateAuthRealStats();
loadTop3LoginStudents();
  document.getElementById("generatedCodeText").innerText = code;
  document.getElementById("signupName").value = "";
  document.getElementById("signupEmail").value = "";
  document.getElementById("signupEmailConfirm").value = "";
  signupEmailVerified = false;
  signupVerifiedEmail = "";
  setEmailStatus("neutral", "Escribe y confirma tu email.");
  document.getElementById("signupPass").value = "";
  document.getElementById("signupPlan").value = "VIP Regular";
  document.getElementById("auth").classList.add("hidden");
  document.getElementById("codeResult").classList.remove("hidden");
}

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
  currentUser.role = admin ? "admin" : "student";
  currentUser.status = admin ? "active" : normalizeStatus(currentUser.status);
  localStorage.setItem("olon_current_user", JSON.stringify(currentUser));

  applyPlanStyle(currentUser.plan || (admin ? "VIP Premium" : "VIP Regular"));

  setTextSafe("studentName", currentUser.full_name || "Estudiante");
  setTextSafe("avatarText", currentUser.full_name?.[0]?.toUpperCase() || "O");
  setTextSafe("userCodeText", "Código: " + (currentUser.access_code || "OLON"));
  setTextSafe("planBadge", ((currentUser.plan || "VIP Regular").toLowerCase().includes("premium") || admin) ? "💎 VIP PREMIUM" : "🔥 VIP REGULAR");
  setTextSafe("accessStatus", (currentUser.plan || (admin ? "Admin" : "VIP Regular")) + " " + (currentUser.status === "active" ? "Activo" : currentUser.status));
  setTextSafe("paymentDate", ": " + (currentUser.next_payment_date || "No asignado"));

  hideSafe("auth");
  hideSafe("codeResult");
  showSafe("portal");
  const portal = $("portal");
  if(portal) portal.classList.add("portalReady");

  setTextSafe("portalMode", admin ? "Admin Portal" : "Student Portal");
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
  document.body.classList.remove("plan-regular", "plan-premium");
  document.getElementById("auth").classList.remove("hidden");
}
function toggleMenu(){document.getElementById("sidebar").classList.toggle("open")}
function showPage(id,btn){
  document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
  document.getElementById("pageTitle").innerText = btn ? btn.textContent.replace(/[^\wÁÉÍÓÚáéíóúñÑ ]/g,"").trim() : id;
  if(id === "dashboard" && currentUser){ updatePortalWelcome(); }
  document.querySelectorAll(".nav button").forEach(b=>b.classList.remove("active"));
  if(btn) btn.classList.add("active");
  document.getElementById("sidebar").classList.remove("open");
}
function showPageById(id){
  const buttons = [...document.querySelectorAll(".nav button")];
  const btn = buttons.find(b=>b.getAttribute("onclick") && b.getAttribute("onclick").includes("'" + id + "'"));
  showPage(id,btn);
}

async function fetchRecords(){
  if(!currentUser || isAdminUser(currentUser)) return [];
  const { data, error } = await supabaseClient
    .from("student_records")
    .select("*")
    .eq("student_id", currentUser.id)
    .order("record_date", { ascending:true })
    .order("created_at", { ascending:true });
  if(error){ showError("No se pudieron cargar los registros.", error); return []; }
  cachedRecords = (data || []).map(r => ({ id:r.id, date:r.record_date, deposit:Number(r.deposit||0), gain:Number(r.gain||0), loss:Number(r.loss||0), note:r.note||"" }));
  return cachedRecords;
}

async function addRecord(){
  if(!currentUser || isAdminUser(currentUser)) return;
  const rec = {
    student_id: currentUser.id,
    record_date: document.getElementById("date").value || new Date().toISOString().slice(0,10),
    deposit: Number(document.getElementById("deposit").value||0),
    gain: Number(document.getElementById("gain").value||0),
    loss: Number(document.getElementById("loss").value||0),
    note: buildJournalNote()
  };
  const { error } = await supabaseClient.from("student_records").insert([rec]);
  if(error){ showError("No se pudo guardar el registro.", error); return; }
  document.getElementById("deposit").value=""; document.getElementById("gain").value=""; document.getElementById("loss").value=""; document.getElementById("note").value=""; ["pair","tradeType","emotion","mistake"].forEach(id=>{const el=document.getElementById(id); if(el) el.value="";});
  await fetchRecords(); await render(); showPageById("dashboard");
}

async function delRecord(id){
  const { error } = await supabaseClient.from("student_records").delete().eq("id", id).eq("student_id", currentUser.id);
  if(error){ showError("No se pudo eliminar el registro.", error); return; }
  await fetchRecords(); await render();
}

function totals(records=cachedRecords){
  const deposit = records.reduce((a,r)=>a+Number(r.deposit||0),0);
  const gain = records.reduce((a,r)=>a+Number(r.gain||0),0);
  const loss = records.reduce((a,r)=>a+Number(r.loss||0),0);
  const net = gain-loss, balance = deposit+net, growth = deposit>0 ? (net/deposit)*100 : 0;
  const positiveDays = records.filter(r => (Number(r.gain)-Number(r.loss))>0).length;
  const negativeDays = records.filter(r => (Number(r.gain)-Number(r.loss))<0).length;
  const avgDaily = records.length ? net / records.length : 0;
  return {deposit,gain,loss,net,balance,growth,positiveDays,negativeDays,avgDaily,days:records.length};
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
  let wins = 0, losses = 0, flat = 0;
  records.forEach(r=>{
    const net = Number(r.gain||0) - Number(r.loss||0);
    if(net > 0) wins++;
    else if(net < 0) losses++;
    else flat++;
  });
  const total = wins + losses;
  return { wins, losses, flat, winrate: total ? (wins / total) * 100 : 0 };
}

function maxDrawdownFromRecords(records){
  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  records.forEach(r=>{
    equity += Number(r.deposit||0) + Number(r.gain||0) - Number(r.loss||0);
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);
  });
  return maxDD;
}

function bestWorst(records){
  let best = 0, worst = 0;
  records.forEach(r=>{
    const net = Number(r.gain||0) - Number(r.loss||0);
    best = Math.max(best, net);
    worst = Math.min(worst, net);
  });
  return {best, worst};
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
    <div class="reportRow"><span>Neto ${label}</span><b class="${t.net >= 0 ? 'good':'bad'}">${money(t.net)}</b></div>
    <div class="reportRow"><span>Winrate</span><b>${pct(wr.winrate)}</b></div>
    <div class="reportRow"><span>Wins / Losses</span><b>${wr.wins} / ${wr.losses}</b></div>
    <div class="reportRow"><span>Mejor día</span><b class="good">${money(bw.best)}</b></div>
    <div class="reportRow"><span>Peor día</span><b class="bad">${money(bw.worst)}</b></div>
    <div class="reportRow"><span>Días registrados</span><b>${records.length}</b></div>
  `;
}


async function renderStudentRanking(){
  if(!currentUser || isAdminUser(currentUser)) return;

  const topRanking = document.getElementById("topRanking");
  const topRankingNote = document.getElementById("topRankingNote");

  try{
    const { data, error } = await supabaseClient
      .from("student_records")
      .select("student_id,deposit,gain,loss");

    if(error) throw error;

    const grouped = {};
    (data || []).forEach(r=>{
      const id = r.student_id;
      if(!id) return;
      if(!grouped[id]) grouped[id] = { deposit:0, gain:0, loss:0 };
      grouped[id].deposit += Number(r.deposit || 0);
      grouped[id].gain += Number(r.gain || 0);
      grouped[id].loss += Number(r.loss || 0);
    });

    if(!grouped[currentUser.id]){
      grouped[currentUser.id] = {
        deposit: totals(cachedRecords).deposit,
        gain: totals(cachedRecords).gain,
        loss: totals(cachedRecords).loss
      };
    }

    const ranking = Object.entries(grouped)
      .map(([student_id,t])=>{
        const net = Number(t.gain || 0) - Number(t.loss || 0);
        const ret = Number(t.deposit || 0) > 0 ? (net / Number(t.deposit || 0)) * 100 : -999999;
        return { student_id, net, deposit:Number(t.deposit || 0), returnPct:ret };
      })
      .filter(x=>x.deposit > 0)
      .sort((a,b)=>b.returnPct - a.returnPct);

    const index = ranking.findIndex(x=>x.student_id === currentUser.id);
    const position = index >= 0 ? index + 1 : null;
    const label = rankingLabelFromPosition(position);

    if(topRanking) topRanking.innerText = label.label;
    if(topRankingNote){
      const total = ranking.length || 0;
      topRankingNote.innerText = label.note + (total ? " · "+total+" estudiantes medidos" : "");
    }
  }catch(err){
    console.warn("No se pudo calcular ranking estudiantil", err);
    if(topRanking) topRanking.innerText = "Privado";
    if(topRankingNote) topRankingNote.innerText = "Ranking disponible cuando Supabase permita leer registros de estudiantes.";
  }
}


let currentReportView = "weekly";
const reportViewConfig = {
  weekly:{title:"Reporte Semanal", subtitle:"Resumen de tu rendimiento de esta semana.", badge:"Vista Semanal", label:"semanal"},
  monthly:{title:"Reporte Mensual", subtitle:"Resumen de tu rendimiento del mes actual.", badge:"Vista Mensual", label:"mensual"},
  ytd:{title:"Reporte YTD", subtitle:"Resumen acumulado desde el inicio del año.", badge:"Year To Date", label:"YTD"}
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
}

function buildPDFReportHTML(){
  const cfg = reportViewConfig[currentReportView] || reportViewConfig.weekly;
  const records = getSelectedReportRecords();
  const t = totals(records);
  const wr = winRateFromRecords(records);
  const bw = bestWorst(records);
  const student = currentUser?.full_name || document.getElementById("studentName")?.innerText || "Estudiante";
  const plan = currentUser?.plan || document.getElementById("planBadge")?.innerText || "VIP";
  const today = new Date().toLocaleDateString("es-PR", {year:"numeric", month:"long", day:"numeric"});

  return `
    <div class="pdfReport" id="pdfReportCapture">
      <div class="pdfReportHeader">
        <small>OLON Society Academy</small>
        <h1>${cfg.title}</h1>
        <p>Reporte profesional generado para ${student} · ${today}</p>
      </div>

      <div class="pdfMeta">
        <div class="pdfMetaBox"><span>Trader</span><b>${student}</b></div>
        <div class="pdfMetaBox"><span>Plan</span><b>${plan}</b></div>
        <div class="pdfMetaBox"><span>Balance actual</span><b>${money(t.balance)}</b></div>
        <div class="pdfMetaBox"><span>Rendimiento</span><b>${pct(t.growth)}</b></div>
      </div>

      <div class="pdfRows">
        <div class="pdfRow"><span>Neto ${cfg.label}</span><b>${money(t.net)}</b></div>
        <div class="pdfRow"><span>Total depositado</span><b>${money(t.deposit)}</b></div>
        <div class="pdfRow"><span>Total ganado</span><b>${money(t.gain)}</b></div>
        <div class="pdfRow"><span>Total perdido</span><b>${money(t.loss)}</b></div>
        <div class="pdfRow"><span>Winrate</span><b>${pct(wr.winrate)}</b></div>
        <div class="pdfRow"><span>Wins / Losses</span><b>${wr.wins} / ${wr.losses}</b></div>
        <div class="pdfRow"><span>Mejor día</span><b>${money(bw.best)}</b></div>
        <div class="pdfRow"><span>Peor día</span><b>${money(bw.worst)}</b></div>
        <div class="pdfRow"><span>Días registrados</span><b>${records.length}</b></div>
      </div>

      <div class="pdfFooter">Documento generado automáticamente desde el Portal del Estudiante · OLON Society Academy</div>
    </div>`;
}

async function downloadSelectedReportPDF(){
  const cfg = reportViewConfig[currentReportView] || reportViewConfig.weekly;
  const holder = document.createElement("div");
  holder.style.position = "fixed";
  holder.style.left = "-9999px";
  holder.style.top = "0";
  holder.innerHTML = buildPDFReportHTML();
  document.body.appendChild(holder);

  try{
    if(window.html2canvas && window.jspdf?.jsPDF){
      const target = holder.querySelector("#pdfReportCapture");
      const canvas = await html2canvas(target, {scale:2, backgroundColor:"#ffffff", useCORS:true});
      const imgData = canvas.toDataURL("image/png");
      const pdf = new window.jspdf.jsPDF("p", "pt", "a4");
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW;
      const imgH = canvas.height * imgW / canvas.width;
      let y = 0;

      pdf.addImage(imgData, "PNG", 0, y, imgW, imgH);
      let heightLeft = imgH - pageH;
      while(heightLeft > 0){
        y = heightLeft - imgH;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, y, imgW, imgH);
        heightLeft -= pageH;
      }

      const safeName = (currentUser?.full_name || "estudiante").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
      pdf.save(`olon-${cfg.title.toLowerCase().replace(/\s+/g,"-")}-${safeName}.pdf`);
    }else{
      const printWindow = window.open("", "_blank");
      printWindow.document.write(`<!DOCTYPE html><html><head><title>${cfg.title}</title></head><body>${buildPDFReportHTML()}
</body></html>`);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    }
  }catch(err){
    console.error("Error generando PDF", err);
    alert("No se pudo generar el PDF. Intenta de nuevo.");
  }finally{
    holder.remove();
  }
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
  const ywr = winRateFromRecords(ytd);
  const ytdWinrate = document.getElementById("ytdWinrate");
  if(ytdWinrate) ytdWinrate.innerText = pct(ywr.winrate);
  const ytdStats = document.getElementById("ytdStats");
  if(ytdStats) ytdStats.innerText = ywr.wins + " wins / " + ywr.losses + " losses";

  renderSelectedReport();
}

function renderProDashboard(){
  if(!currentUser || isAdminUser(currentUser)) return;
  const records = cachedRecords || [];
  const t = totals(records);
  const currentMonth = monthRecords(0);
  const cur = totals(currentMonth);

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
  if(goalInput && !goalInput.value) goalInput.value = goal;

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
  if(!box) return;
  const now = new Date();
  const days = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
  const map = {};
  records.forEach(r=>{
    const d = new Date(r.date + "T00:00:00").getDate();
    map[d] = (map[d] || 0) + Number(r.gain||0) - Number(r.loss||0);
  });
  let html = "";
  for(let d=1; d<=days; d++){
    let cls = "";
    if(map[d] > 0) cls = "goodDay";
    else if(map[d] < 0) cls = "badDay";
    else if(map[d] === 0 && map[d] !== undefined) cls = "flatDay";
    html += `<div class="calDay ${cls}">${d}</div>`;
  }
  box.innerHTML = html;
}

async function render(){
  if(!currentUser) return;
  if(isAdminUser(currentUser)){ await renderUsers(); return; }
  await fetchRecords();
  const records = cachedRecords, t = totals(records);
  document.getElementById("mDeposited").innerText = money(t.deposit);
  document.getElementById("mNet").innerText = money(t.net);
  const netLabel = document.getElementById("mNetLabel");
  if(netLabel){
    netLabel.className = t.net >= 0 ? "good" : "bad";
    netLabel.innerText = t.net >= 0 ? "Ganancia neta total" : "Pérdida neta total";
  }
  document.getElementById("mLoss").innerText = money(t.loss);
  document.getElementById("mGrowth").innerText = pct(t.growth);
  const body = document.getElementById("historyBody");
  body.innerHTML = records.slice().reverse().map(r=>{
    const net = Number(r.gain)-Number(r.loss);
    return `<tr><td>${r.date}</td><td>${money(r.deposit)}</td><td class="good">${money(r.gain)}</td><td class="bad">${money(r.loss)}</td><td><span class="badge ${net>=0?'green':'red'}">${money(net)}</span></td><td>${r.note || "-"}</td><td><button class="btn secondary" onclick="delRecord('${r.id}')">Eliminar</button></td></tr>`
  }).join("") || `<tr><td colspan="7" style="color:var(--muted)">No hay registros todavía.</td></tr>`;
  renderCompare(); renderChart(); renderProDashboard();
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
  const ctx = document.getElementById("balanceChart"); let running = 0;
  const sorted = cachedRecords.slice().sort((a,b)=>a.date.localeCompare(b.date));
  const labels = sorted.map(r=>r.date);
  const data = sorted.map(r=>{ running += Number(r.deposit) + Number(r.gain) - Number(r.loss); return running; });
  if(chart) chart.destroy();
  chart = new Chart(ctx,{ type:"line", data:{labels: labels.length?labels:["Inicio"], datasets:[{label:"Balance", data:data.length?data:[0], tension:.4, fill:true}]}, options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{labels:{color:"#f8fafc"}}}, scales:{x:{ticks:{color:"#94a3b8"},grid:{color:"rgba(255,255,255,.08)"}}, y:{ticks:{color:"#94a3b8"},grid:{color:"rgba(255,255,255,.08)"}}} } });
}
async function renderUsers(){
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, email, full_name, access_code, password, role, plan, status, next_payment_date, created_at")
    .order("created_at", { ascending:false });

  if(error){ showError("No se pudieron cargar los estudiantes.", error); return; }

  cachedUsers = data || [];
  updateAdminMetrics();
  renderAdminTable();
}

function updateAdminMetrics(){
  const users = cachedUsers || [];
  const students = users.filter(u => u.role !== "admin");
  const active = students.filter(u => u.status === "active").length;
  const pending = students.filter(u => u.status === "pending").length;
  const premium = students.filter(u => String(u.plan || "").toLowerCase().includes("premium")).length;
  const setText = (id, value) => { const el = document.getElementById(id); if(el) el.innerText = value; };
  setText("adminTotalUsers", students.length);
  setText("adminActiveUsers", active);
  setText("adminPendingUsers", pending);
  setText("adminPremiumUsers", premium);
}

function filterAdminUsers(status){
  const statusFilter = document.getElementById("adminStatusFilter");
  if(statusFilter) statusFilter.value = status || "all";
  renderAdminTable();
}

function renderAdminTable(){
  const body = document.getElementById("usersBody");
  if(!body) return;

  const search = (document.getElementById("adminSearch")?.value || "").toLowerCase().trim();
  const statusFilter = document.getElementById("adminStatusFilter")?.value || "all";
  const planFilter = document.getElementById("adminPlanFilter")?.value || "all";

  let users = (cachedUsers || []).filter(u => {
    const text = `${u.full_name || ""} ${u.email || ""} ${u.access_code || ""}`.toLowerCase();
    const statusOk = statusFilter === "all" || u.status === statusFilter;
    const plan = String(u.plan || "").toLowerCase();
    const role = String(u.role || "").toLowerCase();
    const planOk = planFilter === "all" || plan.includes(planFilter) || role.includes(planFilter);
    const searchOk = !search || text.includes(search);
    return statusOk && planOk && searchOk;
  });

  const countPill = document.getElementById("adminCountPill");
  if(countPill) countPill.innerText = users.length + (users.length === 1 ? " resultado" : " resultados");

  body.innerHTML = users.map(u=>{
    const isMainAdmin = u.role === "admin" && u.access_code === "admin-nolo";
    const initials = (u.full_name || "O").split(" ").map(x=>x[0]).join("").slice(0,2).toUpperCase();

    let statusBadgeClass = "blue";
    if(u.status === "active") statusBadgeClass = "green";
    if(u.status === "suspended" || u.status === "expired") statusBadgeClass = "red";
    if(u.status === "pending") statusBadgeClass = "blue";

    const approveBtn = isMainAdmin ? "" : `<button class="btn success" onclick="updateUserStatus('${u.id}', 'active')">Aprobar</button>`;
    const suspendBtn = isMainAdmin ? "" : `<button class="btn warnBtn" onclick="updateUserStatus('${u.id}', 'suspended')">Suspender</button>`;
    const deleteBtn = isMainAdmin
      ? `<span class="badge blue">Protegido</span>`
      : `<button class="btn danger" onclick="deleteUser('${u.id}', '${String(u.full_name || '').replace(/'/g, "\\'")}')">Borrar</button>`;

    return `<tr>
      <td>
        <div class="adminStudent">
          <div class="adminAvatar">${initials}</div>
          <div><b>${u.full_name || "Sin nombre"}</b><small>${u.email || "Sin email"}</small></div>
        </div>
      </td>
      <td><span class="codePill">${u.access_code || "-"}</span></td>
      <td><span class="codePill passPill">${u.password || "-"}</span></td>
      <td><span class="badge ${u.role==='admin'?'blue':'green'}">${u.role || "-"}</span></td>
      <td>${u.plan || '-'}</td>
      <td><span class="badge ${statusBadgeClass}">${u.status || '-'}</span></td>
      <td>${u.next_payment_date || "No asignado"}</td>
      <td><div class="actionRow">${approveBtn}${suspendBtn}${deleteBtn}</div></td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" style="color:var(--muted);padding:24px">No hay usuarios con ese filtro.</td></tr>`;
}

async function updateUserStatus(userId, newStatus){
  if(!currentUser || !isAdminUser(currentUser)) return;

  const target = cachedUsers.find(u => u.id === userId);
  if(!target) return;

  if(target.role === "admin" && target.access_code === "admin-nolo"){
    alert("No puedes modificar el admin principal.");
    return;
  }

  const { error } = await supabaseClient
    .from("profiles")
    .update({ status:newStatus })
    .eq("id", userId);

  if(error){ showError("No se pudo actualizar el estado.", error); return; }

  await renderUsers();
}

async function deleteUser(userId, userName){
  if(!currentUser || !isAdminUser(currentUser)) return;

  const target = cachedUsers.find(u => u.id === userId);
  if(!target) return;

  if(target.role === "admin" && target.access_code === "admin-nolo"){
    alert("No puedes borrar el admin principal.");
    return;
  }

  if(!confirm("¿Seguro que quieres borrar a " + userName + "? También se borrarán sus registros.")) return;

  const { error } = await supabaseClient
    .from("profiles")
    .delete()
    .eq("id", userId);

  if(error){ showError("No se pudo borrar el usuario.", error); return; }

  await renderUsers();
}
async function clearData(){
  if(!currentUser || isAdminUser(currentUser)) return;
  if(confirm("¿Borrar todos tus registros?")){
    const { error } = await supabaseClient.from("student_records").delete().eq("student_id", currentUser.id);
    if(error){ showError("No se pudieron borrar los registros.", error); return; }
    cachedRecords = []; await render();
  }
}
setupEmailVerificationListeners();
updateAuthRealStats();
if(currentUser){
  setLoaderStudentName(currentUser.full_name, currentUser.plan);
  showPortalEnterLoader();
  waitPortalLoading(900).then(async () => {
    try{
      await enterPortal();
    }catch(err){
      console.error("Auto login error", err);
      localStorage.removeItem("olon_current_user");
      currentUser = null;
      showSafe("auth");
      hideSafe("portal");
    }finally{
      hidePortalEnterLoader();
    }
  });
}

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

// ===== SETTINGS FLOATING OLON FIX =====
(function(){
  function isSoundEnabled(){
    return localStorage.getItem("olon_sound_enabled") !== "false";
  }

  window.isSoundEnabled = isSoundEnabled;

  function applySoundSwitch(){
    const sw = document.getElementById("soundSwitch");
    if(sw) sw.classList.toggle("on", isSoundEnabled());
  }

  function safeClickSound(){
    try{
      if(isSoundEnabled() && typeof window.playClickSound === "function"){
        window.playClickSound();
      }
    }catch(e){}
  }

  function toggleSoundSetting(){
    const next = !isSoundEnabled();
    localStorage.setItem("olon_sound_enabled", next ? "true" : "false");
    applySoundSwitch();
    safeClickSound();
  }

  function setThemeMode(mode){
    localStorage.setItem("olon_theme_mode", mode);
    applyThemeMode();
    safeClickSound();
  }

  function applyThemeMode(){
    const mode = localStorage.getItem("olon_theme_mode") || "dark";
    document.body.classList.toggle("light-mode", mode === "light");

    const darkBtn = document.getElementById("darkThemeBtn");
    const lightBtn = document.getElementById("lightThemeBtn");

    if(darkBtn) darkBtn.classList.toggle("active", mode === "dark");
    if(lightBtn) lightBtn.classList.toggle("active", mode === "light");
  }

  function toggleSettingsPanel(){
    const panel = document.getElementById("settingsPanel");
    if(panel) panel.classList.toggle("show");
    safeClickSound();
  }

  window.toggleSettingsPanel = toggleSettingsPanel;
  window.toggleSoundSetting = toggleSoundSetting;
  window.setThemeMode = setThemeMode;

  document.addEventListener("DOMContentLoaded", function(){
    const fab = document.getElementById("settingsFab");
    const soundSwitch = document.getElementById("soundSwitch");
    const darkBtn = document.getElementById("darkThemeBtn");
    const lightBtn = document.getElementById("lightThemeBtn");

    if(fab) fab.addEventListener("click", toggleSettingsPanel);
    if(soundSwitch) soundSwitch.addEventListener("click", toggleSoundSetting);
    if(darkBtn) darkBtn.addEventListener("click", function(){ setThemeMode("dark"); });
    if(lightBtn) lightBtn.addEventListener("click", function(){ setThemeMode("light"); });

    applySoundSwitch();
    applyThemeMode();

    document.addEventListener("click", function(e){
      const panel = document.getElementById("settingsPanel");
      const btn = document.getElementById("settingsFab");
      if(!panel || !btn) return;
      if(panel.classList.contains("show") && !panel.contains(e.target) && !btn.contains(e.target)){
        panel.classList.remove("show");
      }
    });
  });
})();

// ===== MOBILE APP MODE HELPERS =====
function mobileGo(id, btn){
  showPageById(id);
  document.querySelectorAll('.mobileBottomNav button').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
}
function mobileOpenAccount(btn){
  showPageById('dashboard');
  document.querySelectorAll('.mobileBottomNav button').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  setTimeout(()=>document.querySelector('.userPill')?.scrollIntoView({behavior:'smooth',block:'center'}),80);
}
function renderHistoryMobileCards(records){
  const box = document.getElementById('historyMobileCards');
  if(!box) return;
  const list = (records || []).slice().reverse();
  box.innerHTML = list.map(r=>{
    const net = Number(r.gain||0) - Number(r.loss||0);
    const cls = net >= 0 ? 'green' : 'red';
    return `<div class="mobileRecordCard"><div class="mobileRecordTop"><div><div class="mobileRecordDate">${r.date || '-'}</div><div class="mobileRecordNote">${r.note || 'Sin nota'}</div></div><span class="badge ${cls}">${money(net)}</span></div><div class="mobileStats"><div class="mobileStat"><small>Depósito</small><b>${money(r.deposit||0)}</b></div><div class="mobileStat"><small>Ganancia</small><b class="good">${money(r.gain||0)}</b></div><div class="mobileStat"><small>Pérdida</small><b class="bad">${money(r.loss||0)}</b></div></div><button class="btn secondary full" onclick="delRecord('${r.id}')">Eliminar registro</button></div>`;
  }).join('') || `<div class="mobileRecordCard"><div class="mobileRecordDate">No hay registros todavía.</div><div class="mobileRecordNote">Cuando guardes tu primer trade, aparecerá aquí como tarjeta móvil.</div></div>`;
}
function renderUsersMobileCards(users){
  const box = document.getElementById('usersMobileCards');
  if(!box) return;
  box.innerHTML = (users || []).map(u=>{
    const isMainAdmin = u.role === 'admin' && u.access_code === 'admin-nolo';
    const initials = (u.full_name || 'O').split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase();
    let statusBadgeClass = 'blue';
    if(u.status === 'active') statusBadgeClass = 'green';
    if(u.status === 'suspended' || u.status === 'expired') statusBadgeClass = 'red';
    const approveBtn = isMainAdmin ? '' : `<button class="btn success" onclick="updateUserStatus('${u.id}', 'active')">Aprobar</button>`;
    const suspendBtn = isMainAdmin ? '' : `<button class="btn warnBtn" onclick="updateUserStatus('${u.id}', 'suspended')">Suspender</button>`;
    const safeName = String(u.full_name || '').replace(/'/g,"\\'");
    const deleteBtn = isMainAdmin ? `<span class="badge blue">Protegido</span>` : `<button class="btn danger" onclick="deleteUser('${u.id}', '${safeName}')">Borrar</button>`;
    return `<div class="mobileUserCard"><div class="mobileUserTop"><div class="adminStudent"><div class="adminAvatar">${initials}</div><div><div class="mobileUserName">${u.full_name || 'Sin nombre'}</div><div class="mobileUserMeta">${u.email || 'Sin email'}</div></div></div><span class="badge ${statusBadgeClass}">${u.status || '-'}</span></div><div class="mobileUserInfo"><div class="mobileInfoPill">Código<b>${u.access_code || '-'}</b></div><div class="mobileInfoPill">Plan<b>${u.plan || '-'}</b></div><div class="mobileInfoPill">Rol<b>${u.role || '-'}</b></div><div class="mobileInfoPill">Pago<b>${u.next_payment_date || 'No asignado'}</b></div></div><div class="mobileUserActions">${approveBtn}${suspendBtn}${deleteBtn}</div></div>`;
  }).join('') || `<div class="mobileUserCard"><div class="mobileUserName">No hay usuarios con ese filtro.</div></div>`;
}
const olonOriginalRender = window.render;
if(typeof olonOriginalRender === 'function'){
  window.render = async function(){
    await olonOriginalRender.apply(this, arguments);
    if(currentUser && !isAdminUser(currentUser)) renderHistoryMobileCards(cachedRecords || []);
  }
}
const olonOriginalRenderAdminTable = window.renderAdminTable;
if(typeof olonOriginalRenderAdminTable === 'function'){
  window.renderAdminTable = function(){
    olonOriginalRenderAdminTable.apply(this, arguments);
    const search = (document.getElementById('adminSearch')?.value || '').toLowerCase().trim();
    const statusFilter = document.getElementById('adminStatusFilter')?.value || 'all';
    const planFilter = document.getElementById('adminPlanFilter')?.value || 'all';
    let users = (cachedUsers || []).filter(u=>{
      const text = `${u.full_name || ''} ${u.email || ''} ${u.access_code || ''}`.toLowerCase();
      const statusOk = statusFilter === 'all' || u.status === statusFilter;
      const plan = String(u.plan || '').toLowerCase();
      const role = String(u.role || '').toLowerCase();
      const planOk = planFilter === 'all' || plan.includes(planFilter) || role.includes(planFilter);
      const searchOk = !search || text.includes(search);
      return statusOk && planOk && searchOk;
    });
    renderUsersMobileCards(users);
  }
}