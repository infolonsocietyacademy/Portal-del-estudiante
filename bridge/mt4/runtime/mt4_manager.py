"""Bounded MT4 file management. No terminal launch, orders or trading toggles.

Discovery uses MetaQuotes origin.txt and running terminal.exe paths. Credentials,
account databases, raw logs and command lines never leave this module.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import time
import uuid

VERSION = "1.0.40"
ACTIONS = {"mt4_discover", "mt4_attach", "mt4_status", "mt4_read_preset",
           "mt4_edit_preset", "mt4_install_file"}
PRIVATE = re.compile(r"password|passwd|secret|token|credential|api.?key|login|account|email|licen[cs]e|serial|activation", re.I)
BASE_FIELDS = {"id", "action", "expires_at"}


class MT4Error(Exception):
    pass


def require(ok, code):
    if not ok:
        raise MT4Error(code)


def safe_path(path):
    path = Path(path).absolute()
    for p in (path, *path.parents):
        if p.exists() or p.is_symlink():
            require(not p.is_symlink() and not (getattr(p.stat(), "st_file_attributes", 0) & 0x400), "MT4_LINK_BLOCKED")
    return path.resolve()


def safe_name(name, suffix):
    require(isinstance(name, str) and 1 <= len(name) <= 120 and
            re.fullmatch(r"[A-Za-z0-9_ ()+.,-]+", name) and name.endswith(suffix) and
            not name.startswith(".") and not name.endswith((".", " ")), "MT4_FILENAME_INVALID")
    require(not re.match(r"(?i)^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", name), "MT4_FILENAME_INVALID")
    return name


def validate_job(job):
    require(isinstance(job, dict) and job.get("action") in ACTIONS, "MT4_ACTION_INVALID")
    extra = {"mt4_attach": {"candidate_id"}, "mt4_read_preset": {"filename"},
             "mt4_edit_preset": {"filename", "expected_sha256", "changes"},
             "mt4_install_file": {"filename", "source_path", "source_ref", "source_sha256", "expected_sha256"}}
    require(set(job) == BASE_FIELDS | extra.get(job["action"], set()), "MT4_UNEXPECTED_FIELD")
    if job["action"] == "mt4_attach":
        require(isinstance(job["candidate_id"], str) and re.fullmatch(r"[a-f0-9]{16}", job["candidate_id"]), "MT4_CANDIDATE_INVALID")
    if job["action"] in {"mt4_read_preset", "mt4_edit_preset"}:
        safe_name(job["filename"], ".set")
    if job["action"] == "mt4_edit_preset":
        require(re.fullmatch(r"[a-f0-9]{64}", str(job["expected_sha256"])), "MT4_EXPECTED_HASH_REQUIRED")
        changes = job["changes"]
        require(isinstance(changes, dict) and 0 < len(changes) <= 100, "MT4_CHANGES_INVALID")
        for key, value in changes.items():
            require(isinstance(key, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", key) and not PRIVATE.search(key), "MT4_INPUT_BLOCKED")
            require(type(value) in (str, int, float, bool) and len(str(value)) <= 128 and
                    re.fullmatch(r"[A-Za-z0-9_ .,+:-]*", str(value)), "MT4_INPUT_VALUE_INVALID")
            require(type(value) is not float or math.isfinite(value), "MT4_INPUT_VALUE_INVALID")
    if job["action"] == "mt4_install_file":
        suffix = Path(str(job["filename"])).suffix
        require(suffix in {".ex4", ".set"}, "MT4_FILE_TYPE_BLOCKED")
        safe_name(job["filename"], suffix)
        require(re.fullmatch(r"bridge/mt4/assets/[A-Za-z0-9_-]{1,80}\.(ex4|set)", str(job["source_path"])) and
                Path(job["source_path"]).suffix == suffix, "MT4_SOURCE_PATH_INVALID")
        require(re.fullmatch(r"[a-f0-9]{40}", str(job["source_ref"])), "MT4_SOURCE_COMMIT_REQUIRED")
        require(re.fullmatch(r"[a-f0-9]{64}", str(job["source_sha256"])), "MT4_SOURCE_HASH_REQUIRED")
        require(job["expected_sha256"] is None or re.fullmatch(r"[a-f0-9]{64}", str(job["expected_sha256"])), "MT4_EXPECTED_HASH_INVALID")
    return job


def read_json(path, default=None):
    p = safe_path(path)
    if not p.exists():
        return default
    require(p.stat().st_size < 1000000, "MT4_STATE_TOO_LARGE")
    return json.loads(p.read_text(encoding="utf-8"))


def write_json(path, value):
    atomic_bytes(path, json.dumps(value, ensure_ascii=False, allow_nan=False).encode())


def atomic_bytes(path, raw):
    p = safe_path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with tmp.open("xb") as f:
            f.write(raw)
        os.replace(tmp, p)
    finally:
        tmp.unlink(missing_ok=True)


def state_dir(root):
    return safe_path(Path(root) / "mt4-management")


def decode(raw):
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw.decode("utf-16"), "utf-16"
    try:
        return raw.decode("utf-8-sig"), "utf-8-sig" if raw.startswith(b"\xef\xbb\xbf") else "utf-8"
    except UnicodeDecodeError:
        return raw.decode("cp1252"), "cp1252"


def running_terminals():
    if os.name != "nt":
        return []
    script = "Get-CimInstance Win32_Process -Filter \"Name='terminal.exe'\" | Select-Object ExecutablePath,CommandLine | ConvertTo-Json -Compress"
    try:
        p = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
                           capture_output=True, timeout=12, creationflags=0x08000000)
        require(p.returncode == 0 and len(p.stdout) < 262144, "MT4_PROCESS_QUERY_FAILED")
        text = p.stdout.decode("utf-8-sig").strip()
        rows = json.loads(text) if text else []
        return rows if isinstance(rows, list) else [rows]
    except (OSError, ValueError, subprocess.TimeoutExpired):
        raise MT4Error("MT4_PROCESS_QUERY_FAILED") from None


def standard_bases():
    result = []
    if os.environ.get("APPDATA"):
        base = safe_path(Path(os.environ["APPDATA"]) / "MetaQuotes" / "Terminal")
        if base.is_dir():
            result.extend(p for p in base.iterdir() if p.is_dir())
    for name in ("ProgramFiles", "ProgramFiles(x86)"):
        if os.environ.get(name):
            base = safe_path(os.environ[name])
            if base.is_dir():
                result.extend(p for p in base.iterdir() if p.is_dir() and any(k in p.name.lower() for k in ("metatrader", "mt4")))
    return result


def discover(root, bases=None, processes=None):
    process_ok = True
    if processes is None:
        try:
            processes = running_terminals()
        except MT4Error:
            processes = []
            process_ok = False
    running = {}
    for row in processes:
        raw = row.get("ExecutablePath")
        if not raw:
            continue
        try:
            executable = safe_path(raw)
            if executable.name.lower() == "terminal.exe":
                running[str(executable.parent).casefold()] = {"path": executable.parent,
                    "portable": bool(re.search(r"(?:^|\s)/portable(?:\s|$)", row.get("CommandLine") or "", re.I))}
        except (OSError, MT4Error):
            continue
    roots = list(standard_bases() if bases is None else bases)
    roots.extend(row["path"] for row in running.values())
    found = {}
    for folder in roots[:500]:
        try:
            data = safe_path(folder)
            if not safe_path(data / "MQL4").is_dir():
                continue
            origin = safe_path(data / "origin.txt")
            install = data
            if origin.is_file() and origin.stat().st_size <= 4096:
                origin_text, _ = decode(origin.read_bytes())
                install = safe_path(origin_text.strip().strip("\x00").strip())
            exe = safe_path(install / "terminal.exe")
            if not exe.is_file():
                continue
            row = running.get(str(install).casefold())
            # A /portable process uses its install folder, never its AppData copy.
            active = bool(row and ((row["portable"] and data == install) or
                                   (not row["portable"] and data != install)))
            ident = hashlib.sha256(str(data).casefold().encode()).hexdigest()[:16]
            found[ident] = {"path": str(data), "installation": str(install), "running": bool(row),
                            "active_folder_verified": active, "label": install.name[:80]}
        except (OSError, UnicodeError, MT4Error):
            continue
    write_json(state_dir(root) / "candidates.json", found)
    result = {"code": "MT4_DISCOVERED" if found else "MT4_NOT_FOUND_ON_BRIDGE_COMPUTER",
              "candidates": [{"id": key, **{k: row[k] for k in ("label", "running", "active_folder_verified")}} for key, row in found.items()],
              "process_query_ok": process_ok}
    write_json(state_dir(root) / "discovery.json", result)
    return result


def bind(root, candidate):
    candidates = read_json(state_dir(root) / "candidates.json", {})
    require(candidate in candidates, "MT4_CANDIDATE_NOT_FOUND")
    row = candidates[candidate]
    target = safe_path(row["path"])
    require(safe_path(target / "MQL4").is_dir() and safe_path(Path(row["installation"]) / "terminal.exe").is_file(), "MT4_TERMINAL_UNAVAILABLE")
    write_json(state_dir(root) / "binding.json", {"candidate_id": candidate, **row})
    return {"code": "MT4_ATTACHED", "candidate_id": candidate, "label": row["label"]}


def target_dir(root):
    binding = read_json(state_dir(root) / "binding.json")
    require(binding is not None, "MT4_ATTACH_REQUIRED")
    target = safe_path(binding["path"])
    require(safe_path(target / "MQL4").is_dir() and safe_path(Path(binding["installation"]) / "terminal.exe").is_file(), "MT4_TERMINAL_UNAVAILABLE")
    return target


def file_path(root, filename):
    suffix = Path(filename).suffix
    require(suffix in {".ex4", ".set"}, "MT4_FILE_TYPE_BLOCKED")
    safe_name(filename, suffix)
    folder = target_dir(root) / "MQL4" / ("Experts" if suffix == ".ex4" else "Presets")
    return safe_path(folder / filename)


def inventory(folder, suffix, depth=0):
    folder = safe_path(folder)
    if not folder.is_dir():
        return []
    output = []
    for item in sorted(folder.iterdir())[:300]:
        try:
            item = safe_path(item)
            if item.is_file() and item.suffix.lower() == suffix and item.stat().st_size <= 1024 * 1024:
                raw = item.read_bytes()
                output.append({"filename": item.name, "size": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
            elif item.is_dir() and depth < 2:
                for row in inventory(item, suffix, depth + 1):
                    row["filename"] = item.name + "/" + row["filename"]
                    output.append(row)
        except (OSError, MT4Error):
            continue
        if len(output) >= 200:
            break
    return output[:200]


def status(root):
    binding = read_json(state_dir(root) / "binding.json")
    if not binding:
        return {"code": "MT4_ATTACH_REQUIRED", "attached": False,
                "discovery": read_json(state_dir(root) / "discovery.json", {})}
    target = target_dir(root)
    return {"code": "MT4_STATUS", "attached": True, "version": VERSION,
            "candidate_id": binding["candidate_id"], "label": binding["label"],
            "experts": inventory(target / "MQL4" / "Experts", ".ex4"),
            "presets": inventory(target / "MQL4" / "Presets", ".set"),
            "chart_settings_verified": False}


def preset(raw):
    require(len(raw) <= 65536, "MT4_PRESET_TOO_LARGE")
    text, encoding = decode(raw)
    require("\x00" not in text, "MT4_PRESET_INVALID")
    values = {}
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith((";", "#")):
            continue
        require("=" in line, "MT4_PRESET_INVALID")
        key, val = line.split("=", 1)
        key = key.strip()
        require(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*(?:,[F123])?", key), "MT4_PRESET_INVALID")
        require(key not in values, "MT4_PRESET_DUPLICATE_INPUT")
        values[key] = val
    require(values, "MT4_PRESET_EMPTY")
    return text, encoding, values


def read_preset(root, filename):
    path = file_path(root, filename)
    require(path.is_file(), "MT4_PRESET_NOT_FOUND")
    raw = path.read_bytes()
    _, _, values = preset(raw)
    return {"code": "MT4_PRESET_READ", "filename": filename,
            "sha256": hashlib.sha256(raw).hexdigest(),
            "inputs": {k: v for k, v in values.items() if not PRIVATE.search(k)},
            "private_inputs_omitted": sum(bool(PRIVATE.search(k)) for k in values),
            "loaded_in_chart_verified": False}


def replace_with_backup(root, path, raw, expected):
    old = path.read_bytes() if path.exists() else None
    require((old is None and expected is None) or
            (old is not None and expected is not None and hashlib.sha256(old).hexdigest() == expected), "MT4_FILE_CHANGED_OR_OVERWRITE_NOT_AUTHORIZED")
    backup_id = None
    if old is not None:
        backup_id = uuid.uuid4().hex
        backup = safe_path(state_dir(root) / "backups" / backup_id / path.name)
        atomic_bytes(backup, old)
    # Recheck after saving a backup; do not overwrite intervening local edits.
    current = path.read_bytes() if path.exists() else None
    require(current == old, "MT4_FILE_CHANGED_OR_OVERWRITE_NOT_AUTHORIZED")
    atomic_bytes(path, raw)
    require(path.read_bytes() == raw, "MT4_WRITE_VERIFY_FAILED")
    return backup_id


def edit_preset(root, job):
    path = file_path(root, job["filename"])
    require(path.is_file(), "MT4_PRESET_NOT_FOUND")
    raw = path.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == job["expected_sha256"], "MT4_FILE_CHANGED_OR_OVERWRITE_NOT_AUTHORIZED")
    text, encoding, values = preset(raw)
    require(set(job["changes"]) <= set(values), "MT4_INPUT_NOT_PRESENT")
    lines = []
    for line in text.splitlines(keepends=True):
        key = line.split("=", 1)[0].strip()
        if not line.lstrip().startswith((";", "#")) and key in job["changes"]:
            val = job["changes"][key]
            val = str(val).lower() if type(val) is bool else str(val)
            newline = "\r\n" if line.endswith("\r\n") else "\n" if line.endswith("\n") else ""
            line = line.split("=", 1)[0] + "=" + val + newline
        lines.append(line)
    result = "".join(lines).encode(encoding)
    preset(result)
    backup = replace_with_backup(root, path, result, job["expected_sha256"])
    return {"code": "MT4_PRESET_SAVED", "filename": job["filename"], "sha256": hashlib.sha256(result).hexdigest(),
            "backup_id": backup, "loaded_in_chart_verified": False, "requires_reload_in_expert_inputs": True}


def install_file(root, gh, job):
    source = gh.get(job["source_path"], job["source_ref"])
    require(source is not None, "MT4_SOURCE_NOT_FOUND")
    raw = source[0]
    require(0 < len(raw) <= 512000 and hashlib.sha256(raw).hexdigest() == job["source_sha256"], "MT4_SOURCE_HASH_MISMATCH")
    if job["filename"].endswith(".set"):
        _, _, values = preset(raw)
        require(not any(PRIVATE.search(k) for k in values), "MT4_PRIVATE_INPUT_BLOCKED")
    path = file_path(root, job["filename"])
    backup = replace_with_backup(root, path, raw, job["expected_sha256"])
    return {"code": "MT4_FILE_INSTALLED", "filename": job["filename"], "sha256": job["source_sha256"],
            "backup_id": backup, "loaded_in_chart_verified": False, "terminal_launched": False}


def _execute(job, root, gh):
    validate_job(job)
    action = job["action"]
    if action == "mt4_discover":
        return discover(root)
    if action == "mt4_attach":
        return bind(root, job["candidate_id"])
    if action == "mt4_status":
        return status(root)
    if action == "mt4_read_preset":
        return read_preset(root, job["filename"])
    if action == "mt4_edit_preset":
        return edit_preset(root, job)
    return install_file(root, gh, job)


def execute(job, root, gh):
    value = _execute(job, root, gh)
    if job["action"] in {"mt4_discover", "mt4_attach", "mt4_status"}:
        write_json(state_dir(root) / "last_result.json", {"updated_at": time.time(), **value})
    return value
