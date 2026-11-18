"""Read-only historical market download and isolated 14/30-day in-memory replay."""
from datetime import datetime,timezone
import json
import math
import os
from pathlib import Path
import sys
import time
from types import SimpleNamespace as NS
from gold_scalp_core import atomic
from gold_settings import load_gold_settings
from gold_replay import ReplayBroker,Replay

ROOT=Path(os.environ.get('LOCALAPPDATA',str(Path.home())))/'OLFX_MT5_BRIDGE'
DATA=ROOT/'backtests'


class ReadOnlyMarket:
    ALLOWED={'initialize','shutdown','terminal_info','account_info','symbol_select','symbol_info',
             'symbol_info_tick','copy_rates_range','copy_ticks_range','order_calc_margin','last_error'}
    def __init__(self,module):self.module=module
    def __getattr__(self,name):
        if name not in self.ALLOWED:raise RuntimeError('BACKTEST_READ_ONLY_API')
        return getattr(self.module,name)


def backtest_window(days, now=None):
    if type(days) is not int or days not in (14,30):
        raise RuntimeError('INVALID_BACKTEST_DAYS')
    end_utc=int(time.time() if now is None else now)//300*300
    return end_utc-days*86400,end_utc


def run(jid,days=30):
    import bridge_agent as api
    import MetaTrader5 as module
    market=ReadOnlyMarket(module)
    folder=DATA/jid;folder.mkdir(parents=True,exist_ok=True)
    lock=api.singleton(DATA)
    def progress(phase,**fields):
        atomic(folder/'progress.json',{'schema':1,'job_id':jid,'phase':phase,'strategy':'MARKET_STRUCTURE_M5_RETEST_TP1','updated_at':time.time(),**fields})
    try:
        progress('CONNECTING_READ_ONLY')
        terminal=api.owned_terminal(ROOT)
        if not market.initialize(str(terminal/'terminal64.exe'),timeout=60000,portable=True):raise RuntimeError('BACKTEST_MT5_ATTACH_FAILED')
        info=market.terminal_info();account=market.account_info()
        if info is None or Path(info.path).resolve()!=terminal.resolve() or Path(info.data_path).resolve()!=terminal.resolve():
            raise RuntimeError('BACKTEST_WRONG_TERMINAL')
        if account is None or account.trade_mode!=0:raise RuntimeError('BACKTEST_EXPECTED_DEMO')
        if account.currency!='USD':raise RuntimeError('BACKTEST_USD_ACCOUNT_REQUIRED')
        pin=json.loads((ROOT/'gold-scalp-m1'/'account-pin.json').read_text())
        if str(account.login)!=str(pin['login']) or account.server!=pin['server']:raise RuntimeError('BACKTEST_ACCOUNT_CHANGED')
        config=load_gold_settings(ROOT);symbol=config['symbol']
        if not market.symbol_select(symbol,True):raise RuntimeError('BACKTEST_SYMBOL_UNAVAILABLE')
        health=json.loads((ROOT/'gold-scalp-m1'/'health.json').read_text())
        offset=health.get('broker_clock_offset_seconds')
        if offset is None:
            tick=market.symbol_info_tick(symbol)
            if tick is None or abs(time.time()-tick.time)>10:raise RuntimeError('BACKTEST_CLOCK_NOT_VERIFIED')
            offset=0
        start_utc,end_utc=backtest_window(days)
        start,end=start_utc-offset,end_utc-offset
        progress('FETCHING_M1_HISTORY',requested_days=days)
        rows=market.copy_rates_range(symbol,module.TIMEFRAME_M1,int(start-5*86400),int(end-60))
        if rows is None or len(rows)<100:raise RuntimeError('BACKTEST_INSUFFICIENT_M1_HISTORY')
        rows=[{k:int(r[k]) if k=='time' else float(r[k]) for k in ('time','open','high','low','close')} for r in rows]
        rows.sort(key=lambda r:r['time'])
        raw_m5=market.copy_rates_range(symbol,module.TIMEFRAME_M5,int(start-10*86400),int(end-300))
        if raw_m5 is None or len(raw_m5)<512:raise RuntimeError("BACKTEST_NATIVE_M5_HISTORY_REQUIRED")
        native_m5=[{k:int(r[k]) if k=="time" else float(r[k]) for k in ("time","open","high","low","close")} for r in raw_m5]
        native_m5.sort(key=lambda r:r["time"])
        if len([r for r in native_m5 if r["time"]+300<=start])<512:
            raise RuntimeError("BACKTEST_NATIVE_M5_WARMUP_INCOMPLETE")
        meta=market.symbol_info(symbol)
        if meta is None or meta.currency_base!='XAU' or meta.currency_profit!='USD':raise RuntimeError('BACKTEST_SYMBOL_METADATA_INVALID')
        names=('currency_base','currency_profit','trade_stops_level','point','trade_tick_size','digits',
               'volume_min','volume_max','volume_step','filling_mode','trade_exemode','trade_contract_size')
        metadata=NS(**{k:getattr(meta,k) for k in names})
        tick=market.symbol_info_tick(symbol)
        margin=market.order_calc_margin(0,symbol,meta.volume_min,tick.ask) if tick is not None else None
        ratio=margin/(meta.volume_min*tick.ask) if margin is not None and tick.ask>0 else 0.
        broker=ReplayBroker(rows,metadata,folder,offset=offset,margin_ratio=ratio,native_m5=native_m5)
        replay=Replay(broker,config,folder)
        expected_minutes={r['time'] for r in rows if start<=r['time']<end}
        expected_m5={stamp//300*300 for stamp in expected_minutes}
        missing_m5=expected_m5-{r['time'] for r in native_m5}
        chunks=0;empty_chunks=0;cursor=start
        while cursor<end:
            stop=min(cursor+6*3600,end)
            progress('REPLAYING_REAL_TICKS',requested_days=days,progress_percent=round(100*(cursor-start)/(end-start),2),
                     chunks=chunks,closed_trades=len(broker.closed),ticks=replay.tick_count)
            ticks=market.copy_ticks_range(symbol,int(cursor),int(stop),module.COPY_TICKS_ALL)
            if ticks is None:
                time.sleep(1)
                ticks=market.copy_ticks_range(symbol,int(cursor),int(stop),module.COPY_TICKS_ALL)
            if ticks is None:raise RuntimeError('BACKTEST_TICK_HISTORY_UNAVAILABLE')
            if not len(ticks):empty_chunks+=1
            for tick in ticks:
                stamp=float(tick['time_msc'])/1000 if 'time_msc' in ticks.dtype.names and tick['time_msc'] else float(tick['time'])
                if cursor<=stamp<stop:replay.tick(stamp,float(tick['bid']),float(tick['ask']))
            chunks+=1;cursor=stop
        metrics=replay.metrics()
        missing=len(expected_minutes-replay.covered)
        complete=bool(expected_minutes) and missing==0 and not missing_m5 and replay.history_skips==0 and min(expected_minutes)<=start+3*86400 and max(expected_minutes)>=end-3*86400
        result={'schema':1,'code':f'BACKTEST_{days}D_COMPLETE','job_id':jid,'model':'historical bid/ask ticks; native broker closed M5 structure, BOS and later retest; unchanged production entry engine; TP1 1R', 'strategy':'MARKET_STRUCTURE_M5_RETEST_TP1',
                'symbol':symbol,'period':'M5','days_requested':days,
                'start_utc':datetime.fromtimestamp(start_utc,timezone.utc).isoformat(),
                'end_utc':datetime.fromtimestamp(end_utc,timezone.utc).isoformat(),
                'config':config,'rr':1,'hold_seconds':0,'entry_limit':None,'close_policy':'BROKER_SL_TP_ONLY',
                'starting_balance_usd':10000,'historical_spread':True,'commission_mode':'not modeled',
                'swap_mode':'not modeled','margin_model':'current broker terms' if ratio else 'not modeled',
                'execution_model':'market entry at first polled quote after signal; gap SL at quote; TP at level',
                'coverage_complete':complete,'m1_minutes':len(expected_minutes),'missing_tick_minutes':missing,
                'tick_coverage_percent':round(100*(len(expected_minutes)-missing)/len(expected_minutes),4) if expected_minutes else 0,
                'empty_6h_chunks':empty_chunks,'native_m5_bars':len(native_m5),'missing_native_m5_bars':len(missing_m5),'strategy_version':'1.0.24','metrics':metrics}
        atomic(folder/'result.json',result)
        progress('COMPLETE',result=result)
        print(f'OLFX BACKTEST {days}D COMPLETO: '+str(metrics['win_rate_percent'])+'% | cerradas '+str(metrics['closed_trades']),flush=True)
    except Exception as exc:
        code=str(exc) if isinstance(exc,RuntimeError) else 'BACKTEST_LOCAL_ERROR_'+type(exc).__name__
        progress('FAILED',code=code)
        print('OLFX BACKTEST: '+code,flush=True)
    finally:
        market.shutdown();lock.close()


if __name__=='__main__':
    import argparse
    import re
    parser=argparse.ArgumentParser()
    parser.add_argument('job_id')
    parser.add_argument('--days',type=int,choices=(14,30),default=30)
    args=parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',args.job_id):raise SystemExit('INVALID_BACKTEST_ID')
    run(args.job_id,args.days)
