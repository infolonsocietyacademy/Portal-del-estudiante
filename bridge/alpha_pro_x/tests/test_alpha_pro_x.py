from datetime import datetime,timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
from alpha_pro_x import alpha_context, ai_score, new_york, AlphaStrategy, engine_context
from gold_scalp_core import Engine,Fault
from gold_scalp_runner import CombinedStrategy
from broker_fixture import FakeMT5


def stamp(s): return int(datetime.fromisoformat(s).replace(tzinfo=timezone.utc).timestamp())

def sample(sell=False):
    start=stamp('2026-11-16T09:00:00')
    rows=[dict(time=start+i*300,open=2000.,high=2001.,low=1999.,close=2000.) for i in range(81)]
    rows.append(dict(time=start+81*300,open=2000.,high=2001.6,low=1999.9,close=2001.5))
    if sell:
        rows=[dict(time=b['time'],open=4000-b['open'],high=4000-b['low'],low=4000-b['high'],close=4000-b['close']) for b in rows]
    return rows


def context(rows,**kw): return alpha_context(list(reversed(rows)),**kw)


class Signals(unittest.TestCase):
    def test_buy_and_structural_rr(self):
        e=context(sample())['events'][0]
        self.assertEqual(e['side'],1)
        self.assertAlmostEqual(e['sl'],1998.85)
        self.assertAlmostEqual(e['tp2']-e['entry'],2*(e['entry']-e['sl']))
    def test_sell_and_structural_rr(self):
        e=context(sample(True))['events'][0]
        self.assertEqual(e['side'],-1)
        self.assertAlmostEqual(e['sl'],2001.15)
        self.assertLess(e['tp3'],e['tp2'])
    def test_no_signal_during_range(self):
        self.assertFalse(context(sample()[:-1])['events'])
    def test_partial_session_rejected(self):
        rows=sample();del rows[-3]
        self.assertFalse(context(rows)['events'])
    def test_partial_first_session_rejected(self):
        self.assertFalse(context(sample()[-3:])['events'])
    def test_future_bar_is_not_used(self):
        rows=sample();a=context(rows)
        rows.append(dict(time=rows[-1]['time']+300,open=2001.5,high=2002.,low=2001.2,close=2001.6))
        self.assertEqual(a,context(rows[:-1]))
    def test_ai_filter_weak_close(self):
        rows=sample();rows[-1].update(open=2001.14,low=1999.,high=2003.,close=2001.16)
        self.assertFalse(context(rows)['events'])
        self.assertTrue(context(rows,ai='Off')['events'])
    def test_strict_score_threshold(self):
        b=dict(open=10.,high=13.,low=9.,close=12.)
        self.assertLess(ai_score(1,b,11.99,9.,3.,.01),7)
    def test_add_cannot_trigger_on_first_signal_bar(self):
        self.assertEqual([e['kind'] for e in context(sample())['events']],['main'])
    def test_add_is_separate_and_only_once(self):
        rows=sample();initial=context(rows)['events'][0]
        rows.append(dict(time=rows[-1]['time']+300,open=2001.5,high=2002.1,low=2001.3,close=2002.))
        add=context(rows)['events'][0]
        self.assertEqual(add['kind'],'add')
        self.assertAlmostEqual(add['sl'],(2002+initial['sl'])/2)
        rows.append(dict(time=rows[-1]['time']+300,open=2002.,high=2002.4,low=2001.6,close=2002.2))
        self.assertFalse(context(rows)['events'])
    def test_retest_requires_later_close_respecting_level(self):
        rows=sample();rows.append(dict(time=rows[-1]['time']+300,open=2001.4,high=2001.6,low=2001.1,close=2001.4))
        self.assertEqual(context(rows,mode='Retest')['events'][0]['kind'],'add')
    def test_no_add_after_stop_even_when_bar_also_touches_add(self):
        rows=sample();rows.append(dict(time=rows[-1]['time']+300,open=2001.5,high=2002.1,low=1998.,close=2002.))
        self.assertFalse(context(rows)['events'])
    def test_reverse_bypasses_ai_and_does_not_issue_close(self):
        rows=sample();rows.append(dict(time=rows[-1]['time']+300,open=2001.,high=2001.1,low=1998.7,close=1998.8))
        e=context(rows)['events'][0]
        self.assertEqual((e['kind'],e['side']),('reverse',-1))
        self.assertNotIn('close',e)
    def test_no_reverse_after_prior_tp1(self):
        rows=sample();rows.append(dict(time=rows[-1]['time']+300,open=2001.5,high=2005.,low=2001.2,close=2004.5))
        rows.append(dict(time=rows[-1]['time']+300,open=2004.5,high=2004.5,low=1998.7,close=1998.8))
        self.assertFalse(context(rows)['events'])
    def test_gap_does_not_generate_late_entry(self):
        rows=sample();rows[-1]['time']+=300
        self.assertFalse(context(rows)['events'])
    def test_ny_dst_boundaries(self):
        self.assertEqual(new_york(stamp('2026-03-08T06:59:00')).hour,1)
        self.assertEqual(new_york(stamp('2026-03-08T07:00:00')).hour,3)
        self.assertEqual(new_york(stamp('2026-11-01T05:59:00')).utcoffset().total_seconds(),-14400)
        self.assertEqual(new_york(stamp('2026-11-01T06:00:00')).utcoffset().total_seconds(),-18000)
    def test_session_is_same_ny_time_in_summer(self):
        rows=sample();delta=stamp('2026-07-13T08:00:00')-rows[0]['time']
        rows=[{**b,'time':b['time']+delta} for b in rows]
        self.assertTrue(context(rows)['events'])
    def test_malformed_history_and_unknown_symbol(self):
        rows=sample();rows[-1]['close']=float('nan')
        self.assertEqual(context(rows)['state'],'ALPHA_INVALID_HISTORY')
        self.assertFalse(context(sample(),symbol='UNKNOWN')['events'])


