import postgres from 'npm:postgres@3.4.7';
import webpush from 'npm:web-push@3.6.7';
import {normalizeSubscription,preferences,eventsForDevice,safeEqual} from './policy.mjs';

const origin='https://infolonsocietyacademy.github.io';
const projectUrl=Deno.env.get('SUPABASE_URL')||'';
const gatewayKey=Deno.env.get('SUPABASE_ANON_KEY')||'';
const databaseUrl=Deno.env.get('SUPABASE_DB_URL')||'';
const sql=databaseUrl?postgres(databaseUrl,{max:1,prepare:false,idle_timeout:15,connect_timeout:10,ssl:'require'}):null;
const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
  'Access-Control-Allow-Methods':'POST,GET,OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
let configuration=null;
const fail=(status,message)=>Object.assign(new Error(message),{status,safe:true});
const response=(value,status=200)=>Response.json(value,{status,headers:cors});
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

async function config(){
  if(configuration)return configuration;
  if(!sql||!projectUrl||!gatewayKey)throw fail(503,'El servicio de avisos todavía no está disponible.');
  configuration=await sql.begin(async tx=>{
    await tx`select pg_advisory_xact_lock(7772831)`;
    const [row]=await tx`select decrypted_secret from vault.decrypted_secrets where name='olon_mobile_push_v1'`;
    if(row)return JSON.parse(row.decrypted_secret);
    const keys=webpush.generateVAPIDKeys();
    const secret={...keys,projectUrl,gatewayKey,subject:'mailto:infolonsocietyacademy@gmail.com',
      jobSecret:Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('')};
    await tx`select vault.create_secret(${JSON.stringify(secret)},'olon_mobile_push_v1','Encrypted server-only Web Push and scheduler credentials')`;
    return secret;
  });
  return configuration;
}

async function activeUser(req){
  const authorization=req.headers.get('Authorization')||'';
  if(!authorization.startsWith('Bearer '))throw fail(401,'Inicia sesión para gestionar tus notificaciones.');
  const gate=await fetch(projectUrl+'/rest/v1/rpc/olon_security_can_use_account',{
    method:'POST',headers:{apikey:gatewayKey,Authorization:authorization,'Content-Type':'application/json'},
    body:'{}',signal:AbortSignal.timeout(10000)});
  if(!gate.ok||await gate.json()!==true)throw fail(403,'Tu sesión no tiene acceso a las notificaciones.');
  const check=await fetch(projectUrl+'/auth/v1/user',{headers:{apikey:gatewayKey,Authorization:authorization},signal:AbortSignal.timeout(10000)});
  if(!check.ok)throw fail(401,'Tu sesión venció. Vuelve a iniciar sesión.');
  const user=await check.json();
  if(!uuid(user.id))throw fail(401,'Sesión no válida.');
  const [profile]=await sql`select id,role,status from public.profiles where id=${user.id}::uuid`;
  if(!profile||!['active','approved'].includes(profile.status))throw fail(403,'Tu acceso al portal no está activo.');
  return profile;
}

async function listDevices(owner,endpoint=''){
  const rows=await sql`select id,label,classes_enabled,vip_enabled,created_at,endpoint=${endpoint} as current
    from private.olon_push_devices where user_id=${owner}::uuid order by created_at desc limit 5`;
  return rows.map(r=>({id:r.id,label:r.label,classes:r.classes_enabled,vip:r.vip_enabled,createdAt:r.created_at,current:r.current}));
}

