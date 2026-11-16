"""OLFX MT5 BRIDGE 1.0. Python 3.10+, standard library only.

Outbound GitHub mailbox. No listener, shell commands, or live order API.
"""
import argparse
import base64
import ctypes
from ctypes import wintypes
from datetime import datetime, timezone
import getpass
import hashlib
from html.parser import HTMLParser
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

VERSION = "1.0.0"
REPO = "infolonsocietyacademy/Portal-del-estudiante"
BRANCH = "olfx-mt5-bridge"
DEVICE = "nolo-vps"
ACTIONS = {"ping", "diagnose", "compile", "backtest"}
ROOT = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "OLFX_MT5_BRIDGE"


class BridgeError(Exception):
    pass


def require(ok, code):
    if not ok:
        raise BridgeError(code)


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp, path)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def utc_date(text):
    require(isinstance(text, str), "INVALID_EXPIRY")
    try:
        result = datetime.fromisoformat(text.replace("Z", "+00:00"))
        require(result.tzinfo is not None, "INVALID_EXPIRY")
        return result
    except ValueError:
        raise BridgeError("INVALID_EXPIRY") from None


def validate_task(job, current=None):
    require(isinstance(job, dict), "INVALID_TASK")
    allowed = {"id", "action", "expires_at", "source_path", "source_ref", "source_sha256", "test"}
    require(not set(job) - allowed, "UNKNOWN_TASK_FIELD")
    require(re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", str(job.get("id", ""))), "INVALID_TASK_ID")
    require(job.get("action") in ACTIONS, "ACTION_NOT_ALLOWED")
    require(utc_date(job.get("expires_at")) > (current or datetime.now(timezone.utc)), "TASK_EXPIRED")
    if job["action"] in {"ping", "diagnose"}:
        require(set(job) <= {"id", "action", "expires_at"}, "UNEXPECTED_TASK_FIELD")
        return job
    require(re.fullmatch(r"bridge/eas/[A-Za-z0-9_-]{1,64}\.mq5", str(job.get("source_path", ""))), "INVALID_SOURCE_PATH")
    require(re.fullmatch(r"[0-9a-f]{40}", str(job.get("source_ref", ""))), "SOURCE_COMMIT_REQUIRED")
    require(re.fullmatch(r"[0-9a-f]{64}", str(job.get("source_sha256", ""))), "SOURCE_HASH_REQUIRED")
    if job["action"] == "compile":
        require("test" not in job, "UNEXPECTED_TEST")
        return job
    t = job.get("test")
    require(isinstance(t, dict), "TEST_REQUIRED")
    require(not set(t) - {"symbol", "period", "from", "to", "deposit", "currency", "leverage", "model", "inputs", "timeout_seconds"}, "UNKNOWN_TEST_FIELD")
    require(isinstance(t.get("symbol"), str) and re.fullmatch(r"[A-Za-z0-9_.#+-]{1,40}", t["symbol"]), "INVALID_SYMBOL")
    require(t.get("period") in {"M1", "M2", "M3", "M4", "M5", "M6", "M10", "M12", "M15", "M20", "M30", "H1", "H2", "H3", "H4", "H6", "H8", "H12", "D1", "W1", "MN1"}, "INVALID_PERIOD")
    try:
        start, end = [datetime.strptime(t[k], "%Y.%m.%d") for k in ("from", "to")]
    except (KeyError, ValueError, TypeError):
        raise BridgeError("INVALID_TEST_DATES") from None
    require(0 < (end - start).days <= 3660, "INVALID_TEST_RANGE")
    for key, default, low, high in (("deposit", 10000, 100, 10000000), ("leverage", 100, 1, 2000), ("timeout_seconds", 3600, 60, 7200)):
        val = t.get(key, default)
        require(type(val) in (int, float) and math.isfinite(val) and low <= val <= high, "INVALID_" + key.upper())
    require(type(t.get("leverage", 100)) is int and type(t.get("timeout_seconds", 3600)) is int, "INTEGER_REQUIRED")
    require(type(t.get("model", 4)) is int and t.get("model", 4) in (0, 1, 2, 3, 4), "INVALID_MODEL")
    require(re.fullmatch(r"[A-Z]{3}", str(t.get("currency", "USD"))), "INVALID_CURRENCY")
    inputs = t.get("inputs", {})
    require(isinstance(inputs, dict) and len(inputs) <= 100, "INVALID_INPUTS")
    for key, val in inputs.items():
        require(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", key), "INVALID_INPUT_NAME")
        require(type(val) in (str, int, float, bool), "INVALID_INPUT_VALUE")
        require(re.fullmatch(r"[A-Za-z0-9_.+ -]{1,64}", str(val)), "INVALID_INPUT_VALUE")
        if type(val) is float:
            require(math.isfinite(val), "INVALID_INPUT_VALUE")
    return job


class GitHub:
    def __init__(self, token):
        self.token = token

    def request(self, method, endpoint, payload=None):
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request("https://api.github.com/repos/" + REPO + endpoint, data=data, method=method,
            headers={"Authorization": "Bearer " + self.token, "Accept": "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "OLFX-MT5-BRIDGE/" + VERSION,
                     "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                raw = response.read(2000000)
                require(len(raw) < 2000000, "GITHUB_RESPONSE_TOO_LARGE")
                return json.loads(raw)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            raise BridgeError("GITHUB_HTTP_" + str(exc.code)) from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise BridgeError("GITHUB_NETWORK_ERROR") from None

    def get(self, path, ref=BRANCH):
        endpoint = "/contents/" + urllib.parse.quote(path, safe="/") + "?ref=" + urllib.parse.quote(ref, safe="")
        data = self.request("GET", endpoint)
        if data is None:
            return None
        require(isinstance(data, dict) and data.get("encoding") == "base64", "INVALID_GITHUB_FILE")
        require(data.get("size", 9999999) <= 700000, "GITHUB_FILE_TOO_LARGE")
        return base64.b64decode(data["content"]), data["sha"]

    def json(self, path):
        value = self.get(path)
        return json.loads(value[0]) if value else None

    def put(self, path, value):
        content = json.dumps(value, ensure_ascii=False, indent=2).encode()
        for attempt in range(3):
            old = self.get(path)
            payload = {"branch": BRANCH, "message": "OLFX bridge: " + path.rsplit("/", 1)[-1], "content": base64.b64encode(content).decode()}
            if old:
                payload["sha"] = old[1]
                if old[0] == content:
                    return
            try:
                require(self.request("PUT", "/contents/" + urllib.parse.quote(path, safe="/"), payload) is not None, "GITHUB_WRITE_FAILED")
                return
            except BridgeError as exc:
                if str(exc) != "GITHUB_HTTP_409" or attempt == 2:
                    raise


def dpapi(data, protect):
    require(os.name == "nt", "WINDOWS_REQUIRED")
    class Blob(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_byte))]
    buf = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_byte)))
    target = Blob()
    fn = ctypes.windll.crypt32.CryptProtectData if protect else ctypes.windll.crypt32.CryptUnprotectData
    fn.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    fn.restype = wintypes.BOOL
    require(fn(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)), "TOKEN_PROTECTION_FAILED")
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        ctypes.windll.kernel32.LocalFree.argtypes = [ctypes.c_void_p]
        ctypes.windll.kernel32.LocalFree(ctypes.cast(target.data, ctypes.c_void_p))


