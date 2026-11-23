"""H4 liquidity sweep strategy. Pure signals plus the guarded DEMO adapter.

H4 candles are native broker candles, never approximated from a UTC grouping.
Uses only completed H4 candles and closed M1 candles. All consumed levels and
the cursor are persisted before order acceptance. Historical warm-up never trades.
"""
import hashlib
import json
import math
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
        if state is not None:
            self.restore(state)

    def dump(self):
        return dict(schema=1, symbol=self.symbol, tick=self.tick, pivots=self.pivots,
                    last_time=self.last_time, previous_close=self.previous_close,
                    highs_taken=sorted(self.highs_taken), lows_taken=sorted(self.lows_taken))

    def restore(self, data):
        if not isinstance(data, dict) or set(data) != set(self.dump()) or data["schema"] != 1:
            raise ValueError("LIQH4_CORRUPT_SIGNAL_STATE")
        if (data["symbol"], data["tick"], data["pivots"]) != (self.symbol, self.tick, self.pivots):
            raise ValueError("LIQH4_STATE_SETTINGS_CHANGED")
        last, close = data["last_time"], data["previous_close"]
        if not (last is None and close is None):
            if (type(last) is not int or last <= 0 or last % 60 or type(close) not in (int, float)
                    or not math.isfinite(close) or close <= 0):
                raise ValueError("LIQH4_CORRUPT_SIGNAL_STATE")
        for key in ("highs_taken", "lows_taken"):
            values = data[key]
            if (not isinstance(values, list) or len(values) > 3 or len(set(values)) != len(values)
                    or any(type(t) is not int or t <= 0 or t % 60 or last is None or t > last for t in values)):
                raise ValueError("LIQH4_CORRUPT_SIGNAL_STATE")
        self.last_time, self.previous_close = last, close
        self.highs_taken, self.lows_taken = set(data["highs_taken"]), set(data["lows_taken"])

    def step(self, bar, h4):
        if not valid_bar(bar) or any(not valid_bar(b) for b in h4):
            raise ValueError("LIQH4_INVALID_CLOSED_BAR")
        if self.last_time is not None and bar["time"] <= self.last_time:
            raise ValueError("LIQH4_NON_MONOTONIC_BAR")
        if any(a["time"] >= b["time"] for a, b in zip(h4, h4[1:])):
            raise ValueError("LIQH4_INVALID_H4_ORDER")
        # A candle must have fully closed BEFORE the signal candle opens.
        closed = [b for b in h4 if b["time"] + 14400 <= bar["time"]][-4:][::-1]
        buy = sell = False
        if len(closed) == 4:
            active = {b["time"] for b in closed[:3]}
            self.highs_taken &= active
            self.lows_taken &= active
            for i, level in enumerate(closed[:3]):
                origin = level["time"]
                ph = i > 0 and level["high"] > closed[i-1]["high"] and level["high"] > closed[i+1]["high"]
                pl = i > 0 and level["low"] < closed[i-1]["low"] and level["low"] < closed[i+1]["low"]
                if origin not in self.highs_taken and bar["high"] > level["high"]:
                    sell |= (self.previous_close is not None and self.previous_close <= level["high"]
                             and bar["close"] < level["high"]
                             and bar["high"] - level["high"] >= self.tick - 1e-10
                             and (not self.pivots or ph))
                    self.highs_taken.add(origin)
                if origin not in self.lows_taken and bar["low"] < level["low"]:
                    buy |= (self.previous_close is not None and self.previous_close >= level["low"]
                            and bar["close"] > level["low"]
                            and level["low"] - bar["low"] >= self.tick - 1e-10
                            and (not self.pivots or pl))
                    self.lows_taken.add(origin)
        self.last_time, self.previous_close = bar["time"], bar["close"]
        side = 1 if buy and not sell and bar["close"] > bar["open"] else -1 if sell and not buy and bar["close"] < bar["open"] else 0
        if not side:
            return None
        key = hashlib.sha256(f"LIQH4|{self.symbol}|{bar['time']}|{side}".encode()).hexdigest()[:24]
        return dict(key=key, time=bar["time"], side=side, entry=bar["close"],
                    sl_bid=bar["low"]-5*self.tick if side > 0 else bar["high"]+5*self.tick,
                    hi=bar["high"], lo=bar["low"])


def convert(rows):
    return [{k: int(r[k]) if k == "time" else float(r[k])
             for k in ("time", "open", "high", "low", "close")} for r in rows]


class Strategy:
    def __init__(self, engine, directory):
        self.engine = engine
        self.path = Path(directory) / "liquidez-h4-signal.json"
        info = engine.mt5.symbol_info(engine.config["symbol"])
        if info is None:
            raise ValueError("LIQH4_SYMBOL_UNAVAILABLE")
        saved = json.loads(self.path.read_text()) if self.path.is_file() else None
        self.state = SignalState(engine.config["symbol"], float(info.trade_tick_size), saved)
        engine.lh4_event = None

    def step(self, paused=False):
        from gold_scalp_core import atomic
        e = self.engine
        if paused:
            for s in e.states.values():
                if s["job"]["action"] == "trade" and s["phase"] == "waiting":
                    s["cancel"] = True
                    e.save(s)
        e.tick()
        account = e.guard(trade=True)
        if not e.market_fresh(e.mt5.symbol_info_tick(e.config["symbol"])):
            return "WAIT_FRESH_QUOTE"
        m1 = e.mt5.copy_rates_from_pos(e.config["symbol"], e.mt5.TIMEFRAME_M1, 1, 4096)
        h4 = e.mt5.copy_rates_from_pos(e.config["symbol"], e.mt5.TIMEFRAME_H4, 1, 64)
        if m1 is None or h4 is None or len(m1) < 64 or len(h4) < 4:
            return "LIQH4_WAIT_HISTORY"
        rows, higher = convert(m1), convert(h4)
        if self.state.last_time is None or self.state.last_time < rows[0]["time"] - 60:
            self.state = SignalState(e.config["symbol"], self.state.tick)
            for b in rows:
                self.state.step(b, higher)
            atomic(self.path, self.state.dump())
            e.lh4_event = None
            return "LIQH4_WARMED_NO_HISTORICAL_ENTRY"
        new = [b for b in rows if b["time"] > self.state.last_time]
        if not new:
            return "PAUSED_SL_TP_ONLY" if paused else "LIQH4_WAIT_NEW_CANDLE"
        event = None
        for bar in new:
            event = self.state.step(bar, higher)
        e.lh4_event = event
        atomic(self.path, self.state.dump())
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
        e.accept(job)
        e.tick()
        return "LIQH4_SIGNAL_ACCEPTED"
