"""Offline broker simulation. No network calls and no real MT5 operations."""
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace as NS
import unittest
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"runtime"))
from gold_scalp_core import Engine, Fault, closed_atr, fingerprint, lots_for, magic_for, validate, structure_signal

class FakeMT5:
    ACCOUNT_TRADE_MODE_DEMO=0
    ACCOUNT_MARGIN_MODE_RETAIL_HEDGING=2
    TIMEFRAME_M1=1
    TIMEFRAME_M5=5
    ORDER_TYPE_BUY=0
    ORDER_TYPE_SELL=1
    POSITION_TYPE_BUY=0
    TRADE_ACTION_DEAL=1
    TRADE_ACTION_REMOVE=8
    ORDER_TIME_GTC=0
    ORDER_FILLING_FOK=0
    ORDER_FILLING_IOC=1
    ORDER_FILLING_RETURN=2
    SYMBOL_TRADE_EXECUTION_MARKET=2
    TRADE_RETCODE_DONE=10009
    TRADE_RETCODE_DONE_PARTIAL=10010
    TRADE_RETCODE_PLACED=10008
    TRADE_RETCODE_TIMEOUT=10012
    DEAL_ENTRY_IN=0
    DEAL_ENTRY_OUT=1
    DEAL_ENTRY_OUT_BY=3

    def __init__(self,now,path):
        self.now=now
        self.account=NS(login=123,server="Axi-Demo",trade_mode=0,trade_allowed=True,trade_expert=True,margin_mode=2,equity=5000)
        self.terminal=NS(path=str(path),connected=True,trade_allowed=True,tradeapi_disabled=False)
        self.pos=[]
        self.orders=[]
        self.deals=[]
        self.sent=[]
        self.next_code=10009
        self.positions_unavailable=False
        self.history_unavailable=False
        self.check_code=0
        self.tick=NS(bid=2000.0,ask=2000.2,time=now())
        self.info=NS(currency_base="XAU",currency_profit="USD",trade_stops_level=10,point=0.01,
                     trade_tick_size=0.01,digits=2,volume_min=0.01,volume_max=100.,volume_step=0.01,
                     filling_mode=1,trade_exemode=2)
        self.rows=[{"time":int(now())-60*(96-i),"open":2000.,"high":2001.,"low":1999.,"close":2000.} for i in range(96)]
    def account_info(self): return self.account
    def terminal_info(self): return self.terminal
    def positions_get(self,**kw):
        if self.positions_unavailable: return None
        return tuple(p for p in self.pos if ("symbol" not in kw or p.symbol==kw["symbol"]) and ("ticket" not in kw or p.ticket==kw["ticket"]))
    def orders_get(self,**kw): return tuple(o for o in self.orders if "symbol" not in kw or o.symbol==kw["symbol"])
    def symbol_select(self,*args): return True
    def symbol_info(self,*args): return self.info
    def symbol_info_tick(self,*args):
        self.tick.time=self.now()
        return self.tick
    def copy_rates_from_pos(self,*args): return self.rows
    def order_calc_profit(self,side,symbol,volume,entry,sl): return -abs(entry-sl)*100*volume
    def order_check(self,request): return NS(retcode=self.check_code)
    def history_deals_get(self,*args): return None if self.history_unavailable else tuple(self.deals)
    def order_send(self,request):
        self.sent.append(dict(request))
        code=self.next_code
        if code is None: return None
        if request["action"]==self.TRADE_ACTION_REMOVE:
            self.orders=[o for o in self.orders if o.ticket!=request["order"]]
            return NS(retcode=10009)
        if code not in (10009,10010): return NS(retcode=code)
        volume=request["volume"] if code==10009 else request["volume"]/2
        if "position" not in request:
            ticket=100+len(self.sent)
            self.pos.append(NS(ticket=ticket,magic=request["magic"],symbol=request["symbol"],volume=volume,
                               type=request["type"],time=int(self.now()),price_open=request["price"],profit=0.,swap=0.))
            self.deals.append(NS(entry=0,position_id=ticket,magic=request["magic"],symbol=request["symbol"],volume=volume,price=request["price"],
                                 profit=0.,commission=-0.1,swap=0.,fee=0.))
        else:
            p=next(p for p in self.pos if p.ticket==request["position"])
            p.volume=round(p.volume-volume,8)
            if p.volume<=0: self.pos.remove(p)
            self.deals.append(NS(entry=1,position_id=p.ticket,magic=request["magic"],symbol=request["symbol"],volume=volume,price=request["price"],
                                 profit=1.,commission=-0.1,swap=0.,fee=0.))
        return NS(retcode=code)