def owned_terminal(root):
    root = Path(root).resolve()
    config = json.loads((root / "settings.json").read_text(encoding="utf-8"))
    terminal = (root / "mt5-test").resolve()
    require(terminal.parent == root and terminal.name == "mt5-test", "UNSAFE_TERMINAL_PATH")
    marker = terminal / ".olfx-owned"
    require(marker.is_file() and marker.read_text().strip() == config["installation_id"], "TERMINAL_NOT_BRIDGE_OWNED")
    require((terminal / "terminal64.exe").is_file() and (terminal / "metaeditor64.exe").is_file(), "MT5_NOT_PREPARED")
    return terminal


def processes_in(folder):
    """Check only executables in the dedicated directory. Fail closed on unknown MT5 paths."""
    require(os.name == "nt", "WINDOWS_REQUIRED")
    class Entry(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("usage", wintypes.DWORD), ("pid", wintypes.DWORD),
            ("heap", ctypes.c_size_t), ("module", wintypes.DWORD), ("threads", wintypes.DWORD),
            ("parent", wintypes.DWORD), ("priority", wintypes.LONG), ("flags", wintypes.DWORD), ("exe", wintypes.WCHAR * 260)]
    k = ctypes.WinDLL("kernel32", use_last_error=True)
    k.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    k.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    k.Process32FirstW.argtypes = k.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(Entry)]
    k.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    k.OpenProcess.restype = wintypes.HANDLE
    k.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    k.CloseHandle.argtypes = [wintypes.HANDLE]
    snap = k.CreateToolhelp32Snapshot(2, 0)
    require(snap not in (0, ctypes.c_void_p(-1).value), "PROCESS_CHECK_FAILED")
    found = []
    try:
        entry = Entry()
        entry.size = ctypes.sizeof(entry)
        ok = k.Process32FirstW(snap, ctypes.byref(entry))
        while ok:
            if entry.exe.lower() in {"terminal64.exe", "metaeditor64.exe", "metatester64.exe"}:
                handle = k.OpenProcess(0x1000, False, entry.pid)
                require(handle, "CANNOT_VERIFY_MT5_PROCESS")
                try:
                    size = wintypes.DWORD(32768)
                    path = ctypes.create_unicode_buffer(size.value)
                    require(k.QueryFullProcessImageNameW(handle, 0, path, ctypes.byref(size)), "CANNOT_VERIFY_MT5_PROCESS")
                    if Path(path.value).resolve().parent == Path(folder).resolve():
                        found.append(entry.pid)
                finally:
                    k.CloseHandle(handle)
            ok = k.Process32NextW(snap, ctypes.byref(entry))
    finally:
        k.CloseHandle(snap)
    return found


