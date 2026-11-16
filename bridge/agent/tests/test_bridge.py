import copy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bridge_agent as b


def task(action="ping", jid="test-1"):
    job = {"id": jid, "action": action, "expires_at": "2099-01-01T00:00:00Z"}
    if action in ("compile", "backtest"):
        job.update(source_path="bridge/eas/Probe.mq5", source_ref="a" * 40, source_sha256="b" * 64)
    if action == "backtest":
        job["test"] = {"symbol": "XAUUSD", "period": "M5", "from": "2025.01.01", "to": "2026.01.01", "inputs": {"RiskPercent": 1, "RR": 2}}
    return job


class Mailbox:
    def __init__(self, jobs):
        self.files = {"bridge/control/nolo-vps.json": {"schema": 1, "device": "nolo-vps", "enabled": True, "jobs": jobs}}
        self.fail = False

    def json(self, path):
        return copy.deepcopy(self.files.get(path))

    def put(self, path, value):
        if self.fail:
            raise b.BridgeError("GITHUB_NETWORK_ERROR")
        self.files[path] = copy.deepcopy(value)


class ValidationTests(unittest.TestCase):
    def test_valid_backtest(self):
        self.assertEqual(b.validate_task(task("backtest"))["test"]["period"], "M5")

    def test_no_arbitrary_commands(self):
        for val in ("shell", "powershell", "order_send", "install", "restart"):
            with self.subTest(val=val), self.assertRaises(b.BridgeError):
                b.validate_task(task(val))
        t = task()
        t["command"] = "echo secret"
        with self.assertRaises(b.BridgeError):
            b.validate_task(t)

    def test_source_and_id_cannot_escape(self):
        for field, val in (("id", "../x"), ("source_path", "bridge/eas/../../x.mq5"), ("source_path", "https://bad.invalid/x.mq5"), ("source_ref", "main")):
            j = task("compile")
            j[field] = val
            with self.subTest(field=field, value=val), self.assertRaises(b.BridgeError):
                b.validate_task(j)

    def test_ini_and_set_injection(self):
        for key, val in (("symbol", "XAUUSD\n[StartUp]\nExpert=live"), ("currency", "USD\nLogin=123"), ("inputs", {"Risk": "1\nAllowLiveTrading=1"}), ("inputs", {"Risk": "1||0||1||10||Y"}), ("model", True), ("timeout_seconds", 99999)):
            j = task("backtest")
            j["test"][key] = val
            with self.subTest(key=key, value=val), self.assertRaises(b.BridgeError):
                b.validate_task(j)

    def test_expiry_requires_timezone(self):
        for expiry in ("2020-01-01T00:00:00Z", "2099-01-01", None):
            j = task()
            j["expires_at"] = expiry
            with self.subTest(expiry=expiry), self.assertRaises(b.BridgeError):
                b.validate_task(j)

    def test_config_uses_only_tester(self):
        ini = b.tester_ini(task("backtest"))
        self.assertIn("AllowLiveTrading=0", ini)
        self.assertIn("UseCloud=0", ini)
        self.assertIn("Optimization=0", ini)
        self.assertIn("Expert=OLFX\\OLFX_test-1.ex5", ini)
        self.assertNotIn("[StartUp]", ini)
        self.assertNotIn("Password", ini)


class QueueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_roundtrip_ping(self):
        box = Mailbox([task()])
        b.process_queue(self.root, box)
        result = box.files["bridge/results/nolo-vps/test-1.json"]
        self.assertEqual(result["code"], "PONG")
        self.assertEqual(result["status"], "succeeded")

    def test_repeated_poll_executes_once(self):
        box = Mailbox([task()])
        with patch.object(b, "execute", return_value={"code": "PONG"}) as run:
            b.process_queue(self.root, box)
            b.process_queue(self.root, box)
            self.assertEqual(run.call_count, 1)

    def test_upload_outage_does_not_rerun(self):
        box = Mailbox([task()])
        box.fail = True
        with patch.object(b, "execute", return_value={"code": "PONG"}) as run:
            with self.assertRaises(b.BridgeError):
                b.process_queue(self.root, box)
            self.assertTrue((self.root / "outbox/test-1.json").exists())
            box.fail = False
            b.process_queue(self.root, box)
            self.assertEqual(run.call_count, 1)
            self.assertFalse((self.root / "outbox/test-1.json").exists())

    def test_crash_running_requires_new_id(self):
        job = task()
        b.atomic_json(self.root / "state/test-1.json", {"status": "running", "task_sha256": b.digest(job)})
        box = Mailbox([job])
        with patch.object(b, "execute") as run:
            b.process_queue(self.root, box)
            run.assert_not_called()
        self.assertEqual(box.files["bridge/results/nolo-vps/test-1.json"]["code"], "INTERRUPTED_MANUAL_NEW_TASK_REQUIRED")

    def test_crash_after_outbox_write_retains_finished_result(self):
        job = task()
        b.atomic_json(self.root / "state/test-1.json", {"status": "running", "task_sha256": b.digest(job)})
        result = {"id": job["id"], "status": "succeeded", "code": "PONG", "task_sha256": b.digest(job)}
        b.atomic_json(self.root / "outbox/test-1.json", result)
        box = Mailbox([job])
        with patch.object(b, "execute") as run:
            b.process_queue(self.root, box)
            run.assert_not_called()
        self.assertEqual(box.files["bridge/results/nolo-vps/test-1.json"]["code"], "PONG")

    def test_existing_remote_result_not_repeated_after_reinstall(self):
        job = task()
        box = Mailbox([job])
        box.files["bridge/results/nolo-vps/test-1.json"] = {"id": job["id"], "status": "succeeded", "task_sha256": b.digest(job), "code": "PONG"}
        with patch.object(b, "execute") as run:
            b.process_queue(self.root, box)
            run.assert_not_called()

    def test_id_cannot_be_reused_for_different_action(self):
        box = Mailbox([task()])
        b.process_queue(self.root, box)
        box.files["bridge/control/nolo-vps.json"]["jobs"][0]["action"] = "diagnose"
        with self.assertRaisesRegex(b.BridgeError, "TASK_ID_REUSED"):
            b.process_queue(self.root, box)

    def test_expired_task_is_reported_not_executed(self):
        job = task()
        job["expires_at"] = "2020-01-01T00:00:00Z"
        box = Mailbox([job])
        with patch.object(b, "execute") as run:
            b.process_queue(self.root, box)
            run.assert_not_called()
        self.assertEqual(box.files["bridge/results/nolo-vps/test-1.json"]["code"], "TASK_EXPIRED")

    def test_disabled_or_stop_prevents_execution(self):
        for stop in (True, False):
            box = Mailbox([task()])
            if stop:
                (self.root / "STOP").touch()
            else:
                box.files["bridge/control/nolo-vps.json"]["enabled"] = False
            with patch.object(b, "execute") as run:
                b.process_queue(self.root, box)
                run.assert_not_called()
            (self.root / "STOP").unlink(missing_ok=True)

    def test_errors_do_not_leak_messages(self):
        box = Mailbox([task()])
        with patch.object(b, "execute", side_effect=OSError("password=SECRET login=999")):
            b.process_queue(self.root, box)
        self.assertNotIn("SECRET", json.dumps(box.files))