async function subscribe(owner,body){
  if(body.consent!==true)throw fail(400,'Activa los avisos desde este dispositivo para continuar.');
  let subscription;
  try{subscription=normalizeSubscription(body.subscription);}catch{throw fail(400,'La suscripción del dispositivo no es válida.');}
  const pref=preferences(body.preferences),label=String(body.label||'Dispositivo').trim().slice(0,40)||'Dispositivo';
  await sql.begin(async tx=>{
    await tx`select pg_advisory_xact_lock(hashtextextended(${owner},1))`;
    const [old]=await tx`select id,user_id,classes_enabled from private.olon_push_devices where endpoint=${subscription.endpoint}`;
    if(old&&old.user_id!==owner)throw fail(409,'Este dispositivo sigue asociado a otra cuenta. Desactiva sus avisos desde esa cuenta.');
    const [count]=await tx`select count(*)::int as n from private.olon_push_devices where user_id=${owner}::uuid`;
    if(!old&&count.n>=5)throw fail(409,'Ya tienes cinco dispositivos. Desactiva uno antes de añadir otro.');
    const publications=await tx`select publication_id from public.olon_classes where published and publication_id is not null and starts_at>now() order by starts_at limit 2000`;
    const baseline=publications.map(r=>r.publication_id);
    await tx`insert into private.olon_push_devices(user_id,endpoint,p256dh,auth_key,label,classes_enabled,vip_enabled,baseline_publications)
      values(${owner}::uuid,${subscription.endpoint},${subscription.p256dh},${subscription.auth_key},${label},${pref.classes},${pref.vip},${tx.json(baseline)})
      on conflict(endpoint) do update set p256dh=excluded.p256dh,auth_key=excluded.auth_key,label=excluded.label,
        classes_enabled=excluded.classes_enabled,vip_enabled=excluded.vip_enabled,updated_at=now(),consent_at=now(),
        baseline_publications=case when not private.olon_push_devices.classes_enabled and excluded.classes_enabled then excluded.baseline_publications else private.olon_push_devices.baseline_publications end
      where private.olon_push_devices.user_id=excluded.user_id`;
  });
  return {ok:true,devices:await listDevices(owner,subscription.endpoint)};
}

async function send(device,event,settings){
  // Only normalized browser-provider endpoints reach the outbound sender.
  normalizeSubscription({endpoint:device.endpoint,keys:{p256dh:device.p256dh,auth:device.auth_key}});
  await webpush.sendNotification({endpoint:device.endpoint,keys:{p256dh:device.p256dh,auth:device.auth_key}},
    JSON.stringify({title:event.title,body:event.body,kind:event.kind,tag:event.key}),
    {TTL:Math.max(1,Math.min(86400,event.ttl)),urgency:'normal',timeout:8000,
      vapidDetails:{subject:settings.subject,publicKey:settings.publicKey,privateKey:settings.privateKey}});
}

async function deliver(device,event,settings){
  const claimed=await sql`insert into private.olon_push_deliveries(device_id,event_key,leased_until,expires_at)
    values(${device.id}::uuid,${event.key},now()+interval '90 seconds',${event.expires}::timestamptz)
    on conflict(device_id,event_key) do update set attempts=private.olon_push_deliveries.attempts+1,leased_until=excluded.leased_until
      where private.olon_push_deliveries.sent_at is null and private.olon_push_deliveries.attempts<4
        and private.olon_push_deliveries.retry_after<=now() and private.olon_push_deliveries.expires_at>now()
        and (private.olon_push_deliveries.leased_until is null or private.olon_push_deliveries.leased_until<=now())
    returning device_id`;
  if(!claimed.length)return 'skipped';
  try{
    await send(device,event,settings);
    await sql`update private.olon_push_deliveries set sent_at=now(),leased_until=null,last_status=201 where device_id=${device.id}::uuid and event_key=${event.key}`;
    return 'sent';
  }catch(error){
    const status=Number(error?.statusCode)||0;
    if(status===404||status===410){await sql`delete from private.olon_push_devices where id=${device.id}::uuid`;return 'expired';}
    await sql`update private.olon_push_deliveries set leased_until=null,retry_after=now()+interval '5 minutes',last_status=${status} where device_id=${device.id}::uuid and event_key=${event.key}`;
    return 'failed';
  }
}

