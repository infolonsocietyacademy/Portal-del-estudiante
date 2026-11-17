"""Closed-M1 port of OLFX_BREAKOUT_FAKEBREAKOUT_M1.pine default settings.
Streaming state survives restarts: no rolling-window re-arming after long trends.
No network, MT5 imports, trade execution or fabricated performance statistics.
"""
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path


def valid_bar(b):
    keys={'time','open','high','low','close'}
    if not isinstance(b,dict) or not keys<=b.keys():return False
    if type(b['time']) is not int or b['time']<=0 or b['time']%60:return False
    if any(type(b[k]) not in (int,float) or not math.isfinite(b[k]) or b[k]<=0 for k in keys-{'time'}):return False
    return b['low']<=min(b['open'],b['close'])<=max(b['open'],b['close'])<=b['high']


class SignalState:
    def __init__(self,symbol='XAUUSD',tick=.01,state=None):
        if not isinstance(symbol,str) or not symbol.startswith('XAUUSD'):raise ValueError('BF_SYMBOL_NOT_APPROVED')
        if type(tick) not in (int,float) or not math.isfinite(tick) or tick<=0:raise ValueError('BF_INVALID_TICK')
        self.symbol,self.tick=symbol,float(tick)
        self.history=[];self.count=0;self.atr=None;self.seed=[];self.ema=None
        self.watch_side=0;self.watch_index=None;self.watch_hi=None;self.watch_lo=None;self.watch_extreme=None
        self.bull_armed=True;self.bear_armed=True;self.bull_reset=None;self.bear_reset=None
        self.last_signal_index=None;self.last_event=None
        if state is not None:self.restore(state)

    def dump(self):
        return {'schema':1,'symbol':self.symbol,'tick':self.tick,**{k:v for k,v in self.__dict__.items() if k not in ('symbol','tick')}}

    def restore(self,d):
        expected=set(self.dump())
        if not isinstance(d,dict) or set(d)!=expected or type(d['schema']) is not int or d['schema']!=1:
            raise ValueError('BF_CORRUPT_SIGNAL_STATE')
        if d['symbol']!=self.symbol or d['tick']!=self.tick:raise ValueError('BF_STATE_SYMBOL_OR_TICK_CHANGED')
        history=d['history']
        if not isinstance(history,list) or len(history)>20 or any(not valid_bar(b) for b in history):raise ValueError('BF_CORRUPT_SIGNAL_STATE')
        if any(a['time']>=b['time'] for a,b in zip(history,history[1:])):raise ValueError('BF_CORRUPT_SIGNAL_STATE')
        if type(d['count']) is not int or d['count']<0 or len(history)!=min(d['count'],20):raise ValueError('BF_CORRUPT_SIGNAL_STATE')
        for k in ('bull_armed','bear_armed'):
            if type(d[k]) is not bool:raise ValueError('BF_CORRUPT_SIGNAL_STATE')
        for k in ('atr','ema','watch_hi','watch_lo','watch_extreme','bull_reset','bear_reset'):
            if d[k] is not None and (type(d[k]) not in (int,float) or not math.isfinite(d[k]) or d[k]<=0):raise ValueError('BF_CORRUPT_SIGNAL_STATE')
        if type(d['watch_side']) is not int or d['watch_side'] not in (-1,0,1):raise ValueError('BF_CORRUPT_SIGNAL_STATE')
        for k in ('watch_index','last_signal_index'):
            if d[k] is not None and (type(d[k]) is not int or not 0<=d[k]<d['count']):raise ValueError('BF_CORRUPT_SIGNAL_STATE')
        if not isinstance(d['seed'],list) or len(d['seed'])>14 or any(type(v) not in (int,float) or not math.isfinite(v) or v<0 for v in d['seed']):raise ValueError('BF_CORRUPT_SIGNAL_STATE')
        if len(d['seed'])!=min(d['count'],14) or (d['count']>0 and d['ema'] is None) or (d['count']>=14 and d['atr'] is None):raise ValueError('BF_CORRUPT_SIGNAL_STATE')
        if d['watch_side'] and (d['watch_index'] is None or any(d[k] is None for k in ('watch_hi','watch_lo','watch_extreme'))):raise ValueError('BF_CORRUPT_SIGNAL_STATE')
        event=d['last_event']
        if event is not None:
            fields={'key','time','side','kind','entry','sl_bid','hi','lo','atr'}
            if not isinstance(event,dict) or set(event)!=fields or type(event['side']) is not int or event['side'] not in (-1,1) or event['kind'] not in ('breakout','fake'):
                raise ValueError('BF_CORRUPT_SIGNAL_STATE')
            if not history or event['time']!=history[-1]['time'] or event['key']!=event_key(self.symbol,event):raise ValueError('BF_CORRUPT_SIGNAL_STATE')
            if any(type(event[k]) not in (int,float) or not math.isfinite(event[k]) or event[k]<=0 for k in ('entry','sl_bid','hi','lo','atr')):raise ValueError('BF_CORRUPT_SIGNAL_STATE')
            if event['side']*(event['entry']-event['sl_bid'])<self.tick:raise ValueError('BF_CORRUPT_SIGNAL_STATE')
        for k in self.__dict__:
            if k not in ('symbol','tick'):setattr(self,k,d[k])

    @property
    def last_time(self):return self.history[-1]['time'] if self.history else None

    def step(self,b):
        if not valid_bar(b):raise ValueError('BF_INVALID_CLOSED_BAR')
        if self.last_time is not None and b['time']<=self.last_time:raise ValueError('BF_NON_MONOTONIC_BAR')
        i=self.count;prev=self.history[-1] if self.history else None
        atr=self.atr
        self.ema=b['close'] if self.ema is None else (2/51)*b['close']+(49/51)*self.ema
        signal=0;sl=None;hi=None;lo=None
        ready=i>=21 and len(self.history)==20 and atr is not None and atr>0
        if ready:
            hi=max(v['high'] for v in self.history);lo=min(v['low'] for v in self.history)
            ready=hi>lo
        if ready:
            buf=max(atr*.1,self.tick);stopbuf=max(atr*.2,self.tick)
            rng=max(b['high']-b['low'],self.tick)
            body=100*abs(b['close']-b['open'])/rng
            upper=100*(b['high']-max(b['open'],b['close']))/rng
            lower=100*(min(b['open'],b['close'])-b['low'])/rng
            strongbuy=b['close']>b['open'] and body>=55 and 100*(b['close']-b['low'])/rng>=75
            strongsell=b['close']<b['open'] and body>=55 and 100*(b['high']-b['close'])/rng>=75
            spacing=self.last_signal_index is None or i-self.last_signal_index>=3
            gap=b['time']-prev['time']!=60
            if gap:
                self.watch_side=0;self.watch_index=None;self.watch_hi=None;self.watch_lo=None;self.watch_extreme=None
                self.bull_armed=True;self.bear_armed=True;self.bull_reset=None;self.bear_reset=None
            if not self.bull_armed and self.bull_reset is not None and b['close']<self.bull_reset:self.bull_armed=True
            if not self.bear_armed and self.bear_reset is not None and b['close']>self.bear_reset:self.bear_armed=True
            if not gap:
                if self.watch_side:
                    age=i-self.watch_index
                    self.watch_extreme=max(self.watch_extreme,b['high']) if self.watch_side==1 else min(self.watch_extreme,b['low'])
                    inside=self.watch_lo<b['close']<self.watch_hi
                    sell=self.watch_side==1 and 1<=age<=3 and inside and b['close']<b['open']
                    buy=self.watch_side==-1 and 1<=age<=3 and inside and b['close']>b['open']
                    spans=b['high']>self.watch_hi+buf and b['low']<self.watch_lo-buf
                    if not spans and (buy or sell):
                        signal=2 if buy else -2
                        sl=self.watch_extreme-stopbuf if buy else self.watch_extreme+stopbuf
                        hi,lo=self.watch_hi,self.watch_lo
                        self.last_signal_index=i;self.watch_side=0
                    elif age>=3 or inside or (self.watch_side==1 and b['close']<=self.watch_lo) or (self.watch_side==-1 and b['close']>=self.watch_hi):self.watch_side=0
                # Same rolling reference as the Pine, even if the previous watch resolved.
                rhi=max(v['high'] for v in self.history);rlo=min(v['low'] for v in self.history)
                top=b['high']>rhi+buf;bottom=b['low']<rlo-buf
                inside=rlo<b['close']<rhi
                sell=top and not bottom and inside and b['close']<b['open'] and upper>=35
                buy=bottom and not top and inside and b['close']>b['open'] and lower>=35
                if not signal and not self.watch_side and spacing and (buy or sell):
                    signal=2 if buy else -2;sl=b['low']-stopbuf if buy else b['high']+stopbuf
                    hi,lo=rhi,rlo;self.last_signal_index=i
                up=b['close']>rhi+buf and prev['close']<=rhi and self.bull_armed
                dn=b['close']<rlo-buf and prev['close']>=rlo and self.bear_armed
                if not signal and not self.watch_side and not(top and bottom) and (up or dn):
                    self.watch_side=1 if up else -1;self.watch_index=i;self.watch_hi=rhi;self.watch_lo=rlo
                    self.watch_extreme=b['high'] if up else b['low']
                    if up:self.bull_armed=False;self.bull_reset=rhi
                    else:self.bear_armed=False;self.bear_reset=rlo
                    if spacing and ((up and strongbuy and b['close']>self.ema) or (dn and strongsell and b['close']<self.ema)):
                        signal=1 if up else -1;sl=rlo-stopbuf if up else rhi+stopbuf
                        hi,lo=rhi,rlo;self.last_signal_index=i
        event=None
        if signal and (1 if signal>0 else -1)*(b['close']-sl)>=self.tick:
            event={'time':b['time'],'side':1 if signal>0 else -1,'kind':'fake' if abs(signal)==2 else 'breakout',
                   'entry':b['close'],'sl_bid':sl,'hi':hi,'lo':lo,'atr':atr}
            event['key']=event_key(self.symbol,event)
        tr=b['high']-b['low'] if prev is None else max(b['high']-b['low'],abs(b['high']-prev['close']),abs(b['low']-prev['close']))
        if self.atr is None:
            self.seed.append(tr)
            if len(self.seed)==14:self.atr=sum(self.seed)/14
        else:self.atr=(13*self.atr+tr)/14
        self.history=(self.history+[dict(b)])[-20:];self.count+=1;self.last_event=event
        return event


