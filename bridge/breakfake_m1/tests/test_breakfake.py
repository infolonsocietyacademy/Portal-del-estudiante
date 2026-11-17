import json
from datetime import datetime,timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
from breakfake_m1 import SignalState,Strategy,valid_bar,event_key
from gold_scalp_core import Engine,Fault
from broker_fixture import FakeMT5

BASE=1800000000

def bar(i,o=2000.,h=2001.,l=1999.,c=2000.):return dict(time=BASE+i*60,open=o,high=h,low=l,close=c)

def warm():
 s=SignalState()
 for i in range(96):assert s.step(bar(i)) is None
 return s

def breakout(i=96,sell=False):
 return bar(i,2000.,2000.1 if sell else 2002.1,1997.9 if sell else 1999.9,1998. if sell else 2002.)

def fake(i=96,sell=False):
 return bar(i,2000.,2001.5 if sell else 2000.4,1999.6 if sell else 1998.5,1999.8 if sell else 2000.2)

class Signals(unittest.TestCase):
 def test_break_buy(self):
  e=warm().step(breakout());self.assertEqual((e['kind'],e['side']),('breakout',1));self.assertAlmostEqual(e['sl_bid'],1998.6)
 def test_break_sell(self):
  e=warm().step(breakout(sell=True));self.assertEqual((e['kind'],e['side']),('breakout',-1));self.assertAlmostEqual(e['sl_bid'],2001.4)
 def test_wick_fake_buy(self):
  e=warm().step(fake());self.assertEqual((e['kind'],e['side']),('fake',1));self.assertLess(e['sl_bid'],1998.5)
 def test_wick_fake_sell(self):
  e=warm().step(fake(sell=True));self.assertEqual((e['kind'],e['side']),('fake',-1));self.assertGreater(e['sl_bid'],2001.5)
 def test_break_then_reclaim_sell_and_full_sweep_stop(self):
  s=warm();s.step(breakout());e=s.step(bar(97,2002.,2003.,2000.2,2000.5))
  self.assertEqual((e['kind'],e['side']),('fake',-1));self.assertGreater(e['sl_bid'],2003.)
 def test_break_then_reclaim_buy(self):
  s=warm();s.step(breakout(sell=True));e=s.step(bar(97,1998.,1999.8,1997.,1999.5))
  self.assertEqual((e['kind'],e['side']),('fake',1));self.assertLess(e['sl_bid'],1997.)
 def test_both_extremes_is_ambiguous(self):self.assertIsNone(warm().step(bar(96,2000.,2002.,1998.,2000.2)))
 def test_weak_body_is_not_a_breakout_entry(self):self.assertIsNone(warm().step(bar(96,2001.3,2002.6,2000.,2001.5)))
 def test_history_gap_skips_signal(self):self.assertIsNone(warm().step(breakout(98)))
 def test_incomplete_warmup_has_no_signal(self):self.assertIsNone(SignalState().step(breakout()))
 def test_matches_actual_pine_signal_block_on_recorded_cases(self):
  fixtures=json.loads(Path(__file__).with_name('pine_signal_cases.json').read_text())
  state=SignalState()
  for i,row in enumerate(fixtures['rows']):
   event=state.step(row['bar'])
   code=0 if event is None else event['side']*(2 if event['kind']=='fake' else 1)
   self.assertEqual(code,row['signal'],f'Pine comparison bar {i}')
   if event:self.assertAlmostEqual(event['sl_bid'],row['sl_bid'],places=9)
   if i and i%127==0:state=SignalState(state=json.loads(json.dumps(state.dump())))
 def test_restart_keeps_signal_and_arms(self):
  s=warm();s.step(breakout());r=SignalState(state=json.loads(json.dumps(s.dump())))
  self.assertEqual(r.dump(),s.dump())
  for i in range(97,696):
   b=bar(i,2002.+i-97,2003.1+i-97,2001.9+i-97,2003.+i-97)
   self.assertIsNone(s.step(b));self.assertEqual(r.step(b),s.last_event)
 def test_reclaim_after_timeout_is_not_a_delayed_fake(self):
  s=warm();s.step(breakout())
  for i in range(97,100):self.assertIsNone(s.step(bar(i,2002.,2002.1,2001.5,2001.8)))
  self.assertIsNone(s.step(bar(100,2001.8,2002.,2000.,2000.5)))
 def test_corrupt_state_is_rejected(self):
  d=warm().dump();d['watch_side']=7
  with self.assertRaisesRegex(ValueError,'BF_CORRUPT'):SignalState(state=d)
 def test_wrong_symbol_is_rejected(self):
  with self.assertRaisesRegex(ValueError,'BF_SYMBOL'):SignalState('EURUSD')
 def test_non_monotonic_bars_are_rejected(self):
  s=warm()
  with self.assertRaisesRegex(ValueError,'BF_NON_MONOTONIC'):s.step(bar(95))
 def test_invalid_ohlc_is_rejected(self):
  with self.assertRaisesRegex(ValueError,'BF_INVALID'):warm().step(bar(96,2000.,1998.,1999.,2000.))

