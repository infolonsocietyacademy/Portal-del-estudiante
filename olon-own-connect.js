/* OLFX CONNECT: native MT5 onboarding. MetaApi is NOT called. */
(() => {
"use strict";
const $=id=>document.getElementById(id);
const PAGE="metaapiAccountsPage";
const ENDPOINT="olon-own-connect";
const qs=s=>document.querySelector(s);
let busy=false, currentAccount=null, lastStatus=0, agentReady=false;
const clean=s=>String(s??"").trim();
const b64=buf=>{const bytes=new Uint8Array(buf);let s="";for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);};
function notice(msg,type="info"){const box=$("metaapiFeedback");if(!box)return;box.hidden=false;box.textContent=msg;box.dataset.type=type;}
async function invoke(body){
 const client=typeof supabaseClient!=="undefined"?supabaseClient:null;
 if(!client)throw Error("Inicia sesión en el portal.");
 const {data,error}=await client.functions.invoke(ENDPOINT,{body});
 if(error){
  let detail=data?.error;
  if(!detail&&error.context?.clone){try{detail=(await error.context.clone().json())?.error;}catch{}}
  throw Error(detail||"No se pudo comunicar con OLFX CONNECT.");
 }
 if(data?.error)throw Error(data.error);
 return data;
}
async function securePayload(pem,payload){
 if(!window.crypto?.subtle)throw Error("Para conectar la cuenta necesitas HTTPS.");
 const stripped=pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g,"");
 const binary=atob(stripped);
 const raw=Uint8Array.from(binary,c=>c.charCodeAt(0));
 const pub=await crypto.subtle.importKey("spki",raw,{name:"RSA-OAEP",hash:"SHA-256"},false,["wrapKey"]);
 const aes=await crypto.subtle.generateKey({name:"AES-GCM",length:256},true,["encrypt"]);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},aes,new TextEncoder().encode(JSON.stringify(payload)));
 const wrapped=await crypto.subtle.wrapKey("raw",aes,pub,{name:"RSA-OAEP"});
 return {wrappedKey:b64(wrapped),iv:b64(iv),ciphertext:b64(cipher)};
}

async function readiness(){
 const el=$("olonOwnStudentReadiness");
 if(!el)return;
 try{
  const result=await invoke({action:"agent-ready"});
  agentReady=!!result.publicKeyPem;
  el.textContent=agentReady
   ?"OLFX CONNECT preparado para registrar cuentas MT5. La sincronización se hará cuando el equipo Windows ejecute el agente."
   :"OLFX CONNECT todavía no está configurado por administración.";
 }catch(e){
  agentReady=false;
  el.textContent="Conexión en preparación: falta emparejar una computadora Windows. No introduzcas la contraseña de inversor todavía.";
 }
 const btn=$("metaapiConnect");
 if(btn)btn.disabled=!agentReady||clean($("metaapiPlatform")?.value)!=="mt5";
}

