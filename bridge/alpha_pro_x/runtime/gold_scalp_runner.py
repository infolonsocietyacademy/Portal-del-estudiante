"""Continuous H1 CRT with M5 MSS/retest on the pinned DEMO. Broker SL/TP are the only exits."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import time
from gold_scalp_core import Engine, Fault, VERSION, atomic, crt_context
from gold_settings import load_gold_settings

ROOT = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "OLFX_MT5_BRIDGE"
DATA = ROOT / "gold-scalp-m1"


class Strategy:
    def __init__(self, engine, directory):
        self.engine = engine
        self.directory = Path(directory)
        self.cursor = self.directory / "crt-m5-cursor.json"
        self.last_bar = None
        if self.cursor.is_file():
            value = json.loads(self.cursor.read_text(encoding="utf-8"))
            if type(value.get("last_bar")) is not int:
                raise Fault("CORRUPT_STRATEGY_CURSOR")
            self.last_bar = value["last_bar"]

    def step(self, paused=False):
        engine = self.engine
        # Reconcile all positions first. Pausing never creates a close request.
        if paused:
            for state in engine.states.values():
                if state["job"]["action"] == "trade" and state["phase"] == "waiting":
                    state["cancel"] = True
                    engine.save(state)
        engine.tick()
        account = engine.guard(trade=True)
        if not engine.market_fresh(engine.mt5.symbol_info_tick(engine.config["symbol"])):
            return "WAIT_FRESH_QUOTE"
        rows = engine.bars({"symbol": engine.config["symbol"], "timeframe": "M5", "direction": "crt"})
        bar = rows[0]["time"]
        if self.last_bar is None:
            self.last_bar = bar
            atomic(self.cursor, {"last_bar": bar})
            return "WAIT_NEW_CANDLE"
        if bar <= self.last_bar:
            return "PAUSED_SL_TP_ONLY" if paused else "WAIT_NEW_CANDLE"
        # Persist the closed candle before accepting its intent; replay never sends twice.
        self.last_bar = bar
        atomic(self.cursor, {"last_bar": bar})
        if paused:
            return "PAUSED_SL_TP_ONLY"
        if not 0 <= engine.market_now() - bar - 300 <= 10:
            return "WAIT_FRESH_SIGNAL"
        context = crt_context(rows)
        if not context["side"]:
            return context["state"]
        # Account-specific ID prevents accidental reuse if local state is moved.
        import hashlib
        pin = hashlib.sha256((str(account.login)+"@"+account.server).encode()).hexdigest()[:12]
        job = {"id": "crt5-"+pin+"-"+str(context["setup"]), "action": "trade",
               "expires_at": datetime.fromtimestamp(engine.clock()+60, timezone.utc).isoformat(),
               "symbol": engine.config["symbol"], "direction": "crt", "timeframe": "M5",
               "signal_bar": bar, "crt_setup": context["setup"], "hold_seconds": 0, "signal_timeout_seconds": 60, "rr": 2.0}
        if job["id"] in engine.states:
            return "CRT_SETUP_CONSUMED"
        engine.accept(job)
        engine.tick()
        return "SIGNAL_ACCEPTED"



class CombinedStrategy:
    """Keep CRT and ALPHA cursors and IDs independent on the existing engine."""
    def __init__(self,engine,directory):
        from alpha_pro_x import AlphaStrategy
        self.engine=engine
        self.crt=Strategy(engine,directory)
        self.alpha=AlphaStrategy(engine,directory)

    def step(self,paused=False):
        crt=self.crt.step(paused=paused)
        alpha=self.alpha.step(paused=paused)
        self.engine.alpha_signal_state=alpha
        return crt+' | '+alpha


def connect(mt5, root):
    import bridge_agent as api
    root = Path(root)
    terminal = api.owned_terminal(root)
    pin = root / "gold-scalp-m1" / "account-pin.json"
    expected = json.loads(pin.read_text(encoding="utf-8")) if pin.is_file() else api.local_demo_from_logs(terminal)
    config = load_gold_settings(root)
    # Reuse the existing owned terminal; do not switch its account or create a new copy.
    if not mt5.initialize(str(terminal / "terminal64.exe"), timeout=60000, portable=True):
        error = mt5.last_error()
        code = error[0] if isinstance(error, (tuple, list)) and error else "UNKNOWN"
        mt5.shutdown()
        raise Fault("MT5_CONNECT_FAILED_"+str(code))
    try:
        info = mt5.terminal_info()
        if info is None or Path(info.data_path).resolve() != terminal.resolve():
            raise Fault("EXECUTION_DATA_PATH_MISMATCH")
        engine = Engine(mt5, root / "gold-scalp-m1" / "state", expected, terminal, config)
        engine.guard(trade=True)
        if not mt5.symbol_select(config["symbol"], True):
            raise Fault("SYMBOL_UNAVAILABLE")
        from market_feed import MarketFeed
        engine.feed = MarketFeed()
        if not pin.is_file():
            atomic(pin, expected)
        return engine
    except Exception:
        mt5.shutdown()
        raise


def health(engine, code, paused=False):
    live = [s for s in engine.states.values() if s["job"]["action"] == "trade" and s["phase"] not in {"done", "failed"}]
    diagnostic = engine.diagnostics()
    return {"schema": 1, "version": VERSION, "updated_at": time.time(),
            "code": code if diagnostic["trade_ready"] else diagnostic["code"], "signal_state":code,
            "ready": diagnostic["trade_ready"], "account_type_verified": "demo",
            "symbol": engine.config["symbol"], "period": "M5", "strategy": "CRT_H1_MSS_M5_RETEST + ALPHA_PRO_X_M5", "alpha_signal_state": getattr(engine,"alpha_signal_state","ALPHA_WAIT_NEW_CANDLE"), "crt_timeframe": "H1", "entry_limit": None, "automatic_entry_timeframe": "M5",
            "hold_seconds": 0, "close_policy": "BROKER_SL_TP_ONLY", "paused": paused,
            "size_mode": engine.config["size_mode"], "fixed_lots": engine.config["fixed_lots"],
            "risk_percent": engine.config["risk_percent"], "active_commands": len(live),
            "open_positions": sum(s.get("owned_open_positions", 0) for s in live),
            "entry_attempts": sum(s.get("requested_volume", 0) > 0 for s in engine.states.values()),
            "closed_commands": sum(s["code"] == "POSITION_CLOSED" for s in engine.states.values()),
            "net_recorded": round(sum(s.get("profit", 0) for s in engine.states.values()), 2),
            "quote_fresh": diagnostic["quote_fresh"], "python_trading_allowed": diagnostic["python_trading_allowed"],
            "quote_age_seconds":diagnostic.get("quote_age_seconds"),
            "adjusted_quote_age_seconds":diagnostic.get("adjusted_quote_age_seconds"),
            "broker_clock_offset_seconds":diagnostic.get("broker_clock_offset_seconds"),
            "advancing_tick_samples":diagnostic.get("advancing_tick_samples"),
            "spread_price":diagnostic.get("spread_price"),
            "nonce": os.environ.get("OLFX_SCALP_NONCE", "")}


def run():
    import bridge_agent as api
    DATA.mkdir(parents=True, exist_ok=True)
    lock = api.singleton(DATA)
    import MetaTrader5 as mt5
    engine = None
    try:
        engine = connect(mt5, ROOT)
        # Retire unfilled legacy intents; accepted positions keep their original broker SL/TP.
        for state in engine.states.values():
            if state["phase"] == "waiting" and (state["job"].get("direction") not in {"crt", "alpha"} or state["job"].get("timeframe") != "M5"):
                state["cancel"] = True
                engine.save(state)
        strategy = CombinedStrategy(engine, DATA)
        print("OLFX CRT H1 + MSS/retest M5 + ALPHA PRO X M5 XAUUSD DEMO; sin limite de entradas; salidas SOLO SL/TP.", flush=True)
        last_display = 0
        while True:
            paused = (DATA / "STOP").exists() or (ROOT / "STOP").exists()
            try:
                code = strategy.step(paused=paused)
                snapshot = health(engine, code, paused)
                atomic(DATA / "health.json", snapshot)
                if time.monotonic()-last_display >= 30:
                    print("OLFX M5 | "+code+" | abiertas: "+str(snapshot["open_positions"])+" | entradas: "+str(snapshot["entry_attempts"])+" | cierre SL/TP", flush=True)
                    last_display = time.monotonic()
                if paused and not snapshot["active_commands"]:
                    return
            except Fault as exc:
                atomic(DATA / "health.json", {"schema":1,"version":VERSION,"code":str(exc),"ready":False,
                       "updated_at":time.time(),"nonce":os.environ.get("OLFX_SCALP_NONCE","")})
                if str(exc) == "MT5_DISCONNECTED":
                    mt5.shutdown()
                    try:
                        engine = connect(mt5, ROOT)
                        strategy = CombinedStrategy(engine, DATA)
                    except Fault:
                        time.sleep(5)
            time.sleep(1)
    except KeyboardInterrupt:
        # No timer, reverse order, liquidation or position modification on interruption.
        (DATA / "STOP").touch()
    finally:
        mt5.shutdown()
        lock.close()


if __name__ == "__main__":
    try:
        run()
    except Exception as exc:
        DATA.mkdir(parents=True, exist_ok=True)
        code = str(exc) if isinstance(exc, Fault) else "SCALP_LOCAL_ERROR"
        atomic(DATA / "health.json", {"schema":1,"version":VERSION,"code":code,"ready":False,
               "updated_at":time.time(),"nonce":os.environ.get("OLFX_SCALP_NONCE","")})
        print("OLFX M5: "+code, flush=True)
        sys.exit(1)
