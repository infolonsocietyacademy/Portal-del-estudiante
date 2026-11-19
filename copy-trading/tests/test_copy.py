import copy
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from copy_bot import Blocked, Engine, MT5, Paper, State, compatible, floor_lots, remaining_lots, scaled_lots, snapshot, validate_config
from scenario import Quotes, SPEC, example_config, snap, source


class CopyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.cfg = example_config()
        self.f = self.cfg["followers"][0]
        self.path = Path(self.temp.name) / "state.json"
        self.state = State(self.path, self.cfg, "paper")
        self.data = self.state.follower(self.f["id"])
        self.quotes = Quotes()
        self.broker = Paper(self.quotes, self.data)
        self.engine = Engine(self.cfg, self.state)
        self.engine.sync(self.f, snap(), self.broker)

    def tearDown(self):
        self.temp.cleanup()

    def sync(self, *positions):
        self.engine.sync(self.f, snap(*positions), self.broker)

    def test_duplicate_poll_and_restart(self):
        p = source()
        self.sync(p)
        self.sync(p)
        state = State(self.path, self.cfg, "paper")
        Engine(self.cfg, state).sync(self.f, snap(p), Paper(self.quotes, state.follower(self.f["id"])))
        self.assertEqual(len(state.follower(self.f["id"])["paper"]), 1)

    def test_close_and_partial_are_idempotent(self):
        p = source()
        self.sync(p)
        p["volume"] = 0.1
        self.sync(p)
        self.sync(p)
        self.assertEqual(self.broker.positions()[0]["volume"], 0.05)
        self.sync()
        self.sync()
        self.assertEqual(self.broker.positions(), [])

    def test_sell(self):
        self.sync(source(type=1, sl=2502, tp=2495, price_open=2500))
        self.assertEqual(self.broker.positions()[0]["type"], 1)

    def test_sl_tightens_but_does_not_widen(self):
        p = source()
        self.sync(p)
        p["sl"] = 2499
        self.sync(p)
        p["sl"] = 2497
        self.sync(p)
        self.assertEqual(self.broker.positions()[0]["sl"], 2499)

    def test_manual_close_does_not_reopen(self):
        p = source()
        self.sync(p)
        self.data["paper"].clear()
        self.sync(p)
        self.assertEqual(self.broker.positions(), [])

    def test_baseline_existing_position_skipped(self):
        self.data["started"] = None
        self.sync(source())
        self.assertEqual(self.broker.positions(), [])

    def test_no_stop_skipped_permanently(self):
        p = source(sl=0)
        self.sync(p)
        p["sl"] = 2498
        self.sync(p)
        self.assertEqual(self.broker.positions(), [])

    def test_stale_entry(self):
        self.sync(source(time_msc=int((time.time() - 10) * 1000)))
        self.assertEqual(self.broker.positions(), [])

    def test_stale_master_never_closes(self):
        self.sync(source())
        stale = snap()
        stale["time"] -= 20
        with self.assertRaises(Blocked):
            self.engine.sync(self.f, stale, self.broker)
        self.assertEqual(len(self.broker.positions()), 1)

    def test_snapshot_expires_during_check(self):
        def prepare(action):
            self.engine.snapshot_time -= 100
            return action
        with patch.object(self.broker, "prepare", side_effect=prepare):
            self.sync(source())
        self.assertEqual(self.broker.positions(), [])

    def test_under_minimum_never_rounds_up(self):
        self.f["lot_multiplier"] = 0.01
        self.sync(source())
        self.assertEqual(self.broker.positions(), [])
        self.assertEqual(floor_lots(0.015, 0.01), 0.01)

    def test_spread_limit(self):
        self.f["max_spread_points"] = 1
        self.sync(source())
        self.assertEqual(self.broker.positions(), [])

    def test_price_drift(self):
        self.sync(source(price_open=2490))
        self.assertEqual(self.broker.positions(), [])

    def test_risk_limit(self):
        self.f["max_risk_pct"] = 0.01
        self.sync(source())
        self.assertEqual(self.broker.positions(), [])

    def test_max_lots_rejects_not_clamps(self):
        self.f["max_lots"] = 0.05
        self.sync(source())
        self.assertEqual(self.broker.positions(), [])

    def test_position_cap(self):
        self.f["max_positions"] = 1
        self.sync(source(), source(identifier=9002, ticket=9002))
        self.assertEqual(len(self.broker.positions()), 1)

    def test_daily_limit_stays_blocked_but_closes(self):
        p = source()
        self.sync(p)
        self.quotes.equity = 9700
        self.sync(p, source(identifier=9002))
        self.quotes.equity = 10000
        self.sync(p, source(identifier=9003))
        self.assertEqual(len(self.broker.positions()), 1)
        self.sync()
        self.assertEqual(self.broker.positions(), [])

    def test_disabled_still_closes(self):
        self.sync(source())
        self.f["enabled"] = False
        self.sync()
        self.assertEqual(self.broker.positions(), [])

    def test_failed_send_stays_pending(self):
        with patch.object(self.broker, "execute", side_effect=Blocked("timeout")):
            with self.assertRaises(Blocked):
                self.sync(source())
        self.assertIsNotNone(self.data["pending"])
        with self.assertRaises(Blocked):
            self.sync(source())

    def test_crash_after_accepted_open_keeps_journal(self):
        execute = self.broker.execute
        def crash(action, prepared):
            execute(action, prepared)
            raise RuntimeError("simulated crash")
        with patch.object(self.broker, "execute", side_effect=crash):
            with self.assertRaises(RuntimeError):
                self.sync(source())
        self.assertIsNotNone(self.data["pending"])
        with self.assertRaises(Blocked):
            self.sync(source())

    def test_increased_master_volume_blocked(self):
        p = source()
        self.sync(p)
        p["volume"] = 0.3
        with self.assertRaises(Blocked):
            self.sync(p)

    def test_symbol_mismatch(self):
        bad = dict(SPEC, trade_contract_size=10)
        with self.assertRaises(Blocked):
            compatible(SPEC, bad)

    def test_identity_change_preserves_state(self):
        self.cfg["master"]["login"] += 1
        with self.assertRaises(Blocked):
            State(self.path, self.cfg, "paper")

    def test_limits_change_preserves_state(self):
        self.f["max_lots"] = 0.2
        self.assertEqual(State(self.path, self.cfg, "paper").data["scope"], self.state.data["scope"])

    def test_duplicate_account_rejected(self):
        self.f.update(login=self.cfg["master"]["login"], server=self.cfg["master"]["server"])
        with self.assertRaises(Blocked):
            validate_config(self.cfg)

    def test_invalid_risk_rejected(self):
        self.f["max_risk_pct"] = float("nan")
        with self.assertRaises(Blocked):
            validate_config(self.cfg)

    def test_position_read_failure(self):
        class Failure:
            def positions(self):
                raise Blocked("lectura fallida")
        with self.assertRaises(Blocked):
            snapshot(Failure(), self.cfg)

    def test_mt5_real_follower_blocked(self):
        from types import SimpleNamespace
        class Info(SimpleNamespace):
            def _asdict(self):
                return vars(self)
        account = Info(login=100002, server="CAMBIAR-SERVIDOR-DEMO", trade_mode=2)
        terminal = Info(connected=True, path=str(Path(self.f["terminal_path"]).parent))
        api = SimpleNamespace(account_info=lambda: account, terminal_info=lambda: terminal, ACCOUNT_TRADE_MODE_DEMO=0)
        with self.assertRaisesRegex(Blocked, "DEMO"):
            MT5(api, self.cfg, self.f, demo=True).verify()

    def test_decimal_volume_boundaries(self):
        self.assertEqual(scaled_lots(0.7, 0.1, 0.01), 0.07)
        self.assertEqual(remaining_lots(0.3, 0.01, 0.3, 0.01), 0.01)
        self.assertEqual(remaining_lots(0.1, 0.1, 0.3, 0.01), 0.03)

    def test_accepted_close_with_stale_positions_halts(self):
        self.sync(source())
        with patch.object(self.broker, "execute", return_value={"retcode": 10009}):
            with self.assertRaises(Blocked):
                self.sync()
        self.assertEqual(self.data["pending"]["kind"], "close")
        with self.assertRaises(Blocked):
            self.sync()

    def test_readonly_adapter_never_sends(self):
        broker = MT5(None, self.cfg, self.f, demo=False)
        with self.assertRaises(Blocked):
            broker.prepare({})
        with self.assertRaises(Blocked):
            broker.execute({}, {})

    def test_disallowed_symbol(self):
        self.sync(source(symbol="BTCUSD"))
        self.assertEqual(self.broker.positions(), [])

    def test_two_followers_are_isolated(self):
        f2 = copy.deepcopy(self.f)
        f2.update(id="DEMO_02", login=200003)
        d2 = self.state.follower(f2["id"])
        b2 = Paper(Quotes(), d2)
        self.engine.sync(f2, snap(), b2)
        p = source()
        self.sync(p)
        self.engine.sync(f2, snap(p), b2)
        self.assertEqual(len(self.broker.positions()), 1)
        self.assertEqual(len(b2.positions()), 1)
        self.assertNotEqual(self.broker.positions()[0]["magic"], b2.positions()[0]["magic"])

    def test_global_pause_blocks_request(self):
        from copy_bot import ROOT
        exists = Path.exists
        with patch.object(Path, "exists", lambda path: True if path == ROOT / "PAUSA_TOTAL.txt" else exists(path)):
            self.sync(source())
        self.assertEqual(self.broker.positions(), [])

    def test_entry_pause_keeps_closures(self):
        from copy_bot import ROOT
        self.sync(source())
        exists = Path.exists
        with patch.object(Path, "exists", lambda path: True if path == ROOT / "PAUSA_ENTRADAS.txt" else exists(path)):
            self.sync()
        self.assertEqual(self.broker.positions(), [])


