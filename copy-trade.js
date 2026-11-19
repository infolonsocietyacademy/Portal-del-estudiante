/* One private master and up to 20 followers; credentials stay in Windows MT5. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id),page=$('copyTradePage');
 if(!page)return;
 let owner=null,group=null,busy=false,dirty=false,seq=0,timer=null,started=false,loaded=false;
 const text=(tag,value)=>{const e=document.createElement(tag);e.textContent=value;return e;};
 const notice=(s,bad=false)=>{const e=$('ctFeedback');e.textContent=s;e.dataset.error=String(bad);};
 const userId=()=>typeof currentUser!=='undefined'?currentUser?.id:null;
 const blankAccount=()=>({terminal_path:'',login:'',server:''});
 const follower=()=>({...blankAccount(),id:'CTA_'+crypto.randomUUID().slice(0,8),enabled:false,lot_multiplier:1,max_lots:.6,max_risk_pct:1,max_daily_loss_pct:2,max_positions:5,max_spread_points:40,max_entry_drift_points:50,symbols:{XAUUSD:'XAUUSD',NAS100:'NAS100'}});
 function field(parent,name,label,value,type='text',options={}){
  const l=text('label',label),i=document.createElement('input');
  i.type=type;i.name=name;i.value=value??'';i.required=true;
  if(type==='number'){i.step=options.step||'any';i.min=options.min||'0.001';i.max=options.max||'100000';}
  else i.maxLength=options.maxLength||260;
  if(options.placeholder)i.placeholder=options.placeholder;
  l.append(i);parent.append(l);return i;
 }
 function accountFields(parent,a){
  field(parent,'login','Número de cuenta',a.login,'number',{step:'1',min:'1',max:String(Number.MAX_SAFE_INTEGER)});
  field(parent,'server','Servidor exacto',a.server,'text',{maxLength:100,placeholder:'Axi-US51-Live'});
  field(parent,'terminal_path','Ruta del terminal en Windows',a.terminal_path,'text',{placeholder:'C:\\OLFX_COPY\\MAESTRA\\terminal64.exe'});
 }
 function addFollower(f){
  const box=document.createElement('fieldset');box.className='ctFollower';box.dataset.id=f.id;
  const legend=text('legend','Cuenta receptora');box.append(legend);
  const fields=document.createElement('div');fields.className='ctGrid';box.append(fields);accountFields(fields,f);
  field(fields,'lot_multiplier','Multiplicador de lotaje',f.lot_multiplier,'number',{max:'100'});
  field(fields,'max_lots','Máximo de lotes por entrada',f.max_lots,'number',{max:'1000'});
  field(fields,'max_risk_pct','Riesgo máximo por entrada (%)',f.max_risk_pct,'number',{max:'100'});
  field(fields,'max_daily_loss_pct','Límite de pérdida diaria (%)',f.max_daily_loss_pct,'number',{max:'100'});
  field(fields,'max_positions','Máximo de posiciones copiadas',f.max_positions,'number',{min:'1',max:'100',step:'1'});
  field(fields,'max_spread_points','Spread máximo (puntos MT5)',f.max_spread_points,'number');
  field(fields,'max_entry_drift_points','Desviación máxima (puntos MT5)',f.max_entry_drift_points,'number');
  field(fields,'symbols','Símbolos: maestra=receptora, separados por coma',Object.entries(f.symbols).map(([k,v])=>k+'='+v).join(', '),'text',{maxLength:3000});
  const control=text('label','Incluir esta receptora');control.className='ctCheck';
  const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.name='enabled';checkbox.checked=f.enabled;control.prepend(checkbox);box.append(control);
  const remove=text('button','Eliminar receptora');remove.type='button';remove.className='btn secondary';
  remove.addEventListener('click',()=>{box.remove();dirty=true;controls();});box.append(remove);$('ctFollowers').append(box);
 }
 function controls(){
  const running=group&&!group.paused;
  $('ctEditor').disabled=busy||running;
  $('ctSave').disabled=busy||running;
  $('ctPause').disabled=busy||!group||group.paused;
  $('ctResume').disabled=busy||!group||running||dirty;
  $('ctRefresh').disabled=busy;
 }
 function draw(result){
  group=result.group;dirty=false;
  const settings=group?.settings||{master:blankAccount(),followers:[follower()]};
  $('ctMaster').replaceChildren();accountFields($('ctMaster'),settings.master);
  $('ctFollowers').replaceChildren();settings.followers.forEach(addFollower);
  $('ctMode').value=group?.mode||'paper';
  runtime(result);controls();
 }
 function runtime(result){
  const r=result.runtime,online=r&&Date.now()-Date.parse(r.last_seen_at)<20000;
  const applied=r&&group&&r.revision===group.revision;
  $('ctState').textContent=!group?'Sin configurar':group.paused?(online&&applied&&r.state==='paused'?'Pausa confirmada':'Pausa solicitada'):(online&&applied?(r.state==='error'?'Error · revisar VPS':group.mode==='demo'?'Demo activa':'Simulación activa'):'Esperando confirmación de VPS');
  $('ctAgent').textContent=online?'Agente Copy Trade conectado':result.agentPaired?'Equipo emparejado · agente Copy Trade sin conexión':'Sin equipo propio emparejado';
  $('ctUpdated').textContent=r?'Último contacto: '+new Date(r.last_seen_at).toLocaleString('es-PR',{timeZone:'America/Puerto_Rico'}):'Todavía no hay contacto del agente Copy Trade.';
  const rows=$('ctStatusRows');rows.replaceChildren();
  for(const f of group?.settings.followers||[]){
   const tr=document.createElement('tr');
   const labels={ok:'Correcta',paused:'Pausada',blocked:'Bloqueada · revisar VPS',error:'Error · revisar VPS'};
   [String(f.login),f.server,f.lot_multiplier+'×',f.enabled?(online&&applied?labels[r.followers?.[f.id]]||'Pendiente':'Sin confirmar'):'Desactivada'].forEach(v=>tr.append(text('td',v)));rows.append(tr);
  }
 }
 async function invoke(body){
  if(typeof supabaseClient==='undefined')throw Error('Inicia sesión en el portal');
  const {data,error}=await supabaseClient.functions.invoke('olfx-copy-control',{body});
  if(error){let detail;try{detail=(await error.context?.clone().json())?.error;}catch{}throw Error(detail||'No se pudo completar la solicitud');}
  if(data?.error)throw Error(data.error);return data;
 }
 function collect(){
  const account=box=>({login:Number(box.querySelector('[name=login]').value),server:box.querySelector('[name=server]').value.trim(),terminal_path:box.querySelector('[name=terminal_path]').value.trim()});
  return {version:1,master:account($('ctMaster')),followers:[...$('ctFollowers').children].map(box=>{
   const f={...account(box),id:box.dataset.id,enabled:box.querySelector('[name=enabled]').checked};
   for(const k of ['lot_multiplier','max_lots','max_risk_pct','max_daily_loss_pct','max_positions','max_spread_points','max_entry_drift_points'])f[k]=Number(box.querySelector('[name='+k+']').value);
   const pairs=box.querySelector('[name=symbols]').value.split(',').map(p=>p.trim().split('=').map(s=>s.trim()));
   if(pairs.some(p=>p.length!==2||!p[0]||!p[1])||new Set(pairs.map(p=>p[0])).size!==pairs.length)throw Error('Usa símbolos como XAUUSD=XAUUSD, NAS100=NAS100 sin repetirlos');
   f.symbols=Object.fromEntries(pairs);return f;
  })};
 }
 async function load(replace=true){
  if(busy||!userId())return;
  const stamp=++seq,actor=userId();
  try{const result=await invoke({action:'read'});if(seq!==stamp||actor!==userId())return;loaded=true;
   if(replace)draw(result);else{
    if(group?.revision!==result.group?.revision&&!dirty){draw(result);}
    else if(group?.revision===result.group?.revision)runtime(result);
   }
  }catch(e){if(actor===userId())notice(e.message,true);}
 }
 async function mutate(action){
  if(busy)return;
  const actor=userId();busy=true;controls();
  try{
   const body={action,revision:group?.revision??null};
   if(action==='save'){body.settings=collect();body.mode=$('ctMode').value;}
   const result=await invoke(body);if(actor!==userId())return;
   group=result.group;draw({group,agentPaired:false});
   notice(action==='save'?'Ajustes guardados. El grupo quedó pausado.':action==='pause'?'Pausa solicitada. Espera la confirmación del agente.':'Inicio solicitado. Espera la confirmación del agente.');
  }catch(e){if(actor===userId())notice(e.message,true);}
  finally{busy=false;controls();if(actor===userId())await load(false);}
 }
 function init(){
  if(started)return;started=true;
  $('ctAdd').addEventListener('click',()=>{if($('ctFollowers').children.length>=20){notice('Máximo de 20 receptoras',true);return;}addFollower(follower());dirty=true;controls();});
  $('ctForm').addEventListener('input',()=>{dirty=true;controls();});
  $('ctForm').addEventListener('change',()=>{dirty=true;controls();});
  $('ctForm').addEventListener('submit',e=>{e.preventDefault();mutate('save');});
  $('ctPause').addEventListener('click',()=>mutate('pause'));
  $('ctResume').addEventListener('click',()=>mutate('resume'));
  $('ctRefresh').addEventListener('click',()=>{if(dirty){notice('Guarda tus cambios antes de actualizar',true);return;}load();});
 }
 function visibility(){
  const id=userId(),visible=!page.classList.contains('hidden')&&!$('portal')?.classList.contains('hidden')&&!document.hidden;
  if(id!==owner){owner=id;seq++;group=null;dirty=false;loaded=false;$('ctMaster').replaceChildren();$('ctFollowers').replaceChildren();$('ctStatusRows').replaceChildren();notice('');$('ctState').textContent='Sin cargar';$('ctAgent').textContent='';$('ctUpdated').textContent='';}
  if(timer){clearTimeout(timer);timer=null;}
  if(!visible||!id)return;
  init();if(!loaded&&!busy)load();
  timer=setTimeout(async()=>{await load(false);visibility();},5000);
 }
 new MutationObserver(visibility).observe(page,{attributes:true,attributeFilter:['class']});
 if($('portal'))new MutationObserver(visibility).observe($('portal'),{attributes:true,attributeFilter:['class']});
 document.addEventListener('visibilitychange',visibility);
 window.olonCopyTrade={load};visibility();
})();