function render(account){
 currentAccount=account||null;
 const form=$("metaapiConnectForm"), area=$("metaapiConnected"), badge=$("metaapiConnectionBadge");
 if(!form||!area||!badge)return;
 const active=account?.status==="active";
 const waiting=account?.status==="waiting";
 form.hidden=!!account;
 area.hidden=!account;
 badge.dataset.status=active?"on":waiting?"wait":"off";
 badge.textContent=active?"Cuenta sincronizada":account?(waiting?"Esperando computadora":"Requiere atención"):"Sin vincular";
 if(!account)return;
 $("metaapiAccountPlatform").textContent=(account.platform||"mt5").toUpperCase();
 $("metaapiAccountBroker").textContent=account.broker_server||"—";
 $("metaapiAccountLogin").textContent=account.login_masked||"••••";
 $("metaapiAccountState").textContent=active?"Activa":waiting?"Pendiente de sincronización":"Revisar conexión";
 $("metaapiConnectedTitle").textContent=active?"Tu cuenta está sincronizada":"OLFX CONNECT está preparando tu cuenta";
 $("metaapiConnectedSubtitle").textContent=active?"Estadísticas disponibles en tu Portal del Trader.":"La computadora de la academia verificará tu cuenta MT5 cuando ejecute OLFX CONNECT.";
 $("metaapiConnectedIcon").textContent=active?"✓":"2";
 $("metaapiConnectedNext").hidden=false;
 $("metaapiConnectedNext").textContent=account.last_error?("Estado: "+account.last_error):(active?"Última actualización: "+(account.last_sync_at?new Date(account.last_sync_at).toLocaleString("es-PR"):"pendiente"):"Esperando que el administrador encienda la computadora y ejecute la sincronización.");
 $("metaapiDisconnect").textContent="Desvincular cuenta OLFX";
}
async function status(force=false){
 if(busy||(!force&&Date.now()-lastStatus<15000))return;
 lastStatus=Date.now();
 try{const result=await invoke({action:"status"});render(result.account);}catch(err){notice(err.message,"error");}
}
async function connect(){
 if(busy)return;
 const platform=clean($("metaapiPlatform")?.value).toLowerCase();
 const server=clean($("metaapiServer")?.value);
 const login=clean($("metaapiLogin")?.value);
 const passwordEl=$("metaapiInvestorPassword");
 const password=passwordEl?.value||"";
 if(platform!=="mt5")return notice("OLFX CONNECT V1 funciona con MT5. No conectes cuentas MT4 aquí: se integrarán en otra fase.","error");
 if(!agentReady)return notice("Primero hay que emparejar el equipo Windows desde administración. No es necesario comprar una VPS para hacerlo.","error");
 if(!/^[a-zA-Z0-9_. /+\-]{2,120}$/.test(server))return notice("Escribe el nombre exacto del servidor de Axi.","error");
 if(!/^[0-9]{4,20}$/.test(login))return notice("Escribe un número de cuenta válido.","error");
 if(!password||password.length>256||!$("metaapiInvestorConfirm")?.checked)return notice("Necesitas la contraseña de inversor de solo lectura y confirmar su uso.","error");
 busy=true;
 const btn=$("metaapiConnect");if(btn)btn.disabled=true;
 try{
  const ready=await invoke({action:"agent-ready"});
  const encryptedPayload=await securePayload(ready.publicKeyPem,{login,investorPassword:password,platform:"mt5",brokerServer:server});
  if(passwordEl)passwordEl.value="";
  await invoke({action:"connect",platform:"mt5",brokerServer:server,login,encryptedPayload});
  notice("Cuenta registrada en OLFX CONNECT, sin MetaApi. Se comprobará al iniciar el programa de Windows.","success");
  window.olonMtRecords?.invalidate?.();
  await window.render?.();
  const result=await invoke({action:"status"});render(result.account);
 }catch(e){notice(e.message,"error");}finally{
  if(passwordEl)passwordEl.value="";
  busy=false;if(btn)btn.disabled=false;
 }
}
async function unlink(){
 if(busy||!confirm("¿Desvincular esta cuenta de OLFX CONNECT? Tus operaciones históricas quedarán guardadas."))return;
 busy=true;
 try{
    await invoke({action:"disconnect"});
    render(null);
    window.olonMtRecords?.invalidate?.();
    await window.render?.();
    notice("Cuenta desvinculada. Resumen se ha limpiado y el historial archivado permanece protegido.","success");
  }catch(e){notice(e.message,"error");}
 finally{busy=false;}
}

let vaultPreviewRequest=0, vaultPreviewItems=[];
async function showVaultPreview(item,page=0){
 const client=typeof supabaseClient!=="undefined"?supabaseClient:null,host=$("mtVaultSection");
 if(!client||!host)return;
 const seq=++vaultPreviewRequest;
 let panel=$("mtVaultPreview");
 if(!panel){panel=document.createElement("section");panel.id="mtVaultPreview";panel.className="metaapi-panel";host.append(panel);}
 panel.replaceChildren();panel.hidden=false;
 const h=document.createElement("h4");h.textContent="Historial archivado · "+item.platform.toUpperCase()+" · "+item.login_masked;
 const status=document.createElement("p");status.className="metaapi-muted";status.textContent="Cargando historial (no afecta Resumen)…";
 const close=document.createElement("button");close.type="button";close.className="btn secondary";close.textContent="Cerrar";
 close.addEventListener("click",()=>{vaultPreviewRequest++;panel.replaceChildren();panel.hidden=true;});
 panel.append(h,status,close);
 try{
  const size=50;
  const {data,count,error}=await client.from("olon_mt_deals")
    .select("occurred_at,symbol,deal_type,profit,commission,swap,fee",{count:"exact"})
    .eq("vault_account_id",item.id).order("occurred_at",{ascending:false}).range(page*size,(page+1)*size-1);
  if(seq!==vaultPreviewRequest)return;
  if(error)throw error;
  const total=count??(data||[]).length;
  status.textContent="Archivo de solo lectura · "+total+" movimientos · página "+(page+1);
  const list=document.createElement("div");list.style.overflowX="auto";
  const table=document.createElement("table");table.style.width="100%";
  const head=document.createElement("tr");
  for(const name of ["Fecha PR","Símbolo","Tipo","Importe neto"]){const th=document.createElement("th");th.textContent=name;th.style.textAlign="left";th.style.padding="8px";head.append(th);}
  table.append(head);
  const money=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"});
  for(const d of data||[]){
   const tr=document.createElement("tr");
   const net=Number(d.profit||0)+Number(d.commission||0)+Number(d.swap||0)+Number(d.fee||0);
   const date=new Date(d.occurred_at).toLocaleString("es-PR",{timeZone:"America/Puerto_Rico"});
   for(const value of [date,String(d.symbol||"—"),String(d.deal_type||"—").replace("DEAL_TYPE_",""),money.format(net)]){
    const td=document.createElement("td");td.textContent=value;td.style.padding="8px";tr.append(td);
   }table.append(tr);
  }
  list.append(table);panel.append(list);
  const nav=document.createElement("div");nav.className="metaapi-actions";
  const add=(label,num)=>{const btn=document.createElement("button");btn.type="button";btn.className="btn secondary";btn.textContent=label;btn.addEventListener("click",()=>void showVaultPreview(item,num));nav.append(btn);};
  if(page>0)add("Anterior",page-1);
  if((page+1)*size<total)add("Siguiente",page+1);
  panel.append(nav);
 }catch{if(seq===vaultPreviewRequest)status.textContent="No se pudo consultar el historial guardado.";}
}
window.olonOwnVaultOpen=id=>{const item=vaultPreviewItems.find(x=>x.id===id);if(item)void showVaultPreview(item,0);};

