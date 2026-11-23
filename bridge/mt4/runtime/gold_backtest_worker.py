"""Read-only MT5 history; production range strategy; isolated quote replay."""
from datetime import datetime, timezone, timedelta
import json
import os
from pathlib import Path
import sys
import time
from types import SimpleNamespace as NS
from gold_scalp_core import atomic
from gold_settings import load_gold_settings
from asset_spec import metadata_matches
from gold_replay import ReplayBroker, Replay
from range_1030 import STRATEGY, ny_local, window

ROOT = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'OLFX_MT5_BRIDGE'
DATA = ROOT / 'backtests'

class ReadOnlyMarket:
    ALLOWED = {'initialize','shutdown','terminal_info','account_info','symbol_select','symbol_info',
               'symbol_info_tick','copy_rates_range','copy_ticks_range','order_calc_margin','last_error'}
    def __init__(self, module): self.module = module
    def __getattr__(self, name):
        if name not in self.ALLOWED: raise RuntimeError('BACKTEST_READ_ONLY_API')
        return getattr(self.module, name)

def axi_offset(utc):
    # Axi official: GMT+3 during New York DST, GMT+2 during New York EST.
    return -10800 if ny_local(utc).utcoffset().total_seconds() == -14400 else -7200

def axi_utc(server):
    guess = float(server) - 7200
    return float(server) + axi_offset(guess)

