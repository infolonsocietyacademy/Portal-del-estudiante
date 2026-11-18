"""Bounded paper-trade demonstration; only the pinned demo-only EA may run."""
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import time
from trade_logs import log_stem

DEMO_SOURCE_SHA256 = "4874cf8af676bf607b510f11075907d87b8e837467e65c4258ff32b2f6107370"
FINAL_SUCCESS = "DEMO_ROUNDTRIP_CLOSED"
FAILURE_CODES = {
    "DEMO_CONNECTION_UNAVAILABLE", "DEMO_ACCOUNT_GUARD_BLOCKED", "DEMO_OPEN_NOT_CONFIRMED",
    "DEMO_POSITION_NO_LONGER_OPEN", "DEMO_CANCELLED_BEFORE_OPEN", "DEMO_TRADING_PERMISSION_BLOCKED",
    "DEMO_STATE_FILE_UNAVAILABLE", "DEMO_HISTORY_UNAVAILABLE",
}


def build_demo_files(job_id, local_demo):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", job_id):
        raise ValueError("INVALID_TASK_ID")
    login = str(local_demo.get("login", ""))
    server = str(local_demo.get("server", ""))
    if not re.fullmatch(r"[0-9]{1,20}", login) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,100}", server) or "demo" not in server.lower():
        raise ValueError("INVALID_LOCAL_DEMO")
    stem = "OLFX_DEMO_" + job_id
    magic = int(hashlib.sha256(job_id.encode()).hexdigest()[:12], 16) or 1
    ini = ("[Common]\nLogin=" + login + "\nServer=" + server +
        "\n[Experts]\nEnabled=1\nAllowLiveTrading=1\nAllowDllImport=0\nAccount=1\nProfile=1\n" +
        "[StartUp]\nExpert=OLFX\\" + stem + "\nSymbol=EURUSD\nPeriod=M1\nExpertParameters=" + stem + ".set\n")
    parameters = ("ExpectedDemoLogin=" + login + "\nExpectedDemoServer=" + server +
        "\nTaskMagic=" + str(magic) + "\nResultFile=" + stem + ".json\nTradeLogStem=" + log_stem(local_demo) + "\n")
    return {"stem": stem, "magic": magic, "ini": ini, "parameters": parameters}


def verified_result(data):
    if not isinstance(data, dict) or type(data.get("schema")) is not int or data.get("schema") != 1:
        raise ValueError("DEMO_INVALID_RESULT")
    if data.get("code") != FINAL_SUCCESS:
        raise ValueError("DEMO_NOT_CLOSED")
    if any(data.get(k) is not True for k in ("demo_verified", "opened", "closed")):
        raise ValueError("DEMO_GUARD_OR_CLOSE_NOT_CONFIRMED")
    if type(data.get("volume")) not in (int, float) or not math.isfinite(data["volume"]) or abs(data["volume"] - 0.01) > 0.00000001:
        raise ValueError("DEMO_INVALID_VOLUME")
    result = {"code": FINAL_SUCCESS, "account_type_verified": "demo", "symbol": "EURUSD", "volume": 0.01, "opened": True, "closed": True}
    for field in ("open_price", "close_price", "profit"):
        value = data.get(field)
        if field == "profit" and data.get("profit_known") is not True:
            continue
        if type(value) in (int, float) and math.isfinite(value):
            result[field] = value
    if type(data.get("retcode")) is int and data["retcode"] in (10009, 10010):
        result["retcode"] = data["retcode"]
    else:
        raise ValueError("DEMO_CLOSE_RETCODE_NOT_CONFIRMED")
    return result


