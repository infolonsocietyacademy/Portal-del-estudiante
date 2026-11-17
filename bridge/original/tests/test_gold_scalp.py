"""Regression tests with simulated broker; never connect to a live terminal."""
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "runtime"))
from gold_scalp_core import Engine, Fault, magic_for, structure_signal
from gold_scalp_runner import Strategy, connect
import gold_scalp
import bridge_agent
from broker_fixture import FakeMT5


class BrokerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.terminal = self.root / "mt5-test"
        self.clock = [1800000000.]
        self.now = lambda: self.clock[0]
        self.m = FakeMT5(self.now, self.terminal)
        self.cfg = {"symbol":"XAUUSD","size_mode":"fixed","fixed_lots":.05,
                    "risk_percent":.5,"max_spread_price":.6,"max_stop_price":20.}
        self.engine = self.make()

    def make(self):
        return Engine(self.m, self.root / "state", {"login":"123","server":"Axi-Demo"},
                      self.terminal, self.cfg, self.now)

    def job(self, jid, **extra):
        return {"id":jid,"action":"trade","expires_at":datetime.fromtimestamp(self.now()+120,timezone.utc).isoformat(),
                "symbol":"XAUUSD","direction":"buy","timeframe":"M1","hold_seconds":0,**extra}

    def opened(self, jid):
        self.engine.accept(self.job(jid))
        self.engine.tick()
        self.engine.tick()

    def bars(self, bearish=False):
        bar = int(self.now())-60
        rows = [{"time":bar-i*60,"open":2000.,"high":2000.5,"low":1999.8,"close":2000.} for i in range(96)]
        rows[0].update(open=2000.95,high=2001.3,low=2000.8,close=2001.2)
        rows[1].update(high=2001.,close=2000.9)
        rows[4]["high"],rows[12]["high"] = 2001.,2000.8
        rows[7]["low"],rows[15]["low"] = 1999.5,1999.3
        if bearish:
            rows = [{**r,"open":4000-r["open"],"close":4000-r["close"],
                     "high":4000-r["low"],"low":4000-r["high"]} for r in rows]
            self.m.tick.bid,self.m.tick.ask = 1998.75,1998.95
        else:
            self.m.tick.bid,self.m.tick.ask = 2001.05,2001.25
        self.m.rows = list(reversed(rows))
        return rows

    def test_twelve_positions_have_no_three_operation_cap(self):
        for i in range(12):
            self.opened("order"+str(i))
        self.assertEqual(len(self.m.pos),12)
        self.assertEqual(len({p.magic for p in self.m.pos}),12)

    def test_accepts_more_than_one_hundred_pending_signals(self):
        for i in range(125):
            self.engine.accept(self.job("waiting"+str(i),direction="structure"))
        self.assertEqual(len(self.engine.states),125)
        self.assertFalse(self.m.sent)

    def test_open_position_is_not_closed_after_any_timer(self):
        self.opened("one")
        for seconds in (61,301,1801,86400,315360000):
            self.clock[0] += seconds
            self.engine.tick()
        self.assertEqual(len(self.m.sent),1)
        self.assertEqual(self.engine.states["one"]["phase"],"open")

    def test_cancel_and_expiry_do_not_liquidate_an_open_position(self):
        self.opened("one")
        self.engine.states["one"]["cancel"] = True
        self.clock[0] += 10000
        self.engine.tick()
        self.assertEqual(len(self.m.sent),1)
        self.assertEqual(len(self.m.pos),1)

    def test_timed_exit_and_remote_close_are_rejected(self):
        with self.assertRaisesRegex(Fault,"BROKER_SL_TP_ONLY"):
            self.engine.accept(self.job("timed",hold_seconds=60))
        with self.assertRaises(Fault):
            self.engine.accept({"id":"close","action":"close","target_id":"one","expires_at":self.job("x")["expires_at"]})

    def test_broker_close_is_observed_without_an_exit_order(self):
        self.opened("one")
        p = self.m.pos.pop()
        self.m.deals.append(NS(entry=1,position_id=p.ticket,magic=p.magic,symbol=p.symbol,
                               volume=p.volume,price=2001.,profit=1.,commission=-.1,swap=0.,fee=0.))
        self.engine.tick()
        self.assertEqual(self.engine.states["one"]["phase"],"done")
        self.assertEqual(len(self.m.sent),1)

    def test_actual_deal_has_broker_stop_and_target(self):
        self.opened("one")
        r = self.m.sent[0]
        self.assertLess(r["sl"],r["price"])
        self.assertGreater(r["tp"],r["price"])
        self.assertAlmostEqual((r["tp"]-r["price"])/(r["price"]-r["sl"]),2.,places=2)

    def test_only_new_confirmed_m1_structure_opens_and_is_not_replayed(self):
        self.bars()
        strategy = Strategy(self.engine,self.root)
        self.assertEqual(strategy.step(),"WAIT_NEW_CANDLE")
        self.assertFalse(self.m.sent)
        self.clock[0] += 60
        self.bars()
        self.assertEqual(structure_signal(self.engine.bars({"symbol":"XAUUSD","timeframe":"M1"}))[0],1)
        self.assertEqual(strategy.step(),"SIGNAL_ACCEPTED")
        self.assertEqual(len(self.m.sent),1)
        strategy.step()
        self.assertEqual(len(self.m.sent),1)
        restarted = Strategy(self.make(),self.root)
        restarted.step()
        self.assertEqual(len(self.m.sent),1)

    def test_bearish_structure_sends_sell(self):
        self.bars(bearish=True)
        strategy = Strategy(self.engine,self.root)
        strategy.step()
        self.clock[0] += 60
        self.bars(bearish=True)
        strategy.step()
        self.assertEqual(len(self.m.sent),1)
        self.assertEqual(self.m.sent[0]["type"],self.m.ORDER_TYPE_SELL)

    def test_pause_cancels_unsubmitted_entry_and_keeps_open_position(self):
        self.opened("open")
        self.engine.accept(self.job("waiting"))
        Strategy(self.engine,self.root).step(paused=True)
        self.assertEqual(len(self.m.sent),1)
        self.assertEqual(self.engine.states["waiting"]["phase"],"done")
        self.assertEqual(self.engine.states["open"]["phase"],"open")

    def test_real_account_and_account_switch_block_entries(self):
        self.m.account.trade_mode = 2
        with self.assertRaisesRegex(Fault,"DEMO_ONLY"):
            self.engine.accept(self.job("real"))
        self.m.account.trade_mode = 0
        self.engine.accept(self.job("changed"))
        self.m.account.login = 456
        self.engine.tick()
        self.assertFalse(self.m.sent)

    def test_stale_quote_and_broker_rejection_open_nothing(self):
        self.m.symbol_info_tick = lambda *_: NS(bid=2000.,ask=2000.2,time=self.now()-60)
        self.engine.accept(self.job("stale"))
        self.engine.tick()
        self.assertFalse(self.m.sent)
        self.m.symbol_info_tick = lambda *_: NS(bid=2000.,ask=2000.2,time=self.now())
        self.m.check_code = 10019
        self.engine.tick()
        self.assertFalse(self.m.sent)

    def test_unknown_send_blocks_later_send_without_losing_queued_signal(self):
        self.m.next_code = None
        self.opened("unknown")
        self.engine.accept(self.job("next"))
        self.m.next_code = 10009
        self.engine.tick()
        self.assertEqual(len(self.m.sent),1)
        self.assertEqual(self.engine.states["next"]["code"],"WAIT_RECONCILIATION")

    def test_restart_does_not_duplicate_open_positions(self):
        self.opened("one")
        self.engine = self.make()
        self.engine.accept(self.job("one"))
        self.engine.tick()
        self.assertEqual(len(self.m.sent),1)

    def test_hedging_keeps_foreign_positions_and_netting_conflict_is_blocked(self):
        foreign = NS(ticket=1,magic=999,symbol="XAUUSD",volume=.01,type=0,time=int(self.now()),price_open=1999.,profit=0.,swap=0.)
        self.m.pos.append(foreign)
        self.opened("hedge")
        self.assertIn(foreign,self.m.pos)
        self.m.account.margin_mode = 0
        self.opened("netting")
        self.assertEqual(len(self.m.sent),1)
        self.assertIn(foreign,self.m.pos)


