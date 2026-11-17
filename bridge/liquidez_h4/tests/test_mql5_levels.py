"""Read-only integration of the MQL5 chart snapshot with Bridge status."""
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import time
import unittest
from unittest.mock import patch

RUNTIME = Path(__file__).resolve().parents[1] / "runtime"
sys.path.insert(0, str(RUNTIME))
import bridge_agent

ROWS = (
    "1,XAUUSD.a,1794902400,2020.01,1990.00,2005.005,0,0\r\n"
    "1,XAUUSD.a,1794888000,2025.00,1992.00,2008.500,1,0\r\n"
    "1,XAUUSD.a,1794873600,2010.00,1980.00,1995.000,0,1\r\n"
)


class Mql5LevelsTests(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.terminal = Path(temp.name)
        self.path = self.terminal / "MQL5" / "Files" / "OLFX_Liquidez_H4_XAUUSD.a.csv"
        self.path.parent.mkdir(parents=True)
        self.now = time.time()

    def write(self, data, age=0):
        self.path.write_bytes(data.encode("ascii"))
        os.utime(self.path, (self.now - age, self.now - age))

    def test_reads_closed_levels_in_order_and_preserves_half_tick_midpoint(self):
        self.write(ROWS)
        snapshot = bridge_agent.read_h4_levels(self.terminal, "XAUUSD.a", self.now)
        self.assertEqual(snapshot["symbol"], "XAUUSD.a")
        self.assertEqual(snapshot["source"], "MQL5")
        first, second, third = snapshot["candles"]
        self.assertEqual(first["midpoint"], 2005.005)
        self.assertFalse(first["pivot_high"])
        self.assertTrue(second["pivot_high"])
        self.assertTrue(third["pivot_low"])

    def test_missing_invalid_and_stale_files_are_ignored(self):
        self.assertIsNone(bridge_agent.read_h4_levels(self.terminal, "XAUUSD.a", self.now))
        for data, age in (
            (ROWS, 91),
            (ROWS.splitlines()[0], 0),
            (ROWS.replace("2005.005", "nan"), 0),
            (ROWS.replace("2005.005", "2008.005"), 0),
            (ROWS.replace("1794888000", "1794902400"), 0),
            (ROWS.replace("1794888000", "1794916800"), 0),
            (ROWS.replace("XAUUSD.a", "XAUUSD"), 0),
            (ROWS.replace("2005.005,0,0", "2005.005,1,0"), 0),
        ):
            with self.subTest(data=data, age=age):
                self.write(data, age)
                self.assertIsNone(bridge_agent.read_h4_levels(self.terminal, "XAUUSD.a", self.now))

    def test_active_bot_status_exposes_only_recent_chart_levels(self):
        self.write(ROWS)
        status = {"symbol": "XAUUSD.a", "snapshot_fresh": True, "nonce": "local"}
        with patch.object(bridge_agent, "owned_terminal", return_value=self.terminal), \
             patch.object(bridge_agent, "collect_diagnostics", return_value={}), \
             patch("gold_backtest.status", return_value=None), patch("gold_scalp.status", return_value=status):
            snapshot = bridge_agent.status_snapshot(self.terminal, "online")
            self.assertEqual(snapshot["gold_strategy"]["h4_levels"]["source"], "MQL5")
            self.assertNotIn("nonce", snapshot["gold_strategy"])
            status["snapshot_fresh"] = False
            snapshot = bridge_agent.status_snapshot(self.terminal, "online")
            self.assertNotIn("h4_levels", snapshot["gold_strategy"])
