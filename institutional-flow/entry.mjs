import {MARKETS, createSnapshotClient, sourceState} from './data-client.mjs';

const stylesheetURL = new URL('./terminal.css?v=1', import.meta.url);
let stylePromise;
function styles(signal) {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  if (!stylePromise) stylePromise = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = stylesheetURL.href;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); link.onload = null; link.onerror = null; };
    const abort = () => { cleanup(); link.remove(); stylePromise = null; reject(new DOMException('Aborted', 'AbortError')); };
    const fail = () => { cleanup(); link.remove(); stylePromise = null; reject(new Error('No se pudo cargar el diseño.')); };
    const timer = setTimeout(fail, 10000);
    link.onload = () => { cleanup(); resolve(); };
    link.onerror = fail;
    signal?.addEventListener('abort', abort, {once: true});
    document.head.appendChild(link);
  });
  return stylePromise;
}
export async function prepare(signal) { await styles(signal); }

const number = n => n.toLocaleString('en-US');
const date = value => new Intl.DateTimeFormat('es-PR', {day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC'}).format(new Date(value));
function el(tag, text = '', className = '') {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
function svgNode(tag, attributes) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}
function drawOpenInterest(target, rows) {
  target.replaceChildren();
  const data = [...rows].reverse(), values = data.map(row => row.openInterest);
  const low = Math.min(...values), high = Math.max(...values), span = Math.max(1, high - low);
  const svg = svgNode('svg', {viewBox: '0 0 720 240', role: 'img', 'aria-label': `Open Interest semanal: ${date(data[0].date)} a ${date(data.at(-1).date)}. Tabla de valores debajo.`});
  for (let i = 0; i < 4; i++) {
    const y = 22 + i * 56;
    svg.appendChild(svgNode('line', {x1: 0, x2: 620, y1: y, y2: y, class: 'if-grid-line'}));
    const label = svgNode('text', {x: 632, y: y + 4, class: 'if-axis'});
    label.textContent = number(Math.round(high - span * i / 3)); svg.appendChild(label);
  }
  const points = data.map((row, i) => `${data.length === 1 ? 310 : 12 + i / (data.length - 1) * 595},${190 - (row.openInterest - low) / span * 168}`);
  svg.appendChild(svgNode('polyline', {points: points.join(' '), class: 'if-chart-line'}));
  for (const point of points) {
    const [cx, cy] = point.split(','); svg.appendChild(svgNode('circle', {cx, cy, r: 3, class: 'if-chart-dot'}));
  }
  for (const [x, row, anchor] of [[12, data[0], 'start'], [607, data.at(-1), 'end']]) {
    const label = svgNode('text', {x, y: 224, 'text-anchor': anchor, class: 'if-axis'});
    label.textContent = date(row.date); svg.appendChild(label);
  }
  target.appendChild(svg);
}

// One mount owns all requests, handlers and DOM. destroy() is safe to call repeatedly.
export function mount(root) {
  const lifetime = new AbortController(), client = createSnapshotClient();
  const signal = lifetime.signal;
  let market = Object.hasOwn(MARKETS, root.dataset.market) ? root.dataset.market : 'GC';
  let page = 0, snapshot = null, destroyed = false, generation = 0, loading = false, failed = false;
  root.innerHTML = `
    <div class="if-terminal">
      <header class="if-header"><div><p class="if-eyebrow">OLON SOCIETY ACADEMY / RESEARCH TERMINAL</p><h2>OLFX <span>INSTITUTIONAL</span><br>CONTRACT FLOW</h2><p class="if-intro">Contratos reales. Fuente visible. Contexto verificable.</p></div><div class="if-session"><span class="if-status" data-state="OFFLINE" data-if="status">OFFLINE</span><small data-if="status-note">Consultando fuente</small></div></header>
      <div class="if-market-switch" role="group" aria-label="Seleccionar mercado">
        <button type="button" data-market="GC"><span class="if-market-symbol">XAUUSD <small>GC</small></span><span>GOLD FUTURES · COMEX</span></button>
        <button type="button" data-market="NQ"><span class="if-market-symbol">NASDAQ <small>NQ</small></span><span>NQ FUTURES · CME</span></button>
      </div>
      <p class="if-context" data-if="context"></p>
      <div class="if-toolbar"><span data-if="report">OPEN INTEREST / SEMANAL</span><button type="button" data-if="refresh">↻ Actualizar</button></div>
      <p class="if-feedback" data-if="feedback" role="status" aria-live="polite"></p>
      <div class="if-metrics">
        <article class="if-metric"><h3>Contract Volume Monitor</h3><strong>—</strong><small class="if-unavailable">NO DISPONIBLE</small><p>Requiere volumen negociado de futuros.</p></article>
        <article class="if-metric"><h3>Buyers vs Sellers</h3><strong>— / —</strong><small class="if-unavailable">NO DISPONIBLE</small><p>Requiere operaciones con lado agresor.</p></article>
        <article class="if-metric"><h3>Cumulative Volume Delta</h3><strong>—</strong><small class="if-unavailable">NO DISPONIBLE</small><p>Requiere volumen ejecutado en bid/ask.</p></article>
        <article class="if-metric if-oi-metric"><h3>Open Interest · COT</h3><strong data-if="oi">—</strong><small data-if="oi-change">Fuente CFTC · semanal</small><p>Contratos abiertos · todos los vencimientos</p></article>
      </div>
      <div class="if-analysis">
        <section class="if-panel if-history"><div class="if-panel-head"><h3>Open Interest <span>/ HISTORICAL</span></h3><small data-if="period">13 informes por página</small></div><p class="if-panel-note">Interés abierto agregado de futuros. Cada punto representa un informe semanal COT.</p><div class="if-chart" data-if="chart"><p>Esperando datos oficiales.</p></div>
          <div class="if-pagination"><button type="button" data-if="newer">← Más recientes</button><span data-if="page">Página 1</span><button type="button" data-if="older">Anteriores →</button></div>
          <details class="if-data-table"><summary>Ver registros y cambio semanal de OI</summary><div class="if-table-scroll"><table><caption>Fuente: CFTC · Legacy Futures Only · Todos los vencimientos</caption><thead><tr><th scope="col">Fecha del informe</th><th scope="col">Open Interest</th><th scope="col">Cambio OI</th></tr></thead><tbody data-if="rows"></tbody></table></div></details>
        </section>
        <aside class="if-panel if-sources"><div class="if-panel-head"><h3>DATA SOURCES</h3><small>01 / REGISTRO</small></div>
          <div class="if-source"><div><b>CFTC / COT</b><span class="if-status" data-state="OFFLINE" data-if="source-status">OFFLINE</span></div><p>Interés abierto de GC y NQ. Futures only. Periodicidad semanal.</p><small data-if="checked">Sin verificación</small></div>
          <div class="if-source"><div><b>COMEX / GC</b><span class="if-status" data-state="OFFLINE">OFFLINE</span></div><p>Flujo por operación sin conectar. Redistribución pendiente de licencia.</p></div>
          <div class="if-source"><div><b>CME / NQ</b><span class="if-status" data-state="OFFLINE">OFFLINE</span></div><p>Flujo por operación sin conectar. Redistribución pendiente de licencia.</p></div>
          <p class="if-source-foot">Sin servicios de pago conectados.</p>
        </aside>
      </div>
      <div class="if-capabilities">
        <section class="if-panel"><div class="if-panel-head"><h3>Volume Profile</h3><small class="if-unavailable">NO DISPONIBLE</small></div><div class="if-levels"><div><span>POC</span><strong>—</strong></div><div><span>VAH</span><strong>—</strong></div><div><span>VAL</span><strong>—</strong></div></div><p>Requiere volumen ejecutado por precio y una sesión definida. No se estima con velas.</p></section>
        <section class="if-panel"><div class="if-panel-head"><h3>Posibles zonas</h3><small class="if-unavailable">NO DISPONIBLE</small></div><ul class="if-zone-list"><li>Absorción <span>—</span></li><li>Acumulación <span>—</span></li><li>Distribución <span>—</span></li></ul><p>Requiere operaciones y contexto de precio verificables. El COT no permite localizar estas zonas.</p></section>
        <section class="if-panel"><div class="if-panel-head"><h3>Alertas de volumen anormal</h3><small class="if-unavailable">NO DISPONIBLE</small></div><p class="if-empty-alert">Sin fuente de volumen intradía</p><p>No se generan alertas sin un historial comparable y datos válidos.</p></section>
      </div>
      <details class="if-method"><summary>Fuentes, alcance y estados de conexión</summary><p>El COT registra posiciones abiertas semanales, normalmente del martes y publicadas el viernes. No mide volumen negociado, compradores agresores, delta intradía ni identifica la intención de cada institución. El interés abierto de futuros no es el volumen spot de XAUUSD ni del CFD de NASDAQ.</p><p>LIVE = flujo en tiempo real autorizado; DELAYED = flujo autorizado con retraso indicado; HISTORICAL = informes fechados; OFFLINE = fuente sin conexión o verificación reciente. Los informes antiguos conservan su fecha al navegar.</p><p>Reconocimiento: Commodity Futures Trading Commission (CFTC), datos gubernamentales de dominio público. GC: código 088691. NQ: código 209742. Dataset 6dca-aqww, Legacy Futures Only. Unidades en contratos.</p><p><a href="https://publicreporting.cftc.gov/Commitments-of-Traders/Legacy-Futures-Only/6dca-aqww" target="_blank" rel="noopener noreferrer">Dataset CFTC ↗</a> · <a href="https://www.cftc.gov/WebPolicy/index.htm" target="_blank" rel="noopener noreferrer">Condiciones CFTC ↗</a> · <a href="https://www.cmegroup.com/market-data/license-data.html" target="_blank" rel="noopener noreferrer">Licencias CME ↗</a></p></details>
      <footer class="if-footer"><span>OLFX / INSTITUTIONAL CONTRACT FLOW</span><span>HISTORICAL RESEARCH · GC + NQ</span></footer>
    </div>`;
  const find = name => root.querySelector(`[data-if="${name}"]`);
  const on = (target, event, handler) => target.addEventListener(event, handler, {signal});
  const feedback = text => { find('feedback').textContent = text; find('feedback').hidden = !text; };
  function updateButtons() {
    find('refresh').disabled = loading;
    find('newer').disabled = loading || page === 0;
    find('older').disabled = loading || snapshot?.nextPage == null || failed;
    for (const button of root.querySelectorAll('[data-market]')) {
      button.setAttribute('aria-pressed', String(button.dataset.market === market));
    }
  }
  function state(value, note) {
    for (const name of ['status', 'source-status']) { const target = find(name); target.textContent = value; target.dataset.state = value; }
    find('status-note').textContent = note;
  }
  function clearData() {
    snapshot = null;
    find('oi').textContent = '—'; find('oi-change').textContent = 'Fuente CFTC · semanal';
    find('checked').textContent = 'Sin verificación'; find('report').textContent = 'OPEN INTEREST / SEMANAL';
    find('period').textContent = '13 informes por página';
    find('chart').replaceChildren(el('p', 'Esperando datos oficiales.')); find('rows').replaceChildren();
    state('OFFLINE', 'Consultando fuente');
  }
  function render(data) {
    const latest = data.records[0], status = sourceState(data);
    state(status, status === 'OFFLINE' ? 'Último archivo histórico · verificar fuente' : 'CFTC · informes semanales');
    find('report').textContent = `COT / INFORME DEL ${date(latest.date).toUpperCase()}`;
    find('oi').textContent = number(latest.openInterest);
    find('oi-change').textContent = `${latest.changeOpenInterest > 0 ? '+' : ''}${number(latest.changeOpenInterest)} contratos / cambio semanal OI`;
    find('checked').textContent = `Fuente verificada: ${date(data.checkedAt)}`;
    find('period').textContent = `${date(data.records.at(-1).date)} — ${date(latest.date)}`;
    drawOpenInterest(find('chart'), data.records);
    find('rows').replaceChildren(...data.records.map(row => {
      const tr = document.createElement('tr'); tr.append(el('th', date(row.date)), el('td', number(row.openInterest)), el('td', `${row.changeOpenInterest > 0 ? '+' : ''}${number(row.changeOpenInterest)}`));
      tr.firstChild.scope = 'row'; return tr;
    }));
    feedback(status === 'OFFLINE' ? 'El archivo histórico no tiene una verificación reciente. Comprueba las fechas antes de usarlo.' : '');
  }
  async function load({force = false} = {}) {
    const version = ++generation, requestedMarket = market, requestedPage = page;
    loading = true; failed = false; feedback('Consultando datos oficiales compartidos…'); updateButtons(); root.setAttribute('aria-busy', 'true');
    const info = MARKETS[market];
    find('context').textContent = `${info.label} → ${market} · ${info.exchange} · ${info.unit}. Análisis de futuros; todos los vencimientos agregados.`;
    find('page').textContent = `Página ${page + 1}`;
    try {
      const data = await client.load(requestedMarket, requestedPage, {force});
      if (destroyed || version !== generation) return;
      snapshot = data; render(data);
    } catch (error) {
      if (destroyed || version !== generation || error.name === 'AbortError') return;
      failed = true; state('OFFLINE', 'Sin conexión con la fuente compartida');
      feedback(snapshot ? 'No se pudo actualizar. Se conservan los informes históricos con su fecha. Pulsa Actualizar para reintentar.' : 'Datos no disponibles. Comprueba tu conexión y pulsa Actualizar para reintentar.');
      if (!snapshot) find('chart').replaceChildren(el('p', 'No hay datos verificados disponibles para esta consulta.'));
    } finally {
      if (!destroyed && version === generation) { loading = false; root.removeAttribute('aria-busy'); updateButtons(); }
    }
  }
  for (const button of root.querySelectorAll('[data-market]')) on(button, 'click', () => {
    if (market === button.dataset.market) return;
    market = button.dataset.market; root.dataset.market = market; page = 0; clearData(); void load();
  });
  on(find('refresh'), 'click', () => { if (!loading) void load({force: true}); });
  on(find('older'), 'click', () => { if (!loading && snapshot?.nextPage != null) { page = snapshot.nextPage; clearData(); void load(); } });
  on(find('newer'), 'click', () => { if (!loading && page > 0) { page--; clearData(); void load(); } });
  on(window, 'online', () => { if (failed && !loading) void load({force: true}); });
  on(window, 'offline', () => { failed = true; state('OFFLINE', 'Sin conexión de red'); feedback('Sin conexión. Los informes mostrados son históricos y conservan su fecha.'); });
  void load();
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true; generation++; lifetime.abort(); client.dispose();
      root.replaceChildren(); root.removeAttribute('aria-busy'); snapshot = null;
    }
  };
}