class SameConsoleTest(unittest.TestCase):
    def test_old_timed_gold_test_is_disabled(self):
        with self.assertRaisesRegex(bridge_agent.BridgeError,"TIMED_GOLD_DEMO_DISABLED_SL_TP_ONLY"):
            bridge_agent.execute({"action":"demo_gold_once"},Path("fixture"),None)

    def test_original_gold_action_uses_new_worker_and_existing_status_action(self):
        with patch("gold_scalp.start",return_value={"code":"DEMO_GOLD_SCALP_STARTED","nonce":"private"}):
            value = bridge_agent.execute({"action":"demo_gold"},Path("fixture"),None)
        self.assertEqual(value["code"],"DEMO_GOLD_SCALP_STARTED")
        self.assertNotIn("nonce",value)

    def test_start_uses_existing_python_and_console_without_new_terminal_copy(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            def require(ok,code):
                if not ok: raise Fault(code)
            api = NS(require=require,BridgeError=Fault)
            calls = []
            def spawn(args,**kwargs):
                calls.append((args,kwargs))
                (root/"gold-scalp-m1"/"health.json").write_text(json.dumps({
                    "updated_at":__import__("time").time(),"nonce":kwargs["env"]["OLFX_SCALP_NONCE"],
                    "account_type_verified":"demo","ready":True}))
                return NS(poll=lambda:None)
            with patch("gold_scalp.worker_locked",return_value=False), patch("gold_scalp.subprocess.run",return_value=NS(returncode=0)), patch("gold_scalp.subprocess.Popen",side_effect=spawn):
                value = gold_scalp.start({"id":"demo"},root,api)
            self.assertEqual(value["code"],"DEMO_GOLD_SCALP_STARTED")
            self.assertEqual(len(calls),1)
            self.assertFalse(calls[0][1]["creationflags"] & 0x10)
            self.assertFalse((root/"mt5-execution").exists())

    def test_stop_only_sets_entry_pause_marker(self):
        with TemporaryDirectory() as folder:
            root = Path(folder);(root/"gold-scalp-m1").mkdir()
            gold_scalp.stop(root)
            self.assertTrue((root/"gold-scalp-m1"/"STOP").is_file())

    def test_import_does_not_import_mt5_or_send_orders(self):
        self.assertNotIn("MetaTrader5",sys.modules)


if __name__ == "__main__":
    unittest.main()
