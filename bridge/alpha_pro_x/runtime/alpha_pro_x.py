"""ALPHA PRO X: deterministic closed-M5 signals, independent of broker execution.

Input times are UTC. The adapter explicitly converts the observed broker clock.
No MT5 import, networking, order placement, probability claims or simulated wins.
"""
from datetime import datetime, timedelta, timezone
import hashlib
import math

SESSIONS = {
    'XAUUSD': ((630,645),(1125,1200),(120,135)),
    'XCUUSD': ((575,585),(1160,1175),(60,90)),
    'NAS100': ((575,600),(1250,1260)),
    'DJ30': ((390,410),(1260,1270)),
    'XAGUSD': ((480,495),(1190,1200),(5,15)),
    'GBPUSD': ((590,605),(135,140)),
    'EURUSD': ((520,530),(10,15),(1140,1155)),
    'USDJPY': ((500,510),(1215,1235)),
    'EURJPY': ((560,570),(1080,1090),(75,80)),
    'USDCAD': ((570,585),(1140,1165)),
    'BTCUSD': ((480,500),(1140,1160)),
}
BUFFER = {'XAUUSD':.15,'XCUUSD':.005,'XAGUSD':.03,'NAS100':5.,'DJ30':20.,
          'GBPUSD':.00002,'EURUSD':.00002,'USDCAD':.00015,'USDJPY':.015,'EURJPY':.017,'BTCUSD':50.}
ADD_DIST = {'XAUUSD':.25,'XCUUSD':10/25000,'XAGUSD':15/5000,'NAS100':.5,
            'DJ30':1.,'GBPUSD':.0001,'EURUSD':.0001,'USDCAD':.0001,
            'USDJPY':10/9.1*.01,'EURJPY':10/9.1*.01,'BTCUSD':100.}


def new_york(stamp):
    """US DST rules 2007+, including Windows installations without tzdata."""
    utc = datetime.fromtimestamp(stamp,timezone.utc)
    if utc.year < 2007:
        raise ValueError('ALPHA_NY_YEAR_UNSUPPORTED')
    # Second Sunday March 07:00 UTC; first Sunday November 06:00 UTC.
    march = 1+(6-datetime(utc.year,3,1).weekday())%7+7
    nov = 1+(6-datetime(utc.year,11,1).weekday())%7
    start = datetime(utc.year,3,march,7,tzinfo=timezone.utc)
    end = datetime(utc.year,11,nov,6,tzinfo=timezone.utc)
    return utc.astimezone(timezone(timedelta(hours=-4 if start<=utc<end else -5)))


def session_at(stamp,asset):
    local = new_york(stamp)
    minute = local.hour*60+local.minute
    for begin,end in SESSIONS[asset]:
        if begin<=minute<end:
            midnight = local.replace(hour=0,minute=0,second=0,microsecond=0)
            return (int((midnight+timedelta(minutes=begin)).timestamp()),
                    int((midnight+timedelta(minutes=end)).timestamp()))
    return None


def asset_name(symbol):
    return next((a for a in SESSIONS if symbol.startswith(a)),None)


def ai_score(side,bar,hi,lo,atr,tick):
    rng = max(bar['high']-bar['low'],tick)
    body = abs(bar['close']-bar['open'])/rng
    strength = (bar['close']-bar['low'] if side>0 else bar['high']-bar['close'])/rng
    wick = (bar['high']-max(bar['open'],bar['close']) if side>0 else
            min(bar['open'],bar['close'])-bar['low'])/rng
    dist = max(bar['close']-hi if side>0 else lo-bar['close'],0.)
    ratio = dist/max(hi-lo,tick)
    aratio = dist/atr if atr else 0.
    return ((2 if body>=.55 else 1 if body>=.40 else 0)+
            (2 if strength>=.72 else 1 if strength>=.58 else 0)+
            (2 if ratio>=.10 else 1 if ratio>=.05 else 0)+
            (2 if aratio>=.15 else 1 if aratio>=.08 else 0)+
            (1 if wick<=.25 else -1 if wick>.45 else 0))