class Execution(unittest.TestCase):
 def setUp(self):
  self.tmp=TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
  self.clock=[BASE+97*60.];self.now=lambda:self.clock[0]
  self.mt=FakeMT5(self.now,self.root)
  self.cfg=dict(symbol='XAUUSD',size_mode='fixed',fixed_lots=.05,risk_percent=.5,max_spread_price=.18,max_stop_price=10.)
  self.engine=self.make();self.mt.rows=[bar(i) for i in range(96)]+[breakout()]
  self.mt.tick.bid=2002.;self.mt.tick.ask=2002.16
  self.engine.bf_event=warm().step(breakout())
 def make(self):return Engine(self.mt,self.root/'state',dict(login='123',server='Axi-Demo'),self.root,self.cfg,self.now)
 def job(self,**kw):
  return dict(id='bf-fixture',action='trade',symbol='XAUUSD',direction='breakfake',timeframe='M1',signal_bar=self.engine.bf_event['time'],
              bf_key=self.engine.bf_event['key'],hold_seconds=0,rr=1.,expires_at=datetime.fromtimestamp(self.now()+60,timezone.utc).isoformat(),**kw)
 def open(self):self.engine.accept(self.job());self.engine.tick();self.engine.tick()
 def test_old_crt_cannot_create_a_new_order(self):
  job=self.job();job.update(direction='crt',timeframe='M5',crt_setup=BASE)
  job.pop('bf_key')
  with self.assertRaisesRegex(Fault,'INVALID_DIRECTION'):self.engine.accept(job)
  self.assertFalse(self.mt.sent)
 def test_persisted_crt_cannot_submit_even_without_new_validation(self):
  job=self.job();job['direction']='crt'
  with self.assertRaisesRegex(Fault,'RETIRED_STRATEGY'):
   self.engine.request({'job':job})
  self.assertFalse(self.mt.sent)
 def test_retiring_crt_does_not_force_close_existing_positions(self):
  self.open();state=self.engine.states['bf-fixture'];state['job']['direction']='crt'
  self.engine.save(state);sent=len(self.mt.sent)
  self.engine.tick()
  self.assertEqual(len(self.mt.sent),sent)
  self.assertEqual(len(self.mt.pos),1)
 def test_old_crt_signal_functions_are_removed(self):
  import gold_scalp_core
  self.assertFalse(hasattr(gold_scalp_core,'crt_context'))
  self.assertFalse(hasattr(gold_scalp_core,'crt_signal'))
 def test_buy_has_structural_sl_and_full_tp1(self):
  self.open();r=self.mt.sent[0]
  self.assertAlmostEqual(r['sl'],1998.6);self.assertAlmostEqual(r['tp']-r['price'],r['price']-r['sl'])
  self.assertEqual(r['volume'],.05);self.assertNotIn('position',r)
 def test_sell_sl_accounts_for_ask_trigger_and_tp1(self):
  self.mt.rows[-1]=breakout(sell=True);self.engine.bf_event=warm().step(breakout(sell=True))
  self.mt.tick.bid=1998.;self.mt.tick.ask=1998.16
  self.open();r=self.mt.sent[0]
  self.assertEqual(r['type'],1);self.assertGreaterEqual(r['sl'],2001.4+.16-1e-9)
  self.assertAlmostEqual(r['price']-r['tp'],r['sl']-r['price'])
 def test_fake_buy_sl_is_beyond_sweep(self):
  self.mt.rows[-1]=fake();self.engine.bf_event=warm().step(fake());self.mt.tick.bid=2000.2;self.mt.tick.ask=2000.36
  self.open();self.assertLess(self.mt.sent[0]['sl'],1998.5)
 def test_fake_sell_sl_is_beyond_sweep_plus_spread(self):
  self.mt.rows[-1]=fake(sell=True);self.engine.bf_event=warm().step(fake(sell=True));self.mt.tick.bid=1999.8;self.mt.tick.ask=1999.96
  self.open();r=self.mt.sent[0];self.assertGreater(r['sl'],2001.5+.16)
  self.assertAlmostEqual(r['price']-r['tp'],r['sl']-r['price'])
 def test_broker_minimum_stop_rejects_no_naked_order(self):
  self.mt.info.trade_stops_level=500;self.open();self.assertFalse(self.mt.sent)
  self.assertEqual(self.engine.states['bf-fixture']['code'],'BF_STRUCTURAL_STOP_TOO_CLOSE')
 def test_maximum_stop_is_not_silently_widened(self):
  self.cfg['max_stop_price']=1.;self.open();self.assertFalse(self.mt.sent)
 def test_stops_rounded_to_broker_tick_grid(self):
  self.mt.info.trade_tick_size=.05;self.open();r=self.mt.sent[0]
  self.assertAlmostEqual(r['sl']/.05,round(r['sl']/.05));self.assertAlmostEqual(r['tp']/.05,round(r['tp']/.05))
  self.assertGreaterEqual(r['tp']-r['price'],r['price']-r['sl']-1e-9)
 def test_no_tp2_or_tp3_override(self):
  j=self.job();j['rr']=2.
  with self.assertRaisesRegex(Fault,'BF_TP1'):self.engine.accept(j)
 def test_wrong_timeframe_rejected(self):
  j=self.job();j['timeframe']='M5'
  with self.assertRaisesRegex(Fault,'BF_CLOSED_M1'):self.engine.accept(j)
 def test_stale_signal_is_not_executed(self):
  self.clock[0]+=11;self.open();self.assertFalse(self.mt.sent)
 def test_wide_spread_blocks_opening(self):
  self.mt.tick.ask=2002.5;self.open();self.assertFalse(self.mt.sent)
 def test_event_cannot_be_injected_remotely(self):
  j=self.job();j['bf_key']='a'*24;self.engine.accept(j);self.engine.tick();self.assertFalse(self.mt.sent)
 def test_real_account_rejected(self):
  self.mt.account.trade_mode=2
  with self.assertRaisesRegex(Fault,'DEMO_ONLY'):self.open()
 def test_netting_conflict_preserves_other_position(self):
  from types import SimpleNamespace as NS
  self.mt.account.margin_mode=0;self.mt.pos=[NS(ticket=1,magic=22,symbol='XAUUSD')]
  self.open();self.assertFalse(self.mt.sent);self.assertEqual(len(self.mt.pos),1)
 def test_broker_rejection_does_not_retry_unprotected(self):
  self.mt.check_code=10016;self.open();self.assertFalse(self.mt.sent)
 def test_same_signal_cannot_be_reissued_under_another_job_id(self):
  self.open();job=self.job();job['id']='bf-duplicate-other-id'
  with self.assertRaisesRegex(Fault,'BF_EVENT_ALREADY_CONSUMED'):self.engine.accept(job)
  self.assertEqual(len(self.mt.sent),1)
 def test_forming_bar_cannot_trigger_entry(self):
  self.clock[0]-=1;self.open();self.assertFalse(self.mt.sent)
 def test_uncertain_order_is_not_retried(self):
  self.mt.next_code=None;self.open();self.clock[0]+=1;self.engine.tick()
  self.assertEqual(len(self.mt.sent),1)
 def test_restart_does_not_duplicate_open_order(self):
  j=self.job();self.open();self.engine=self.make();self.engine.bf_event=warm().step(breakout())
  self.engine.accept(j);self.engine.tick();self.assertEqual(len(self.mt.sent),1)
 def test_no_timer_exit_or_partial_exit(self):
  self.open()
  for dt in (60,3600,86400):self.clock[0]+=dt;self.engine.tick()
  self.assertEqual(len(self.mt.sent),1);self.assertEqual(self.mt.pos[0].volume,.05)
 def test_request_protection_is_recorded_for_review(self):
  self.open();s=self.engine.summary(self.engine.states['bf-fixture'])
  self.assertEqual(s['submitted_sl'],self.mt.sent[0]['sl']);self.assertEqual(s['submitted_tp'],self.mt.sent[0]['tp']);self.assertEqual(s['target_r'],1.)
 def test_first_start_never_sends_historical_signal(self):
  self.engine.bf_event=None;strategy=Strategy(self.engine,self.root);strategy.step();self.assertFalse(self.mt.sent)
 def test_next_closed_minute_sends_once(self):
  self.mt.rows=self.mt.rows[:-1];self.clock[0]-=60
  strategy=Strategy(self.engine,self.root);strategy.step();self.mt.rows.append(breakout());self.clock[0]+=60
  strategy.step();strategy.step();self.assertEqual(len(self.mt.sent),1)
  Strategy(self.make(),self.root).step();self.assertEqual(len(self.mt.sent),1)
 def test_pause_skips_new_signal(self):
  self.mt.rows=self.mt.rows[:-1];self.clock[0]-=60
  strategy=Strategy(self.engine,self.root);strategy.step();self.mt.rows.append(breakout());self.clock[0]+=60
  strategy.step(paused=True);strategy.step();self.assertFalse(self.mt.sent)
 def test_percentage_risk_respects_cash_budget(self):
  self.cfg['size_mode']='percent';self.open();r=self.mt.sent[0]
  self.assertLessEqual((r['price']-r['sl'])*100*r['volume'],self.mt.account.equity*.005+1e-6)
 def test_gap_cannot_trigger_new_entry(self):
  self.mt.rows=self.mt.rows[:-1];self.clock[0]-=60
  strategy=Strategy(self.engine,self.root);strategy.step();self.mt.rows.append(breakout(98));self.clock[0]+=180
  strategy.step();self.assertFalse(self.mt.sent)

if __name__=='__main__':unittest.main()
