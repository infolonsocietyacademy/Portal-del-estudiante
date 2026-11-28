/* Section visibility uses the authenticated Supabase identity, never a saved profile. */
(() => {
  'use strict';
  const page=document.getElementById('propTraderzPage'),portal=document.getElementById('portal');
  const content=document.getElementById('olfxMarketContent'),soon=document.getElementById('olfxMarketSoon');
  if(!page||!portal||!content||!soon)return;
  let allowed=false,revision=0;
  const visible=()=>!portal.classList.contains('hidden')&&!page.classList.contains('hidden');
  function set(value){
    allowed=value;content.hidden=!value;soon.hidden=value;
    page.setAttribute('aria-labelledby',value?'ptzTitle':'olfxMarketSoonTitle');
    window.dispatchEvent(new CustomEvent('olfx:market-access',{detail:{allowed:value}}));
  }
  function revoke(){revision++;set(false);}
  async function check(){
    const version=++revision;set(false);
    if(!visible())return;
    try{
      if(typeof supabaseClient==='undefined')return;
      const {data,error}=await supabaseClient.auth.getUser();
      if(version!==revision||!visible())return;
      set(!error&&!!data?.user?.id&&String(data.user.email||'').trim().toLowerCase()==='nolotraderfx@gmail.com');
    }catch{if(version===revision)set(false);}
  }
  window.olfxMarketAccess={allowed:()=>allowed};
  set(false);
  window.addEventListener('olon:pagechange',e=>{if(e.detail?.id===page.id)void check();else revoke();});
  new MutationObserver(()=>{if(visible())void check();else revoke();}).observe(portal,{attributes:true,attributeFilter:['class']});
  if(typeof supabaseClient!=='undefined')supabaseClient.auth.onAuthStateChange(()=>{
    revoke();queueMicrotask(()=>{if(visible())void check();});
  });
  window.addEventListener('pagehide',revoke);
  window.addEventListener('pageshow',()=>{if(visible())void check();});
  if(visible())void check();
})();
