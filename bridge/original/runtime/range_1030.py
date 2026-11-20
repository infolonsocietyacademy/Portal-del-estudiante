"""NY 10:30-10:45 bid range, first upward quote crossing, one daily attempt."""
from datetime import datetime, timezone, timedelta, date
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
import math
from pathlib import Path
from asset_spec import asset_kind
from gold_scalp_core import atomic, Fault

STRATEGY = "NY_RANGE_1030_1045_BUY_TP1"

def ny_local(stamp):
    # US DST rules since 2007; independent of Windows tzdata installation.
    y = datetime.fromtimestamp(stamp, timezone.utc).year
    march = 8 + (6 - date(y, 3, 8).weekday()) % 7
    november = 1 + (6 - date(y, 11, 1).weekday()) % 7
    start = datetime(y, 3, march, 7, tzinfo=timezone.utc).timestamp()
    end = datetime(y, 11, november, 6, tzinfo=timezone.utc).timestamp()
    return datetime.fromtimestamp(stamp, timezone(timedelta(hours=-4 if start <= stamp < end else -5)))

def window(stamp):
    local = ny_local(stamp)
    start = local.replace(hour=10, minute=30, second=0, microsecond=0)
    return local.date().isoformat(), start.timestamp(), start.timestamp() + 900

def midpoint(high, low, tick):
    return float(((Decimal(str(high)) + Decimal(str(low))) / (2 * Decimal(str(tick)))).to_integral_value(rounding=ROUND_HALF_UP) * Decimal(str(tick)))

