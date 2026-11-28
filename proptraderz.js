/* Load the provider only while its page is open; portal credentials stay here. */
(() => {
  'use strict';
  const page = document.getElementById('propTraderzPage');
  const portal = document.getElementById('portal');
  if (!page || !portal) return;
  const tools = {
    analyzer: {name: 'Market Analyzer', url: 'https://www.proptraderz.com/market-direction-analyzer/'},
    terminal: {name: 'GEX Terminal', url: 'https://www.proptraderz.com/gex-terminal/'}
  };
  const host = document.getElementById('ptzFrameHost');
  const status = document.getElementById('ptzStatus');
  let selected = 'analyzer', frame = null, timer = null;
  const visible = () => !portal.classList.contains('hidden') && !page.classList.contains('hidden');
  function stop() {
    clearTimeout(timer);
    frame?.remove();
    frame = null;
    host.removeAttribute('aria-busy');
  }
  function open() {
    if (!visible() || frame) return;
    const subtitle = document.getElementById('pageSubtitle');
    if (subtitle) subtitle.textContent = 'GEX y Expected Move de PropTraderz dentro del portal.';
    const tool = tools[selected];
    status.textContent = 'Cargando ' + tool.name + '…';
    host.setAttribute('aria-busy', 'true');
    const next = document.createElement('iframe');
    next.title = tool.name + ' de PropTraderz';
    next.referrerPolicy = 'no-referrer';
    next.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads');
    next.setAttribute('allow', 'clipboard-write; fullscreen');
    next.addEventListener('load', () => {
      if (frame !== next) return;
      clearTimeout(timer);
      host.removeAttribute('aria-busy');
      status.textContent = 'Contenido de PropTraderz. Si la herramienta no aparece, pulsa Recargar.';
    });
    next.addEventListener('error', () => {
      if (frame !== next) return;
      clearTimeout(timer);
      host.removeAttribute('aria-busy');
      status.textContent = 'No se pudo abrir PropTraderz. Pulsa Recargar para reintentar.';
    });
    next.src = tool.url;
    frame = next;
    host.replaceChildren(next);
    timer = setTimeout(() => {
      if (frame !== next) return;
      host.removeAttribute('aria-busy');
      status.textContent = 'PropTraderz está tardando en responder. Puedes volver a intentar con Recargar.';
    }, 25000);
  }
  page.querySelectorAll('[data-ptz-tool]').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.ptzTool;
      if (!tools[key] || key === selected) return;
      selected = key;
      page.querySelectorAll('[data-ptz-tool]').forEach(item => {
        item.setAttribute('aria-pressed', String(item === button));
      });
      stop();
      open();
    });
  });
  document.getElementById('ptzReload').addEventListener('click', () => {stop(); open();});
  const fullscreen = document.getElementById('ptzFullscreen');
  if (!page.requestFullscreen) fullscreen.hidden = true;
  fullscreen.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement === page) await document.exitFullscreen();
      else await page.requestFullscreen();
    } catch {
      status.textContent = 'Este navegador no permite pantalla completa. Puedes continuar usando la herramienta aquí.';
    }
  });
  document.addEventListener('fullscreenchange', () => {
    const active = document.fullscreenElement === page;
    fullscreen.textContent = active ? 'Salir de pantalla completa' : 'Pantalla completa';
    fullscreen.setAttribute('aria-pressed', String(active));
  });
  window.addEventListener('olon:pagechange', event => {
    if (event.detail?.id === page.id) open();
    else stop();
  });
  new MutationObserver(() => {if (!visible()) stop(); else open();})
    .observe(portal, {attributes: true, attributeFilter: ['class']});
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', () => {if (visible()) open();});
})();
