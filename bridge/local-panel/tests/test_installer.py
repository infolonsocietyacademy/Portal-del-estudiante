"""Installer state checks; no Windows process or broker access."""
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from install_panel import active_requests,launcher
class InstallerTest(unittest.TestCase):
    def test_active_position_blocks_update(self):
        with TemporaryDirectory() as folder:
            path=Path(folder)/"one.json"
            path.write_text(json.dumps({"id":"one","phase":"open","job":{"action":"trade"}}))
            self.assertEqual(active_requests(folder),["one"])
    def test_waiting_strategy_blocks_update_instead_of_cancelling(self):
        with TemporaryDirectory() as folder:
            (Path(folder)/"one.json").write_text(json.dumps({"id":"one","phase":"waiting","job":{"action":"trade"}}))
            self.assertEqual(active_requests(folder),["one"])
    def test_corrupt_state_fails_closed(self):
        with TemporaryDirectory() as folder:
            (Path(folder)/"bad.json").write_text("{")
            self.assertTrue(active_requests(folder))
    def test_finished_state_allows_update(self):
        with TemporaryDirectory() as folder:
            (Path(folder)/"one.json").write_text(json.dumps({"id":"one","phase":"done","job":{"action":"trade"}}))
            self.assertEqual(active_requests(folder),[])
    def test_launcher_uses_new_runtime_only(self):
        value=launcher("run","DEMO")
        self.assertIn("2.0.1-rc1",value)
        self.assertNotIn("taskkill",value.lower())
        self.assertNotIn("mt5-test",value.lower())
if __name__=="__main__":
    unittest.main()
