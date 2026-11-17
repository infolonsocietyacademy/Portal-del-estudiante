from pathlib import Path
import sys
from types import SimpleNamespace as NS
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"runtime"))
from market_feed import MarketFeed
from gold_scalp_runner import Strategy, health
import test_gold_scalp as regression


class FeedTest(unittest.TestCase):
    def setUp(self):
        self.clock=[1800000000.]
        self.now=lambda:self.clock[0]
        self.feed=MarketFeed(self.now,self.now)

    def tick(self,offset=0,delay=0):
        stamp=self.now()+offset-delay
        return NS(time=stamp,time_msc=int(stamp*1000),bid=2000.,ask=2000.2)

    def test_current_utc_quote_is_accepted(self):
        self.assertTrue(self.feed.observe(self.tick()))

    def test_old_frozen_tick_is_never_accepted_as_a_clock_offset(self):
        tick=self.tick(offset=-7200)
        for _ in range(20):
            self.assertFalse(self.feed.observe(tick))
            self.clock[0]+=1
        self.assertIsNone(self.feed.offset)

    def test_frozen_quote_becomes_stale_even_after_valid_calibration(self):
        for _ in range(3):
            tick=self.tick(offset=7200)
            self.feed.observe(tick)
            self.clock[0]+=1
        self.assertTrue(self.feed.fresh)
        self.clock[0]+=11
        self.assertFalse(self.feed.observe(tick))

    def test_server_offset_requires_advancing_ticks_over_real_elapsed_time(self):
        self.assertFalse(self.feed.observe(self.tick(offset=7200)))
        self.clock[0]+=1
        self.assertFalse(self.feed.observe(self.tick(offset=7200)))
        self.clock[0]+=1
        self.assertTrue(self.feed.observe(self.tick(offset=7200)))
        self.assertEqual(self.feed.offset,-7200)
        self.assertEqual(self.feed.server_now(),self.now()+7200)

    def test_negative_broker_offset_is_supported(self):
        for _ in range(3):
            self.feed.observe(self.tick(offset=-10800))
            self.clock[0]+=1
        self.assertTrue(self.feed.fresh)
        self.assertEqual(self.feed.offset,10800)

    def test_late_utc_stream_is_not_mistaken_for_a_timezone(self):
        for _ in range(4):
            self.assertFalse(self.feed.observe(self.tick(delay=45)))
            self.clock[0]+=1
        self.assertIsNone(self.feed.offset)

    def test_burst_of_history_is_not_accepted_as_live_stream(self):
        for i in range(4):
            tick=NS(time=self.now()+7200+i*60,time_msc=int((self.now()+7200+i*60)*1000))
            self.assertFalse(self.feed.observe(tick))
        self.assertIsNone(self.feed.offset)

    def test_disconnected_or_invalid_tick_is_not_fresh(self):
        self.assertFalse(self.feed.observe(None))
        self.assertFalse(self.feed.observe(NS(time=float('nan'))))

    def test_old_utc_time_does_not_gain_extra_allowance(self):
        self.assertFalse(self.feed.observe(self.tick(delay=11)))


class StructureClockTest(unittest.TestCase):
    setUp=regression.BrokerTest.setUp
    make=regression.BrokerTest.make
    bars=regression.BrokerTest.bars

    def test_live_server_clock_quote_and_m1_signal_are_compared_in_same_domain(self):
        self.engine.feed=MarketFeed(self.now,self.now)
        self.m.symbol_info_tick=lambda *_:NS(time=self.now()+7200,time_msc=int((self.now()+7200)*1000),bid=2001.05,ask=2001.25)
        for _ in range(3):
            self.engine.market_fresh(self.m.symbol_info_tick('XAUUSD'))
            self.clock[0]+=1
        self.assertTrue(self.engine.feed.fresh)
        self.bars()
        for row in self.m.rows:row['time']+=7200
        from datetime import datetime,timezone
        job={'id':'offset-structure','action':'trade','expires_at':datetime.fromtimestamp(self.now()+60,timezone.utc).isoformat(),
             'symbol':'XAUUSD','direction':'structure','timeframe':'M1','signal_bar':int(self.now())+7200-60,'hold_seconds':0}
        self.engine.accept(job);self.engine.tick()
        self.assertEqual(len(self.m.sent),1)
        self.assertIn('sl',self.m.sent[0])
        self.assertIn('tp',self.m.sent[0])
        d=health(self.engine,'WAIT_NEW_CANDLE')
        self.assertTrue(d['ready'])
        self.assertTrue(d['quote_fresh'])
        self.assertEqual(d['broker_clock_offset_seconds'],-7200)
        self.assertEqual(d['close_policy'],'BROKER_SL_TP_ONLY')


if __name__=='__main__':unittest.main()