def execute_demo_roundtrip(job, root, api, structure=False, gold=False, gold_once=False):
    root = Path(root)
    terminal = api.owned_terminal(root)
    api.require(not api.processes_in(terminal), "TEST_TERMINAL_BUSY")
    api.resource_check(root)
    demo = api.local_demo_from_logs(terminal)
    source_name, expected_hash = "OLFX_DemoRoundtrip.mq5", DEMO_SOURCE_SHA256
    builder = build_demo_files
    gold_config = None
    if gold:
        from demo_gold import GOLD_SOURCE_HASH, build_gold_files
        from gold_settings import load_gold_settings
        try:
            gold_config = load_gold_settings(root)
        except ValueError as exc:
            raise api.BridgeError(str(exc)) from None
        source_name, expected_hash = "OLFX_DemoGold.mq5", GOLD_SOURCE_HASH
        builder = lambda jid, account: build_gold_files(jid, account, gold_config)
        if gold_once:
            from gold_once import GOLD_ONCE_HASH
            source_name, expected_hash = "OLFX_GoldOneMinute.mq5", GOLD_ONCE_HASH
    if structure:
        from demo_structure import SOURCE_HASH, build_structure_files
        source_name, expected_hash, builder = "OLFX_DemoStructure.mq5", SOURCE_HASH, build_structure_files
    source = Path(__file__).resolve().parent / "demo" / source_name
    api.require(source.is_file(), "DEMO_SOURCE_MISSING")
    raw = source.read_bytes()
    api.require(hashlib.sha256(raw).hexdigest() == expected_hash, "DEMO_SOURCE_HASH_MISMATCH")
    try:
        files = builder(job["id"], demo)
    except ValueError as exc:
        raise api.BridgeError(str(exc)) from None
    data_dir = terminal / "MQL5" / "Files"
    data_dir.mkdir(parents=True, exist_ok=True)
    result_file = data_dir / (files["stem"] + ".json")
    attempted_file = data_dir / (files["stem"] + ".json.attempted")
    cancel_file = data_dir / (files["stem"] + ".json.cancel")
    api.require(not result_file.exists() and not attempted_file.exists(), "DEMO_TASK_ALREADY_ATTEMPTED")
    folder = terminal / "MQL5" / "Experts" / "OLFX"
    folder.mkdir(parents=True, exist_ok=True)
    ea = folder / (files["stem"] + ".mq5")
    ea.write_bytes(raw)
    ea.with_suffix(".ex5").unlink(missing_ok=True)
    ea.with_suffix(".log").unlink(missing_ok=True)
    api.run_process([str(terminal / "metaeditor64.exe"), "/portable", "/compile:" + str(ea), "/include:" + str(terminal / "MQL5"), "/log"], root, terminal, 180)
    log = api.decode_text(ea.with_suffix(".log").read_bytes()) if ea.with_suffix(".log").exists() else ""
    api.require(ea.with_suffix(".ex5").is_file() and re.search(r"\b0 errors?\b", log, re.I), "DEMO_COMPILE_FAILED_SEE_LOCAL_LOG")
    api.require(not api.processes_in(terminal), "TEST_TERMINAL_BUSY")
    run_dir = root / "runs" / job["id"]
    run_dir.mkdir(parents=True, exist_ok=True)
    ini = run_dir / "demo.ini"
    ini.write_text(files["ini"], encoding="utf-16")
    # Start an empty dedicated profile, not any charts/EAs saved by the user.
    profile_name = "OLFXDemo_" + job["id"]
    profile_dir = terminal / "MQL5" / "Profiles" / "Charts" / profile_name
    api.require(not profile_dir.exists(), "DEMO_PROFILE_ALREADY_EXISTS")
    profile_dir.mkdir(parents=True)
    (profile_dir / "order.wnd").write_text("", encoding="utf-16")
    presets = terminal / "MQL5" / "Presets"
    presets.mkdir(parents=True, exist_ok=True)
    (presets / (files["stem"] + ".set")).write_text(files["parameters"], encoding="utf-16")
    try:
        subprocess.Popen([sys.executable, str(Path(api.__file__).resolve()), "logs"], cwd=Path(__file__).resolve().parent,
            creationflags=0x10)
    except OSError:
        pass  # VER_OPERACIONES.cmd remains available if a second console cannot open.
    if structure or gold:
        manifest = {"id":job["id"], "stem":files["stem"]}
        if gold:
            manifest.update(kind="gold", gold_config=gold_config)
        api.atomic_json(root / "structure-session.json", manifest)
    # This path was ownership checked; no image-name termination or arbitrary command.
    process = subprocess.Popen([str(terminal / "terminal64.exe"), "/portable", "/profile:" + profile_name, "/config:" + str(ini)], cwd=terminal,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=0x4000)
    deadline = time.monotonic() + 180
    latest = {}
    print("DEMO: compra de oro; cierre solicitado tras 60 segundos." if gold_once else ("DEMO: esperando estructura M1." if structure or gold else "DEMO: se abre EURUSD. Cuenta demo verificada por el EA antes de cada envio."), flush=True)
    try:
        while time.monotonic() < deadline:
            if (root / "STOP").exists():
                cancel_file.touch()
            if result_file.is_file() and result_file.stat().st_size < 16384:
                try:
                    latest = json.loads(result_file.read_text(encoding="utf-8-sig"))
                except (ValueError, OSError):
                    latest = {}
                if (structure or gold) and latest.get("code") in {"SESSION_RUNNING", "SESSION_DRAINING", "SESSION_FINISHED"}:
                    from demo_structure import verified_session
                    try:
                        if gold:
                            if gold_once:
                                if latest["code"] != "SESSION_FINISHED":
                                    time.sleep(0.5)
                                    continue
                                from gold_once import verified_gold_once
                                return verified_gold_once(latest, gold_config)
                            from demo_gold import verified_gold
                            return verified_gold(latest, gold_config, started=True)
                        return verified_session(latest, started=True)
                    except ValueError as exc:
                        raise api.BridgeError(str(exc)) from None
                if latest.get("code") == FINAL_SUCCESS:
                    try:
                        return verified_result(latest)
                    except ValueError as exc:
                        raise api.BridgeError(str(exc)) from None
                if latest.get("code") in FAILURE_CODES:
                    raise api.BridgeError(latest["code"], {"opened": latest.get("opened") is True, "closed": latest.get("closed") is True})
            time.sleep(0.5)
    except KeyboardInterrupt:
        cancel_file.touch()
        raise
    # Keep the terminal open so a demo-only close timer can finish after a transient outage.
    cancel_file.touch()
    raise api.BridgeError("DEMO_RESULT_PENDING_CHECK_DEMO_TERMINAL", {"opened": latest.get("opened") is True, "closed": latest.get("closed") is True})