def resource_check(root):
    require(shutil.disk_usage(root).free >= 5 * 1024**3, "LESS_THAN_5GB_FREE_DISK")
    class Mem(ctypes.Structure):
        _fields_ = [("length", wintypes.DWORD), ("load", wintypes.DWORD)] + [(name, ctypes.c_ulonglong) for name in
            ("total", "available", "page_total", "page_available", "virtual_total", "virtual_available", "extended")]
    m = Mem()
    m.length = ctypes.sizeof(m)
    require(ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m)), "MEMORY_CHECK_FAILED")
    require(m.available >= 3 * 1024**3, "LESS_THAN_3GB_FREE_RAM")


def run_process(args, root, cwd, timeout):
    require(os.name == "nt", "WINDOWS_REQUIRED")
    p = subprocess.Popen(args, cwd=cwd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=0x4000 | 0x200)  # Below normal priority; new process group.
    try:
        k = ctypes.windll.kernel32
        k.SetProcessAffinityMask.argtypes = [wintypes.HANDLE, ctypes.c_size_t]
        pmask, smask = ctypes.c_size_t(), ctypes.c_size_t()
        k.GetProcessAffinityMask.argtypes = [wintypes.HANDLE, ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(ctypes.c_size_t)]
        require(k.GetProcessAffinityMask(int(p._handle), ctypes.byref(pmask), ctypes.byref(smask)), "CPU_LIMIT_FAILED")
        allowed = [1 << i for i in range(ctypes.sizeof(ctypes.c_size_t) * 8) if pmask.value & (1 << i)]
        require(k.SetProcessAffinityMask(int(p._handle), sum(allowed[:2])), "CPU_LIMIT_FAILED")
        deadline = time.monotonic() + timeout
        while p.poll() is None:
            require(not (Path(root) / "STOP").exists(), "STOP_REQUESTED")
            require(time.monotonic() < deadline, "PROCESS_TIMEOUT")
            time.sleep(1)
        return p.returncode
    finally:
        if p.poll() is None:
            # Only this child PID and its descendants, never a process name.
            subprocess.run(["taskkill.exe", "/PID", str(p.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
            p.wait(timeout=20)


class ReportParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.cells, self.current, self.inside = [], [], False

    def handle_starttag(self, tag, attrs):
        if tag.lower() in ("td", "th"):
            self.inside, self.current = True, []

    def handle_data(self, text):
        if self.inside:
            self.current.append(text)

    def handle_endtag(self, tag):
        if tag.lower() in ("td", "th") and self.inside:
            self.cells.append(" ".join("".join(self.current).split()))
            self.inside = False


def decode_text(raw):
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw.decode("utf-16", errors="replace")
    return raw.decode("utf-8-sig", errors="replace")


def report_metrics(raw):
    parser = ReportParser()
    parser.feed(decode_text(raw))
    labels = {"total net profit": "net_profit", "beneficio neto": "net_profit", "beneficio neto total": "net_profit",
        "profit factor": "profit_factor", "factor de beneficio": "profit_factor", "total trades": "total_trades",
        "total de transacciones": "total_trades", "profit trades (% of total)": "winning_trades",
        "transacciones rentables (% del total)": "winning_trades", "equity drawdown maximal": "equity_drawdown_maximal",
        "equity drawdown relative": "equity_drawdown_relative", "reducción máxima de la equidad": "equity_drawdown_maximal",
        "balance drawdown maximal": "balance_drawdown_maximal", "expected payoff": "expected_payoff"}
    metrics = {}
    for i, cell in enumerate(parser.cells[:-1]):
        key = labels.get(cell.lower().rstrip(":").strip())
        value = parser.cells[i + 1]
        # Only explicitly recognized numeric cells. No account name, login, server or broker.
        if key and re.fullmatch(r"[-+0-9.,%() \u00a0]{1,80}", value) and re.search(r"\d", value):
            metrics[key] = value
    return metrics


def tester_ini(job):
    t, name = job["test"], "OLFX_" + job["id"]
    values = {"Expert": "OLFX\\" + name + ".ex5", "ExpertParameters": name + ".set",
        "Symbol": t["symbol"], "Period": t["period"], "Model": t.get("model", 4), "ExecutionMode": 0,
        "Optimization": 0, "FromDate": t["from"], "ToDate": t["to"], "ForwardMode": 0,
        "Deposit": t.get("deposit", 10000), "Currency": t.get("currency", "USD"), "Leverage": "1:" + str(t.get("leverage", 100)),
        "Report": "reports\\" + name + ".htm", "ReplaceReport": 1, "ShutdownTerminal": 1,
        "UseLocal": 1, "UseRemote": 0, "UseCloud": 0, "Visual": 0}
    return "[Experts]\nEnabled=0\nAllowLiveTrading=0\nAllowDllImport=0\n[Tester]\n" + "\n".join(str(k) + "=" + str(v) for k, v in values.items()) + "\n"


def execute(job, root, gh):
    if job["action"] == "ping":
        return {"code": "PONG", "version": VERSION}
    if job["action"] == "diagnose":
        try:
            terminal = owned_terminal(root)
            busy = bool(processes_in(terminal))
            resource_check(root)
            return {"code": "MT5_READY" if not busy else "TEST_TERMINAL_BUSY", "mt5_prepared": True, "test_terminal_busy": busy}
        except BridgeError as exc:
            return {"code": str(exc), "mt5_prepared": (root / "mt5-test" / ".olfx-owned").exists()}
    terminal = owned_terminal(root)
    require(not processes_in(terminal), "TEST_TERMINAL_BUSY")
    resource_check(root)
    source = gh.get(job["source_path"], job["source_ref"])
    require(source is not None, "SOURCE_NOT_FOUND")
    require(len(source[0]) <= 262144 and hashlib.sha256(source[0]).hexdigest() == job["source_sha256"], "SOURCE_HASH_MISMATCH")
    folder = terminal / "MQL5" / "Experts" / "OLFX"
    folder.mkdir(parents=True, exist_ok=True)
    ea = folder / ("OLFX_" + job["id"] + ".mq5")
    ea.write_bytes(source[0])
    ex5, log = ea.with_suffix(".ex5"), ea.with_suffix(".log")
    ex5.unlink(missing_ok=True)
    log.unlink(missing_ok=True)
    run_process([str(terminal / "metaeditor64.exe"), "/portable", "/compile:" + str(ea), "/include:" + str(terminal / "MQL5"), "/log"], root, terminal, 180)
    compile_text = decode_text(log.read_bytes()) if log.exists() else ""
    require(ex5.is_file() and ex5.stat().st_size > 0 and re.search(r"\b0 errors?\b", compile_text, re.I), "COMPILE_FAILED_SEE_LOCAL_LOG")
    if job["action"] == "compile":
        return {"code": "COMPILED", "source_sha256": job["source_sha256"]}
    require(not processes_in(terminal), "TEST_TERMINAL_BUSY")
    run_dir = root / "runs" / job["id"]
    run_dir.mkdir(parents=True, exist_ok=True)
    ini = run_dir / "tester.ini"
    ini.write_text(tester_ini(job), encoding="utf-16")
    profiles = terminal / "MQL5" / "Profiles" / "Tester"
    profiles.mkdir(parents=True, exist_ok=True)
    def input_string(v):
        return str(v).lower() if type(v) is bool else str(v)
    (profiles / (ea.stem + ".set")).write_text("\n".join(k + "=" + input_string(v) for k, v in job["test"].get("inputs", {}).items()) + "\n", encoding="utf-16")
    report = terminal / "reports" / (ea.stem + ".htm")
    report.parent.mkdir(parents=True, exist_ok=True)
    report.unlink(missing_ok=True)
    run_process([str(terminal / "terminal64.exe"), "/portable", "/config:" + str(ini)], root, terminal, job["test"].get("timeout_seconds", 3600))
    require(report.is_file() and report.stat().st_size > 100, "NO_TEST_REPORT_SEE_LOCAL_MT5_LOGS")
    require(report.stat().st_size <= 50000000, "REPORT_TOO_LARGE")
    raw = report.read_bytes()
    shutil.copy2(report, run_dir / "report.htm")
    return {"code": "BACKTEST_FINISHED", "local_report_available": True, "metrics": report_metrics(raw), "report_sha256": hashlib.sha256(raw).hexdigest()}


def process_queue(root, gh):
    root = Path(root)
    # Always drain saved results first. Never re-execute because an upload failed.
    for pending in sorted((root / "outbox").glob("*.json")):
        result = json.loads(pending.read_text(encoding="utf-8"))
        gh.put("bridge/results/" + DEVICE + "/" + result["id"] + ".json", result)
        atomic_json(root / "state" / (result["id"] + ".json"), result)
        pending.unlink()
    control = gh.json("bridge/control/" + DEVICE + ".json")
    require(isinstance(control, dict) and control.get("schema") == 1 and control.get("device") == DEVICE, "INVALID_CONTROL")
    require(type(control.get("enabled")) is bool, "INVALID_CONTROL")
    if not control["enabled"]:
        return
    jobs = control.get("jobs")
    require(isinstance(jobs, list) and len(jobs) <= 100, "INVALID_QUEUE")
    ids = [j.get("id") for j in jobs if isinstance(j, dict)]
    require(all(isinstance(i, str) for i in ids) and len(ids) == len(set(ids)), "DUPLICATE_TASK_ID")
    for job in jobs:
        if (root / "STOP").exists():
            return
        require(isinstance(job, dict) and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", str(job.get("id", ""))), "INVALID_TASK_ID")
        jid, fingerprint = job["id"], digest(job)
        statefile = root / "state" / (jid + ".json")
        if statefile.exists():
            saved = json.loads(statefile.read_text(encoding="utf-8"))
            require(saved["task_sha256"] == fingerprint, "TASK_ID_REUSED_WITH_DIFFERENT_CONTENT")
            if saved["status"] != "running":
                continue
            result = {"schema": 1, "id": jid, "task_sha256": fingerprint, "status": "failed", "code": "INTERRUPTED_MANUAL_NEW_TASK_REQUIRED", "finished_at": now()}
        else:
            remote = gh.json("bridge/results/" + DEVICE + "/" + jid + ".json")
            if remote:
                require(remote.get("task_sha256") == fingerprint, "TASK_ID_REUSED_WITH_DIFFERENT_CONTENT")
                atomic_json(statefile, remote)
                continue
            result = {"schema": 1, "id": jid, "task_sha256": fingerprint, "status": "running", "started_at": now()}
            atomic_json(statefile, result)
            try:
                validate_task(job)
                result.update(execute(job, root, gh))
                result["status"] = "succeeded"
            except BridgeError as exc:
                result.update(status="failed", code=str(exc))
            except KeyboardInterrupt:
                result.update(status="failed", code="INTERRUPTED_MANUAL_NEW_TASK_REQUIRED")
                raise
            except Exception:
                # Never publish an exception message: it may contain paths or credentials.
                result.update(status="failed", code="LOCAL_ERROR_SEE_AGENT_WINDOW")
            result["finished_at"] = now()
        atomic_json(root / "outbox" / (jid + ".json"), result)
        atomic_json(statefile, result)
        gh.put("bridge/results/" + DEVICE + "/" + jid + ".json", result)
        (root / "outbox" / (jid + ".json")).unlink()
        print(jid + ": " + result["code"], flush=True)


def setup():
    require(os.name == "nt", "WINDOWS_REQUIRED")
    ROOT.mkdir(parents=True, exist_ok=True)
    if (ROOT / "settings.json").exists():
        print("Configuracion existente conservada. Usa INICIAR_BRIDGE.cmd.")
        return
    print("OLFX MT5 BRIDGE - Configuracion inicial\nRepositorio: " + REPO + "\nRama: " + BRANCH)
    print("GitHub > Settings > Developer settings > Personal access tokens > Fine-grained tokens.")
    print("Selecciona SOLO Portal-del-estudiante. Contents: Read and write. Expiracion: 30 dias.")
    print("Pega el token aqui; queda protegido para tu usuario Windows. No lo envies al chat.")
    token = getpass.getpass("Token GitHub (no se muestra): ").strip()
    require(bool(token), "TOKEN_REQUIRED")
    gh = GitHub(token)
    require(gh.get("bridge/control/" + DEVICE + ".json") is not None, "BRIDGE_MAILBOX_NOT_FOUND_OR_TOKEN_NO_ACCESS")
    # Permission check before saving the secret or making a test terminal.
    gh.put("bridge/status/" + DEVICE + ".json", {"schema": 1, "version": VERSION, "state": "paired", "updated_at": now()})
    (ROOT / "token.dpapi").write_bytes(dpapi(token.encode(), True))
    import uuid
    atomic_json(ROOT / "settings.json", {"schema": 1, "installation_id": str(uuid.uuid4()), "repository": REPO, "branch": BRANCH, "device": DEVICE})
    print("Emparejado con GitHub. La conexion no necesita que MT5 este abierto.")
    print("Ejecuta INICIAR_BRIDGE.cmd. PREPARAR_MT5.cmd configura la terminal de pruebas aparte.")


def prepare_mt5():
    require(os.name == "nt", "WINDOWS_REQUIRED")
    settings = json.loads((ROOT / "settings.json").read_text(encoding="utf-8"))
    target = ROOT / "mt5-test"
    if target.exists():
        owned_terminal(ROOT)
        print("Terminal de pruebas ya preparada. Se conserva sin sobrescribirla.")
        return
    print("Copia separada para pruebas. Solo se copian ejecutables e includes; no cuentas ni configuraciones.")
    guess = r"C:\Program Files\Axi MetaTrader 5 Terminal\terminal64.exe"
    value = input("Ruta de terminal64.exe [" + guess + "]: ").strip().strip('"') or guess
    source = Path(value).resolve()
    require(source.name.lower() == "terminal64.exe" and source.is_file(), "MT5_SOURCE_NOT_FOUND")
    require(ROOT.resolve() not in source.parents, "INVALID_SOURCE_DIRECTORY")
    for name in ("terminal64.exe", "metaeditor64.exe", "metatester64.exe"):
        require((source.parent / name).is_file(), "MISSING_MT5_EXECUTABLE_" + name)
    staging = ROOT / "mt5-staging"
    require(not staging.exists(), "STAGING_EXISTS_REVIEW_LOCAL_FOLDER")
    staging.mkdir()
    try:
        for name in ("terminal64.exe", "metaeditor64.exe", "metatester64.exe"):
            shutil.copy2(source.parent / name, staging / name)
        includes = source.parent / "MQL5" / "Include"
        if includes.is_dir():
            shutil.copytree(includes, staging / "MQL5" / "Include")
        (staging / ".olfx-owned").write_text(settings["installation_id"], encoding="utf-8")
        staging.rename(target)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    print("MT5 de pruebas preparado en: " + str(target))
    print("ABRIR_MT5_PRUEBAS.cmd lo abre en modo portable. Conecta una DEMO para descargar datos; luego cierra SOLO esa copia.")


def singleton(root):
    import msvcrt
    f = (root / "agent.lock").open("a+b")
    f.seek(0)
    f.write(b"0")
    f.flush()
    f.seek(0)
    try:
        msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        f.close()
        raise BridgeError("AGENT_ALREADY_RUNNING") from None
    return f


def main():
    p = argparse.ArgumentParser()
    p.add_argument("mode", choices=["setup", "run", "prepare-mt5", "open-mt5", "stop", "rotate-token"])
    args = p.parse_args()
    if args.mode == "setup":
        setup()
        return
    require(os.name == "nt", "WINDOWS_REQUIRED")
    require((ROOT / "settings.json").is_file(), "RUN_CONFIGURAR_FIRST")
    if args.mode == "prepare-mt5":
        prepare_mt5()
        return
    if args.mode == "rotate-token":
        token = getpass.getpass("Nuevo token GitHub (no se muestra): ").strip()
        require(bool(token), "TOKEN_REQUIRED")
        gh = GitHub(token)
        require(gh.get("bridge/control/" + DEVICE + ".json"), "TOKEN_NO_ACCESS")
        gh.put("bridge/status/" + DEVICE + ".json", {"schema": 1, "version": VERSION, "state": "token_rotated", "updated_at": now()})
        (ROOT / "token.dpapi").write_bytes(dpapi(token.encode(), True))
        print("Token actualizado. Reinicia el agente.")
        return
    if args.mode == "stop":
        (ROOT / "STOP").touch()
        print("Parada solicitada. El agente se detendra; una prueba activa se cancela.")
        return
    if args.mode == "open-mt5":
        terminal = owned_terminal(ROOT)
        require(not processes_in(terminal), "TEST_TERMINAL_BUSY")
        cfg = ROOT / "manual-demo.ini"
        cfg.write_text("[Experts]\nEnabled=0\nAllowLiveTrading=0\nAllowDllImport=0\n", encoding="utf-16")
        subprocess.Popen([str(terminal / "terminal64.exe"), "/portable", "/config:" + str(cfg)], cwd=terminal)
        print("Abierta SOLO la terminal de pruebas. Usa una DEMO y cierrala antes de pedir backtests.")
        return
    lock = singleton(ROOT)
    (ROOT / "STOP").unlink(missing_ok=True)
    gh = GitHub(dpapi((ROOT / "token.dpapi").read_bytes(), False).decode())
    heartbeat = 0
    print("BRIDGE ACTIVO: espera tareas de GitHub. Cierra con Ctrl+C o DETENER_BRIDGE.cmd.", flush=True)
    try:
        while not (ROOT / "STOP").exists():
            try:
                if time.monotonic() >= heartbeat:
                    gh.put("bridge/status/" + DEVICE + ".json", {"schema": 1, "version": VERSION, "state": "online", "updated_at": now()})
                    heartbeat = time.monotonic() + 300
                process_queue(ROOT, gh)
            except (BridgeError, ValueError, KeyError) as exc:
                print("Reintentando en 60 s: " + (str(exc) if isinstance(exc, BridgeError) else "INVALID_REMOTE_DATA"), flush=True)
            for _ in range(60):
                if (ROOT / "STOP").exists():
                    break
                time.sleep(1)
    finally:
        try:
            gh.put("bridge/status/" + DEVICE + ".json", {"schema": 1, "version": VERSION, "state": "stopped", "updated_at": now()})
        except Exception:
            pass
        lock.close()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Bridge detenido.")
        sys.exit(130)
    except BridgeError as exc:
        print("ERROR: " + str(exc))
        sys.exit(1)
    except Exception:
        print("ERROR LOCAL. Verifica configuracion, permisos y rutas. No se publicaron datos privados.")
        sys.exit(1)
