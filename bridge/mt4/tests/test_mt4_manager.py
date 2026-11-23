from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "runtime"))
import mt4_manager as mt4
import bridge_agent as agent


class MT4ManagerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.root = self.base / "bridge"
        self.install = self.base / "Broker MT4"
        self.install.mkdir()
        (self.install / "terminal.exe").write_bytes(b"fixture")
        self.data = self.base / "terminal-data"
        (self.data / "MQL4" / "Experts").mkdir(parents=True)
        (self.data / "MQL4" / "Presets").mkdir()
        (self.data / "origin.txt").write_bytes(str(self.install).encode("utf-16"))
        self.processes = [{"ExecutablePath": str(self.install / "terminal.exe"),
                           "CommandLine": "terminal.exe --PRIVATE-LOCAL-ONLY"}]
        self.discovery = mt4.discover(self.root, bases=[self.data], processes=self.processes)
        self.candidate = self.discovery["candidates"][0]["id"]
        mt4.bind(self.root, self.candidate)
        self.filename = "mrshawkdj30 (1)(1).set"
        self.path = self.data / "MQL4" / "Presets" / self.filename
        self.raw = b"; Preset\r\nLots=0.10\r\nLots,F=0\r\nStopLoss=200\r\nLicenseKey=PRIVATE-LOCAL-ONLY\r\n"
        self.path.write_bytes(self.raw)

    def tearDown(self):
        self.temp.cleanup()

    def job(self, action, **fields):
        return dict(id="mt4-test", action=action,
                    expires_at=(datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(), **fields)

    def test_discovers_mt4_and_excludes_mt5(self):
        mt5 = self.base / "MT5"
        (mt5 / "MQL5").mkdir(parents=True)
        (mt5 / "terminal64.exe").write_bytes(b"fixture")
        out = mt4.discover(self.root, bases=[self.data, mt5], processes=self.processes)
        self.assertEqual(len(out["candidates"]), 1)
        self.assertTrue(out["candidates"][0]["active_folder_verified"])
        self.assertNotIn(str(self.base), json.dumps(out))
        self.assertNotIn("PRIVATE-LOCAL-ONLY", json.dumps(out))

    def test_portable_process_does_not_select_appdata_copy(self):
        (self.install / "MQL4").mkdir()
        processes = [{"ExecutablePath": str(self.install / "terminal.exe"), "CommandLine": "terminal.exe /portable"}]
        out = mt4.discover(self.root, bases=[self.data], processes=processes)
        self.assertEqual(len(out["candidates"]), 2)
        active = [x for x in out["candidates"] if x["active_folder_verified"]]
        self.assertEqual(len(active), 1)
        mt4.bind(self.root, active[0]["id"])
        self.assertEqual(mt4.target_dir(self.root), self.install)

    def test_empty_discovery_is_explicit(self):
        out = mt4.discover(self.root, bases=[], processes=[])
        self.assertEqual(out["code"], "MT4_NOT_FOUND_ON_BRIDGE_COMPUTER")

    def test_no_arbitrary_path_command_or_trading_action(self):
        for fields in ({"path": "C:/Windows"}, {"command": "whoami"}, {"enable_trading": True}):
            with self.assertRaises(agent.BridgeError):
                agent.validate_task(self.job("mt4_discover", **fields))
        with self.assertRaises(agent.BridgeError):
            agent.validate_task(self.job("mt4_buy"))
        with self.assertRaises(agent.BridgeError):
            agent.validate_task(self.job("mt4_attach", candidate_id="../../Windows"))

    def test_bridge_checks_expiry(self):
        job = self.job("mt4_status")
        agent.validate_task(job)
        job["expires_at"] = "2020-01-01T00:00:00Z"
        with self.assertRaisesRegex(agent.BridgeError, "EXPIRED"):
            agent.validate_task(job)

    def test_traversal_junctions_and_reserved_names_blocked(self):
        for name in ("../../x.set", "C:\\x.set", "CON.set", "a.set:evil", "a.set\n", "../x.ex4"):
            with self.assertRaises(mt4.MT4Error):
                mt4.file_path(self.root, name)
        outside = self.base / "outside"
        outside.mkdir()
        link = self.data / "MQL4" / "Presets" / "link.set"
        link.symlink_to(outside / "secret.set")
        with self.assertRaises(mt4.MT4Error):
            mt4.file_path(self.root, "link.set")

    def test_preset_read_omits_credentials(self):
        out = mt4.read_preset(self.root, self.filename)
        self.assertEqual(out["inputs"]["Lots"], "0.10")
        self.assertNotIn("PRIVATE-LOCAL-ONLY", json.dumps(out))
        self.assertFalse(out["loaded_in_chart_verified"])

    def test_edit_preserves_encoding_lines_other_values_and_backup(self):
        self.path.write_bytes(self.raw.decode().encode("utf-16"))
        raw = self.path.read_bytes()
        job = self.job("mt4_edit_preset", filename=self.filename,
                       expected_sha256=hashlib.sha256(raw).hexdigest(), changes={"Lots": "0.20"})
        agent.validate_task(job)
        out = agent.execute(job, self.root, None)
        text = self.path.read_bytes().decode("utf-16")
        self.assertIn("Lots=0.20\r\nLots,F=0\r\nStopLoss=200", text)
        self.assertIn("LicenseKey=PRIVATE-LOCAL-ONLY", text)
        backup = mt4.state_dir(self.root) / "backups" / out["backup_id"] / self.filename
        self.assertEqual(backup.read_bytes(), raw)
        self.assertTrue(out["requires_reload_in_expert_inputs"])

    def test_stale_hash_and_unknown_inputs_do_not_overwrite(self):
        job = self.job("mt4_edit_preset", filename=self.filename, expected_sha256="0" * 64, changes={"Lots": 0.2})
        with self.assertRaises(mt4.MT4Error):
            mt4.execute(job, self.root, None)
        self.assertEqual(self.path.read_bytes(), self.raw)
        job.update(expected_sha256=hashlib.sha256(self.raw).hexdigest(), changes={"Nonexistent": 1})
        with self.assertRaisesRegex(mt4.MT4Error, "NOT_PRESENT"):
            mt4.execute(job, self.root, None)
        self.assertEqual(self.path.read_bytes(), self.raw)

    def test_blocks_credential_edit_and_line_injection(self):
        for changes in ({"LicenseKey": "x"}, {"Lots": "1\nPassword=abc"}, {"Lots": float("inf")}, {"Lots": True, "Account": 1}):
            job = self.job("mt4_edit_preset", filename=self.filename, expected_sha256="0" * 64, changes=changes)
            with self.assertRaises(mt4.MT4Error):
                mt4.validate_job(job)

    def test_install_requires_hash_and_immutable_commit(self):
        raw = b"compiled-user-bot"
        job = self.job("mt4_install_file", filename="Supertrend.ex4", source_path="bridge/mt4/assets/Supertrend.ex4",
                       source_ref="a" * 40, source_sha256=hashlib.sha256(raw).hexdigest(), expected_sha256=None)
        class GH:
            def get(self, path, ref):
                return raw, "unused"
        agent.validate_task(job)
        out = agent.execute(job, self.root, GH())
        self.assertEqual(out["code"], "MT4_FILE_INSTALLED")
        self.assertFalse(out["terminal_launched"])
        with self.assertRaisesRegex(agent.BridgeError, "OVERWRITE"):
            agent.execute(job, self.root, GH())
        job["source_sha256"] = "0" * 64
        with self.assertRaisesRegex(agent.BridgeError, "HASH_MISMATCH"):
            agent.execute(job, self.root, GH())
        job["source_ref"] = "main"
        with self.assertRaises(agent.BridgeError):
            agent.validate_task(job)

    def test_inventory_and_status_are_not_account_data(self):
        (self.data / "config").mkdir()
        (self.data / "config" / "accounts.dat").write_bytes(b"PRIVATE-LOCAL-ONLY")
        (self.data / "MQL4" / "Experts" / "Supertrend.ex4").write_bytes(b"bot")
        out = mt4.status(self.root)
        self.assertEqual(out["experts"][0]["filename"], "Supertrend.ex4")
        self.assertNotIn("PRIVATE-LOCAL-ONLY", json.dumps(out))
        self.assertNotIn(str(self.base), json.dumps(out))

    def test_queue_executes_once_and_uploads_result(self):
        job = self.job("mt4_read_preset", filename=self.filename)
        class GH:
            def __init__(self):
                self.sent = {}
            def json(self, path):
                if path.startswith("bridge/control/"):
                    return {"schema": 1, "device": agent.DEVICE, "enabled": True, "jobs": [job]}
                return self.sent.get(path)
            def put(self, path, value):
                self.sent[path] = value
        gh = GH()
        with patch.object(agent, "execute", wraps=agent.execute) as execute:
            agent.process_queue(self.root, gh)
            agent.process_queue(self.root, gh)
            self.assertEqual(execute.call_count, 1)
        result = next(iter(gh.sent.values()))
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(result["code"], "MT4_PRESET_READ")


if __name__ == "__main__":
    unittest.main()
