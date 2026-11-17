import sys
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
from gold_replay import ReplayBroker,Replay
from broker_fixture import FakeMT5
from gold_backtest_worker import backtest_window,ReadOnlyMarket

T=1794900000//14400*14400
def bar(t,o=2000.,h=2001.,l=1999.,c=2000.):
    return dict(time=t,open=o,high=h,low=l,close=c)

class H4Replay(unittest.TestCase):
    def test_native_h4_cannot_read_a_forming_candle(self):
        with TemporaryDirectory() as tmp:
            info=FakeMT5(lambda:T,Path(tmp)).info;info.trade_contract_size=100.
            native=[bar(T-14400),bar(T)]
            b=ReplayBroker([],info,tmp,native_h4=native)
            b.advance(T+14399,2000.,2000.16)
            self.assertEqual(b.copy_rates_from_pos('XAUUSD',b.TIMEFRAME_H4,1,64),native[:1])
            b.advance(T+14400,2000.,2000.16)
            self.assertEqual(b.copy_rates_from_pos('XAUUSD',b.TIMEFRAME_H4,1,64),native)
    def test_replay_uses_actual_h4_strategy_with_one_r_target(self):
        with TemporaryDirectory() as tmp:
            info=FakeMT5(lambda:T,Path(tmp)).info;info.trade_contract_size=100.
            rows=[bar(T+i*60) for i in range(-120,1)]+[bar(T+60,1999.,2001.,1997.,2000.)]
            native=[bar(T-i*14400,h=2002.,l=1998.) for i in range(8,0,-1)]
            b=ReplayBroker(rows,info,tmp,native_h4=native)
            cfg=dict(symbol='XAUUSD',size_mode='fixed',fixed_lots=.05,risk_percent=.5,max_spread_price=.18,max_stop_price=10.)
            replay=Replay(b,cfg,Path(tmp)/'replay')
            replay.tick(T+60,2000.,2000.16)
            self.assertFalse(b.sent)
            replay.tick(T+120,2000.,2000.16)
            self.assertEqual(len(b.sent),1)
            order=b.sent[0]
            self.assertAlmostEqual(order['tp']-order['price'],order['price']-order['sl'])
            replay.tick(T+121,order['tp'],order['tp']+.16)
            self.assertEqual(replay.metrics()['wins'],1)
    def test_fourteen_day_window_and_read_only_wrapper(self):
        start,end=backtest_window(14,T+73)
        self.assertEqual(end-start,14*86400)
        self.assertEqual(end%60,0)
        with self.assertRaisesRegex(RuntimeError,'BACKTEST_READ_ONLY_API'):
            ReadOnlyMarket(None).order_send

if __name__=='__main__':unittest.main()
