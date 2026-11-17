from datetime import datetime,timezone
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace as NS
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
from gold_replay import ReplayBroker,Replay,ReplayEngine,ReplayClock
from gold_backtest_worker import ReadOnlyMarket
from gold_scalp_core import Engine
import test_gold_scalp as regression


class ReplayTest(unittest.TestCase):
    setUp=regression.BrokerTest.setUp
    make=regression.BrokerTest.make
    bars=regression.BrokerTest.bars

    def paper(self):
        self.bars();self.m.info.trade_contract_size=100.
        rows=[{**r,'time':r['time']+k*60} for r in self.m.rows for k in range(5)]
        return ReplayBroker(rows,self.m.info,self.root/'paper-terminal',offset=-7200)

    def request(self,magic=123,side=0,sl=1999.,tp=2001.):
        return {'action':1,'magic':magic,'symbol':'XAUUSD','volume':.05,'type':side,
                'price':2000.2 if side==0 else 2000.,'sl':sl,'tp':tp}

    def test_real_order_api_is_not_accessible_from_reader(self):
        calls=[]
        reader=ReadOnlyMarket(NS(order_send=lambda *_:calls.append('forbidden')))
        with self.assertRaisesRegex(RuntimeError,'BACKTEST_READ_ONLY_API'):
            reader.order_send({})
        self.assertFalse(calls)

    def test_sl_uses_bid_for_buy_and_gap_fill_is_conservative(self):
        b=self.paper();b.advance(self.now(),2000.,2000.2);b.order_send(self.request())
        b.advance(self.now()+1,1998.,1998.2)
        self.assertEqual(b.closed[0]['reason'],'SL')
        self.assertEqual(b.closed[0]['exit'],1998.)
        self.assertAlmostEqual(b.closed[0]['profit'],-11.)

    def test_tp_uses_level_instead_of_extra_gap_profit(self):
        b=self.paper();b.advance(self.now(),2000.,2000.2);b.order_send(self.request())
        b.advance(self.now()+1,2002.,2002.2)
        self.assertEqual(b.closed[0]['exit'],2001.)
        self.assertAlmostEqual(b.closed[0]['profit'],4.)

    def test_short_exits_use_ask_including_historical_spread(self):
        b=self.paper();b.advance(self.now(),2000.,2000.2);b.order_send(self.request(side=1,sl=2001.,tp=1999.))
        b.advance(self.now()+1,2000.8,2001.1)
        self.assertEqual(b.closed[0]['reason'],'SL')
        self.assertEqual(b.closed[0]['exit'],2001.1)

    def test_open_at_end_is_not_force_closed_or_counted_in_winrate(self):
        b=self.paper();b.advance(self.now(),2000.,2000.2)
        r=Replay(b,self.cfg,self.root/'replay')
        b.order_send(self.request())
        b.advance(self.now()+86400,2000.,2000.2)
        d=r.metrics()
        self.assertEqual(d['closed_trades'],0)
        self.assertIsNone(d['win_rate_percent'])
        self.assertEqual(d['open_at_end'],1)

    def test_replay_does_not_read_unclosed_or_future_bars(self):
        b=self.paper();b.advance(self.now(),2000.,2000.2)
        visible=b.copy_rates_from_pos('XAUUSD',5,1,96)
        self.assertTrue(all(r['time']+300<=self.now() for r in visible))
        b.server_time-=300
        earlier=b.copy_rates_from_pos('XAUUSD',5,1,96)
        self.assertLess(max(r['time'] for r in earlier),max(r['time'] for r in visible))

    def test_production_alpha_signal_engine_is_used_in_replay(self):
        from test_alpha_pro_x import sample
        b=self.paper()
        rows=sample()
        b.offset=0
        b.rows5=rows
        b.times5=[row['time'] for row in rows]
        b.rows=[{**row,'time':row['time']+k*60} for row in rows for k in range(5)]
        b.times=[row['time'] for row in b.rows]
        r=Replay(b,self.cfg,self.root/'replay')
        end=rows[-1]['time']+300
        r.tick(end-300,2001.5,2001.7)
        self.assertFalse(b.sent)
        r.tick(end,2001.5,2001.7)
        self.assertEqual(len(b.sent),1)
        self.assertAlmostEqual(b.sent[0]['sl'],1998.85)
        r.tick(end+.5,2001.5,2001.7)
        self.assertEqual(len(b.sent),1)

    def test_actual_entry_request_matches_production_engine(self):
        b=self.paper();b.advance(self.now(),2001.05,2001.25)
        live=Engine(b,self.root/'live-fixture',{'login':1,'server':'REPLAY-DEMO'},b.terminal,self.cfg,b.clock)
        replay=ReplayEngine(b,self.root/'memory-fixture',{'login':1,'server':'REPLAY-DEMO'},b.terminal,self.cfg,b.clock)
        live.feed=ReplayClock(b);replay.feed=ReplayClock(b)
        job={'id':'same','action':'trade','symbol':'XAUUSD','direction':'buy','sl_distance':2.,'hold_seconds':0,
             'expires_at':datetime.fromtimestamp(b.clock()+60,timezone.utc).isoformat()}
        live.accept(job);replay.accept(job)
        self.assertEqual(live.request(live.states['same']),replay.request(replay.states['same']))

    def test_many_simultaneous_positions_have_no_three_trade_cap(self):
        b=self.paper();b.advance(self.now(),2000.,2000.2)
        for i in range(12):b.order_send(self.request(magic=i+1))
        self.assertEqual(len(b.pos),12)
        self.assertEqual(b.max_open,12)

    def test_zero_profit_is_not_a_win_and_open_positions_are_excluded(self):
        b=self.paper();r=Replay(b,self.cfg,self.root/'replay')
        b.closed=[{'profit':1.},{'profit':-1.},{'profit':0.}]
        d=r.metrics()
        self.assertEqual(d['wins'],1);self.assertEqual(d['losses'],1);self.assertEqual(d['breakeven'],1)
        self.assertAlmostEqual(d['win_rate_percent'],33.3333)


if __name__=='__main__':unittest.main()

