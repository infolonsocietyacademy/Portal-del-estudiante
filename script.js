const SUPABASE_URL = "https://bffojtcojnsvzxzwbdes.supabase.co";
const SUPABASE_KEY = "sb_publishable_1qXUiQ6gXpBsyVkWdvq-rA_GwbAotcT";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = JSON.parse(localStorage.getItem("olon_current_user") || "null");
let chart;
let cachedRecords = [];
let cachedUsers = [];

document.getElementById("date").valueAsDate = new Date();

function money(n){return "$" + Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}
function pct(n){return Number(n||0).toFixed(2) + "%"}
function showError(msg, error){ console.error(msg, error || ""); alert(msg + (error?.message ? "\n" + error.message : "")); }

function applyPlanStyle(plan){
  const cleanPlan = (plan || "VIP Regular").toLowerCase();
  document.body.classList.remove("plan-regular", "plan-premium");
  if(cleanPlan.includes("premium") || cleanPlan.includes("admin")){
    document.body.classList.add("plan-premium");
  }else{
    document.body.classList.add("plan-regular");
  }
}


function toggleAuth(mode){
  document.getElementById("tabLogin").classList.toggle("active", mode==="login");
  document.getElementById("tabSignup").classList.toggle("active", mode==="signup");
  document.getElementById("loginForm").classList.toggle("active", mode==="login");
  document.getElementById("signupForm").classList.toggle("active", mode==="signup");
}

async function login(){
  const code = document.getElementById("loginCode").value.trim();
  const pass = document.getElementById("loginPass").value.trim();
  if(!code || !pass){ alert("Escribe tu código y password."); return; }

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("access_code", code)
    .eq("password", pass)
    .single();

  if(error || !data){ showError("Código o password incorrecto.", error); return; }

  if(data.role !== "admin" && data.status !== "active"){
    const msg = data.status === "pending"
      ? "Tu cuenta está pendiente de aprobación por el admin."
      : "Tu cuenta no está activa. Contacta al admin.";
    alert(msg);
    return;
  }

  currentUser = data;
  localStorage.setItem("olon_current_user", JSON.stringify(currentUser));
  await enterPortal();
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
  const email = document.getElementById("signupEmail").value.trim();
  const pass = document.getElementById("signupPass").value.trim();
  const plan = document.getElementById("signupPlan").value || "VIP Regular";
  if(!name || !email || !pass){ alert("Llena nombre, email y password."); return; }

  const code = await createUniqueAccessCode();

  const { data, error } = await supabaseClient
    .from("profiles")
    .insert([{ full_name:name, email:email, access_code:code, password:pass, role:"student", plan:plan, status:"pending", next_payment_date:null }])
    .select()
    .single();

  if(error){ showError("No se pudo crear la cuenta.", error); return; }

  document.getElementById("generatedCodeText").innerText = code;
  document.getElementById("signupName").value = "";
  document.getElementById("signupEmail").value = "";
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
  applyPlanStyle(currentUser.plan);
  document.getElementById("studentName").innerText = currentUser.full_name;
  document.getElementById("avatarText").innerText = currentUser.full_name?.[0]?.toUpperCase() || "O";
  document.getElementById("userCodeText").innerText = "Código: " + currentUser.access_code;
  document.getElementById("planBadge").innerText = ((currentUser.plan || "VIP Regular").toLowerCase().includes("premium") || (currentUser.plan || "").toLowerCase().includes("admin")) ? "💎 VIP PREMIUM" : "🔥 VIP REGULAR";
  document.getElementById("accessStatus").innerText = (currentUser.plan || "VIP Regular") + " " + (currentUser.status === "active" ? "Activo" : currentUser.status);
  document.getElementById("paymentDate").innerText = ": " + (currentUser.next_payment_date || "No asignado");
  document.getElementById("auth").classList.add("hidden");
  document.getElementById("portal").classList.remove("hidden");

  const isAdmin = currentUser.role === "admin";
  document.getElementById("portalMode").innerText = isAdmin ? "Admin Portal" : "Student Portal";
  document.querySelectorAll(".studentNav").forEach(el => el.classList.toggle("hidden", isAdmin));
  document.querySelectorAll(".adminNav").forEach(el => el.classList.toggle("hidden", !isAdmin));

  showPageById(isAdmin ? "admin" : "dashboard");
  await render();
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
  if(!currentUser || currentUser.role === "admin") return [];
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
  if(!currentUser || currentUser.role === "admin") return;
  const rec = {
    student_id: currentUser.id,
    record_date: document.getElementById("date").value || new Date().toISOString().slice(0,10),
    deposit: Number(document.getElementById("deposit").value||0),
    gain: Number(document.getElementById("gain").value||0),
    loss: Number(document.getElementById("loss").value||0),
    note: document.getElementById("note").value.trim()
  };
  const { error } = await supabaseClient.from("student_records").insert([rec]);
  if(error){ showError("No se pudo guardar el registro.", error); return; }
  document.getElementById("deposit").value=""; document.getElementById("gain").value=""; document.getElementById("loss").value=""; document.getElementById("note").value="";
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

async function render(){
  if(!currentUser) return;
  if(currentUser.role === "admin"){ await renderUsers(); return; }
  await fetchRecords();
  const records = cachedRecords, t = totals(records);
  document.getElementById("mBalance").innerText = money(t.balance);
  document.getElementById("mProfit").innerText = money(t.gain);
  document.getElementById("mLoss").innerText = money(t.loss);
  document.getElementById("mGrowth").innerText = pct(t.growth);
  const body = document.getElementById("historyBody");
  body.innerHTML = records.slice().reverse().map(r=>{
    const net = Number(r.gain)-Number(r.loss);
    return `<tr><td>${r.date}</td><td>${money(r.deposit)}</td><td class="good">${money(r.gain)}</td><td class="bad">${money(r.loss)}</td><td><span class="badge ${net>=0?'green':'red'}">${money(net)}</span></td><td>${r.note || "-"}</td><td><button class="btn secondary" onclick="delRecord('${r.id}')">Eliminar</button></td></tr>`
  }).join("") || `<tr><td colspan="7" style="color:var(--muted)">No hay registros todavía.</td></tr>`;
  renderCompare(); renderChart();
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
  if(!currentUser || currentUser.role !== "admin") return;

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
  if(!currentUser || currentUser.role !== "admin") return;

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
  if(!currentUser || currentUser.role === "admin") return;
  if(confirm("¿Borrar todos tus registros?")){
    const { error } = await supabaseClient.from("student_records").delete().eq("student_id", currentUser.id);
    if(error){ showError("No se pudieron borrar los registros.", error); return; }
    cachedRecords = []; await render();
  }
}
if(currentUser){ enterPortal(); }

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