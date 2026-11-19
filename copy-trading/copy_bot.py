"""OLFX COPY TRADING 0.1.0 — piloto MT5; simulación y ejecución DEMO.

No importa credenciales del portal. No permite cuentas seguidoras reales.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal, ROUND_DOWN
import hashlib
import json
import logging
from logging.handlers import RotatingFileHandler
import math
import os
from pathlib import Path
import sys
import time

LOG = logging.getLogger("olfx.copy")
ROOT = Path(__file__).resolve().parent


class Blocked(RuntimeError):
    """Un dato incompleto o un límite impide continuar."""


def positive(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0


def floor_lots(value, step):
    if not positive(step) or not math.isfinite(value):
        raise Blocked("Volumen o paso inválido")
    return float((Decimal(str(value)) / Decimal(str(step))).to_integral_value(rounding=ROUND_DOWN) * Decimal(str(step)))


def scaled_lots(volume, multiplier, step):
    return floor_lots(Decimal(str(volume)) * Decimal(str(multiplier)), step)


def remaining_lots(volume, initial_copy, initial_master, step):
    return floor_lots(Decimal(str(volume)) * Decimal(str(initial_copy)) / Decimal(str(initial_master)), step)


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as out:
        json.dump(value, out, indent=2, ensure_ascii=False, allow_nan=False)
        out.flush()
        os.fsync(out.fileno())
    os.replace(tmp, path)


@contextmanager
def exclusive(path):
    """Bloqueo de proceso liberado por el SO incluso después de un fallo."""
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open("a+b")
    handle.seek(0)
    if not handle.read(1):
        handle.write(b"0")
        handle.flush()
    handle.seek(0)
    try:
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as exc:
        handle.close()
        raise Blocked("Ya hay otro bot usando este archivo de configuración") from exc
    try:
        yield
    finally:
        handle.close()


def validate_config(cfg):
    if not isinstance(cfg, dict) or cfg.get("version") != 1:
        raise Blocked("Configuración incompatible")
    accounts = [cfg["master"], *cfg["followers"]]
    if not cfg["followers"]:
        raise Blocked("Falta una cuenta seguidora")
    paths, identities, ids = set(), set(), set()
    for a in accounts:
        if not isinstance(a.get("login"), int) or a["login"] <= 0 or not a.get("server"):
            raise Blocked("Completa login y servidor exactos")
        path = os.path.normcase(os.path.abspath(a["terminal_path"]))
        identity = (a["server"].casefold(), a["login"])
        if path in paths or identity in identities:
            raise Blocked("Cada cuenta necesita un terminal y una identidad distintos")
        paths.add(path)
        identities.add(identity)
    for f in cfg["followers"]:
        if not f.get("id") or f["id"] in ids:
            raise Blocked("Identificador de seguidora repetido o vacío")
        ids.add(f["id"])
        if type(f.get("enabled")) is not bool:
            raise Blocked("enabled debe ser true o false")
        for name in ("lot_multiplier", "max_lots", "max_risk_pct", "max_daily_loss_pct", "max_spread_points", "max_entry_drift_points"):
            if not positive(f.get(name)):
                raise Blocked(f"Límite inválido: {name}")
        if f["max_risk_pct"] > 100 or f["max_daily_loss_pct"] > 100:
            raise Blocked("Los porcentajes deben ser <= 100")
        if not isinstance(f.get("max_positions"), int) or f["max_positions"] < 1:
            raise Blocked("max_positions inválido")
        if not isinstance(f.get("symbols"), dict) or not f["symbols"] or any(not k or not isinstance(v, str) or not v for k, v in f["symbols"].items()):
            raise Blocked("Configura un mapa de símbolos explícito")
    for name in ("poll_seconds", "max_signal_age_seconds", "max_snapshot_age_seconds", "max_tick_age_seconds"):
        if not positive(cfg.get(name)):
            raise Blocked(f"Tiempo inválido: {name}")


class State:
    def __init__(self, path, cfg, mode):
        self.path = path
        # Cambios de límites conservan el historial; cambios de identidad lo bloquean.
        scope = {"master": {k: cfg["master"][k] for k in ("login", "server", "terminal_path")},
                 "followers": [{k: f[k] for k in ("id", "login", "server", "terminal_path")} for f in cfg["followers"]], "mode": mode}
        scope = hashlib.sha256(json.dumps(scope, sort_keys=True).encode()).hexdigest()
        self.data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"scope": scope, "followers": {}}
        if self.data.get("scope") != scope:
            raise Blocked("Identidades cambiadas: conserva el estado anterior y utiliza otra configuración para el nuevo grupo")

    def follower(self, name):
        return self.data["followers"].setdefault(name, {"started": None, "records": {}, "pending": None, "paper": [], "days": {}})

    def save(self):
        atomic_json(self.path, self.data)


def master_key(position):
    # identifier permanece estable ante cambios de ticket del bróker.
    return str(position["identifier"])


def magic_for(master, follower, key):
    raw = f"OLFXCOPY1|{master['server']}|{master['login']}|{follower['server']}|{follower['login']}|{key}"
    return int.from_bytes(hashlib.sha256(raw.encode()).digest()[:7], "big") + 1


def compatible(source, target):
    for name in ("trade_contract_size", "trade_tick_size"):
        if not positive(source[name]) or not positive(target[name]) or not math.isclose(source[name], target[name], rel_tol=1e-9):
            raise Blocked("Los contratos no son equivalentes; revisa el mapa de símbolos")
    if source["currency_profit"] != target["currency_profit"]:
        raise Blocked("Las monedas de beneficio no coinciden")


class MT5:
    def __init__(self, api, cfg, account, demo=False):
        self.api, self.cfg, self.expected, self.demo = api, cfg, account, demo

    def __enter__(self):
        if not Path(self.expected["terminal_path"]).is_file():
            raise Blocked("No existe el terminal64.exe configurado")
        if not self.api.initialize(self.expected["terminal_path"], timeout=10000):
            self.api.shutdown()
            raise Blocked("No se pudo conectar al terminal MT5")
        try:
            self.verify()
        except Exception:
            self.api.shutdown()
            raise
        return self

    def __exit__(self, *_):
        self.api.shutdown()

    def verify(self):
        a, t = self.api.account_info(), self.api.terminal_info()
        if a is None or t is None or not t.connected:
            raise Blocked("MT5 desconectado")
        if a.login != self.expected["login"] or a.server.casefold() != self.expected["server"].casefold():
            raise Blocked("La cuenta del terminal no coincide; no se cambia el login automáticamente")
        if os.path.normcase(os.path.abspath(t.path)) != os.path.normcase(os.path.abspath(str(Path(self.expected["terminal_path"]).parent))):
            raise Blocked("MT5 devolvió otro terminal")
        if self.demo:
            if a.trade_mode != self.api.ACCOUNT_TRADE_MODE_DEMO:
                raise Blocked("Esta versión SOLO ejecuta en seguidoras DEMO")
            if a.margin_mode != self.api.ACCOUNT_MARGIN_MODE_RETAIL_HEDGING:
                raise Blocked("La seguidora necesita modo hedging")
            if not a.trade_allowed or not a.trade_expert or not t.trade_allowed or t.tradeapi_disabled:
                raise Blocked("Habilita trading algorítmico y acceso Python en la DEMO")
        return a._asdict()

    def positions(self):
        self.verify()
        rows = self.api.positions_get()
        if rows is None:
            raise Blocked("No se pudieron leer posiciones; no se interpreta como cuenta vacía")
        return [p._asdict() for p in rows]

    def symbol(self, name):
        if not self.api.symbol_select(name, True):
            raise Blocked("Símbolo no disponible: " + name)
        s = self.api.symbol_info(name)
        if s is None:
            raise Blocked("No hay especificación de símbolo")
        return s._asdict()

    def quote(self, name):
        t = self.api.symbol_info_tick(name)
        if t is None or not positive(t.bid) or not positive(t.ask) or t.ask < t.bid:
            raise Blocked("Cotización inválida")
        age = time.time() - t.time_msc / 1000
        if age < -2 or age > self.cfg["max_tick_age_seconds"]:
            raise Blocked("Cotización antigua o reloj desajustado")
        return t._asdict()

    def risk(self, side, symbol, volume, price, sl):
        value = self.api.order_calc_profit(side, symbol, volume, price, sl)
        if value is None or not math.isfinite(value):
            raise Blocked("No se pudo calcular riesgo en moneda de cuenta")
        return abs(value)

    def request(self, action):
        api = self.api
        req = {"action": api.TRADE_ACTION_SLTP if action["kind"] == "stops" else api.TRADE_ACTION_DEAL,
               "symbol": action["symbol"], "magic": action["magic"], "comment": "OLFX_COPY_DEMO"}
        if action["kind"] == "stops":
            return {**req, "position": action["ticket"], "sl": action["sl"], "tp": action["tp"]}
        s, q = self.symbol(action["symbol"]), self.quote(action["symbol"])
        # FOK evita ejecuciones parciales de la solicitud. No se degrada a IOC.
        if not s["filling_mode"] & 1:
            raise Blocked("V1 requiere soporte FOK para este símbolo")
        req.update(volume=action["volume"], type=action["side"],
                   price=q["ask"] if action["side"] == 0 else q["bid"],
                   deviation=10, type_time=api.ORDER_TIME_GTC, type_filling=api.ORDER_FILLING_FOK)
        if action["kind"] == "open":
            # Riesgo y precio se comprobaron sobre esta misma cotización en el motor.
            point = s["point"]
            if abs(req["price"] - action["price"]) > point:
                raise Blocked("Precio cambió antes del envío; se omite esta entrada")
            req.update(sl=action["sl"], tp=action["tp"])
        else:
            req["position"] = action["ticket"]
        return req

    def prepare(self, action):
        if not self.demo:
            raise Blocked("Adaptador de lectura: envío deshabilitado")
        self.verify()
        rows = self.positions()
        if action["kind"] == "open":
            if any(p["magic"] == action["magic"] for p in rows):
                raise Blocked("La copia ya existe antes del envío")
        else:
            found = [p for p in rows if p["ticket"] == action["ticket"]]
            if len(found) != 1 or found[0]["identifier"] != action["position_id"] or found[0]["symbol"] != action["symbol"]:
                raise Blocked("La posición cambió antes del envío")
            if action["kind"] == "close" and (found[0]["type"] != 1 - action["side"] or not math.isclose(found[0]["volume"], action["before_volume"], abs_tol=1e-8)):
                raise Blocked("El volumen o dirección cambió antes del cierre")
        req = self.request(action)
        checked = self.api.order_check(req)
        if checked is None or checked.retcode != 0:
            raise Blocked("order_check rechazó la solicitud (no se envió)")
        return req

    def execute(self, action, prepared):
        if not self.demo:
            raise Blocked("Adaptador de lectura: envío deshabilitado")
        # Defensa inmediata contra cambio manual de cuenta entre comprobación y envío.
        self.verify()
        result = self.api.order_send(prepared)
        if result is None or result.retcode != self.api.TRADE_RETCODE_DONE:
            raise Blocked("Resultado no confirmado: requiere reconciliación manual; no se reintenta")
        return result._asdict()


class Paper:
    """Lee cotizaciones pero ejecuta únicamente en el estado local."""
    def __init__(self, reader, data):
        self.reader, self.data = reader, data

    def __getattr__(self, name):
        return getattr(self.reader, name)

    def positions(self):
        return list(self.data["paper"])

    def prepare(self, action):
        return dict(action)

    def execute(self, action, prepared):
        rows = self.data["paper"]
        if action["kind"] == "open":
            ticket = max([p["ticket"] for p in rows] + [0]) + 1
            rows.append({"ticket": ticket, "identifier": ticket, "magic": action["magic"], "symbol": action["symbol"],
                         "type": action["side"], "volume": action["volume"], "sl": action["sl"], "tp": action["tp"]})
        else:
            p = next(p for p in rows if p["ticket"] == action["ticket"])
            if action["kind"] == "close":
                p["volume"] = round(p["volume"] - action["volume"], 8)
                if p["volume"] <= 1e-8:
                    rows.remove(p)
            else:
                p.update(sl=action["sl"], tp=action["tp"])
        return {"paper": True}


def stops_valid(p, q, s):
    sl, tp, side = p["sl"], p["tp"], p["type"]
    if not positive(sl) or tp < 0 or not math.isfinite(tp):
        raise Blocked("Stop Loss obligatorio; TP debe ser válido")
    distance = max(s["trade_stops_level"], s.get("trade_freeze_level", 0)) * s["point"]
    reference = q["bid"] if side == 0 else q["ask"]
    if (side == 0 and (sl >= reference - distance or (tp and tp <= reference + distance))) or (side == 1 and (sl <= reference + distance or (tp and tp >= reference - distance))):
        raise Blocked("SL/TP no válidos para el precio o distancia mínima")
    for price in (sl, tp):
        if price and abs(price / s["trade_tick_size"] - round(price / s["trade_tick_size"])) > 1e-5:
            raise Blocked("SL/TP fuera del paso de precio; V1 no los redondea")


class Engine:
    def __init__(self, cfg, state):
        self.cfg, self.state = cfg, state

    def send(self, data, broker, action):
        if (ROOT / "PAUSA_TOTAL.txt").exists():
            raise Blocked("PAUSA_TOTAL activa: ninguna solicitud nueva")
        if time.time() - self.snapshot_time > self.cfg["max_snapshot_age_seconds"]:
            raise Blocked("Lectura maestra vencida antes del envío")
        prepared = broker.prepare(action)
        if time.time() - self.snapshot_time > self.cfg["max_snapshot_age_seconds"]:
            raise Blocked("Lectura maestra vencida durante la comprobación")
        data["pending"] = action
        self.state.save()  # escribir antes de operar; si se corta, detener y reconciliar
        broker.execute(action, prepared)
        if action["kind"] != "open":
            positions = [p for p in broker.positions() if p["identifier"] == action["position_id"]]
            if action["kind"] == "close":
                remaining = positions[0]["volume"] if len(positions) == 1 else 0 if not positions else -1
                expected = round(action["before_volume"] - action["volume"], 8)
                if not math.isclose(remaining, expected, abs_tol=1e-8):
                    raise Blocked("Cierre aceptado pero volumen sin reconciliar; no se repite")
            elif len(positions) != 1 or not math.isclose(positions[0]["sl"], action["sl"], abs_tol=1e-8) or not math.isclose(positions[0]["tp"], action["tp"], abs_tol=1e-8):
                raise Blocked("SL/TP aceptado pero sin reconciliar; revisar manualmente")
            data["pending"] = None
            self.state.save()
        LOG.info("%s %s lotes=%s", action["kind"], action["symbol"], action.get("volume", "-"))

    def sync(self, f, snap, broker):
        data = self.state.follower(f["id"])
        if data["pending"]:
            raise Blocked("Solicitud pendiente tras un resultado incierto; no se repite. Revisa estado e historial")
        account = broker.verify()
        if not positive(account["equity"]):
            raise Blocked("Equity inválido")
        today = datetime.now(timezone.utc).date().isoformat()
        day = data["days"].setdefault(today, {"equity": account["equity"], "blocked": False})
        if account["equity"] <= day["equity"] * (1 - f["max_daily_loss_pct"] / 100):
            day["blocked"] = True
        age = time.time() - snap["time"]
        if age < -2 or age > self.cfg["max_snapshot_age_seconds"]:
            raise Blocked("Lectura maestra vencida; no se abren ni cierran posiciones")
        self.snapshot_time = snap["time"]
        current = {master_key(p): p for p in snap["positions"]}
        records = data["records"]
        if data["started"] is None:
            data["started"] = snap["time"]
            for key in current:
                records[key] = {"status": "skipped", "reason": "abierta antes de activar esta seguidora"}
            self.state.save()
            LOG.info("%s: base registrada; se copian solo entradas nuevas", f["id"])
            return
        rows = broker.positions()
        # Gestionar primero copias existentes, incluso con pausa de entradas o límite diario.
        for key, record in list(records.items()):
            if record["status"] != "active":
                continue
            matches = [p for p in rows if p["magic"] == record["magic"]]
            if len(matches) > 1:
                raise Blocked("Más de una posición para el mismo identificador de copia")
            if not matches:
                record["status"] = "closed"  # SL, TP o cierre manual: nunca reabrir
                self.state.save()
                continue
            p = matches[0]
            if p["symbol"] != record["symbol"] or p["type"] != record["side"] or p["identifier"] != record["position_id"]:
                raise Blocked("La identidad de la posición copiada cambió")
            source = current.get(key)
            s = broker.symbol(p["symbol"])
            if source and (source["symbol"] != record["source_symbol"] or source["type"] != record["side"] or source["volume"] > record["last_master_volume"] + 1e-8):
                raise Blocked("Cambio de dirección o aumento de volumen maestro no admitido en V1")
            target = 0 if source is None else remaining_lots(source["volume"], record["initial_copy_volume"], record["initial_master_volume"], s["volume_step"])
            if target < s["volume_min"]:
                target = 0
            difference = round(p["volume"] - target, 8)
            if difference >= s["volume_min"] - 1e-8:
                close_volume = floor_lots(difference, s["volume_step"])
                if source:
                    record["last_master_volume"] = source["volume"]
                self.send(data, broker, {"kind": "close", "ticket": p["ticket"], "symbol": p["symbol"],
                                       "position_id": p["identifier"], "before_volume": p["volume"],
                                       "side": 1 - p["type"], "volume": close_volume, "magic": record["magic"]})
                # Actualizar estado en el ciclo siguiente: cerrar dos veces queda evitado por posición actual.
                continue
            if source:
                record["last_master_volume"] = source["volume"]
                if source["sl"] != p["sl"] or source["tp"] != p["tp"]:
                    # No se permite quitar o ampliar el SL de la seguidora.
                    sl = max(p["sl"], source["sl"]) if p["type"] == 0 else min(p["sl"], source["sl"]) if source["sl"] > 0 else p["sl"]
                    desired = {**source, "sl": sl}
                    q = broker.quote(p["symbol"])
                    stops_valid(desired, q, s)
                    if sl != p["sl"] or source["tp"] != p["tp"]:
                        self.send(data, broker, {"kind": "stops", "ticket": p["ticket"], "symbol": p["symbol"],
                                               "position_id": p["identifier"],
                                               "sl": sl, "tp": source["tp"], "magic": record["magic"]})
        self.state.save()
        for key, p in current.items():
            if key in records:
                continue
            # Registrar decisión antes de cualquier envío: no abrir tarde después de reintentar.
            record = records[key] = {"status": "skipped", "reason": "pendiente de validación"}
            self.state.save()
            try:
                if not f["enabled"] or (ROOT / "PAUSA_ENTRADAS.txt").exists() or day["blocked"]:
                    raise Blocked("Entradas en pausa o límite diario alcanzado")
                age = time.time() - p["time_msc"] / 1000
                if age < -2 or age > self.cfg["max_signal_age_seconds"] or p["time_msc"] < int(data["started"] * 1000):
                    raise Blocked("Entrada antigua; se omite")
                if p["type"] not in (0, 1) or p["symbol"] not in f["symbols"]:
                    raise Blocked("Símbolo o tipo fuera de la lista permitida")
                name = f["symbols"][p["symbol"]]
                s = broker.symbol(name)
                compatible(snap["symbols"][p["symbol"]], s)
                q = broker.quote(name)
                if not positive(s["point"]):
                    raise Blocked("Point inválido")
                if (q["ask"] - q["bid"]) / s["point"] > f["max_spread_points"]:
                    raise Blocked("Spread demasiado alto")
                price = q["ask"] if p["type"] == 0 else q["bid"]
                if abs(price - p["price_open"]) / s["point"] > f["max_entry_drift_points"]:
                    raise Blocked("Precio demasiado alejado de la entrada maestra")
                stops_valid(p, q, s)
                lots = scaled_lots(p["volume"], f["lot_multiplier"], s["volume_step"])
                if lots < s["volume_min"] or lots > min(s["volume_max"], f["max_lots"]):
                    raise Blocked("Volumen fuera de los límites; no se aumenta al mínimo")
                account = broker.verify()
                if account["equity"] <= day["equity"] * (1 - f["max_daily_loss_pct"] / 100):
                    day["blocked"] = True
                    raise Blocked("Límite diario alcanzado durante el ciclo")
                if broker.risk(p["type"], name, lots, price, p["sl"]) > account["equity"] * f["max_risk_pct"] / 100:
                    raise Blocked("Riesgo estimado de la entrada superior al límite")
                rows = broker.positions()
                active_magics = {r["magic"] for r in records.values() if r["status"] == "active"}
                if sum(row["magic"] in active_magics for row in rows) >= f["max_positions"]:
                    raise Blocked("Límite de posiciones copiadas")
                magic = magic_for(self.cfg["master"], f, key)
                if any(row["magic"] == magic for row in rows):
                    raise Blocked("Identificador ya presente: requiere revisión")
                action = {"kind": "open", "symbol": name, "side": p["type"], "volume": lots,
                          "price": price, "sl": p["sl"], "tp": p["tp"], "magic": magic}
                self.send(data, broker, action)
                matches = [row for row in broker.positions() if row["magic"] == magic]
                if len(matches) != 1 or (len(matches) == 1 and (
                    matches[0]["symbol"] != name or matches[0]["type"] != p["type"]
                    or not math.isclose(matches[0]["volume"], lots, abs_tol=1e-8)
                    or not math.isclose(matches[0]["sl"], p["sl"], abs_tol=1e-8)
                    or not math.isclose(matches[0]["tp"], p["tp"], abs_tol=1e-8))):
                    data["pending"] = action
                    self.state.save()
                    raise Blocked("Envío aceptado pero posición no reconciliada; revisar manualmente")
                record.update(status="active", magic=magic, symbol=name, source_symbol=p["symbol"], side=p["type"],
                              position_id=matches[0]["identifier"], initial_copy_volume=lots,
                              initial_master_volume=p["volume"], last_master_volume=p["volume"])
                record.pop("reason", None)
                data["pending"] = None
                self.state.save()
            except Blocked as exc:
                record["reason"] = str(exc)
                self.state.save()
                if data["pending"]:
                    raise
                LOG.warning("%s: entrada omitida: %s", f["id"], exc)


def snapshot(reader, cfg):
    rows = reader.positions()
    allowed = {name for f in cfg["followers"] for name in f["symbols"]}
    symbols = {p["symbol"]: reader.symbol(p["symbol"]) for p in rows if p["symbol"] in allowed}
    return {"time": time.time(), "positions": rows, "symbols": symbols}


def run(cfg, config_path, mode, once=False):
    if sys.platform != "win32":
        raise Blocked("MT5 requiere Windows; para prueba local usa simulate")
    import MetaTrader5 as api
    state = State(config_path.with_suffix(f".{mode}.state.json"), cfg, mode)
    engine = Engine(cfg, state)
    LOG.info("OLFX COPY %s — %s", "DEMO" if mode == "demo" else "PAPER (sin enviar órdenes)", config_path.name)
    while True:
        status = {"time": datetime.now(timezone.utc).isoformat(), "mode": mode, "followers": {}}
        try:
            for f in cfg["followers"]:
                try:
                    with MT5(api, cfg, cfg["master"]) as master:
                        snap = snapshot(master, cfg)
                    with MT5(api, cfg, f, demo=(mode == "demo")) as follower:
                        broker = follower if mode == "demo" else Paper(follower, state.follower(f["id"]))
                        engine.sync(f, snap, broker)
                    status["followers"][f["id"]] = "ok"
                except Exception as exc:
                    status["followers"][f["id"]] = str(exc)
                    LOG.error("%s: %s", f["id"], exc)
        except Exception as exc:
            status["master_error"] = str(exc)
            LOG.error("Maestra no disponible: %s; no se interpretan cierres", exc)
        atomic_json(config_path.with_suffix(f".{mode}.status.json"), status)
        if once:
            if "master_error" in status or any(v != "ok" for v in status["followers"].values()):
                raise Blocked("Diagnóstico fallido; consulta el log")
            return
        time.sleep(cfg["poll_seconds"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["simulate", "paper", "demo", "check"])
    parser.add_argument("--config", type=Path, default=ROOT / "config.json")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if args.command == "simulate":
        from scenario import demonstrate
        demonstrate()
        return
    path = args.config.resolve()
    cfg = json.loads(path.read_text(encoding="utf-8-sig"))
    validate_config(cfg)
    if args.command == "check":
        LOG.info("Configuración válida. Esto no comprueba conectividad con MT5")
        return
    logdir = ROOT / "logs"
    logdir.mkdir(exist_ok=True)
    handler = RotatingFileHandler(logdir / f"{args.command}.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logging.getLogger().addHandler(handler)
    with exclusive(path.with_suffix(".lock")):
        run(cfg, path, args.command, args.once)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Detenido. Las posiciones abiertas conservan el SL/TP del bróker.")
    except Exception as exc:
        print("ERROR:", exc, file=sys.stderr)
        sys.exit(1)
