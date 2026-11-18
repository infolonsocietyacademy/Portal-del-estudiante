"""Offline only: causal M5 signals, restart and broker protections."""
from copy import deepcopy
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE / "runtime"))
from market_structure_m5 import SignalState, Strategy
from gold_scalp_core import Engine, Fault, validate
spec = importlib.util.spec_from_file_location("fixture", BASE.parent / "liquidez_h4/tests/broker_fixture.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
FakeMT5 = fixture.FakeMT5

T = 1794900000 // 300 * 300
def bar(t=T, o=2000., h=2001., l=1999., c=2000.):
    return dict(time=t, open=o, high=h, low=l, close=c)

def primed(side=1):
    s = SignalState()
    s.bars = [bar(T - 300 * (20-i), o=1999.5, h=2000.5, l=1998.5, c=2000.) for i in range(20)]
    s.highs = [dict(time=T-6000, price=2000.), dict(time=T-1800, price=2002.)]
    s.lows = [dict(time=T-4500, price=1995.), dict(time=T-1200, price=1998.)]
    if side == -1:
        s.highs = [dict(time=T-6000, price=2005.), dict(time=T-1800, price=2002.)]
        s.lows = [dict(time=T-4500, price=2000.), dict(time=T-1200, price=1998.)]
        s.bars[-1] = bar(T-300, o=2000., h=2001., l=1999., c=2000.)
    return s

def bos(side=1):
    return bar(T, o=2000., h=2003.5, l=1999.9, c=2003.) if side==1 else bar(T, o=2000., h=2000.1, l=1996.5, c=1997.)

def retest(side=1, t=T+300):
    return bar(t, o=2002.1, h=2003.2, l=2001.95, c=2003.) if side==1 else bar(t, o=1997.9, h=1998.05, l=1996.8, c=1997.)

class Signals(unittest.TestCase):
    def test_bos_alone_never_enters(self):
        s=primed(); self.assertIsNone(s.step(bos()));self.assertEqual(s.pending["side"],1)

    def test_buy_and_sell_need_later_retest(self):
        for side in (1,-1):
            s=primed(side);self.assertIsNone(s.step(bos(side)));e=s.step(retest(side))
            self.assertEqual(e["side"],side)
            self.assertGreater(side*(e["entry"]-e["sl_bid"]),0)
            self.assertEqual(e["bos_time"],T)

    def test_no_touch_and_wrong_color_do_not_enter(self):
        s=primed();s.step(bos())
        self.assertIsNone(s.step(bar(T+300,o=2003.,h=2005.,l=2002.8,c=2004.)))
        self.assertIsNone(s.step(bar(T+600,o=2003.,h=2003.2,l=2001.95,c=2002.5)))
        self.assertIsNotNone(s.step(retest(t=T+900)))

    def test_countertrend_break_does_not_arm(self):
        s=primed();s.lows[1]["price"]=1994.
        self.assertIsNone(s.step(bos()));self.assertIsNone(s.pending)

    def test_structural_invalidation(self):
        s=primed();s.step(bos())
        self.assertIsNone(s.step(bar(T+300,o=2001.,h=2002.,l=1996.,c=1997.)))
        self.assertIsNone(s.pending)

    def test_retest_expiry(self):
        s=primed();s.step(bos());self.assertIsNone(s.step(retest(t=T+13*300)))
        self.assertIsNone(s.pending)

    def test_restart_keeps_pending_and_consumed_signals(self):
        s=primed();s.step(bos());s=SignalState(state=json.loads(json.dumps(s.dump())))
        self.assertIsNotNone(s.step(retest()))
        s=SignalState(state=json.loads(json.dumps(s.dump())))
        self.assertIsNone(s.step(retest(t=T+600)))

    def test_no_future_pivot_and_persistence_equivalence(self):
        s=SignalState();restored=SignalState()
        for i in range(80):
            price=2000.+(i%9)*.2
            b=bar(T+i*300,o=price,h=price+.6,l=price-.6,c=price+.1)
            self.assertEqual(s.step(b),restored.step(b))
            self.assertTrue(all(p["time"]<=b["time"]-600 for p in s.highs+s.lows))
            restored=SignalState(state=json.loads(json.dumps(restored.dump())))

    def test_bad_state_and_duplicate_bar_rejected(self):
        s=primed();s.step(bos())
        with self.assertRaises(ValueError):s.step(bos())
        d=s.dump();d["pending"]=dict(d["pending"],side=0)
        with self.assertRaises(ValueError):SignalState(state=d)

class Broker(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.root=Path(self.temp.name);self.now=T+600.5
        self.mt5=FakeMT5(lambda:self.now,self.root)
        self.config=dict(symbol="XAUUSD",size_mode="fixed",fixed_lots=.05,risk_percent=.5,max_spread_price=.25,max_stop_price=10.)
        self.e=Engine(self.mt5,self.root/"state",dict(login="123",server="Axi-Demo"),self.root,self.config,clock=lambda:self.now)
        self.signal=primed();self.signal.step(bos());self.event=self.signal.step(retest())
        self.mt5.tick.bid=self.event["entry"];self.mt5.tick.ask=self.event["entry"]+.2
        self.mt5.rows=[bar(T+300-300*(95-i)) for i in range(96)]
        self.mt5.rows[-1]=retest()
        self.job=dict(id="ms5-test",action="trade",expires_at=datetime.fromtimestamp(self.now+60,timezone.utc).isoformat(),
                      symbol="XAUUSD",direction="structure_retest",timeframe="M5",signal_bar=T+300,
                      ms5_key=self.event["key"],hold_seconds=0,signal_timeout_seconds=60,rr=1.)
        self.e.ms5_event=self.event
    def tearDown(self):self.temp.cleanup()
    def accept(self):
        self.e.accept(self.job);self.e.tick()
    def test_real_account_and_permissions_block(self):
        self.mt5.account.trade_mode=2
        with self.assertRaises(Fault):self.e.accept(self.job)
        self.assertEqual(self.mt5.sent,[])
        self.mt5.account.trade_mode=0;self.mt5.terminal.tradeapi_disabled=True;self.accept()
        self.assertEqual(self.mt5.sent,[])
    def test_bid_ask_stop_and_tp_one_r_both_sides(self):
        for side in (1,-1):
            with self.subTest(side=side):
                self.e.states={};self.mt5.pos=[];self.mt5.sent=[]
                s=primed(side);s.step(bos(side));event=s.step(retest(side))
                self.e.ms5_event=event
                self.job=dict(self.job,id="ms5-side-"+str(side),ms5_key=event["key"])
                self.mt5.rows[-1]=retest(side);self.mt5.tick.bid=event["entry"];self.mt5.tick.ask=event["entry"]+.2
                self.accept()
                self.assertEqual(len(self.mt5.sent),1)
                req=self.mt5.sent[0]
                self.assertAlmostEqual(abs(req["price"]-req["sl"]),abs(req["tp"]-req["price"]),places=6)
                self.assertEqual(req["volume"],.05)
                self.assertAlmostEqual(req["sl"],event["sl_bid"]+(.2 if side<0 else 0),places=6)
    def test_duplicate_and_unverified_event_block(self):
        self.e.ms5_event=None;self.accept();self.assertEqual(self.mt5.sent,[])
        self.e.ms5_event=self.event
        self.job=dict(self.job,id="second")
        with self.assertRaisesRegex(Fault,"MS5_EVENT_ALREADY_CONSUMED"):self.e.accept(self.job)
        self.e.tick();self.assertEqual(self.mt5.sent,[])
    def test_one_position_even_on_hedging(self):
        self.accept();self.assertEqual(len(self.mt5.pos),1)
        self.job=dict(self.job,id="different",ms5_key="b"*24)
        self.e.ms5_event=dict(self.event,key="b"*24)
        self.e.accept(self.job);self.e.tick()
        self.assertEqual(len(self.mt5.sent),1)
    def test_restart_never_resends_open(self):
        self.accept()
        restored=Engine(self.mt5,self.root/"state",dict(login="123",server="Axi-Demo"),self.root,self.config,clock=lambda:self.now)
        restored.ms5_event=self.event;restored.tick()
        self.assertEqual(len(self.mt5.sent),1)
    def test_no_timer_or_reverse_close(self):
        self.accept();self.now+=86400;self.e.tick()
        self.assertEqual(len(self.mt5.sent),1)
    def test_new_direction_requires_m5_rr1_and_key(self):
        for change in (dict(timeframe="M1"),dict(rr=2.),dict(ms5_key="bad"),dict(hold_seconds=300)):
            with self.assertRaises(Fault):validate(dict(self.job,**change),"XAUUSD",self.now)
    def test_stop_cap_spread_and_old_strategy_cannot_open(self):
        self.config["max_spread_price"]=.1;self.accept();self.assertEqual(self.mt5.sent,[])
        with self.assertRaises(Fault):validate(dict(self.job,direction="liquidez_h4"),"XAUUSD",self.now)
    def test_warmup_no_historical_entry_and_no_wrong_tf(self):
        self.mt5.rows=[bar(T-300*(95-i)) for i in range(96)]
        st=Strategy(self.e,self.root)
        self.assertEqual(st.step(),"MS5_WARMED_NO_HISTORICAL_ENTRY")
        self.assertEqual(self.mt5.sent,[])
        self.assertIsNone(st.state.pending)
        self.assertEqual(st.step(),"MS5_WAIT_STRUCTURE")

    def test_full_native_m5_bos_retest_adapter_and_restart(self):
        values=[2000.]*60+[1998.,1999.,2001.,2003.,2001.,1999.,1997.,1999.,2001.,2005.,2003.,2001.,1999.,2001.,2003.,2003.5,2006.]
        rows=[bar(T+i*300,o=v-.1,h=v+.2,l=v-.2,c=v) for i,v in enumerate(values)]
        touch=bar(T+len(rows)*300,o=2005.3,h=2006.,l=2005.15,c=2005.8)
        # Seed from real native candles, then expose each later closed candle.
        self.mt5.rows=rows[:-1];self.now=self.mt5.rows[-1]["time"]+300.5
        self.mt5.tick.bid=2003.5;self.mt5.tick.ask=2003.7
        st=Strategy(self.e,self.root)
        self.assertEqual(st.step(),"MS5_WARMED_NO_HISTORICAL_ENTRY")
        self.mt5.rows=rows;self.now=rows[-1]["time"]+300.5
        self.mt5.tick.bid=2006.;self.mt5.tick.ask=2006.2
        self.assertEqual(st.step(),"MS5_WAIT_RETEST")
        self.assertEqual(self.mt5.sent,[])
        # A process restart must preserve the causal BOS, without entering it.
        st=Strategy(self.e,self.root)
        self.mt5.rows=rows+[touch];self.now=touch["time"]+300.5
        self.mt5.tick.bid=2005.8;self.mt5.tick.ask=2006.
        self.assertEqual(st.step(),"MS5_SIGNAL_ACCEPTED")
        self.assertEqual(len(self.mt5.sent),1)
        self.assertEqual(list(self.e.states.values())[0]["job"]["timeframe"],"M5")
        st=Strategy(self.e,self.root);st.step()
        self.assertEqual(len(self.mt5.sent),1)

if __name__=="__main__":unittest.main()
