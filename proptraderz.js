/* Read the provider's public WordPress content and show only its GEX pane.
   Provider scripts, event handlers and network-capable elements are never used. */
(() => {
  'use strict';
  const page = document.getElementById('propTraderzPage');
  const portal = document.getElementById('portal');
  if (!page || !portal) return;
  const endpoint = 'https://www.proptraderz.com/wp-json/wp/v2/pages/8263?_fields=content';
  const host = document.getElementById('ptzFrameHost');
  const status = document.getElementById('ptzStatus');
  const view = host.attachShadow({mode: 'open'});
  let pending = null, loaded = false;
  const visible = () => !portal.classList.contains('hidden') && !page.classList.contains('hidden');
  const safeStyle = value => !/url\s*\(|@import|expression\s*\(|<\/style/i.test(value);
  function sanitize(element) {
    const tags = new Set(['DIV', 'SPAN', 'BUTTON', 'P', 'SMALL', 'STRONG', 'B', 'BR', 'EM', 'H2', 'H3', 'H4']);
    element.querySelectorAll('script,style,iframe,object,embed,link,meta,svg,math,template,form,input,img,video,audio').forEach(node => node.remove());
    for (const node of [element, ...element.querySelectorAll('*')]) {
      if (!tags.has(node.tagName)) { node.replaceWith(...node.childNodes); continue; }
      for (const attr of [...node.attributes]) {
        if (!/^(id|class|style|title|role|tabindex|aria-[\w-]+|data-(copy|tip|dataset|gex-group))$/.test(attr.name) ||
            (attr.name === 'style' && !safeStyle(attr.value))) node.removeAttribute(attr.name);
      }
      if (node.tagName === 'BUTTON') node.type = 'button';
    }
    return element;
  }
  function render(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const pane = doc.querySelector('.nqp-tab-pane[id$="_gex"]');
    const source = pane?.parentElement;
    const css = [...doc.querySelectorAll('style')].find(node => node.textContent.includes('.nqp-gex-card'))?.textContent;
    if (!pane || !/^nqp_[a-z0-9]+$/i.test(source?.id || '') || !css || !safeStyle(css) || !pane.querySelector('.nqp-gex-card')) {
      throw new Error('La fuente cambió de formato.');
    }
    const style = document.createElement('style');
    style.textContent = css + '\n:host{display:block;color:#f0f0f8} button{font-family:inherit} button:focus-visible{outline:3px solid #25d5b5;outline-offset:2px} [id^="nqp_"] .nqp-tab-pane{display:block!important} [id^="nqp_"] .nqp-gex-lbl,[id^="nqp_"] .nqp-gex-lvl,[id^="nqp_"] .nqp-gex-val,[id^="nqp_"] .nqp-ds-pill,[id^="nqp_"] .nqp-gex-pill,[id^="nqp_"] .nqp-copy-btn{font-size:max(14px,1em)}';
    style.textContent += '\n[id^="nqp_"] .nqp-sec{padding:0;background:transparent;border:0;border-radius:0} [id^="nqp_"] .nqp-gex-card,[id^="nqp_"] .nqp-gex-em-box{border-radius:8px} [id^="nqp_"] .nqp-gex-pill,[id^="nqp_"] .nqp-ds-pill,[id^="nqp_"] .nqp-copy-btn{border-radius:5px}';
    style.textContent += '\n[id^="nqp_"] .nqp-copy-btn{margin:8px 8px 0 0}';
    style.textContent = style.textContent.replaceAll('[id^="nqp_"]', '#' + source.id);
    const root = document.createElement('div');
    root.id = source.id;
    const warning = [...source.children].find(node => /Data is .*old/.test(node.textContent) && !node.className);
    if (warning) root.append(sanitize(warning.cloneNode(true)));
    const content = sanitize(pane.cloneNode(true));
    content.classList.add('active');
    root.append(content);
    view.replaceChildren(style, root);
    const updateMarkets = () => {
      const group = root.querySelector('.nqp-gex-pill.active')?.dataset.gexGroup || 'futures';
      root.querySelectorAll('.nqp-gex-card[data-gex-group]').forEach(card => card.classList.toggle('gex-visible', card.dataset.gexGroup === group));
    };
    root.querySelectorAll('.nqp-gex-pill').forEach(button => button.addEventListener('click', () => {
      root.querySelectorAll('.nqp-gex-pill').forEach(item => {
        item.classList.toggle('active', item === button);
        item.setAttribute('aria-pressed', String(item === button));
      });
      updateMarkets();
    }));
    root.querySelectorAll('.nqp-ds-pill').forEach(button => button.addEventListener('click', () => {
      const dataset = button.dataset.dataset;
      root.querySelectorAll('.nqp-ds-pill').forEach(item => {
        item.classList.toggle('active', item === button);
        item.setAttribute('aria-pressed', String(item === button));
      });
      root.querySelectorAll('.nqp-ds-panel').forEach(panel => { panel.style.display = panel.id === root.id + '_ds_' + dataset ? '' : 'none'; });
      root.querySelectorAll('[id*="_ds_meta_"]').forEach(meta => { meta.style.display = meta.id === root.id + '_ds_meta_' + dataset ? 'flex' : 'none'; });
      updateMarkets();
    }));
    // The public content API omits the provider's page-level TradingView button.
    // Build the text export locally; never execute provider scripts.
    const numbers = value => (value.match(/[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?/g) || []).map(token => token.replaceAll(',', ''));
    function tradingViewExport(button) {
      const raw = button.dataset.copy || '';
      const ticker = raw.match(/──\s*([A-Z0-9!]+)\s+KEY LEVELS/i)?.[1]?.toUpperCase();
      if (!ticker) return '';
      const rows = [];
      const add = (color, pattern, label, values) => {if (values.length) rows.push([ticker, color, pattern, '-2', label, ...values].join(',') + ';');};
      const types = {
        'GEX FLIP': ['yellow', 'dashed', 'GEX Flip', true],
        'GEX FLIP 0DTE': ['yellow', 'dotted', 'GEX Flip 0DTE', true],
        'CALL RESISTANCE': ['red', 'solid', 'Call Resistance'],
        'CALL RESISTANCE 0DTE': ['red', 'dotted', 'Call Res 0DTE'],
        'PUT SUPPORT': ['lime', 'solid', 'Put Support'],
        'PUT SUPPORT 0DTE': ['lime', 'dotted', 'Put Sup 0DTE'],
        'RESISTANCE (NET GEX)': ['red', 'dashed', 'Resistance net GEX'],
        'SUPPORT (NET GEX)': ['lime', 'dashed', 'Support net GEX']
      };
      let period = '';
      for (const line of raw.split('\n')) {
        if (/^\s*Expected Move Daily/i.test(line)) {period = 'Daily'; continue;}
        if (/^\s*Expected Move Weekly/i.test(line)) {period = 'Weekly'; continue;}
        const split = line.indexOf(':');
        if (split < 0) continue;
        const key = line.slice(0, split).trim().toUpperCase();
        const values = numbers(line.slice(split + 1));
        const type = types[key];
        if (type) add(type[0], type[1], type[2], type[3] ? values.slice(0, 1) : values);
        else if (period && (key === 'HIGH' || key === 'LOW')) add(period === 'Daily' ? 'white' : 'orange', 'dashed', 'EM ' + period + ' ' + (key === 'HIGH' ? 'High' : 'Low'), values.slice(0, 1));
      }
      const extras = {
        VOLTRIGGER: ['yellow', 'solid', 'Vol Trigger'], RISKPIVOT: ['yellow', 'dashed', 'Risk Pivot'],
        CTRANS: ['red', 'dotted', 'cTrans'], PTRANS: ['lime', 'dotted', 'pTrans'],
        'DEXD+': ['aqua', 'dashed', 'DEX D+'], 'DEXD-': ['aqua', 'dashed', 'DEX D−'],
        CHARMMAGNET: ['fuchsia', 'dashed', 'Charm Magnet'], PINSTRIKE: ['fuchsia', 'solid', 'Pin Strike'], MAXPAIN: ['fuchsia', 'dotted', 'Max Pain']
      };
      button.closest('.nqp-gex-card')?.querySelectorAll('.nqp-gex-row').forEach(row => {
        const label = row.querySelector('.nqp-gex-lbl')?.cloneNode(true);
        label?.querySelectorAll('.nqp-tip').forEach(node => node.remove());
        const key = (label?.textContent || '').replaceAll('−', '-').replace(/[^a-z0-9+\-]/gi, '').toUpperCase();
        const type = extras[key];
        if (type) add(type[0], type[1], type[2], numbers(row.querySelector('.nqp-gex-val')?.textContent || '').slice(0, 1));
      });
      return rows.join('\n');
    }
    async function copyLevels(value, message) {
      if (!value) {status.textContent = 'Esta tarjeta no tiene niveles disponibles para copiar.'; return;}
      try {
        await navigator.clipboard.writeText(value);
        status.textContent = message;
      } catch { status.textContent = 'El navegador no permitió copiar los niveles. Revisa el permiso del portapapeles.'; }
    }
    root.querySelectorAll('.ptz-tv-btn').forEach(button => button.remove());
    root.querySelectorAll('.nqp-copy-btn').forEach(button => {
      button.addEventListener('click', () => copyLevels(button.dataset.copy || '', 'Bloque de niveles copiado para OLFX.'));
      if (!tradingViewExport(button)) return;
      const tvButton = document.createElement('button');
      tvButton.type = 'button';
      tvButton.className = 'nqp-copy-btn ptz-tv-btn';
      tvButton.textContent = '📈 Copy for TradingView';
      tvButton.title = 'Copia los niveles en formato TradingView, compatible con OLFX DATA V1.5';
      tvButton.addEventListener('click', () => copyLevels(tradingViewExport(button), 'Formato TradingView copiado. Pégalo en la DATA de OLFX V1.5 o en un indicador compatible.'));
      button.after(tvButton);
    });
    root.querySelector('.nqp-gex-pill.active')?.click();
    root.querySelector('.nqp-ds-pill.active')?.click();
    return source.querySelector('.nqp-hdr-sub')?.textContent.trim();
  }
  function stop() {
    pending?.abort(); pending = null; loaded = false;
    view.replaceChildren();
    host.removeAttribute('aria-busy');
  }
  async function open() {
    if (!visible() || pending || loaded) return;
    const controller = new AbortController();
    pending = controller;
    const timeout = setTimeout(() => controller.abort(), 25000);
    const subtitle = document.getElementById('pageSubtitle');
    if (subtitle) subtitle.textContent = 'OLFX Market Data · GEX Levels & Expected Move';
    status.textContent = 'Cargando GEX Levels & Expected Move…';
    host.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(endpoint, {signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store'});
      if (!response.ok) throw new Error('Fuente no disponible.');
      const data = await response.json();
      if (pending !== controller || !visible()) return;
      const updated = render(data?.content?.rendered || '');
      loaded = true;
      status.textContent = updated || 'GEX Levels & Expected Move · Fuente: PropTraderz.com';
    } catch {
      if (pending === controller) status.textContent = 'No se pudieron cargar los niveles de PropTraderz. Pulsa Recargar para reintentar.';
    } finally {
      clearTimeout(timeout);
      if (pending === controller) {pending = null; host.removeAttribute('aria-busy');}
    }
  }
  document.getElementById('ptzReload').addEventListener('click', () => {stop(); open();});
  const fullscreen = document.getElementById('ptzFullscreen');
  if (!page.requestFullscreen) fullscreen.hidden = true;
  fullscreen.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement === page) await document.exitFullscreen();
      else await page.requestFullscreen();
    } catch { status.textContent = 'Este navegador no permite pantalla completa. Puedes consultar los niveles aquí.'; }
  });
  document.addEventListener('fullscreenchange', () => {
    const active = document.fullscreenElement === page;
    fullscreen.textContent = active ? 'Salir de pantalla completa' : 'Pantalla completa';
    fullscreen.setAttribute('aria-pressed', String(active));
  });
  window.addEventListener('olon:pagechange', event => {if (event.detail?.id === page.id) open(); else stop();});
  new MutationObserver(() => {if (!visible()) stop(); else open();}).observe(portal, {attributes: true, attributeFilter: ['class']});
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', () => {if (visible()) open();});
})();
