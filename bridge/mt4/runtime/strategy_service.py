"""Persist explicit strategy enablement and recover a stopped DEMO worker.

No orders, liquidation, terminal shutdown, process killing or daily-state reset.
An unresponsive process that still owns its lock is reported, never duplicated.
"""
import json
import math
from pathlib import Path
import time


def set_enabled(root, enabled):
    from gold_scalp_core import atomic
    atomic(Path(root) / "gold-scalp-m1" / "service.json",
           {"schema": 1, "enabled": enabled, "updated_at": time.time()})


def enabled(root):
    try:
        value = json.loads((Path(root) / "gold-scalp-m1" / "service.json").read_text())
        return value.get("schema") == 1 and value.get("enabled") is True
    except (OSError, ValueError, AttributeError):
        return False


def supervise(root, api):
    from gold_scalp import status, worker_locked, start
    from gold_scalp_core import atomic
    root = Path(root)
    folder = root / "gold-scalp-m1"
    if not enabled(root) or (root / "STOP").exists() or (folder / "STOP").exists():
        return
    current = status(root)
    fresh = current and current.get("snapshot_fresh") is True
    if worker_locked(folder):
        value = dict(code="WORKER_HEALTHY" if fresh else "WORKER_UNRESPONSIVE_NO_DUPLICATE",
                     updated_at=time.time(), worker_locked=True)
    else:
        try:
            result = start({"action": "demo_gold"}, root, api)
            value = dict(code="WORKER_RECOVERED", updated_at=time.time(),
                         worker_locked=True, snapshot_fresh=result.get("snapshot_fresh", False))
        except Exception:
            value = dict(code="WORKER_RECOVERY_FAILED_RETRY", updated_at=time.time(), worker_locked=False)
    atomic(folder / "service-health.json", value)


def configure(job, root, api):
    """Validate broker volume, pause, require flat DEMO, save fixed size, restart."""
    import MetaTrader5 as mt5
    from asset_spec import asset_kind
    from gold_scalp import stop, worker_locked, start, status
    from gold_scalp_runner import connect
    from gold_scalp_core import LIVE_PHASES, lots_for, Fault
    from gold_settings import load_gold_settings, save_gold_settings
    root = Path(root)
    folder = root / "gold-scalp-m1"
    lots = job.get("fixed_lots")
    api.require(type(lots) in (int, float) and math.isfinite(lots) and .001 <= lots <= 1,
                "INVALID_FIXED_LOTS")
    old = load_gold_settings(root)
    api.require(asset_kind(old["symbol"]) == "nas100", "RANGE_NAS100_REQUIRED")
    try:
        engine = connect(mt5, root)
        info = mt5.symbol_info(old["symbol"])
        api.require(info is not None, "SYMBOL_UNAVAILABLE")
        lots_for("fixed", lots, 1, 1, float(info.volume_min), float(info.volume_max), float(info.volume_step))
        stop(root)
        deadline = time.monotonic() + 20
        while worker_locked(folder) and time.monotonic() < deadline:
            time.sleep(.25)
        api.require(not worker_locked(folder), "WAIT_PREVIOUS_SL_TP_OR_WORKER")
        engine = connect(mt5, root)
        positions = mt5.positions_get(symbol=old["symbol"])
        orders = mt5.orders_get(symbol=old["symbol"])
        api.require(positions is not None and orders is not None, "BROKER_STATE_UNAVAILABLE")
        api.require(not positions and not orders, "WAIT_FLAT_BEFORE_SIZE_CHANGE")
        api.require(not any(s["job"]["action"] == "trade" and s["phase"] in LIVE_PHASES
                            for s in engine.states.values()), "PREVIOUS_INTENT_UNRECONCILED")
        config = dict(old, size_mode="fixed", fixed_lots=float(lots))
        # Preserve all existing SL/TP, spread, stop distance and cash risk limits.
        api.atomic_json(root / "settings_before_fixed_lots.json", old)
        save_gold_settings(root, config)
        mt5.shutdown()
        try:
            value = start(job, root, api)
            api.require(value.get("snapshot_fresh") is True and value.get("size_mode") == "fixed"
                        and value.get("fixed_lots") == float(lots), "FIXED_LOTS_ACTIVATION_NOT_CONFIRMED")
        except Exception:
            stop(root)
            save_gold_settings(root, old)
            raise
        return {**value, "code": "RANGE_FIXED_LOTS_ACTIVATED", "configuration": config,
                "service_enabled": enabled(root)}
    except (ValueError, Fault) as exc:
        raise api.BridgeError(str(exc)) from None
    finally:
        mt5.shutdown()
