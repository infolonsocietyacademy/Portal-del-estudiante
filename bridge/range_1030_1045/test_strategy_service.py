import json
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import patch
import bridge_agent as api
import strategy_service as service
import gold_scalp
from gold_settings import save_gold_settings, load_gold_settings
from test_range_1030 import RangeTests


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.folder = self.root / 'gold-scalp-m1'
        self.folder.mkdir()
        self.config = dict(schema=1, symbol='USTECH', size_mode='percent', fixed_lots=.05,
                           risk_percent=.5, max_risk_cash=50., max_spread_price=5., max_stop_price=119.23)
        save_gold_settings(self.root, self.config)
    def tearDown(self): self.tmp.cleanup()
    def job(self, lots=.6):
        return dict(id='fixed-lots-test', action='range_configure', fixed_lots=lots,
                    expires_at='2099-01-01T00:00:00Z')
    def test_validation_rejects_invalid_values_and_extra_fields(self):
        self.assertEqual(api.validate_task(self.job())['fixed_lots'], .6)
        for value in (True, '0.60', 0, -1, 1.1, float('nan'), float('inf')):
            with self.assertRaises(api.BridgeError): api.validate_task(self.job(value))
        with self.assertRaises(api.BridgeError): api.validate_task(dict(self.job(), symbol='XAUUSD'))
    def test_unrequested_service_never_starts(self):
        with patch('gold_scalp.start') as start:
            service.supervise(self.root, api)
            start.assert_not_called()
    def test_explicit_pause_disables_recovery(self):
        service.set_enabled(self.root, True)
        gold_scalp.stop(self.root)
        self.assertFalse(service.enabled(self.root))
        with patch('gold_scalp.start') as start:
            service.supervise(self.root, api)
            start.assert_not_called()
    def test_recovery_of_dead_worker_preserves_daily_state(self):
        service.set_enabled(self.root, True)
        daily = self.folder/'ny-range-1030-v1-test.json'
        daily.write_text('{"consumed": true}')
        with patch('gold_scalp.worker_locked', return_value=False), patch('gold_scalp.start', return_value={'snapshot_fresh':True}) as start:
            service.supervise(self.root, api)
            start.assert_called_once()
        self.assertEqual(daily.read_text(), '{"consumed": true}')
        self.assertEqual(json.loads((self.folder/'service-health.json').read_text())['code'], 'WORKER_RECOVERED')
    def test_stalled_locked_worker_is_never_duplicated_or_killed(self):
        service.set_enabled(self.root, True)
        with patch('gold_scalp.worker_locked', return_value=True), patch('gold_scalp.start') as start:
            service.supervise(self.root, api)
            start.assert_not_called()
        self.assertEqual(json.loads((self.folder/'service-health.json').read_text())['code'], 'WORKER_UNRESPONSIVE_NO_DUPLICATE')
    def test_root_stop_prevents_recovery(self):
        service.set_enabled(self.root, True)
        (self.root/'STOP').touch()
        with patch('gold_scalp.start') as start:
            service.supervise(self.root, api)
            start.assert_not_called()
    def test_stale_health_cannot_claim_ready_or_fresh_quote(self):
        (self.folder/'health.json').write_text(json.dumps(dict(updated_at=time.time()-1000, ready=True, quote_fresh=True, code='RANGE_WAIT_1030_NY')))
        value = gold_scalp.status(self.root)
        self.assertFalse(value['ready'])
        self.assertFalse(value['quote_fresh'])
        self.assertEqual(value['code'], 'STRATEGY_HEALTH_STALE')
    def test_fixed_configure_keeps_risk_and_requires_flat_broker(self):
        broker = NS(shutdown=lambda:None, symbol_info=lambda symbol:NS(volume_min=.01,volume_max=100.,volume_step=.01),
                    positions_get=lambda **kw:(), orders_get=lambda **kw:())
        engine = NS(states={})
        def started(job, root, api):
            service.set_enabled(root, True)
            return dict(snapshot_fresh=True, size_mode='fixed', fixed_lots=.6, account_type_verified='demo')
        with patch.dict('sys.modules', {'MetaTrader5':broker}), patch('gold_scalp_runner.connect', return_value=engine), patch('gold_scalp.worker_locked', return_value=False), patch('gold_scalp.start', side_effect=started):
            result = service.configure(self.job(), self.root, api)
        self.assertEqual(result['code'], 'RANGE_FIXED_LOTS_ACTIVATED')
        value = load_gold_settings(self.root)
        self.assertEqual(value, dict(self.config, size_mode='fixed', fixed_lots=.6))
        self.assertTrue(service.enabled(self.root))
    def test_configure_refuses_open_position_without_changing_size(self):
        broker = NS(shutdown=lambda:None, symbol_info=lambda symbol:NS(volume_min=.01,volume_max=100.,volume_step=.01),
                    positions_get=lambda **kw:(NS(),), orders_get=lambda **kw:())
        with patch.dict('sys.modules', {'MetaTrader5':broker}), patch('gold_scalp_runner.connect', return_value=NS(states={})), patch('gold_scalp.worker_locked', return_value=False), patch('gold_scalp.start') as start:
            with self.assertRaisesRegex(api.BridgeError, 'WAIT_FLAT'):
                service.configure(self.job(), self.root, api)
            start.assert_not_called()
        self.assertEqual(load_gold_settings(self.root), self.config)


class FixedLotIntegrationTests(RangeTests):
    def test_fixed_lots_submits_exactly_point_six(self):
        self.e.config.update(size_mode='fixed', fixed_lots=.6)
        self.arm()
        self.assertEqual(self.poll(self.start+902,110.1), 'RANGE_BUY_ACCEPTED')
        self.assertEqual(self.b.sent[0]['volume'], .6)
    def test_fixed_lots_keeps_cash_cap_and_never_sends_over_budget(self):
        self.e.config.update(size_mode='fixed', fixed_lots=.6, max_risk_cash=5.)
        self.arm()
        self.assertIn('RISK_BUDGET_EXCEEDED', self.poll(self.start+902,110.1))
        self.assertEqual(self.b.sent, [])


if __name__ == '__main__': unittest.main()
