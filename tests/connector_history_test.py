"""Cold MT5 history, recovery windows, account isolation and terminal locking."""
import importlib.util
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from tempfile import TemporaryDirectory
from unittest import TestCase, main
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("olfx_reader", Path(__file__).resolve().parents[1] / "olfx-connector/olfx_agent.py")
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


def deal(ticket=1, year=2020):
    return dict(ticket=ticket, time=int(datetime(year, 1, 1, tzinfo=timezone.utc).timestamp()),
                type=1, entry=1, profit=2, commission=-.1, swap=0, fee=0,
                symbol="EURUSD", volume=.01)


class HistoryTests(TestCase):
    def reader(self, replies, balance=1.48):
        class MT5:
            def __init__(self):
                self.replies = list(replies)
                self.calls = []
                self.account = SimpleNamespace(login=4611, server="Axi-US51-Live", balance=balance, equity=balance, currency="USD")
                self.closed = False

            def account_info(self):
                return self.account

            def history_deals_get(self, start, end):
                self.calls.append((start, end))
                return self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]

            def initialize(self, *args, **kwargs):
                return True

            def shutdown(self):
                self.closed = True
        return MT5()

    def test_waits_for_cold_history_to_load_and_stabilize(self):
        mt5 = self.reader([(), [deal()], [deal(), deal(2)], [deal(), deal(2)]])
        with patch.object(agent.time, "sleep"):
            rows, _ = agent.read_complete_history(mt5, "4611", "Axi-US51-Live")
        self.assertEqual([r["deal_id"] for r in rows], ["1", "2"])
        self.assertEqual(len(mt5.calls), 4)
        self.assertTrue(all(start.year == 1970 for start, _ in mt5.calls))

    def test_funded_empty_history_is_never_confirmed(self):
        mt5 = self.reader([()])
        with patch.object(agent.time, "sleep") as sleep:
            with self.assertRaisesRegex(RuntimeError, "historial vacío"):
                agent.read_complete_history(mt5, "4611", "Axi-US51-Live")
        self.assertEqual(len(mt5.calls), 5)
        self.assertEqual(sum(c.args[0] for c in sleep.call_args_list), 22)

    def test_empty_new_zero_balance_account_still_waits_before_success(self):
        mt5 = self.reader([()], balance=0)
        with patch.object(agent.time, "sleep"):
            rows, _ = agent.read_complete_history(mt5, "4611", "Axi-US51-Live")
        self.assertEqual(rows, [])
        self.assertEqual(len(mt5.calls), 5)

    def test_none_is_a_read_failure_not_an_empty_account(self):
        mt5 = self.reader([None], balance=0)
        with patch.object(agent.time, "sleep"):
            with self.assertRaisesRegex(RuntimeError, "no terminó"):
                agent.read_complete_history(mt5, "4611", "Axi-US51-Live")

    def test_history_changes_that_never_settle_are_not_confirmed(self):
        mt5 = self.reader([[deal(n)] for n in range(5)])
        with patch.object(agent.time, "sleep"):
            with self.assertRaisesRegex(RuntimeError, "no terminó"):
                agent.read_complete_history(mt5, "4611", "Axi-US51-Live")

    def test_account_switch_during_history_read_is_rejected(self):
        mt5 = self.reader([[deal()]])
        original = mt5.history_deals_get
        def switched(start, end):
            result = original(start, end)
            mt5.account.login = 1048
            return result
        mt5.history_deals_get = switched
        with self.assertRaisesRegex(RuntimeError, "otra cuenta"):
            agent.read_complete_history(mt5, "4611", "Axi-US51-Live")

    def test_previously_synced_account_recovers_old_deals_and_finishes_last_batch_only(self):
        mt5 = self.reader([[deal(n) for n in range(151)]])
        item = dict(id="account-a", broker_server="Axi-US51-Live", encrypted_payload={}, last_sync_at="2026-11-18T23:47:15Z")
        with TemporaryDirectory() as folder, patch.object(agent, "HOME", Path(folder)), patch.object(agent, "decrypt", return_value=dict(login="4611", brokerServer="Axi-US51-Live", investorPassword="test")), patch.object(agent.time, "sleep"), patch.object(agent, "api", return_value={}) as api:
            agent.sync_account(mt5, item, dict(mt5_path="terminal64.exe", agent_token="test"))
        self.assertEqual(len(api.call_args_list), 2)
        first, last = [c.args[1] for c in api.call_args_list]
        self.assertFalse(first["finished"])
        self.assertTrue(last["finished"])
        self.assertEqual(len(first["deals"]), 150)
        self.assertEqual(len(last["deals"]), 1)
        self.assertEqual(first["accountId"], "account-a")
        self.assertEqual(first["login"], "4611")
        self.assertEqual(mt5.calls[0][0].year, 1970)
        self.assertTrue(mt5.closed)

    def test_failed_empty_import_never_pushes_success_and_releases_terminal(self):
        mt5 = self.reader([()])
        item = dict(id="account-a", broker_server="Axi-US51-Live", encrypted_payload={})
        with TemporaryDirectory() as folder, patch.object(agent, "HOME", Path(folder)), patch.object(agent, "decrypt", return_value=dict(login="4611", brokerServer="Axi-US51-Live", investorPassword="test")), patch.object(agent.time, "sleep"), patch.object(agent, "api") as api:
            with self.assertRaises(RuntimeError):
                agent.sync_account(mt5, item, dict(mt5_path="terminal64.exe", agent_token="test"))
            api.assert_not_called()
            with agent.terminal_session("terminal64.exe"):
                pass
        self.assertTrue(mt5.closed)

    def test_zero_balance_new_account_sends_a_valid_empty_completed_snapshot(self):
        mt5 = self.reader([()], balance=0)
        item = dict(id="new-account", broker_server="Axi-US51-Live", encrypted_payload={})
        with TemporaryDirectory() as folder, patch.object(agent, "HOME", Path(folder)), patch.object(agent, "decrypt", return_value=dict(login="4611", brokerServer="Axi-US51-Live", investorPassword="test")), patch.object(agent.time, "sleep"), patch.object(agent, "api", return_value={}) as api:
            agent.sync_account(mt5, item, dict(mt5_path="terminal64.exe", agent_token="test"))
        api.assert_called_once()
        snapshot = api.call_args.args[1]
        self.assertEqual(snapshot["deals"], [])
        self.assertEqual(snapshot["balance"], 0)
        self.assertTrue(snapshot["finished"])
        self.assertEqual(snapshot["accountId"], "new-account")
        self.assertTrue(mt5.closed)

    def test_two_readers_cannot_hold_same_terminal(self):
        with TemporaryDirectory() as folder, patch.object(agent, "HOME", Path(folder)):
            with agent.terminal_session("terminal64.exe"):
                with patch.object(agent.time, "monotonic", side_effect=[0, 91]):
                    with self.assertRaisesRegex(RuntimeError, "Otra lectura"):
                        with agent.terminal_session("terminal64.exe"):
                            self.fail("Terminal lock bypassed")
            with agent.terminal_session("terminal64.exe"):
                pass


if __name__ == "__main__":
    main()
