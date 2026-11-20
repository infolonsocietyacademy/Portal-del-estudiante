"""Cooperative idle restart. A handoff never cancels an existing MT5 EA."""
import json
import os
from pathlib import Path


def mark_ready(root, version):
    nonce = os.environ.get("OLFX_BRIDGE_LAUNCH_NONCE", "")
    if not nonce:
        return
    path = Path(root) / "agent_health.json"
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps({"version":version,"nonce":nonce}),encoding="utf-8")
    temp.replace(path)


def update_pending(root):
    nonce = os.environ.get("OLFX_BRIDGE_LAUNCH_NONCE", "")
    if not nonce:
        return False
    try:
        data=json.loads((Path(root)/"update_pending.json").read_text(encoding="utf-8"))
    except (OSError,ValueError):
        return False
    return isinstance(data,dict) and data.get("nonce")==nonce and type(data.get("sequence")) is int and data["sequence"]>0

