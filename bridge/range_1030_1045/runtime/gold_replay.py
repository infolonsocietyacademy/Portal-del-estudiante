"""Tick replay using the production entry engine. Orders exist only in memory."""
from bisect import bisect_right
from pathlib import Path
from types import SimpleNamespace as NS
import math
from gold_scalp_core import Engine,Fault,FINAL_PHASES
from gold_scalp_runner import Strategy


class ReplayClock:
    def __init__(self, broker):self.broker=broker
    def observe(self,tick):return tick is not None and abs(self.broker.server_time-tick.time)<=10
    def server_now(self):return self.broker.server_time
    def summary(self):return {}


class ReplayBroker:
    ACCOUNT_TRADE_MODE_DEMO=0
    ACCOUNT_MARGIN_MODE_RETAIL_HEDGING=2
    TIMEFRAME_M1=1
    TIMEFRAME_M5=5
    TIMEFRAME_H4=16388
    ORDER_TYPE_BUY=0
    ORDER_TYPE_SELL=1
    POSITION_TYPE_BUY=0
    TRADE_ACTION_DEAL=1
    ORDER_TIME_GTC=0
    ORDER_FILLING_FOK=0
    ORDER_FILLING_IOC=1
    ORDER_FILLING_RETURN=2
    SYMBOL_TRADE_EXECUTION_MARKET=2
    TRADE_RETCODE_DONE=10009
    TRADE_RETCODE_DONE_PARTIAL=10010
    TRADE_RETCODE_PLACED=10008
    DEAL_ENTRY_IN=0
    DEAL_ENTRY_OUT=1
    DEAL_ENTRY_OUT_BY=3

    def __init__(self,rows,info,terminal,offset=0,deposit=10000.,margin_ratio=0.,native_h4=None,native_m5=None):
        self.rows,self.info,self.terminal,self.offset=rows,info,str(Path(terminal).resolve()),offset
        self.times=[int(r['time']) for r in rows]
        self.rows4=list(native_h4 or [])
        self.times4=[r["time"] for r in self.rows4]
        # Build only complete five-minute candles. Access below excludes the current M5.
        groups={}
        for row in rows:
            groups.setdefault(int(row['time'])//300*300,[]).append(row)
        self.rows5=[]
        for stamp,group in sorted(groups.items()):
            if [int(r['time']) for r in group] != list(range(stamp,stamp+300,60)):
                continue
            self.rows5.append(dict(time=stamp,open=group[0]['open'],high=max(r['high'] for r in group),
                                   low=min(r['low'] for r in group),close=group[-1]['close']))
        self.times5=[r['time'] for r in self.rows5]
        if native_m5 is not None:
            self.rows5=list(native_m5)
            self.times5=[int(r['time']) for r in self.rows5]
            if any(a>=b for a,b in zip(self.times5,self.times5[1:])):
                raise ValueError('NON_MONOTONIC_NATIVE_M5_HISTORY')
        self.server_time=0.;self.quote=None;self.pos=[];self.deals=[];self.closed=[];self.sent=[]
        self.balance=deposit;self.margin_ratio=margin_ratio;self.next_ticket=1
        self.peak=deposit;self.drawdown=0.;self.max_open=0

    def clock(self):return self.server_time+self.offset
    def terminal_info(self):return NS(path=self.terminal,connected=True,trade_allowed=True,tradeapi_disabled=False)
    def account_info(self):
        floating=sum(p.profit for p in self.pos)
        return NS(login=1,server='REPLAY-DEMO',trade_mode=0,trade_allowed=True,trade_expert=True,
                  margin_mode=2,currency='USD',equity=self.balance+floating)
    def symbol_select(self,*_):return True
    def symbol_info(self,*_):return self.info
    def symbol_info_tick(self,*_):return self.quote
    def positions_get(self,**kw):
        return tuple(p for p in self.pos if ('symbol' not in kw or p.symbol==kw['symbol']) and ('ticket' not in kw or p.ticket==kw['ticket']))
    def orders_get(self,**_):return ()
    def copy_rates_from_pos(self,symbol,tf,start,count):
        assert tf in (self.TIMEFRAME_M1,self.TIMEFRAME_M5,self.TIMEFRAME_H4) and start==1
        if tf==self.TIMEFRAME_H4:
            end=bisect_right(self.times4,self.server_time-14400)
            return self.rows4[max(0,end-count):end]
        seconds=60 if tf==self.TIMEFRAME_M1 else 300
        rows,times=(self.rows,self.times) if tf==self.TIMEFRAME_M1 else (self.rows5,self.times5)
        cutoff=int(self.server_time)//seconds*seconds-seconds
        end=bisect_right(times,cutoff)
        return rows[max(0,end-count):end]
    def order_calc_profit(self,side,symbol,volume,entry,exit):
        return (exit-entry)*(1 if side==0 else -1)*volume*self.info.trade_contract_size
    def order_check(self,request):
        used=sum(p.margin for p in self.pos)
        margin=self.margin_ratio*request['price']*request['volume']
        return NS(retcode=0 if self.account_info().equity-used>=margin else 10019)
    def order_send(self,request):
        # This method has no reference to the real MT5 module or network.
        assert request['action']==self.TRADE_ACTION_DEAL and 'position' not in request
        assert request.get('sl') and request.get('tp')
        self.sent.append(dict(request));ticket=self.next_ticket;self.next_ticket+=1
        p=NS(ticket=ticket,magic=request['magic'],symbol=request['symbol'],volume=request['volume'],
             type=request['type'],time=int(self.server_time),price_open=request['price'],profit=0.,swap=0.,
             sl=request['sl'],tp=request['tp'],margin=self.margin_ratio*request['price']*request['volume'])
        self.pos.append(p);self.max_open=max(self.max_open,len(self.pos))
        self.deals.append(NS(entry=0,position_id=ticket,magic=p.magic,symbol=p.symbol,volume=p.volume,
                             price=p.price_open,profit=0.,commission=0.,swap=0.,fee=0.))
        return NS(retcode=10009)
    def history_deals_get(self,*_):return tuple(self.deals)

    def advance(self,stamp,bid,ask):
        self.server_time=float(stamp);self.quote=NS(time=int(stamp),time_msc=int(stamp*1000),bid=bid,ask=ask)
        closed=False
        for p in list(self.pos):
            price=bid if p.type==0 else ask
            stop=(price<=p.sl if p.type==0 else price>=p.sl)
            target=(price>=p.tp if p.type==0 else price<=p.tp)
            p.profit=self.order_calc_profit(p.type,p.symbol,p.volume,p.price_open,price)
            if not stop and not target:continue
            exit_price=price if stop else p.tp
            profit=self.order_calc_profit(p.type,p.symbol,p.volume,p.price_open,exit_price)
            self.balance+=profit;self.pos.remove(p);closed=True
            self.deals.append(NS(entry=1,position_id=p.ticket,magic=p.magic,symbol=p.symbol,volume=p.volume,
                                 price=exit_price,profit=profit,commission=0.,swap=0.,fee=0.))
            self.closed.append({'side':'BUY' if p.type==0 else 'SELL','open_time':p.time,'close_time':int(stamp),
                                'entry':p.price_open,'exit':exit_price,'volume':p.volume,'profit':profit,
                                'reason':'SL' if stop else 'TP'})
            self.peak=max(self.peak,self.balance);self.drawdown=max(self.drawdown,self.peak-self.balance)
        return closed


class ReplayEngine(Engine):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs)
        self.active={}
    def save(self,state):
        state['updated_at']=self.clock();self.states[state['id']]=state
        if state['phase'] in FINAL_PHASES:self.active.pop(state['id'],None)
        else:self.active[state['id']]=state
    def event(self,*_,**__):pass
    def tick(self):
        # Only scheduling is optimized; request/open/reconciliation use production code.
        for state in list(self.active.values()):
            try:
                if state['phase']=='waiting':self.open(state)
                else:self.reconcile(state)
            except Fault as exc:
                state['code']=str(exc);self.save(state)
            except Exception:
                state['code']='LOCAL_ERROR_CHECK_LOG';self.save(state)


