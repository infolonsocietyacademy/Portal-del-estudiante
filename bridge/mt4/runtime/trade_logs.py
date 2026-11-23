"""Read-only local demonstration trade viewer. Never connects to a trading API."""
import hashlib
import json
import math
from pathlib import Path
import sys
import time


def log_stem(demo):
    identity = str(demo["login"]) + "@" + demo["server"]
    return "OLFX_TRADES_" + hashlib.sha256(identity.encode()).hexdigest()[:16]


def read_events(path, limit=2000):
    path = Path(path)
    if not path.is_file():
        return []
    events = {}
    with path.open("rb") as stream:
        stream.seek(0, 2)
        offset = max(0, stream.tell() - 2 * 1024 * 1024)
        stream.seek(offset)
        if offset:
            stream.readline()
        text = stream.read(2 * 1024 * 1024).decode("utf-8-sig", errors="replace")
    for line in text.splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if not isinstance(row, dict) or row.get("event") not in {"APERTURA", "CIERRE", "REVERSA"}:
            continue
        if row.get("deal_id"):
            events[str(row["deal_id"])] = row
    return list(events.values())[-limit:]


def summary(events, snapshot):
    def number(value):
        return float(value) if type(value) in (int, float) and math.isfinite(value) else 0.0
    positions = snapshot.get("positions", []) if isinstance(snapshot, dict) and snapshot.get("demo_verified") is True else []
    positions = [p for p in positions if isinstance(p, dict)] if isinstance(positions, list) else []
    return {"opened_events": sum(e.get("event") == "APERTURA" for e in events),
        "closed_events": sum(e.get("event") == "CIERRE" for e in events),
        "net_recorded": sum(number(e.get("net")) for e in events),
        "open_positions": len(positions), "open_lots": sum(number(p.get("volume")) for p in positions),
        "floating_profit": sum(number(p.get("floating_profit")) for p in positions), "positions": positions}


def watch_trade_logs(root, api):
    terminal = api.owned_terminal(root)
    demo = api.local_demo_from_logs(terminal)
    stem = log_stem(demo)
    folder = terminal / "MQL5" / "Files"
    event_file = folder / (stem + ".jsonl")
    snapshot_file = folder / (stem + ".snapshot.json")
    csv_file = folder / (stem + ".csv")
    previous = None
    try:
        while True:
            events = read_events(event_file)
            try:
                snapshot = json.loads(snapshot_file.read_text(encoding="utf-8-sig"))
                if not isinstance(snapshot, dict) or time.time() - snapshot_file.stat().st_mtime > 5:
                    snapshot = {}
            except (OSError, ValueError):
                snapshot = {}
            state = summary(events, snapshot)
            current = json.dumps([events[-15:], snapshot], sort_keys=True)
            if current != previous:
                previous = current
                print("\nOLFX - OPERACIONES DEMO | Hora mostrada: servidor del broker", flush=True)
                print("Aperturas: %d | Cierres: %d | Neto de registros cargados: %.2f" % (state["opened_events"],state["closed_events"],state["net_recorded"]))
                if snapshot.get("demo_verified") is True:
                    print("Posiciones abiertas: %d | Lotes abiertos: %.2f | Ganancia/perdida flotante: %.2f" % (state["open_positions"],state["open_lots"],state["floating_profit"]))
                    for p in state["positions"]:
                        print("ABIERTA  %s %s | lote %s | precio %s | flotante %s" % (p.get("symbol",""),p.get("side",""),p.get("volume",""),p.get("open_price",""),p.get("floating_profit","")))
                else:
                    print("Sin datos actuales del registrador DEMO; posicion actual sin verificar.")
                for e in events[-15:]:
                    print("%s | %-8s | %-8s %-4s | lote %s | precio %s | G/P %s | comision %s | swap %s | fee %s | neto %s" %
                        (e.get("time_server",""),e.get("event",""),e.get("symbol",""),e.get("side",""),e.get("volume",""),e.get("price",""),e.get("profit",""),e.get("commission",""),e.get("swap",""),e.get("fee",""),e.get("net","")))
                print("CSV local: " + str(csv_file), flush=True)
            time.sleep(1)
    except KeyboardInterrupt:
        print("Visor de operaciones cerrado. El registrador de MT5 es independiente.")