class CRTCompatibility(unittest.TestCase):
    def test_existing_crt_h1_m5_retest_remains_available(self):
        from gold_scalp_core import crt_context
        start=stamp('2026-11-16T00:00:00')
        rows=[dict(time=start+i*300,open=2000.,high=2001.8,low=1999.5,close=2000.) for i in range(96)]
        for i in range(60,72): rows[i].update(high=2020.,low=1999.)
        for i in range(72,84): rows[i].update(high=2002.,low=1998.)
        rows[90]['high']=2002.
        rows[94].update(open=2000.,high=2003.2,close=2003.)
        rows[95].update(open=2002.8,high=2003.4,low=2002.,close=2003.2)
        result=crt_context(list(reversed(rows)))
        self.assertEqual(result['side'],1)
        self.assertEqual(result['state'],'CRT_RETEST_CONFIRMED')
        self.assertEqual(result['sweep'],1998.)
        self.assertEqual(result['level'],2002.)


class Integration(unittest.TestCase):
    def setUp(self):
        self.tmp=TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.rows=sample()
        self.clock=[self.rows[-1]['time']+300.]
        self.now=lambda:self.clock[0]
        self.mt=FakeMT5(self.now,self.root)
        self.mt.rows=self.rows
        self.mt.tick.bid=2001.5;self.mt.tick.ask=2001.7
        self.cfg=dict(symbol='XAUUSD',size_mode='fixed',fixed_lots=.05,risk_percent=.5,max_spread_price=.6,max_stop_price=20.)
        self.engine=Engine(self.mt,self.root/'state',dict(login='123',server='Axi-Demo'),self.root,self.cfg,self.now)
    def job(self):
        return dict(id='alpha-test',action='trade',expires_at=datetime.fromtimestamp(self.now()+60,timezone.utc).isoformat(),
                    symbol='XAUUSD',direction='alpha',timeframe='M5',signal_bar=self.rows[-1]['time'],
                    alpha_key=context(self.rows)['events'][0]['key'],hold_seconds=0,signal_timeout_seconds=60,rr=2.)
    def test_engine_sends_real_request_with_structural_stop(self):
        self.engine.accept(self.job());self.engine.tick()
        self.assertEqual(len(self.mt.sent),1)
        r=self.mt.sent[0]
        self.assertAlmostEqual(r['sl'],1998.85)
        self.assertLessEqual(abs((r['tp']-r['price'])-2*(r['price']-r['sl'])),.011)
        self.engine.tick();self.assertEqual(len(self.mt.sent),1)
    def test_engine_revalidates_key_and_blocks_tampering(self):
        j=self.job();j['alpha_key']='a'*24
        self.engine.accept(j);self.engine.tick()
        self.assertFalse(self.mt.sent)
    def test_preserves_spread_stop_and_demo_filters(self):
        self.cfg['max_stop_price']=1.
        self.engine.accept(self.job());self.engine.tick()
        self.assertFalse(self.mt.sent)
        self.assertEqual(self.engine.states['alpha-test']['code'],'WAIT_STOP_FILTER')
    def test_restart_deduplicates_order(self):
        j=self.job();self.engine.accept(j);self.engine.tick()
        e=Engine(self.mt,self.root/'state',dict(login='123',server='Axi-Demo'),self.root,self.cfg,self.now)
        e.accept(j);e.tick()
        self.assertEqual(len(self.mt.sent),1)
    def test_strategy_start_does_not_replay_old_signal(self):
        a=AlphaStrategy(self.engine,self.root);a.step()
        self.assertFalse(self.mt.sent)
        AlphaStrategy(self.engine,self.root).step()
        self.assertFalse(self.mt.sent)
    def test_strategy_persisted_cursor_accepts_next_bar_once(self):
        self.mt.rows=self.rows[:-1]
        self.clock[0]-=300
        a=AlphaStrategy(self.engine,self.root);a.step()
        self.mt.rows=self.rows;self.clock[0]+=300
        a.step();a.step()
        self.assertEqual(len(self.mt.sent),1)
        self.assertEqual(self.mt.sent[0]['volume'],.05)
    def test_pause_consumes_signal_without_opening(self):
        self.mt.rows=self.rows[:-1];self.clock[0]-=300
        a=AlphaStrategy(self.engine,self.root);a.step()
        self.mt.rows=self.rows;self.clock[0]+=300
        a.step(paused=True);a.step()
        self.assertFalse(self.mt.sent)
    def test_observed_broker_offset_preserves_ny_session(self):
        self.mt.rows=[{**b,'time':b['time']+7200} for b in self.rows]
        self.engine.market_now=lambda:self.now()+7200
        e=engine_context(self.engine,list(reversed(self.mt.rows)))['events'][0]
        self.assertEqual(e['key'],context(self.rows)['events'][0]['key'])
    def test_combined_runner_keeps_both_strategies(self):
        c=CombinedStrategy(self.engine,self.root)
        with patch.object(c.crt,'step',return_value='CRT_OK') as crt,patch.object(c.alpha,'step',return_value='ALPHA_OK') as alpha:
            self.assertEqual(c.step(),'CRT_OK | ALPHA_OK')
            crt.assert_called_once();alpha.assert_called_once()
    def test_no_timer_close_of_alpha_order(self):
        self.engine.accept(self.job());self.engine.tick();self.engine.tick()
        self.clock[0]+=86400;self.engine.tick()
        self.assertEqual(len(self.mt.sent),1)

if __name__=='__main__':unittest.main()
