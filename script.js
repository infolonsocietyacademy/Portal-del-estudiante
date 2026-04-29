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
  if(loader){
    loader.style.display = "grid";
    loader.classList.remove("closing");
    loader.classList.add("show");
  }
  if(typeof unlockOlonAudio === "function") unlockOlonAudio();
  if(typeof playPortalLoadingSound === "function") playPortalLoadingSound();
}

function hidePortalEnterLoader(){
  const loader = document.getElementById("portalEnterLoader");
  if(!loader) return;
  loader.classList.add("closing");
  setTimeout(() => {
    loader.classList.remove("show");
    loader.classList.remove("closing");
    loader.style.display = "none";
  }, 900);
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
    // Loading nivel dios: duración real premium
    await new Promise(resolve => setTimeout(resolve, 6800));
    await enterPortal();
    await new Promise(resolve => setTimeout(resolve, 900));
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
  const targetPage = document.getElementById(id);
  if(targetPage) targetPage.classList.remove("hidden");

  const title = document.getElementById("pageTitle");
  if(title){
    title.innerText = btn ? btn.textContent.replace(/[^\wÁÉÍÓÚáéíóúñÑ ]/g,"").trim() : id;
  }

  if(id === "dashboard" && currentUser){ updatePortalWelcome(); }

  document.querySelectorAll(".nav button").forEach(b=>b.classList.remove("active"));
  if(btn) btn.classList.add("active");

  const sidebar = document.getElementById("sidebar");
  if(sidebar) sidebar.classList.remove("open");

  if(id === "publicChat" && typeof loadPublicChat === "function"){
    setTimeout(loadPublicChat, 150);
  }

  if(id === "adminChat" && typeof loadAdminChatInbox === "function"){
    setTimeout(loadAdminChatInbox, 150);
  }
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
  waitPortalLoading(4200).then(async () => {
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
/* ===== EMERGENCY LOGIN / PORTAL FIX V2 =====
   Este parche fuerza la entrada al portal DESPUÉS de validar Supabase.
   No depende del loader, chat, ranking, gráficas ni render para mostrar dashboard/admin.
*/
(function(){
  function safeEl(id){ return document.getElementById(id); }
  function safeText(id, value){ const el = safeEl(id); if(el) el.innerText = value; }
  function safeShow(id){ const el = safeEl(id); if(el) el.classList.remove('hidden'); }
  function safeHide(id){ const el = safeEl(id); if(el) el.classList.add('hidden'); }
  function clean(v){ return String(v || '').trim(); }
  function roleOf(user){
    const role = clean(user?.role).toLowerCase();
    const code = clean(user?.access_code).toLowerCase();
    return (role === 'admin' || code === 'admin-nolo') ? 'admin' : 'student';
  }
  function statusOf(user){ return clean(user?.status).toLowerCase() || 'active'; }
  function canEnter(user){
    const role = roleOf(user);
    const status = statusOf(user);
    return role === 'admin' || status === 'active' || status === 'approved';
  }
  function forcePage(pageId){
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    const page = safeEl(pageId);
    if(page) page.classList.remove('hidden');
    document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
    const btn = [...document.querySelectorAll('.nav button')].find(b => (b.getAttribute('onclick') || '').includes("'" + pageId + "'"));
    if(btn) btn.classList.add('active');
  }
  async function forceEnterPortal(user){
    currentUser = user;
    const role = roleOf(currentUser);
    currentUser.role = role;
    if(role === 'admin') currentUser.status = 'active';
    localStorage.setItem('olon_current_user', JSON.stringify(currentUser));

    try{ if(typeof applyPlanStyle === 'function') applyPlanStyle(currentUser.plan || (role === 'admin' ? 'VIP Premium' : 'VIP Regular')); }catch(e){}

    safeText('studentName', currentUser.full_name || 'Estudiante');
    safeText('avatarText', (currentUser.full_name || 'O').charAt(0).toUpperCase());
    safeText('userCodeText', 'Código: ' + (currentUser.access_code || 'OLON'));
    safeText('planBadge', role === 'admin' || clean(currentUser.plan).toLowerCase().includes('premium') ? '💎 VIP PREMIUM' : '🔥 VIP REGULAR');
    safeText('accessStatus', (currentUser.plan || (role === 'admin' ? 'Admin' : 'VIP Regular')) + ' Activo');
    safeText('paymentDate', ': ' + (currentUser.next_payment_date || 'No asignado'));
    safeText('portalMode', role === 'admin' ? 'Admin Portal' : 'Student Portal');

    safeHide('auth');
    safeHide('codeResult');
    safeShow('portal');
    safeEl('portal')?.classList.add('portalReady');
    safeEl('portalEnterLoader')?.classList.remove('show');
    safeEl('olonLoader')?.classList.add('hide');

    const isAdmin = role === 'admin';
    document.querySelectorAll('.studentNav').forEach(el => el.classList.toggle('hidden', isAdmin));
    document.querySelectorAll('.adminNav').forEach(el => el.classList.toggle('hidden', !isAdmin));
    document.querySelectorAll('.studentOnly').forEach(el => el.classList.toggle('hidden', isAdmin));

    forcePage(isAdmin ? 'admin' : 'dashboard');
    safeText('pageTitle', isAdmin ? 'Panel Admin Profesional' : 'Panel del Trader');
    safeText('pageSubtitle', isAdmin ? 'Panel administrativo listo para gestionar estudiantes.' : 'Control manual privado de depósito, ganancia, pérdida y progreso.');
    if(!isAdmin) safeText('portalWelcomeText', 'Hola, ' + (currentUser.full_name || 'Estudiante'));

    setTimeout(async () => {
      try{ if(typeof render === 'function') await render(); }catch(e){ console.error('Render no bloqueó login:', e); }
      try{ if(typeof startChatRefresh === 'function') startChatRefresh(); }catch(e){}
      try{ if(isAdmin && typeof loadAdminChatInbox === 'function') loadAdminChatInbox(); }catch(e){}
    }, 80);
  }

  window.enterPortal = async function(){
    if(!currentUser) return;
    await forceEnterPortal(currentUser);
  };

  window.login = async function(){
    const code = clean(safeEl('loginCode')?.value);
    const pass = clean(safeEl('loginPass')?.value);
    if(!code || !pass){ alert('Escribe tu código y password.'); return; }

    try{
      const loader = safeEl('portalEnterLoader');
      if(loader) loader.classList.add('show');

      const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .ilike('access_code', code)
        .eq('password', pass)
        .maybeSingle();

      if(error || !data){
        console.error('Login Supabase error:', error);
        alert('Código o password incorrecto. Verifica que el código y password estén igual que en Supabase.');
        return;
      }

      if(!canEnter(data)){
        const status = statusOf(data);
        alert(status === 'pending' ? 'Tu cuenta está pendiente de aprobación por el admin.' : 'Tu cuenta no está activa. Contacta al admin.');
        return;
      }

      await forceEnterPortal(data);
    }catch(err){
      console.error('LOGIN EMERGENCY ERROR:', err);
      alert('No se pudo entrar. Abre consola y verifica Supabase / RLS. El error quedó en console.');
    }finally{
      safeEl('portalEnterLoader')?.classList.remove('show');
    }
  };

  document.addEventListener('DOMContentLoaded', function(){
    const loginBtn = [...document.querySelectorAll('button')].find(b => (b.getAttribute('onclick') || '').includes('login()'));
    if(loginBtn){
      loginBtn.onclick = function(e){ e.preventDefault(); window.login(); };
    }
  });
})();

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
  function closeLoaders(){
    const a = el('portalEnterLoader');
    if(a){ a.classList.remove('show'); a.classList.add('forceClose'); a.style.display='none'; }
    const b = el('olonLoader');
    if(b){ b.classList.add('hide'); b.style.display='none'; }
  }
  function clean(s){ return String(s || '').trim(); }
  function roleOf(u){
    const r = clean(u?.role).toLowerCase();
    const c = clean(u?.access_code).toLowerCase();
    return (r === 'admin' || c === 'admin-nolo') ? 'admin' : 'student';
  }
  function statusOf(u){ return clean(u?.status).toLowerCase() || 'active'; }
  function activatePage(id){
    document.querySelectorAll('.page').forEach(p=>{p.classList.add('hidden'); p.classList.remove('forceActive'); p.style.display='none';});
    const page = el(id);
    if(page){ page.classList.remove('hidden'); page.classList.add('forceActive'); page.style.display='block'; }
    document.querySelectorAll('.nav button').forEach(b=>b.classList.remove('active'));
    const btn = [...document.querySelectorAll('.nav button')].find(b => (b.getAttribute('onclick') || '').includes("'" + id + "'"));
    if(btn) btn.classList.add('active');
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
    try{ if(typeof applyPlanStyle === 'function') applyPlanStyle(currentUser.plan || (isAdmin ? 'Admin' : 'VIP Regular')); }catch(e){}

    txt('studentName', currentUser.full_name || (isAdmin ? 'Admin' : 'Estudiante'));
    txt('avatarText', (currentUser.full_name || 'O').charAt(0).toUpperCase());
    txt('userCodeText', 'Código: ' + (currentUser.access_code || 'OLON'));
    txt('planBadge', isAdmin || clean(currentUser.plan).toLowerCase().includes('premium') ? '💎 VIP PREMIUM' : '🔥 VIP REGULAR');
    txt('accessStatus', (currentUser.plan || (isAdmin ? 'Admin' : 'VIP Regular')) + ' Activo');
    txt('paymentDate', ': ' + (currentUser.next_payment_date || 'No asignado'));
    txt('portalMode', isAdmin ? 'Admin Portal' : 'Student Portal');
    txt('pageTitle', isAdmin ? 'Panel Admin Profesional' : 'Panel del Trader');
    txt('pageSubtitle', isAdmin ? 'Panel administrativo listo para gestionar estudiantes.' : 'Control manual privado de depósito, ganancia, pérdida y progreso.');
    txt('portalWelcomeText', 'Hola, ' + (currentUser.full_name || 'Estudiante'));

    hide('auth');
    hide('codeResult');
    closeLoaders();
    showPortal();

    document.querySelectorAll('.studentNav').forEach(x=>x.classList.toggle('hidden', isAdmin));
    document.querySelectorAll('.adminNav').forEach(x=>x.classList.toggle('hidden', !isAdmin));
    document.querySelectorAll('.studentOnly').forEach(x=>x.classList.toggle('hidden', isAdmin));

    activatePage(isAdmin ? 'admin' : 'dashboard');
    await safeBackgroundRender(isAdmin);
  }

  window.enterPortal = async function(){
    if(currentUser) await openPortal(currentUser);
  };

  window.login = async function(){
    const code = val('loginCode');
    const pass = val('loginPass');
    if(!code || !pass){ alert('Escribe tu código y password.'); return; }

    const loader = el('portalEnterLoader');
    if(loader){ loader.classList.remove('forceClose'); loader.classList.add('show'); loader.style.display='grid'; }

    try{
      const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .ilike('access_code', code)
        .eq('password', pass)
        .maybeSingle();

      if(error || !data){
        console.error('LOGIN SUPABASE ERROR:', error);
        alert('Código o password incorrecto. Usa el mismo código/password de Supabase.');
        closeLoaders();
        return;
      }

      const role = roleOf(data);
      const status = statusOf(data);
      if(role !== 'admin' && status !== 'active' && status !== 'approved'){
        alert(status === 'pending' ? 'Tu cuenta está pendiente de aprobación por el admin.' : 'Tu cuenta no está activa. Contacta al admin.');
        closeLoaders();
        return;
      }

      await openPortal(data);
    }catch(e){
      console.error('LOGIN FORCE FIX ERROR:', e);
      alert('No se pudo entrar. Hay un error en consola, pero el login fue protegido para no quedarse cargando.');
      closeLoaders();
    }
  };

  document.addEventListener('DOMContentLoaded', function(){
    const btn = [...document.querySelectorAll('button')].find(b => (b.getAttribute('onclick') || '').includes('login()'));
    if(btn){ btn.onclick = function(ev){ ev.preventDefault(); window.login(); }; }
  });
})();


/* ===== MOBILE TAP LOGIN FIX FINAL =====
   En iPhone/Android a veces el onclick se pierde por overlays/teclado.
   Este handler usa touchend/pointerup y fuerza cerrar loaders.
*/
(function(){
  function qs(id){ return document.getElementById(id); }
  function closeAllLoaders(){
    ['portalEnterLoader','olonLoader'].forEach(id=>{
      const x = qs(id);
      if(x){
        x.classList.remove('show');
        x.classList.add('forceClose','hide');
        x.style.display = 'none';
        x.style.visibility = 'hidden';
        x.style.opacity = '0';
        x.style.pointerEvents = 'none';
      }
    });
  }
  function bindMobileLogin(){
    const loginBtn = qs('loginSubmitBtn') || [...document.querySelectorAll('button')].find(b => (b.getAttribute('onclick') || '').includes('login()'));
    if(loginBtn && !loginBtn.dataset.mobileLoginFixed){
      loginBtn.dataset.mobileLoginFixed = '1';
      loginBtn.setAttribute('type','button');
      loginBtn.style.pointerEvents = 'auto';
      loginBtn.style.touchAction = 'manipulation';
      const handler = function(ev){
        try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){}
        try{ document.activeElement && document.activeElement.blur(); }catch(e){}
        setTimeout(()=>{
          if(typeof window.login === 'function') window.login();
          setTimeout(closeAllLoaders, 4500);
        }, 60);
      };
      loginBtn.addEventListener('touchend', handler, {passive:false});
      loginBtn.addEventListener('pointerup', function(ev){ if(ev.pointerType === 'touch') handler(ev); }, {passive:false});
    }

    const signupBtn = qs('signupSubmitBtn');
    if(signupBtn && !signupBtn.dataset.mobileSignupFixed){
      signupBtn.dataset.mobileSignupFixed = '1';
      signupBtn.setAttribute('type','button');
      signupBtn.style.pointerEvents = 'auto';
      signupBtn.style.touchAction = 'manipulation';
    }
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindMobileLogin);
  else bindMobileLogin();
  window.addEventListener('pageshow', bindMobileLogin);
})();




