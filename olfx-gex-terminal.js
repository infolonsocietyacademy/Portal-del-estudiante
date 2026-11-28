(() => {
  'use strict';
  const page=document.getElementById('propTraderzPage'), panel=document.getElementById('olfxGexTerminal');
  if (!page || !panel || !window.OLFXGexData) return;
  const core=window.OLFXGexData, $=id=>document.getElementById(id);
  const markets={nq:'NQ · Nasdaq',es:'ES · S&P 500',ym:'YM · Dow Jones',gc:'GC · Gold',cl:'CL · Oil',spx:'SPX',ndx:'NDX',spy:'SPY',qqq:'QQQ',dia:'DIA'};
  let chart=null, series=null, lineSeries=null, lines=[], data=null, request=null, resize=null, library=null, frame=0;
  const enabled=new Set(['walls','flip','dealer','pin','em']);
  const visible=()=>!$('portal').classList.contains('hidden') && !page.classList.contains('hidden') && !panel.hidden;
  const fmt=n=>core.validNumber(n)?n.toLocaleString('en-US',{maximumFractionDigits:2}):'—';
  const stamp=t=>new Intl.DateTimeFormat('es-PR',{timeZone:'America/Puerto_Rico',dateStyle:'medium',timeStyle:'short'}).format(new Date(t*1000));
  const selected=()=>({instrument:$('gexMarket').value,dataset:$('gexDataset').value});
  const tone=l=>/^(Call|Resistance)/.test(l.label)?'#d76878':/^(Put|Support)/.test(l.label)?'#2ca883':l.group==='flip'?'#c7a456':l.group==='em'?'#8b9cb7':l.group==='dex'?'#a984da':'#5a9bd5';
  function libraryReady() {
    if (window.LightweightCharts) return Promise.resolve();
    if (!library) library=new Promise((resolve,reject)=>{
      const script=document.createElement('script'); script.src='./vendor/lightweight-charts/lightweight-charts.js';
      script.onload=resolve;script.onerror=()=>{script.remove();library=null;reject(new Error('No se pudo cargar la gráfica.'));};
      document.head.append(script);
    });
    return library;
  }
  function theme() {
    if (!chart) return;
    const css=getComputedStyle(page), color=(key,fallback)=>css.getPropertyValue(key).trim()||fallback;
    chart.applyOptions({layout:{background:{type:'solid',color:color('--cyber-ui-panel','#101722')},textColor:color('--cyber-ui-muted','#91a0b3'),fontFamily:'Consolas, monospace',fontSize:13},grid:{vertLines:{color:color('--cyber-ui-border','#243040')},horzLines:{color:color('--cyber-ui-border','#243040')}}});
    scheduleProfile();
  }
  function createChart() {
    if (chart) return;
    chart=window.LightweightCharts.createChart($('gexChart'),{autoSize:true,height:560,rightPriceScale:{minimumWidth:85,borderVisible:false},timeScale:{timeVisible:true,secondsVisible:false,borderVisible:false,rightOffset:28,tickMarkFormatter:(t,type)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Puerto_Rico',...(type<=2?{month:'short',day:'numeric'}:{hour:'2-digit',minute:'2-digit',hourCycle:'h23'})}).format(new Date(t*1000))},localization:{locale:'es-PR',timeFormatter:t=>stamp(t)+' PR'},crosshair:{mode:0}});
    series=chart.addCandlestickSeries({upColor:'#2ca883',downColor:'#d76878',wickUpColor:'#2ca883',wickDownColor:'#d76878',borderVisible:false,priceLineVisible:false});
    lineSeries=chart.addLineSeries({color:'#c7a456',lineWidth:2,priceLineVisible:false});
    chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleProfile);
    chart.subscribeCrosshairMove(scheduleProfile);
    resize=new ResizeObserver(scheduleProfile);resize.observe($('gexChart'));
    theme();
  }
  function scheduleProfile() {if (!frame) frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>{frame=0;drawProfile();});});}
  function drawProfile() {
    const canvas=$('gexProfile'), box=$('gexChart');
    const width=box.clientWidth,height=box.clientHeight,ratio=window.devicePixelRatio||1;
    canvas.width=width*ratio;canvas.height=height*ratio;
    const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);ctx.clearRect(0,0,width,height);
    if (!chart || !data || !$('gexShowProfile').checked) return;
    const strikes=data.run?.data?.gex_strikes;
    if (!Array.isArray(strikes)) return;
    const rows=strikes.filter(b=>Array.isArray(b)&&b.length>=3&&b.slice(0,3).every(core.validNumber));
    const max=Math.max(1,...rows.map(b=>Math.max(Math.abs(b[1]),Math.abs(b[2]))));
    const edge=width-chart.priceScale('right').width()-110, maxWidth=Math.min(130,width*.2);
    rows.forEach(b=>{
      const y=series.priceToCoordinate(b[0]);if (y===null || y<0 || y>height-28) return;
      ctx.fillStyle='rgba(44,168,131,.38)';ctx.fillRect(edge-Math.abs(b[1])/max*maxWidth,y-4,Math.abs(b[1])/max*maxWidth,3);
      ctx.fillStyle='rgba(215,104,120,.4)';ctx.fillRect(edge-Math.abs(b[2])/max*maxWidth,y,Math.abs(b[2])/max*maxWidth,3);
    });
  }
  function draw(fit=true) {
    if (!chart || !data) return;
    const current=data.run?.data||{}, candles=core.bars(data.bars,Number($('gexTimeframe').value),$('gexSession').value);
    const precision=['es','gc','cl','spy','qqq','dia'].includes(selected().instrument)?2:0;
    [series,lineSeries].forEach(s=>s.applyOptions({priceFormat:{type:'price',precision,minMove:precision ? .01 : 1}}));
    series.setData(candles);lineSeries.setData([]);
    if (!candles.length) {
      const points=new Map();
      (data.runs||[]).forEach(r=>{if(core.validNumber(r.t)&&core.validNumber(r.price)) points.set(r.t,{time:r.t,value:r.price});});
      lineSeries.setData([...points.values()].sort((a,b)=>a.time-b.time));
    }
    lines.forEach(l=>l.owner.removePriceLine(l.line));lines=[];
    const levels=core.levels(current).filter(l=>enabled.has(l.group));
    const priceOwner=candles.length?series:lineSeries;
    levels.forEach(l=>lines.push({owner:priceOwner,line:priceOwner.createPriceLine({price:l.price,color:tone(l),lineWidth:l.group==='flip'?2:1,lineStyle:l.group==='em'||l.group==='zero'?2:0,axisLabelVisible:true,title:l.label})}));
    $('gexLevelList').replaceChildren();
    levels.sort((a,b)=>b.price-a.price).forEach(l=>{
      const row=document.createElement('div'),label=document.createElement('span'),price=document.createElement('strong');
      row.className='gexLevel';label.textContent=l.label;price.textContent=fmt(l.price);price.style.color=tone(l);row.append(label,price);$('gexLevelList').append(row);
    });
    if (!levels.length) $('gexLevelList').textContent='Activa un grupo para ver sus niveles.';
    $('gexPrice').textContent=fmt(current.price);
    $('gexGamma').textContent=current.gamma_zone==='NEGATIVE'?'Gamma negativa':current.gamma_zone==='POSITIVE'?'Gamma positiva':'Sin régimen';
    $('gexGamma').dataset.tone=current.gamma_zone==='NEGATIVE'?'down':'up';
    $('gexExpected').textContent=core.validNumber(current.em_daily)?'± '+fmt(current.em_daily):'—';
    $('gexFlip').textContent=fmt(core.levels(current).find(l=>l.label==='GEX Flip')?.price);
    if (fit) {
      chart.priceScale('right').applyOptions({autoScale:true});
      if (candles.length>1) chart.timeScale().setVisibleLogicalRange({from:Math.max(0,candles.length-100),to:candles.length+28});
      else chart.timeScale().fitContent();
    }
    const barTime=candles.at(-1)?.time;
    $('gexBarTime').textContent=barTime?'Última vela: '+stamp(barTime)+' PR':'Sin velas disponibles para esta sesión. Se muestran las referencias guardadas.';
    scheduleProfile();
  }
  function clear() {
    data=null;
    if (chart) {series.setData([]);lineSeries.setData([]);lines.forEach(l=>l.owner.removePriceLine(l.line));lines=[];}
    $('gexLevelList').replaceChildren();
    ['gexPrice','gexExpected','gexFlip','gexGamma'].forEach(id=>$(id).textContent='—');
    $('gexBarTime').textContent='';$('gexDataAge').hidden=true;scheduleProfile();
  }
  async function load() {
    if (!visible()) return;
    request?.abort();const controller=new AbortController();request=controller;
    clear();$('gexStatus').textContent='Cargando terminal…';panel.setAttribute('aria-busy','true');
    const timeout=setTimeout(()=>controller.abort(),25000);
    try {
      const query=new URLSearchParams({...selected(),_:String(Date.now())});
      const [response]=await Promise.all([fetch('https://www.proptraderz.com/wp-json/ptzterm/v1/state?'+query,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'}),libraryReady()]);
      if (!response.ok) throw new Error('La fuente no está disponible.');
      const result=await response.json();
      if (request!==controller || !visible()) return;
      if (result.locked) throw new Error('La fuente requiere acceso para esta selección.');
      if (!result.run?.data || !core.validNumber(result.run.t) || result.instrument!==selected().instrument || result.dataset!==selected().dataset) throw new Error('No hay datos para este mercado.');
      createChart();data=result;draw();
      const runTime=result.run.t;
      $('gexStatus').textContent='Niveles: '+stamp(runTime)+' PR · Fuente: PropTraderz';
      if (Date.now()/1000-runTime>86400) {$('gexDataAge').hidden=false;$('gexDataAge').textContent='La última actualización de niveles tiene más de 24 horas. Fecha de la fuente: '+stamp(runTime)+' PR.';}
    } catch(error) {
      if (request===controller && visible()) $('gexStatus').textContent=(error.name==='AbortError'?'La fuente tardó demasiado.':error.message)+' Pulsa Actualizar datos para reintentar.';
    } finally {clearTimeout(timeout);if(request===controller){request=null;panel.removeAttribute('aria-busy');}}
  }
  function stop() {
    request?.abort();request=null;resize?.disconnect();resize=null;
    if(frame) cancelAnimationFrame(frame);frame=0;
    chart?.remove();chart=null;series=null;lineSeries=null;lines=[];data=null;panel.removeAttribute('aria-busy');
  }
  function selectView(name) {
    const terminal=name==='terminal';panel.hidden=!terminal;$('ptzFrameHost').hidden=terminal;$('ptzStatus').hidden=terminal;
    document.querySelectorAll('[data-gex-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.gexView===name)));
    if (terminal) load();else stop();
  }
  Object.entries(markets).forEach(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;$('gexMarket').append(option);});
  core.groups.forEach(group=>{
    const button=document.createElement('button');button.type='button';button.textContent=group.label;button.setAttribute('aria-pressed',String(enabled.has(group.id)));
    button.addEventListener('click',()=>{if(enabled.has(group.id)) enabled.delete(group.id);else enabled.add(group.id);button.setAttribute('aria-pressed',String(enabled.has(group.id)));draw(false);});
    $('gexFilters').append(button);
  });
  document.querySelectorAll('[data-gex-view]').forEach(b=>b.addEventListener('click',()=>selectView(b.dataset.gexView)));
  ['gexMarket','gexDataset'].forEach(id=>$(id).addEventListener('change',load));
  ['gexTimeframe','gexSession'].forEach(id=>$(id).addEventListener('change',()=>draw()));
  $('gexShowProfile').addEventListener('change',scheduleProfile);$('gexFit').addEventListener('click',()=>draw());
  $('ptzReload').addEventListener('click',()=>{if(visible())load();});
  window.addEventListener('olon:pagechange',e=>{if(e.detail?.id!==page.id) stop();else if(visible()) load();});
  new MutationObserver(()=>{if(!visible())stop();else if(!chart&&!request)load();}).observe($('portal'),{attributes:true,attributeFilter:['class']});
  new MutationObserver(theme).observe(document.body,{attributes:true,attributeFilter:['class','style']});
  window.addEventListener('pagehide',stop);window.addEventListener('pageshow',()=>{if(visible()&&!request&&!data)load();});
})();
