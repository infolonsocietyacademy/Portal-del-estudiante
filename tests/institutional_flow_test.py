import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('flow_sync', Path(__file__).resolve().parents[1] / 'scripts/sync-institutional-flow.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class CFTCImportTests(unittest.TestCase):
    def row(self, **changes):
        return {'cftc_contract_market_code': '088691', 'market_and_exchange_names': sync.MARKETS['GC'][1],
                'report_date_as_yyyy_mm_dd': '2026-01-06T00:00:00.000', 'open_interest_all': '100',
                'change_in_open_interest_all': '-7', **changes}

    def test_valid_signed_weekly_oi_change_is_preserved(self):
        self.assertEqual(sync.normalized([self.row()], *sync.MARKETS['GC']),
                         [{'date': '2026-01-06', 'openInterest': 100, 'changeOpenInterest': -7}])

    def test_bad_contracts_dates_counts_and_duplicate_reports_are_rejected(self):
        for change in [{'cftc_contract_market_code': '209747'}, {'market_and_exchange_names': 'MICRO GOLD'},
                       {'open_interest_all': '-10'}, {'open_interest_all': '1.5'},
                       {'report_date_as_yyyy_mm_dd': '2026-02-30'}, {'change_in_open_interest_all': ''}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                sync.normalized([self.row(**change)], *sync.MARKETS['GC'])
        with self.assertRaises(ValueError):
            sync.normalized([self.row(), self.row()], *sync.MARKETS['GC'])

    def test_pagination_is_bounded_and_preserves_latest_source_date_for_archives(self):
        rows = [{'date': '2026-01-06', 'openInterest': 100, 'changeOpenInterest': -7}] * 52
        pages = sync.documents('GC', rows, '2026-01-09T20:00:00Z')
        self.assertEqual(len(pages), 4)
        self.assertTrue(all(len(page['records']) == 13 for page in pages))
        self.assertEqual([page['nextPage'] for page in pages], [1, 2, 3, None])
        self.assertTrue(all(page['latestReportDate'] == rows[0]['date'] for page in pages))

    def test_failed_source_preserves_all_existing_snapshots(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old = root / 'GC' / '0.json'
            old.parent.mkdir()
            old.write_text('previous verified snapshot')
            with patch.object(sync, 'ROOT', root), patch.object(sync, 'fetch_market', side_effect=[[], ValueError('source down')]):
                with self.assertRaises(ValueError):
                    sync.sync()
            self.assertEqual(old.read_text(), 'previous verified snapshot')
            self.assertFalse((root / 'NQ').exists())


if __name__ == '__main__':
    unittest.main()
