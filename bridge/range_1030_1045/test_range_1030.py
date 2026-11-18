import tempfile
import unittest
from datetime import datetime,timezone
from pathlib import Path
from types import SimpleNamespace as NS
from gold_replay import ReplayBroker, ReplayEngine, ReplayClock
from gold_scalp_core import Fault, validate
from range_1030 import Strategy, window, ny_local, midpoint
from gold_backtest_worker import ReadOnlyMarket, axi_utc, axi_offset, backtest_window

def stamp(s):
    return datetime.fromisoformat(s.replace("Z","+00:00")).timestamp()

class RangeTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        self.start=stamp("2026-11-17T15:30:00Z")
        self.rows=[dict(time=int(self.start)+i*60,open=100.,high=110.,low=90.,close=100.) for i in range(15)]
        self.meta=NS(description="US Tech Nasdaq 100",currency_base="USD",currency_profit="USD",
          trade_stops_level=0,point=.1,trade_tick_size=.1,digits=1,volume_min=.01,
          volume_max=100.,volume_step=.01,filling_mode=3,trade_exemode=2,trade_contract_size=1.)
        self.config=dict(schema=1,symbol="USTECH",size_mode="percent",fixed_lots=.05,
          risk_percent=.5,max_risk_cash=50.,max_spread_price=5.,max_stop_price=119.23)
        self.b=ReplayBroker(self.rows,self.meta,self.root)
        self.e=ReplayEngine(self.b,self.root/"state",{"login":1,"server":"REPLAY-DEMO"},self.root,self.config,self.b.clock)
        self.e.feed=ReplayClock(self.b)
        self.s=Strategy(self.e,self.root)
    def tearDown(self): self.tmp.cleanup()
    def poll(self,t,bid=100.,spread=.2,paused=False):
        self.b.advance(t,bid,bid+spread)
        return self.s.step(paused=paused)
    def arm(self):
        self.assertEqual(self.poll(self.start-1),"RANGE_WAIT_1030_NY")
        self.assertIn("BUILDING",self.poll(self.start+899))
        self.assertEqual(self.poll(self.start+900,109),"RANGE_WAIT_FIRST_BUY_BREAKOUT")
    def test_first_break_intraminute_protection_and_one_per_day(self):
        self.arm()
        self.assertEqual(self.poll(self.start+902,110.1),"RANGE_BUY_ACCEPTED")
        self.assertEqual(len(self.b.sent),1)
        q=self.b.sent[0]
        self.assertEqual(q["type"],0)
        self.assertEqual(q["sl"],100.)
        self.assertAlmostEqual(q["tp"]-q["price"],q["price"]-q["sl"])
        self.assertLessEqual(q["volume"]*(q["price"]-q["sl"]),50)
        self.poll(self.start+903,q["tp"]+.1)
        self.poll(self.start+905,109)
        self.poll(self.start+907,111)
        self.assertEqual(len(self.b.sent),1)
        self.assertEqual(len(self.b.closed),1)
        self.assertEqual(self.b.closed[0]["reason"],"TP")
    def test_touch_high_does_not_trigger(self):
        self.arm()
        self.poll(self.start+901,110)
        self.assertEqual(self.b.sent,[])
    def test_missing_range_candle_never_trades(self):
        self.b.rows.pop(7);self.b.times=[r["time"] for r in self.b.rows]
        self.poll(self.start-1)
        self.assertIn("INCOMPLETE",self.poll(self.start+900,111))
        self.assertEqual(self.b.sent,[])
    def test_no_entry_before_1045(self):
        self.poll(self.start-1)
        for second in (0,60,300,899):
            self.poll(self.start+second,115)
        self.assertEqual(self.b.sent,[])
    def test_restart_above_high_skips_historical_breakout(self):
        self.assertEqual(self.poll(self.start+950,111),"RANGE_MISSED_BREAKOUT_SKIPPED")
        self.s=Strategy(self.e,self.root)
        self.poll(self.start+960,109)
        self.poll(self.start+970,112)
        self.assertEqual(self.b.sent,[])
    def test_late_restart_below_high_also_skips_uncertain_first_break(self):
        self.assertEqual(self.poll(self.start+950,109),"RANGE_MISSED_BREAKOUT_SKIPPED")
        self.poll(self.start+952,110.1)
        self.assertEqual(self.b.sent,[])
    def test_paused_first_break_is_consumed(self):
        self.arm()
        self.assertEqual(self.poll(self.start+902,110.1,paused=True),"RANGE_PAUSED_BREAKOUT_CONSUMED")
        self.poll(self.start+903,111)
        self.assertEqual(self.b.sent,[])
    def test_spread_rejection_does_not_retry(self):
        self.arm()
        self.assertIn("WAIT_SPREAD",self.poll(self.start+902,110.1,spread=6))
        self.poll(self.start+903,111)
        self.assertEqual(self.b.sent,[])
        self.assertTrue(self.s.state["consumed"])
    def test_busy_first_break_is_skipped(self):
        self.arm()
        self.b.positions_get=lambda **kwargs:(NS(),)
        self.assertEqual(self.poll(self.start+902,110.1),"RANGE_FIRST_BREAKOUT_BUSY_SKIPPED")
        self.b.positions_get=lambda **kwargs:()
        self.poll(self.start+903,111)
        self.assertEqual(self.b.sent,[])
    def test_real_account_refused(self):
        base=self.b.account_info
        def real():
            a=base();a.trade_mode=2;return a
        self.b.account_info=real
        with self.assertRaisesRegex(Fault,"DEMO_ONLY"):self.poll(self.start-1)
        self.assertEqual(self.b.sent,[])
    def test_unverified_event_cannot_create_order(self):
        self.arm();self.poll(self.start+902,110.1)
        state=list(self.e.states.values())[0]
        self.e.range_event=None
        self.b.pos=[]
        with self.assertRaisesRegex(Fault,"RANGE_EVENT_NOT_VERIFIED"):self.e.request(state)
    def test_live_broker_clock_offset(self):
        self.b.offset=-7200
        for r in self.b.rows:r['time']+=7200
        self.b.times=[r['time'] for r in self.b.rows]
        self.assertEqual(self.poll(self.start+7200-1),'RANGE_WAIT_1030_NY')
        self.assertEqual(self.poll(self.start+7200+900,109),'RANGE_WAIT_FIRST_BUY_BREAKOUT')
        self.assertEqual(self.poll(self.start+7200+902,110.1),'RANGE_BUY_ACCEPTED')
        self.assertEqual(self.b.sent[0]['sl'],100.)
    def test_replay_polls_inside_m1_candle(self):
        from gold_replay import Replay
        replay=Replay(self.b,self.config,self.root/'replay')
        replay.tick(self.start-1,100,100.2)
        replay.tick(self.start+900,109,109.2)
        replay.tick(self.start+902,110.1,110.3)
        self.assertEqual(len(self.b.sent),1)
        self.assertEqual(self.b.sent[0]['price'],110.3)
    def test_ny_dst_and_broker_offsets(self):
        for day,expected in [("2026-10-19",14),("2026-11-17",15)]:
            ts=stamp(day+"T12:00:00Z")
            _,s,e=window(ts)
            self.assertEqual(datetime.fromtimestamp(s,timezone.utc).hour,expected)
            self.assertEqual(int(e-s),900)
            self.assertEqual(ny_local(s).strftime("%H:%M"),"10:30")
        self.assertEqual(axi_offset(stamp("2026-10-19T15:00:00Z")),-10800)
        self.assertEqual(axi_offset(stamp("2026-11-17T15:00:00Z")),-7200)
        self.assertEqual(axi_utc(stamp("2026-10-19T17:30:00Z")),stamp("2026-10-19T14:30:00Z"))
        self.assertEqual(axi_utc(stamp("2026-11-17T17:30:00Z")),stamp("2026-11-17T15:30:00Z"))
    def test_exact_midpoint_tick_rounding(self):
        self.assertEqual(midpoint(110.1,90,.1),100.1)
        self.assertEqual(midpoint(110,90,.1),100.)
    def test_backtest_30_full_days_across_dst(self):
        s,e=backtest_window(30,stamp("2026-11-18T07:00:00Z"))
        self.assertEqual(s,stamp("2026-10-19T04:00:00Z"))
        self.assertEqual(e,stamp("2026-11-18T05:00:00Z"))
    def test_readonly_market_refuses_order_send(self):
        m=ReadOnlyMarket(NS(order_send=lambda *_:self.fail("REAL ORDER SENT")))
        with self.assertRaisesRegex(RuntimeError,"READ_ONLY"):m.order_send({})
    def test_range_request_validation(self):
        self.arm();self.poll(self.start+902,110.1)
        job=dict(list(self.e.states.values())[0]["job"]);job["rr"]=2
        with self.assertRaisesRegex(Fault,"RANGE_TP1_ONE_R"):validate(job,"USTECH",self.b.clock())

if __name__=="__main__":unittest.main()

