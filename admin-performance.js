/* OLON ADMIN / PERFORMANCE — account data from the protected Supabase RPC. */
(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const root=$("olonPerformanceBlock"),rowsEl=$("olonPerformanceRows");
  if(!root||!rowsEl)return;
  const select=$("olonPerformancePeriod"),reload=$("olonPerformanceReload");
  const status=$("olonPerformanceStatus"),periodNote=$("olonPerformancePeriodNote");
  const permitted=new Set(["weekly","monthly","annual","all"]);
  const isAdmin=()=>typeof currentUser!=="undefined"&&currentUser&&
    typeof isAdminUser==="function"&&isAdminUser(currentUser)&&
    String(currentUser.status||"").toLowerCase()==="active";
  const open=()=>isAdmin()&&!$("portal")?.classList.contains("hidden");
  const pad=n=>String(n).padStart(2,"0");
  let token=0,loading=false,pending=false,cache=[],lastPeriod="",lastKey="";
  function prDate(){
    const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Puerto_Rico",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
    const get=type=>Number(parts.find(p=>p.type===type)?.value||0);
    return {year:get("year"),month:get("month"),day:get("day")};
  }
  function periodKey(period){
    const {year,month,day}=prDate();
    if(period==="all")return null;
    if(period==="annual")return String(year);
    if(period==="monthly")return year+"-"+pad(month);
    const date=new Date(Date.UTC(year,month-1,day));
    const weekday=date.getUTCDay()||7;
    date.setUTCDate(date.getUTCDate()+4-weekday);
    const isoYear=date.getUTCFullYear();
    const first=new Date(Date.UTC(isoYear,0,1));
    const week=Math.ceil((((date-first)/86400000)+1)/7);
    return isoYear+"-W"+pad(week);
  }
  function money(n){
    return Number(n||0).toLocaleString("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2});
  }
  function percentage(n){
    if(n==null)return "Sin capital";
    const v=Number(n);
    return (v>0?"+":"")+v.toLocaleString("es-PR",{minimumFractionDigits:2,maximumFractionDigits:2})+"%";
  }
  function el(tag,content,klass){
    const item=document.createElement(tag);
    if(content!=null)item.textContent=String(content);
    if(klass)item.className=klass;
    return item;
  }
  function empty(message){
    rowsEl.replaceChildren();
    const td=el("td",message);td.colSpan=6;
    const tr=el("tr");tr.append(td);rowsEl.append(tr);
  }
  function paint(data,period,key){
    rowsEl.replaceChildren();
    const students=(window.olonAdmin?.students?.()||[]).filter(u=>u.role==="student");
    const names=new Map(students.map(s=>[s.id,s]));
    const sorted=(data||[]).filter(r=>names.has(r.student_id)).sort((a,b)=>{
      const aa=a.return_pct==null?-Infinity:Number(a.return_pct);
      const bb=b.return_pct==null?-Infinity:Number(b.return_pct);
      return bb-aa||Number(b.trade_count)-Number(a.trade_count);
    });
    if(!sorted.length){empty("Todavía no hay estudiantes con datos disponibles.");return;}
    for(const record of sorted){
      const user=names.get(record.student_id);
      const tr=el("tr");
      const name=el("td");
      name.append(el("strong",user.full_name||"Estudiante"));
      name.append(el("small",user.access_code||""));
      const ops=el("td",String(record.trade_count||0));
      const capital=el("td",money(record.deposited));
      const net=el("td",money(record.net),Number(record.net)>=0?"profit":"loss");
      const pct=el("td",percentage(record.return_pct),record.return_pct==null?"none":Number(record.return_pct)>=0?"profit":"loss");
      const action=el("td");
      const eligible=Number(record.trade_count)>0&&Number(record.deposited)>0&&
        record.return_pct!=null&&["active","approved"].includes(String(user.status||"").toLowerCase());
      const marker=el("span",eligible?"Automático":"Sin clasificar","olonPerformanceAuto");
      marker.title=eligible?"Se clasifica automáticamente por sus resultados si entra al TOP 3":
        "Para clasificar debe registrar operaciones y un depósito, y tener acceso activo";
      action.append(marker);
      tr.append(name,ops,capital,net,pct,action);
      rowsEl.append(tr);
    }
  }
  async function refresh(){
    if(!open())return;
    if(loading){pending=true;return;}
    loading=true;
    const current=++token,period=permitted.has(select.value)?select.value:"monthly";
    const key=periodKey(period);
    reload.disabled=true;
    status.textContent="Consultando trades y calculando porcentajes…";
    periodNote.textContent=period==="all"?"Histórico: neto total ÷ depósitos totales. El TOP 3 se clasifica automáticamente.":
      "Neto de "+key+" ÷ depósitos totales registrados × 100.";
    try{
      const {data,error}=await supabaseClient.rpc("olon_admin_student_performance",{
        p_period_type:period,p_period_key:key
      });
      if(error)throw error;
      if(current!==token||!open())return;
      cache=data||[];lastPeriod=period;lastKey=key;
      paint(cache,period,key);
      status.textContent="Ranking automático · "+cache.length+" estudiantes · "+cache.filter(r=>Number(r.trade_count)>0).length+" con trades registrados.";
      if(period==="all")window.olonAdmin?.setPerformance(cache);
      else if(window.olonAdmin?.setPerformance){
        // Historical figures stay in the directory, independent of the ranking period.
        const history=await supabaseClient.rpc("olon_admin_student_performance",{
          p_period_type:"all",p_period_key:null
        });
        if(!history.error&&current===token&&open())window.olonAdmin.setPerformance(history.data||[]);
      }
    }catch(error){
      if(current===token){
        status.textContent="No se pudieron cargar los resultados: "+String(error?.message||"Comprueba tu conexión.");
        if(!cache.length)empty("Resultados no disponibles.");
      }
    }finally{
      loading=false;reload.disabled=false;
      if(pending){pending=false;void refresh();}
    }
  }
  select.value="monthly";
  select.addEventListener("change",()=>void refresh());
  reload.addEventListener("click",()=>void refresh());
  const portal=$("portal");
  if(portal){
    let wasOpen=false;
    new MutationObserver(()=>{
      const now=open();
      if(now&&!wasOpen)void refresh();
      if(!now)token++;
      wasOpen=!!now;
    }).observe(portal,{attributes:true,attributeFilter:["class"]});
  }
  document.addEventListener("visibilitychange",()=>{if(!document.hidden&&open())void refresh();});
  setInterval(()=>{if(open()&&!document.hidden)void refresh();},45000);
  window.olonAdminPerformance={refresh};
  if(open())void refresh();
})();
