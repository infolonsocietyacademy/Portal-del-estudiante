"""H4 liquidity sweep strategy. Pure signals plus the guarded DEMO adapter.

H4 candles are native broker candles, never approximated from a UTC grouping.
Uses only completed H4 candles and closed M1 candles. All consumed levels and
the cursor are persisted before order acceptance. Historical warm-up never trades.
"""
import hashlib
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path


def valid_bar(bar):
    fields = {"time", "open", "high", "low", "close"}
    return (isinstance(bar, dict) and fields <= bar.keys()
            and type(bar["time"]) is int and bar["time"] > 0 and bar["time"] % 60 == 0
            and all(type(bar[k]) in (int, float) and math.isfinite(bar[k]) and bar[k] > 0
                    for k in fields - {"time"})
            and bar["low"] <= min(bar["open"], bar["close"])
            <= max(bar["open"], bar["close"]) <= bar["high"])


class SignalState:
    def __init__(self, symbol="XAUUSD", tick=.01, state=None, pivots=False):
        if not isinstance(symbol, str) or not symbol.startswith("XAUUSD"):
            raise ValueError("LIQH4_SYMBOL_NOT_APPROVED")
        if type(tick) not in (int, float) or not math.isfinite(tick) or tick <= 0:
            raise ValueError("LIQH4_INVALID_TICK")
        self.symbol, self.tick, self.pivots = symbol, float(tick), bool(pivots)
        self.last_time = None
        self.previous_close = None
        self.highs_taken, self.lows_taken = set(), set()
        # A retry is armed only after a later M1 candle closes inside the H4 range.
        self.highs_retry, self.lows_retry = {}, {}
        self.pending = None
        if state is not None:
            self.restore(state)

    def dump(self):
        return dict(schema=2, symbol=self.symbol, tick=self.tick, pivots=self.pivots,
                    last_time=self.last_time, previous_close=self.previous_close,
                    highs_taken=sorted(self.highs_taken), lows_taken=sorted(self.lows_taken),
                    highs_retry=[list(item) for item in sorted(self.highs_retry.items())],
                    lows_retry=[list(item) for item in sorted(self.lows_retry.items())],
                    pending=self.pending)

    def legacy_dump(self):
        # Older Bridge versions exhaust all touched levels, including any available retry.
        data = self.dump()
        for name in ("highs", "lows"):
            data[name + "_taken"] = sorted(data[name + "_taken"] + [
                origin for origin, _ in data.pop(name + "_retry")
            ])
        data.pop("pending")
        data["schema"] = 1
        return data

    def restore(self, data):
        invalid = "LIQH4_CORRUPT_SIGNAL_STATE"
        if not isinstance(data, dict) or type(data.get("schema")) is not int or data["schema"] not in (1, 2):
            raise ValueError(invalid)
        new_fields = {"highs_retry", "lows_retry", "pending"}
        keys = set(self.dump())
        if set(data) != (keys - new_fields if data["schema"] == 1 else keys):
            raise ValueError(invalid)
        if (data["symbol"], data["tick"], data["pivots"]) != (self.symbol, self.tick, self.pivots):
            raise ValueError("LIQH4_STATE_SETTINGS_CHANGED")
        last, close = data["last_time"], data["previous_close"]
        if not (last is None and close is None):
            if (type(last) is not int or last <= 0 or last % 60 or type(close) not in (int, float)
                    or not math.isfinite(close) or close <= 0):
                raise ValueError(invalid)

        def valid_origin(origin):
            return type(origin) is int and origin > 0 and origin % 60 == 0 and last is not None and origin <= last

        for side, name in ((-1, "highs"), (1, "lows")):
            taken, retries = self.levels(side)
            values = data[name + "_taken"]
            if (not isinstance(values, list) or len(values) > 3 or not all(map(valid_origin, values))
                    or len(set(values)) != len(values)):
                raise ValueError(invalid)
            taken.update(values)
            # Old state exhausted a level on its first penetration. Preserve those locks.
            rows = data.get(name + "_retry", [])
            if not isinstance(rows, list) or len(rows) + len(taken) > 3:
                raise ValueError(invalid)
            for row in rows:
                if (not isinstance(row, list) or len(row) != 2 or not valid_origin(row[0])
                        or type(row[1]) is not bool or row[0] in taken or row[0] in retries):
                    raise ValueError(invalid)
                retries[row[0]] = row[1]

        pending = data.get("pending")
        if pending is not None:
            if (not isinstance(pending, dict) or set(pending) != {"job_id", "side", "origins"}
                    or not isinstance(pending["job_id"], str)
                    or not re.fullmatch(r"lh4-[a-f0-9]{12}-[a-f0-9]{24}", pending["job_id"])
                    or type(pending["side"]) is not int or pending["side"] not in (-1, 1)):
                raise ValueError(invalid)
            origins = pending["origins"]
            _, retries = self.levels(pending["side"])
            if (not isinstance(origins, list) or not 1 <= len(origins) <= 3
                    or not all(valid_origin(origin) and retries.get(origin) is False for origin in origins)
                    or len(set(origins)) != len(origins)):
                raise ValueError(invalid)
            self.pending = dict(job_id=pending["job_id"], side=pending["side"], origins=list(origins))
        self.last_time, self.previous_close = last, close

    def levels(self, side):
        return (self.lows_taken, self.lows_retry) if side > 0 else (self.highs_taken, self.highs_retry)

    def prune(self, active):
        for side in (-1, 1):
            taken, retries = self.levels(side)
            taken.intersection_update(active)
            for origin in retries.keys() - active:
                del retries[origin]
        if self.pending is not None:
            self.pending["origins"] = [origin for origin in self.pending["origins"] if origin in active]
            if not self.pending["origins"]:
                self.pending = None

    def reserve(self, job_id, event):
        _, retries = self.levels(event["side"])
        origins = [origin for origin in event["origins"] if retries.get(origin) is False]
        if origins:
            self.pending = dict(job_id=job_id, side=event["side"], origins=origins)

    def settle(self, order):
        if order is not None and order["phase"] in {"waiting", "submitted", "uncertain"}:
            return False
        if order is not None:
            # An explicit rejection or an intent that never reached the broker may retry.
            no_fill = (order["code"] == "OPEN_REJECTED"
                       or (order["phase"] in {"done", "failed"} and "requested_volume" not in order))
            if not no_fill:
                taken, retries = self.levels(self.pending["side"])
                for origin in self.pending["origins"]:
                    taken.add(origin)
                    del retries[origin]
        # A reservation without an engine record was persisted before accept; it cannot have sent.
        self.pending = None
        return True

    def sweep(self, bar, level, side, pivot, allow_retry):
        origin = level["time"]
        taken, retries = self.levels(side)
        if origin in taken:
            return False
        pending = self.pending
        if pending is not None and pending["side"] == side and origin in pending["origins"]:
            return False
        if retries.get(origin) is False:
            if level["low"] < bar["close"] < level["high"]:
                retries[origin] = True
            return False
        edge = "low" if side > 0 else "high"
        price = level[edge]
        penetration = side * (price - bar[edge])
        if penetration <= 0:
            return False
        if origin in retries or not allow_retry:
            retries.pop(origin, None)
            taken.add(origin)
        else:
            retries[origin] = False
        return (self.previous_close is not None and side * (self.previous_close - price) >= 0
                and side * (bar["close"] - price) > 0 and penetration >= self.tick - 1e-10
                and (not self.pivots or pivot))

    def step(self, bar, h4, *, allow_retry=True):
        if not valid_bar(bar) or any(not valid_bar(b) for b in h4):
            raise ValueError("LIQH4_INVALID_CLOSED_BAR")
        if self.last_time is not None and bar["time"] <= self.last_time:
            raise ValueError("LIQH4_NON_MONOTONIC_BAR")
        if any(a["time"] >= b["time"] for a, b in zip(h4, h4[1:])):
            raise ValueError("LIQH4_INVALID_H4_ORDER")
        # A candle must have fully closed before the signal candle opens.
        closed = [b for b in h4 if b["time"] + 14400 <= bar["time"]][-4:][::-1]
        buys, sells = [], []
        if len(closed) == 4:
            self.prune({b["time"] for b in closed[:3]})
            for i, level in enumerate(closed[:3]):
                ph = i > 0 and level["high"] > max(closed[i-1]["high"], closed[i+1]["high"])
                pl = i > 0 and level["low"] < min(closed[i-1]["low"], closed[i+1]["low"])
                if self.sweep(bar, level, -1, ph, allow_retry):
                    sells.append(level["time"])
                if self.sweep(bar, level, 1, pl, allow_retry):
                    buys.append(level["time"])
        self.last_time, self.previous_close = bar["time"], bar["close"]
        side = 1 if buys and not sells and bar["close"] > bar["open"] else -1 if sells and not buys and bar["close"] < bar["open"] else 0
        if not side:
            return None
        key = hashlib.sha256(f"LIQH4|{self.symbol}|{bar['time']}|{side}".encode()).hexdigest()[:24]
        return dict(key=key, time=bar["time"], side=side, entry=bar["close"],
                    sl_bid=bar["low"]-5*self.tick if side > 0 else bar["high"]+5*self.tick,
                    hi=bar["high"], lo=bar["low"], origins=buys if side > 0 else sells)

