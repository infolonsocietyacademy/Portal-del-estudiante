"""Offline broker simulation. No network calls and no real MT5 operations."""
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace as NS
import unittest
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from resident_core import Engine, Fault, closed_atr, fingerprint, lots_for, magic_for, validate, structure_signal

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

class EngineTest(unittest.TestCase):
    def setUp(self):
        self.tmp=TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.clock=[1800000000.]
        self.now=lambda:self.clock[0]
        self.path=Path(self.tmp.name)/"mt5-test"
        self.m=FakeMT5(self.now,self.path)
        self.cfg={"symbol":"XAUUSD","size_mode":"fixed","fixed_lots":0.05,"risk_percent":0.5,"max_spread_price":0.6,"max_stop_price":20.}
        self.engine=self.make()
    def make(self):
        return Engine(self.m,Path(self.tmp.name)/"state",{"login":"123","server":"Axi-Demo"},self.path,self.cfg,self.now)
    def job(self,jid="one",**extra):
        return {"id":jid,"action":"trade","expires_at":datetime.fromtimestamp(self.now()+3600,timezone.utc).isoformat(),
                "symbol":"XAUUSD","direction":"buy","timeframe":"M5","hold_seconds":300,**extra}
    def open(self,jid="one",**extra):
        self.engine.accept(self.job(jid,**extra))
        self.engine.tick()
        self.engine.tick()
        return self.engine.states[jid]
    def test_open_terminal_is_reused(self):
        self.open()
        self.assertEqual(len(self.m.sent),1)
        self.assertEqual(self.engine.states["one"]["phase"],"open")
    def test_other_position_in_hedging_does_not_block(self):
        self.m.pos.append(NS(ticket=1,magic=999,symbol="XAUUSD",volume=0.01,type=0,time=int(self.now()),price_open=1999.,profit=3.,swap=0.))
        self.open()
        self.assertEqual(len(self.m.pos),2)
    def test_two_independent_entries(self):
        self.open("first")
        self.open("second")
        self.assertEqual(len(self.m.pos),2)
        self.assertNotEqual(magic_for("first"),magic_for("second"))
    def test_close_targets_only_requested_operation(self):
        self.open("first")
        self.clock[0]+=100
        self.open("second")
        self.clock[0]+=201
        self.engine.tick()
        self.engine.tick()
        self.assertEqual([p.magic for p in self.m.pos],[magic_for("second")])
        self.assertEqual(self.engine.states["first"]["phase"],"done")
    def test_manual_close_by_command_id(self):
        self.open()
        close={"id":"close1","action":"close","target_id":"one","expires_at":self.job()["expires_at"]}
        self.engine.accept(close)
        self.engine.tick()
        self.engine.tick()
        self.assertEqual(self.engine.states["one"]["phase"],"done")
    def test_no_close_of_unowned_target(self):
        with self.assertRaisesRegex(Fault,"TARGET_NOT_OWNED"):
            self.engine.accept({"id":"close2","action":"close","target_id":"foreign","expires_at":self.job()["expires_at"]})
        self.assertFalse(self.m.sent)
    def test_duplicate_command_never_sends_twice(self):
        self.open()
        self.engine.accept(self.job())
        self.engine.tick()
        self.assertEqual(len(self.m.sent),1)
    def test_same_id_changed_content_is_rejected(self):
        self.open()
        with self.assertRaisesRegex(Fault,"TASK_ID_REUSED"):
            self.engine.accept(self.job(lots=0.1))
    def test_restart_manages_existing_position(self):
        self.open()
        self.engine=self.make()
        self.engine.tick()
        self.assertEqual(len(self.m.sent),1)
        self.clock[0]+=301
        self.engine.tick()
        self.engine.tick()
        self.assertEqual(self.engine.states["one"]["phase"],"done")
    def test_open_timeout_never_retries(self):
        self.m.next_code=10012
        self.open()
        for _ in range(5): self.engine.tick()
        self.assertEqual(len(self.m.sent),1)
        self.assertEqual(self.engine.states["one"]["phase"],"uncertain")
    def test_none_open_result_never_retries(self):
        self.m.next_code=None
        self.open()
        self.engine=self.make()
        for _ in range(5): self.engine.tick()
        self.assertEqual(len(self.m.sent),1)
    def test_unknown_result_never_marks_safe_rejected(self):
        self.m.next_code=99999
        self.open()
        self.assertEqual(self.engine.states["one"]["phase"],"uncertain")
    def test_real_account_blocks_before_send(self):
        self.m.account.trade_mode=2
        with self.assertRaisesRegex(Fault,"DEMO_ONLY"):
            self.engine.accept(self.job())
        self.assertFalse(self.m.sent)
    def test_account_change_after_accept_blocks_send(self):
        self.engine.accept(self.job())
        self.m.account.login=987
        self.engine.tick()
        self.assertFalse(self.m.sent)
    def test_wrong_terminal_blocks(self):
        self.m.terminal.path=str(Path(self.tmp.name)/"student")
        with self.assertRaisesRegex(Fault,"WRONG_TERMINAL"):
            self.engine.accept(self.job())
    def test_python_permission_blocks_send(self):
        self.m.terminal.tradeapi_disabled=True
        self.engine.accept(self.job())
        self.engine.tick()
        self.assertFalse(self.m.sent)
        self.assertEqual(self.engine.states["one"]["code"],"PYTHON_TRADING_DISABLED")
    def test_netting_conflict_preserves_foreign_position(self):
        self.m.account.margin_mode=0
        self.m.pos.append(NS(ticket=1,magic=999,symbol="XAUUSD"))
        self.open()
        self.assertFalse(self.m.sent)
        self.assertEqual(self.engine.states["one"]["code"],"NETTING_POSITION_CONFLICT")
    def test_broker_check_rejection_never_sends(self):
        self.m.check_code=10019
        self.open()
        self.assertFalse(self.m.sent)
    def test_sltp_present_on_every_open(self):
        self.open()
        request=self.m.sent[0]
        self.assertLess(request["sl"],request["price"])
        self.assertGreater(request["tp"],request["price"])
        self.assertAlmostEqual((request["tp"]-request["price"])/(request["price"]-request["sl"]),2.,places=2)
    def test_m5_candles_do_not_imply_automatic_immediate_close(self):
        self.open()
        self.clock[0]+=60
        self.engine.tick()
        self.assertEqual(len(self.m.sent),1)
        self.clock[0]+=241
        self.engine.tick()
        self.assertEqual(len(self.m.sent),2)
    def test_no_structure_signal_opens_nothing(self):
        self.engine.accept(self.job(direction="structure"))
        self.m.rows[-1]["time"]+=300
        for _ in range(5): self.engine.tick()
        self.assertFalse(self.m.sent)
    def test_expired_signal_never_opens(self):
        self.engine.accept(self.job(direction="structure",signal_timeout_seconds=30))
        self.clock[0]+=31
        self.engine.tick()
        self.assertEqual(self.engine.states["one"]["code"],"NO_SIGNAL_EXPIRED")
        self.assertFalse(self.m.sent)
    def test_unknown_positions_never_confirm_closed(self):
        self.open()
        self.m.positions_unavailable=True
        self.engine.tick()
        self.assertNotEqual(self.engine.states["one"]["phase"],"done")
    def test_unknown_history_never_confirm_closed(self):
        self.open()
        self.clock[0]+=301
        self.engine.tick()
        self.m.history_unavailable=True
        self.engine.tick()
        self.assertNotEqual(self.engine.states["one"]["phase"],"done")
    def test_partial_close_manages_remaining_volume(self):
        self.open()
        self.m.next_code=10010
        self.clock[0]+=301
        self.engine.tick()
        self.assertEqual(len(self.m.pos),1)
        self.m.next_code=10009
        self.clock[0]+=6
        self.engine.tick()
        self.engine.tick()
        self.assertEqual(self.engine.states["one"]["phase"],"done")
    def test_close_timeout_is_not_blindly_retried(self):
        self.open()
        self.m.next_code=10012
        self.clock[0]+=301
        self.engine.tick()
        self.clock[0]+=20
        self.engine.tick()
        self.assertEqual(len(self.m.sent),2)
        self.assertEqual(self.engine.states["one"]["code"],"CLOSE_STATUS_UNCERTAIN")
    def test_manual_close_without_magic_is_reconciled(self):
        self.open()
        self.clock[0]+=301
        self.engine.tick()
        self.m.deals[-1].magic=0
        self.engine.tick()
        self.assertEqual(self.engine.states["one"]["phase"],"done")
    def test_partial_close_reports_total_opened_volume(self):
        self.open()
        self.m.next_code=10010
        self.clock[0]+=301
        self.engine.tick()
        self.m.next_code=10009
        self.clock[0]+=6
        self.engine.tick()
        self.engine.tick()
        self.assertEqual(self.engine.states["one"]["volume"],0.05)
        self.assertEqual(self.engine.states["one"]["remaining_volume"],0.)
    def test_public_summary_excludes_credentials_and_identity(self):
        state=self.open()
        data=str(self.engine.summary(state))
        for key in ("login","server","password","ticket","magic","token","expected"):
            self.assertNotIn(key,data)
    def test_three_active_commands_limit(self):
        for i in range(3): self.open("job"+str(i))
        with self.assertRaisesRegex(Fault,"MAX_ACTIVE_COMMANDS"):
            self.engine.accept(self.job("four"))
    def test_readonly_commands_never_send(self):
        for action in ("ping","diagnose","status"):
            result=self.engine.accept({"id":action,"action":action,"expires_at":self.job()["expires_at"]})
            self.assertEqual(result["status"],"succeeded")
        self.assertFalse(self.m.sent)

