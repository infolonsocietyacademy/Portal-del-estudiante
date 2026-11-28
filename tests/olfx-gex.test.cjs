const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const core=require('../olfx-gex-core.js');
test('GEX candles aggregate OHLC in chronological order without accepting invalid prices',()=>{
  const input=[[1795637400,101,104,100,103],[1795637100,100,103,99,101],[1795637700,103,108,102,106],[1795637700,100,90,101,103],[1795637700,NaN,108,102,106]];
  assert.deepEqual(core.bars(input,15,'eth'),[{time:1795636800,open:100,high:104,low:99,close:103},{time:1795637700,open:103,high:108,low:102,close:106}]);
});
test('regular session uses New York time including daylight saving',()=>{
  const bar=iso=>[Date.parse(iso)/1000,100,101,99,100];
  const raw=['2026-07-06T13:25:00Z','2026-07-06T13:30:00Z','2026-07-06T20:00:00Z','2026-11-25T14:25:00Z','2026-11-25T14:30:00Z','2026-11-28T15:00:00Z'].map(bar);
  assert.equal(core.bars(raw,5,'rth').length,2);
});
test('GEX groups distinguish 0DTE, derive expected move from previous close, reject null levels',()=>{
  const levels=core.levels({prev_close:100,em_daily:5,levels:[{price:101,label:'Call Wall'},{price:102,label:'Call Wall 0DTE 2'},{price:null,label:'GEX Flip'},{price:NaN,label:'Put Wall'}]});
  assert.deepEqual(levels.map(l=>[l.label,l.price,l.group]),[['Call Wall',101,'walls'],['Call Wall 0DTE 2',102,'zero'],['EM High',105,'em'],['EM Low',95,'em']]);
});
function setup(width=1024) {
  const section=fs.readFileSync('index.html','utf8').match(/<section id="propTraderzPage"[\s\S]*?<\/section>/)[0];
  const dom=new JSDOM('<main id="portal">'+section+'</main>',{runScripts:'outside-only'}), w=dom.window;
  w.eval(fs.readFileSync('olfx-gex-core.js','utf8'));
  w.requestAnimationFrame=()=>1;w.cancelAnimationFrame=()=>{};w.AbortController=AbortController;w.olfxMarketAccess={allowed:()=>true};
  w.innerWidth=width;w.scrollTo=()=>{};
  const media=new w.EventTarget();media.matches=width<=640;w.matchMedia=()=>media;
  const viewport=new w.EventTarget();Object.assign(viewport,{width,height:700,offsetTop:0,offsetLeft:0});Object.defineProperty(w,'visualViewport',{value:viewport});
  const chartOptions=[],ranges=[],priceOptions=[];
  const line={setData(){},applyOptions(){},createPriceLine(options){priceOptions.push(options);return {applyOptions:next=>Object.assign(options,next)};},removePriceLine(){},priceToCoordinate(){return 100;}};
  w.LightweightCharts={createChart:(host,options)=>{chartOptions.push(options);return {addCandlestickSeries:()=>line,addLineSeries:()=>line,applyOptions:options=>chartOptions.push(options),remove(){},priceScale:()=>({width:()=>85,applyOptions(){}}),timeScale:()=>({subscribeVisibleLogicalRangeChange(){},setVisibleLogicalRange:range=>ranges.push(range),fitContent(){}}),subscribeCrosshairMove(){}};}};
  w.ResizeObserver=class {observe(){}disconnect(){}};
  const calls=[];w.fetch=(url,options)=>new Promise(resolve=>calls.push({url,options,resolve}));
  w.document.getElementById('propTraderzPage').classList.remove('hidden');
  w.document.getElementById('olfxMarketContent').hidden=false;
  w.eval(fs.readFileSync('olfx-gex-terminal.js','utf8'));
  return {dom,w,calls,media,viewport,chartOptions,ranges,priceOptions};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const response=(instrument='nq')=>({ok:true,json:async()=>({instrument,dataset:'production',run:{t:Date.now()/1000,data:{price:100,gamma_zone:'NEGATIVE',levels:[{price:102,label:'GEX Flip'}]}},bars:[]})});
test('terminal loads on demand, changing market aborts older response, navigation aborts active load',async()=>{
  const s=setup();try {
    assert.equal(s.calls.length,0);
    s.w.document.querySelector('[data-gex-view="terminal"]').click();assert.equal(s.calls.length,1);
    const select=s.w.document.getElementById('gexMarket');select.value='gc';select.dispatchEvent(new s.w.Event('change'));
    assert.equal(s.calls[0].options.signal.aborted,true);
    s.calls[0].resolve(response());await tick();assert.equal(s.w.document.getElementById('gexPrice').textContent,'—');
    s.calls[1].resolve(response('gc'));await tick();assert.equal(s.w.document.getElementById('gexPrice').textContent,'100',s.w.document.getElementById('gexStatus').textContent);
    select.value='es';select.dispatchEvent(new s.w.Event('change'));
    s.w.dispatchEvent(new s.w.CustomEvent('olon:pagechange',{detail:{id:'dashboard'}}));assert.equal(s.calls[2].options.signal.aborted,true);
    s.calls[2].resolve(response('es'));await tick();assert.equal(s.w.document.getElementById('gexPrice').textContent,'—');
  }finally{s.dom.window.close();}
});
test('locked source reports unavailable access and never renders the protected response',async()=>{
  const s=setup();try {
    s.w.document.querySelector('[data-gex-view="terminal"]').click();s.calls[0].resolve({ok:true,json:async()=>({locked:true})});await tick();
    assert.match(s.w.document.getElementById('gexStatus').textContent,/requiere acceso/);
    assert.equal(s.w.document.getElementById('gexPrice').textContent,'—');
  }finally{s.dom.window.close();}
});

test('exposure layers combine duplicate strikes, preserve call/put magnitude and normalize gross gamma',()=>{
  const rows=core.exposure([[100,30,-10],[100,10,-10],[101,10,-10],[102,0,0],[103,null,20],[104,NaN,20],null,[-1,5,5]]);
  assert.deepEqual(rows,[{price:100,call:40,put:20,total:60,strength:1},{price:101,call:10,put:10,total:20,strength:1/3}]);
  assert.deepEqual(core.exposure(undefined),[]);
});
test('chart-only fullscreen fallback keeps timeframe selection and exits on Escape or navigation',async()=>{
 const s=setup();try{
  s.w.document.querySelector('[data-gex-view="terminal"]').click();s.calls[0].resolve(response());await tick();
  const button=s.w.document.getElementById('gexChartFullscreen'),panel=s.w.document.getElementById('gexChartPanel');
  button.click();assert.equal(panel.classList.contains('gexChartExpanded'),true);
  const tf=s.w.document.getElementById('gexChartTimeframe');tf.value='240';tf.dispatchEvent(new s.w.Event('change'));assert.equal(s.w.document.getElementById('gexTimeframe').value,'240');
  s.w.document.dispatchEvent(new s.w.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(panel.classList.contains('gexChartExpanded'),false);
  button.click();s.w.dispatchEvent(new s.w.CustomEvent('olon:pagechange',{detail:{id:'dashboard'}}));assert.equal(panel.classList.contains('gexChartExpanded'),false);assert.equal(s.w.document.body.classList.contains('gexChartScreenOpen'),false);
 }finally{s.dom.window.close();}
});

test('mobile chart reserves fewer empty bars and removes long axis titles; rotation preserves data without fetching',async()=>{
 const s=setup(390);try{
  assert.equal(s.w.document.querySelector('.gexLayerSettings').open,false);
  s.w.document.querySelector('[data-gex-view="terminal"]').click();
  const reply=await response().json();reply.bars=Array.from({length:160},(_,i)=>[1795637100+i*300,100,104,99,102]);
  s.calls[0].resolve({ok:true,json:async()=>reply});await tick();
  assert.equal(s.chartOptions[0].rightPriceScale.minimumWidth,64);
  assert.equal(s.chartOptions[0].timeScale.rightOffset,6);
  assert.equal(s.chartOptions[0].handleScroll.vertTouchDrag,false);
  assert.equal(s.priceOptions[0].title,'');assert.ok(s.ranges[0].to-s.ranges[0].from<70);
  assert.match(s.w.document.getElementById('gexLevelList').textContent,/GEX Flip/);
  s.media.matches=false;s.media.dispatchEvent(new s.w.Event('change'));
  assert.equal(s.priceOptions[0].title,'GEX Flip');
  assert.equal(s.chartOptions.at(-1).timeScale.rightOffset,28);
  assert.equal(s.calls.length,1);assert.equal(s.ranges.length,1);
 }finally{s.dom.window.close();}
});

test('fullscreen follows the iPhone visual viewport and restores focus, scroll and sizing on exit',async()=>{
 const s=setup(390);try{
  s.w.document.querySelector('[data-gex-view="terminal"]').click();s.calls[0].resolve(response());await tick();
  const button=s.w.document.getElementById('gexChartFullscreen'),panel=s.w.document.getElementById('gexChartPanel');
  let restored;Object.defineProperty(s.w,'scrollY',{value:475});s.w.scrollTo=(x,y)=>{restored=y;};
  button.focus();button.click();
  assert.equal(panel.getAttribute('role'),'dialog');assert.equal(panel.style.getPropertyValue('--gex-screen-height'),'700px');
  Object.assign(s.viewport,{width:844,height:350,offsetTop:12});s.viewport.dispatchEvent(new s.w.Event('resize'));
  assert.equal(panel.style.getPropertyValue('--gex-screen-width'),'844px');assert.equal(panel.style.getPropertyValue('--gex-screen-height'),'350px');
  assert.equal(panel.style.getPropertyValue('--gex-screen-top'),'12px');
  button.click();assert.equal(restored,475);assert.equal(s.w.document.activeElement,button);
  assert.equal(panel.style.getPropertyValue('--gex-screen-height'),'');assert.equal(panel.hasAttribute('aria-modal'),false);
  assert.match(button.getAttribute('aria-label'),/^Ver solo/);
 }finally{s.dom.window.close();}
});

test('leaving during a pending native fullscreen request exits a late fullscreen result',async()=>{
 const s=setup(390);try{
  s.w.document.querySelector('[data-gex-view="terminal"]').click();s.calls[0].resolve(response());await tick();
  const panel=s.w.document.getElementById('gexChartPanel');let resolve,exited=0;
  panel.requestFullscreen=()=>new Promise(r=>{resolve=r;});s.w.document.exitFullscreen=async()=>{exited++;};
  s.w.document.getElementById('gexChartFullscreen').click();
  s.w.dispatchEvent(new s.w.CustomEvent('olon:pagechange',{detail:{id:'dashboard'}}));
  Object.defineProperty(s.w.document,'fullscreenElement',{value:panel,configurable:true});resolve();await tick();
  assert.equal(exited,1);assert.equal(panel.classList.contains('gexChartExpanded'),false);
 }finally{s.dom.window.close();}
});

