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
 if(!client)throw Error("No se encontró la sesión del Portal del Trader. Inicia sesión otra vez.");
 const {data:sessionData,error:sessionErr}=await client.auth.getSession();
 if(sessionErr||!sessionData?.session?.access_token)throw Error("Tu sesión del portal expiró. Cierra sesión y vuelve a entrar antes de conectar MT5.");
 let session=sessionData.session;
 async function request(){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),22000);
  try{
   return await client.functions.invoke(ENDPOINT,{body,headers:{Authorization:"Bearer "+session.access_token},signal:controller.signal});
  }finally{clearTimeout(timer);}
 }
 let data,error;
 try{
  ({data,error}=await request());
  const code=error?.context?.status;
  if(error&&(code===401||code===403)){
   const refreshed=await client.auth.refreshSession();
   if(refreshed.error||!refreshed.data?.session?.access_token)throw Error("Tu sesión expiró. Sal del Portal del Trader y entra de nuevo.");
   session=refreshed.data.session;
   ({data,error}=await request());
  }
 }catch(e){
  if(e?.name==="AbortError")throw Error("El servidor tardó demasiado. Revisa tu conexión y presiona Actualizar estadísticas antes de intentar nuevamente.");
  throw e;
 }
 if(error){
  let detail=data?.error;
  if(!detail&&error.context?.clone){try{detail=(await error.context.clone().json())?.error;}catch{}}
  if(error.context?.status===401)throw Error("La sesión del portal no está autorizada. Cierra sesión y vuelve a entrar con tu cuenta de estudiante.");
  throw Error(detail||"OLFX CONNECT no pudo completar la solicitud. "+(error.message||"").slice(0,120));
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
 const retry=$("metaapiRetryConnection");
 if(!el)return false;
 try{
  const result=await invoke({action:"agent-ready"});
  agentReady=!!result.publicKeyPem;
  el.textContent=agentReady
   ?"Conexión segura OLFX disponible. Puedes vincular tu propia cuenta MT5."
   :"OLFX CONNECT no tiene equipo emparejado todavía.";
 }catch(e){
  agentReady=false;
  el.textContent="No se pudo comprobar OLFX: "+e.message;
 }
 if(retry)retry.hidden=agentReady;
 const btn=$("metaapiConnect");
 if(btn&&!busy){btn.disabled=clean($("metaapiPlatform")?.value)!=="mt5";btn.removeAttribute("aria-busy");}
 return agentReady;
}

