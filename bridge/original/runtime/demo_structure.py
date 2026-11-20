"""Fixed, bounded structure session. Actual execution is guarded inside MQL5."""
import json
import math
from pathlib import Path
import re
import time

SOURCE_HASH = "03ca1095fbed4670748494c33a0ce1bed08bc98930556e934e68032ec460d887"


def build_structure_files(job_id, demo):
    from demo_roundtrip import build_demo_files
    files = build_demo_files(job_id, demo)
    old = files["stem"]
    files["stem"] = "OLFX_M1_" + job_id
    files["ini"] = files["ini"].replace(old, files["stem"])
    files["parameters"] = files["parameters"].replace(old, files["stem"])
    return files


def verified_session(data, started=False):
    if not isinstance(data, dict) or type(data.get("schema")) is not int or data.get("schema") != 1 or data.get("demo_verified") is not True:
        raise ValueError("STRUCTURE_DEMO_NOT_VERIFIED")
    if data.get("code") not in {"SESSION_RUNNING", "SESSION_DRAINING", "SESSION_FINISHED", "SESSION_CLOSE_PENDING"}:
        raise ValueError("STRUCTURE_STATE_INVALID")
    out = {"code":"DEMO_STRUCTURE_STARTED" if started else data["code"], "account_type_verified":"demo",
           "symbol":"EURUSD", "period":"M1", "volume":0.01, "max_attempts":3, "max_session_minutes":30}
    for field in ("open_attempts", "entry_deals", "exit_deals", "open_positions", "elapsed_seconds", "last_retcode"):
        val = data.get(field)
        if type(val) is not int or val < 0:
            raise ValueError("STRUCTURE_COUNTER_INVALID")
        out[field] = val
    if out["open_attempts"] > 3 or out["open_positions"] > 1:
        raise ValueError("STRUCTURE_LIMIT_EXCEEDED")
    val = data.get("net_recorded")
    if type(val) not in (int, float) or not math.isfinite(val):
        raise ValueError("STRUCTURE_RESULT_INVALID")
    out["net_recorded"] = val
    return out


def session_paths(root, api):
    terminal = api.owned_terminal(root)
    manifest = Path(root) / "structure-session.json"
    api.require(manifest.is_file(), "NO_M1_SESSION")
    data = json.loads(manifest.read_text(encoding="utf-8"))
    job_id = data.get("id", "")
    api.require(isinstance(job_id,str) and re.fullmatch(r"[A-Za-z0-9_-]{1,64}",job_id), "INVALID_LOCAL_SESSION")
    stem = "OLFX_M1_" + job_id
    api.require(data.get("stem") == stem, "INVALID_LOCAL_SESSION")
    return terminal / "MQL5" / "Files" / (stem + ".json")


def session_status(root, api):
    path = session_paths(root, api)
    api.require(path.is_file() and path.stat().st_size < 16384, "M1_STATE_NOT_AVAILABLE")
    raw = json.loads(path.read_text(encoding="utf-8-sig"))
    try:
        manifest = json.loads((Path(root) / "structure-session.json").read_text(encoding="utf-8"))
        if manifest.get("kind") == "gold":
            from demo_gold import verified_gold
            value = verified_gold(raw, manifest.get("gold_config"))
        else:
            value = verified_session(raw)
    except ValueError as exc:
        raise api.BridgeError(str(exc)) from None
    value["snapshot_fresh"] = 0 <= time.time() - path.stat().st_mtime <= 5
    # This is the last recorded state, not proof the EA is currently alive.
    return value


def cancel_session(root, api):
    from gold_scalp import stop
    stop(root)
    if not (Path(root) / "structure-session.json").is_file():
        return
    path = session_paths(root, api)
    path.with_name(path.name + ".cancel").touch()