def event_key(symbol,event):
    return hashlib.sha256(f"{symbol}|{event['time']}|{event['side']}|{event['kind']}".encode()).hexdigest()[:24]


class Strategy:
    """Consume closed candles once. Persist the signal and cursor BEFORE accepting an order."""
    def __init__(self,engine,directory):
        self.engine=engine;self.path=Path(directory)/'breakfake-m1-state.json'
        info=engine.mt5.symbol_info(engine.config['symbol'])
        if info is None:raise ValueError('BF_SYMBOL_UNAVAILABLE')
        state=json.loads(self.path.read_text()) if self.path.is_file() else None
        self.state=SignalState(engine.config['symbol'],float(info.trade_tick_size),state)
        engine.bf_event=self.state.last_event
        self.last_code='BF_WAIT_NEW_CANDLE'

    def step(self,paused=False):
        from gold_scalp_core import atomic,Fault
        e=self.engine
        if paused:
            for s in e.states.values():
                if s['job']['action']=='trade' and s['phase']=='waiting':s['cancel']=True;e.save(s)
        e.tick();account=e.guard(trade=True)
        if not e.market_fresh(e.mt5.symbol_info_tick(e.config['symbol'])):return 'WAIT_FRESH_QUOTE'
        rows=list(reversed(e.bars({'symbol':e.config['symbol'],'timeframe':'M1','direction':'breakfake'})))
        if self.state.last_time is None or self.state.last_time<rows[0]['time']-60:
            self.state=SignalState(e.config['symbol'],self.state.tick)
            for b in rows:self.state.step(b)
            e.bf_event=self.state.last_event
            atomic(self.path,self.state.dump())
            return 'BF_WARMED_NO_HISTORICAL_ENTRY'
        new=[b for b in rows if b['time']>self.state.last_time]
        if not new:return 'PAUSED_SL_TP_ONLY' if paused else 'BF_WAIT_NEW_CANDLE'
        event=None
        for b in new:event=self.state.step(b)
        e.bf_event=event
        atomic(self.path,self.state.dump())
        if paused:return 'PAUSED_SL_TP_ONLY'
        if not event:return 'BF_WAIT_SIGNAL'
        if not 0<=e.market_now()-event['time']-60<=10:return 'BF_STALE_SIGNAL_SKIPPED'
        pin=hashlib.sha256((str(account.login)+'@'+account.server).encode()).hexdigest()[:12]
        jid='bf1-'+pin+'-'+event['key']
        if jid in e.states:return 'BF_SIGNAL_CONSUMED'
        job={'id':jid,'action':'trade','expires_at':datetime.fromtimestamp(e.clock()+60,timezone.utc).isoformat(),
             'symbol':e.config['symbol'],'direction':'breakfake','timeframe':'M1','signal_bar':event['time'],
             'bf_key':event['key'],'hold_seconds':0,'signal_timeout_seconds':60,'rr':1.0}
        e.accept(job);e.tick()
        return 'BF_SIGNAL_ACCEPTED'
