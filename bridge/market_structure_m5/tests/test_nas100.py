from copy import deepcopy
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace as NS
import unittest
from test_structure_retest import Broker
from asset_spec import asset_kind, metadata_matches
from gold_settings import DEFAULTS, validate_gold_settings
from nas100_switch import candidates, switch_settings
from market_structure_m5 import SignalState
from bridge_agent import validate_task, BridgeError

class NasBroker(Broker):
    def setUp(self):
        super().setUp()
        self.config.update(symbol='USTech',size_mode='percent',max_risk_cash=50.)
        self.mt5.account.currency='USD'
        self.mt5.info.currency_base='USD'
        self.mt5.info.description='US Tech 100 Cash CFD'
        self.job['symbol']='USTech'

    # Inherited tests assert fixed 0.05 lots; risk sizing deliberately differs.
    def test_bid_ask_stop_and_tp_one_r_both_sides(self):
        self.accept()
        self.assertEqual(len(self.mt5.sent),1)
        r=self.mt5.sent[0]
        loss=abs(self.mt5.order_calc_profit(r['type'],r['symbol'],r['volume'],r['price'],r['sl']))
        self.assertLessEqual(loss,min(50.,self.mt5.account.equity*.005))
        self.assertAlmostEqual(abs(r['price']-r['sl']),abs(r['tp']-r['price']),places=6)

    def test_cash_ceiling_applies_to_fixed_overrides(self):
        self.job['lots']=.5
        self.accept()
        self.assertEqual(self.mt5.sent,[])

    def test_minimum_lot_never_exceeds_budget(self):
        self.mt5.info.volume_min=1.
        self.mt5.info.volume_step=1.
        self.accept()
        self.assertEqual(self.mt5.sent,[])

    def test_wrong_contract_and_non_usd_account_block(self):
        self.mt5.info.description='S&P 500'
        self.accept();self.assertEqual(self.mt5.sent,[])
        self.e.states={};self.job['id']='different-contract'
        self.mt5.info.description='Nasdaq 100';self.mt5.account.currency='EUR'
        self.accept();self.assertEqual(self.mt5.sent,[])

class Discovery(unittest.TestCase):
    def test_aliases_and_contract_evidence(self):
        for name in ('NAS100','NAS100.cash','USTec','USTech','US100','USTECH100'):
            self.assertEqual(asset_kind(name),'nas100')
            self.assertTrue(metadata_matches(name,NS(currency_profit='USD',description='Nasdaq 100 Cash')))
        for name in ('SP500','US30','NAS100;exit','../../NAS100','EURUSD'):
            self.assertIsNone(asset_kind(name))
        self.assertFalse(metadata_matches('NAS100',NS(currency_profit='EUR',description='Nasdaq 100')))
        self.assertFalse(metadata_matches('NAS100',NS(currency_profit='USD',description='Dow Jones 30')))

    def test_discovery_uses_exact_broker_symbol_without_orders(self):
        infos=[NS(name='USTech',currency_profit='USD',description='US Tech 100 Cash'),NS(name='US30',currency_profit='USD',description='Dow Jones')]
        self.assertEqual([x.name for x in candidates(NS(symbols_get=lambda:infos))],['USTech'])

    def test_gold_settings_backwards_compatible_and_nas_requires_cash_limit(self):
        self.assertEqual(validate_gold_settings(DEFAULTS),DEFAULTS)
        with self.assertRaises(ValueError):validate_gold_settings(dict(DEFAULTS,symbol='NAS100'))
        info=NS(name='USTech',currency_profit='USD',description='US Tech 100',volume_min=.1,volume_max=100.,volume_step=.1)
        config=switch_settings(DEFAULTS,info,{'atr_m5':20.},25.)
        self.assertEqual(config['max_stop_price'],80.)
        self.assertEqual(config['max_risk_cash'],25.)
        self.assertEqual(config['size_mode'],'percent')
        with self.assertRaises(ValueError):switch_settings(DEFAULTS,info,{'atr_m5':None},25.)

    def test_activation_rejects_arbitrary_symbols_fields_and_expired_jobs(self):
        j=dict(id='switch-test',action='nas100_activate',symbol='USTech',expires_at=(datetime.now(timezone.utc)+timedelta(minutes=5)).isoformat())
        self.assertEqual(validate_task(j),j)
        for edit in (dict(symbol='XAUUSD'),dict(lots=1),dict(symbol='SP500'),dict(expires_at='2000-01-01T00:00:00Z')):
            with self.assertRaises(BridgeError):validate_task(dict(j,**edit))

    def test_signal_state_cannot_cross_symbols(self):
        d=SignalState('XAUUSD').dump()
        with self.assertRaises(ValueError):SignalState('USTech',state=d)
        self.assertEqual(SignalState('USTech').symbol,'USTech')

if __name__=='__main__':unittest.main()
