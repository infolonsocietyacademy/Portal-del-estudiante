import unittest
from datetime import date
import numpy as np
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'/'lab_payload'))
import lab

class LabTests(unittest.TestCase):
    def setUp(self):
        self.c={**lab.DEFAULT,'commission_roundtrip_per_lot':2.,'slippage_points_per_side':.2,'max_spread_points':5}
        self.info=dict(point=1.,trade_tick_size=1.,trade_tick_value_profit=1.,trade_tick_value_loss=1.,volume_min=1.,volume_max=1.,volume_step=1.,trade_stops_level=0.)
        self.d=date(2026,11,18)
        s,a,e=lab.bounds(self.d)
        q=[]
        for i in range(15):
            q.extend([[s+i*60000,90,91],[s+i*60000+59000,100,101]])
        q.extend([[a,101,102],[a+59000,102,103],[a+60000,103,104],
                  [a+120000,120,121],[e,105,106]])
        self.q=np.array(q,dtype=float)
        self.p=dict(frame=1,pivot=2,atr_buffer=0.,buffer_ticks=2,lookback=30,
                    confirmation='Cierre',exit_mode='TP1')

    def test_no_lookahead(self):
        arm=lab.bounds(self.d)[1]
        self.assertIsNone(lab.replay(self.q[self.q[:,0]<arm+60000],self.d,self.p,self.c,self.info))
        t=lab.replay(self.q,self.d,self.p,self.c,self.info)
        self.assertEqual(t['entry_ms'],arm+60000)
        self.assertAlmostEqual(t['entry'],104.2)

    def test_costs_and_tp_gap_cap(self):
        t=lab.replay(self.q,self.d,self.p,self.c,self.info)
        self.assertAlmostEqual(t['exit'],t['tp']-.2)
        self.assertAlmostEqual(t['net'],t['exit']-t['entry']-2)
        c={**self.c,'commission_roundtrip_per_lot':0,'slippage_points_per_side':0}
        t0=lab.replay(self.q,self.d,self.p,c,self.info)
        self.assertGreater(t0['net'],t['net'])

    def test_stop_gap_fills_worse_than_stop(self):
        q=self.q.copy();q[-2,1:]=[80,81]
        t=lab.replay(q,self.d,self.p,self.c,self.info)
        self.assertEqual(t['reason'],'SL')
        self.assertAlmostEqual(t['exit'],79.8)
        self.assertLess(t['exit'],t['sl'])

    def test_four_wins_cannot_pass(self):
        ts=[dict(net=10,worst=0) for _ in range(4)]
        m=lab.metrics(ts,self.c)
        self.assertEqual(m['winrate'],1)
        self.assertFalse(lab.passes(m,self.c,40))

    def test_net_not_tp_counts_win(self):
        m=lab.metrics([dict(net=-1,worst=-1,reason='TP')],self.c)
        self.assertEqual(m['wins'],0)

    def test_drawdown_includes_floating_peak(self):
        m=lab.metrics([dict(net=-10,worst=-100,dd_pairs=[[1000,-100]])],self.c)
        self.assertAlmostEqual(m['max_drawdown_pct'],10)

    def test_drawdown_and_sample_gates(self):
        good=[dict(net=1,worst=-1) for _ in range(75)]+[dict(net=-1,worst=-1) for _ in range(25)]
        m=lab.metrics(good,self.c)
        self.assertTrue(lab.passes(m,self.c,40))
        self.assertFalse(lab.passes({**m,'max_drawdown_pct':11},self.c,40))
        self.assertFalse(lab.passes({**m,'net':-1},self.c,40))

    def test_open_trade_blocks_approval(self):
        t=lab.replay(self.q[:-2],self.d,self.p,self.c,self.info)
        self.assertIsNone(t['net'])
        m=lab.metrics([t],self.c)
        self.assertEqual(m['open_trades'],1)
        self.assertFalse(lab.passes(m,self.c,40))

    def test_bad_quotes_rejected(self):
        q=self.q.copy();q[0,2]=q[0,1]-1
        with self.assertRaises(ValueError):lab.check_quotes(q)

    def test_spring_and_winter_new_york(self):
        from datetime import datetime,timezone
        for day,hour in [(date(2026,7,1),14),(date(2026,11,18),15)]:
            t=lab.bounds(day)[0]
            self.assertEqual(datetime.fromtimestamp(t/1000,timezone.utc).hour,hour)


    def test_sell_uses_bid_entry_ask_exit(self):
        arm=lab.bounds(self.d)[1]
        q=self.q.copy()
        q[q[:,0]==arm,1:]=[89,90]
        q[q[:,0]==arm+59000,1:]=[88,89]
        q[q[:,0]==arm+60000,1:]=[87,88]
        q[q[:,0]==arm+120000,1:]=[60,61]
        t=lab.replay(q,self.d,self.p,self.c,self.info)
        self.assertEqual(t['side'],'SELL')
        self.assertAlmostEqual(t['entry'],86.8)
        self.assertEqual(t['sl'],102)
        self.assertAlmostEqual(t['exit'],t['tp']+.2)
        self.assertAlmostEqual(t['net'],t['entry']-t['exit']-2)

    def test_short_stop_uses_ask(self):
        arm=lab.bounds(self.d)[1]
        q=self.q.copy()
        for offset,quotes in [(0,[89,90]),(59000,[88,89]),(60000,[87,88]),(120000,[100,103])]:
            q[q[:,0]==arm+offset,1:]=quotes
        t=lab.replay(q,self.d,self.p,self.c,self.info)
        self.assertEqual(t['reason'],'SL')
        self.assertAlmostEqual(t['exit'],103.2)

    def test_future_prices_do_not_move_entry_or_stop(self):
        first=lab.replay(self.q,self.d,self.p,self.c,self.info)
        q=self.q.copy();q[-2,1:]=[1000,1001]
        second=lab.replay(q,self.d,self.p,self.c,self.info)
        self.assertEqual(first['entry'],second['entry'])
        self.assertEqual(first['sl'],second['sl'])
        self.assertEqual(first['entry_ms'],second['entry_ms'])

    def test_pivot_must_be_confirmed_before_entry(self):
        from range_structure import stop_at
        # 80 is a trough but has only one right-hand candle at k=2.
        bars=np.array([[0,100,110,90,100],[1,100,110,80,100],
                       [2,100,110,95,100],[3,100,110,96,100]],dtype=float)
        p={**self.p,'pivot':1,'lookback':5}
        self.assertEqual(stop_at(bars,2,'BUY',p,self.info),78)
        # At k=1 that trough is not confirmed. Fallback includes it conservatively.
        # A deeper FUTURE low may never enter the SL computed at k=2.
        before=stop_at(bars,2,'BUY',p,self.info)
        bars[3,3]=1
        self.assertEqual(stop_at(bars,2,'BUY',p,self.info),before)

    def test_buffer_goes_beyond_signal_extreme(self):
        from range_structure import stop_at
        bars=np.array([[i,100,110,90,100] for i in range(30)],dtype=float)
        p={**self.p,'atr_buffer':.2}
        self.assertEqual(stop_at(bars,29,'BUY',p,self.info),86)
        self.assertEqual(stop_at(bars,29,'SELL',p,self.info),114)

    def test_partial_tp1_then_sl_counts_one_losing_trade(self):
        arm=lab.bounds(self.d)[1]
        q=np.insert(self.q,-1,[arm+180000,80,81],axis=0)
        info={**self.info,'volume_max':2}
        t=lab.replay(q,self.d,{**self.p,'exit_mode':'PARCIAL'},self.c,info)
        self.assertTrue(t['tp1_exit'])
        self.assertEqual(t['reason'],'TP1+SL')
        self.assertLess(t['net'],0)
        m=lab.metrics([t],self.c)
        self.assertEqual(m['trades'],1)
        self.assertEqual(m['wins'],0)

    def test_partial_all_targets_and_volume_constraints(self):
        q=self.q.copy();q[-2,1:]=[150,151]
        p={**self.p,'exit_mode':'PARCIAL'}
        self.assertIsNone(lab.replay(q,self.d,p,self.c,self.info))
        t=lab.replay(q,self.d,p,self.c,{**self.info,'volume_max':2})
        self.assertEqual(t['reason'],'TP1+TP2')
        self.assertGreater(t['net'],0)
        self.assertEqual(lab.metrics([t],self.c)['trades'],1)

    def test_first_break_skipped_on_spread_not_replaced(self):
        q=self.q.copy()
        arm=lab.bounds(self.d)[1]
        q[q[:,0]==arm+60000,2]=150
        self.assertIsNone(lab.replay(q,self.d,self.p,self.c,self.info))

    def test_mecha_double_break_is_not_invented(self):
        q=self.q.copy()
        arm=lab.bounds(self.d)[1]
        q[q[:,0]==arm,1:]=[101,102]
        q[q[:,0]==arm+59000,1:]=[89,90]
        self.assertIsNone(lab.replay(q,self.d,{**self.p,'confirmation':'Mecha'},self.c,self.info))

    def test_tp2_has_two_risk_units(self):
        q=self.q.copy();q[-2,1:]=[150,151]
        t=lab.replay(q,self.d,{**self.p,'exit_mode':'TP2'},self.c,self.info)
        self.assertEqual(t['reason'],'TP2')
        self.assertAlmostEqual(abs(t['tp2']-t['entry']),2*abs(t['entry']-t['sl']),delta=self.info['trade_tick_size'])

