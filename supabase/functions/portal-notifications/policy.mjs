// Pure policy helpers shared by the server and its tests. No network or secrets.
export const allowedActions = new Set(['classes','vip','notifications']);
export function safeEqual(a,b){
  if(typeof a!=='string'||typeof b!=='string'||a.length>128||b.length>128)return false;
  let difference=a.length^b.length;
  for(let i=0;i<Math.max(a.length,b.length);i++)difference|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);
  return difference===0;
}
function bytes(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]+={0,2}$/.test(value))throw Error('invalid_key');
  return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
}
export function normalizeSubscription(input){
  if(!input||typeof input.endpoint!=='string'||input.endpoint.length>2048)throw Error('invalid_subscription');
  const url=new URL(input.endpoint),host=url.hostname;
  const allowed=host==='fcm.googleapis.com'||host==='web.push.apple.com'||host.endsWith('.push.apple.com')
    ||host==='updates.push.services.mozilla.com'||host.endsWith('.push.services.mozilla.com')||host.endsWith('.notify.windows.com');
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!allowed||url.pathname.length<2)throw Error('invalid_endpoint');
  const publicKey=bytes(input.keys?.p256dh),auth=bytes(input.keys?.auth);
  if(publicKey.length!==65||publicKey[0]!==4||auth.length!==16)throw Error('invalid_key');
  return {endpoint:url.href,p256dh:input.keys.p256dh,auth_key:input.keys.auth};
}
export function preferences(value){return {classes:value?.classes===true,vip:value?.vip===true};}
export function localParts(now){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Puerto_Rico',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const get=type=>parts.find(p=>p.type===type).value;
  return {date:`${get('year')}-${get('month')}-${get('day')}`,hour:Number(get('hour'))};
}
export function eventsForDevice(device,classes,now=new Date()){
  const events=[],time=+now,known=new Set(device.baseline_publications||[]),local=localParts(now);
  if(device.classes_enabled){
    for(const item of classes){
      const start=+new Date(item.starts_at),remaining=Math.floor((start-time)/1000);
      if(!item.published||!item.publication_id||remaining<=0)continue;
      const expiry=new Date(start+Math.max(5,Number(item.duration_minutes)||60)*60000+86400000).toISOString();
      if(remaining<=900)events.push({key:`class-start:${item.id}:${new Date(start).toISOString()}`,kind:'classes',
        title:'Tu clase comienza pronto',body:'Abre el Portal del Trader para consultar los detalles y entrar a la sesión.',ttl:remaining,expires:expiry});
      else if(!known.has(item.publication_id))events.push({key:`class-new:${item.publication_id}`,kind:'classes',
        title:'Nueva clase en OLON',body:'Se publicó una sesión. Consulta el horario y el acceso en tu portal.',ttl:Math.min(3600,remaining),expires:expiry});
    }
  }
  if(device.vip_enabled&&device.next_payment_date&&local.hour>=9&&local.hour<20){
    const date=String(device.next_payment_date).slice(0,10);
    const days=Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(local.date+'T00:00:00Z'))/86400000);
    if([3,1,0].includes(days))events.push({key:`vip:${date}:${days}`,kind:'vip',title:'Recordatorio de membresía VIP',
      body:days===0?'Revisa tu renovación VIP de hoy en el portal.':'Tienes una renovación próxima. Revisa tu fecha de pago en el portal.',ttl:3600,
      expires:new Date(Date.parse(date+'T00:00:00Z')+7*86400000).toISOString()});
  }
  return events;
}