async function loadVault(){
 const target=$("mtVaultList"),message=$("mtVaultMessage"),client=typeof supabaseClient!=="undefined"?supabaseClient:null;
 if(!target||!message||!client)return;
 vaultPreviewRequest++;vaultPreviewItems=[];const old=$("mtVaultPreview");if(old){old.hidden=true;old.replaceChildren();}
 target.replaceChildren();
 try{
  const {data:{user}}=await client.auth.getUser();if(!user)return;
  const {data,error}=await client.from("olon_mt_vault_accounts")
   .select("id,platform,broker_server,login_masked,last_connected_at,active_provider_account_id")
   .eq("student_id",user.id).order("last_connected_at",{ascending:false}).limit(30);
  if(error)throw error;
  vaultPreviewItems=data||[];
  message.textContent=(data||[]).length+" cuenta(s) con historial guardado. Estas operaciones no se incluyen en Resumen sin conexión activa.";
  for(const item of data||[]){
   const card=document.createElement("article");card.className="metaapi-vault-card";
   const title=document.createElement("strong");
   title.textContent=item.platform.toUpperCase()+" · "+item.broker_server+" · "+item.login_masked;
   const button=document.createElement("button");button.type="button";button.className="btn secondary";
   button.textContent="Ver historial guardado";button.addEventListener("click",()=>void showVaultPreview(item,0));
   card.append(title,button);target.append(card);
  }
 }catch{message.textContent="No se pudo consultar el historial de cuentas.";}
}
function selectPlatform(platform){
 // MT4 is not released: reject attempts from scripts, obsolete clicks or stale UI.
 if(platform!=="mt5")return;
 $("metaapiPlatform").value="mt5";
 document.querySelectorAll("[data-metaapi-platform]").forEach(btn=>{
  const selected=btn.dataset.metaapiPlatform===platform;
  btn.classList.toggle("selected",selected);btn.setAttribute("aria-pressed",String(selected));
 });
 const hint=$("metaapiServerHint");
 if(hint)hint.textContent=platform==="mt5"?"Escribe manualmente el servidor exacto que muestra tu cuenta MT5.":"Las cuentas MT4 todavía no se admiten en OLFX CONNECT V1.";
 if($("metaapiConnect"))$("metaapiConnect").disabled=platform!=="mt5"||!agentReady;
}
async function adminStatus(){
 const el=$("olonOwnAdminStatus");if(!el)return;
 try{const data=await invoke({action:"admin-status"});
  const agent=data.agents?.find(x=>x.status==="paired");
  const accounts=data.accounts||[];
  const active=accounts.filter(x=>x.status==="active").length;
  const waiting=accounts.filter(x=>x.status==="waiting").length;
  const errors=accounts.filter(x=>x.status==="error").length;
  const counters=$("olonOwnAdminCounters");
  if(counters)counters.textContent="Cuentas sincronizadas: "+active+" · pendientes: "+waiting+" · con error: "+errors;
  el.textContent=agent?("Equipo emparejado · última comunicación: "+(agent.last_seen_at?new Date(agent.last_seen_at).toLocaleString("es-PR"):"sin comunicación todavía")):"Equipo sin emparejar. Puedes realizar la prueba local sin VPS.";
 }catch(e){el.textContent=e.message;}
}
async function adminRotateToken(){
 const out=$("olonOwnAdminToken"),btn=$("olonOwnAdminRotate"),pem=clean($("olonOwnAdminKey")?.value);
 const hint=$("olonOwnAdminPairHint");
 if(!out||!btn||!hint)return;
 if(!pem.includes("-----BEGIN PUBLIC KEY-----")||!pem.includes("-----END PUBLIC KEY-----")){
  hint.textContent="Para recuperar acceso pega la clave PUBLICA de tu equipo ya emparejado.";
  return;
 }
 if(!confirm("Renovar el token anterior? El token viejo dejara de funcionar; las cuentas y claves locales se conservaran."))return;
 btn.disabled=true;
 try{
  const result=await invoke({action:"admin-rotate-token",publicKeyPem:pem});
  if(!result.agentToken)throw Error("El servidor no devolvio token.");
  out.hidden=false;out.value=result.agentToken;
  $("olonOwnAdminKey").value="";
  hint.textContent="Token renovado. Copialo AHORA a la computadora Windows. Solo aparece una vez.";
  await adminStatus();
 }catch(e){hint.textContent=e.message;}finally{btn.disabled=false;}
}
async function adminPair(){
 const out=$("olonOwnAdminToken"),btn=$("olonOwnAdminPair"),pem=clean($("olonOwnAdminKey")?.value);
 if(!out||!btn)return;
 btn.disabled=true;
 try{
  const result=await invoke({action:"admin-pair",publicKeyPem:pem});
  out.hidden=false;out.value=result.agentToken;
  $("olonOwnAdminKey").value="";
  $("olonOwnAdminPairHint").textContent="Copia el token ahora: por seguridad solo se muestra una vez. Pégalo en la configuración del programa Windows.";
  await adminStatus();
 }catch(e){$("olonOwnAdminPairHint").textContent=e.message;}finally{btn.disabled=false;}
}
function init(){
 const form=$("metaapiConnectForm");if(!form||form.dataset.olfxNativeInit)return;
 form.dataset.olfxNativeInit="1";
 const find=$("metaapiFindServers"),choices=$("metaapiServerChoices"),manual=$("metaapiServerManualWrap");
 if(find)find.hidden=true;
 if(choices){choices.disabled=true;choices.required=false;choices.hidden=true;}
 if(manual)manual.hidden=false;
 if($("metaapiServer"))$("metaapiServer").required=true;
 form.addEventListener("submit",e=>{e.preventDefault();void connect();});
 document.querySelectorAll("[data-metaapi-platform]").forEach(btn=>{if(btn.dataset.metaapiPlatform==="mt4"){btn.disabled=true;btn.setAttribute("aria-disabled","true");return;}btn.addEventListener("click",()=>selectPlatform(btn.dataset.metaapiPlatform));});
 $("metaapiPlatform")?.addEventListener("change",()=>selectPlatform("mt5"));
 $("metaapiRefresh")?.addEventListener("click",()=>void status(true));
 $("metaapiDisconnect")?.addEventListener("click",()=>void unlink());
 $("metaapiCancelPending")?.addEventListener("click",()=>void unlink());
 $("mtVaultRefresh")?.addEventListener("click",()=>void loadVault());
 $("metaapiTogglePassword")?.addEventListener("click",()=>{
  const field=$("metaapiInvestorPassword");field.type=field.type==="password"?"text":"password";
  $("metaapiTogglePassword").textContent=field.type==="password"?"Mostrar":"Ocultar";
 });
 $("olonOwnAdminPair")?.addEventListener("click",()=>void adminPair());
 $("olonOwnAdminRotate")?.addEventListener("click",()=>void adminRotateToken());
 $("olonOwnAdminRefresh")?.addEventListener("click",()=>void adminStatus());
 const observer=new MutationObserver(()=>{
  if(!$(PAGE)?.classList.contains("hidden")){void status();void loadVault();void readiness();}
  if(!$("olonOwnAdminPage")?.classList.contains("hidden"))void adminStatus();
 });
 observer.observe($(PAGE),{attributes:true,attributeFilter:["class"]});
 const adminPage=$("olonOwnAdminPage");
 if(adminPage)observer.observe(adminPage,{attributes:true,attributeFilter:["class"]});
 window.addEventListener("pagehide",()=>{if($("metaapiInvestorPassword"))$("metaapiInvestorPassword").value="";});
 selectPlatform("mt5");
 if(!$("metaapiAccountsPage").classList.contains("hidden")){void status(true);void loadVault();void readiness();}
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();