"""Start the guarded M1 worker inside the original Bridge console."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid


def status(root):
    path = Path(root) / "gold-scalp-m1" / "health.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        data["snapshot_fresh"] = 0 <= time.time()-data["updated_at"] <= 10
        if not data["snapshot_fresh"]:
            data.update(ready=False, quote_fresh=False, last_worker_code=data.get("code"),
                        code="STRATEGY_HEALTH_STALE")
        return data
    except (OSError, ValueError, KeyError, TypeError):
        return None


def stop(root):
    from strategy_service import set_enabled
    set_enabled(root, False)
    folder = Path(root) / "gold-scalp-m1"
    if folder.exists():
        (folder / "STOP").touch()


def worker_locked(folder):
    import msvcrt
    path = Path(folder) / "agent.lock"
    if not path.is_file():
        return False
    with path.open("r+b") as stream:
        stream.seek(0)
        try:
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            return True
        stream.seek(0)
        msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        return False


def start(job, root, api):
    root = Path(root)
    folder = root / "gold-scalp-m1"
    folder.mkdir(parents=True, exist_ok=True)
    current = status(root)
    if worker_locked(folder):
        api.require(current is not None and current.get("snapshot_fresh"), "SCALP_WORKER_RECONCILE_FIRST")
        # A stop marker must not be silently cleared while old positions remain managed.
        api.require(not (folder / "STOP").exists(), "SCALP_PAUSED_WAIT_SL_TP")
        from strategy_service import set_enabled
        set_enabled(root, True)
        return {**current, "code": "DEMO_GOLD_SCALP_ALREADY_RUNNING"}
    # The bounded legacy EA must finish before the new continuous strategy starts.
    manifest = root / "structure-session.json"
    if manifest.is_file():
        from demo_structure import session_paths
        path = session_paths(root, api)
        api.require(path.is_file(), "LEGACY_SESSION_STATE_UNAVAILABLE")
        previous = json.loads(path.read_text(encoding="utf-8-sig"))
        api.require(previous.get("code") == "SESSION_FINISHED" and previous.get("open_positions") == 0,
                    "LEGACY_SESSION_ACTIVE_WAIT_SL_TP")
    candidates = [Path(sys.executable), root / "resident-v2" / "venv" / "Scripts" / "python.exe"]
    python = None
    for candidate in candidates:
        if candidate.is_file():
            check = subprocess.run([str(candidate), "-c", "import MetaTrader5"], stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, timeout=15)
            if check.returncode == 0:
                python = candidate
                break
    api.require(python is not None, "MT5_PYTHON_PACKAGE_NOT_AVAILABLE")
    (folder / "STOP").unlink(missing_ok=True)
    nonce = uuid.uuid4().hex
    script = Path(__file__).resolve().with_name("gold_scalp_runner.py")
    process = subprocess.Popen([str(python), str(script)], cwd=script.parent,
                               env=dict(os.environ, OLFX_SCALP_NONCE=nonce),
                               creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
    deadline = time.monotonic()+75
    while time.monotonic() < deadline:
        current = status(root)
        if current and current.get("nonce") == nonce and current.get("snapshot_fresh"):
            if current.get("account_type_verified") == "demo":
                from strategy_service import set_enabled
                set_enabled(root, True)
                return {**current, "code": "DEMO_GOLD_SCALP_STARTED"}
            if process.poll() is not None or not current.get("ready"):
                raise api.BridgeError(current.get("code", "SCALP_START_FAILED"))
        if process.poll() is not None:
            raise api.BridgeError("SCALP_START_FAILED_CHECK_CMD")
        time.sleep(.5)
    # A slow first attach is stopped from accepting entries, without liquidating positions.
    stop(root)
    raise api.BridgeError("SCALP_START_NOT_CONFIRMED")