class MT5Tests(unittest.TestCase):
    def test_report_public_summary_excludes_identity(self):
        report = b'<html><table><tr><td>Name:</td><td>PRIVATE PERSON</td><td>Account:</td><td>123456</td></tr><tr><td>Total Net Profit:</td><td>1 200.50</td><td>Profit Factor:</td><td>1.80</td><td>Total Trades:</td><td>42</td><td>Profit Trades (% of total):</td><td>25 (59.52%)</td></tr></table></html>'
        result = b.report_metrics(report)
        self.assertEqual(result["total_trades"], "42")
        self.assertEqual(result["winning_trades"], "25 (59.52%)")
        self.assertNotIn("PRIVATE", json.dumps(result))
        self.assertNotIn("123456", json.dumps(result))

    def test_unowned_terminal_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            b.atomic_json(root / "settings.json", {"installation_id": "id"})
            with self.assertRaisesRegex(b.BridgeError, "TERMINAL_NOT_BRIDGE_OWNED"):
                b.owned_terminal(root)

    def test_stale_ex5_does_not_pass_failed_compile(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            terminal = root / "mt5-test"
            (terminal / "MQL5/Experts/OLFX").mkdir(parents=True)
            (terminal / "MQL5/Experts/OLFX/OLFX_test-1.ex5").write_bytes(b"OLD")
            source = b"void OnTick() {}"
            job = task("compile")
            job["source_sha256"] = hashlib.sha256(source).hexdigest()
            class Source:
                def get(self, path, ref):
                    return source, "abc"
            with patch.object(b, "owned_terminal", return_value=terminal), patch.object(b, "processes_in", return_value=[]), patch.object(b, "resource_check"), patch.object(b, "run_process", return_value=0):
                with self.assertRaisesRegex(b.BridgeError, "COMPILE_FAILED"):
                    b.execute(job, root, Source())

    def test_mocked_full_backtest_flow(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            terminal = root / "mt5-test"
            terminal.mkdir()
            source = b"int OnInit(){return 0;} void OnTick(){}"
            job = task("backtest")
            job["source_sha256"] = hashlib.sha256(source).hexdigest()
            class Source:
                def get(self, path, ref):
                    return source, "abc"
            def fake_run(args, *extra):
                if "metaeditor64" in args[0]:
                    ea = Path(args[2].removeprefix("/compile:"))
                    ea.with_suffix(".ex5").write_bytes(b"COMPILED")
                    ea.with_suffix(".log").write_text("Result: 0 errors, 0 warnings", encoding="utf-16")
                else:
                    (terminal / "reports/OLFX_test-1.htm").write_text('<html><table><tr><td>Total Trades:</td><td>10</td></tr></table></html>' + ' ' * 100)
                return 0
            with patch.object(b, "owned_terminal", return_value=terminal), patch.object(b, "processes_in", return_value=[]), patch.object(b, "resource_check"), patch.object(b, "run_process", side_effect=fake_run) as runner:
                result = b.execute(job, root, Source())
                self.assertEqual(result["code"], "BACKTEST_FINISHED")
                self.assertEqual(result["metrics"]["total_trades"], "10")
                self.assertEqual(runner.call_count, 2)
                self.assertTrue((root / "runs/test-1/report.htm").exists())


@unittest.skipUnless(os.name == "nt", "Requires real Windows")
class WindowsTests(unittest.TestCase):
    def test_dpapi_roundtrip_for_current_user(self):
        secret = b"LOCAL-TEST-NOT-A-REAL-TOKEN"
        encrypted = b.dpapi(secret, True)
        self.assertNotIn(secret, encrypted)
        self.assertEqual(b.dpapi(encrypted, False), secret)

    def test_agent_cannot_run_twice(self):
        with tempfile.TemporaryDirectory() as tmp:
            lock = b.singleton(Path(tmp))
            try:
                with self.assertRaisesRegex(b.BridgeError, "ALREADY_RUNNING"):
                    b.singleton(Path(tmp))
            finally:
                lock.close()

    def test_local_stop_cancels_only_launched_child(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "STOP").touch()
            with self.assertRaisesRegex(b.BridgeError, "STOP_REQUESTED"):
                b.run_process([sys.executable, "-c", "import time; time.sleep(60)"], root, root, 30)


if __name__ == "__main__":
    unittest.main()
