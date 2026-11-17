"""Dedicated DEMO execution terminal; tester retains its original owned directory."""
import json
from pathlib import Path
def execution_terminal(root):
    root=Path(root).resolve()
    target=(root/"mt5-execution").resolve()
    if target.parent!=root or target.name!="mt5-execution" or target.is_symlink():
        raise RuntimeError("EXECUTION_PATH_INVALID")
    config=json.loads((root/"settings.json").read_text(encoding="utf-8"))
    marker=target/".olfx-owned"
    if not marker.is_file() or marker.read_text().strip()!=config["installation_id"] or not (target/"terminal64.exe").is_file():
        raise RuntimeError("EXECUTION_TERMINAL_NOT_PREPARED")
    return target
