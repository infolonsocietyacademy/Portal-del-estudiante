/* OLFX / Myfxbook private admin pilot. No Myfxbook credentials in the browser. */
(()=>{"use strict";
const $=id=>document.getElementById(id);
const panel=$("olonMyfxbookAdminBlock");if(!panel)return;
let busy=false,loaded=false,accounts=[],students=[],links=[];
const admin=()=>typeof currentUser!=="undefined"&&!!currentUser&&
  String(currentUser.role||"").toLowerCase()==="admin"&&String(currentUser.status||"").toLowerCase()==="active";
const text=(id,t)=>{const e=$(id);if(e)e.textContent=String(t??"");};
const date=value=>{if(!value)return "Nunca";const d=new Date(value);return Number.isFinite(d.valueOf())?d.toLocaleString("es-PR",{timeZone:"America/Puerto_Rico"}):"Sin fecha"};
const money=n=>{const a=Number(n);return Number.isFinite(a)?new Intl.NumberFormat("es-PR",{style:"currency",currency:"USD"}).format(a):"—"};
function setBusy(x){
  busy=x;
  for(const id of ["olmyDiscover","olmyRefresh","olmyLink"])if($(id))$(id).disabled=busy;
}
async function call(action,payload={}){
  if(!admin())throw Error("Este módulo es exclusivo de administración.");
  if(typeof supabaseClient==="undefined")throw Error("No se pudo conectar con Supabase.");
  const {data,error}=await supabaseClient.functions.invoke("olon-myfxbook-trial",{body:{action,...payload}});
  if(error){
    let explanation=null;
    if(error.context&&typeof error.context.clone==="function"){
      try{explanation=(await error.context.clone().json())?.error}catch{}
    }
    throw Error(explanation||"No se pudo consultar el servidor de Myfxbook.");
  }
  if(data?.error)throw Error(data.error);
  return data||{};
}
function fillSelect(id,items,placeholder){
  const sel=$(id);if(!sel)return;
  const prev=sel.value;sel.replaceChildren(new Option(placeholder,""));
  for(const item of items)sel.add(new Option(item.label,String(item.value)));
  if(items.some(item=>String(item.value)===prev))sel.value=prev;
}
function drawLinks(){
  const node=$("olmyLinks");if(!node)return;
  node.replaceChildren();
  if(!links.length){const hint=document.createElement("p");hint.className="olmy-note";hint.textContent="Todavía no hay cuentas vinculadas en esta prueba.";node.append(hint);return;}
  const byId=new Map(students.map(s=>[s.id,s.full_name]));
  for(const link of links){
    const card=document.createElement("article");card.className="olmy-link";
    const name=document.createElement("strong");name.textContent=(byId.get(link.student_id)||"Estudiante")+" · "+link.account_name;
    const data=document.createElement("p");data.textContent=(link.broker_server||"Servidor no disponible")+" · "+(link.broker_account_masked||"Cuenta privada");
    const stats=document.createElement("p");stats.textContent="Balance: "+money(link.account_metrics?.balance)+" · Ganancia reportada: "+
      (link.account_metrics?.gain??"—")+"% · Drawdown: "+(link.account_metrics?.drawdown??"—")+"%";
    const status=document.createElement("small");status.textContent="Sincronizado: "+date(link.last_synced_at)+
      (link.last_error?" · Error de importación":"");
    const sync=document.createElement("button");sync.type="button";sync.className="btn secondary";sync.textContent="Sincronizar prueba";
    sync.addEventListener("click",()=>void perform("sync",{linkId:link.id}));
    card.append(name,data,stats,status,sync);node.append(card);
  }
}
async function status(){
  const result=await call("status");
  students=result.students||[];links=result.links||[];
  fillSelect("olmyStudent",students.map(s=>({value:s.id,label:s.full_name})),"Selecciona el estudiante autorizado");
  text("olmyStatus",result.configured?
    "Cuenta administradora configurada. Datos privados; no alimentan el TOP TRADER.":
    "Pendiente: configura MYFXBOOK_EMAIL y MYFXBOOK_PASSWORD en los Secrets de Supabase.");
  drawLinks();loaded=true;
}
async function perform(action,body={}){
  if(busy)return;
  setBusy(true);text("olmyStatus","Comprobando Myfxbook de forma segura…");
  try{
    if(action==="discover"){
      const data=await call("discover");
      accounts=data.accounts||[];
      fillSelect("olmyAccount",accounts.map(a=>({value:a.id,label:a.name+" · "+a.server+" · "+a.accountNumberMasked})),"Selecciona una cuenta detectada");
      text("olmyStatus",accounts.length+" cuentas disponibles. Selecciona una cuenta y su estudiante autorizado.");
    }else if(action==="link"){
      const studentId=$("olmyStudent")?.value,myfxbookId=Number($("olmyAccount")?.value);
      if(!studentId||!myfxbookId||!$("olmyConsent")?.checked)throw Error("Selecciona estudiante, cuenta y confirma la autorización.");
      await call("link",{studentId,myfxbookId,confirmedConsent:true});
      $("olmyConsent").checked=false;await status();text("olmyStatus","Cuenta vinculada para prueba privada. Ahora puedes sincronizar sus resultados.");
    }else if(action==="sync"){
      const data=await call("sync",body);
      await status();text("olmyStatus","Datos de prueba actualizados: "+data.days+" días importados. No afectan el ranking.");
    }else await status();
  }catch(e){text("olmyStatus",String(e?.message||e).slice(0,220));}
  finally{setBusy(false);}
}
function ensureVisibility(){
  const allowed=admin();
  panel.hidden=!allowed;
  const link=$("olonMyfxbookNav");if(link)link.hidden=!allowed;
  if(allowed&&!loaded)void perform("status");
  if(!allowed){loaded=false;accounts=[];students=[];links=[];}
}
$("olmyDiscover")?.addEventListener("click",()=>void perform("discover"));
$("olmyRefresh")?.addEventListener("click",()=>void perform("status"));
$("olmyLink")?.addEventListener("click",()=>void perform("link"));
ensureVisibility();
const portal=$("portal");
if(portal)new MutationObserver(ensureVisibility).observe(portal,{attributes:true,attributeFilter:["class"]});
document.addEventListener("visibilitychange",()=>{if(!document.hidden)ensureVisibility();});
setInterval(()=>{if(!document.hidden)ensureVisibility();},60000);
})();