async function dispatch(req,settings){
  if(!safeEqual(req.headers.get('x-olon-push-job')||'',settings.jobSecret))throw fail(403,'Solicitud no autorizada.');
  const owner=crypto.randomUUID();
  const lock=await sql`insert into private.olon_push_runtime(name,lock_owner,leased_until) values('dispatch',${owner}::uuid,now()+interval '2 minutes')
    on conflict(name) do update set lock_owner=excluded.lock_owner,leased_until=excluded.leased_until where private.olon_push_runtime.leased_until<=now() returning name`;
  if(!lock.length)return {ok:true,busy:true};
  const counts={sent:0,failed:0,expired:0,skipped:0};
  try{
    await sql`delete from private.olon_push_deliveries where expires_at<now()`;
    const devices=await sql`select d.*,to_char(p.next_payment_date,'YYYY-MM-DD') as next_payment_date
      from private.olon_push_devices d join public.profiles p on p.id=d.user_id
      where p.status in ('active','approved') and (d.classes_enabled or d.vip_enabled)
      order by d.last_checked_at nulls first,d.created_at limit 1000`;
    const classes=await sql`select id,starts_at,duration_minutes,published,publication_id from public.olon_classes
      where published and publication_id is not null and starts_at>now() order by starts_at limit 2000`;
    const deadline=Date.now()+90000,queue=devices.slice();
    async function worker(){
      while(queue.length&&Date.now()<deadline){
        const device=queue.shift();
        for(const event of eventsForDevice(device,classes)){
          if(Date.now()>=deadline)break;
          const result=await deliver(device,event,settings);counts[result]++;
          if(result==='expired')break;
        }
        await sql`update private.olon_push_devices set last_checked_at=now() where id=${device.id}::uuid`;
      }
    }
    await Promise.all(Array.from({length:Math.min(6,devices.length)},worker));
    return {ok:true,...counts,pending:queue.length};
  }finally{await sql`update private.olon_push_runtime set leased_until=now() where name='dispatch' and lock_owner=${owner}::uuid`;}
}

Deno.serve(async req=>{
  if(req.headers.get('Origin')&&req.headers.get('Origin')!==origin)return response({error:'Origen no permitido.'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(!['GET','POST'].includes(req.method))return response({error:'Método no permitido.'},405);
  try{
    const raw=req.method==='POST'?await req.text():'';
    if(raw.length>8000)throw fail(413,'Solicitud demasiado grande.');
    let body;
    try{body=raw?JSON.parse(raw):{action:'config'};}catch{throw fail(400,'Solicitud no válida.');}
    if(!body||typeof body!=='object'||Array.isArray(body))throw fail(400,'Solicitud no válida.');
    const settings=await config();
    if(body.action==='config')return response({ok:true,ready:true,publicKey:settings.publicKey});
    if(body.action==='dispatch')return response(await dispatch(req,settings));
    const user=await activeUser(req);
    if(body.action==='status')return response({ok:true,devices:await listDevices(user.id,String(body.endpoint||'').slice(0,2048))});
    if(body.action==='subscribe')return response(await subscribe(user.id,body));
    if(body.action==='unsubscribe'){
      if(uuid(body.deviceId))await sql`delete from private.olon_push_devices where id=${body.deviceId}::uuid and user_id=${user.id}::uuid`;
      else if(typeof body.endpoint==='string')await sql`delete from private.olon_push_devices where endpoint=${body.endpoint.slice(0,2048)} and user_id=${user.id}::uuid`;
      else throw fail(400,'Selecciona el dispositivo que deseas desactivar.');
      return response({ok:true,devices:await listDevices(user.id)});
    }
    if(body.action==='test'){
      if(!uuid(body.deviceId))throw fail(400,'Activa este dispositivo antes de probar.');
      const [device]=await sql`update private.olon_push_devices set last_test_at=now() where id=${body.deviceId}::uuid and user_id=${user.id}::uuid
        and (last_test_at is null or last_test_at<now()-interval '30 seconds') returning *`;
      if(!device)throw fail(429,'Espera 30 segundos antes de volver a probar este dispositivo.');
      try{
        await send(device,{key:'olon-device-test',kind:'notifications',title:'Notificaciones activadas',
          body:'Este dispositivo ya puede recibir avisos de OLON Society Academy.',ttl:60},settings);
      }catch(error){
        if([404,410].includes(Number(error?.statusCode))){await sql`delete from private.olon_push_devices where id=${device.id}::uuid`;throw fail(410,'La suscripción venció. Vuelve a activar este dispositivo.');}
        throw fail(502,'El proveedor no pudo entregar la prueba. Vuelve a intentar.');
      }
      return response({ok:true});
    }
    throw fail(400,'Acción no válida.');
  }catch(error){
    if(!error?.safe)console.error('OLON push service error',String(error?.code||error?.name||'unknown'));
    return response({error:error?.safe?error.message:'No se pudo completar la solicitud de notificaciones.'},error?.safe?error.status:503);
  }
});
