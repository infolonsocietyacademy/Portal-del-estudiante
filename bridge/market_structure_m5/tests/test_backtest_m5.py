"""Native-M5 causal tick replay; real broker writes are unavailable."""
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace as NS
import sys
import unittest
BASE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(BASE/"runtime"))
from gold_replay import ReplayBroker,Replay
from gold_backtest_worker import ReadOnlyMarket,backtest_window
from test_structure_retest import bar,T

class BacktestM5(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.root=Path(self.temp.name)
        self.info=NS(currency_base="XAU",currency_profit="USD",trade_stops_level=10,point=.01,
                     trade_tick_size=.01,digits=2,volume_min=.01,volume_max=100.,volume_step=.01,
                     filling_mode=1,trade_exemode=2,trade_contract_size=100.)
        self.config=dict(symbol="XAUUSD",size_mode="fixed",fixed_lots=.05,risk_percent=.5,max_spread_price=.25,max_stop_price=10.)
        values=[2000.]*60+[1998.,1999.,2001.,2003.,2001.,1999.,1997.,1999.,2001.,2005.,2003.,2001.,1999.,2001.,2003.,2003.5,2006.]
        self.rows=[bar(T+i*300,o=v-.1,h=v+.2,l=v-.2,c=v) for i,v in enumerate(values)]
        self.retest=bar(T+len(self.rows)*300,o=2005.3,h=2006.,l=2005.15,c=2005.8)
        self.rows.append(self.retest)
    def tearDown(self):self.temp.cleanup()
    def broker(self):
        # M1 data deliberately disagree: strategy MUST use native M5 data.
        m1=[bar(T+i*60,o=1000.,h=1001.,l=999.,c=1000.) for i in range(len(self.rows)*5)]
        return ReplayBroker(m1,self.info,self.root,native_m5=self.rows)
    def test_window_is_fourteen_days_and_fully_closed_m5(self):
        start,end=backtest_window(14,T+999)
        self.assertEqual(end%300,0);self.assertEqual(end-start,14*86400)
        self.assertLessEqual(end,T+999)
    def test_native_m5_cannot_see_current_or_future_bar(self):
        b=self.broker();b.server_time=self.retest["time"]+299
        rows=b.copy_rates_from_pos("XAUUSD",5,1,512)
        self.assertNotIn(self.retest,rows)
        self.assertEqual(rows[-1],self.rows[-2])
        b.server_time+=1
        self.assertEqual(b.copy_rates_from_pos("XAUUSD",5,1,512)[-1],self.retest)
    def test_tick_replay_bos_retest_and_tp_match_production(self):
        b=self.broker();r=Replay(b,self.config,self.root)
        bos=self.rows[-2]
        r.tick(bos["time"],2003.5,2003.7)
        self.assertEqual(len(b.sent),0)
        r.tick(bos["time"]+300,2006.,2006.2)
        self.assertEqual(len(b.sent),0)
        r.tick(self.retest["time"]+300,2005.8,2006.)
        self.assertEqual(len(b.sent),1)
        req=b.sent[0]
        self.assertAlmostEqual(req["price"]-req["sl"],req["tp"]-req["price"],places=7)
        r.tick(self.retest["time"]+301,req["tp"],req["tp"]+.2)
        m=r.metrics()
        self.assertEqual((m["closed_trades"],m["wins"],m["losses"]),(1,1,0))
        self.assertEqual(m["max_simultaneous_positions"],1)
    def test_restart_window_does_not_enter_historical_retest(self):
        b=self.broker();r=Replay(b,self.config,self.root)
        r.tick(self.retest["time"]+300,2005.8,2006.)
        self.assertEqual(b.sent,[])
    def test_api_is_read_only(self):
        class Module:
            def account_info(self):return "read"
            def order_send(self,*_):raise AssertionError("must never reach real order API")
        market=ReadOnlyMarket(Module())
        self.assertEqual(market.account_info(),"read")
        for name in ("order_send","order_check","login"):
            with self.assertRaisesRegex(RuntimeError,"BACKTEST_READ_ONLY_API"):getattr(market,name)

if __name__=="__main__":unittest.main()
