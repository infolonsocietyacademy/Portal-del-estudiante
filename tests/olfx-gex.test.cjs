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
function setup() {
  const section=fs.readFileSync('index.html','utf8').match(/<section id="propTraderzPage"[\s\S]*?<\/section>/)[0];
  const dom=new JSDOM('<main id="portal">'+section+'</main>',{runScripts:'outside-only'}), w=dom.window;
  w.eval(fs.readFileSync('olfx-gex-core.js','utf8'));
  w.requestAnimationFrame=()=>1;w.cancelAnimationFrame=()=>{};w.AbortController=AbortController;
  const line={setData(){},applyOptions(){},createPriceLine(){},removePriceLine(){},priceToCoordinate(){return 100;}};
  w.LightweightCharts={createChart:()=>({addCandlestickSeries:()=>line,addLineSeries:()=>line,applyOptions(){},remove(){},priceScale:()=>({width:()=>85,applyOptions(){}}),timeScale:()=>({subscribeVisibleLogicalRangeChange(){},setVisibleLogicalRange(){},fitContent(){}}),subscribeCrosshairMove(){}})};
  w.ResizeObserver=class {observe(){}disconnect(){}};
  const calls=[];w.fetch=(url,options)=>new Promise(resolve=>calls.push({url,options,resolve}));
  w.document.getElementById('propTraderzPage').classList.remove('hidden');
  w.eval(fs.readFileSync('olfx-gex-terminal.js','utf8'));
  return {dom,w,calls};
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