def convert(rows):
    return [{k: int(r[k]) if k == "time" else float(r[k])
             for k in ("time", "open", "high", "low", "close")} for r in rows]


class Strategy:
    def __init__(self, engine, directory):
        self.engine = engine
        self.legacy_path = Path(directory) / "liquidez-h4-signal.json"
        self.path = Path(directory) / "liquidez-h4-signal-v2.json"
        info = engine.mt5.symbol_info(engine.config["symbol"])
        if info is None:
            raise ValueError("LIQH4_SYMBOL_UNAVAILABLE")
        settings = (engine.config["symbol"], float(info.trade_tick_size))
        legacy = SignalState(*settings, json.loads(self.legacy_path.read_text())) if self.legacy_path.is_file() else None
        self.state = SignalState(*settings, json.loads(self.path.read_text())) if self.path.is_file() else legacy or SignalState(*settings)
        # A rollback may have advanced the old cursor before this version restarts.
        if legacy is not None and (legacy.last_time or 0) > (self.state.last_time or 0):
            self.state = legacy
        engine.lh4_event = None

    def save(self):
        from gold_scalp_core import atomic
        atomic(self.legacy_path, self.state.legacy_dump())
        atomic(self.path, self.state.dump())

    def step(self, paused=False):
        e = self.engine
        if paused:
            for s in e.states.values():
                if s["job"]["action"] == "trade" and s["phase"] == "waiting":
                    s["cancel"] = True
                    e.save(s)
        e.tick()
        account = e.guard(trade=True)
        if self.state.pending is not None:
            order = e.states.get(self.state.pending["job_id"])
            if self.state.settle(order):
                self.save()
        if not e.market_fresh(e.mt5.symbol_info_tick(e.config["symbol"])):
            return "WAIT_FRESH_QUOTE"
        m1 = e.mt5.copy_rates_from_pos(e.config["symbol"], e.mt5.TIMEFRAME_M1, 1, 4096)
        h4 = e.mt5.copy_rates_from_pos(e.config["symbol"], e.mt5.TIMEFRAME_H4, 1, 64)
        if m1 is None or h4 is None or len(m1) < 64 or len(h4) < 4:
            return "LIQH4_WAIT_HISTORY"
        rows, higher = convert(m1), convert(h4)
        if self.state.last_time is None or self.state.last_time < rows[0]["time"] - 60:
            self.state.last_time = self.state.previous_close = None
            # Carry prior locks across a history gap and conservatively exhaust replayed sweeps.
            for side in (-1, 1):
                taken, retries = self.state.levels(side)
                taken.update(retries)
                retries.clear()
            self.state.pending = None
            for b in rows:
                self.state.step(b, higher, allow_retry=False)
            self.save()
            e.lh4_event = None
            return "LIQH4_WARMED_NO_HISTORICAL_ENTRY"
        new = [b for b in rows if b["time"] > self.state.last_time]
        if not new:
            return "PAUSED_SL_TP_ONLY" if paused else "LIQH4_WAIT_NEW_CANDLE"
        event = None
        for bar in new:
            event = self.state.step(bar, higher)
        e.lh4_event = event
        self.save()
        if paused:
            return "PAUSED_SL_TP_ONLY"
        if not event:
            return "LIQH4_WAIT_SIGNAL"
        if not 0 <= e.market_now() - event["time"] - 60 <= 10:
            return "LIQH4_STALE_SIGNAL_SKIPPED"
        # Also block a second position on hedging accounts, including manual trades.
        positions = e.mt5.positions_get(symbol=e.config["symbol"])
        orders = e.mt5.orders_get(symbol=e.config["symbol"])
        if positions is None or orders is None:
            return "LIQH4_BROKER_STATE_UNAVAILABLE"
        if positions or orders or any(s["job"]["action"] == "trade" and s["phase"] in {"waiting", "submitted", "uncertain"}
                                      for s in e.states.values()):
            return "LIQH4_WAIT_FLAT"
        pin = hashlib.sha256((str(account.login)+"@"+account.server).encode()).hexdigest()[:12]
        job = dict(id="lh4-"+pin+"-"+event["key"], action="trade",
                   expires_at=datetime.fromtimestamp(e.clock()+60, timezone.utc).isoformat(),
                   symbol=e.config["symbol"], direction="liquidez_h4", timeframe="M1",
                   signal_bar=event["time"], lh4_key=event["key"], hold_seconds=0,
                   signal_timeout_seconds=60, rr=1.0)
        if job["id"] in e.states:
            return "LIQH4_SIGNAL_CONSUMED"
        self.state.reserve(job["id"], event)
        if self.state.pending is not None:
            self.save()
        e.accept(job)
        e.tick()
        return "LIQH4_SIGNAL_ACCEPTED"