class Replay:
    def __init__(self,broker,config,directory):
        self.broker=broker
        self.engine=ReplayEngine(broker,Path(directory)/'state',{'login':1,'server':'REPLAY-DEMO'},broker.terminal,config,broker.clock)
        self.engine.feed=ReplayClock(broker)
        self.strategy=Strategy(self.engine,directory)
        self.minute=None;self.poll_second=None;self.tick_count=0;self.covered=set();self.pending=False
        self.first_tick=None;self.last_tick=None;self.history_skips=0

    def tick(self,stamp,bid,ask):
        if not all(math.isfinite(x) for x in (stamp,bid,ask)) or bid<=0 or ask<=bid:return
        if self.last_tick is not None and stamp<self.last_tick:raise ValueError('NON_MONOTONIC_TICK_HISTORY')
        self.tick_count+=1;self.first_tick=stamp if self.first_tick is None else self.first_tick;self.last_tick=stamp
        closed=self.broker.advance(stamp,bid,ask)
        minute=int(stamp)//60*60;self.covered.add(minute)
        second=int(stamp)
        if minute!=self.minute:
            self.minute=minute;self.poll_second=second
            try:self.strategy.step()
            except Fault as exc:
                if str(exc)=='WAIT_HISTORY':self.history_skips+=1
                else:raise
            self.pending=any(s['phase'] in {'waiting','submitted','uncertain'} for s in self.engine.active.values())
        elif second!=self.poll_second:
            self.poll_second=second
            self.strategy.step()
            self.pending=any(s['phase'] in {'waiting','submitted','uncertain'} for s in self.engine.active.values())
        elif closed:
            self.engine.tick()
            self.pending=any(s['phase'] in {'waiting','submitted','uncertain'} for s in self.engine.active.values())

    def metrics(self):
        wins=[t for t in self.broker.closed if t['profit']>0]
        losses=[t for t in self.broker.closed if t['profit']<0]
        breakeven=len(self.broker.closed)-len(wins)-len(losses)
        gains=sum(t['profit'] for t in wins);loss=abs(sum(t['profit'] for t in losses))
        return {'closed_trades':len(self.broker.closed),'wins':len(wins),'losses':len(losses),'breakeven':breakeven,
                'win_rate_percent':round(100*len(wins)/len(self.broker.closed),4) if self.broker.closed else None,
                'open_at_end':len(self.broker.pos),'entries':len(self.broker.sent),'max_simultaneous_positions':self.broker.max_open,
                'gross_profit_usd':round(self.broker.balance-10000.,2),'profit_factor':round(gains/loss,4) if loss else None,
                'balance_drawdown_usd':round(self.broker.drawdown,2),'ticks':self.tick_count,
                'first_tick':self.first_tick,'last_tick':self.last_tick,'skipped_history_minutes':self.history_skips}
