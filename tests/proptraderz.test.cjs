const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');

test('PropTraderz loads on entry, switches tools, reloads and unloads on exit or logout', async () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const section = html.match(/<section id="propTraderzPage"[\s\S]*?<\/section>/)[0];
  const dom = new JSDOM('<main id="portal" class="hidden">' + section + '</main>', {runScripts: 'outside-only'});
  const {window: w} = dom;
  try {
    w.eval(fs.readFileSync('proptraderz.js', 'utf8'));
    const page = w.document.getElementById('propTraderzPage');
    const portal = w.document.getElementById('portal');
    const current = () => page.querySelector('iframe');
    const enter = () => w.dispatchEvent(new w.CustomEvent('olon:pagechange', {detail: {id: page.id}}));
    enter();
    assert.equal(current(), null, 'no provider requests on the login screen');
    portal.classList.remove('hidden');
    page.classList.remove('hidden');
    enter();
    const first = current();
    assert.equal(first.src, 'https://www.proptraderz.com/gex-terminal/#ptzt-pulse');
    const host = w.document.getElementById('ptzFrameHost');
    const controls = w.document.getElementById('ptzMarketControls');
    assert.equal(host.dataset.view, 'chart');
    controls.click();
    assert.equal(current(), first, 'opening controls must preserve the selected market in the same frame');
    assert.equal(first.src, 'https://www.proptraderz.com/gex-terminal/#ptzterm');
    assert.equal(host.dataset.view, 'terminal');
    controls.click();
    assert.equal(host.dataset.view, 'chart');
    assert.equal(first.src, 'https://www.proptraderz.com/gex-terminal/#ptzt-pulse');
    assert.equal(first.referrerPolicy, 'no-referrer');
    assert.equal(first.getAttribute('allow'), 'clipboard-write; fullscreen');
    enter();
    assert.equal(current(), first, 'repeated entry must not create another request');
    page.querySelector('[data-ptz-tool="analyzer"]').click();
    assert.equal(controls.hidden, true);
    assert.equal(current().src, 'https://www.proptraderz.com/market-direction-analyzer/');
    page.querySelector('[data-ptz-tool="terminal"]').click();
    assert.equal(controls.hidden, false);
    assert.equal(current().src, 'https://www.proptraderz.com/gex-terminal/#ptzt-pulse');
    assert.equal(first.isConnected, false);
    assert.equal(page.querySelector('[data-ptz-tool="terminal"]').getAttribute('aria-pressed'), 'true');
    const terminal = current();
    w.document.getElementById('ptzReload').click();
    assert.notEqual(current(), terminal);
    assert.equal(current().src, terminal.src);
    w.dispatchEvent(new w.CustomEvent('olon:pagechange', {detail: {id: 'dashboard'}}));
    assert.equal(current(), null, 'leaving removes the provider frame');
    enter();
    portal.classList.add('hidden');
    await Promise.resolve();
    assert.equal(current(), null, 'logging out removes the provider frame');
  } finally {
    dom.window.close();
  }
});