let currentAccounts=[], addingAccount=false;
function money(value,currency="USD"){
 if(value==null)return "—";
 const amount=Number(value);if(!Number.isFinite(amount))return "—";
 return new Intl.NumberFormat("es-PR",{style:"currency",currency:currency==="USD"?"USD":"USD",maximumFractionDigits:2}).format(amount)+(currency!=="USD"?" "+currency:"");
}
function txt(tag,content,className){
 const el=document.createElement(tag);el.textContent=String(content??"");if(className)el.className=className;return el;
}
function metric(name,value){
 const cell=document.createElement("div");cell.className="olfxAccountMetric";
 cell.append(txt("span",name),txt("strong",value));return cell;
}
let currentDealsRequest=0;
function accountDate(value){
 if(!value)return "Sin sincronizar";
 const d=new Date(value);
 return Number.isFinite(d.getTime())?d.toLocaleString("es-PR",{timeZone:"America/Puerto_Rico"}):"Sin sincronizar";
}
function accountValue(value,active,unit="money",currency="USD"){
 if(!active)return "—";
 if(unit==="money")return money(value,currency);
 if(unit==="pct")return value==null?"—":Number(value).toFixed(2)+"%";
 return String(value??"—");
}
function renderAccounts(accounts){
 currentAccounts=Array.isArray(accounts)?accounts:[];
 currentAccount=currentAccounts.find(a=>a.is_primary)||currentAccounts[0]||null;
 const host=$("metaapiAccountsList"),form=$("metaapiConnectForm"),legacy=$("metaapiConnected");
 const add=$("metaapiAddAccount"),badge=$("metaapiConnectionBadge"),steps=qs("#metaapiAccountsPage .metaapi-steps");
 if(!host||!form||!legacy||!badge)return;
 currentDealsRequest++;
 host.replaceChildren();
 legacy.hidden=true;
 const hasAccounts=currentAccounts.length>0;
 form.hidden=hasAccounts&&!addingAccount;
 if(steps)steps.hidden=form.hidden;
 if(add){add.hidden=!hasAccounts;add.textContent=addingAccount?"Cancelar nueva conexión":"+ Conectar otra cuenta MT5";}
 const active=currentAccounts.filter(a=>a.status==="active").length;
 const pending=currentAccounts.filter(a=>a.status==="waiting").length;
 badge.dataset.status=active?"on":pending?"wait":"off";
 badge.textContent=!hasAccounts?"Sin vincular":active+" sincronizada(s) de "+currentAccounts.length;
 if(!hasAccounts){
  const callout=document.createElement("div");callout.className="olfxConnectFirst";
  callout.append(txt("strong","Conecta tu propia cuenta MetaTrader 5"));
  callout.append(txt("p","No hay una cuenta predefinida. Escribe el servidor, número de cuenta y contraseña de inversor. La información y las estadísticas aparecerán cuando Windows sincronice el historial.","metaapi-muted"));
  host.append(callout);
  return;
 }
 host.append(txt("h4","Mis cuentas de MetaTrader · "+currentAccounts.length,"olfxAccountListTitle"));
 for(const account of currentAccounts){
  const card=document.createElement("article");card.className="olfxAccountCard";
  if(account.is_primary)card.classList.add("olfxAccountPrimary");
  const heading=document.createElement("div");heading.className="olfxAccountHeader";
  const name=document.createElement("div");
  name.append(txt("strong","MT5 · "+account.login_masked));
  name.append(txt("small",account.broker_server,"metaapi-muted"));
  const ready=Boolean(account.last_sync_at)&&account.status!=="revoked";
  const state=txt("span",ready?(account.last_error?"Vinculada · última actualización falló":account.status==="waiting"?"Vinculada · actualizando a solicitud":"Datos sincronizados · actualización manual"):account.status==="waiting"?"Actualización solicitada · esperando VPS":account.status==="registered"?"Cuenta registrada · pulsa Actualizar estadísticas":account.status==="error"?"Revisar acceso de inversor":"Esperando solicitud","olfxAccountState");
  state.dataset.status=account.status;
  heading.append(name,state);card.append(heading);
  if(account.is_primary)card.append(txt("p","★ Esta cuenta alimenta tu Resumen, calendario y resultados","olfxPrimaryCaption"));
  if(account.last_error)card.append(txt("p",(ready?"Aviso de actualización: ":"Error de conexión: ")+account.last_error+" La cuenta sigue registrada.","olfxAccountError"));
  if(!ready){
   card.append(txt("p","La cuenta se conserva guardada. Pulsa «Actualizar estadísticas» para solicitar una sincronización MT5 desde la VPS. Hasta entonces no se consultan nuevos movimientos.","metaapi-muted"));
  }
  const grid=document.createElement("div");grid.className="olfxAccountMetrics";
  grid.append(
   metric("Balance actual",accountValue(account.balance,ready,"money",account.currency)),
   metric("Equity actual",accountValue(account.equity,ready,"money",account.currency)),
   metric("WinRate",accountValue(account.win_rate,ready,"pct")),
   metric("Movimientos totales (historial completo)",accountValue(account.total_deals,ready,"count")),
   metric("Operaciones cerradas",accountValue(account.closed_trades,ready,"count")),
   metric("Ganancia de hoy",accountValue(account.today_net,ready,"money",account.currency)),
   metric("Resultado semanal",accountValue(account.week_net,ready,"money",account.currency)),
   metric("Resultado mensual",accountValue(account.month_net,ready,"money",account.currency)),
   metric("P&L histórico importado",accountValue(account.net_profit,ready,"money",account.currency)),
   metric("Profit factor",ready&&account.profit_factor!=null?String(account.profit_factor):"—"),
   metric("Operaciones ganadoras",accountValue(account.wins,ready,"count")),
   metric("Operaciones perdedoras",accountValue(account.losses,ready,"count")),
   metric("Empates / breakeven",accountValue(account.breakeven_trades,ready,"count")),
   metric("Depósitos externos históricos (DEP)",accountValue(account.deposits,ready,"money",account.currency)),
   metric("Retiros externos históricos",accountValue(account.withdrawals,ready,"money",account.currency)),
   metric("Transferencias recibidas",accountValue(account.transfer_in,ready,"money",account.currency)),
   metric("Transferencias enviadas",accountValue(account.transfer_out,ready,"money",account.currency)),
   metric("Otros ajustes de balance",accountValue(account.balance_adjustments,ready,"money",account.currency)),
   metric("Comisiones, swaps y tasas",accountValue(account.fees,ready,"money",account.currency))
  );card.append(grid);
  card.append(txt("p",ready?"Última actualización: "+accountDate(account.last_sync_at)+(account.backfill_done?" · Historial importado":" · Importación en curso"):"Sin datos sincronizados todavía","olfxAccountSync"));
  if(ready){
   const recent=document.createElement("details");recent.className="olfxRecentDeals";
   const summary=txt("summary","Ver TODOS mis movimientos MT5 (historial completo)");recent.append(summary);
   const detail=txt("p","Historial completo en páginas de 50 movimientos, incluyendo depósitos y retiros.","metaapi-muted");
   recent.append(detail);
   let loaded=false;
   recent.addEventListener("toggle",()=>{
    if(recent.open&&!loaded){loaded=true;void loadRecentDeals(account.id,recent,detail);}
   });
   card.append(recent);
  }
  const actions=document.createElement("div");actions.className="metaapi-actions olfxAccountActions";
  const primary=txt("button",account.is_primary?"Cuenta principal":"Mostrar en Resumen","btn "+(account.is_primary?"secondary":"metaapi-primary"));
  primary.type="button";primary.disabled=account.is_primary;
  primary.addEventListener("click",()=>void changePrimary(account.id,primary));
  const remove=txt("button","Desconectar cuenta","btn secondary");
  remove.type="button";remove.addEventListener("click",()=>void unlink(account.id));
  const retry=txt("button","Reintentar sincronización","btn secondary");retry.type="button";retry.addEventListener("click",()=>void retrySync(account.id,retry));
  const access=txt("button","Actualizar acceso de inversor","btn secondary");access.type="button";access.addEventListener("click",()=>showAccessUpdate(account,card));
  actions.append(primary,retry,access,remove);card.append(actions);host.append(card);
 }
}
async function loadRecentDeals(accountId,container,label,page=0){
 const seq=currentDealsRequest;
 const old=container.querySelector(".olfxRecentTableWrap");
 if(old)old.remove();
 label.textContent="Cargando el historial completo de MetaTrader…";
 try{
  const result=await invoke({action:"recent-deals",accountId,page});
  if(seq!==currentDealsRequest||!container.isConnected)return;
  const deals=result.deals||[];
  const total=Number(result.total||0),size=Number(result.pageSize||50);
  if(!deals.length){label.textContent="No hay más movimientos guardados para esta cuenta.";return;}
  label.textContent="Movimientos "+(page*size+1)+"–"+(page*size+deals.length)+" de "+total.toLocaleString("es-PR")+" · historial completo de esta cuenta";
  const wrapper=document.createElement("div");wrapper.className="olfxRecentTableWrap";
  const table=document.createElement("table");table.className="olfxRecentTable";
  const header=document.createElement("tr");
  ["Fecha PR","Tipo","Símbolo","Volumen","Resultado neto"].forEach(c=>header.append(txt("th",c)));
  const thead=document.createElement("thead");thead.append(header);table.append(thead);
  const tbody=document.createElement("tbody");
  deals.forEach(d=>{
   const tr=document.createElement("tr");
   const net=Number(d.profit||0)+Number(d.commission||0)+Number(d.swap||0)+Number(d.fee||0);
   const type=String(d.deal_type||"").replace("DEAL_TYPE_","");
   const entry=String(d.entry_type||"").replace("DEAL_ENTRY_","");
   const date=new Date(d.occurred_at);
   [Number.isFinite(date.getTime())?accountDate(d.occurred_at):"—",type+(entry?" / "+entry:""),d.symbol||"—",String(d.volume??"—"),money(net)].forEach(v=>tr.append(txt("td",v)));
   if(net<0)tr.classList.add("olfxLoss");
   tbody.append(tr);
  });
  table.append(tbody);wrapper.append(table);
  const nav=document.createElement("div");nav.className="metaapi-actions olfxAccountActions";
  const prev=txt("button","← Anterior","btn secondary"),next=txt("button","Siguiente →","btn secondary");
  prev.type="button";next.type="button";prev.disabled=page<=0;next.disabled=(page+1)*size>=total;
  prev.addEventListener("click",()=>void loadRecentDeals(accountId,container,label,page-1));
  next.addEventListener("click",()=>void loadRecentDeals(accountId,container,label,page+1));
  nav.append(prev,txt("span","Página "+(page+1)+" de "+Math.ceil(total/size)),next);
  wrapper.append(nav);container.append(wrapper);
 }catch(e){if(seq===currentDealsRequest&&label.isConnected)label.textContent="No se pudo cargar el historial: "+e.message;}
}
let statusInFlight=false;
async function status(force=false){
 if(busy||statusInFlight||(!force&&Date.now()-lastStatus<12000))return;
 lastStatus=Date.now();
 statusInFlight=true;
 try{
  const result=await invoke({action:"status"});
  const previous=currentAccounts.map(a=>({id:a.id,status:a.status,last_sync_at:a.last_sync_at}));
  const next=result.accounts|| (result.account?[result.account]:[]);
  const newlySynced=next.some(a=>a.status==="active"&&a.last_sync_at
   &&!previous.some(p=>p.id===a.id&&p.last_sync_at===a.last_sync_at));
  // Keep expanded trade history and avoid rebuilding 15 statistic cards if nothing changed.
  const changed=JSON.stringify(next)!==JSON.stringify(currentAccounts);
  if(changed)renderAccounts(next);
  if(newlySynced){
   window.olonMtRecords?.invalidate?.();
   // Mantener al estudiante en la página de conexión. El Resumen se actualiza por su propio lector.
   notice("OLFX CONNECT: los datos MT5 ya llegaron. Balance, operaciones y rendimiento actualizados.","success");
  }
 }catch(err){notice(err.message,"error");}
 finally{statusInFlight=false;}
}
async function changePrimary(id,button){
 if(busy)return;
 busy=true;if(button)button.disabled=true;
 try{
  await invoke({action:"select-primary",accountId:id});
  const result=await invoke({action:"status"});
  renderAccounts(result.accounts||[]);
  window.olonMtRecords?.invalidate?.();
  await window.render?.();
  window.olonStudentSummary?.refresh?.();
  notice("Esta cuenta MT5 ahora alimenta tu Resumen, calendario y estadísticas.","success");
 }catch(e){notice(e.message,"error");}
 finally{busy=false;if(button)button.disabled=false;}
}
async function connect(){
 if(busy)return;
 const btn=$("metaapiConnect"),passwordEl=$("metaapiInvestorPassword");
 const platform=clean($("metaapiPlatform")?.value).toLowerCase();
 const selected=clean($("metaapiServer")?.value);
 const isAxi=["AXICORP","AXI"].includes($("metaapiBroker")?.value);
 const server=clean(isAxi&&selected!=="__manual__"?selected:$("metaapiServerCustom")?.value);
 const login=clean($("metaapiLogin")?.value);
 const password=passwordEl?.value||"";
 if(platform!=="mt5")return notice("Por ahora solamente está disponible MetaTrader 5.","error");
 if(isAxi&&!selected)return notice("Escoge el servidor MT5 de Axi en la lista.","error");
 if(!/^[a-zA-Z0-9_. /+\\-]{2,120}$/.test(server))return notice("Escribe el servidor MT5 exacto de tu cuenta.","error");
 if(!/^[0-9]{4,20}$/.test(login))return notice("Escribe el número completo de tu cuenta MT5.","error");
 if(!password||password.length>256||!$("metaapiInvestorConfirm")?.checked)return notice("Escribe la contraseña de inversor (solo lectura) y marca la confirmación.","error");
 busy=true;
 if(btn){btn.disabled=true;btn.setAttribute("aria-busy","true");btn.textContent="Verificando sesión y conectando…";}
 notice("Verificando la sesión y la conexión segura. No cierres esta página.","info");
 try{
  const ready=await invoke({action:"agent-ready"});
  agentReady=Boolean(ready.publicKeyPem);
  if(!agentReady)throw Error("No se encontró el equipo Windows emparejado. Comprueba OLFX CONNECT en Admin.");
  notice("Cifrando las credenciales de inversor en este navegador…","info");
  const encryptedPayload=await securePayload(ready.publicKeyPem,{login,investorPassword:password,platform:"mt5",brokerServer:server});
  if(passwordEl)passwordEl.value="";
  notice("Registrando la cuenta MT5 en Supabase…","info");
  await invoke({action:"connect",platform:"mt5",brokerServer:server,login,encryptedPayload});
  addingAccount=false;
  notice("Cuenta MT5 guardada. Pulsa «Actualizar estadísticas» para solicitar la primera importación; no se sincronizará automáticamente.","success");
  window.olonMtRecords?.invalidate?.();
  try{
   const result=await invoke({action:"status"});
   renderAccounts(result.accounts||[]);
  }catch(e){
   notice("La cuenta se registró, pero no se pudo actualizar la pantalla: "+e.message+" Presiona Actualizar estadísticas.","info");
  }
  // No redibujar toda la aplicación al conectar; la sección permanece abierta.
 }catch(e){
  notice("No se conectó la cuenta: "+(e?.message||"Error desconocido")+". Revisa el mensaje y vuelve a intentarlo.","error");
 }finally{
  if(passwordEl)passwordEl.value="";
  busy=false;
  if(btn){btn.textContent="Conectar mi cuenta MetaTrader 5";btn.disabled=false;btn.removeAttribute("aria-busy");}
 }
}
async function requestStudentRefresh(){
 if(busy)return;
 const button=$("metaapiRefreshAccounts");
 busy=true;if(button){button.disabled=true;button.textContent="Solicitando actualización…";}
 try{
  const result=await invoke({action:"refresh-my-accounts"});
  lastStatus=0;
  const state=await invoke({action:"status"});
  renderAccounts(state.accounts||[]);
  const queued=Number(result.queued||0),waiting=Number(result.alreadyWaiting||0);
  notice(queued?("Actualización solicitada para "+queued+" cuenta(s). La VPS procesará solamente estas solicitudes."):waiting?"Ya hay una actualización pendiente en la VPS.":"No hay cuentas nuevas para actualizar.","success");
 }catch(e){notice("No se pudo solicitar la actualización: "+e.message,"error");}
 finally{busy=false;if(button){button.disabled=false;button.textContent="Actualizar estadísticas";}}
}
async function retrySync(accountId,button){
 if(busy)return;
 busy=true;button.disabled=true;
 try{
  const result=await invoke({action:"retry-sync",accountId,force:true});
  const response=await invoke({action:"status"});renderAccounts(response.accounts||[]);
  notice(result.alreadyWaiting?"La sincronización ya está pendiente.":"Cuenta conservada: la VPS volverá a intentar la sincronización.","success");
 }catch(e){notice(e.message,"error");}
 finally{busy=false;if(button.isConnected)button.disabled=false;}
}
function showAccessUpdate(account,card){
 const old=card.querySelector(".olfxAccessUpdate");if(old){old.remove();return;}
 const form=document.createElement("form");form.className="olfxAccessUpdate metaapi-panel";form.autocomplete="off";
 const title=txt("strong","Actualizar credenciales de "+account.login_masked);
 const desc=txt("p","Introduce el número completo y la contraseña de inversor de la misma cuenta. No se borrará el historial.","metaapi-muted");
 const login=document.createElement("input");login.type="text";login.inputMode="numeric";login.maxLength=20;login.required=true;login.placeholder="Número completo de cuenta MT5";
 const pass=document.createElement("input");pass.type="password";pass.maxLength=256;pass.required=true;pass.placeholder="Contraseña de inversor (solo lectura)";pass.autocomplete="new-password";
 const label=document.createElement("label"),check=document.createElement("input");check.type="checkbox";check.required=true;label.append(check,document.createTextNode(" Confirmo que es la contraseña de inversor, no la contraseña principal."));
 const send=txt("button","Guardar y reintentar","btn metaapi-primary");send.type="submit";
 form.append(title,desc,login,pass,label,send);
 form.addEventListener("submit",async event=>{
  event.preventDefault();if(busy||!check.checked)return;
  const number=clean(login.value),secret=pass.value;
  if(!/^[0-9]{4,20}$/.test(number)||!account.login_masked.endsWith(number.slice(-4)))return notice("El número no coincide con la cuenta registrada.","error");
  busy=true;send.disabled=true;
  try{
   const ready=await invoke({action:"agent-ready"});if(!ready.publicKeyPem)throw Error("Agente OLFX no disponible.");
   const encryptedPayload=await securePayload(ready.publicKeyPem,{login:number,investorPassword:secret,platform:"mt5",brokerServer:account.broker_server});
   await invoke({action:"update-credentials",accountId:account.id,brokerServer:account.broker_server,login:number,encryptedPayload});
   const result=await invoke({action:"status"});renderAccounts(result.accounts||[]);
   notice("Credenciales actualizadas de forma segura. Cuenta conservada y en espera de sincronización.","success");
  }catch(e){notice(e.message,"error");}finally{pass.value="";busy=false;send.disabled=false;}
 });
 card.append(form);login.focus();
}
async function unlink(accountId){
 if(busy||!accountId||!confirm("¿Desvincular únicamente esta cuenta MT5? El historial sincronizado quedará conservado en Account Vault."))return;
 busy=true;
 try{
  await invoke({action:"disconnect",accountId});
  const result=await invoke({action:"status"});
  renderAccounts(result.accounts||[]);
  window.olonMtRecords?.invalidate?.();
  await window.render?.();
  notice("Cuenta desvinculada. Las demás conexiones siguen intactas.","success");
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
function configureMt5ServerOptions(){
 const broker=$("metaapiBroker"),selector=$("metaapiServer"),wrap=$("metaapiServerSelectWrap");
 const manualWrap=$("metaapiServerManualWrap"),manual=$("metaapiServerCustom");
 const hint=$("metaapiServerHint"),other=$("metaapiOtherBrokerWrap");
 if(!broker||!selector||!wrap||!manual||!manualWrap)return;
 const axi=broker.value==="AXICORP"||broker.value==="AXI";
 if(other)other.hidden=broker.value!=="OTHER";
 wrap.hidden=!axi;selector.disabled=!axi;selector.required=axi;
 manualWrap.hidden=axi&&selector.value!=="__manual__";
 manual.required=!manualWrap.hidden;
 if(hint)hint.textContent=axi
  ?(selector.value==="__manual__"?"Escribe el servidor exacto de tu cuenta MT5.":"Escoge el servidor que aparece en tu MT5; si falta, selecciona Otro servidor.")
  :"Escribe el servidor exacto que te asignó tu bróker.";
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
 if($("metaapiConnect"))$("metaapiConnect").disabled=platform!=="mt5";
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
 const broker=$("metaapiBroker"),selector=$("metaapiServer");
 broker?.addEventListener("change",()=>{
  if(selector)selector.value="";
  if($("metaapiServerCustom"))$("metaapiServerCustom").value="";
  configureMt5ServerOptions();
 });
 selector?.addEventListener("change",()=>configureMt5ServerOptions());
 configureMt5ServerOptions();
  form.addEventListener("submit",e=>{e.preventDefault();void connect();});
 document.querySelectorAll("[data-metaapi-platform]").forEach(btn=>{if(btn.dataset.metaapiPlatform==="mt4"){btn.disabled=true;btn.setAttribute("aria-disabled","true");return;}btn.addEventListener("click",()=>selectPlatform(btn.dataset.metaapiPlatform));});
 $("metaapiPlatform")?.addEventListener("change",()=>selectPlatform("mt5"));
 $("metaapiRefresh")?.addEventListener("click",()=>void status(true));
 $("metaapiDisconnect")?.addEventListener("click",()=>void unlink(currentAccount?.id));
 $("metaapiAddAccount")?.addEventListener("click",()=>{addingAccount=!addingAccount;renderAccounts(currentAccounts);});
 $("metaapiRefreshAccounts")?.addEventListener("click",()=>void requestStudentRefresh());
 $("metaapiRetryConnection")?.addEventListener("click",()=>void readiness());
 $("metaapiCancelPending")?.addEventListener("click",()=>{addingAccount=false;renderAccounts(currentAccounts);});
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
 // Refresh only while the MT5 screen is visible and the browser tab is active.
 // The polling only reads Supabase; MT5 is accessed exclusively by the Windows agent.
 const screenTimer=setInterval(()=>{
  if(document.visibilityState==="visible"&&!$(PAGE)?.classList.contains("hidden")
      &&currentAccounts.some(a=>a.status==="waiting"||a.status==="active")){
   void status();
  }
 },12000);
 window.addEventListener("pagehide",()=>clearInterval(screenTimer),{once:true});
 const adminPage=$("olonOwnAdminPage");
 if(adminPage)observer.observe(adminPage,{attributes:true,attributeFilter:["class"]});
 window.addEventListener("pagehide",()=>{if($("metaapiInvestorPassword"))$("metaapiInvestorPassword").value="";});
 selectPlatform("mt5");
 if(!$("metaapiAccountsPage").classList.contains("hidden")){void status(true);void loadVault();void readiness();}
}
// Read-only, authenticated status for the lightweight Portal Resumen. Never exposes investor passwords.
window.olonOwnAccountStatus=()=>invoke({action:"status"});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();