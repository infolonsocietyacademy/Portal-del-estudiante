/* OLFX CONNECT: native MT5 onboarding. MetaApi is NOT called. */
(() => {
"use strict";
const $=id=>document.getElementById(id);
const PAGE="metaapiAccountsPage";
const ENDPOINT="olon-own-connect";
const qs=s=>document.querySelector(s);
let busy=false, currentAccount=null, lastStatus=0;
const clean=s=>String(s??"").trim();
const b64=buf=>{const bytes=new Uint8Array(buf);let s="";for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);};
function notice(msg,type="info"){const box=$("metaapiFeedback");if(!box)return;box.hidden=false;box.textContent=msg;box.dataset.type=type;}
async function invoke(body){
 const client=window.supabaseClient;
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
  await status(true);
 }catch(e){notice(e.message,"error");}finally{
  if(passwordEl)passwordEl.value="";
  busy=false;if(btn)btn.disabled=false;
 }
}
async function unlink(){
 if(busy||!confirm("¿Desvincular esta cuenta de OLFX CONNECT? Tus operaciones históricas quedarán guardadas."))return;
 busy=true;
 try{await invoke({action:"disconnect"});render(null);window.olonMtRecords?.invalidate?.();notice("Cuenta desvinculada. El historial guardado permanece protegido.","success");}catch(e){notice(e.message,"error");}
 finally{busy=false;}
}
async function loadVault(){
 const target=$("mtVaultList"),message=$("mtVaultMessage"),client=window.supabaseClient;
 if(!target||!message||!client)return;
 target.replaceChildren();
 try{
  const {data:{user}}=await client.auth.getUser();if(!user)return;
  const {data,error}=await client.from("olon_mt_vault_accounts")
   .select("id,platform,broker_server,login_masked,last_connected_at,active_provider_account_id")
   .eq("student_id",user.id).order("last_connected_at",{ascending:false}).limit(30);
  if(error)throw error;
  message.textContent=(data||[]).length+" cuenta(s) con historial guardado.";
  for(const item of data||[]){
   const card=document.createElement("article");card.className="metaapi-vault-card";
   const title=document.createElement("strong");
   title.textContent=item.platform.toUpperCase()+" · "+item.broker_server+" · "+item.login_masked;
   const button=document.createElement("button");button.type="button";button.className="btn secondary";
   button.textContent="Ver historial";button.addEventListener("click",()=>window.olonMtRecords?.selectVault(item.id));
   card.append(title,button);target.append(card);
  }
 }catch{message.textContent="No se pudo consultar el historial de cuentas.";}
}
function selectPlatform(platform){
 $("metaapiPlatform").value=platform;
 document.querySelectorAll("[data-metaapi-platform]").forEach(btn=>{
  const selected=btn.dataset.metaapiPlatform===platform;
  btn.classList.toggle("selected",selected);btn.setAttribute("aria-pressed",String(selected));
 });
 const hint=$("metaapiServerHint");
 if(hint)hint.textContent=platform==="mt5"?"Escribe manualmente el servidor exacto que muestra tu cuenta MT5.":"Las cuentas MT4 todavía no se admiten en OLFX CONNECT V1.";
 if($("metaapiConnect"))$("metaapiConnect").disabled=platform!=="mt5";
}
async function adminStatus(){
 const el=$("olonOwnAdminStatus");if(!el)return;
 try{const data=await invoke({action:"admin-status"});
  const agent=data.agents?.find(x=>x.status==="paired");
  const active=(data.accounts||[]).filter(x=>x.status==="active").length;
  el.textContent=agent?("Equipo emparejado · última comunicación: "+(agent.last_seen_at?new Date(agent.last_seen_at).toLocaleString("es-PR"):"todavía no") +" · Cuentas sincronizadas: "+active):"Aún no hay equipo Windows emparejado.";
 }catch(e){el.textContent=e.message;}
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
 document.querySelectorAll("[data-metaapi-platform]").forEach(btn=>btn.addEventListener("click",()=>selectPlatform(btn.dataset.metaapiPlatform)));
 $("metaapiRefresh")?.addEventListener("click",()=>void status(true));
 $("metaapiDisconnect")?.addEventListener("click",()=>void unlink());
 $("metaapiCancelPending")?.addEventListener("click",()=>void unlink());
 $("mtVaultRefresh")?.addEventListener("click",()=>void loadVault());
 $("metaapiTogglePassword")?.addEventListener("click",()=>{
  const field=$("metaapiInvestorPassword");field.type=field.type==="password"?"text":"password";
  $("metaapiTogglePassword").textContent=field.type==="password"?"Mostrar":"Ocultar";
 });
 $("olonOwnAdminPair")?.addEventListener("click",()=>void adminPair());
 const observer=new MutationObserver(()=>{
  if(!$(PAGE)?.classList.contains("hidden")){void status();void loadVault();}
  if(!$("olonOwnAdminPage")?.classList.contains("hidden"))void adminStatus();
 });
 observer.observe($(PAGE),{attributes:true,attributeFilter:["class"]});
 const adminPage=$("olonOwnAdminPage");
 if(adminPage)observer.observe(adminPage,{attributes:true,attributeFilter:["class"]});
 window.addEventListener("pagehide",()=>{if($("metaapiInvestorPassword"))$("metaapiInvestorPassword").value="";});
 selectPlatform("mt5");
 if(!$("metaapiAccountsPage").classList.contains("hidden")){void status(true);void loadVault();}
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();