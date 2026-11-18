"""Validate a live terminal quote stream without assuming the broker clock is UTC."""
from collections import deque
import math
import statistics
import time


class MarketFeed:
    def __init__(self, clock=time.time, monotonic=time.monotonic):
        self.clock, self.monotonic = clock, monotonic
        self.samples = deque(maxlen=6)
        self.last_msc = None
        self.last_change = None
        self.offset = None
        self.raw_age = None
        self.adjusted_age = None
        self.fresh = False

    def observe(self, tick):
        now, steady = self.clock(), self.monotonic()
        try:
            stamp = float(tick.time)
            msc = int(getattr(tick, "time_msc", 0)) or int(stamp*1000)
            if not math.isfinite(stamp) or stamp <= 0:
                raise ValueError("INVALID_TICK_TIME")
            if abs(msc/1000-stamp) > 1.1:
                msc = int(stamp*1000)
        except (AttributeError, TypeError, ValueError, OverflowError):
            self.fresh = False
            return False
        self.raw_age = now-stamp
        if self.last_msc is None:
            self.last_msc = msc
            self.last_change = steady
            self.samples.append((steady,self.raw_age))
        elif msc != self.last_msc:
            elapsed = steady-self.last_change
            advance = (msc-self.last_msc)/1000
            if advance <= 0 or elapsed < 0 or advance > elapsed+10:
                self.samples.clear()
                self.offset = None
            self.samples.append((steady,self.raw_age))
            self.last_msc, self.last_change = msc, steady
        # A frozen old tick never calibrates. Require multiple advancing observations
        # over real elapsed time, a stable clock delta and a plausible timezone offset.
        if len(self.samples) >= 3 and self.samples[-1][0]-self.samples[0][0] >= 2:
            ages = [age for _,age in self.samples]
            candidate = round(statistics.median(ages)/900)*900
            if abs(candidate) <= 14*3600 and max(ages)-min(ages) <= 3 and all(abs(age-candidate) <= 10 for age in ages):
                self.offset = candidate
        delta = self.offset if self.offset is not None else 0
        self.adjusted_age = self.raw_age-delta
        progressing = self.last_change is not None and 0 <= steady-self.last_change <= 10
        self.fresh = abs(self.adjusted_age) <= 10 and progressing
        return self.fresh

    def server_now(self):
        return self.clock()-(self.offset or 0)

    def summary(self):
        return {"quote_age_seconds":None if self.raw_age is None else round(self.raw_age,3),
                "adjusted_quote_age_seconds":None if self.adjusted_age is None else round(self.adjusted_age,3),
                "broker_clock_offset_seconds":self.offset,"advancing_tick_samples":len(self.samples)}

