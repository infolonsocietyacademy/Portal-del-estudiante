"""Native closed-M5 trend structure, BOS then a later confirmed retest.

Two-left/two-right strict pivots; HH/HL buys, LL/LH sells. One setup per
broken pivot. No same-bar retest, historical entry, future pivot or timer exit.
"""
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
from asset_spec import asset_kind

STRATEGY = "MARKET_STRUCTURE_M5_RETEST_TP1"


def valid_bar(b):
    return (isinstance(b, dict) and set(b) == {"time", "open", "high", "low", "close"}
            and type(b["time"]) is int and b["time"] > 0 and b["time"] % 300 == 0
            and all(type(b[k]) in (int, float) and math.isfinite(b[k]) and b[k] > 0
                    for k in ("open", "high", "low", "close"))
            and b["low"] <= min(b["open"], b["close"])
            <= max(b["open"], b["close"]) <= b["high"])


def convert(rows):
    return [{k: int(r[k]) if k == "time" else float(r[k])
             for k in ("time", "open", "high", "low", "close")} for r in rows]


class SignalState:
    def __init__(self, symbol="XAUUSD", tick=.01, state=None):
        if asset_kind(symbol) is None:
            raise ValueError("MS5_SYMBOL_NOT_APPROVED")
        if type(tick) not in (int, float) or not math.isfinite(tick) or tick <= 0:
            raise ValueError("MS5_INVALID_TICK")
        self.symbol, self.tick = symbol, float(tick)
        self.bars, self.highs, self.lows = [], [], []
        self.used_high = self.used_low = None
        self.pending = None
        self.code = "MS5_WAIT_STRUCTURE"
        if state is not None:
            if not isinstance(state, dict) or state.get("schema") != 1:
                raise ValueError("MS5_CORRUPT_STATE")
            if state.get("symbol") != symbol or state.get("tick") != self.tick:
                raise ValueError("MS5_SETTINGS_CHANGED")
            bars = state.get("bars")
            if (not isinstance(bars, list) or len(bars) > 160 or not all(map(valid_bar, bars))
                    or any(a["time"] >= b["time"] for a, b in zip(bars, bars[1:]))):
                raise ValueError("MS5_CORRUPT_STATE")
            last = bars[-1]["time"] if bars else 0
            for name in ("highs", "lows"):
                pivots = state.get(name)
                if (not isinstance(pivots, list) or len(pivots) > 2
                        or any(not isinstance(p, dict) or set(p) != {"time", "price"}
                               or type(p["time"]) is not int or p["time"] % 300
                               or not 0 < p["time"] <= last - 600
                               or type(p["price"]) not in (int, float)
                               or not math.isfinite(p["price"]) or p["price"] <= 0 for p in pivots)
                        or any(a["time"] >= b["time"] for a, b in zip(pivots, pivots[1:]))):
                    raise ValueError("MS5_CORRUPT_STATE")
                setattr(self, name, pivots)
            for name in ("used_high", "used_low"):
                value = state.get(name)
                if value is not None and (type(value) is not int or value % 300 or not 0 < value <= last):
                    raise ValueError("MS5_CORRUPT_STATE")
                setattr(self, name, value)
            pending = state.get("pending")
            if pending is not None:
                if (not isinstance(pending, dict)
                        or set(pending) != {"side", "level", "swing", "born", "tolerance"}
                        or type(pending["side"]) is not int or pending["side"] not in (-1, 1)
                        or type(pending["born"]) is not int or pending["born"] % 300
                        or not 0 < pending["born"] <= last
                        or any(type(pending[k]) not in (int, float)
                               or not math.isfinite(pending[k]) or pending[k] <= 0
                               for k in ("level", "swing", "tolerance"))
                        or pending["side"] * (pending["level"] - pending["swing"]) <= 0):
                    raise ValueError("MS5_CORRUPT_STATE")
            self.bars, self.pending = bars, pending
            self.code = "MS5_WAIT_RETEST" if pending else "MS5_WAIT_STRUCTURE"

    @property
    def last_time(self):
        return self.bars[-1]["time"] if self.bars else None

    def dump(self):
        return dict(schema=1, symbol=self.symbol, tick=self.tick, bars=self.bars,
                    highs=self.highs, lows=self.lows, used_high=self.used_high,
                    used_low=self.used_low, pending=self.pending)

    def step(self, bar):
        if not valid_bar(bar) or self.last_time is not None and bar["time"] <= self.last_time:
            raise ValueError("MS5_INVALID_OR_NON_MONOTONIC_BAR")
        previous = self.bars[-1]["close"] if self.bars else None
        prior = self.bars
        atr_rows = (prior + [bar])[-15:]
        atr = (sum(max(b["high"] - b["low"], abs(b["high"] - a["close"]),
                       abs(b["low"] - a["close"]))
                   for a, b in zip(atr_rows, atr_rows[1:])) / 14
               if len(atr_rows) == 15 else 0.)
        setup = None
        if previous is not None and len(self.highs) == len(self.lows) == 2 and atr > 0:
            old_h, h = self.highs
            old_l, l = self.lows
            bullish = h["price"] > old_h["price"] and l["price"] > old_l["price"]
            bearish = h["price"] < old_h["price"] and l["price"] < old_l["price"]
            if (bullish and self.used_high != h["time"] and previous <= h["price"]
                    and bar["close"] >= h["price"] + self.tick - 1e-9
                    and bar["close"] > bar["open"]):
                self.used_high = h["time"]
                setup = dict(side=1, level=h["price"], swing=l["price"],
                             born=bar["time"], tolerance=max(self.tick, atr * .1))
            elif (bearish and self.used_low != l["time"] and previous >= l["price"]
                    and bar["close"] <= l["price"] - self.tick + 1e-9
                    and bar["close"] < bar["open"]):
                self.used_low = l["time"]
                setup = dict(side=-1, level=l["price"], swing=h["price"],
                             born=bar["time"], tolerance=max(self.tick, atr * .1))
        event = None
        if setup is not None:
            self.pending = setup
            self.code = "MS5_WAIT_RETEST"
        elif self.pending is not None:
            p = self.pending
            side = p["side"]
            if bar["time"] - p["born"] > 12 * 300:
                self.pending = None
                self.code = "MS5_RETEST_EXPIRED"
            elif side * (bar["close"] - p["swing"]) <= 0:
                self.pending = None
                self.code = "MS5_STRUCTURE_INVALIDATED"
            else:
                touch = bar["low"] <= p["level"] + p["tolerance"] and bar["high"] >= p["level"] - p["tolerance"]
                rejection = side * (bar["close"] - p["level"]) > 0 and side * (bar["close"] - bar["open"]) > 0
                if bar["time"] > p["born"] and touch and rejection:
                    key = hashlib.sha256(f"MS5|{self.symbol}|{p['born']}|{bar['time']}|{side}".encode()).hexdigest()[:24]
                    sl = min(p["swing"], bar["low"]) - 5 * self.tick if side > 0 else max(p["swing"], bar["high"]) + 5 * self.tick
                    event = dict(key=key, time=bar["time"], side=side, entry=bar["close"],
                                 sl_bid=sl, hi=bar["high"], lo=bar["low"],
                                 level=p["level"], bos_time=p["born"])
                    self.pending = None
                    self.code = "MS5_RETEST_CONFIRMED"
                else:
                    self.code = "MS5_WAIT_RETEST"
        else:
            self.code = "MS5_WAIT_STRUCTURE"
        self.bars = (self.bars + [dict(bar)])[-160:]
        # A pivot becomes knowable only after two later candles have CLOSED.
        if len(self.bars) >= 5:
            window = self.bars[-5:]
            candidate = window[2]
            others = window[:2] + window[3:]
            if all(candidate["high"] > b["high"] for b in others):
                self.highs = (self.highs + [dict(time=candidate["time"], price=candidate["high"])])[-2:]
            if all(candidate["low"] < b["low"] for b in others):
                self.lows = (self.lows + [dict(time=candidate["time"], price=candidate["low"])])[-2:]
        return event


