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
  const visible = () => window.olfxMarketAccess?.allowed() === true && !portal.classList.contains('hidden') && !page.classList.contains('hidden');
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
    if (!pane || !/^nqp_[a-z0-9]+$/i.test(source?.id || '') || !pane.querySelector('.nqp-gex-card')) {
      throw new Error('La fuente cambió de formato.');
    }
    // OLFX owns the presentation. Only sanitized market content comes from the source.
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = './olfx-market-data.css?v=20261128-8';
    const root = document.createElement('div');
    root.id = source.id;
    root.className = 'olfxDataRoot';
    const warning = [...source.children].find(node => /Data is .*old/.test(node.textContent) && !node.className);
    if (warning) {
      const notice = sanitize(warning.cloneNode(true));
      notice.className = 'olfxDataNotice';
      notice.removeAttribute('style');
      root.append(notice);
    }
    const content = sanitize(pane.cloneNode(true));
    content.classList.add('active');
    content.querySelectorAll('[style]').forEach(node => node.removeAttribute('style'));
    const plainLabel = value => value.replace(/[\p{Extended_Pictographic}\uFE0F\u25B2\u25BC\u21E7\u21E9]/gu, '').trim();
    const groupLabels = {futures: 'Nasdaq / S&P 500', dow: 'Dow Jones', etf: 'ETFs', commodities: 'Commodities'};
    content.querySelector('.nqp-sec-hdr')?.remove();
    content.querySelectorAll('.nqp-gex-pill').forEach(button => {button.textContent = groupLabels[button.dataset.gexGroup] || plainLabel(button.textContent);});
    const datasetSelect = document.createElement('select');
    datasetSelect.className = 'olfxDatasetSelect';
    datasetSelect.setAttribute('aria-label', 'Conjunto de datos');
    const datasetNames = {production: 'Sesión del mercado', eod: 'Cierre · Experimental', intraday: 'Intradia · Experimental'};
    content.querySelectorAll('.nqp-ds-pill').forEach(button => {
      button.title = plainLabel(button.textContent);
      button.textContent = datasetNames[button.dataset.dataset] || button.title;
      const option = document.createElement('option'); option.value = button.dataset.dataset; option.textContent = button.textContent;
      option.selected = button.classList.contains('active'); datasetSelect.append(option);
    });
    datasetSelect.addEventListener('change', () => {
      [...root.querySelectorAll('.nqp-ds-pill')].find(button => button.dataset.dataset === datasetSelect.value)?.click();
    });
    content.querySelector('.nqp-dataset-bar')?.prepend(datasetSelect);
    content.querySelectorAll('.nqp-tip').forEach(tip => {
      tip.tabIndex = 0;
      tip.setAttribute('role', 'button');
      tip.setAttribute('aria-label', 'Información del nivel');
      tip.setAttribute('aria-expanded', 'false');
      const toggle = () => {tip.classList.toggle('olfxTipOpen'); tip.setAttribute('aria-expanded', String(tip.classList.contains('olfxTipOpen')));};
      tip.addEventListener('click', toggle);
      tip.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); toggle();}
        if (event.key === 'Escape') {tip.classList.remove('olfxTipOpen'); tip.setAttribute('aria-expanded', 'false');}
      });
    });
    content.querySelectorAll('.nqp-gex-card').forEach(card => {
      const price = card.querySelector('.nqp-gex-card-price');
      if (price) {
        const quote = price.textContent.match(/Price:\s*([0-9,.]+)/i)?.[1];
        const previous = price.textContent.match(/Prev Close:\s*([0-9,.]+)/i)?.[1];
        const description = price.textContent.split('•')[0].trim();
        price.replaceChildren();
        const name = document.createElement('span'); name.className = 'olfxMarketName'; name.textContent = description;
        const amount = document.createElement('strong'); amount.className = 'olfxQuote'; amount.textContent = quote || '—';
        const closing = document.createElement('span'); closing.className = 'olfxPrevious'; closing.textContent = previous ? 'Cierre anterior  ' + previous : 'Precio de referencia';
        price.append(name, amount, closing);
      }
      const badge = card.querySelector('.nqp-flip-badge');
      if (badge) {
        badge.textContent = plainLabel(badge.textContent);
        badge.dataset.tone = /bearish|below/i.test(badge.textContent) ? 'down' : /bullish|above/i.test(badge.textContent) ? 'up' : 'neutral';
      }
      card.querySelectorAll('.nqp-gex-lbl').forEach(label => {
        for (const node of label.childNodes) if (node.nodeType === Node.TEXT_NODE) node.textContent = plainLabel(node.textContent);
      });
      const body = card.querySelector('.nqp-gex-body');
      if (!body) return;
      const levels = document.createElement('div'); levels.className = 'olfxLevelsPanel';
      const heading = document.createElement('div'); heading.className = 'olfxLevelsHeading';
      const headingName = document.createElement('strong'); headingName.textContent = 'Mapa de niveles';
      const headingHint = document.createElement('span'); headingHint.textContent = 'Referencia · Precio';
      heading.append(headingName, headingHint); levels.append(heading);
      const aside = document.createElement('aside'); aside.className = 'olfxMarketAside'; aside.setAttribute('aria-label', 'Movimiento esperado y exportación');
      const asideTitle = document.createElement('h3'); asideTitle.textContent = 'Expected Move'; aside.append(asideTitle);
      const actions = document.createElement('div'); actions.className = 'olfxExportActions';
      const details = document.createElement('div'); details.className = 'olfxSourceNotes';
      for (const item of [...body.children]) {
        if (item.classList.contains('nqp-gex-em')) {
          item.querySelectorAll('.nqp-gex-em-levels').forEach(bounds => {
            for (const node of [...bounds.childNodes]) if (node.nodeType === Node.TEXT_NODE) node.remove();
          });
          aside.append(item);
        }
        else if (item.classList.contains('nqp-copy-btn')) actions.append(item);
        else if (item.classList.contains('nqp-gex-row')) {
          const label = item.querySelector('.nqp-gex-lbl')?.textContent || '';
          item.dataset.kind = /call|resistance/i.test(label) ? 'resistance' : /put|support/i.test(label) ? 'support' : /flip|trigger/i.test(label) ? 'pivot' : 'neutral';
          levels.append(item);
        } else if (/^(Dealer Levels|DEX Exposure|Pin Risk)$/i.test(item.textContent.trim())) {
          item.className = 'olfxGroupHeading'; levels.append(item);
        } else if (item.textContent.trim()) {item.className = 'olfxSourceNote'; details.append(item);}
      }
      const exportTitle = document.createElement('h3'); exportTitle.textContent = 'Llevar a tu gráfica';
      const exportNote = document.createElement('p'); exportNote.textContent = 'Copia la data de este mercado y pégala en tu indicador.';
      aside.append(exportTitle, exportNote, actions, details);
      body.classList.add('olfxMarketLayout'); body.replaceChildren(levels, aside);
    });
    root.append(content);
    view.replaceChildren(style, root);
    const instruments = document.createElement('div');
    instruments.className = 'olfxInstrumentNav';
    instruments.setAttribute('role', 'group'); instruments.setAttribute('aria-label', 'Seleccionar instrumento');
    content.querySelector('.nqp-gex-pills')?.after(instruments);
    const selectedInstruments = new Map();
    const updateMarkets = () => {
      const group = root.querySelector('.nqp-gex-pill.active')?.dataset.gexGroup || 'futures';
      const dataset = root.querySelector('.nqp-ds-pill.active')?.dataset.dataset || 'production';
      const currentPanel = [...root.querySelectorAll('.nqp-ds-panel')].find(panel => panel.id === root.id + '_ds_' + dataset);
      const choices = [...(currentPanel || content).querySelectorAll('.nqp-gex-card[data-gex-group]')].filter(card => card.dataset.gexGroup === group && card.querySelector('.nqp-gex-card-title'));
      const symbolOf = card => card.querySelector('.nqp-gex-card-title')?.textContent.trim();
      let selected = selectedInstruments.get(group);
      if (!choices.some(card => symbolOf(card) === selected)) selected = choices.length ? symbolOf(choices[0]) : null;
      if (selected) selectedInstruments.set(group, selected);
      instruments.replaceChildren();
      choices.forEach(card => {
        const symbol = symbolOf(card);
        const button = document.createElement('button'); button.type = 'button'; button.textContent = symbol;
        button.className = 'olfxInstrumentButton'; button.setAttribute('aria-pressed', String(symbol === selected));
        button.addEventListener('click', () => {selectedInstruments.set(group, symbol); updateMarkets();});
        instruments.append(button);
      });
      root.querySelectorAll('.nqp-gex-card[data-gex-group]').forEach(card => card.classList.toggle('gex-visible', card.dataset.gexGroup === group && (!selected || symbolOf(card) === selected)));
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
      datasetSelect.value = dataset;
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
    function tradingViewExport(raw, card) {
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
      card?.querySelectorAll('.nqp-gex-row').forEach(row => {
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
      const raw = button.dataset.copy || '';
      const card = button.closest('.nqp-gex-card');
      if (!tradingViewExport(raw, card)) {button.remove(); return;}
      const tvButton = document.createElement('button');
      tvButton.type = 'button';
      tvButton.className = 'nqp-copy-btn ptz-tv-btn';
      tvButton.textContent = 'Copy for TradingView';
      tvButton.title = 'Copia los niveles en formato TradingView, compatible con OLFX DATA V1.5';
      tvButton.addEventListener('click', () => copyLevels(tradingViewExport(raw, card), 'Formato TradingView copiado. Pégalo en la DATA de OLFX V1.5 o en un indicador compatible.'));
      button.replaceWith(tvButton);
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
    if (subtitle) subtitle.textContent = 'OLFX Market Data · Mesa de opciones';
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
  window.addEventListener('olfx:market-access', event => {if(event.detail?.allowed) open();else stop();});
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', () => {if (visible()) open();});
})();
