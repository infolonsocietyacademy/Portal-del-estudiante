"""M5 structure and retest, gold or Nasdaq-100, paired DEMO only, SL/TP1 exits."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import time
from gold_scalp_core import Engine, Fault, VERSION, atomic
from gold_settings import load_gold_settings

ROOT = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "OLFX_MT5_BRIDGE"
DATA = ROOT / "gold-scalp-m1"


from range_1030 import Strategy, STRATEGY


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
            "symbol": engine.config["symbol"], "period": "M1", "strategy": STRATEGY, "target": "TP1", "target_r": 1.0, "entry_limit": 1, "max_simultaneous_positions": 1,
            "hold_seconds": 0, "close_policy": "BROKER_SL_TP_ONLY", "paused": paused,
            "size_mode": engine.config["size_mode"], "fixed_lots": engine.config["fixed_lots"], "max_risk_cash":engine.config.get("max_risk_cash"),
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
            if state["phase"] == "waiting" and (state["job"].get("direction") != "range_breakout" or state["job"].get("timeframe") != "M1"):
                state["cancel"] = True
                engine.save(state)
        strategy = Strategy(engine, DATA)
        print("OLFX RANGO NY 10:30-10:45 / PRIMER BUY / SL 50% / TP1 1R DEMO; un intento diario; salidas SOLO SL/TP.", flush=True)
        last_display = 0
        while True:
            paused = (DATA / "STOP").exists() or (ROOT / "STOP").exists()
            try:
                code = strategy.step(paused=paused)
                snapshot = health(engine, code, paused)
                snapshot.update(strategy.snapshot())
                atomic(DATA / "health.json", snapshot)
                if time.monotonic()-last_display >= 30:
                    print("OLFX RANGO 10:30 | "+code+" | abiertas: "+str(snapshot["open_positions"])+" | entradas: "+str(snapshot["entry_attempts"])+" | cierre SL/TP", flush=True)
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
                        strategy = Strategy(engine, DATA)
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
        print("OLFX M1: "+code, flush=True)
        sys.exit(1)