class ValidationTest(unittest.TestCase):
    def test_fixed_lot_not_rounded_up(self):
        with self.assertRaises(Fault):
            lots_for("fixed",0.055,25,100,0.01,1.,0.01)
    def test_risk_lot_under_budget(self):
        self.assertEqual(lots_for("risk",0.,25,320,0.01,1.,0.01),0.07)
    def test_minimum_lot_never_exceeds_risk(self):
        with self.assertRaises(Fault):
            lots_for("risk",0.,1.,1000,0.01,1.,0.01)
    def test_oversize_fixed_rejected(self):
        with self.assertRaises(Fault):
            lots_for("fixed",2.,25,100,0.01,100.,0.01)
    def test_unknown_fields_rejected(self):
        with self.assertRaises(Fault):
            validate({"id":"test","action":"ping","expires_at":"2099-01-01T00:00:00Z","shell":"anything"},"XAUUSD",0)
    def test_no_naive_expiry(self):
        with self.assertRaises(Fault):
            validate({"id":"test","action":"ping","expires_at":"2099-01-01T00:00:00"},"XAUUSD",0)
    def test_magic_namespace_separate_from_legacy(self):
        self.assertGreater(magic_for("one"),1<<52)
        self.assertLess(magic_for("one"),1<<53)
    def test_flat_structure_never_signals(self):
        rows=[{"open":100.,"high":101.,"low":99.,"close":100.} for _ in range(96)]
        self.assertEqual(structure_signal(rows)[0],0)
        self.assertEqual(closed_atr(rows),2.)

if __name__=="__main__":
    unittest.main()
