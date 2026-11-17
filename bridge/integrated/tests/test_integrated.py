"""Integration boundaries and health diagnostics; no real trading."""
import importlib.util
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch
BASE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(BASE))
sys.path.insert(0,str(BASE/"runtime"))
import install_integrated as installer
from execution_terminal import execution_terminal
from process_tools import locked
spec=importlib.util.spec_from_file_location("integrated_controller",BASE/"runtime"/"bridge_agent.py")
controller=importlib.util.module_from_spec(spec);spec.loader.exec_module(controller)
from test_resident import EngineTest

class HealthTest(unittest.TestCase):
    setUp=EngineTest.setUp
    make=EngineTest.make
    def test_quote_age_is_reported_without_trade(self):
        self.m.symbol_info_tick=lambda _:NS(time=self.now()-7200,bid=2000.,ask=2000.2)
        d=self.engine.diagnostics()
        self.assertEqual(d["code"],"QUOTE_STALE")
        self.assertEqual(d["quote_age_seconds"],7200)
        self.assertFalse(d["trade_ready"])
        self.assertFalse(self.m.sent)
    def test_future_quote_is_not_treated_as_fresh(self):
        self.m.symbol_info_tick=lambda _:NS(time=self.now()+7200,bid=2000.,ask=2000.2)
        self.assertFalse(self.engine.diagnostics()["trade_ready"])
    def test_account_permission_is_part_of_ready(self):
        self.m.account.trade_expert=False
        self.assertFalse(self.engine.diagnostics()["trade_ready"])
    def test_fresh_quote_and_permissions_are_ready(self):
        self.assertTrue(self.engine.diagnostics()["trade_ready"])

class InstallerTest(unittest.TestCase):
    def test_expired_wait_does_not_block_migration(self):
        with TemporaryDirectory() as folder:
            Path(folder,"one.json").write_text(json.dumps({"id":"one","phase":"waiting","job":{"action":"trade","expires_at":"2020-01-01T00:00:00Z"}}))
            self.assertEqual(installer.pending_requests(folder,now=1800000000),[])
    def test_open_position_always_blocks_migration(self):
        with TemporaryDirectory() as folder:
            Path(folder,"one.json").write_text(json.dumps({"id":"one","phase":"open","job":{"action":"trade","expires_at":"2020-01-01T00:00:00Z"}}))
            self.assertEqual(installer.pending_requests(folder),["one"])
    def test_terminal_copy_keeps_accounts_local_and_omits_profiles(self):
        with TemporaryDirectory() as folder:
            root=Path(folder);source=root/"mt5-test";target=root/"mt5-execution"
            source.mkdir();(source/".olfx-owned").write_text("owned")
            (source/"terminal64.exe").write_bytes(b"executable fixture")
            (source/"config").mkdir();(source/"config"/"accounts.dat").write_bytes(b"private local fixture")
            (source/"MQL5"/"Profiles").mkdir(parents=True)
            (source/"MQL5"/"Profiles"/"old-ea.chr").write_text("do not start")
            with patch("shutil.disk_usage",return_value=NS(free=10*1024**3)):
                installer.clone_demo_terminal(source,target,"owned")
            self.assertEqual((target/"config"/"accounts.dat").read_bytes(),b"private local fixture")
            self.assertFalse((target/"MQL5"/"Profiles").exists())
            self.assertTrue((source/"terminal64.exe").exists())
    def test_unowned_terminal_is_never_copied(self):
        with TemporaryDirectory() as folder:
            source=Path(folder)/"mt5-test";source.mkdir()
            with self.assertRaises(RuntimeError):
                installer.clone_demo_terminal(source,Path(folder)/"other","owned")
    def test_existing_unowned_execution_directory_is_not_overwritten(self):
        with TemporaryDirectory() as folder:
            source=Path(folder)/"mt5-test";source.mkdir();(source/".olfx-owned").write_text("owned")
            target=Path(folder)/"mt5-execution";target.mkdir()
            with self.assertRaises(RuntimeError):installer.clone_demo_terminal(source,target,"owned")
    def test_execution_path_requires_ownership(self):
        with TemporaryDirectory() as folder:
            root=Path(folder);(root/"settings.json").write_text('{"installation_id":"owned"}')
            with self.assertRaises(RuntimeError):execution_terminal(root)
    def test_execution_path_is_distinct_from_tester(self):
        with TemporaryDirectory() as folder:
            root=Path(folder);(root/"settings.json").write_text('{"installation_id":"owned"}')
            target=root/"mt5-execution";target.mkdir()
            (target/".olfx-owned").write_text("owned");(target/"terminal64.exe").write_text("fixture")
            self.assertEqual(execution_terminal(root),target.resolve())
            self.assertNotEqual(execution_terminal(root),root/"mt5-test")

class SupervisorTest(unittest.TestCase):
    def test_active_resident_blocks_update_handoff(self):
        with TemporaryDirectory() as folder:
            root=Path(folder);state=root/"resident-v2"/"state";state.mkdir(parents=True)
            (state/"one.json").write_text('{"phase":"open","job":{"action":"trade"}}')
            self.assertFalse(controller.idle(root))
    def test_active_backtest_blocks_update_handoff(self):
        with TemporaryDirectory() as folder:
            root=Path(folder);(root/"state").mkdir()
            (root/"state"/"one.json").write_text('{"status":"running"}')
            self.assertFalse(controller.idle(root))
    def test_empty_system_is_idle(self):
        with TemporaryDirectory() as folder:self.assertTrue(controller.idle(folder))
    def test_restart_backoff_is_bounded(self):
        r=controller.Restart()
        for _ in range(20):r.failed(10)
        self.assertLessEqual(r.next_at-10,60)
        self.assertFalse(r.due(10))
