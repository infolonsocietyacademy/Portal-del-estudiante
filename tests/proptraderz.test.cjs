const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const fixture = `<style>#nqp_test .nqp-gex-card{display:none}#nqp_test .gex-visible{display:block}</style>
<div id="nqp_test"><div>Data is 2 hours old. Contact admin for update.</div><div class="nqp-hdr-sub">Last update: Nov 25</div>
<div class="nqp-tab-pane active" id="nqp_test_dir">Unwanted analysis</div>
<div class="nqp-tab-pane" id="nqp_test_gex"><h2>GEX Levels &amp; Expected Move</h2>
<button class="nqp-ds-pill active" data-dataset="production" onclick="window.bad=true">Production</button>
<button class="nqp-ds-pill" data-dataset="eod">EOD</button>
<button class="nqp-gex-pill active" data-gex-group="futures">Futures</button>
<button class="nqp-gex-pill" data-gex-group="commodities">Commodities</button>
<div class="nqp-ds-panel" id="nqp_test_ds_production"><div class="nqp-gex-card" data-gex-group="futures">NQ<button class="nqp-copy-btn" data-copy="GEX Flip: 100">Copy</button></div><div class="nqp-gex-card" data-gex-group="commodities">GC</div></div>
<div class="nqp-ds-panel" id="nqp_test_ds_eod" style="display:none"><div class="nqp-gex-card" data-gex-group="commodities">EOD GC</div></div>
<script>window.bad=true</script><img src="https://evil.invalid" onerror="window.bad=true"><a href="javascript:alert(1)">Unsafe link</a><div style="background:url(https://evil.invalid)">Unsafe style</div></div></div>`;
function setup(fetcher) {
  const section = fs.readFileSync('index.html', 'utf8').match(/<section id="propTraderzPage"[\s\S]*?<\/section>/)[0];
  const dom = new JSDOM('<main id="portal" class="hidden">' + section + '</main>', {runScripts:'outside-only'});
  const w = dom.window;
  w.AbortController = AbortController;
  w.fetch = fetcher;
  w.eval(fs.readFileSync('proptraderz.js', 'utf8'));
  const page = w.document.getElementById('propTraderzPage');
  return {dom, w, page, view:w.document.getElementById('ptzFrameHost').shadowRoot, enter() {
    w.document.getElementById('portal').classList.remove('hidden'); page.classList.remove('hidden');
    w.dispatchEvent(new w.CustomEvent('olon:pagechange',{detail:{id:page.id}}));
  }};
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('loads only GEX, keeps markets/datasets/copy and strips provider executable content', async () => {
  let calls=0, copied='';
  const s = setup(async()=>{calls++;return {ok:true,json:async()=>({content:{rendered:fixture}})};});
  try {
    Object.defineProperty(s.w.navigator, 'clipboard', {value:{writeText:async text=>{copied=text;}}});
    assert.equal(calls,0);
    s.enter(); await tick();
    assert.equal(calls,1);
    assert.match(s.view.textContent,/Data is 2 hours old/);
    assert.doesNotMatch(s.view.textContent,/Unwanted analysis/);
    assert.equal(s.view.querySelector('script,img,a,[onclick],[onerror]'),null);
    assert.equal(s.view.querySelector('[style*="evil"]'),null);
    assert.equal(s.view.querySelector('.nqp-gex-card.gex-visible').textContent,'NQCopy');
    s.view.querySelector('.nqp-copy-btn').click(); await tick();
    assert.equal(copied,'GEX Flip: 100');
    s.view.querySelector('[data-gex-group="commodities"]').click();
    assert.equal(s.view.querySelector('.nqp-gex-card.gex-visible').textContent,'GC');
    s.view.querySelector('[data-dataset="eod"]').click();
    assert.equal(s.view.querySelector('#nqp_test_ds_production').style.display,'none');
    assert.equal(s.view.querySelector('#nqp_test_ds_eod').style.display,'');
    s.enter(); await tick(); assert.equal(calls,1);
    s.w.document.getElementById('ptzReload').click(); await tick(); assert.equal(calls,2);
    s.w.document.getElementById('portal').classList.add('hidden'); await tick();
    assert.equal(s.view.childNodes.length,0);
  } finally {s.dom.window.close();}
});
test('leaving while loading cancels the request and prevents late data from appearing', async()=>{
  let resolve, signal;
  const s=setup((url,options)=>{signal=options.signal;return new Promise(done=>{resolve=done;});});
  try {
    s.enter();
    s.w.dispatchEvent(new s.w.CustomEvent('olon:pagechange',{detail:{id:'dashboard'}}));
    assert.equal(signal.aborted,true);
    resolve({ok:true,json:async()=>({content:{rendered:fixture}})});await tick();
    assert.equal(s.view.childNodes.length,0);
  } finally {s.dom.window.close();}
});
test('a changed or unavailable provider shows a retry message without loading the full analyzer', async()=>{
  const s=setup(async()=>({ok:true,json:async()=>({content:{rendered:'<h1>Provider unavailable</h1>'}})}));
  try {s.enter();await tick();assert.match(s.w.document.getElementById('ptzStatus').textContent,/Recargar/);assert.equal(s.view.childNodes.length,0);assert.equal(s.page.querySelector('iframe'),null);}
  finally {s.dom.window.close();}
});

test('Copy for TradingView exports numeric CSV while Copy Levels preserves the original block', async () => {
  const block = '── NQ KEY LEVELS | 2026-11-28 ──\nGEX Flip: 26,641 → Price BELOW flip = MM amplifying moves\nGEX Flip 0DTE: 26,122\nCall Resistance: 26,132, 26,232\nPut Support: 26,032, 25,531\nExpected Move Daily (±625)\nHigh: 26,659 ← upper bound for today\nLow: 25,409\nExpected Move Weekly (±1,396)\nHigh: 27,430\nLow: 24,638\nSource: PropTraderz.com | IBKR';
  const html = fixture.replace('data-copy="GEX Flip: 100"', 'data-copy="' + block + '"');
  const s = setup(async()=>({ok:true,json:async()=>({content:{rendered:html}})}));
  let copied='';
  try {
    Object.defineProperty(s.w.navigator,'clipboard',{value:{writeText:async text=>{copied=text;}}});
    s.enter(); await tick();
    assert.equal(s.view.querySelectorAll('.ptz-tv-btn').length,1);
    s.view.querySelector('.ptz-tv-btn').click(); await tick();
    assert.equal(copied, [
      'NQ,yellow,dashed,-2,GEX Flip,26641;',
      'NQ,yellow,dotted,-2,GEX Flip 0DTE,26122;',
      'NQ,red,solid,-2,Call Resistance,26132,26232;',
      'NQ,lime,solid,-2,Put Support,26032,25531;',
      'NQ,white,dashed,-2,EM Daily High,26659;',
      'NQ,white,dashed,-2,EM Daily Low,25409;',
      'NQ,orange,dashed,-2,EM Weekly High,27430;',
      'NQ,orange,dashed,-2,EM Weekly Low,24638;'
    ].join('\n'));
    assert.match(s.w.document.getElementById('ptzStatus').textContent,/Formato TradingView copiado/);
    s.view.querySelector('.nqp-copy-btn:not(.ptz-tv-btn)').click(); await tick();
    assert.equal(copied,block);
    s.w.document.getElementById('ptzReload').click();await tick();
    assert.equal(s.view.querySelectorAll('.ptz-tv-btn').length,1,'reload must not duplicate buttons');
  } finally {s.dom.window.close();}
});
test('TradingView clipboard failures show the permission error without claiming a successful copy', async () => {
  const html=fixture.replace('data-copy="GEX Flip: 100"','data-copy="── GC KEY LEVELS | 2026-11-28 ──\nGEX Flip: 3,663.71"');
  const s=setup(async()=>({ok:true,json:async()=>({content:{rendered:html}})}));
  try {
    Object.defineProperty(s.w.navigator,'clipboard',{value:{writeText:async()=>{throw new Error('Denied');}}});
    s.enter();await tick();s.view.querySelector('.ptz-tv-btn').click();await tick();
    assert.match(s.w.document.getElementById('ptzStatus').textContent,/no permitió copiar/);
  } finally {s.dom.window.close();}
});
