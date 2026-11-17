import base64
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import patch
import zipfile

BASE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(BASE/'runtime'))
from gold_scalp_core import validate,Fault
from gold_scalp_core_m5_backtest import Engine as PaperEngine,Fault as PaperFault
from gold_replay_m5 import ReplayBroker,Replay
from broker_fixture import FakeMT5
import bridge_agent
import gold_backtest

T=1794900000//14400*14400
def bar(t,o=2000.,h=2001.,l=1999.,c=2000.):
    return dict(time=t,open=o,high=h,low=l,close=c)

class M5BacktestOnly(unittest.TestCase):
    def test_all_live_execution_files_remain_identical_to_signed_m1(self):
        doc=json.loads((BASE/'release_1.0.21.json').read_bytes())
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(doc['payload']['archive']))) as z:
            for name in ('gold_scalp_core.py','liquidez_h4.py','gold_scalp_runner.py',
                         'gold_scalp.py','market_feed.py','gold_settings.py'):
                self.assertEqual(z.read(name),(BASE/'runtime'/name).read_bytes(),name)

    def test_live_engine_still_rejects_m5_liquidity_orders(self):
        job=dict(id='m5-live-blocked',action='trade',expires_at='2099-01-01T00:00:00Z',
                 symbol='XAUUSD',direction='liquidez_h4',timeframe='M5',signal_bar=T,
                 lh4_key='a'*24,hold_seconds=0,rr=1.)
        with self.assertRaisesRegex(Fault,'LIQH4_CLOSED_M1_REQUIRED'):
            validate(job,'XAUUSD')

    def test_paper_engine_refuses_non_simulated_broker(self):
        with self.assertRaisesRegex(PaperFault,'BACKTEST_SIMULATED_BROKER_REQUIRED'):
            PaperEngine(SimpleNamespace(),'unused',{},'unused',{})

    def test_m5_closes_before_entry_and_exits_at_one_r(self):
        with TemporaryDirectory() as temp:
            info=FakeMT5(lambda:T,Path(temp)).info;info.trade_contract_size=100.
            rows=[bar(T+i*60) for i in range(-400,11)]
            m5=[bar(T+i*300) for i in range(-70,1)]+[bar(T+300,1999.,2001.,1997.,2000.)]
            h4=[bar(T-i*14400,h=2002.,l=1998.) for i in range(8,0,-1)]
            b=ReplayBroker(rows,info,temp,native_h4=h4,native_m5=m5)
            config=dict(symbol='XAUUSD',size_mode='fixed',fixed_lots=.05,risk_percent=.5,
                        max_spread_price=.18,max_stop_price=10.)
            replay=Replay(b,config,Path(temp)/'replay')
            replay.tick(T+300,2000.,2000.16)
            replay.tick(T+540,2000.,2000.16)
            self.assertFalse(b.sent)
            replay.tick(T+600,2000.,2000.16)
            self.assertEqual(len(b.sent),1)
            order=b.sent[0]
            self.assertAlmostEqual(order['tp']-order['price'],order['price']-order['sl'])
            replay.tick(T+601,order['tp'],order['tp']+.16)
            self.assertEqual(replay.metrics()['wins'],1)

    def test_launcher_pins_same_window_as_previous_m1_comparison(self):
        with TemporaryDirectory() as temp:
            root=Path(temp);folder=root/'backtests'/'baseline';folder.mkdir(parents=True)
            (folder.parent/'current.json').write_text(json.dumps({'job_id':'baseline'}))
            (folder/'progress.json').write_text(json.dumps(dict(phase='COMPLETE',updated_at=0,
                result=dict(strategy='LIQUIDEZ_H4_M1_TP1',days_requested=14,end_utc='2026-11-17T06:53:00+00:00'))))
            with patch('gold_scalp.worker_locked',return_value=False), \
                 patch.object(gold_backtest.subprocess,'run',return_value=SimpleNamespace(returncode=0)), \
                 patch.object(gold_backtest.subprocess,'Popen') as launch:
                result=gold_backtest.start({'id':'m5-backtest-only'},root,bridge_agent,days=14,period='M5')
            args=launch.call_args.args[0]
            self.assertIn('--end-utc',args)
            self.assertEqual(args[args.index('--period')+1],'M5')
            self.assertEqual(result['period'],'M5')
            self.assertEqual(result['days'],14)

if __name__=='__main__':unittest.main()
