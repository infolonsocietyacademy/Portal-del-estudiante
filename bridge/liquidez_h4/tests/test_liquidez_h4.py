"""Offline signal, persistence and broker-protection tests. Never connects to MT5."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace as NS
import unittest

RUNTIME = Path(__file__).resolve().parents[1] / "runtime"
sys.path.insert(0, str(RUNTIME))
from liquidez_h4 import SignalState, Strategy
from gold_scalp_core import Engine, Fault, validate
from broker_fixture import FakeMT5

T = 1794900000 // 14400 * 14400


def bar(t=T, o=2000., h=2001., l=1999., c=2000.):
    return dict(time=t, open=o, high=h, low=l, close=c)


def higher():
    return [bar(T-14400*i, h=2002., l=1998.) for i in range(8, 0, -1)]


def buy(t=T+60):
    return bar(t, o=1999., h=2001., l=1997., c=2000.)


def sell(t=T+60):
    return bar(t, o=2001., h=2003., l=1999., c=2000.)


class SignalTests(unittest.TestCase):
    def state(self, pivots=False):
        s=SignalState(pivots=pivots)
        s.step(bar(), higher())
        return s

    def test_buy_first_low_sweep(self):
        e=self.state().step(buy(), higher())
        self.assertEqual(e['side'],1)
        self.assertAlmostEqual(e['sl_bid'],1996.95)

    def test_sell_first_high_sweep(self):
        e=self.state().step(sell(), higher())
        self.assertEqual(e['side'],-1)
        self.assertAlmostEqual(e['sl_bid'],2003.05)

    def test_no_signal_on_touch(self):
        self.assertIsNone(self.state().step(bar(T+60,l=1998.), higher()))

    def test_no_signal_on_breakout_close(self):
        self.assertIsNone(self.state().step(bar(T+60,o=2000.,h=2004.,c=2003.), higher()))

    def test_no_reuse_of_taken_levels(self):
        s=self.state()
        self.assertIsNotNone(s.step(buy(),higher()))
        self.assertIsNone(s.step(buy(T+120),higher()))

    def test_invalid_color_still_consumes_level(self):
        s=self.state()
        self.assertIsNone(s.step(bar(T+60,o=2001.,l=1997.,c=2000.),higher()))
        self.assertIsNone(s.step(buy(T+120),higher()))

    def test_no_direction_for_two_sided_sweep(self):
        self.assertIsNone(self.state().step(bar(T+60,o=1999.,h=2003.,l=1997.,c=2000.),higher()))

    def test_unclosed_h4_ignored(self):
        rows=higher()+[bar(T,h=2050.,l=1950.)]
        e=self.state().step(buy(),rows)
        self.assertEqual(e['side'],1)

    def test_h4_time_origin_is_not_utc_bucket(self):
        # Native broker candles shifted by one hour remain authoritative.
        rows=[dict(b,time=b['time']+3600) for b in higher()]
        s=SignalState()
        s.step(bar(T+3600),rows)
        self.assertEqual(s.step(buy(T+3660),rows)['side'],1)

    def test_pivot_confirmation_uses_closed_neighbours(self):
        rows=higher()
        rows[-2]['high']=2004.
        s=SignalState(pivots=True)
        s.step(bar(),rows)
        e=s.step(bar(T+60,o=2001.,h=2005.,c=2000.),rows)
        self.assertEqual(e['side'],-1)

    def test_newest_h4_cannot_be_confirmed_pivot(self):
        self.assertIsNone(self.state(pivots=True).step(buy(),higher()))

    def test_restore_preserves_consumed_levels(self):
        s=self.state()
        s.step(buy(),higher())
        restored=SignalState(state=json.loads(json.dumps(s.dump())))
        self.assertIsNone(restored.step(buy(T+120),higher()))

    def test_future_or_duplicate_bar_rejected(self):
        s=self.state()
        with self.assertRaises(ValueError):s.step(bar(),higher())
        with self.assertRaises(ValueError):s.step(bar(T+60,h=float('nan')),higher())

    def test_corrupt_cursor_cannot_resume(self):
        d=self.state().dump();d['previous_close']=None
        with self.assertRaises(ValueError):SignalState(state=d)

    def test_prune_only_expired_origin_levels(self):
        s=self.state();s.step(buy(),higher())
        rows=higher()+[bar(T,h=2003.,l=1996.)]
        s.step(bar(T+14400),rows)
        self.assertTrue(s.lows_taken <= {b['time'] for b in rows[-3:]})


class BrokerTests(unittest.TestCase):
    def setUp(self):
        self.tmp=TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.base=Path(self.tmp.name);self.now=T+121.
        self.m=FakeMT5(lambda:self.now,self.base)
        self.m.TIMEFRAME_H4=240
        self.m.tick.ask=2000.1
        self.config=dict(symbol='XAUUSD',size_mode='fixed',fixed_lots=.05,risk_percent=.5,
                         max_spread_price=.18,max_stop_price=10.)
        self.e=Engine(self.m,self.base/'state',dict(login=123,server='Axi-Demo'),self.base,self.config,clock=lambda:self.now)
        self.rows=[bar(T+60-60*(95-i)) for i in range(96)]
        self.rows[-1]=buy()
        self.m.rows=self.rows
        self.m.copy_rates_from_pos=lambda symbol,tf,start,count:higher() if tf==240 else self.rows

    def event(self, side=1):
        s=SignalState();s.step(bar(),higher())
        event=s.step(buy() if side>0 else sell(),higher())
        self.e.lh4_event=event
        return event

    def job(self,event):
        return dict(id='lh4-fixture-'+event['key'],action='trade',symbol='XAUUSD',direction='liquidez_h4',
                    timeframe='M1',signal_bar=event['time'],lh4_key=event['key'],hold_seconds=0,
                    signal_timeout_seconds=60,rr=1.,expires_at=datetime.fromtimestamp(self.now+60,timezone.utc).isoformat())

    def test_buy_protected_and_tp1_one_r(self):
        self.e.accept(self.job(self.event()));self.e.tick()
        self.assertEqual(len(self.m.sent),1)
        r=self.m.sent[0]
        self.assertEqual(r['volume'],.05)
        self.assertAlmostEqual(r['sl'],1996.95)
        self.assertAlmostEqual(r['tp']-r['price'],r['price']-r['sl'])

    def test_sell_spread_adjusted_stop_and_tp1(self):
        ev=self.event(-1);self.e.accept(self.job(ev));self.e.tick()
        r=self.m.sent[0]
        self.assertAlmostEqual(r['sl'],2003.15)
        self.assertAlmostEqual(r['price']-r['tp'],r['sl']-r['price'])

    def test_real_account_blocked(self):
        self.m.account.trade_mode=2
        with self.assertRaises(Fault):self.e.accept(self.job(self.event()))
        self.assertFalse(self.m.sent)

    def test_second_position_blocked_even_on_hedging(self):
        ev=self.event();self.m.pos=[NS(symbol='XAUUSD',magic=1)]
        self.e.accept(self.job(ev));self.e.tick()
        self.assertFalse(self.m.sent)

    def test_excess_spread_blocks_entry(self):
        self.m.tick.ask=2001.
        self.e.accept(self.job(self.event()));self.e.tick()
        self.assertFalse(self.m.sent)

    def test_no_close_for_stop_marker_or_opposite_signal(self):
        self.e.accept(self.job(self.event()));self.e.tick()
        self.assertEqual(len(self.m.sent),1)
        self.now+=3600;self.e.tick()
        self.assertEqual(len(self.m.sent),1)
        self.assertNotIn('position',self.m.sent[0])

    def test_missing_verified_event_blocks_send(self):
        job=self.job(self.event());self.e.lh4_event=None
        self.e.accept(job);self.e.tick();self.assertFalse(self.m.sent)

    def test_old_breakfake_intents_rejected(self):
        j=self.job(self.event());j['direction']='breakfake'
        with self.assertRaises(Fault):self.e.accept(j)

    def test_duplicate_event_id_does_not_send_twice(self):
        j=self.job(self.event());self.e.accept(j);self.e.tick();self.e.accept(j);self.e.tick()
        self.assertEqual(len(self.m.sent),1)

    def test_warmup_has_no_historical_entry(self):
        s=Strategy(self.e,self.base)
        self.assertEqual(s.step(),'LIQH4_WARMED_NO_HISTORICAL_ENTRY')
        self.assertFalse(self.m.sent)
        self.assertEqual(s.step(),'LIQH4_WAIT_NEW_CANDLE')

    def test_restart_does_not_trade_last_historical_signal(self):
        s=Strategy(self.e,self.base);s.step()
        restored=Strategy(self.e,self.base)
        self.assertEqual(restored.step(),'LIQH4_WAIT_NEW_CANDLE')
        self.assertFalse(self.m.sent)

    def test_live_closed_bar_trades_only_once(self):
        self.rows[-1]=bar(T+60)
        s=Strategy(self.e,self.base);s.step()
        self.rows.append(buy(T+120));self.now=T+181.
        self.assertEqual(s.step(),'LIQH4_SIGNAL_ACCEPTED')
        self.assertEqual(len(self.m.sent),1)
        s.step();self.assertEqual(len(self.m.sent),1)

    def test_paused_worker_consumes_signal_without_entry(self):
        self.rows[-1]=bar(T+60)
        s=Strategy(self.e,self.base);s.step()
        self.rows.append(buy(T+120));self.now=T+181.
        self.assertEqual(s.step(paused=True),'PAUSED_SL_TP_ONLY')
        self.assertFalse(self.m.sent)
        self.assertEqual(s.step(),'LIQH4_WAIT_NEW_CANDLE')


if __name__=='__main__':unittest.main()