def alpha_context(rates,symbol='XAUUSD',tick=.01,mode='Continuation',ai='Normal',reverse=True):
    """Replay closed M5 bars, returning ONLY events from the last bar.

    SL touches resolve the idea conservatively before TP touches on ambiguous
    candles. They are signal-state transitions, never performance statistics.
    A fresh range is required in full; partial/missing session bars cannot trade.
    Each add-on is separate: it never rewrites the first order's SL/TP or entry.
    """
    out = {'state':'ALPHA_WAIT_SESSION','events':[]}
    asset = asset_name(symbol)
    if not asset:
        return {**out,'state':'ALPHA_UNSUPPORTED_SYMBOL'}
    if mode not in ('Continuation','Retest') or ai not in ('Normal','Strict','Off'):
        raise ValueError('ALPHA_INVALID_OPTIONS')
    if not isinstance(tick,(float,int)) or not math.isfinite(tick) or tick<=0:
        raise ValueError('ALPHA_INVALID_TICK')
    bars = list(reversed(rates))
    if len(bars)<15:
        return {**out,'state':'ALPHA_WAIT_HISTORY'}
    times = [b['time'] for b in bars]
    if any(type(t) is not int or t%300 for t in times) or any(a>=b for a,b in zip(times,times[1:])):
        return {**out,'state':'ALPHA_INVALID_HISTORY'}
    for b in bars:
        vals = [b[k] for k in ('open','high','low','close')]
        if any(not math.isfinite(v) or v<=0 for v in vals) or not b['low']<=min(b['open'],b['close'])<=max(b['open'],b['close'])<=b['high']:
            return {**out,'state':'ALPHA_INVALID_HISTORY'}
    session = None
    group = []
    locked = None
    idea = None
    used = False
    trseed = []
    atr = None
    for i,b in enumerate(bars):
        stamp = b['time']
        prev = bars[i-1] if i else b
        tr = max(b['high']-b['low'],abs(b['high']-prev['close']),abs(b['low']-prev['close']))
        if atr is None:
            trseed.append(tr)
            if len(trseed)==14: atr=sum(trseed)/14
        else:
            atr=(13*atr+tr)/14
        active = session_at(stamp,asset)
        if active:
            if active!=session:
                session,group,locked,idea,used=active,[],None,None,False
            group.append(b)
            out['state']='ALPHA_BUILDING_RANGE'
            continue
        if session and group:
            begin,end=session
            if [r['time'] for r in group] != list(range(begin,end,300)):
                locked=None
                out['state']='ALPHA_INCOMPLETE_SESSION'
            else:
                locked=(max(r['high'] for r in group)+BUFFER[asset],
                        min(r['low'] for r in group)-BUFFER[asset],end,i)
            group=[]
        if not locked or atr is None:
            continue
        hi,lo,end,end_index=locked
        in_window=0<=i-end_index<=60
        # No add-on or reversal can come from a stale bar after a data gap.
        contiguous=i>0 and stamp-prev['time']==300
        if not contiguous:
            idea=None
            used=True
            out['state']='ALPHA_HISTORY_GAP'
            continue
        side=0
        kind='main'
        # A reversal signals an additional opposite trade; never a close command.
        if reverse and idea and not idea['resolved'] and in_window:
            if idea['side']<0 and b['close']>hi: side=1
            if idea['side']>0 and b['close']<lo: side=-1
            if side: kind='reverse'
        if idea and not side and stamp>idea['time']:
            s=idea['side']
            stopped=b['low']<=idea['sl'] if s>0 else b['high']>=idea['sl']
            target=b['high']>=idea['tp1'] if s>0 else b['low']<=idea['tp1']
            if stopped or target: idea['resolved']=True
        if not used and in_window:
            if prev['close']<=hi<b['close'] and (ai=='Off' or ai_score(1,b,hi,lo,atr,tick)>=(7 if ai=='Strict' else 5)):
                side=1
            elif prev['close']>=lo>b['close'] and (ai=='Off' or ai_score(-1,b,hi,lo,atr,tick)>=(7 if ai=='Strict' else 5)):
                side=-1
        event=None
        if side:
            entry=b['close'];sl=lo if side>0 else hi
            risk=side*(entry-sl)
            idea={'side':side,'entry':entry,'sl':sl,'tp1':entry+side*risk,
                  'time':stamp,'add':False,'resolved':False,
                  'add_level':entry+side*ADD_DIST[asset] if mode=='Continuation' else hi if side>0 else lo}
            used=True
            event={'kind':kind,'side':side,'entry':entry,'sl':sl,'time':stamp}
        elif idea and not idea['resolved'] and not idea['add'] and stamp>idea['time'] and i-end_index<=60:
            s=idea['side'];level=idea['add_level'];tol=max(BUFFER[asset]*.25,tick)
            trigger=(b['high']>=level if s>0 else b['low']<=level) if mode=='Continuation' else (
                b['low']<=level+tol and b['close']>level if s>0 else b['high']>=level-tol and b['close']<level)
            if trigger:
                # M5-only adapter enters at confirmed close; never assumes an earlier intrabar fill.
                entry=b['close'];sl=(entry+idea['sl'])/2
                if s*(entry-sl)>0 and (b['close']>level if s>0 else b['close']<level):
                    idea['add']=True
                    event={'kind':'add','side':s,'entry':entry,'sl':sl,'time':stamp}
        out['state']='ALPHA_WAIT_BREAKOUT' if not used else 'ALPHA_SESSION_CONSUMED'
        if event:
            risk=event['side']*(event['entry']-event['sl'])
            if risk<=tick: continue
            event.update(session=end,hi=hi,lo=lo,tp1=event['entry']+event['side']*risk,
                         tp2=event['entry']+event['side']*risk*2,tp3=event['entry']+event['side']*risk*3)
            event['key']=hashlib.sha256(f"{asset}|{end}|{stamp}|{event['kind']}|{event['side']}".encode()).hexdigest()[:24]
            if i==len(bars)-1:
                out.update(state='ALPHA_SIGNAL',events=[event])
    return out


