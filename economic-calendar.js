(()=>{"use strict";
const root=document.getElementById("olonEconomicCalendar");if(!root)return;
const status=root.querySelector("[data-ec-status]"),list=root.querySelector("[data-ec-list]"),currency=root.querySelector("[data-ec-currency]"),impact=root.querySelector("[data-ec-impact]"),refresh=root.querySelector("[data-ec-refresh]");
const tz="America/Puerto_Rico",countryCurrencies={"United States":"USD","Euro Area":"EUR","Germany":"EUR","United Kingdom":"GBP","Japan":"JPY","Canada":"CAD","Australia":"AUD","China":"CNY","Switzerland":"CHF","New Zealand":"NZD"};
let events=[],lastFetch=0,timer=null;
const fmt=new Intl.DateTimeFormat("es-PR",{timeZone:tz,month:"short",day:"numeric",hour:"numeric",minute:"2-digit",hour12:true});
const escape=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function dateOf(s){if(!s)return NaN;return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s)?s:s+"Z")}
function render(){
 const filtered=events.filter(e=>(currency.value==="all"||e.currency===currency.value)&&(impact.value==="all"||String(e.importance)===impact.value)).sort((a,b)=>dateOf(a.date)-dateOf(b.date));
 if(!filtered.length){list.innerHTML='<p class="ec-empty">No hay eventos disponibles para los filtros seleccionados.</p>';return}
 list.innerHTML=filtered.slice(0,100).map(e=>{const t=dateOf(e.date),delta=t-Date.now(),time=Number.isFinite(t)?fmt.format(new Date(t)):"Hora pendiente",countdown=delta>0?delta<3600000?Math.ceil(delta/60000)+" min":Math.ceil(delta/3600000)+" h":"Publicado / pasado",level=e.importance===3?"Alto":e.importance===2?"Medio":"Bajo";return '<article class="ec-row"><div class="ec-date">'+escape(time)+'<small>'+escape(countdown)+'</small></div><div class="ec-event"><span class="ec-currency">'+escape(e.currency||"—")+'</span><strong>'+escape(e.title||"Evento económico")+'</strong><small>'+escape(e.country||"")+'</small></div><span class="ec-impact ec-impact-'+e.importance+'">'+level+'</span><div class="ec-numbers"><span>Anterior <b>'+escape(e.previous||"—")+'</b></span><span>Previsto <b>'+escape(e.forecast||"—")+'</b></span><span>Real <b>'+escape(e.actual||"—")+'</b></span></div></article>'}).join("");
}
async function load(force=false){
 if(!force&&Date.now()-lastFetch<15*60000){render();return}
 if(!window.supabaseClient){status.textContent="Inicia sesión para consultar el calendario.";return}
 refresh.disabled=true;status.textContent="Consultando calendario económico…";
 try{
 const {data,error}=await window.supabaseClient.functions.invoke("olon-economic-calendar",{method:"GET"});
 if(error||data?.error)throw new Error(data?.error||"No fue posible consultar los datos.");
 events=(data.events||[]).map(e=>({...e,importance:Number(e.importance)||1,currency:e.currency||countryCurrencies[e.country]||""}));
 lastFetch=Date.now();render();status.textContent="Calendario económico · Hora de Puerto Rico · "+(data.stale?"Datos almacenados":"Actualizado");
 }catch(e){status.textContent=e.message||"Calendario temporalmente no disponible.";list.innerHTML='<p class="ec-empty">No se muestran eventos inventados. Activa el proveedor para ver noticias verificadas.</p>'}
 finally{refresh.disabled=false}
}
currency.addEventListener("change",render);impact.addEventListener("change",render);refresh.addEventListener("click",()=>load(true));
const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))load()},{threshold:0.01});observer.observe(root);
timer=setInterval(()=>{if(!document.hidden&&root.getBoundingClientRect().width>0)load()},15*60000);
})();