class Strategy:
    def __init__(self, engine, directory):
        self.engine = engine
        symbol = engine.config["symbol"]
        if asset_kind(symbol) != "nas100":
            raise Fault("RANGE_NAS100_REQUIRED")
        info = engine.mt5.symbol_info(symbol)
        if info is None or not math.isfinite(info.trade_tick_size) or info.trade_tick_size <= 0:
            raise Fault("RANGE_INVALID_TICK")
        self.tick = float(info.trade_tick_size)
        self.path = Path(directory) / ("ny-range-1030-v1-" + hashlib.sha256(symbol.encode()).hexdigest()[:12] + ".json")
        self.state = json.loads(self.path.read_text()) if self.path.is_file() else {}
        if self.state and (self.state.get("schema") != 1 or self.state.get("symbol") != symbol
                           or type(self.state.get("consumed")) is not bool):
            raise Fault("RANGE_CORRUPT_STATE")
        self.first_poll = True
        self.range = None
        self.last_fetch = None
        self.last_bid = None
        self.code = "RANGE_WAIT_1030_NY"
        engine.range_event = None

    def save(self):
        atomic(self.path, self.state)

    def snapshot(self):
        day, start, end = window(self.engine.clock())
        return dict(range_timezone="America/New_York", range_start="10:30", range_end="10:45",
                    range_day=day, range_high=self.range[0] if self.range else None,
                    range_low=self.range[1] if self.range else None,
                    sl_50=midpoint(*self.range, self.tick) if self.range else None,
                    daily_attempt_consumed=bool(self.state.get("consumed")),
                    entry_limit=1)

    def step(self, paused=False):
        e = self.engine
        if paused:
            for state in list(e.states.values()):
                if state["job"]["action"] == "trade" and state["phase"] == "waiting":
                    state["cancel"] = True
                    e.save(state)
        e.tick()
        account = e.guard(trade=True)
        tick = e.mt5.symbol_info_tick(e.config["symbol"])
        if not e.market_fresh(tick):
            return "RANGE_WAIT_FRESH_QUOTE"
        now = e.clock()
        day, start, end = window(now)
        if self.state.get("day") != day:
            self.state = dict(schema=1, symbol=e.config["symbol"], day=day, consumed=False)
            self.range, self.last_fetch, self.last_bid = None, None, None
            self.save()
        if now < start:
            self.first_poll = False
            return "RANGE_PAUSED" if paused else "RANGE_WAIT_1030_NY"
        minute = int(now) // 60
        loaded_now = False
        if self.range is None and self.last_fetch != minute:
            self.last_fetch = minute
            offset = round((e.market_now() - now) / 900) * 900
            rows = e.mt5.copy_rates_from_pos(e.config["symbol"], e.mt5.TIMEFRAME_M1, 1, 2048)
            if rows is None:
                return "RANGE_WAIT_M1_HISTORY"
            expected_start = int(start + offset)
            chosen = [r for r in rows if expected_start <= int(r["time"]) < expected_start + 900]
            if now < end:
                self.first_poll = False
                return "RANGE_BUILDING_1030_1045_NY"
            if sorted(int(r["time"]) for r in chosen) != list(range(expected_start, expected_start + 900, 60)):
                return "RANGE_INCOMPLETE_15_M1_BARS"
            if any(int(r["time"]) + 60 > e.market_now() for r in chosen):
                return "RANGE_FORMING_BAR_REJECTED"
            hi, lo = max(float(r["high"]) for r in chosen), min(float(r["low"]) for r in chosen)
            if not (math.isfinite(hi) and math.isfinite(lo) and 0 < lo < hi):
                return "RANGE_INVALID_HIGH_LOW"
            self.range = hi, lo
            loaded_now = True
        if self.range is None:
            return "RANGE_BUILDING_1030_1045_NY" if now < end else "RANGE_WAIT_M1_HISTORY"
        if self.state["consumed"]:
            return "RANGE_DAILY_ATTEMPT_CONSUMED"
        hi, lo = self.range
        crossing = float(tick.bid) >= hi + self.tick - 1e-9
        # A restart or delayed historical download must not enter an old breakout.
        late_attach = self.first_poll or (loaded_now and now - end > 5)
        self.first_poll = False
        if late_attach:
            self.state.update(consumed=True, reason="MISSED_BREAKOUT_ON_ATTACH")
            self.save()
            return "RANGE_MISSED_BREAKOUT_SKIPPED"
        self.last_bid = float(tick.bid)
        if not crossing:
            return "RANGE_PAUSED" if paused else "RANGE_WAIT_FIRST_BUY_BREAKOUT"
        self.state.update(consumed=True, reason="FIRST_BREAKOUT", consumed_at=now)
        self.save()  # Persist daily consumption BEFORE any broker request.
        if paused:
            return "RANGE_PAUSED_BREAKOUT_CONSUMED"
        positions = e.mt5.positions_get(symbol=e.config["symbol"])
        orders = e.mt5.orders_get(symbol=e.config["symbol"])
        if positions is None or orders is None:
            return "RANGE_BROKER_STATE_UNAVAILABLE"
        if positions or orders or any(s["job"]["action"] == "trade" and s["phase"] in {"waiting", "submitted", "uncertain"} for s in e.states.values()):
            return "RANGE_FIRST_BREAKOUT_BUSY_SKIPPED"
        key = hashlib.sha256((e.config["symbol"] + "|" + day + "|" + STRATEGY).encode()).hexdigest()[:24]
        signal_bar = int(e.market_now()) // 60 * 60
        e.range_event = dict(key=key, time=signal_bar, utc=now, high=hi, low=lo,
                             sl=midpoint(hi, lo, self.tick))
        pin = hashlib.sha256((str(account.login) + "@" + account.server).encode()).hexdigest()[:12]
        job = dict(id="range-" + pin + "-" + key, action="trade",
                   expires_at=datetime.fromtimestamp(now + 30, timezone.utc).isoformat(),
                   symbol=e.config["symbol"], direction="range_breakout", timeframe="M1",
                   signal_bar=signal_bar, range_key=key, hold_seconds=0,
                   signal_timeout_seconds=30, rr=1.0)
        e.accept(job)
        e.tick()
        state = e.states[job["id"]]
        return "RANGE_BUY_ACCEPTED" if state["phase"] in {"submitted", "open", "uncertain"} else "RANGE_SKIPPED_" + state["code"]

