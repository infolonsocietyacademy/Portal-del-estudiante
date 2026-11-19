import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { validateSettings } from './config.mjs';

const url=Deno.env.get('SUPABASE_URL')!;
const db=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-olfx-agent-token','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
const hash=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))).map(b=>b.toString(16).padStart(2,'0')).join('');
const safeRevision=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0;
const columns='id,settings,mode,paused,revision,updated_at';

Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return reply({error:'Método no permitido'},405);
 try{
  const raw=await req.text();
  if(raw.length>60000)return reply({error:'Configuración demasiado grande'},413);
  let input;try{input=JSON.parse(raw);}catch{return reply({error:'Solicitud inválida'},400);}
  const action=input?.action;
  if(['agent-config','agent-heartbeat'].includes(action)){
   const token=req.headers.get('x-olfx-agent-token')||'';
   if(token.length<40||token.length>200)return reply({error:'Agente no autorizado'},401);
   const {data:agent,error:ae}=await db.from('olon_own_agents').select('id,created_by').eq('token_hash',await hash(token)).eq('status','paired').maybeSingle();
   if(ae||!agent)return reply({error:'Agente no autorizado'},401);
   const {data:profile}=await db.from('profiles').select('status').eq('id',agent.created_by).maybeSingle();
   if(profile?.status!=='active')return reply({error:'Propietario inactivo'},403);
   const {data:group,error:ge}=await db.from('olfx_copy_groups').select(columns).eq('owner_id',agent.created_by).maybeSingle();
   if(ge)return reply({error:'No se pudo leer el grupo'},503);
   if(action==='agent-config')return reply({group});
   if(!group||input.group_id!==group.id||input.revision!==group.revision)return reply({error:'Configuración cambió; actualiza antes del siguiente ciclo'},409);
   if(!['paused','paper','demo','error'].includes(input.state))return reply({error:'Estado inválido'},400);
   if(!input.followers||typeof input.followers!=='object'||Array.isArray(input.followers))return reply({error:'Estado de cuentas inválido'},400);
   // Only fixed status codes, never broker strings, tokens, logins or credentials.
   const allowed=new Set(['ok','paused','blocked','error']);
   const followers=Object.fromEntries(group.settings.followers.map((f:{id:string})=>[f.id,allowed.has(input.followers[f.id])?input.followers[f.id]:'error']));
   const {error}=await db.from('olfx_copy_runtime').upsert({group_id:group.id,agent_id:agent.id,revision:group.revision,state:input.state,followers,last_seen_at:new Date().toISOString()},{onConflict:'group_id'});
   return error?reply({error:'No se pudo registrar el estado'},503):reply({ok:true});
  }
  const jwt=/^Bearer (\S+)$/i.exec(req.headers.get('authorization')||'')?.[1];
  if(!jwt)return reply({error:'Inicia sesión en el portal'},401);
  const {data:auth,error:authError}=await db.auth.getUser(jwt);
  if(authError||!auth?.user)return reply({error:'Sesión no autorizada'},401);
  const owner=auth.user.id;
  const {data:profile,error:pe}=await db.from('profiles').select('status').eq('id',owner).maybeSingle();
  if(pe||profile?.status!=='active')return reply({error:'Acceso no disponible'},403);
  const {data:group,error:ge}=await db.from('olfx_copy_groups').select(columns).eq('owner_id',owner).maybeSingle();
  if(ge)return reply({error:'No se pudo consultar Copy Trade'},503);
  if(action==='read'){
   const {data:agent}=await db.from('olon_own_agents').select('id').eq('created_by',owner).eq('status','paired').limit(1).maybeSingle();
   let runtime=null;
   if(group){const result=await db.from('olfx_copy_runtime').select('revision,state,followers,last_seen_at').eq('group_id',group.id).maybeSingle();if(result.error)return reply({error:'Estado de VPS no disponible'},503);runtime=result.data;}
   return reply({group,runtime,agentPaired:!!agent});
  }
  if(action==='save'){
   let settings;try{settings=validateSettings(input.settings);}catch(e){return reply({error:e instanceof Error?e.message:'Configuración inválida'},400);}
   if(!['paper','demo'].includes(input.mode))return reply({error:'Selecciona simulación o demo'},400);
   if(group&&!group.paused)return reply({error:'Pausa el grupo antes de editarlo'},409);
   if(group&&input.revision!==group.revision)return reply({error:'Otro cambio fue guardado; actualiza antes de editar'},409);
   if(!group&&input.revision!==null)return reply({error:'Actualiza la configuración'},409);
   const values={settings,mode:input.mode,paused:true,updated_at:new Date().toISOString()};
   const q=group?db.from('olfx_copy_groups').update({...values,revision:group.revision+1}).eq('owner_id',owner).eq('revision',group.revision):db.from('olfx_copy_groups').insert({...values,owner_id:owner});
   const {data,error}=await q.select(columns).maybeSingle();
   if(error||!data)return reply({error:'No se pudo guardar; actualiza e intenta otra vez'},409);
   return reply({group:data});
  }
  if(action==='pause'||action==='resume'){
   if(!group||!safeRevision(input.revision)||input.revision!==group.revision)return reply({error:'Actualiza la configuración antes de continuar'},409);
   if(action==='resume'){
    if(!group.settings.followers.some((f:{enabled:boolean})=>f.enabled))return reply({error:'Activa al menos una receptora y guarda'},400);
    const {data:runtime}=await db.from('olfx_copy_runtime').select('last_seen_at,state,revision').eq('group_id',group.id).maybeSingle();
    if(!runtime||Date.now()-Date.parse(runtime.last_seen_at)>20000||runtime.revision!==group.revision||runtime.state==='error')return reply({error:'Primero inicia el agente Copy Trade en Windows y espera su conexión'},409);
   }
   const {data,error}=await db.from('olfx_copy_groups').update({paused:action==='pause',revision:group.revision+1,updated_at:new Date().toISOString()}).eq('owner_id',owner).eq('revision',group.revision).select(columns).maybeSingle();
   return error||!data?reply({error:'La configuración cambió; actualiza'},409):reply({group:data});
  }
  return reply({error:'Acción no disponible'},400);
 }catch{return reply({error:'Copy Trade no pudo completar la solicitud'},503);}
});