def engine_context(engine,rates):
    """Use the calibrated, observed clock; no hardcoded broker timezone."""
    offset = int(round(engine.clock()-engine.market_now()))
    if abs(offset)>14*3600 or offset%900:
        return {'state':'ALPHA_WAIT_CLOCK','events':[]}
    utc_rates = [{**b,'time':b['time']+offset} for b in rates]
    info=engine.mt5.symbol_info(engine.config['symbol'])
    if info is None:
        return {'state':'ALPHA_WAIT_SYMBOL','events':[]}
    return alpha_context(utc_rates,engine.config['symbol'],float(info.trade_tick_size))


class AlphaStrategy:
    """One intent per event with persisted cursor and account-specific IDs."""
    def __init__(self,engine,directory):
        import json
        from pathlib import Path
        self.engine=engine
        self.cursor=Path(directory)/'alpha-m5-cursor.json'
        self.last_bar=None
        self.code='ALPHA_WAIT_NEW_CANDLE'
        if self.cursor.is_file():
            data=json.loads(self.cursor.read_text(encoding='utf-8'))
            if type(data.get('last_bar')) is not int:
                from gold_scalp_core import Fault
                raise Fault('CORRUPT_ALPHA_CURSOR')
            self.last_bar=data['last_bar']

    def step(self,paused=False):
        from gold_scalp_core import atomic
        engine=self.engine
        account=engine.guard(trade=True)
        if not engine.market_fresh(engine.mt5.symbol_info_tick(engine.config['symbol'])):
            self.code='ALPHA_WAIT_FRESH_QUOTE'
            return self.code
        rates=engine.bars({'symbol':engine.config['symbol'],'direction':'alpha','timeframe':'M5'})
        bar=rates[0]['time']
        if self.last_bar is None:
            self.last_bar=bar
            atomic(self.cursor,{'last_bar':bar})
            return 'ALPHA_WAIT_NEW_CANDLE'
        if bar<=self.last_bar:
            return self.code
        self.last_bar=bar
        atomic(self.cursor,{'last_bar':bar})
        if paused:
            self.code='ALPHA_PAUSED_SL_TP_ONLY'
            return self.code
        if not 0<=engine.market_now()-bar-300<=10:
            self.code='ALPHA_WAIT_FRESH_SIGNAL'
            return self.code
        context=engine_context(engine,rates)
        self.code=context['state']
        pin=hashlib.sha256((str(account.login)+'@'+account.server).encode()).hexdigest()[:12]
        for event in context['events']:
            jid='alpha-'+pin+'-'+event['key']
            if jid in engine.states:
                self.code='ALPHA_SIGNAL_CONSUMED'
                continue
            job={'id':jid,'action':'trade','expires_at':datetime.fromtimestamp(engine.clock()+60,timezone.utc).isoformat(),
                 'symbol':engine.config['symbol'],'direction':'alpha','timeframe':'M5','signal_bar':bar,
                 'alpha_key':event['key'],'hold_seconds':0,'signal_timeout_seconds':60,'rr':2.}
            engine.accept(job)
            engine.tick()
            self.code='ALPHA_SIGNAL_ACCEPTED'
        return self.code
