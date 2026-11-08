(function(){
  'use strict';
  const root=document.getElementById('notificationsPage');if(!root)return;
  const $=id=>document.getElementById(id),base=new URL('.',document.currentScript?.src||location.href);
  const ownershipKey='olon_push_device_owner_v1';
  const allowed={classes:'academyClassesPage',vip:'academyVipPage',notifications:'notificationsPage'};
  let registration=null,publicKey='',subscription=null,devices=[],currentDevice=null,busy=false,ready=false,owner=null,request=0,installPrompt=null;
  let pending=new URL(location.href).searchParams.get('notify');
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const supported=()=>window.isSecureContext&&'serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window;
  const account=()=>typeof currentUser!=='undefined'?currentUser?.id:null;
  function storedOwner(){try{return localStorage.getItem(ownershipKey);}catch{return null;}}
  function remember(value){try{if(value)localStorage.setItem(ownershipKey,value);else localStorage.removeItem(ownershipKey);}catch{}}
  function feedback(message='',tone=''){$('pushFeedback').textContent=message;$('pushFeedback').dataset.tone=tone;$('pushFeedback').hidden=!message;}
  function phase(){
    if(ios&&!standalone())return 'install';
    if(!supported())return 'unsupported';
    if(Notification.permission==='denied')return 'blocked';
    if(currentDevice&&subscription&&Notification.permission==='granted')return 'active';
    if(!ready)return 'loading';
    return 'available';
  }
  function paint(){
    const state=phase();root.dataset.state=state;
    const paused=state==='active'&&!currentDevice.classes&&!currentDevice.vip;
    const labels={install:['Añade el portal a Inicio','Abre el portal desde su icono para activar los avisos del iPhone.'],
      unsupported:['Navegador no compatible','Prueba desde Safari en iPhone o desde un navegador actualizado que admita notificaciones.'],
      blocked:['Permiso bloqueado','Revisa los permisos de notificaciones del portal en los ajustes de tu dispositivo.'],
      active:paused?['Dispositivo conectado, avisos en pausa','Elige al menos una categoría y guarda tus preferencias para recibir avisos.']:['Este dispositivo está conectado','Puedes recibir avisos incluso con el portal cerrado. Al cerrar sesión se desactivan en este dispositivo.'],
      loading:['Preparando tu dispositivo','Comprobando la conexión con el servicio de notificaciones…'],
      available:['Listo para activar','Elige tus avisos y permite las notificaciones cuando el dispositivo te lo solicite.']};
    $('pushStatusTitle').textContent=labels[state][0];$('pushStatusDetail').textContent=labels[state][1];
    $('pushStatusBadge').textContent=paused?'EN PAUSA':state==='active'?'ACTIVADAS':state==='install'?'INSTALACIÓN':state==='blocked'?'BLOQUEADAS':state==='loading'?'CONECTANDO':'SIN ACTIVAR';
    $('pushActivate').hidden=state==='active'||state==='install';$('pushActivate').disabled=busy||state!=='available'||!account();
    $('pushViewInstall').hidden=state!=='install';
    $('pushActivate').textContent=busy?'Procesando…':'Activar en este dispositivo';
    $('pushSavePreferences').hidden=state!=='active';$('pushSavePreferences').disabled=busy;
    $('pushTest').disabled=busy||state!=='active';$('pushDisable').hidden=state!=='active';$('pushDisable').disabled=busy;
    $('pushRetry').hidden=ready||state==='install'||state==='unsupported';$('pushRetry').disabled=busy;
    $('pushInstallHelp').open=state==='install';
    $('pushInstallBrowser').hidden=!installPrompt||standalone();$('pushInstallBrowser').disabled=busy;
    for(const check of [$('pushClasses'),$('pushVip')])check.disabled=busy;
    for(const el of document.querySelectorAll('[data-push-quick-status]'))el.textContent=paused?'Avisos en pausa en este dispositivo':state==='active'?'Avisos conectados en este dispositivo':'Lleva los avisos de OLON a tu celular';
    for(const el of document.querySelectorAll('[data-push-active-dot]'))el.hidden=state!=='active'||paused;
    const list=$('pushDeviceList');list.replaceChildren();
    if(!devices.length){const empty=document.createElement('li');empty.className='pushEmpty';empty.textContent='Todavía no has conectado dispositivos.';list.append(empty);}
    for(const device of devices){
      const row=document.createElement('li'),copy=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('small'),remove=document.createElement('button');
      title.textContent=device.label+(device.current?' · Este dispositivo':'');detail.textContent=[device.classes?'Clases':'',device.vip?'Renovación VIP':''].filter(Boolean).join(' · ')||'Sin categorías activadas';
      copy.append(title,detail);remove.type='button';remove.className='btn secondary';remove.textContent='Desactivar';remove.disabled=busy;
      remove.addEventListener('click',()=>void disable(device));row.append(copy,remove);list.append(row);
    }
  }
  async function api(action,body={}){
    const {data,error}=await supabaseClient.functions.invoke('portal-notifications',{body:{action,...body}});
    if(error){let message='No se pudo conectar con el servicio de notificaciones.';try{message=(await error.context.json()).error||message;}catch{}throw Error(message);}
    if(!data?.ok)throw Error(data?.error||'No se pudo completar la solicitud.');
    return data;
  }
  function setDevices(rows){
    devices=rows||[];currentDevice=devices.find(d=>d.current)||null;
    if(currentDevice){$('pushClasses').checked=currentDevice.classes;$('pushVip').checked=currentDevice.vip;}
  }
  function label(){return ios?(navigator.maxTouchPoints>1&&/iPad|Macintosh/.test(navigator.userAgent)?'iPad':'iPhone'):/Android/i.test(navigator.userAgent)?'Android':'Computadora';}
  function keyBytes(key){const raw=atob(key.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
  async function nativeRegistration(){
    if(!registration)registration=await navigator.serviceWorker.register(new URL('service-worker.js',base).href,{scope:base.pathname});
    await navigator.serviceWorker.ready;return registration;
  }
  function route(){
    if(!pending||!account()||$('portal').classList.contains('hidden'))return;
    let page=allowed[pending]||'notificationsPage';
    if(typeof isAdminUser==='function'&&isAdminUser(currentUser)&&page!=='notificationsPage')page=pending==='classes'?'academyAdminClassesPage':'notificationsPage';
    pending=null;const url=new URL(location.href);url.searchParams.delete('notify');history.replaceState(null,'',url.href);
    window.showPageById(page);if(page==='notificationsPage')void refresh();
  }
  async function refresh(){
    const id=account(),number=++request;if(!id)return;
    if(owner!==id){owner=id;devices=[];currentDevice=null;$('pushClasses').checked=$('pushVip').checked=true;}
    ready=false;paint();
    if((ios&&!standalone())||!supported()){paint();return;}
    try{
      await nativeRegistration();
      subscription=await registration.pushManager.getSubscription();
      if(storedOwner()&&storedOwner()!==id&&subscription){await subscription.unsubscribe();subscription=null;remember(null);}
      const config=await api('config');
      const status=await api('status',{endpoint:subscription?.endpoint||''});
      if(number!==request||account()!==id)return;
      publicKey=config.publicKey;ready=Boolean(config.ready&&publicKey);setDevices(status.devices);
      if(currentDevice&&subscription)remember(id);
      feedback();
    }catch(error){if(number===request&&account()===id)feedback(error.message,'error');}
    finally{if(number===request){paint();route();}}
  }
  async function saveSubscription(){
    const data=await api('subscribe',{consent:true,subscription:subscription.toJSON(),label:label(),preferences:{classes:$('pushClasses').checked,vip:$('pushVip').checked}});
    setDevices(data.devices);remember(account());
  }
  $('pushActivate').addEventListener('click',async()=>{
    if(busy||phase()!=='available'||!publicKey)return;
    // Permission is requested directly in the tap handler, before any await.
    const permission=Notification.requestPermission();busy=true;feedback();paint();
    try{
      if(await permission!=='granted')throw Error('No se concedió el permiso. Puedes activarlo más adelante en los ajustes del dispositivo.');
      subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(publicKey)});
      await saveSubscription();feedback('Notificaciones activadas en este dispositivo. Puedes enviar una prueba.','success');
    }catch(error){feedback(error.message,'error');}
    finally{busy=false;paint();}
  });
  $('pushSavePreferences').addEventListener('click',async()=>{
    if(busy||!subscription||!currentDevice)return;busy=true;feedback();paint();
    try{await saveSubscription();feedback('Preferencias guardadas para este dispositivo.','success');}
    catch(error){feedback(error.message,'error');}finally{busy=false;paint();}
  });
  $('pushTest').addEventListener('click',async()=>{
    if(busy||!currentDevice)return;busy=true;feedback();paint();
    try{await api('test',{deviceId:currentDevice.id});feedback('Prueba enviada a este dispositivo. Revisa tu centro de notificaciones.','success');}
    catch(error){feedback(error.message,'error');}finally{busy=false;paint();}
  });
  async function disable(device=currentDevice){
    if(busy||!device)return;busy=true;feedback();paint();
    try{
      await api('unsubscribe',{deviceId:device.id});
      if(device.current&&subscription){await subscription.unsubscribe();subscription=null;remember(null);}
      const status=await api('status',{endpoint:subscription?.endpoint||''});setDevices(status.devices);
      feedback('Avisos desactivados para ese dispositivo.','success');
    }catch(error){feedback(error.message,'error');}finally{busy=false;paint();}
  }
  $('pushDisable').addEventListener('click',()=>void disable());
  $('pushRetry').addEventListener('click',()=>void refresh());
  $('pushViewInstall').addEventListener('click',()=>{$('pushInstallHelp').open=true;$('pushInstallHelp').scrollIntoView({behavior:'smooth',block:'start'});});
  $('pushInstallBrowser').addEventListener('click',async()=>{if(!installPrompt)return;await installPrompt.prompt();installPrompt=null;paint();});
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;paint();});
  window.addEventListener('appinstalled',()=>{installPrompt=null;void refresh();});
  document.addEventListener('click',event=>{
    if(event.target.closest('[data-open-notifications]')){window.showPageById('notificationsPage');void refresh();}
    else if(event.target.closest('[data-page="notificationsPage"]'))void refresh();
  });
  if('serviceWorker'in navigator)navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='OLON_OPEN_NOTIFICATION'){pending=event.data.kind;route();}});
  const portal=$('portal');
  new MutationObserver(()=>{if(!portal.classList.contains('hidden')&&account()){void refresh();route();}}).observe(portal,{attributes:true,attributeFilter:['class']});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&account()&&!portal.classList.contains('hidden')){if(!root.classList.contains('hidden'))void refresh();route();}});
  window.olonPush={
    open(){window.showPageById('notificationsPage');void refresh();},
    async beforeLogout(){
      try{
        const sub=registration?await registration.pushManager.getSubscription():null;
        if(sub)await Promise.race([Promise.allSettled([api('unsubscribe',{endpoint:sub.endpoint}),sub.unsubscribe()]),new Promise(resolve=>setTimeout(resolve,2500))]);
      }catch{ /* Logout remains available if a device is offline. */ }
      remember(null);owner=null;subscription=null;devices=[];currentDevice=null;
    }
  };
  paint();if(account()&&!portal.classList.contains('hidden')){void refresh();route();}
})();