class AdapterTests(unittest.TestCase):
    def setUp(self):
        from types import SimpleNamespace
        class Info(SimpleNamespace):
            def _asdict(self):
                return vars(self)
        self.Info = Info
        cfg = example_config()
        f = cfg["followers"][0]
        self.account = Info(login=f["login"], server=f["server"], equity=10000,
                            trade_mode=0, margin_mode=2, trade_allowed=True, trade_expert=True)
        self.terminal = Info(connected=True, path=str(Path(f["terminal_path"]).parent),
                             trade_allowed=True, tradeapi_disabled=False)
        self.rows = []
        self.sent = []
        self.api = SimpleNamespace(
            account_info=lambda: self.account, terminal_info=lambda: self.terminal,
            positions_get=lambda: self.rows, symbol_select=lambda *args: True,
            symbol_info=lambda name: Info(**SPEC),
            symbol_info_tick=lambda name: Info(ask=2500.1, bid=2500.0, time_msc=int(time.time()*1000)),
            order_check=lambda req: Info(retcode=0),
            order_send=lambda req: self.sent.append(req) or Info(retcode=10009),
            ACCOUNT_TRADE_MODE_DEMO=0, ACCOUNT_MARGIN_MODE_RETAIL_HEDGING=2,
            TRADE_ACTION_DEAL=1, TRADE_ACTION_SLTP=6, ORDER_TIME_GTC=0,
            ORDER_FILLING_FOK=0, TRADE_RETCODE_DONE=10009)
        self.broker = MT5(self.api, cfg, f, demo=True)
        self.action = {"kind": "open", "symbol": "XAUUSD", "side": 0, "volume": .1,
                       "magic": 123, "price": 2500.1, "sl": 2498, "tp": 2505}

    def test_open_request_uses_fok_and_stops(self):
        req = self.broker.prepare(self.action)
        self.assertEqual(req["type_filling"], self.api.ORDER_FILLING_FOK)
        self.assertEqual(req["sl"], 2498)
        self.assertEqual(req["tp"], 2505)
        self.broker.execute(self.action, req)
        self.assertEqual(len(self.sent), 1)

    def test_account_change_between_check_and_send(self):
        req = self.broker.prepare(self.action)
        self.account.login += 1
        with self.assertRaises(Blocked):
            self.broker.execute(self.action, req)
        self.assertEqual(self.sent, [])

    def test_no_positions_response_is_error(self):
        self.api.positions_get = lambda: None
        with self.assertRaises(Blocked):
            self.broker.positions()

    def test_failed_check_does_not_send(self):
        self.api.order_check = lambda req: self.Info(retcode=10016)
        with self.assertRaises(Blocked):
            self.broker.prepare(self.action)
        self.assertEqual(self.sent, [])

    def test_stale_quote(self):
        self.api.symbol_info_tick = lambda name: self.Info(ask=2500.1, bid=2500, time_msc=int((time.time()-20)*1000))
        with self.assertRaises(Blocked):
            self.broker.prepare(self.action)

    def test_missing_fok_rejected(self):
        self.api.symbol_info = lambda name: self.Info(**dict(SPEC, filling_mode=2))
        with self.assertRaises(Blocked):
            self.broker.prepare(self.action)

    def test_close_request_targets_exact_position(self):
        self.rows = [self.Info(ticket=45, identifier=40, symbol="XAUUSD", type=0, volume=.1)]
        action = {"kind":"close", "symbol":"XAUUSD", "side":1, "volume":.05,
                  "before_volume":.1, "magic":123, "ticket":45, "position_id":40}
        req = self.broker.prepare(action)
        self.assertEqual(req["position"], 45)
        self.assertEqual(req["type"], 1)

    def test_uncertain_result_never_retried(self):
        self.api.order_send = lambda req: self.sent.append(req) or None
        req = self.broker.prepare(self.action)
        with self.assertRaises(Blocked):
            self.broker.execute(self.action, req)
        self.assertEqual(len(self.sent), 1)


if __name__ == "__main__":
    unittest.main()
