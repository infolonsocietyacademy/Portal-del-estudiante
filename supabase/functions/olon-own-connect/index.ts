import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info,x-olfx-agent-token,x-retry-count,traceparent,tracestate,baggage","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const url=Deno.env.get("SUPABASE_URL")||"";
const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||Deno.env.get("SUPABASE_SECRET_KEY")||"";
const anon=Deno.env.get("SUPABASE_ANON_KEY")||Deno.env.get("SUPABASE_PUBLISHABLE_KEY")||"";
const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
const validUuid=(v:unknown)=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const sha256=async (value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))).map(c=>c.toString(16).padStart(2,"0")).join("");
const b64=(v:unknown,min=1,max=6000)=>typeof v==="string"&&v.length>=min&&v.length<=max&&/^[A-Za-z0-9+/]+={0,2}$/.test(v);
const safeNum=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)&&Math.abs(v)<=1e12;
const fail=(error:string,status=400)=>respond({error},status);
const iso=(v:unknown)=>{if(typeof v!=="string"||v.length>40)return null;const t=Date.parse(v);return Number.isFinite(t)?new Date(t).toISOString():null};
// Public-key verification of Supabase's asymmetric access tokens.
const PROJECT_JWKS = createRemoteJWKSet(new URL(url+"/auth/v1/.well-known/jwks.json"),{timeoutDuration:6000,cooldownDuration:30000,cacheMaxAge:600000});
async function authenticate(req:Request) {
 const jwt=/^Bearer ([A-Za-z0-9_.-]+)$/i.exec(req.headers.get("authorization")||"")?.[1];
 if(!jwt){console.warn("OLFX auth denied: missing_user_jwt");return null;}
 let userId="";
 try{
  const {payload}=await jwtVerify(jwt,PROJECT_JWKS,{
   issuer:url+"/auth/v1",audience:"authenticated",algorithms:["ES256","RS256"]
  });
  if(payload.role==="authenticated"&&validUuid(payload.sub))userId=payload.sub;
  else console.warn("OLFX auth denied: missing_subject_or_role");
 }catch(e){
  console.warn("OLFX JWKS verify unavailable or invalid",e instanceof Error?e.name:"unknown");
 }
 if(!userId){
  // Independent verification by the Supabase Auth server, never decode without a signature check.
  try{
   const auth=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
   const {data,error}=await auth.auth.getUser(jwt);
   if(!error&&data?.user&&validUuid(data.user.id))userId=data.user.id;
   else console.warn("OLFX Auth API verification denied",error?.code||"no_user");
  }catch(e){
   console.warn("OLFX Auth API unavailable",e instanceof Error?e.name:"unknown");
  }
 }
 if(!userId)return null;
 const {data:profile,error:pe}=await db.from("profiles").select("id,role,status").eq("id",userId).maybeSingle();
 if(pe||!profile||profile.status!=="active"){
  console.warn("OLFX profile denied",pe?"profile_db_error":!profile?"profile_missing":"profile_inactive");
  return null;
 }
 return profile;
}
async function agentAuth(req:Request) {
 const token=req.headers.get("x-olfx-agent-token")||"";
 if(token.length<40||token.length>200)return null;
 const hash=await sha256(token);
 const {data}=await db.from("olon_own_agents").select("id,status,created_by").eq("token_hash",hash).eq("status","paired").maybeSingle();
 return data||null;
}
const errorMessage=(value:unknown)=>String(value||"Conexión no disponible").replace(/[\r\n<>]/g," ").slice(0,170);
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return fail("Método no permitido",405);
 if(!url||!service||!anon)return fail("OLFX requiere configuración del servidor",503);
 try{
  if(Number(req.headers.get("content-length")||"0")>1100000)return fail("Solicitud demasiado grande",413);
  const input=await req.json();
  if(!input||typeof input!=="object")return fail("Solicitud inválida");
  const action=String(input.action||"");
  if(action.startsWith("agent-") && action!=="agent-ready"){
   const agent=await agentAuth(req);
   if(!agent)return fail("Agente no autorizado",401);
   if(action==="agent-queue"){
    await db.from("olon_own_agents").update({last_seen_at:new Date().toISOString()}).eq("id",agent.id);
    const {data,error}=await db.from("olon_own_accounts")
     .select("id,provider_account_id,vault_account_id,platform,broker_server,encrypted_payload,status,last_sync_at,updated_at,last_error")
     .eq("agent_id",agent.id).eq("status","waiting")
     .order("created_at",{ascending:true}).limit(50);
    if(error)return fail("No se pudo consultar la cola",503);
    const accounts=data||[];
    const {data:states,error:stateError}=accounts.length
     ?await db.from("olon_mt_sync_state").select("provider_account_id,last_success_at,source_version,source_clock_mode")
       .in("provider_account_id",accounts.map(a=>a.provider_account_id))
     :{data:[],error:null};
    if(stateError)return fail("No se pudo consultar el punto de sincronización",503);
    const queued=await Promise.all(accounts.map(async account=>{
     const state=states?.find(s=>s.provider_account_id===account.provider_account_id);
     let references:unknown[]=[];
     if(account.vault_account_id){
      const referenceQuery=()=>db.from("olon_mt_deals").select("deal_id,occurred_at,broker_time")
       .eq("vault_account_id",account.vault_account_id).not("broker_time","is",null);
      const [first,last]=await Promise.all([
       referenceQuery().order("occurred_at",{ascending:true}).limit(8),
       referenceQuery().order("occurred_at",{ascending:false}).limit(8)
      ]);
      if(first.error||last.error)throw Error("No se pudo comprobar el reloj MT5");
      references=[...(first.data||[]),...(last.data||[])];
     }
     return {...account,source_version:state?.source_version||1,
      last_success_at:state?.last_success_at||null,source_clock_mode:state?.source_clock_mode||null,clock_references:references};
    }));
    return respond({accounts:queued});
   }
   if(action==="agent-error"){
    if(!validUuid(input.accountId))return fail("Cuenta inválida");
    const {data,error:readError}=await db.from("olon_own_accounts").select("id,status,last_sync_at").eq("id",input.accountId).eq("agent_id",agent.id).neq("status","revoked").maybeSingle();
    if(readError||!data)return fail("Cuenta no asignada",403);
    // Un intento antiguo no puede revertir una sincronizacion posterior que ya fue exitosa.
    const attemptedAt=typeof input.attemptStartedAt==="string"?Date.parse(input.attemptStartedAt):NaN;
    const lastSuccess=data.last_sync_at?Date.parse(data.last_sync_at):NaN;
    if(Number.isFinite(attemptedAt)&&Number.isFinite(lastSuccess)&&lastSuccess>=attemptedAt)
     return respond({ok:true,ignored:true});
    // Los fallos de MT5 son de sincronizacion, NO desconexiones del estudiante.
    // Mantener cuentas e historial ya verificados aunque un nuevo intento falle.
    const hasSynced=Boolean(data.last_sync_at);
    const {error}=await db.from("olon_own_accounts").update({
     status:hasSynced?"active":"error",last_error:errorMessage(input.message),
     updated_at:new Date().toISOString()
    }).eq("id",input.accountId).eq("agent_id",agent.id).neq("status","revoked");
    return error?fail("Error guardando estado",503):respond({ok:true,connected:hasSynced});
   }
   if(action==="agent-push"){
    const sourceVersion=input.sourceVersion===2?2:1;
    if(sourceVersion===2&&!["utc","server"].includes(input.clockMode))return fail("Reloj MT5 no verificado");
    if(sourceVersion===2&&!/^[0-9a-f]{64}$/.test(String(input.historyRevision||"")))return fail("Revisión del historial MT5 inválida");
    if(!validUuid(input.accountId)||typeof input.login!=="string"||!/^[0-9]{4,20}$/.test(input.login)||typeof input.server!=="string")return fail("Identidad inválida");
    if(!safeNum(input.balance)||!safeNum(input.equity)||!Array.isArray(input.deals)||input.deals.length>500)return fail("Lote inválido");
    const {data:account,error:ae}=await db.from("olon_own_accounts").select("id,student_id,provider_account_id,vault_account_id,platform,broker_server,status").eq("id",input.accountId).eq("agent_id",agent.id).maybeSingle();
    if(ae||!account||account.status!=="waiting"||account.platform!=="mt5"||account.broker_server.toLowerCase()!==input.server.toLowerCase())return fail("No existe una actualizacion MT5 solicitada para esta cuenta",403);
    const {data:previous,error:previousError}=await db.from("olon_mt_sync_state")
     .select("source_version,last_success_at").eq("provider_account_id",account.provider_account_id).maybeSingle();
    if(previousError)return fail("No se pudo leer la última sincronización",503);
    if((previous?.source_version||1)>sourceVersion)return fail("Actualiza el agente OLFX antes de sincronizar",409);
    const {data:vaultId,error:ve}=await db.rpc("olon_mt_register_own_vault",{p_own_id:account.id,p_login:input.login,p_platform:"mt5",p_server:input.server});
    if(ve||!vaultId)return fail("No se pudo verificar la identidad del historial",422);
    const deals=[];
    for(const d of input.deals){
     if(!d||typeof d!=="object"||!/^\d{1,20}$/.test(String(d.deal_id||""))||!iso(d.occurred_at))return fail("Operación inválida");
     const type=String(d.deal_type||"").toUpperCase();
     const entry=String(d.entry_type||"").toUpperCase();
     const brokerTime=String(d.broker_time||"").replace("T"," ");
     const brokerISO=iso(brokerTime.replace(" ","T")+"Z");
     if(sourceVersion===2&&(!/^(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/.test(brokerTime)||!brokerISO||brokerISO.slice(0,10)!==brokerTime.slice(0,10)))return fail("Fecha original MT5 inválida");
     if(!["DEAL_TYPE_BUY","DEAL_TYPE_SELL","DEAL_TYPE_BALANCE","DEAL_TYPE_CREDIT","DEAL_TYPE_CHARGE","DEAL_TYPE_CORRECTION","DEAL_TYPE_BONUS","DEAL_TYPE_COMMISSION","DEAL_TYPE_COMMISSION_DAILY","DEAL_TYPE_COMMISSION_MONTHLY","DEAL_TYPE_COMMISSION_AGENT_DAILY","DEAL_TYPE_COMMISSION_AGENT_MONTHLY","DEAL_TYPE_INTEREST","DEAL_TYPE_BUY_CANCELED","DEAL_TYPE_SELL_CANCELED","DEAL_TYPE_DIVIDEND","DEAL_TYPE_DIVIDEND_FRANKED","DEAL_TYPE_TAX"].includes(type))return fail("Tipo de operación inválido");
     if(!["","DEAL_ENTRY_IN","DEAL_ENTRY_OUT","DEAL_ENTRY_INOUT","DEAL_ENTRY_OUT_BY"].includes(entry))return fail("Entrada inválida");
     for(const k of ["volume","profit","commission","swap","fee"])if(!safeNum(d[k]??0))return fail("Valor de operación inválido");
     deals.push({
      student_id:account.student_id,provider_account_id:account.provider_account_id,vault_account_id:vaultId,
      deal_id:String(d.deal_id),occurred_at:iso(d.occurred_at),
      ...(sourceVersion===2?{broker_time:String(d.broker_time).replace("T"," "),imported_at:new Date().toISOString()}:{broker_time:null}),
      deal_type:type,entry_type:entry||null,
      position_id:d.position_id==null?null:String(d.position_id).slice(0,120),
      order_id:d.order_id==null?null:String(d.order_id).slice(0,120),
      symbol:d.symbol==null?null:String(d.symbol).slice(0,48),
      volume:d.volume??0,profit:d.profit??0,commission:d.commission??0,swap:d.swap??0,fee:d.fee??0,
      comment:d.comment==null?null:String(d.comment).slice(0,220)
     });
    }
    for(let i=0;i<deals.length;i+=150){
     const {error}=await db.from("olon_mt_deals").upsert(deals.slice(i,i+150),{onConflict:"vault_account_id,deal_id",ignoreDuplicates:sourceVersion<2});
     if(error)return fail("No se pudieron guardar las operaciones",503);
    }
    const now=new Date().toISOString();
    const currency=typeof input.currency==="string"&&/^[A-Z]{3}$/.test(input.currency)?input.currency:"USD";
    let countQuery=db.from("olon_mt_deals").select("id",{head:true,count:"exact"}).eq("vault_account_id",vaultId);
    if(sourceVersion===2)countQuery=countQuery.eq("provider_account_id",account.provider_account_id);
    const {count,error:countError}=await countQuery;
    if(countError)return fail("No se pudo comprobar el historial recibido",503);
    const finished=input.finished===true;
    if(finished&&sourceVersion===2&&(previous?.source_version||1)<2&&
       (!Number.isSafeInteger(input.expectedTotal)||input.expectedTotal<0||count!==input.expectedTotal))
     return fail("El historial recibido no coincide con el total original de MT5",409);
    const snapshot={
      provider_account_id:account.provider_account_id,student_id:account.student_id,vault_account_id:vaultId,
      last_attempt_at:now,last_error:null,synced_deals:count??0,updated_at:now,
      ...(finished?{last_success_at:now,backfill_done:true,balance:input.balance,equity:input.equity,currency,source_version:sourceVersion,
        ...(sourceVersion===2?{source_clock_mode:input.clockMode,history_revision:input.historyRevision}:{})}:{})
    };
    const {error:se}=await db.from("olon_mt_sync_state").upsert(snapshot,{onConflict:"provider_account_id"});
    if(se)return fail("No se pudo actualizar el estado",503);
    // Keep queued until the final batch; a second batch must not be treated as unsolicited.
    const {data:confirmed,error:ue}=await db.from("olon_own_accounts").update({
     status:finished?"active":"waiting",last_error:null,updated_at:now,
     ...(finished?{last_sync_at:now}:{})
    }).eq("id",account.id).eq("agent_id",agent.id).eq("status","waiting").select("id").maybeSingle();
    if(ue||!confirmed)return fail("No se pudo confirmar la sincronización",503);
    return respond({ok:true,synced:deals.length,stored:count??0});
   }
   return fail("Acción de agente desconocida");
  }
  const user=await authenticate(req);
  if(!user)return fail("Inicia sesión en el Portal del Trader",401);
  if(action==="admin-pair"){
   if(user.role!=="admin")return fail("Solo el administrador puede registrar el equipo",403);
   const pem=String(input.publicKeyPem||"");
   if(pem.length<300||pem.length>3000||!pem.includes("-----BEGIN PUBLIC KEY-----")||!pem.includes("-----END PUBLIC KEY-----"))return fail("Clave pública RSA inválida");
   const {data:existing}=await db.from("olon_own_agents").select("id").eq("created_by",user.id).eq("status","paired").limit(1);
   if(existing?.length)return fail("Ya existe un equipo emparejado. Revócalo antes de añadir otro.",409);
   const raw=Array.from(crypto.getRandomValues(new Uint8Array(48))).map(b=>b.toString(16).padStart(2,"0")).join("");
   const token="olfx_"+raw;
   const {data,error}=await db.from("olon_own_agents").insert({created_by:user.id,token_hash:await sha256(token),public_key_pem:pem,status:"paired",paired_at:new Date().toISOString()}).select("id").single();
   if(error)return fail("No se pudo emparejar el equipo",503);
   return respond({ok:true,agentId:data.id,agentToken:token});
  }
  if(action==="admin-rotate-token"){
   if(user.role!=="admin")return fail("Solo el administrador puede renovar el token",403);
   const pem=String(input.publicKeyPem||"").trim();
   if(pem.length<300||pem.length>3000||!pem.includes("-----BEGIN PUBLIC KEY-----")||!pem.includes("-----END PUBLIC KEY-----"))return fail("Pega la clave PUBLICA completa del equipo Windows",400);
   const {data:agent,error:ae}=await db.from("olon_own_agents").select("id,public_key_pem,token_hash").eq("created_by",user.id).eq("status","paired").order("created_at",{ascending:false}).limit(1).maybeSingle();
   if(ae)return fail("No se pudo consultar el equipo",503);
   if(!agent)return fail("Primero debes emparejar tu equipo",404);
   if(String(agent.public_key_pem||"").trim()!==pem)return fail("La clave publica no corresponde al equipo emparejado. Usa CLAVE_PUBLICA_PARA_PORTAL.txt del mismo Windows.",403);
   const random=Array.from(crypto.getRandomValues(new Uint8Array(48))).map(b=>b.toString(16).padStart(2,"0")).join("");
   const token="olfx_"+random;
   const {data:updated,error:ue}=await db.from("olon_own_agents").update({token_hash:await sha256(token),last_seen_at:null}).eq("id",agent.id).eq("created_by",user.id).eq("status","paired").eq("token_hash",agent.token_hash).select("id").maybeSingle();
   if(ue||!updated)return fail("El token no se pudo renovar. Actualiza la pagina y reintenta.",409);
   return respond({ok:true,agentId:agent.id,agentToken:token});
  }
  if(action==="admin-status"){
   if(user.role!=="admin")return fail("Permiso denegado",403);
   const {data,error}=await db.from("olon_own_agents").select("id,status,last_seen_at,created_at").eq("created_by",user.id).order("created_at",{ascending:false}).limit(5);
   if(error)return fail("No se pudo consultar el equipo",503);
   const {data:accounts}=await db.from("olon_own_accounts").select("status,platform,last_sync_at").limit(500);
   return respond({agents:data||[],accounts:accounts||[]});
  }
  if(action==="agent-ready"){
   const {data,error}=await db.from("olon_own_agents").select("id,public_key_pem,last_seen_at").eq("status","paired").order("created_at",{ascending:false}).limit(1);
   if(error||!data?.length)return fail("La conexión propia aún no está habilitada por administración",503);
   return respond({agentId:data[0].id,publicKeyPem:data[0].public_key_pem,lastSeenAt:data[0].last_seen_at});
  }
  if(action==="status"){
   const {data:accounts,error}=await db.from("olon_own_accounts")
    .select("id,provider_account_id,platform,broker_server,login_masked,status,is_primary,last_sync_at,last_error,created_at")
    .eq("student_id",user.id).neq("status","revoked").order("created_at",{ascending:false}).limit(20);
   if(error)return fail("No se pudo consultar el estado de las cuentas",503);
   const list=accounts||[];
   if(!list.length)return respond({account:null,accounts:[]});
   const ids=list.map(a=>a.id);
   const providers=list.map(a=>a.provider_account_id).filter(Boolean);
   const [statsResult,syncResult]=await Promise.all([
    db.from("olon_own_account_statistics").select("account_id,closed_trades,wins,losses,breakeven_trades,net_profit,today_net,week_net,month_net,total_deals,gross_profit,gross_loss,deposits,withdrawals,transfer_in,transfer_out,balance_adjustments,fees,last_closed_trade_at").in("account_id",ids),
    providers.length?db.from("olon_mt_sync_state").select("provider_account_id,balance,equity,currency,last_success_at,backfill_done,source_version,history_revision").in("provider_account_id",providers):Promise.resolve({data:[],error:null})
   ]);
   if(statsResult.error||syncResult.error)return fail("No se pudieron consultar las estadísticas de las cuentas",503);
   const stats=new Map((statsResult.data||[]).map(a=>[a.account_id,a]));
   const synced=new Map((syncResult.data||[]).map(a=>[a.provider_account_id,a]));
   const result=list.map(a=>{
    const st=stats.get(a.id)||{},current=synced.get(a.provider_account_id)||{};
    const closed=Number(st.closed_trades||0),wins=Number(st.wins||0);
    return {id:a.id,platform:a.platform,broker_server:a.broker_server,login_masked:a.login_masked,
     status:a.status,is_primary:a.is_primary,last_sync_at:a.last_sync_at,last_error:a.last_error,
     balance:current.balance??null,equity:current.equity??null,currency:current.currency||"USD",
     closed_trades:closed,wins,win_rate:closed?Math.round(wins*10000/closed)/100:null,
     net_profit:Number(st.net_profit||0),today_net:Number(st.today_net||0),
     week_net:Number(st.week_net||0),month_net:Number(st.month_net||0),
     total_deals:Number(st.total_deals||0),losses:Number(st.losses||0),
     breakeven_trades:Number(st.breakeven_trades||0),gross_profit:Number(st.gross_profit||0),
     gross_loss:Number(st.gross_loss||0),deposits:Number(st.deposits||0),
     withdrawals:Number(st.withdrawals||0),transfer_in:Number(st.transfer_in||0),
     transfer_out:Number(st.transfer_out||0),balance_adjustments:Number(st.balance_adjustments||0),
     fees:Number(st.fees||0),
     profit_factor:Number(st.gross_loss||0)>0?Math.round(Number(st.gross_profit||0)/Number(st.gross_loss||1)*100)/100:null,
     last_closed_trade_at:st.last_closed_trade_at||null,backfill_done:current.backfill_done===true,
     source_version:current.source_version||1,history_revision:current.history_revision||null};
   });
   return respond({accounts:result,account:result.find(a=>a.is_primary)||result[0]||null});
  }
  if(action==="recent-deals"){
   if(!validUuid(input.accountId))return fail("Cuenta invalida",400);
   const {data:acct,error:ae}=await db.from("olon_own_accounts")
    .select("id,provider_account_id,vault_account_id,status,last_sync_at").eq("id",input.accountId)
    .eq("student_id",user.id).neq("status","revoked").maybeSingle();
   if(ae||!acct)return fail("Cuenta no autorizada",403);
   // El historial verificado sigue visible durante reintentos o errores temporales.
   if(!acct.last_sync_at)return respond({deals:[],total:0,page:0,pageSize:50});
   const {data:sourceState,error:sourceError}=await db.from("olon_mt_sync_state")
    .select("source_version").eq("provider_account_id",acct.provider_account_id).maybeSingle();
   if(sourceError)return fail("No se pudo comprobar el origen MT5",503);
   // Vault is linked only after the agent has verified the broker account.
   // Include all historical providers belonging to this same validated MT5 account.
   const pageSize=50;
   const page=Math.min(2000,Math.max(0,Math.floor(Number(input.page)||0)));
   let query=db.from("olon_mt_deals")
    .select("deal_id,occurred_at,broker_time,deal_type,entry_type,symbol,volume,profit,commission,swap,fee",{count:"exact"})
    .eq("student_id",user.id);
   if(acct.vault_account_id)query=query.eq("vault_account_id",acct.vault_account_id);
   else query=query.eq("provider_account_id",acct.provider_account_id);
   if((sourceState?.source_version||1)>=2)query=query.eq("provider_account_id",acct.provider_account_id);
   const {data,error,count}=await query.order("occurred_at",{ascending:false})
    .order("id",{ascending:false}).range(page*pageSize,page*pageSize+pageSize-1);
   if(error)return fail("No se pudo consultar el historial completo",503);
   return respond({deals:data||[],total:Number(count||0),page,pageSize});
  }
  if(action==="update-credentials"){
   if(!validUuid(input.accountId))return fail("Cuenta MT5 invalida",400);
   const {data:target,error:te}=await db.from("olon_own_accounts")
    .select("id,broker_server,login_masked,platform,last_sync_at")
    .eq("id",input.accountId).eq("student_id",user.id).neq("status","revoked").maybeSingle();
   if(te||!target||target.platform!=="mt5")return fail("Cuenta no encontrada",404);
   const login=String(input.login||"").trim();
   if(!/^[0-9]{4,20}$/.test(login)||!target.login_masked.endsWith(login.slice(-4)))
    return fail("El numero MT5 no coincide con la cuenta guardada",400);
   if(String(input.brokerServer||"").trim().toLowerCase()!==target.broker_server.trim().toLowerCase())
    return fail("El servidor no coincide con la cuenta guardada",400);
   const crypt=input.encryptedPayload;
   if(!crypt||typeof crypt!=="object"||!b64(crypt.wrappedKey,100,900)||!b64(crypt.iv,12,60)||!b64(crypt.ciphertext,32,3000))
    return fail("Credenciales cifradas invalidas",400);
   const {data:updated,error:ue}=await db.from("olon_own_accounts")
    .update({encrypted_payload:crypt,status:target.last_sync_at?"active":"registered",last_error:null,updated_at:new Date().toISOString()})
    .eq("id",target.id).eq("student_id",user.id).neq("status","revoked")
    .select("id").maybeSingle();
   if(ue||!updated)return fail("No se pudo actualizar el acceso de inversor",503);
   return respond({ok:true,queued:false,message:"Credenciales guardadas: pulsa Actualizar estadísticas para solicitar la sincronización."});
  }
  if(action==="refresh-my-accounts"){
   // Solo el estudiante autenticado puede solicitar operaciones de SUS cuentas.
   const {data:owned,error:ownedError}=await db.from("olon_own_accounts")
    .select("id,status").eq("student_id",user.id).neq("status","revoked").limit(11);
   if(ownedError)return fail("No se pudieron verificar las cuentas",503);
   if(!owned?.length)return fail("Conecta primero una cuenta MT5",400);
   const available=owned.filter(a=>a.status!=="waiting").map(a=>a.id);
   if(!available.length)return respond({ok:true,queued:0,alreadyWaiting:owned.length});
   const {data:updated,error:ue}=await db.from("olon_own_accounts")
    .update({status:"waiting",last_error:null,updated_at:new Date().toISOString()})
    .eq("student_id",user.id).in("id",available)
    .in("status",["registered","active","error"])
    .select("id");
   if(ue)return fail("No se pudo solicitar la actualización MT5",503);
   return respond({ok:true,queued:updated?.length||0,alreadyWaiting:owned.length-available.length});
  }
  if(action==="retry-sync"){
   if(!validUuid(input.accountId))return fail("Selecciona una cuenta MT5 valida",400);
   const {data:target,error:te}=await db.from("olon_own_accounts")
    .select("id,status").eq("id",input.accountId).eq("student_id",user.id)
    .neq("status","revoked").maybeSingle();
   if(te||!target)return fail("Cuenta no encontrada",404);
   if(target.status==="waiting")return respond({ok:true,alreadyWaiting:true});
   if(target.status==="active"&&!input.force)return respond({ok:true,alreadyActive:true});
   const {data:updated,error:ue}=await db.from("olon_own_accounts")
    .update({status:"waiting",last_error:null,updated_at:new Date().toISOString()})
    .eq("id",input.accountId).eq("student_id",user.id).neq("status","revoked")
    .select("id").maybeSingle();
   if(ue||!updated)return fail("No se pudo solicitar la sincronizacion",503);
   return respond({ok:true,queued:true});
  }
  if(action==="connect"){
   if(input.platform!=="mt5")return fail("OLFX CONNECT admite solamente MT5 por ahora.");
   const server=String(input.brokerServer||"").trim();
   if(!/^[a-zA-Z0-9_. /+\\-]{2,120}$/.test(server))return fail("Introduce el servidor exacto de MetaTrader");
   const login=String(input.login||"").trim();
   if(!/^[0-9]{4,20}$/.test(login))return fail("Número de cuenta inválido");
   const crypt=input.encryptedPayload;
   if(!crypt||typeof crypt!=="object"||!b64(crypt.wrappedKey,100,900)||!b64(crypt.iv,12,60)||!b64(crypt.ciphertext,32,3000))return fail("Credenciales cifradas inválidas");
   const {data:agent,error:agentErr}=await db.from("olon_own_agents").select("id").eq("status","paired").order("created_at",{ascending:false}).limit(1);
   if(agentErr||!agent?.length)return fail("Primero configura el agente Windows desde administración",503);
   const {data:existing,error:ee}=await db.from("olon_own_accounts")
    .select("id,login_masked,broker_server,status,is_primary").eq("student_id",user.id).neq("status","revoked").limit(11);
   if(ee)return fail("No se pudieron verificar las cuentas",503);
   if((existing||[]).length>=10)return fail("Se alcanzó el límite de 10 cuentas MT5 por estudiante",409);
   if((existing||[]).some(a=>a.broker_server.toLowerCase()===server.toLowerCase()&&a.login_masked.endsWith(login.slice(-4))))
    return fail("Ya registraste una cuenta con este servidor y los mismos últimos cuatro dígitos",409);
   const {data:added,error}=await db.from("olon_own_accounts").insert({
     student_id:user.id,agent_id:agent[0].id,platform:"mt5",broker_server:server,
     login_masked:"••••"+login.slice(-4),encrypted_payload:crypt,status:"registered",
     is_primary:(existing||[]).length===0
   }).select("id").single();
   if(error||!added)return fail("No se pudo registrar la cuenta",503);
   return respond({ok:true,accountId:added.id,message:"Cuenta guardada. Presiona Actualizar estadísticas para solicitar la primera sincronización MT5."});
  }
  if(action==="select-primary"){
   if(!validUuid(input.accountId))return fail("Selecciona una cuenta MT5 válida",400);
   const {data:target,error:te}=await db.from("olon_own_accounts").select("id,is_primary")
     .eq("id",input.accountId).eq("student_id",user.id).neq("status","revoked").maybeSingle();
   if(te||!target)return fail("Cuenta no encontrada",404);
   if(!target.is_primary){
    const {error:clearErr}=await db.from("olon_own_accounts").update({is_primary:false})
      .eq("student_id",user.id).neq("status","revoked").eq("is_primary",true);
    if(clearErr)return fail("No se pudo cambiar la cuenta principal",503);
    const {error:setErr}=await db.from("olon_own_accounts").update({is_primary:true})
      .eq("id",input.accountId).eq("student_id",user.id).neq("status","revoked");
    if(setErr)return fail("No se pudo activar la cuenta elegida. Actualiza e inténtalo de nuevo.",503);
   }
   return respond({ok:true});
  }
  if(action==="disconnect"){
   if(!validUuid(input.accountId))return fail("Selecciona la cuenta que quieres desconectar",400);
   const {data:target,error:te}=await db.from("olon_own_accounts").select("id,is_primary")
    .eq("id",input.accountId).eq("student_id",user.id).neq("status","revoked").maybeSingle();
   if(te||!target)return fail("Cuenta no encontrada",404);
   const {error}=await db.from("olon_own_accounts").update({
     status:"revoked",is_primary:false,encrypted_payload:{revoked:true},updated_at:new Date().toISOString()
   }).eq("id",input.accountId).eq("student_id",user.id);
   if(error)return fail("No se pudo desconectar la cuenta",503);
   if(target.is_primary){
    const {data:next}=await db.from("olon_own_accounts").select("id")
     .eq("student_id",user.id).neq("status","revoked").order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(next)await db.from("olon_own_accounts").update({is_primary:true}).eq("id",next.id).eq("student_id",user.id);
   }
   return respond({ok:true});
  }
  return fail("Acción desconocida");
 }catch(e){console.error("OLFX own connector:",e instanceof Error?e.name:"unexpected");return fail("No se pudo completar la solicitud",503);}
});