class Strategy:
    def __init__(self, engine, directory):
        self.engine = engine
        symbol = engine.config["symbol"]
        suffix = "" if asset_kind(symbol) == "gold" else "-" + hashlib.sha256(symbol.encode()).hexdigest()[:12]
        self.path = Path(directory) / ("market-structure-m5-v1" + suffix + ".json")
        info = engine.mt5.symbol_info(engine.config["symbol"])
        if info is None:
            raise ValueError("MS5_SYMBOL_UNAVAILABLE")
        saved = json.loads(self.path.read_text()) if self.path.is_file() else None
        self.state = SignalState(engine.config["symbol"], float(info.trade_tick_size), saved)
        engine.ms5_event = None

    def save(self):
        from gold_scalp_core import atomic
        atomic(self.path, self.state.dump())

    def step(self, paused=False):
        e = self.engine
        if paused:
            for s in list(e.states.values()):
                if s["job"]["action"] == "trade" and s["phase"] == "waiting":
                    s["cancel"] = True
                    e.save(s)
        e.tick()
        account = e.guard(trade=True)
        if not e.market_fresh(e.mt5.symbol_info_tick(e.config["symbol"])):
            return "WAIT_FRESH_QUOTE"
        raw = e.mt5.copy_rates_from_pos(e.config["symbol"], e.mt5.TIMEFRAME_M5, 1, 512)
        if raw is None or len(raw) < 64:
            return "MS5_WAIT_HISTORY"
        rows = convert(raw)
        # Defend against an unexpected chronological order or a forming candle.
        if (any(not valid_bar(b) for b in rows)
                or any(a["time"] >= b["time"] for a, b in zip(rows, rows[1:]))
                or rows[-1]["time"] + 300 > e.market_now()):
            return "MS5_INVALID_HISTORY"
        if self.state.last_time is None or self.state.last_time < rows[0]["time"] - 300:
            self.state = SignalState(self.state.symbol, self.state.tick)
            for b in rows:
                self.state.step(b)
            # An old BOS must never cause a new order after installation/recovery.
            self.state.pending = None
            self.state.code = "MS5_WAIT_STRUCTURE"
            self.save()
            return "MS5_WARMED_NO_HISTORICAL_ENTRY"
        event = None
        new = [b for b in rows if b["time"] > self.state.last_time]
        if not new:
            return "PAUSED_SL_TP_ONLY" if paused else self.state.code
        for b in new:
            event = self.state.step(b)
        e.ms5_event = event
        self.save()  # Cursor/setup consumed durably BEFORE accepting any order.
        if paused:
            return "PAUSED_SL_TP_ONLY"
        if event is None:
            return self.state.code
        if not 0 <= e.market_now() - event["time"] - 300 <= 10:
            return "MS5_STALE_SIGNAL_SKIPPED"
        positions = e.mt5.positions_get(symbol=e.config["symbol"])
        orders = e.mt5.orders_get(symbol=e.config["symbol"])
        if positions is None or orders is None:
            return "MS5_BROKER_STATE_UNAVAILABLE"
        if positions or orders or any(s["job"]["action"] == "trade" and s["phase"] in {"waiting", "submitted", "uncertain"}
                                      for s in e.states.values()):
            return "MS5_WAIT_FLAT"
        pin = hashlib.sha256((str(account.login) + "@" + account.server).encode()).hexdigest()[:12]
        job = dict(id="ms5-" + pin + "-" + event["key"], action="trade",
                   expires_at=datetime.fromtimestamp(e.clock() + 60, timezone.utc).isoformat(),
                   symbol=e.config["symbol"], direction="structure_retest", timeframe="M5",
                   signal_bar=event["time"], ms5_key=event["key"], hold_seconds=0,
                   signal_timeout_seconds=60, rr=1.0)
        if job["id"] in e.states:
            return "MS5_SIGNAL_CONSUMED"
        e.accept(job)
        e.tick()
        return "MS5_SIGNAL_ACCEPTED"