class RemoteCancellationTests(unittest.TestCase):
    def test_local_ui_ignores_remote_stop_marker(self):
        import tempfile
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'remote_stop').touch()
            with patch.object(lab,'ROOT',root),patch.dict(lab.os.environ,{'OLFX_LAB_REMOTE':'0'}):
                lab.check_remote_stop()
            with patch.object(lab,'ROOT',root),patch.dict(lab.os.environ,{'OLFX_LAB_REMOTE':'1'}):
                with self.assertRaises(KeyboardInterrupt):lab.check_remote_stop()

    def test_interrupted_training_preserves_consumed_validation(self):
        import tempfile,contextlib,io
        from unittest.mock import patch,Mock
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'experimentos').mkdir()
            ledger=root/'validaciones_consumidas.json'
            ledger.write_text('[{"start":"2000-01-01","end":"2000-02-01"}]')
            before=ledger.read_bytes();mt=Mock()
            with patch.object(lab,'ROOT',root),patch.object(lab,'config',return_value=lab.DEFAULT),patch.object(lab,'connect',return_value=(mt,'NAS100',{},'TEST')),patch.object(lab,'check_remote_stop',side_effect=KeyboardInterrupt),contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(KeyboardInterrupt):lab.experiment()
            self.assertEqual(ledger.read_bytes(),before)
            statuses=list((root/'experimentos').glob('*/estado.json'))
            self.assertEqual(lab.read(statuses[0])['status'],'INCOMPLETO')
            mt.shutdown.assert_called_once()

if __name__=='__main__':unittest.main()

