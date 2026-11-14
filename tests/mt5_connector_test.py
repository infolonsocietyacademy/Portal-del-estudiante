import ast
import contextlib
from datetime import datetime, timedelta, timezone
import io
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import unittest


SOURCE = Path(__file__).resolve().parents[1] / 'olfx-connector/olfx_agent.py'


def connector():
    wanted = {'_stamp', '_axi_offset', 'source_clock', 'deals_payload', 'sync_account'}
    parsed = ast.parse(SOURCE.read_text())
    module = ast.Module(body=[n for n in parsed.body if isinstance(n, ast.FunctionDef) and n.name in wanted], type_ignores=[])
    context = {'datetime': datetime, 'timedelta': timedelta, 'timezone': timezone,
               'MAX_DEALS_PER_BATCH': 150,'hashlib':hashlib,'json':json}
    exec(compile(module, str(SOURCE), 'exec'), context)
    return context


def epoch(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def deal(ticket=1, when='2026-11-11T07:24:43.712Z', **changes):
    return {'ticket': ticket, 'time': int(epoch(when)), 'time_msc': round(epoch(when) * 1000),
            'type': 0, 'entry': 1, 'profit': 1.25, 'commission': -.10, 'swap': -.05,
            'fee': -.01, 'volume': .1, 'symbol': 'XAUUSD', **changes}


REFERENCES = [
    {'deal_id': '1', 'occurred_at': '2026-11-11T05:24:43.712Z', 'broker_time': '2026-11-11 07:24:43.712'},
    {'deal_id': '2', 'occurred_at': '2026-07-01T12:00:00Z', 'broker_time': '2026-07-01 15:00:00'},
]


class MT5ConnectorTests(unittest.TestCase):
    def setUp(self):
        self.api = connector()

    def test_server_clock_and_utc_sdk_bases_produce_the_same_original_mt5_dates(self):
        for values in [
            [deal(), deal(2, '2026-07-01T15:00:00Z')],
            [deal(when='2026-11-11T05:24:43.712Z'), deal(2, '2026-07-01T12:00:00Z')],
        ]:
            with self.subTest(values=values):
                result = self.api['deals_payload'](values, REFERENCES, 'Axi-US51-Live')
                by_id = {d['deal_id']: d for d in result}
                self.assertEqual(by_id['1']['broker_time'], '2026-11-11T07:24:43.712')
                self.assertEqual(by_id['1']['occurred_at'], '2026-11-11T05:24:43.712000+00:00')
                self.assertEqual(by_id['2']['broker_time'], '2026-07-01T15:00:00.000')
                self.assertEqual(by_id['1']['profit'], 1.25)
                self.assertEqual(by_id['1']['commission'], -.10)

    def test_conflicting_clocks_and_conflicting_duplicate_tickets_are_rejected(self):
        with self.assertRaises(RuntimeError):
            self.api['deals_payload']([deal(), deal(2, '2026-07-01T12:00:00Z')], REFERENCES, 'Axi-US51-Live')
        with self.assertRaises(RuntimeError):
            self.api['deals_payload']([deal(), deal(profit=2)])

    def test_identical_duplicates_are_removed_and_large_tickets_stay_exact(self):
        values = [deal(9007199254740994), deal(9007199254740993), deal(9007199254740994)]
        result = self.api['deals_payload'](values)
        self.assertEqual([d['deal_id'] for d in result], ['9007199254740993', '9007199254740994'])

    def run_sync(self, item=None, connected=True, history=None):
        sent, windows = [], []
        account = SimpleNamespace(login=12345678, server='Test-Server', balance=100, equity=105, currency='USD')
        mt5 = SimpleNamespace(initialize=lambda *a, **kw: True, shutdown=lambda: None,
                              terminal_info=lambda: SimpleNamespace(connected=connected), account_info=lambda: account)
        def get_history(start, end):
            windows.append((start, end))
            return history if history is not None else [deal()]
        mt5.history_deals_get = get_history
        self.api['decrypt'] = lambda _: {'login': '12345678', 'brokerServer': 'Test-Server', 'investorPassword': 'test-only'}
        self.api['api'] = lambda action, payload, token: sent.append(payload) or {'synced': len(payload['deals'])}
        entry = {'id': 'test-account', 'broker_server': 'Test-Server', 'encrypted_payload': {}, **(item or {})}
        with contextlib.redirect_stdout(io.StringIO()):
            self.api['sync_account'](mt5, entry, {'mt5_path': 'test-terminal', 'agent_token': 'test-token'})
        return sent, windows

    def test_offline_terminal_never_publishes_cached_balance(self):
        with self.assertRaisesRegex(RuntimeError, 'no está conectado'):
            self.run_sync(connected=False)

    def test_first_v2_sync_reads_all_history_and_finishes_only_after_the_last_batch(self):
        sent, windows = self.run_sync(history=[deal(i + 1) for i in range(301)])
        self.assertEqual(windows[0][0], datetime(1970, 1, 1, tzinfo=timezone.utc))
        self.assertGreater(windows[0][1], datetime.now(timezone.utc) + timedelta(hours=23))
        self.assertEqual([len(p['deals']) for p in sent], [150, 150, 1])
        self.assertEqual([p['finished'] for p in sent], [False, False, True])
        self.assertTrue(all(p['sourceVersion'] == 2 and p['expectedTotal'] == 301 for p in sent))

    def test_incremental_window_starts_at_last_success_even_after_a_long_outage(self):
        sent, windows = self.run_sync(item={'source_version': 2, 'last_success_at': '2026-10-01T12:00:00Z'})
        self.assertEqual(windows[0][0], datetime(2026, 9, 24, 12, tzinfo=timezone.utc))
        self.assertIsNone(sent[0]['expectedTotal'])


if __name__ == '__main__':
    unittest.main()