/* ===== OLON RESCUE FIX: MENU INTERACTIVO ===== */
(function(){
  function $(id){ return document.getElementById(id); }
  function clean(t){ return String(t||"").replace(/[^\wÁÉÍÓÚáéíóúñÑ# ]/g,"").replace(/\s+/g," ").trim(); }

  const subtitles = {
    dashboard:"Control manual privado de depósito, ganancia, pérdida y progreso.",
    registro:"Registra depósito, ganancia, pérdida y notas del día.",
    historial:"Consulta tu historial individual.",
    comparacion:"Compara tu mes actual con el mes anterior.",
    publicChat:"Canal público para todos los estudiantes.",
    admin:"Panel administrativo profesional.",
    adminChat:"Centro de mensajes privados."
  };

  function forceOpenPortalIfLogged(){
    try{
      const saved = localStorage.getItem("olon_current_user");
      if(saved && $("portal") && $("auth")){
        $("auth").classList.add("hidden");
        $("codeResult")?.classList.add("hidden");
        $("portal").classList.remove("hidden");
      }
    }catch(e){}
  }

  window.showPage = function(id, btn){
    try{
      const page = $(id);
      if(!page){
        console.warn("No existe page:", id);
        return;
      }

      document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
      page.classList.remove("hidden");

      document.querySelectorAll(".nav button,.mobileBottomNav button").forEach(b => b.classList.remove("active"));
      if(btn) btn.classList.add("active");

      const title = $("pageTitle");
      if(title) title.innerText = btn ? clean(btn.textContent) : clean(id);

      const sub = $("pageSubtitle");
      if(sub && subtitles[id]) sub.innerText = subtitles[id];

      const sidebar = $("sidebar");
      if(sidebar) sidebar.classList.remove("open");
      document.body.classList.remove("menu-open");

      if(id === "publicChat" && typeof window.loadPublicChat === "function") setTimeout(window.loadPublicChat, 80);
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

  window.toggleMenu = function(){
    const sidebar = $("sidebar");
    if(!sidebar) return;
    sidebar.classList.toggle("open");
    document.body.classList.toggle("menu-open", sidebar.classList.contains("open"));
  };

  window.mobileGo = function(id, btn){ window.showPage(id, btn); };
  window.mobileOpenAccount = function(btn){ window.showPage("dashboard", btn); };

  document.addEventListener("click", function(e){
    const navBtn = e.target.closest(".nav button[data-page], .nav button[onclick*='showPage']");
    if(navBtn){
      let id = navBtn.getAttribute("data-page");
      if(!id){
        const on = navBtn.getAttribute("onclick") || "";
        const m = on.match(/showPage\('([^']+)'/);
        if(m) id = m[1];
      }
      if(id){
        e.preventDefault();
        e.stopImmediatePropagation();
        window.showPage(id, navBtn);
        return false;
      }
    }

    const menuBtn = e.target.closest(".mobileBtn");
    if(menuBtn && String(menuBtn.getAttribute("onclick")||"").includes("toggleMenu")){
      e.preventDefault();
      e.stopImmediatePropagation();
      window.toggleMenu();
      return false;
    }
  }, true);

  document.addEventListener("click", function(e){
    if(!document.body.classList.contains("menu-open")) return;
    const sidebar = $("sidebar");
    if(sidebar && !sidebar.contains(e.target) && !e.target.closest(".mobileBtn")){
      sidebar.classList.remove("open");
      document.body.classList.remove("menu-open");
    }
  });

  document.addEventListener("DOMContentLoaded", function(){
    forceOpenPortalIfLogged();

    const loader = $("olonLoader");
    if(loader){
      setTimeout(() => {
        loader.classList.add("hide");
        loader.style.display = "none";
      }, 1800);
    }
    const enterLoader = $("portalEnterLoader");
    if(enterLoader && !enterLoader.classList.contains("show")){
      enterLoader.style.display = "none";
    }
  });
})();

/* =========================================
   🌍 CHAT PÚBLICO OLON - WHATSAPP STYLE + EMOJIS
   ========================================= */
let publicChatSubscribed = false;
let publicChatLoading = false;
let publicChatUserNearBottom = true;

function escapePublicChatHTML(str){
  return String(str || "").replace(/[&<>"']/g, m => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#039;"
  }[m]));
}

function publicChatTime(value){
  try{
    return new Date(value).toLocaleTimeString("es-PR", {
      hour:"numeric",
      minute:"2-digit"
    });
  }catch(e){ return ""; }
}

function setupPublicChatScrollWatcher(){
  const box = document.getElementById("publicChatMessages");
  if(!box || box.dataset.scrollWatcher === "1") return;
  box.dataset.scrollWatcher = "1";

  box.addEventListener("scroll", () => {
    const distanceFromBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
    publicChatUserNearBottom = distanceFromBottom < 90;
    const btn = document.getElementById("waNewMessagesBtn");
    if(btn && publicChatUserNearBottom) btn.style.display = "none";
  });
}

function forcePublicChatBottom(smooth = false){
  const box = document.getElementById("publicChatMessages");
  const btn = document.getElementById("waNewMessagesBtn");
  if(!box) return;

  requestAnimationFrame(() => {
    box.scrollTo({
      top: box.scrollHeight,
      behavior: smooth ? "smooth" : "auto"
    });
    publicChatUserNearBottom = true;
    if(btn) btn.style.display = "none";
  });
}

function insertPublicEmoji(emoji){
  const input = document.getElementById("publicChatInput");
  if(!input) return;

  const start = input.selectionStart || 0;
  const end = input.selectionEnd || 0;
  const text = input.value || "";

  input.value = text.slice(0,start) + emoji + text.slice(end);
  input.focus();

  const pos = start + emoji.length;
  input.setSelectionRange(pos,pos);

  if(typeof playClickSound === "function") playClickSound();
}

async function sendPublicMessage(){
  const input = document.getElementById("publicChatInput");
  if(!input || !currentUser){
    alert("No hay usuario activo. Vuelve a iniciar sesión.");
    return;
  }

  const message = input.value.trim();
  if(!message) return;

  const tempMsg = {
    id: "temp-" + Date.now(),
    sender_id: currentUser.id,
    sender_name: currentUser.full_name || "OLON Member",
    sender_role: currentUser.role || "student",
    message: message,
    created_at: new Date().toISOString(),
    temp:true
  };

  addPublicMessage(tempMsg, true);
  input.value = "";
  forcePublicChatBottom(true);

  const { data, error } = await supabaseClient
    .from("general_chat_messages")
    .insert([{
      sender_id: currentUser.id,
      sender_name: currentUser.full_name || "OLON Member",
      sender_role: currentUser.role || "student",
      message: message
    }])
    .select()
    .single();

  if(error){
    alert("No se pudo enviar el mensaje público. Revisa si corriste el SQL en Supabase.");
    console.error("Public chat send error:", error);
    return;
  }

  setTimeout(loadPublicChat, 250);

  if(typeof playClickSound === "function") playClickSound();
}

async function loadPublicChat(){
  if(publicChatLoading) return;
  const box = document.getElementById("publicChatMessages");
  if(!box || typeof supabaseClient === "undefined") return;

  setupPublicChatScrollWatcher();
  publicChatLoading = true;

  const { data, error } = await supabaseClient
    .from("general_chat_messages")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(150);

  publicChatLoading = false;

  if(error){
    box.innerHTML = `<div class="waEmpty"><div class="waEmptyIcon">⚠️</div><h3>No se pudo cargar el Chat Público</h3><p>Revisa la tabla general_chat_messages en Supabase.</p></div>`;
    console.error("Public chat load error:", error);
    return;
  }

  box.innerHTML = "";

  if(!data || !data.length){
    box.innerHTML = `<div class="waEmpty"><div class="waEmptyIcon">💬</div><h3>Chat Público OLON</h3><p>Sé el primero en escribir.</p></div>`;
  }else{
    data.forEach(msg => addPublicMessage(msg, false));
  }

  subscribePublicChat();
  forcePublicChatBottom(false);
}

function addPublicMessage(msg, forceBottom = false){
  const box = document.getElementById("publicChatMessages");
  if(!box) return;

  const empty = box.querySelector(".waEmpty, .top3Empty");
  if(empty) empty.remove();

  if(msg?.id && box.querySelector(`[data-public-chat-id="${msg.id}"]`)) return;

  const isMe = currentUser && msg.sender_id === currentUser.id;
  const isAdmin = msg.sender_role === "admin";

  const div = document.createElement("div");
  div.className = "waBubble " + (isAdmin ? "admin " : "") + (isMe ? "me" : "");
  div.setAttribute("data-public-chat-id", msg.id || "");

  div.innerHTML = `
    <span class="waName">${escapePublicChatHTML(msg.sender_name || "OLON Member")}${isAdmin ? " 👑" : ""}</span>
    <div class="waText">${escapePublicChatHTML(msg.message || "")}</div>
    <div class="waMeta">
      <span>${escapePublicChatHTML(publicChatTime(msg.created_at))}</span>
      ${isMe ? `<span class="waChecks">✓✓</span>` : ""}
    </div>
  `;

  box.appendChild(div);

  const btn = document.getElementById("waNewMessagesBtn");
  if(forceBottom || isMe || publicChatUserNearBottom){
    forcePublicChatBottom(true);
  }else if(btn){
    btn.style.display = "inline-flex";
  }
}

function subscribePublicChat(){
  if(publicChatSubscribed || typeof supabaseClient === "undefined") return;

  supabaseClient
    .channel("olon-public-chat-live")
    .on(
      "postgres_changes",
      {
        event:"INSERT",
        schema:"public",
        table:"general_chat_messages"
      },
      payload => {
        addPublicMessage(payload.new, false);
        if(typeof playNewMessageSound === "function") playNewMessageSound();
      }
    )
    .subscribe();

  publicChatSubscribed = true;
}

function handlePublicChatEnter(e){
  if(e.key === "Enter" && !e.shiftKey){
    e.preventDefault();
    sendPublicMessage();
  }
}



/* =====================================================
   MENU TOGGLE WEB + MOBILE + IPAD - FINAL
   ===================================================== */
(function(){
  function getPortal(){ return document.getElementById("portal"); }
  function getSidebar(){ return document.getElementById("sidebar"); }
  function getIcon(){ return document.getElementById("mobileMenuIcon"); }
  function getBtn(){ return document.getElementById("mobileMenuToggle"); }

  function isDesktop(){
    return window.matchMedia("(min-width: 981px)").matches;
  }

  function isOpen(){
    const portal = getPortal();
    const sidebar = getSidebar();

    if(isDesktop()){
      return !(portal && portal.classList.contains("sidebar-closed"));
    }

    return !!(sidebar && sidebar.classList.contains("open"));
  }

  function updateMenuUI(){
    const opened = isOpen();
    const icon = getIcon();
    const btn = getBtn();

    if(icon) icon.textContent = opened ? "×" : "☰";
    if(btn) btn.setAttribute("aria-label", opened ? "Cerrar menú" : "Abrir menú");

    document.body.classList.toggle("menu-open", opened && !isDesktop());
  }

  window.toggleMenu = function(){
    const portal = getPortal();
    const sidebar = getSidebar();
    if(!portal || !sidebar) return;

    if(isDesktop()){
      portal.classList.toggle("sidebar-closed");
      sidebar.classList.remove("open");
      document.body.classList.remove("menu-open");
    }else{
      sidebar.classList.toggle("open");
      portal.classList.remove("sidebar-closed");
    }

    updateMenuUI();
  };

  window.closeMenu = function(){
    const portal = getPortal();
    const sidebar = getSidebar();

    if(isDesktop()){
      if(portal) portal.classList.add("sidebar-closed");
    }else{
      if(sidebar) sidebar.classList.remove("open");
      document.body.classList.remove("menu-open");
    }

    updateMenuUI();
  };

  window.openMenu = function(){
    const portal = getPortal();
    const sidebar = getSidebar();

    if(isDesktop()){
      if(portal) portal.classList.remove("sidebar-closed");
    }else{
      if(sidebar) sidebar.classList.add("open");
    }

    updateMenuUI();
  };

  document.addEventListener("click", function(e){
    const btn = e.target.closest("#mobileMenuToggle");
    if(btn){
      e.preventDefault();
      e.stopImmediatePropagation();
      window.toggleMenu();
      return false;
    }

    if(!isDesktop() && document.body.classList.contains("menu-open")){
      const sidebar = getSidebar();
      if(sidebar && !sidebar.contains(e.target) && !e.target.closest("#mobileMenuToggle")){
        sidebar.classList.remove("open");
        updateMenuUI();
      }
    }
  }, true);

  document.addEventListener("DOMContentLoaded", function(){
    const portal = getPortal();
    const sidebar = getSidebar();

    // Desktop comienza abierto; móvil comienza cerrado
    if(isDesktop()){
      if(portal) portal.classList.remove("sidebar-closed");
      if(sidebar) sidebar.classList.remove("open");
    }else{
      if(sidebar) sidebar.classList.remove("open");
      if(portal) portal.classList.remove("sidebar-closed");
      document.body.classList.remove("menu-open");
    }

    updateMenuUI();
  });

  window.addEventListener("resize", function(){
    const portal = getPortal();
    const sidebar = getSidebar();

    if(isDesktop()){
      if(sidebar) sidebar.classList.remove("open");
      document.body.classList.remove("menu-open");
    }else{
      if(portal) portal.classList.remove("sidebar-closed");
    }

    updateMenuUI();
  });
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

// ===== OLON MARKET NEWS PRO - FINNHUB SECURE SUPABASE FUNCTION =====
const OLON_NEWS_FUNCTION_URL = "https://bffojtcojnsvzxzwbdes.supabase.co/functions/v1/quick-worker";
let currentNewsCategory = "forex";
let cachedNewsItems = [];

function escapeNewsText(value){
  return String(value || "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
}

function setNewsActiveButton(category){
  document.querySelectorAll(".newsFilterBtn").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-news-category") === category);
  });
}

function formatNewsDate(timestamp){
  try{
    if(!timestamp) return "Ahora";
    return new Date(Number(timestamp) * 1000).toLocaleString("es-PR", {
      month:"short", day:"numeric", hour:"numeric", minute:"2-digit"
    });
  }catch(e){ return "Ahora"; }
}

function renderNews(items){
  const container = document.getElementById("newsContainer");
  const status = document.getElementById("newsStatus");
  if(!container) return;

  const clean = Array.isArray(items) ? items.filter(n => n && n.headline && n.url) : [];
  cachedNewsItems = clean;

  if(status){
    status.textContent = `${clean.length} noticias cargadas · Categoría: ${currentNewsCategory.toUpperCase()}`;
  }

  if(!clean.length){
    container.innerHTML = `<div class="newsEmpty">No llegaron noticias para esta categoría ahora mismo. Prueba General o Crypto.</div>`;
    return;
  }

  container.innerHTML = clean.slice(0, 24).map(n => {
    const img = n.image || "https://placehold.co/700x420/070b16/f6c453?text=OLON+Market+News";
    const source = "OLON Market Feed";
    const headline = escapeNewsText(n.headline || "Noticia del mercado");
    const summary = escapeNewsText(n.summary || "Abre la noticia para leer más detalles del mercado.");
    const url = String(n.url || "#");
    const date = formatNewsDate(n.datetime);
    const dataText = escapeNewsText((source + " " + headline + " " + summary).toLowerCase());

    return `
      <article class="newsCard" data-news-text="${dataText}">
        <div class="newsImageWrap"><img src="${img}" alt="${headline}" loading="lazy" onerror="this.src='https://placehold.co/700x420/070b16/f6c453?text=OLON+Market+News'"></div>
        <div class="newsContent">
          <div class="newsMeta"><span class="newsSource">${source}</span><span>${date}</span></div>
          <h4>${headline}</h4>
          <p>${summary.length > 130 ? summary.slice(0,130) + "..." : summary}</p>
          <a href="${url}" target="_blank" rel="noopener noreferrer">Leer más →</a>
        </div>
      </article>
    `;
  }).join("");

  filterNewsCards();
}

async function loadNews(category = "forex", force = false){
  currentNewsCategory = category || "forex";
  window.currentNewsCategory = currentNewsCategory;
  setNewsActiveButton(currentNewsCategory);

  const container = document.getElementById("newsContainer");
  const status = document.getElementById("newsStatus");
  if(!container) return;

  container.innerHTML = `<div class="newsLoading">Cargando noticias del mercado...</div>`;
  if(status) status.textContent = "Cargando flujo de mercado...";

  try{
    const res = await fetch(`${OLON_NEWS_FUNCTION_URL}?category=${encodeURIComponent(currentNewsCategory)}`);
    const data = await res.json();

    if(!res.ok || data?.error){
      throw new Error(data?.error || "No se pudo cargar el flujo de noticias");
    }

    renderNews(data);
  }catch(err){
    console.error("Market news error", err);
    container.innerHTML = `<div class="newsError">No se pudieron cargar las noticias. Verifica tu conexión e intenta de nuevo.</div>`;
    if(status) status.textContent = "Error de conexión con noticias.";
  }
}

function filterNewsCards(){
  const input = document.getElementById("newsSearchInput");
  const query = (input?.value || "").trim().toLowerCase();
  const cards = document.querySelectorAll(".newsCard");
  cards.forEach(card => {
    const text = card.getAttribute("data-news-text") || "";
    card.style.display = !query || text.includes(query) ? "" : "none";
  });
}

window.loadNews = loadNews;
window.filterNewsCards = filterNewsCards;
window.currentNewsCategory = currentNewsCategory;

(function(){
  const previousShowPage = window.showPage;
  window.showPage = function(id, btn){
    if(typeof previousShowPage === "function") previousShowPage(id, btn);
    if(id === "newsProPage"){
      setTimeout(() => loadNews(window.currentNewsCategory || "forex"), 120);
    }
  };
})();

/* ===== OLON NEWS HARD FIX V2 - QUICK WORKER VERIFIED ===== */
(function(){
  const NEWS_URL = "https://bffojtcojnsvzxzwbdes.supabase.co/functions/v1/quick-worker";
  let newsCategory = "forex";
  let installed = false;

  function esc(v){
    return String(v || "").replace(/[&<>\"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
  }

  function ensureNewsPage(){
    const main = document.querySelector("main.main") || document.querySelector("#portal .main");
    if(!main) return;

    let page = document.getElementById("newsProPage");
    if(!page){
      page = document.createElement("section");
      page.id = "newsProPage";
      page.className = "page hidden";
      main.appendChild(page);
    }

    page.innerHTML = `
      <div class="marketNewsHero card">
        <div>
          <span class="newsKicker">OLON MARKET FEED</span>
          <h2>📰 Noticias del Mercado</h2>
          <p>Noticias financieras en tiempo real para apoyar tus decisiones de trading.</p>
        </div>
        <div class="newsHeroActions"><div class="newsHeroActions"><button class="btn secondary" type="button" onclick="loadNews(window.currentNewsCategory || 'forex', true)">↻ Actualizar</button><a class="btn secondary forexFactoryBtn" href="https://www.forexfactory.com/calendar" target="_blank" rel="noopener noreferrer">📅 Forex Factory</a></div><a class="btn secondary forexFactoryBtn" href="https://www.forexfactory.com/calendar" target="_blank" rel="noopener noreferrer">📅 Forex Factory</a></div>
      </div>
      <div class="newsProToolbar card">
        <div class="newsFilters">
          <button class="newsFilterBtn active" type="button" data-news-category="forex" onclick="loadNews('forex', true)">💱 Forex</button>
          <button class="newsFilterBtn" type="button" data-news-category="crypto" onclick="loadNews('crypto', true)">🪙 Crypto</button>
          <button class="newsFilterBtn" type="button" data-news-category="general" onclick="loadNews('general', true)">🌎 General</button>
        </div>
        <div class="newsSearchBox">
          <input id="newsSearchInput" type="search" placeholder="Buscar: gold, USD, bitcoin..." oninput="filterNewsCards()">
        </div>
      </div>
      <div id="newsStatus" class="newsStatus">Listo para cargar noticias.</div>
      <div id="newsContainer" class="newsGrid"></div>
    `;
  }

  function ensureNewsButtons(){
    const nav = document.querySelector(".sidebar .nav") || document.querySelector(".nav");
    if(nav && !nav.querySelector('[data-page="newsProPage"], .olonNewsNavBtn')){
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "studentNav olonNewsNavBtn";
      btn.setAttribute("data-page", "newsProPage");
      btn.innerHTML = "📰 Noticias";
      btn.onclick = function(){ window.showPage("newsProPage", btn); };
      const logout = Array.from(nav.children).find(x => String(x.textContent || "").includes("Salir"));
      if(logout) nav.insertBefore(btn, logout); else nav.appendChild(btn);
    }

    const bottom = document.querySelector(".mobileBottomNav");
    if(bottom && !bottom.querySelector('[onclick*="newsProPage"], .olonNewsMobileBtn')){
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "olonNewsMobileBtn";
      btn.innerHTML = "<span>📰</span><small>Noticias</small>";
      btn.onclick = function(){ window.showPage("newsProPage", btn); };
      bottom.appendChild(btn);
    }
  }

  function setActiveNewsButton(category){
    document.querySelectorAll(".newsFilterBtn").forEach(btn=>{
      btn.classList.toggle("active", btn.getAttribute("data-news-category") === category);
    });
  }

  function formatDate(ts){
    try{
      return new Date(Number(ts) * 1000).toLocaleString("es-PR", {month:"short", day:"numeric", hour:"numeric", minute:"2-digit"});
    }catch(e){ return "Ahora"; }
  }

  function stripHtml(s){
    const div = document.createElement("div");
    div.innerHTML = String(s || "");
    return div.textContent || div.innerText || "";
  }

  window.filterNewsCards = function(){
    const q = (document.getElementById("newsSearchInput")?.value || "").trim().toLowerCase();
    document.querySelectorAll(".newsCard").forEach(card=>{
      const text = card.getAttribute("data-news-text") || "";
      card.style.display = !q || text.includes(q) ? "" : "none";
    });
  };

  window.loadNews = async function(category = "forex", force = false){
    ensureNewsPage();
    newsCategory = category || "forex";
    window.currentNewsCategory = newsCategory;
    setActiveNewsButton(newsCategory);

    const container = document.getElementById("newsContainer");
    const status = document.getElementById("newsStatus");
    if(!container) return;

    container.innerHTML = `<div class="newsLoading">Cargando noticias del mercado...</div>`;
    if(status) status.textContent = "Cargando flujo de mercado...";

    try{
      const response = await fetch(`${NEWS_URL}?category=${encodeURIComponent(newsCategory)}&t=${Date.now()}`, { cache:"no-store" });
      const data = await response.json();

      if(!response.ok || data?.error){
        throw new Error(data?.error || `HTTP ${response.status}`);
      }

      const list = Array.isArray(data) ? data.filter(n => n && n.headline && n.url) : [];
      window.olonLatestNewsList = list;
      if(status) status.textContent = `${list.length} noticias cargadas · ${newsCategory.toUpperCase()}`;

      if(!list.length){
        container.innerHTML = `<div class="newsEmpty">No llegaron noticias para esta categoría ahora mismo. Prueba General o Crypto.</div>`;
        return;
      }

      container.innerHTML = list.slice(0, 24).map(n=>{
        const source = "OLON Market Feed";
        const headline = esc(n.headline || "Noticia del mercado");
        const summaryRaw = stripHtml(n.summary || "Abre la noticia para leer más detalles.");
        const summary = esc(summaryRaw.length > 145 ? summaryRaw.slice(0,145) + "..." : summaryRaw);
        const img = esc(n.image || "https://placehold.co/700x420/070b16/f6c453?text=OLON+Market+News");
        const url = esc(n.url || "#");
        const date = esc(formatDate(n.datetime));
        const dataText = esc(`${source} ${headline} ${summary}`.toLowerCase());
        return `
          <article class="newsCard" data-news-text="${dataText}">
            <div class="newsImageWrap"><img src="${img}" alt="${headline}" loading="lazy" onerror="this.src='https://placehold.co/700x420/070b16/f6c453?text=OLON+Market+News'"></div>
            <div class="newsContent">
              <div class="newsMeta"><span class="newsSource">${source}</span><span>${date}</span></div>
              <h4>${headline}</h4>
              <p>${summary}</p>
              <a href="${url}" target="_blank" rel="noopener noreferrer">Leer más →</a>
            </div>
          </article>`;
      }).join("");
      window.filterNewsCards();
    }catch(err){
      console.error("OLON Market News error", err);
      if(status) status.textContent = "Error conectando noticias.";
      container.innerHTML = `<div class="newsError"><b>Error de conexión de noticias.</b><br>Verifica tu conexión e intenta actualizar la página.<br><small>${esc(err.message)}</small></div>`;
    }
  };

  function localShowPage(id, btn){
    document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
    const page = document.getElementById(id);
    if(page) page.classList.remove("hidden");
    document.querySelectorAll(".nav button,.mobileBottomNav button").forEach(b => b.classList.remove("active"));
    if(btn) btn.classList.add("active");
    if(id === "newsProPage"){
      const title = document.getElementById("pageTitle");
      const sub = document.getElementById("pageSubtitle");
      if(title) title.textContent = "Noticias del Mercado";
      if(sub) sub.textContent = "Flujo de información en tiempo real sobre mercados globales.";
      setTimeout(()=>window.loadNews(window.currentNewsCategory || "forex", true), 80);
    }
  }

  function installNewsHardFix(){
    if(installed) return;
    installed = true;
    ensureNewsPage();
    ensureNewsButtons();

    const originalShowPage = window.showPage;
    window.showPage = function(id, btn){
      if(id === "newsProPage"){
        ensureNewsPage();
        ensureNewsButtons();
        localShowPage(id, btn);
        return;
      }
      if(typeof originalShowPage === "function") return originalShowPage(id, btn);
      localShowPage(id, btn);
    };

    window.mobileGo = function(id, btn){ window.showPage(id, btn); };
  }

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", installNewsHardFix);
  else installNewsHardFix();
})();

/* ===== AI MENTOR REMOVIDO: SOLO NOLO IA ===== */
(function(){function removeOldMentor(){["aiMentorBtn","aiMentorPanel"].forEach(id=>document.getElementById(id)?.remove());}window.toggleAIMentor=function(){if(window.toggleNoloFloatingChat) window.toggleNoloFloatingChat();};window.openAIMentorWithNews=function(){if(window.openNoloFloatingChat) window.openNoloFloatingChat(); if(window.askNoloQuick) setTimeout(()=>window.askNoloQuick("Analiza las noticias actuales"),120);};if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",removeOldMentor);else removeOldMentor();})();



/* ===== NOLO IA PRO - FLOATING + LIMITE 30/DIA REAL EN SUPABASE + PERFIL + ADMIN ===== */
(function(){
  const NOLO_AI_FUNCTION_URL = (typeof SUPABASE_URL !== "undefined" ? SUPABASE_URL : "https://bffojtcojnsvzxzwbdes.supabase.co") + "/functions/v1/smart-api";
  const DAILY_LIMIT = 30;
  const NOLO_IDLE_MS = 3 * 60 * 1000;
  const NOLO_COOLDOWN_MS = 5 * 1000;
  let noloIdleTimer = null;
  let noloCooldownUntil = 0;
  window.noloUsage = { used: 0, remaining: DAILY_LIMIT, loaded: false };
  function esc(v){ return String(v||"").replace(/[&<>\"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m])); }
  function stripHtml(s){ const d=document.createElement("div"); d.innerHTML=String(s||""); return d.textContent||d.innerText||""; }
  function getUser(){ try{return window.currentUser||JSON.parse(localStorage.getItem("olon_current_user")||"null");}catch(e){return null;} }
  function playNoloSound(){ try{ if(typeof playNewMessageSound==="function") return playNewMessageSound(); if(typeof playClickSound==="function") return playClickSound(); }catch(e){} }
  function getNewsContext(){ const list=Array.isArray(window.olonLatestNewsList)?window.olonLatestNewsList:[]; return list.slice(0,8).map(n=>({headline:n.headline||n.title||"",summary:stripHtml(n.summary||n.description||""),url:n.url||"",datetime:n.datetime||n.published_at||""})); }
  function getPerformanceProfile(){
    const user=getUser()||{}, records=(typeof cachedRecords!=="undefined"&&Array.isArray(cachedRecords))?cachedRecords:[];
    const sum=k=>records.reduce((a,r)=>a+Number(r?.[k]||0),0), deposit=sum("deposit"), gain=sum("gain"), loss=sum("loss"), net=gain-loss, days=records.length;
    const positiveDays=records.filter(r=>(Number(r.gain||0)-Number(r.loss||0))>0).length, negativeDays=records.filter(r=>(Number(r.gain||0)-Number(r.loss||0))<0).length;
    const consistency=days?Math.round((positiveDays/days)*100):0, riskControl=gain>0?Math.max(0,Math.min(100,Math.round(100-((loss/gain)*55)))):(loss>0?25:70), growth=deposit>0?Math.round((net/deposit)*10000)/100:0;
    const traderScore=Math.round((consistency*.45)+(riskControl*.35)+(Math.max(0,Math.min(100,50+growth))*0.20));
    let suggestion="Registra más días para que Nolo IA pueda medir tu progreso con más precisión.";
    if(days>=3){ if(consistency<55) suggestion="Mejora la consistencia: busca menos entradas impulsivas y registra cada día."; else if(riskControl<60) suggestion="Tu punto principal es control de riesgo: reduce pérdidas grandes y respeta stop loss."; else if(net<0) suggestion="Aunque tienes días positivos, el neto está negativo. Revisa tamaño de pérdida vs ganancia."; else suggestion="Vas bien. Mantén disciplina, evita sobreoperar y protege el capital."; }
    return {studentName:user.full_name||"Estudiante",plan:user.plan||"VIP Regular",status:user.status||"",days,deposit,gain,loss,net,balance:deposit+net,growth,positiveDays,negativeDays,consistency,riskControl,traderScore,suggestion,recentNotes:records.slice(-5).map(r=>({date:r.record_date||r.date,gain:r.gain||0,loss:r.loss||0,note:r.note||"",emotion:r.emotion||""}))};
  }
  function getPuertoRicoParts(){
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone:"America/Puerto_Rico",
      year:"numeric",
      month:"numeric",
      day:"numeric"
    }).formatToParts(new Date()).reduce((a,p)=>{ a[p.type]=p.value; return a; },{});
    return {
      year:Number(parts.year),
      month:Number(parts.month),
      day:Number(parts.day)
    };
  }

  function getNextNoloResetDate(){
    const pr = getPuertoRicoParts();
    // Puerto Rico usa UTC-4 todo el año. Medianoche PR = 04:00 UTC.
    return new Date(Date.UTC(pr.year, pr.month - 1, pr.day + 1, 4, 0, 0));
  }

  function formatNoloCountdown(ms){
    ms = Math.max(0, Number(ms || 0));
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return String(h).padStart(2,"0") + ":" + String(m).padStart(2,"0") + ":" + String(s).padStart(2,"0");
  }

  function injectNoloResetClockStyle(){
    if(document.getElementById("noloResetClockStyle")) return;
    const style = document.createElement("style");
    style.id = "noloResetClockStyle";
    style.textContent = `
      .noloResetClock{
        margin-top:8px;
        display:inline-flex;
        align-items:center;
        gap:8px;
        padding:8px 12px;
        border-radius:999px;
        background:rgba(246,196,83,.11);
        border:1px solid rgba(246,196,83,.24);
        color:#fde68a;
        font-size:12px;
        font-weight:800;
        letter-spacing:.2px;
        box-shadow:0 10px 28px rgba(246,196,83,.08);
      }
      .noloResetClock b{color:#fff;font-size:13px;}
      .noloResetClock.empty{background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.25);color:#fecaca;}
      .noloResetClock.ready{background:rgba(34,197,94,.12);border-color:rgba(34,197,94,.25);color:#bbf7d0;}
      .noloClockWrap{margin-top:7px;}
      .noloFloatClock{display:block;margin-top:4px;color:#fde68a;font-size:11px;font-weight:800;}
    `;
    document.head.appendChild(style);
  }

  function ensureNoloResetClock(){
    injectNoloResetClockStyle();

    const pill = document.getElementById("noloLimitPill");
    if(pill && !document.getElementById("noloResetClock")){
      const wrap = document.createElement("div");
      wrap.className = "noloClockWrap";
      wrap.innerHTML = `<div id="noloResetClock" class="noloResetClock">⏱️ Reset en <b>--:--:--</b></div>`;
      pill.insertAdjacentElement("afterend", wrap);
    }

    const floatStatus = document.getElementById("noloFloatStatus");
    if(floatStatus && !document.getElementById("noloFloatResetClock")){
      const small = document.createElement("small");
      small.id = "noloFloatResetClock";
      small.className = "noloFloatClock";
      small.textContent = "⏱️ Reset en --:--:--";
      floatStatus.insertAdjacentElement("afterend", small);
    }
  }

  let noloResetClockTimer = null;
  function startNoloResetClock(){
    ensureNoloResetClock();
    if(noloResetClockTimer) clearInterval(noloResetClockTimer);

    const tick = async () => {
      const nextReset = getNextNoloResetDate();
      const left = nextReset.getTime() - Date.now();
      const txt = formatNoloCountdown(left);
      const main = document.getElementById("noloResetClock");
      const float = document.getElementById("noloFloatResetClock");
      const empty = window.noloUsage?.loaded && Number(window.noloUsage.remaining || 0) <= 0;

      if(main){
        main.classList.toggle("empty", empty);
        main.classList.toggle("ready", left <= 1000);
        main.innerHTML = left <= 1000 ? `✅ Límite reiniciado` : `⏱️ Reset en <b>${txt}</b>`;
      }
      if(float){
        float.textContent = left <= 1000 ? "✅ Límite reiniciado" : `⏱️ Reset en ${txt}`;
      }

      if(left <= 1000){
        clearInterval(noloResetClockTimer);
        noloResetClockTimer = null;
        setTimeout(()=>{ if(typeof refreshUsage === "function") refreshUsage(); }, 1500);
      }
    };

    tick();
    noloResetClockTimer = setInterval(tick, 1000);
  }

  function setStatus(remaining,used){
    const rem=Math.max(0,Number(remaining??DAILY_LIMIT)), u=Math.max(0,Number(used??(DAILY_LIMIT-rem)));
    window.noloUsage={used:u,remaining:rem,loaded:true};
    const msg=rem>0?`Te quedan ${rem} mensajes de ${DAILY_LIMIT} hoy.`:`Llegaste al límite diario de ${DAILY_LIMIT} mensajes.`;
    ["noloStatus","noloFloatStatus"].forEach(id=>{const el=document.getElementById(id); if(el)el.textContent=msg;});
    const pill=document.getElementById("noloLimitPill"); if(pill){pill.textContent=`${rem} / ${DAILY_LIMIT}`; pill.classList.toggle("low",rem>0&&rem<=5); pill.classList.toggle("empty",rem<=0);}
    ["noloSendBtn","noloFloatSendBtn"].forEach(id=>{const el=document.getElementById(id); if(el)el.disabled=rem<=0;});
    startNoloResetClock();
  }
  function setSendButtons(disabled){["noloSendBtn","noloFloatSendBtn"].forEach(id=>{const el=document.getElementById(id); if(el)el.disabled=!!disabled;});}
  function setNoloStatusText(msg){["noloStatus","noloFloatStatus"].forEach(id=>{const el=document.getElementById(id); if(el)el.textContent=msg;});}
  function startNoloCooldown(){
    noloCooldownUntil = Date.now() + NOLO_COOLDOWN_MS;
    setSendButtons(true);
    const tick=()=>{
      const left=Math.ceil((noloCooldownUntil-Date.now())/1000);
      if(left>0){ setNoloStatusText(`Espera ${left}s para enviar otro mensaje y evitar spam.`); setTimeout(tick,250); }
      else { noloCooldownUntil=0; setSendButtons(window.noloUsage.loaded && window.noloUsage.remaining<=0); setStatus(window.noloUsage.remaining, window.noloUsage.used); }
    };
    tick();
  }
  function resetNoloIdleTimer(){
    clearTimeout(noloIdleTimer);
    noloIdleTimer = setTimeout(()=>{ window.clearNoloMemoryDueToIdle?.(); }, NOLO_IDLE_MS);
  }
  function setCheckingStatus(){["noloStatus","noloFloatStatus"].forEach(id=>{const el=document.getElementById(id); if(el)el.textContent="Verificando límite diario en Supabase...";});}
  function messageBoxes(){return [document.getElementById("noloMessages"),document.getElementById("noloFloatMessages")].filter(Boolean);}
  function addBubble(role,text,time){ const who=role==="user"?"Tú":"Nolo IA", stamp=time?new Date(time).toLocaleString("es-PR",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"ahora", html=`<b>${who}</b><p>${esc(text)}</p><small>${stamp}</small>`; messageBoxes().forEach(box=>{const div=document.createElement("div"); div.className=`noloBubble ${role==="user"?"user":"ai"}`; div.innerHTML=html; box.appendChild(div); box.scrollTop=box.scrollHeight;});}
  function setTyping(on){messageBoxes().forEach(box=>{let el=box.querySelector(".noloTyping"); if(on&&!el){el=document.createElement("div"); el.className="noloBubble ai noloTyping"; el.innerHTML="<b>Nolo IA</b><p>Analizando tu perfil, memoria y noticias...</p><small>escribiendo</small>"; box.appendChild(el); box.scrollTop=box.scrollHeight;} if(!on&&el)el.remove();});}
  async function refreshUsage(){
    const user=getUser(); if(!user?.id){setStatus(DAILY_LIMIT,0); return;} setCheckingStatus();
    try{const res=await fetch(NOLO_AI_FUNCTION_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"usage",userId:user.id,dailyLimit:DAILY_LIMIT})}); const data=await res.json().catch(()=>({})); if(!res.ok)throw new Error(data.error||"No se pudo verificar el uso"); setStatus(data.remaining,data.used);}
    catch(e){console.error("refreshUsage",e); ["noloStatus","noloFloatStatus"].forEach(id=>{const el=document.getElementById(id); if(el)el.textContent="No pude verificar el límite. Revisa smart-api y el SQL.";}); ["noloSendBtn","noloFloatSendBtn"].forEach(id=>{const el=document.getElementById(id); if(el)el.disabled=false;});}
  }
  function clearBoxes(){messageBoxes().forEach(box=>box.innerHTML="");}
  window.loadNoloHistory=async function(force){ const user=getUser(); if(force)clearBoxes(); if(!user?.id||typeof supabaseClient==="undefined"){addBubble("ai","Estoy listo. Inicia sesión para guardar memoria y usar el límite diario."); await refreshUsage(); return;} try{const {data,error}=await supabaseClient.from("nolo_messages").select("role,message,created_at").eq("user_id",user.id).order("created_at",{ascending:true}).limit(80); if(error)throw error; clearBoxes(); if(!data||!data.length){ const profile=getPerformanceProfile(); addBubble("ai",`Hola ${profile.studentName} 👋 Soy Nolo IA. Puedo leer tu perfil, consistencia, control de riesgo, noticias y disciplina. ¿Cómo te puedo ayudar hoy?`); } else data.forEach(m=>addBubble(m.role==="user"?"user":"ai",m.message,m.created_at)); await refreshUsage();}catch(err){console.error("loadNoloHistory",err); addBubble("ai","No pude cargar la memoria ahora mismo. Verifica la tabla nolo_messages en Supabase."); await refreshUsage();} };
  function getInputText(){const a=document.getElementById("noloFloatInput"),b=document.getElementById("noloInput"); return ((a?.value||"").trim()||(b?.value||"").trim());}
  function clearInputs(){["noloFloatInput","noloInput"].forEach(id=>{const el=document.getElementById(id); if(el)el.value="";});}
  window.askNoloQuick=function(text){const input=document.getElementById("noloFloatInput")||document.getElementById("noloInput"); if(input)input.value=text; window.sendNoloMessage();};
  window.handleNoloEnter=function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault(); window.sendNoloMessage();}};
  window.sendNoloMessage=async function(){
    const user=getUser(), text=getInputText(); if(!text)return; if(!user?.id){addBubble("ai","Debes iniciar sesión para usar Nolo IA.");return;}
    resetNoloIdleTimer();
    const waitMs = noloCooldownUntil - Date.now();
    if(waitMs > 0){ setNoloStatusText(`Espera ${Math.ceil(waitMs/1000)}s para enviar otro mensaje y evitar spam.`); return; }
    if(window.noloUsage.loaded&&window.noloUsage.remaining<=0){setStatus(0,DAILY_LIMIT); addBubble("ai",`Llegaste al límite diario de ${DAILY_LIMIT} mensajes. Puedes hablar con admin si necesitas ayuda.`); return;}
    startNoloCooldown();
    clearInputs(); addBubble("user",text); setTyping(true);
    try{const res=await fetch(NOLO_AI_FUNCTION_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"chat",userId:user.id,userName:user.full_name||user.name||"Estudiante",plan:user.plan||"VIP Regular",message:text,newsContext:getNewsContext(),performanceProfile:getPerformanceProfile(),dailyLimit:DAILY_LIMIT})}); const data=await res.json().catch(()=>({})); setTyping(false); if(res.status===429){setStatus(data.remaining??0,data.used??DAILY_LIMIT); addBubble("ai",`Llegaste al límite diario de ${DAILY_LIMIT} mensajes. Usa el botón Hablar con admin si necesitas ayuda.`); playNoloSound(); return;} if(!res.ok)throw new Error(data.error||"Error conectando Nolo IA"); addBubble("ai",data.reply||"No recibí respuesta de Nolo IA."); playNoloSound(); setStatus(data.remaining,data.used); resetNoloIdleTimer();}
    catch(err){setTyping(false); console.error("sendNoloMessage",err); addBubble("ai","No pude conectar con Nolo IA. Revisa que subiste smart-api.ts actualizado y corriste el SQL nuevo en Supabase."); playNoloSound(); await refreshUsage();}
  };
  window.openNoloAdminContact=function(){if(window.openNoloFloatingChat)window.openNoloFloatingChat(); const box=document.getElementById("noloAdminBox"); if(box)box.classList.toggle("hidden"); const input=document.getElementById("noloAdminInput"); if(input)setTimeout(()=>input.focus(),80);};
  window.sendNoloAdminMessage=async function(){ const user=getUser(), input=document.getElementById("noloAdminInput"), msg=(input?.value||"").trim(); if(!user?.id){addBubble("ai","Debes iniciar sesión para hablar con admin.");return;} if(!msg){if(input)input.focus();return;} try{const fullMsg=`Mensaje enviado desde Nolo IA:\n${msg}`; const {error}=await supabaseClient.from("chat_messages").insert([{student_id:user.id,sender_role:"student",message:fullMsg,is_read:false}]); if(error)throw error; if(input)input.value=""; addBubble("ai","Listo. Tu mensaje fue enviado al portal del admin. Te responderán por el chat privado."); playNoloSound(); if(typeof loadStudentChatMessages==="function")loadStudentChatMessages();}catch(e){console.error(e); addBubble("ai","No pude enviar el mensaje al admin. Verifica la tabla chat_messages en Supabase.");} };
  function ensureFloatingNolo(){document.getElementById("aiMentorBtn")?.remove(); document.getElementById("aiMentorPanel")?.remove(); if(document.getElementById("noloFloatingBtn"))return; const btn=document.createElement("button"); btn.id="noloFloatingBtn"; btn.type="button"; btn.innerHTML="🤖<span>Nolo IA</span>"; btn.onclick=window.toggleNoloFloatingChat; document.body.appendChild(btn); const panel=document.createElement("div"); panel.id="noloFloatingPanel"; panel.className="noloFloatPanel hidden"; panel.innerHTML=`<div class="noloFloatHeader"><div><b>🤖 Nolo IA</b><small id="noloFloatStatus">Verificando límite diario...</small></div><button type="button" onclick="toggleNoloFloatingChat()">✕</button></div><div id="noloFloatMessages" class="noloFloatMessages"></div><div class="noloFloatQuick"><button type="button" onclick="askNoloQuick('Lee mi perfil y dime qué debo mejorar en consistencia, control de riesgo y disciplina')">Mi perfil</button><button type="button" onclick="askNoloQuick('Analiza las noticias actuales')">Noticias</button><button type="button" onclick="askNoloQuick('Cómo afecta esto al oro XAUUSD')">Oro</button><button type="button" onclick="openNoloAdminContact()">Hablar con admin</button></div><div id="noloAdminBox" class="noloAdminBox hidden"><textarea id="noloAdminInput" placeholder="Escribe tu duda para el admin..."></textarea><button class="btn" type="button" onclick="sendNoloAdminMessage()">Enviar al portal admin</button></div><div class="noloFloatInput"><input id="noloFloatInput" placeholder="Escribe a Nolo IA..." onkeydown="if(event.key==='Enter') sendNoloMessage()"><button id="noloFloatSendBtn" type="button" onclick="sendNoloMessage()">Enviar</button></div>`; document.body.appendChild(panel); window.loadNoloHistory(false); refreshUsage();}
  window.toggleNoloFloatingChat=function(){ensureFloatingNolo(); const p=document.getElementById("noloFloatingPanel"); p?.classList.toggle("hidden"); if(p&&!p.classList.contains("hidden")){window.loadNoloHistory(false); resetNoloIdleTimer();} else {clearTimeout(noloIdleTimer);} };
  window.openNoloFloatingChat=function(){ensureFloatingNolo(); document.getElementById("noloFloatingPanel")?.classList.remove("hidden"); window.loadNoloHistory(false); resetNoloIdleTimer();};
  function hookShowPage(){const old=window.showPage; window.showPage=function(id,btn){const r=typeof old==="function"?old(id,btn):undefined; if(id==="noloAIPage"){const title=document.getElementById("pageTitle"),sub=document.getElementById("pageSubtitle"); if(title)title.textContent="Nolo IA Pro"; if(sub)sub.textContent="Asistente inteligente con perfil, memoria, noticias, sonido y límite diario."; setTimeout(()=>window.loadNoloHistory(true),80);} return r;};}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>{ensureFloatingNolo(); hookShowPage();}); else {ensureFloatingNolo(); hookShowPage();}
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

  const activeValue = Number(String(activeStudents?.innerText || "0").replace(/[^0-9]/g,"")) || 500;
  const tradeValue = Number(String(trades?.innerText || "0").replace(/[^0-9]/g,"")) || 1250;

  olonGodAnimateNumber("authActiveStudents", activeValue, { prefix:"+", duration:1400 });
  olonGodAnimateNumber("authTradesRegistered", tradeValue, { prefix:"+", duration:1750 });
  olonGodAnimateNumber("authDisciplinePercent", 98, { suffix:"%", duration:1600 });
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



/* =====================================================
   ADMIN PANEL NIVEL PRO — LOGIC
   ===================================================== */
function adminSafeText(v){ return String(v ?? "").trim(); }
function adminDateDaysLeft(dateValue){ if(!dateValue) return null; const today = new Date(); today.setHours(0,0,0,0); const d = new Date(String(dateValue) + "T00:00:00"); if(isNaN(d.getTime())) return null; return Math.ceil((d - today) / 86400000); }
function adminPlanLimit(plan, role){ if(String(role||"").toLowerCase()==="admin") return 999999; return String(plan||"").toLowerCase().includes("premium") ? 50 : 30; }
function adminRiskForUser(u){ if(String(u.role||"").toLowerCase()==="admin") return {cls:"good", label:"Protegido"}; const days = adminDateDaysLeft(u.next_payment_date); if(u.status === "suspended" || u.status === "expired") return {cls:"bad", label:"Revisar"}; if(u.status === "pending") return {cls:"warn", label:"Pendiente"}; if(days !== null && days < 0) return {cls:"bad", label:"Vencido"}; if(days !== null && days <= 7) return {cls:"warn", label:"Pago pronto"}; return {cls:"good", label:"OK"}; }
function adminAnimateMetric(id, value){ const el = document.getElementById(id); if(!el) return; el.innerText = value; el.classList.remove("countFlash"); void el.offsetWidth; el.classList.add("countFlash"); }
async function renderUsers(){ const { data, error } = await supabaseClient.from("profiles").select("id, email, full_name, access_code, password, role, plan, status, next_payment_date, created_at").order("created_at", { ascending:false }); if(error){ showError("No se pudieron cargar los estudiantes.", error); return; } cachedUsers = data || []; updateAdminMetrics(); renderAdminTable(); renderAdminAlerts(); renderAdminNoloUsage(); }
function updateAdminMetrics(){ const users = cachedUsers || []; const students = users.filter(u => String(u.role || "").toLowerCase() !== "admin"); const active = students.filter(u => u.status === "active").length; const pending = students.filter(u => u.status === "pending").length; const suspended = students.filter(u => u.status === "suspended").length; const expired = students.filter(u => u.status === "expired").length; const premium = students.filter(u => String(u.plan || "").toLowerCase().includes("premium")).length; const dueSoon = students.filter(u => { const d = adminDateDaysLeft(u.next_payment_date); return d !== null && d >= 0 && d <= 7; }).length; adminAnimateMetric("adminTotalUsers", students.length); adminAnimateMetric("adminActiveUsers", active); adminAnimateMetric("adminPendingUsers", pending); adminAnimateMetric("adminSuspendedUsers", suspended); adminAnimateMetric("adminExpiredUsers", expired); adminAnimateMetric("adminPremiumUsers", premium); adminAnimateMetric("adminDueSoonUsers", dueSoon); }
function filterAdminUsers(status){ const statusFilter = document.getElementById("adminStatusFilter"); const planFilter = document.getElementById("adminPlanFilter"); if(statusFilter) statusFilter.value = status || "all"; if(planFilter && status === "all") planFilter.value = "all"; renderAdminTable(); }
function filterAdminPlan(plan){ const planFilter = document.getElementById("adminPlanFilter"); const statusFilter = document.getElementById("adminStatusFilter"); if(planFilter) planFilter.value = plan || "all"; if(statusFilter) statusFilter.value = "all"; renderAdminTable(); }
function renderAdminAlerts(){ const box = document.getElementById("adminAlertList"); if(!box) return; const students = (cachedUsers || []).filter(u => String(u.role || "").toLowerCase() !== "admin"); const pending = students.filter(u => u.status === "pending"); const expired = students.filter(u => u.status === "expired" || (adminDateDaysLeft(u.next_payment_date) ?? 999) < 0); const dueSoon = students.filter(u => { const d = adminDateDaysLeft(u.next_payment_date); return d !== null && d >= 0 && d <= 7; }); const premium = students.filter(u => String(u.plan||"").toLowerCase().includes("premium")); const rows = []; if(pending.length) rows.push(`<div class="adminAlertItem warn"><span>⏳ <b>${pending.length}</b> cuenta(s) pendiente(s)</span><button class="btn secondary miniBtn" onclick="filterAdminUsers('pending')">Ver</button></div>`); if(expired.length) rows.push(`<div class="adminAlertItem bad"><span>🚨 <b>${expired.length}</b> estudiante(s) vencido(s)</span><button class="btn secondary miniBtn" onclick="filterAdminUsers('expired')">Ver</button></div>`); if(dueSoon.length) rows.push(`<div class="adminAlertItem warn"><span>📅 <b>${dueSoon.length}</b> pago(s) próximos</span><button class="btn secondary miniBtn" onclick="renderAdminTable()">Revisar</button></div>`); rows.push(`<div class="adminAlertItem good"><span>💎 <b>${premium.length}</b> estudiante(s) Premium</span><button class="btn secondary miniBtn" onclick="filterAdminPlan('premium')">Ver</button></div>`); if(!rows.length) rows.push(`<div class="adminAlertItem good"><span>✅ Todo se ve estable por ahora.</span></div>`); box.innerHTML = rows.join(""); }
async function renderAdminNoloUsage(){ const box = document.getElementById("adminNoloUsageList"); if(!box) return; try{ const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(); const { data, error } = await supabaseClient.from("nolo_messages").select("user_id, role, created_at").eq("role", "user").gte("created_at", start); if(error) throw error; const counts = {}; (data || []).forEach(m => { if(m.user_id) counts[m.user_id] = (counts[m.user_id] || 0) + 1; }); const total = Object.values(counts).reduce((a,b)=>a+b,0); adminAnimateMetric("adminNoloToday", total); const profileMap = {}; (cachedUsers || []).forEach(u => profileMap[u.id] = u); const rows = Object.entries(counts).map(([id,count]) => { const u = profileMap[id] || {}; const limit = adminPlanLimit(u.plan, u.role); const pct = limit >= 999999 ? 0 : Math.min(100, Math.round((count / limit) * 100)); return {id,count,u,limit,pct}; }).sort((a,b)=>b.count-a.count).slice(0,6); if(!rows.length){ box.innerHTML = `<div class="adminAlertItem">🤖 Todavía no hay mensajes usados hoy.</div>`; return; } box.innerHTML = rows.map(r => `<div class="adminAlertItem adminUsageRow"><div><b>${escapeHTML(r.u.full_name || "Estudiante")}</b><div class="adminUsageMeta">${escapeHTML(r.u.plan || "VIP Regular")} · ${r.count}/${r.limit >= 999999 ? "∞" : r.limit}</div></div><span class="badge ${r.pct >= 90 ? 'red' : r.pct >= 60 ? 'blue' : 'green'}">${r.pct}%</span><div class="adminUsageBar"><span style="width:${r.pct}%"></span></div></div>`).join(""); }catch(err){ console.warn("No se pudo cargar uso de Nolo IA", err); box.innerHTML = `<div class="adminAlertItem warn">⚠️ Uso de IA no disponible. Revisa tabla nolo_messages/RLS.</div>`; } }
function renderAdminTable(){ const body = document.getElementById("usersBody"); const mobile = document.getElementById("usersMobileCards"); if(!body) return; const search = (document.getElementById("adminSearch")?.value || "").toLowerCase().trim(); const statusFilter = document.getElementById("adminStatusFilter")?.value || "all"; const planFilter = document.getElementById("adminPlanFilter")?.value || "all"; let users = (cachedUsers || []).filter(u => { const text = `${u.full_name || ""} ${u.email || ""} ${u.access_code || ""}`.toLowerCase(); const statusOk = statusFilter === "all" || u.status === statusFilter; const plan = String(u.plan || "").toLowerCase(); const role = String(u.role || "").toLowerCase(); const planOk = planFilter === "all" || plan.includes(planFilter) || role.includes(planFilter); const searchOk = !search || text.includes(search); return statusOk && planOk && searchOk; }); const countPill = document.getElementById("adminCountPill"); if(countPill) countPill.innerText = users.length + (users.length === 1 ? " resultado" : " resultados"); body.innerHTML = users.map(u => adminUserRowHTML(u)).join("") || `<tr><td colspan="8" style="color:var(--muted);padding:24px">No hay usuarios con ese filtro.</td></tr>`; if(mobile){ mobile.innerHTML = users.map(u => adminUserMobileHTML(u)).join("") || `<div class="adminMobileCard" style="color:var(--muted)">No hay usuarios con ese filtro.</div>`; } }
function adminUserRowHTML(u){ const isMainAdmin = u.role === "admin" && u.access_code === "admin-nolo"; const initials = (u.full_name || "O").split(" ").map(x=>x[0]).join("").slice(0,2).toUpperCase(); const risk = adminRiskForUser(u); const days = adminDateDaysLeft(u.next_payment_date); const payText = u.next_payment_date ? `${u.next_payment_date}${days !== null ? ` (${days < 0 ? Math.abs(days)+'d vencido' : days+'d'})` : ''}` : "No asignado"; const safeName = String(u.full_name || "").replace(/'/g, "\\'"); const actions = isMainAdmin ? `<span class="badge blue">Protegido</span>` : `<div class="actionRow"><button class="btn success" onclick="updateUserStatus('${u.id}','active')">Aprobar</button><button class="btn warnBtn" onclick="updateUserStatus('${u.id}','suspended')">Suspender</button><button class="btn danger" onclick="deleteUser('${u.id}','${safeName}')">Borrar</button></div>`; return `<tr><td><div class="adminStudent"><div class="adminAvatar">${initials}</div><div><b>${escapeHTML(u.full_name || "Sin nombre")}</b><small>${escapeHTML(u.email || "Sin email")}</small></div></div></td><td><span class="codePill">${escapeHTML(u.access_code || "-")}</span></td><td><span class="codePill passPill">${escapeHTML(u.password || "-")}</span></td><td><select class="adminPlanSelect" onchange="updateUserPlan('${u.id}', this.value)" ${isMainAdmin ? 'disabled' : ''}><option value="VIP Regular" ${u.plan==='VIP Regular'?'selected':''}>VIP Regular</option><option value="VIP Premium" ${u.plan==='VIP Premium'?'selected':''}>VIP Premium</option><option value="Admin" ${u.plan==='Admin'?'selected':''}>Admin</option></select></td><td><select class="adminStatusSelect" onchange="updateUserStatus('${u.id}', this.value)" ${isMainAdmin ? 'disabled' : ''}><option value="pending" ${u.status==='pending'?'selected':''}>Pendiente</option><option value="active" ${u.status==='active'?'selected':''}>Activo</option><option value="suspended" ${u.status==='suspended'?'selected':''}>Suspendido</option><option value="expired" ${u.status==='expired'?'selected':''}>Expirado</option></select></td><td>${escapeHTML(payText)}</td><td><span class="adminRiskPill ${risk.cls}">${risk.label}</span></td><td>${actions}</td></tr>`; }
function adminUserMobileHTML(u){ const isMainAdmin = u.role === "admin" && u.access_code === "admin-nolo"; const initials = (u.full_name || "O").split(" ").map(x=>x[0]).join("").slice(0,2).toUpperCase(); const risk = adminRiskForUser(u); const safeName = String(u.full_name || "").replace(/'/g, "\\'"); return `<div class="adminMobileCard"><div class="adminMobileTop"><div class="adminAvatar">${initials}</div><div><b>${escapeHTML(u.full_name || "Sin nombre")}</b><small>${escapeHTML(u.email || "Sin email")}</small></div></div><div class="adminMobileMeta"><span>Código <b>${escapeHTML(u.access_code || "-")}</b></span><span>Plan <b>${escapeHTML(u.plan || "-")}</b></span><span>Estado <b>${escapeHTML(u.status || "-")}</b></span><span>Pago <b>${escapeHTML(u.next_payment_date || "No asignado")}</b></span><span>Riesgo <b class="adminRiskPill ${risk.cls}">${risk.label}</b></span></div><div class="adminMobileActions">${isMainAdmin ? `<span class="badge blue">Protegido</span>` : `<button class="btn success" onclick="updateUserStatus('${u.id}','active')">Aprobar</button><button class="btn warnBtn" onclick="updateUserStatus('${u.id}','suspended')">Suspender</button><button class="btn danger" onclick="deleteUser('${u.id}','${safeName}')">Borrar</button>`}</div></div>`; }
async function updateUserPlan(userId, newPlan){ if(!currentUser || !isAdminUser(currentUser)) return; const target = cachedUsers.find(u => u.id === userId); if(!target) return; if(target.role === "admin" && target.access_code === "admin-nolo"){ alert("No puedes modificar el admin principal."); renderAdminTable(); return; } const { error } = await supabaseClient.from("profiles").update({ plan:newPlan }).eq("id", userId); if(error){ showError("No se pudo actualizar el plan.", error); return; } await renderUsers(); }
async function approveAllPendingUsers(){ if(!currentUser || !isAdminUser(currentUser)) return; const pending = (cachedUsers || []).filter(u => u.status === "pending" && !(u.role === "admin" && u.access_code === "admin-nolo")); if(!pending.length){ alert("No hay estudiantes pendientes."); return; } if(!confirm(`¿Aprobar ${pending.length} estudiante(s) pendiente(s)?`)) return; const { error } = await supabaseClient.from("profiles").update({ status:"active" }).in("id", pending.map(u=>u.id)); if(error){ showError("No se pudieron aprobar todos.", error); return; } await renderUsers(); }

/* ===== OLON ADMIN CLEAN KING OVERRIDE ===== */
function adminRiskForUser(u){
  if(String(u.role||"").toLowerCase()==="admin") return {cls:"good", label:"Protegido"};
  if(u.status === "suspended") return {cls:"bad", label:"Suspendido"};
  if(u.status === "expired") return {cls:"bad", label:"Revisar"};
  if(u.status === "pending") return {cls:"warn", label:"Pendiente"};
  return {cls:"good", label:"Activo"};
}

async function renderUsers(){
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, email, full_name, access_code, password, role, plan, status, created_at")
    .order("created_at", { ascending:false });
  if(error){ showError("No se pudieron cargar los estudiantes.", error); return; }
  cachedUsers = data || [];
  updateAdminMetrics();
  renderAdminTable();
  renderAdminAlerts();
  renderAdminNoloUsage();
  updateAdminChatMetric();
}

function updateAdminMetrics(){
  const users = cachedUsers || [];
  const students = users.filter(u => String(u.role || "").toLowerCase() !== "admin");
  const active = students.filter(u => u.status === "active").length;
  const pending = students.filter(u => u.status === "pending").length;
  const suspended = students.filter(u => u.status === "suspended").length;
  const premium = students.filter(u => String(u.plan || "").toLowerCase().includes("premium")).length;
  adminAnimateMetric("adminTotalUsers", students.length);
  adminAnimateMetric("adminActiveUsers", active);
  adminAnimateMetric("adminPendingUsers", pending);
  adminAnimateMetric("adminSuspendedUsers", suspended);
  adminAnimateMetric("adminPremiumUsers", premium);
}

async function updateAdminChatMetric(){
  const el = document.getElementById("adminChatMetric");
  if(!el) return;
  try{
    const { data } = await supabaseClient
      .from("chat_messages")
      .select("id,sender_role,is_read")
      .eq("sender_role", "student")
      .eq("is_read", false);
    adminAnimateMetric("adminChatMetric", (data || []).length);
  }catch(e){ el.innerText = "0"; }
}

function renderAdminAlerts(){
  const box = document.getElementById("adminAlertList");
  if(!box) return;
  const students = (cachedUsers || []).filter(u => String(u.role || "").toLowerCase() !== "admin");
  const pending = students.filter(u => u.status === "pending");
  const suspended = students.filter(u => u.status === "suspended");
  const premium = students.filter(u => String(u.plan||"").toLowerCase().includes("premium"));
  const rows = [];
  if(pending.length) rows.push(`<div class="adminAlertItem warn"><span>⏳ <b>${pending.length}</b> cuenta(s) pendiente(s) de aprobación</span><button class="btn secondary miniBtn" onclick="filterAdminUsers('pending')">Ver</button></div>`);
  if(suspended.length) rows.push(`<div class="adminAlertItem bad"><span>🛑 <b>${suspended.length}</b> estudiante(s) suspendido(s)</span><button class="btn secondary miniBtn" onclick="filterAdminUsers('suspended')">Ver</button></div>`);
  rows.push(`<div class="adminAlertItem good"><span>💎 <b>${premium.length}</b> estudiante(s) Premium</span><button class="btn secondary miniBtn" onclick="filterAdminPlan('premium')">Ver</button></div>`);
  rows.push(`<div class="adminAlertItem good"><span>👑 Centro de mando limpio: sin módulo de pagos visible.</span></div>`);
  box.innerHTML = rows.join("");
}

function adminUserRowHTML(u){
  const isMainAdmin = u.role === "admin" && u.access_code === "admin-nolo";
  const initials = (u.full_name || "O").split(" ").map(x=>x[0]).join("").slice(0,2).toUpperCase();
  const risk = adminRiskForUser(u);
  const safeName = String(u.full_name || "").replace(/'/g, "\\'");
  const mentorText = isMainAdmin ? "Cuenta maestra" : (u.status === "active" ? "Seguimiento activo" : u.status === "pending" ? "Esperando aprobación" : "Revisar cuenta");
  const actions = isMainAdmin ? `<span class="badge blue">Protegido</span>` : `<div class="actionRow"><button class="btn success" onclick="updateUserStatus('${u.id}','active')">Aprobar</button><button class="btn warnBtn" onclick="updateUserStatus('${u.id}','suspended')">Suspender</button><button class="btn danger" onclick="deleteUser('${u.id}','${safeName}')">Borrar</button></div>`;
  return `<tr><td><div class="adminStudent"><div class="adminAvatar">${initials}</div><div><b>${escapeHTML(u.full_name || "Sin nombre")}</b><small>${escapeHTML(u.email || "Sin email")}</small></div></div></td><td><span class="codePill">${escapeHTML(u.access_code || "-")}</span></td><td><span class="codePill passPill">${escapeHTML(u.password || "-")}</span></td><td><select class="adminPlanSelect" onchange="updateUserPlan('${u.id}', this.value)" ${isMainAdmin ? 'disabled' : ''}><option value="VIP Regular" ${u.plan==='VIP Regular'?'selected':''}>VIP Regular</option><option value="VIP Premium" ${u.plan==='VIP Premium'?'selected':''}>VIP Premium</option><option value="Admin" ${u.plan==='Admin'?'selected':''}>Admin</option></select></td><td><select class="adminStatusSelect" onchange="updateUserStatus('${u.id}', this.value)" ${isMainAdmin ? 'disabled' : ''}><option value="pending" ${u.status==='pending'?'selected':''}>Pendiente</option><option value="active" ${u.status==='active'?'selected':''}>Activo</option><option value="suspended" ${u.status==='suspended'?'selected':''}>Suspendido</option><option value="expired" ${u.status==='expired'?'selected':''}>Revisar</option></select></td><td>${escapeHTML(mentorText)}</td><td><span class="adminRiskPill ${risk.cls}">${risk.label}</span></td><td>${actions}</td></tr>`;
}

function adminUserMobileHTML(u){
  const isMainAdmin = u.role === "admin" && u.access_code === "admin-nolo";
  const initials = (u.full_name || "O").split(" ").map(x=>x[0]).join("").slice(0,2).toUpperCase();
  const risk = adminRiskForUser(u);
  const safeName = String(u.full_name || "").replace(/'/g, "\\'");
  const mentorText = isMainAdmin ? "Cuenta maestra" : (u.status === "active" ? "Seguimiento activo" : u.status === "pending" ? "Esperando aprobación" : "Revisar cuenta");
  return `<div class="adminMobileCard"><div class="adminMobileTop"><div class="adminAvatar">${initials}</div><div><b>${escapeHTML(u.full_name || "Sin nombre")}</b><small>${escapeHTML(u.email || "Sin email")}</small></div></div><div class="adminMobileMeta"><span>Código <b>${escapeHTML(u.access_code || "-")}</b></span><span>Plan <b>${escapeHTML(u.plan || "-")}</b></span><span>Estado <b>${escapeHTML(u.status || "-")}</b></span><span>Mentoría <b>${escapeHTML(mentorText)}</b></span><span>Riesgo <b class="adminRiskPill ${risk.cls}">${risk.label}</b></span></div><div class="adminMobileActions">${isMainAdmin ? `<span class="badge blue">Protegido</span>` : `<button class="btn success" onclick="updateUserStatus('${u.id}','active')">Aprobar</button><button class="btn warnBtn" onclick="updateUserStatus('${u.id}','suspended')">Suspender</button><button class="btn danger" onclick="deleteUser('${u.id}','${safeName}')">Borrar</button>`}</div></div>`;
}

document.addEventListener("DOMContentLoaded", () => {
  const payment = document.getElementById("paymentDate");
  if(payment) payment.innerText = "Mentoría privada · Portal seguro";
});


/* =====================================================
   OLON DASHBOARD WAO JS
   Pega este JS AL FINAL de tu script.js
   ===================================================== */

function olonDashboardAnimateTextMoney(id){
  const el = document.getElementById(id);
  if(!el) return;

  const raw = String(el.innerText || "").replace(/[^0-9.-]/g,"");
  const target = Number(raw || 0);
  const isMoney = String(el.innerText || "").includes("$");
  const isPct = String(el.innerText || "").includes("%");

  let start = 0;
  const startTime = performance.now();
  const duration = 1000;

  function frame(now){
    const p = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = start + (target - start) * eased;

    if(isMoney){
      el.innerText = "$" + val.toLocaleString("en-US", {minimumFractionDigits:2, maximumFractionDigits:2});
    }else if(isPct){
      el.innerText = val.toFixed(2) + "%";
    }else{
      el.innerText = Math.round(val).toLocaleString("en-US");
    }

    if(p < 1) requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

function olonDashboardWaoRefresh(){
  [
    "mDeposited",
    "mNet",
    "mLoss",
    "mGrowth",
    "depositReturn",
    "maxDrawdown",
    "ytdWinrate",
    "traderScore"
  ].forEach(olonDashboardAnimateTextMoney);
}

document.addEventListener("DOMContentLoaded", function(){
  setTimeout(olonDashboardWaoRefresh, 1200);
});

/* Hook suave: si render() existe, lo envuelve para animar luego de renderizar */
setTimeout(function(){
  if(typeof window.render === "function" && !window.__olonDashboardWaoHooked){
    const oldRender = window.render;
    window.render = async function(){
      const result = await oldRender.apply(this, arguments);
      setTimeout(olonDashboardWaoRefresh, 250);
      return result;
    };
    window.__olonDashboardWaoHooked = true;
  }
}, 500);

