// Only public CFTC snapshots, served from this portal. No broker keys or market feeds.
export const MARKETS = Object.freeze({
  GC: {code: '088691', label: 'XAUUSD', name: 'GOLD FUTURES', exchange: 'COMEX', unit: '100 oz troy'},
  NQ: {code: '209742', label: 'NASDAQ', name: 'NQ FUTURES', exchange: 'CME', unit: 'USD 20 × índice'}
});
export const PAGE_SIZE = 13;
export const CACHE_TTL = 15 * 60 * 1000;
const MAX_BYTES = 32 * 1024;
const MAX_PAGES = 4;
const snapshots = new Map(); // At most 8 small pages; never account or student data.

function integer(value, signed = false) {
  return Number.isSafeInteger(value) && (signed || value >= 0);
}
function dateOnly(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function validateSnapshot(data, market, page) {
  if (!Object.hasOwn(MARKETS, market) || !integer(page) || page >= MAX_PAGES || !data ||
    data.schemaVersion !== 1 || data.market !== market || data.cftcCode !== MARKETS[market].code ||
    data.source !== 'CFTC' || data.dataset !== '6dca-aqww' || data.reportType !== 'FUTURES_ONLY' ||
    data.scope !== 'ALL_CONTRACT_MONTHS' || data.page !== page || data.pageSize !== PAGE_SIZE ||
    !(data.nextPage === null || (data.nextPage === page + 1 && data.nextPage < MAX_PAGES)) ||
    !dateOnly(data.latestReportDate) || Date.parse(data.latestReportDate) > Date.now() || !Number.isFinite(Date.parse(data.checkedAt)) || Date.parse(data.checkedAt) > Date.now() + 300000 ||
    !Array.isArray(data.records) || !data.records.length || data.records.length > PAGE_SIZE) {
    throw new Error('El archivo de la fuente no es válido.');
  }
  let previous = '9999-12-31';
  for (const row of data.records) {
    if (!dateOnly(row.date) || row.date > data.latestReportDate || row.date >= previous || Date.parse(row.date) > Date.now() ||
      !integer(row.openInterest) || !integer(row.changeOpenInterest, true)) {
      throw new Error('La fuente contiene registros inválidos.');
    }
    previous = row.date;
  }
  return data;
}

export function sourceState(data, now = Date.now()) {
  if (!data) return 'OFFLINE';
  return now - Date.parse(data.checkedAt) > 3 * 86400000 ||
    now - Date.parse(data.latestReportDate) > 14 * 86400000 ? 'OFFLINE' : 'HISTORICAL';
}

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, {once: true});
  });
}

export function createSnapshotClient({fetcher = globalThis.fetch, cache = snapshots, retryDelay = 1000,
  timeout = 8000, now = () => Date.now()} = {}) {
  const lifetime = new AbortController();
  const pending = new Map();
  let disposed = false;

  async function request(market, page) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const requestController = new AbortController();
      const cancel = () => requestController.abort();
      lifetime.signal.addEventListener('abort', cancel, {once: true});
      const timer = setTimeout(cancel, timeout);
      try {
        if (disposed) throw new DOMException('Aborted', 'AbortError');
        const url = new URL(`./data/${market}/${page}.json`, import.meta.url);
        const response = await fetcher(url, {signal: requestController.signal, cache: 'no-cache', credentials: 'omit'});
        if (!response.ok) {
          const error = new Error('No se pudo consultar la fuente compartida.');
          error.retryable = response.status === 429 || response.status >= 500;
          throw error;
        }
        if (!response.headers.get('content-type')?.includes('application/json') ||
          Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Respuesta de la fuente inválida.');
        const body = await response.text();
        if (body.length > MAX_BYTES) throw new Error('La respuesta excede el límite de datos.');
        const data = validateSnapshot(JSON.parse(body), market, page);
        if (disposed) throw new DOMException('Aborted', 'AbortError');
        return data;
      } catch (error) {
        if (disposed || lifetime.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (attempt || error.retryable === false || error instanceof SyntaxError ||
          /inválid|válido|límite/.test(error.message)) throw error;
      } finally {
        clearTimeout(timer);
        lifetime.signal.removeEventListener('abort', cancel);
      }
      await pause(retryDelay, lifetime.signal);
    }
  }

  return {
    load(market, page = 0, {force = false} = {}) {
      if (disposed) return Promise.reject(new DOMException('Aborted', 'AbortError'));
      if (!Object.hasOwn(MARKETS, market) || !integer(page) || page >= MAX_PAGES) return Promise.reject(new Error('Mercado o página inválidos.'));
      const key = `${market}:${page}`;
      if (pending.has(key)) return pending.get(key);
      const saved = cache.get(key);
      if (!force && saved && now() - saved.savedAt < CACHE_TTL) return Promise.resolve(saved.data);
      const job = request(market, page).then(data => {
        cache.delete(key);
        cache.set(key, {data, savedAt: now()});
        while (cache.size > 8) cache.delete(cache.keys().next().value);
        return data;
      }).finally(() => pending.delete(key));
      pending.set(key, job);
      return job;
    },
    dispose() { disposed = true; lifetime.abort(); pending.clear(); },
    get pendingCount() { return pending.size; }
  };
}
