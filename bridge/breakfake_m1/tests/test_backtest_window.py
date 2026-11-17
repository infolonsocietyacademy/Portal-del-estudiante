import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
from gold_backtest_worker import backtest_window, ReadOnlyMarket
import gold_backtest
import bridge_agent


class BacktestWindow(unittest.TestCase):
    def test_fourteen_days_uses_only_completed_minutes(self):
        start,end=backtest_window(14,1794894679)
        self.assertEqual(end%60,0)
        self.assertEqual(end-start,14*86400)
        self.assertLessEqual(end,1794894679)

    def test_invalid_window_is_rejected(self):
        for days in (0,13,15,365,14.0,'14',True):
            with self.assertRaisesRegex(RuntimeError,'INVALID_BACKTEST_DAYS'):
                backtest_window(days)

    def test_fourteen_day_action_needs_no_arbitrary_task_fields(self):
        job={'id':'bt14-test','action':'gold_backtest_14d','expires_at':'2099-01-01T00:00:00Z'}
        self.assertEqual(bridge_agent.validate_task(job),job)
        with self.assertRaises(bridge_agent.BridgeError):
            bridge_agent.validate_task({**job,'days':30})

    def test_launcher_passes_fourteen_days_to_isolated_child(self):
        with TemporaryDirectory() as temp:
            with patch('gold_scalp.worker_locked',return_value=False), \
                 patch.object(gold_backtest.subprocess,'run',return_value=SimpleNamespace(returncode=0)), \
                 patch.object(gold_backtest.subprocess,'Popen') as launch:
                result=gold_backtest.start({'id':'bt14-test'},Path(temp),bridge_agent,days=14)
            self.assertEqual(result['days'],14)
            self.assertEqual(result['code'],'BACKTEST_14D_STARTED')
            self.assertEqual(launch.call_args.args[0][-2:],['--days','14'])

    def test_backtest_market_wrapper_cannot_send_real_orders(self):
        with self.assertRaisesRegex(RuntimeError,'BACKTEST_READ_ONLY_API'):
            ReadOnlyMarket(SimpleNamespace()).order_send


if __name__=='__main__':
    unittest.main()