def backtest_window(days, now=None):
    if type(days) is not int or days not in (14,30,60,90):
        raise RuntimeError('INVALID_BACKTEST_DAYS')
    local = ny_local(time.time() if now is None else now)
    end_day = local.date()
    start_day = end_day - timedelta(days=days)
    def midnight(day):
        noon = datetime(day.year, day.month, day.day, 12, tzinfo=timezone.utc).timestamp()
        return int(ny_local(noon).replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
    return midnight(start_day), midnight(end_day)

def fetch_m1(market, symbol, timeframe, query_start, query_end, progress):
    rows = []
    cursor = int(query_start)
    while cursor < query_end:
        stop = min(cursor + 7*86400, int(query_end))
        raw = None
        error_code = 0
        for attempt in range(3):
            progress('FETCHING_M1_HISTORY', history_progress_percent=round(100*(cursor-query_start)/(query_end-query_start),2),
                     retry=attempt, history_chunk_start_utc=datetime.fromtimestamp(axi_utc(cursor),timezone.utc).isoformat())
            raw = market.copy_rates_range(symbol, timeframe, cursor, stop-1)
            if raw is not None and len(raw):
                break
            error = market.last_error()
            error_code = int(error[0]) if isinstance(error,(tuple,list)) and error else 0
            if attempt < 2: time.sleep(2)
        if raw is None or len(raw) == 0:
            raise RuntimeError('BACKTEST_M1_CHUNK_UNAVAILABLE_' + datetime.fromtimestamp(axi_utc(cursor),timezone.utc).strftime('%Y%m%d') + '_MT5_' + str(error_code))
        rows.extend(dict(time=int(axi_utc(r['time'])), **{k:float(r[k]) for k in ('open','high','low','close')}) for r in raw if cursor <= int(r['time']) < stop)
        cursor = stop
    if len(rows) < 100: raise RuntimeError('BACKTEST_INSUFFICIENT_M1_HISTORY')
    rows.sort(key=lambda r:r['time'])
    if any(a['time'] >= b['time'] for a,b in zip(rows, rows[1:])):
        raise RuntimeError('BACKTEST_NON_MONOTONIC_M1')
    return rows

def run(jid, days=30):
    import bridge_agent as api
    import MetaTrader5 as module
    market = ReadOnlyMarket(module)
    folder = DATA / jid
    folder.mkdir(parents=True, exist_ok=True)
    lock = api.singleton(DATA)
    def progress(phase, **fields):
        atomic(folder/'progress.json', dict(schema=1, job_id=jid, phase=phase,
               strategy=STRATEGY, updated_at=time.time(), **fields))
    try:
        progress('CONNECTING_READ_ONLY')
        terminal = api.owned_terminal(ROOT)
        if not market.initialize(str(terminal/'terminal64.exe'), timeout=60000, portable=True):
            raise RuntimeError('BACKTEST_MT5_ATTACH_FAILED')
        info, account = market.terminal_info(), market.account_info()
        if info is None or Path(info.path).resolve() != terminal.resolve() or Path(info.data_path).resolve() != terminal.resolve():
            raise RuntimeError('BACKTEST_WRONG_TERMINAL')
        if account is None or account.trade_mode != 0:
            raise RuntimeError('BACKTEST_EXPECTED_DEMO')
        if account.currency != 'USD': raise RuntimeError('BACKTEST_USD_ACCOUNT_REQUIRED')
        pin = json.loads((ROOT/'gold-scalp-m1'/'account-pin.json').read_text())
        if str(account.login) != str(pin['login']) or account.server != pin['server']:
            raise RuntimeError('BACKTEST_ACCOUNT_CHANGED')
        # Do not apply the Axi historical clock rule to a different broker.
        if 'axi' not in (str(account.server) + ' ' + str(getattr(account,'company',''))).lower():
            raise RuntimeError('BACKTEST_BROKER_DST_RULE_UNVERIFIED')
        config = load_gold_settings(ROOT)
        symbol = config['symbol']
        if not market.symbol_select(symbol, True): raise RuntimeError('BACKTEST_SYMBOL_UNAVAILABLE')
        health = json.loads((ROOT/'gold-scalp-m1'/'health.json').read_text())
        if health.get('broker_clock_offset_seconds') != axi_offset(time.time()):
            raise RuntimeError('BACKTEST_CURRENT_CLOCK_NOT_VERIFIED')
        start, end = backtest_window(days)
        progress('FETCHING_M1_HISTORY', requested_days=days)
        query_start, query_end = start - 5*86400 + 7200, end + 10800
        progress('FETCHING_M1_HISTORY', requested_days=days, terminal_maxbars=int(getattr(info,'maxbars',0)))
        rows = fetch_m1(market, symbol, module.TIMEFRAME_M1, query_start, query_end, progress)
        meta = market.symbol_info(symbol)
        if not metadata_matches(symbol, meta): raise RuntimeError('BACKTEST_SYMBOL_METADATA_INVALID')
        names = ('description','currency_base','currency_profit','trade_stops_level','point','trade_tick_size','digits',
                 'volume_min','volume_max','volume_step','filling_mode','trade_exemode','trade_contract_size')
        metadata = NS(**{k:getattr(meta,k) for k in names})
        quote = market.symbol_info_tick(symbol)
        margin = market.order_calc_margin(0, symbol, meta.volume_min, quote.ask) if quote is not None else None
        ratio = margin / (meta.volume_min*quote.ask) if margin is not None and quote.ask > 0 else 0.
        broker = ReplayBroker(rows, metadata, folder, offset=0, margin_ratio=ratio)
        replay = Replay(broker, config, folder)
        expected = {r['time'] for r in rows if start <= r['time'] < end}
        # Tick requests use broker timestamps; normalize each historical day to UTC.
        cursor, query_end = start + 7200, end + 10800
        first_cursor = cursor
        chunks = 0
        while cursor < query_end:
            stop = min(cursor+6*3600, query_end)
            progress('REPLAYING_REAL_TICKS', requested_days=days,
                     progress_percent=round(100*(cursor-first_cursor)/(query_end-first_cursor),2),
                     chunks=chunks, closed_trades=len(broker.closed), ticks=replay.tick_count)
            ticks = market.copy_ticks_range(symbol, int(cursor), int(stop), module.COPY_TICKS_ALL)
            if ticks is None: raise RuntimeError('BACKTEST_TICK_HISTORY_UNAVAILABLE')
            for tick in ticks:
                raw_stamp = float(tick['time_msc'])/1000 if 'time_msc' in ticks.dtype.names and tick['time_msc'] else float(tick['time'])
                if not cursor <= raw_stamp < stop: continue
                stamp = axi_utc(raw_stamp)
                if start <= stamp < end:
                    replay.tick(stamp, float(tick['bid']), float(tick['ask']))
            chunks += 1
            cursor = stop
        metrics = replay.metrics()
        missing = len(expected - replay.covered)
        required_days, missing_ranges = [], []
        day = ny_local(start).date()
        end_day = ny_local(end).date()
        while day < end_day:
            if day.weekday() < 5:
                noon = datetime(day.year,day.month,day.day,17,tzinfo=timezone.utc).timestamp()
                key, rs, re = window(noon)
                required_days.append(key)
                if not set(range(int(rs),int(re),60)) <= expected:
                    missing_ranges.append(key)
            day += timedelta(days=1)
        complete = bool(expected) and missing == 0 and not missing_ranges and min(expected) <= start+3*86400 and max(expected) >= end-3*86400
        result = dict(schema=1, code=f'BACKTEST_{days}D_COMPLETE', job_id=jid,
             strategy=STRATEGY, strategy_version='1.0.28', symbol=symbol, period='M1',
             model='historical bid/ask ticks; 1-second production polling; closed M1 range; SL 50%; TP1 1R',
             days_requested=days, start_utc=datetime.fromtimestamp(start,timezone.utc).isoformat(),
             end_utc=datetime.fromtimestamp(end,timezone.utc).isoformat(), config=config,
             range_timezone='America/New_York', range_start='10:30', range_end='10:45',
             historical_broker_clock_model='Axi GMT+2 EST / GMT+3 New York DST; verified broker identity and current offset',
             rr=1, hold_seconds=0, entry_limit=1, close_policy='BROKER_SL_TP_ONLY',
             starting_balance_usd=10000, historical_spread=True, commission_mode='not modeled',
             swap_mode='not modeled', margin_model='current broker terms' if ratio else 'not modeled',
             execution_model='market BUY at first polled bid above range; ask entry; gap SL at quote; TP at level',
             coverage_complete=complete, m1_minutes=len(expected), missing_tick_minutes=missing,
             tick_coverage_percent=round(100*(len(expected)-missing)/len(expected),4) if expected else 0,
             required_range_sessions=len(required_days), missing_range_dates=missing_ranges, metrics=metrics)
        atomic(folder/'trades.json', broker.closed)
        atomic(folder/'result.json', result)
        progress('COMPLETE', result=result)
        print(f"OLFX RANGO BACKTEST {days}D: {metrics['win_rate_percent']}% | cerradas {metrics['closed_trades']}", flush=True)
    except Exception as exc:
        code = str(exc) if isinstance(exc, RuntimeError) else 'BACKTEST_LOCAL_ERROR_' + type(exc).__name__
        progress('FAILED', code=code)
        print('OLFX BACKTEST: ' + code, flush=True)
    finally:
        market.shutdown()
        lock.close()

if __name__ == '__main__':
    import argparse
    import re
    parser=argparse.ArgumentParser()
    parser.add_argument('job_id')
    parser.add_argument('--days',type=int,choices=(14,30,60,90),default=30)
    args=parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',args.job_id): raise SystemExit('INVALID_BACKTEST_ID')
    run(args.job_id,args.days)
