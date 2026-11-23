"""Resident DEMO command engine. MT5 access is injected; importing never trades."""
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import time
from asset_spec import metadata_matches

VERSION = "1.0.39"
LIVE_PHASES = {"waiting", "submitted", "open", "closing", "uncertain"}
FINAL_PHASES = {"done", "failed"}

class Fault(Exception):
    pass

def need(condition, code):
    if not condition:
        raise Fault(code)

def finite(value, low, high):
    return type(value) in (int, float) and math.isfinite(value) and low <= value <= high

def expiry(value):
    try:
        need(isinstance(value, str), "INVALID_EXPIRY")
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        need(dt.tzinfo is not None, "INVALID_EXPIRY")
        return dt.timestamp()
    except (ValueError, TypeError):
        raise Fault("INVALID_EXPIRY") from None

def fingerprint(job):
    return hashlib.sha256(json.dumps(job, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

def magic_for(jid):
    return (1 << 52) + int(hashlib.sha256(jid.encode()).hexdigest()[:12], 16)

def validate(job, symbol, now=None):
    need(isinstance(job, dict), "INVALID_TASK")
    need(isinstance(job.get("id"), str) and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", job["id"]), "INVALID_TASK_ID")
    action = job.get("action")
    allowed = {"id", "action", "expires_at"}
    if action == "trade":
        allowed |= {"symbol", "direction", "timeframe", "hold_seconds", "signal_timeout_seconds", "lots", "risk_percent", "rr", "sl_distance", "tp_distance", "signal_bar", "ms5_key", "range_key"}
        need(job.get("symbol") == symbol, "SYMBOL_NOT_LOCALLY_APPROVED")
        need(job.get("direction") in {"buy", "sell", "structure", "structure_retest", "range_breakout"}, "INVALID_DIRECTION")
        manual = job.get("direction") in {"buy", "sell"} and "sl_distance" in job
        need(job.get("timeframe") in {"M1", "M5"} or (manual and "timeframe" not in job), "INVALID_TIMEFRAME")
        if "sl_distance" in job:
            need(manual and finite(job["sl_distance"], 0.1, 50.0), "INVALID_MANUAL_STOP")
        if "tp_distance" in job:
            need(manual and finite(job["tp_distance"], 0.1, 250.0), "INVALID_MANUAL_TARGET")
        need(type(job.get("hold_seconds")) is int and job["hold_seconds"] == 0, "BROKER_SL_TP_ONLY")
        if "signal_bar" in job:
            need(job["direction"] in {"structure", "structure_retest", "range_breakout"} and type(job["signal_bar"]) is int and job["signal_bar"] > 0, "INVALID_SIGNAL_BAR")
        if job['direction']=='structure_retest':
            need(job.get('timeframe')=='M5' and type(job.get('signal_bar')) is int and job['signal_bar']%300==0,
                 'MS5_CLOSED_M5_REQUIRED')
            need(isinstance(job.get('ms5_key'),str) and re.fullmatch(r'[0-9a-f]{24}',job['ms5_key']), 'MS5_EVENT_KEY_REQUIRED')
            need(job.get('rr')==1.0, 'MS5_TP1_ONE_R_REQUIRED')
        elif 'ms5_key' in job:
            raise Fault('MS5_EVENT_KEY_WRONG_DIRECTION')
        if job['direction'] == 'range_breakout':
            need(job.get('timeframe') == 'M1' and type(job.get('signal_bar')) is int and job['signal_bar'] % 60 == 0, 'RANGE_M1_REQUIRED')
            need(isinstance(job.get('range_key'), str) and re.fullmatch(r'[0-9a-f]{24}', job['range_key']), 'RANGE_KEY_REQUIRED')
            need(job.get('rr') == 1.0, 'RANGE_TP1_ONE_R_REQUIRED')
        elif 'range_key' in job:
            raise Fault('RANGE_KEY_WRONG_DIRECTION')
        need(type(job.get("signal_timeout_seconds", 1800)) is int and 30 <= job.get("signal_timeout_seconds", 1800) <= 3600, "INVALID_SIGNAL_TIMEOUT")
        need(not ("lots" in job and "risk_percent" in job), "ONE_SIZE_MODE_REQUIRED")
        if "lots" in job:
            need(finite(job["lots"], 0.001, 1.0), "INVALID_LOTS")
        if "risk_percent" in job:
            need(finite(job["risk_percent"], 0.05, 2.0), "INVALID_RISK")
        need(finite(job.get("rr", 2.0), 1.0, 5.0), "INVALID_RR")
    else:
        need(action in {"ping", "diagnose", "status"}, "ACTION_NOT_ALLOWED")
    need(not set(job) - allowed, "UNKNOWN_TASK_FIELD")
    need(expiry(job.get("expires_at")) > (time.time() if now is None else now), "TASK_EXPIRED")
    return job

def structure_signal(rates):
    """Newest CLOSED bar at index 0; pivots confirmed before the crossing bar."""
    if len(rates) < 64:
        return 0, 0.0, 0.0
    highs, lows = [], []
    for i in range(4, len(rates) - 2):
        if all(rates[i]["high"] > rates[i + k]["high"] for k in (-2, -1, 1, 2)):
            if len(highs) < 2:
                highs.append(rates[i]["high"])
        if all(rates[i]["low"] < rates[i + k]["low"] for k in (-2, -1, 1, 2)):
            if len(lows) < 2:
                lows.append(rates[i]["low"])
        if len(highs) == len(lows) == 2:
            break
    if len(highs) < 2 or len(lows) < 2:
        return 0, 0.0, 0.0
    bar, previous = rates[0], rates[1]
    if highs[0] > highs[1] and lows[0] > lows[1] and previous["close"] <= highs[0] < bar["close"] and bar["close"] > bar["open"]:
        return 1, lows[0], highs[0]
    if highs[0] < highs[1] and lows[0] < lows[1] and previous["close"] >= lows[0] > bar["close"] and bar["close"] < bar["open"]:
        return -1, highs[0], lows[0]
    return 0, 0.0, 0.0

def closed_atr(rates):
    need(len(rates) >= 15, "WAIT_HISTORY")
    values = [max(float(rates[i]["high"]) - float(rates[i]["low"]),
                  abs(float(rates[i]["high"]) - float(rates[i+1]["close"])),
                  abs(float(rates[i]["low"]) - float(rates[i+1]["close"]))) for i in range(14)]
    atr = sum(values) / 14
    need(finite(atr, 1e-8, 1e6), "WAIT_HISTORY")
    return atr

def lots_for(mode, requested, budget, loss_per_lot, minimum, maximum, step):
    need(all(finite(x, 1e-12, 1e12) for x in (loss_per_lot, minimum, maximum, step)), "INVALID_VOLUME_METADATA")
    desired = requested if mode == "fixed" else budget / loss_per_lot
    if not finite(desired, minimum - 1e-10, min(maximum, 1.0) + 1e-10):
        if mode == "fixed" or desired < minimum:
            raise Fault("VOLUME_OUTSIDE_LIMIT")
        desired = min(maximum, 1.0)
    volume = round(math.floor((desired + 1e-12) / step) * step, 8)
    need(volume >= minimum - 1e-10 and volume <= min(maximum, 1.0) + 1e-10, "VOLUME_OUTSIDE_LIMIT")
    if mode == "fixed":
        need(abs(volume - requested) < 1e-8, "FIXED_LOTS_NOT_ON_BROKER_STEP")
    need(mode == "fixed" or volume * loss_per_lot <= budget + 1e-7, "RISK_BUDGET_EXCEEDED")
    return volume

def atomic(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.flush()
        import os
        os.fsync(stream.fileno())
    tmp.replace(path)

class Engine:
    def __init__(self, mt5, state_dir, expected, terminal, config, clock=time.time):
        self.mt5, self.clock = mt5, clock
        self.feed = None
        self.dir = Path(state_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.expected, self.terminal, self.config = expected, str(Path(terminal).resolve()), config
        self.states = {}
        for path in self.dir.glob("*.json"):
            state = json.loads(path.read_text(encoding="utf-8"))
            need(state.get("id") == path.stem, "CORRUPT_LOCAL_STATE")
            self.states[state["id"]] = state

    def save(self, state):
        state["updated_at"] = self.clock()
        atomic(self.dir / (state["id"] + ".json"), state)
        self.states[state["id"]] = state

    def event(self, state, event, **values):
        row = {"time_utc": datetime.fromtimestamp(self.clock(), timezone.utc).isoformat(), "id": state["id"], "event": event, **values}
        with (self.dir.parent / "operaciones.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")

    def guard(self, trade=False):
        terminal, account = self.mt5.terminal_info(), self.mt5.account_info()
        need(terminal is not None and terminal.connected, "MT5_DISCONNECTED")
        need(str(Path(terminal.path).resolve()).casefold() == self.terminal.casefold(), "WRONG_TERMINAL")
        need(account is not None and account.trade_mode == self.mt5.ACCOUNT_TRADE_MODE_DEMO, "DEMO_ONLY")
        need(str(account.login) == str(self.expected["login"]) and account.server == self.expected["server"], "ACCOUNT_CHANGED")
        if trade:
            need(terminal.trade_allowed and not terminal.tradeapi_disabled and account.trade_allowed and account.trade_expert, "PYTHON_TRADING_DISABLED")
        return account

    def read_account(self, state):
        self.guard()
        positions = self.mt5.positions_get(symbol=state["job"]["symbol"])
        orders = self.mt5.orders_get(symbol=state["job"]["symbol"])
        need(positions is not None and orders is not None, "MT5_STATE_UNAVAILABLE")
        return positions, orders

    def own(self, state):
        positions, orders = self.read_account(state)
        magic = magic_for(state["id"])
        return [p for p in positions if p.magic == magic], [o for o in orders if o.magic == magic]

    def bars(self, job):
        tf = self.mt5.TIMEFRAME_M1 if job["timeframe"] == "M1" else self.mt5.TIMEFRAME_M5
        rows = self.mt5.copy_rates_from_pos(job["symbol"], tf, 1, 512 if job.get("direction")=="structure_retest" else 96)
        need(rows is not None and len(rows) >= 64, "WAIT_HISTORY")
        return [{k: float(r[k]) if k != "time" else int(r[k]) for k in ("time", "open", "high", "low", "close")} for r in reversed(rows)]

    def summary(self, state):
        safe = {k: state[k] for k in ("id", "phase", "code", "updated_at", "retcode", "volume", "open_price", "close_price", "profit", "entry_deals", "exit_deals", "owned_open_positions", "floating_profit", "held_seconds", "side", "requested_volume", "remaining_volume","submitted_sl","submitted_tp","requested_price","target_r") if k in state}
        safe.update(schema=2, version=VERSION, status="succeeded" if state["phase"] == "done" else "failed" if state["phase"] == "failed" else "running",
                    task_sha256=state["fingerprint"])
        if state["job"]["action"] == "trade":
            safe.update(symbol=state["job"]["symbol"], period=state["job"].get("timeframe","MANUAL"), hold_seconds=state["job"].get("hold_seconds", 300))
        if "diagnostics" in state:
            safe["diagnostics"]=state["diagnostics"]
        return safe

    def market_fresh(self, tick):
        if self.feed is not None:
            return self.feed.observe(tick)
        return tick is not None and abs(self.clock()-float(tick.time)) <= 10

    def market_now(self):
        return self.feed.server_now() if self.feed is not None else self.clock()

    def diagnostics(self):
        account=self.guard()
        info=self.mt5.terminal_info()
        tick=self.mt5.symbol_info_tick(self.config["symbol"])
        age=None if tick is None else round(self.clock()-float(tick.time),3)
        spread=None if tick is None else round(float(tick.ask)-float(tick.bid),8)
        fresh=self.market_fresh(tick) and spread is not None and spread>0
        permissions=bool(info.trade_allowed and not info.tradeapi_disabled and account.trade_allowed and account.trade_expert)
        return {**(self.feed.summary() if self.feed is not None else {}),"terminal_connected":True,"account_type_verified":"demo","python_trading_allowed":permissions,
                "quote_age_seconds":age,"spread_price":spread,"quote_fresh":fresh,
                "trade_ready":permissions and fresh and spread<=self.config["max_spread_price"],
                "code":"RESIDENT_READY" if permissions and fresh and spread<=self.config["max_spread_price"] else "PYTHON_TRADING_DISABLED" if not permissions else "QUOTE_STALE" if not fresh else "SPREAD_FILTER"}

    def accept(self, job):
        jid = job.get("id", "") if isinstance(job, dict) else ""
        if jid in self.states:
            need(self.states[jid]["fingerprint"] == fingerprint(job), "TASK_ID_REUSED")
            return self.summary(self.states[jid])
        validate(job, self.config["symbol"], self.clock())
        self.guard()
        if job.get('direction')=='structure_retest':
            need(not any(v['job'].get('direction')=='structure_retest' and v['job'].get('ms5_key')==job['ms5_key']
                         for v in self.states.values()), 'MS5_EVENT_ALREADY_CONSUMED')
        if job.get('direction') == 'range_breakout':
            need(not any(v['job'].get('direction') == 'range_breakout' and v['job'].get('range_key') == job['range_key'] for v in self.states.values()), 'RANGE_EVENT_ALREADY_CONSUMED')
        state = {"id": jid, "job": job, "fingerprint": fingerprint(job), "phase": "done", "code": "OK", "created_at": self.clock()}
        action = job["action"]
        if action == "trade":
            # No fixed command-count cap. Reconcile each send before the next one.
            state.update(phase="waiting", code="WAIT_SIGNAL", last_bar=0,
                         deadline=min(expiry(job["expires_at"]), self.clock()+job.get("signal_timeout_seconds",1800)))
            if job["direction"] in {"structure", "structure_retest"}:
                try:
                    state["last_bar"] = job["signal_bar"] - 1 if "signal_bar" in job else self.bars(job)[0]["time"]
                except Fault:
                    pass
        elif action == "ping":
            state["code"] = "PONG_RESIDENT"
        elif action == "diagnose":
            try:
                self.guard(trade=True)
                state["diagnostics"]=self.diagnostics()
                state["code"] = state["diagnostics"]["code"]
            except Fault as exc:
                state["code"] = str(exc)
        elif action == "status":
            state["code"] = "RESIDENT_STATUS"
        self.save(state)
        return self.summary(state)

    def request(self, state):
        job, m = state["job"], self.mt5
        need(job.get("direction") not in {"crt", "breakfake", "structure", "liquidez_h4"}, "RETIRED_STRATEGY")
        account = self.guard(trade=True)
        need(not any(other["id"] != state["id"] and other["phase"] in {"submitted", "uncertain"} for other in self.states.values()), "WAIT_RECONCILIATION")
        symbol = job["symbol"]
        need(m.symbol_select(symbol, True), "SYMBOL_UNAVAILABLE")
        info, tick = m.symbol_info(symbol), m.symbol_info_tick(symbol)
        need(info is not None and tick is not None and finite(tick.bid,1e-9,1e9) and finite(tick.ask,tick.bid+1e-12,1e9), "QUOTE_UNAVAILABLE")
        need(metadata_matches(symbol, info), "WRONG_SYMBOL")
        need(self.market_fresh(tick), "WAIT_FRESH_QUOTE")
        need(tick.ask - tick.bid <= self.config["max_spread_price"], "WAIT_SPREAD")
        positions, orders = self.read_account(state)
        if job["direction"] in {"structure_retest", "range_breakout"} or account.margin_mode != m.ACCOUNT_MARGIN_MODE_RETAIL_HEDGING:
            need(not positions and not orders, "NETTING_POSITION_CONFLICT")
        manual = job["direction"] in {"buy","sell"} and "sl_distance" in job
        side, swing, level = 0, 0.0, 0.0
        gap = info.trade_stops_level*info.point + tick.ask-tick.bid + 2*info.point
        if job['direction'] == 'range_breakout':
            event = getattr(self, 'range_event', None)
            need(isinstance(event, dict) and event.get('key') == job['range_key'] and event.get('time') == job['signal_bar'], 'RANGE_EVENT_NOT_VERIFIED')
            need(0 <= self.clock() - event['utc'] <= 2, 'RANGE_SIGNAL_EXPIRED')
            need(tick.bid >= event['high'] + info.trade_tick_size - 1e-9, 'RANGE_BREAKOUT_NO_LONGER_VALID')
            side, entry, swing = 1, float(tick.ask), event['sl']
            risk, cap = entry - swing, self.config['max_stop_price']
            need(gap <= risk <= cap, 'RANGE_STOP_OUTSIDE_BROKER_LIMIT')
        elif manual:
            side = 1 if job["direction"]=="buy" else -1
            entry = float(tick.ask if side>0 else tick.bid)
            risk = float(job["sl_distance"])
            need(gap <= risk <= self.config["max_stop_price"],"MANUAL_STOP_OUTSIDE_BROKER_LIMIT")
            cap = self.config["max_stop_price"]
        else:
            rates = self.bars(job)
            atr = closed_atr(rates)
            if job["direction"] in {"structure", "structure_retest"}:
                seconds = 60 if job["timeframe"] == "M1" else 300
                if "signal_bar" in job:
                    need(rates[0]["time"] == job["signal_bar"], "WAIT_SIGNAL_BAR")
                if not state["last_bar"]:
                    state["last_bar"] = rates[0]["time"]
                    self.save(state)
                    raise Fault("WAIT_NEW_CANDLE")
                need(rates[0]["time"] > state["last_bar"], "WAIT_NEW_CANDLE")
                state["last_bar"] = rates[0]["time"]
                self.save(state)
                if job['direction']=='structure_retest':
                    event=getattr(self,'ms5_event',None)
                    need(isinstance(event,dict) and event.get('key')==job['ms5_key'] and event.get('time')==job['signal_bar'], 'MS5_EVENT_NOT_VERIFIED')
                    side=event['side']
                    swing=event['sl_bid']+(tick.ask-tick.bid if side<0 else 0.)
                    need(side in (-1,1), 'MS5_EVENT_NOT_VERIFIED')
                else:
                    side, swing, level = structure_signal(rates)
                    need(side != 0, "WAIT_STRUCTURE")
                need(0 <= self.market_now() - rates[0]["time"] - seconds <= 10, "WAIT_FRESH_SIGNAL")
            else:
                side = 1 if job["direction"] == "buy" else -1
            entry = float(tick.ask if side > 0 else tick.bid)
            if level:
                need((entry > level if side > 0 else entry < level) and abs(entry-rates[0]["close"]) <= max(0.25*atr,self.config["max_spread_price"]), "WAIT_VALID_ENTRY")
            risk = max(atr, gap, entry-(swing-0.2*atr) if side>0 and swing else (swing+0.2*atr)-entry if side<0 and swing else 1.2*atr)
            if job['direction']=='structure_retest':
                need(abs(entry-event['entry'])<=max(.25*(event['hi']-event['lo']),self.config['max_spread_price']), 'MS5_ENTRY_MOVED_TOO_FAR')
                risk=side*(entry-swing)
                need(risk>=gap, 'MS5_STRUCTURAL_STOP_TOO_CLOSE')
            cap = self.config["max_stop_price"] if job["direction"] == 'structure_retest' else min(4*atr,self.config["max_stop_price"])
            need(finite(risk, 1e-8, cap), "WAIT_STOP_FILTER")
        step = float(info.trade_tick_size)
        need(step > 0, "INVALID_TICK_SIZE")
        sl = round((math.floor((entry-risk)/step) if side>0 else math.ceil((entry+risk)/step))*step, info.digits)
        if job['direction']=='structure_retest':
            from decimal import Decimal,ROUND_FLOOR,ROUND_CEILING
            grid=Decimal(str(step))
            sl=float((Decimal(str(swing))/grid).to_integral_value(rounding=ROUND_FLOOR if side>0 else ROUND_CEILING)*grid)
        if job['direction'] == 'range_breakout':
            sl = float(swing)
        risk = abs(entry-sl)
        need(risk <= cap + (0 if job['direction'] in {'structure_retest', 'range_breakout'} else info.point), "WAIT_STOP_FILTER")
        distance = float(job.get("tp_distance",job.get("rr",2.0)*risk))
        need(distance >= gap,"MANUAL_TARGET_OUTSIDE_BROKER_LIMIT")
        tp = round((math.ceil((entry+distance)/step) if side>0 else math.floor((entry-distance)/step))*step,info.digits)
        if job['direction'] in {'structure_retest', 'range_breakout'}:
            from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR
            grid = Decimal(str(step))
            entry_d=Decimal(str(entry));sl_d=Decimal(str(sl))
            risk_d=side*(entry_d-sl_d)
            target_d=entry_d+side*risk_d
            tp=float((target_d/grid).to_integral_value(rounding=ROUND_CEILING if side>0 else ROUND_FLOOR)*grid)
            need(side*(entry-sl)>=gap and side*(tp-entry)>=gap, 'MS5_INVALID_PROTECTION')
        order_type = m.ORDER_TYPE_BUY if side>0 else m.ORDER_TYPE_SELL
        loss = m.order_calc_profit(order_type,symbol,float(info.volume_min),entry,sl)
        need(loss is not None and finite(loss,-1e12,-1e-12), "PROFIT_CALC_UNAVAILABLE")
        per_lot = abs(loss)/float(info.volume_min)
        mode = "fixed" if "lots" in job else "risk" if "risk_percent" in job else self.config["size_mode"]
        fixed = job.get("lots",self.config["fixed_lots"])
        budget = account.equity*job.get("risk_percent",self.config["risk_percent"])/100
        if "max_risk_cash" in self.config:
            need(getattr(account, 'currency', None) == 'USD', "USD_ACCOUNT_REQUIRED")
            budget = min(budget, self.config["max_risk_cash"])
        volume = lots_for(mode,fixed,budget,per_lot,float(info.volume_min),float(info.volume_max),float(info.volume_step))
        if "max_risk_cash" in self.config:
            need(volume * per_lot <= self.config["max_risk_cash"] + 1e-7, "RISK_BUDGET_EXCEEDED")
        request = {"action":m.TRADE_ACTION_DEAL,"symbol":symbol,"volume":volume,"type":order_type,"price":entry,
                   "sl":sl,"tp":tp,"deviation":20,"magic":magic_for(state["id"]),"comment":("OLFX TP1 " if job["direction"] in {"structure_retest", "range_breakout"} else "OLFX R2 ")+state["id"][-18:],"type_time":m.ORDER_TIME_GTC}
        fills = []
        if info.filling_mode & 1:
            fills.append(m.ORDER_FILLING_FOK)
        if info.filling_mode & 2:
            fills.append(m.ORDER_FILLING_IOC)
        if info.trade_exemode != m.SYMBOL_TRADE_EXECUTION_MARKET:
            fills.append(m.ORDER_FILLING_RETURN)
        need(fills, "UNSUPPORTED_FILLING")
        for fill in fills:
            request["type_filling"] = fill
            checked = m.order_check(request)
            if checked is not None and checked.retcode == 0:
                return request
        raise Fault("ORDER_CHECK_REJECTED")

    def open(self, state):
        if state.get("cancel") or self.clock() >= state["deadline"]:
            state.update(phase="done",code="CANCELLED_BEFORE_ENTRY" if state.get("cancel") else "NO_SIGNAL_EXPIRED")
            self.save(state)
            return
        try:
            request = self.request(state)
        except Fault as exc:
            state["code"] = str(exc)
            if str(exc) in {"DEMO_ONLY","ACCOUNT_CHANGED","WRONG_TERMINAL","NETTING_POSITION_CONFLICT","VOLUME_OUTSIDE_LIMIT","FIXED_LOTS_NOT_ON_BROKER_STEP","ORDER_CHECK_REJECTED","UNSUPPORTED_FILLING","INVALID_TICK_SIZE","INVALID_VOLUME_METADATA","WRONG_SYMBOL","SYMBOL_UNAVAILABLE","RISK_BUDGET_EXCEEDED","MANUAL_STOP_OUTSIDE_BROKER_LIMIT","MANUAL_TARGET_OUTSIDE_BROKER_LIMIT","MS5_EVENT_NOT_VERIFIED","MS5_STRUCTURAL_STOP_TOO_CLOSE","MS5_ENTRY_MOVED_TOO_FAR","MS5_INVALID_PROTECTION"}:
                state["phase"] = "failed"
            if state['job'].get('direction') == 'range_breakout':
                state['phase'] = 'failed'
            self.save(state)
            return
        # Persist BEFORE sending. A crash, timeout, restart or upload failure never retries an opening.
        state.update(phase="submitted", code="OPEN_SUBMITTED", requested_volume=request["volume"], side="BUY" if request["type"]==self.mt5.ORDER_TYPE_BUY else "SELL",
                     submitted_sl=request['sl'], submitted_tp=request['tp'], requested_price=request['price'], target_r=state['job'].get('rr',2.0))
        self.save(state)
        self.guard(trade=True)
        result = self.mt5.order_send(request)
        if result is not None:
            state["retcode"] = int(result.retcode)
            if result.retcode in (self.mt5.TRADE_RETCODE_DONE,self.mt5.TRADE_RETCODE_DONE_PARTIAL,self.mt5.TRADE_RETCODE_PLACED):
                state["code"] = "AWAIT_OPEN_CONFIRMATION"
            elif result.retcode in {10004,10006,10007,10013,10014,10015,10016,10017,10018,10019,10020,10021,10022,10024,10026,10027,10030,10033,10034,10035,10042,10043,10044,10045,10046}:
                state.update(phase="failed",code="OPEN_REJECTED")
            else:
                state.update(phase="uncertain",code="OPEN_STATUS_UNCERTAIN")
        else:
            state.update(phase="uncertain",code="OPEN_STATUS_UNCERTAIN")
        self.save(state)
        self.event(state,"ENVIO_APERTURA",volume=request["volume"],side=state["side"],retcode=state.get("retcode"))

    def history(self, state):
        m = self.mt5
        offset = self.market_now()-self.clock()
        start = datetime.fromtimestamp(min(state["created_at"],state["created_at"]+offset)-60,timezone.utc)
        end = datetime.fromtimestamp(max(self.clock(),self.market_now())+60,timezone.utc)
        deals = m.history_deals_get(start,end)
        need(deals is not None, "HISTORY_UNAVAILABLE")
        entries = [d for d in deals if d.magic == magic_for(state["id"]) and d.symbol == state["job"]["symbol"] and d.entry == m.DEAL_ENTRY_IN]
        identifiers = {d.position_id for d in entries}
        return [d for d in deals if d.symbol == state["job"]["symbol"] and d.position_id in identifiers]

    def reconcile(self,state):
        m=self.mt5
        positions,orders=self.own(state)
        state["owned_open_positions"]=len(positions)
        if positions:
            state.update(phase="open",code="POSITION_OPEN",floating_profit=round(sum(p.profit+p.swap for p in positions),2))
            p=positions[0]
            state.update(open_price=float(p.price_open),volume=max(state.get("volume",0),sum(float(item.volume) for item in positions)),remaining_volume=sum(float(item.volume) for item in positions),held_seconds=max(0,int(self.market_now()-p.time)))
            if not state.get("entry_logged"):
                state["entry_logged"] = True
                self.event(state,"APERTURA_CONFIRMADA",symbol=p.symbol,side=state.get("side"),volume=float(p.volume),price=float(p.price_open))
            # Open positions are left to their broker SL/TP, regardless of time or stop markers.
            self.save(state)
            return
        if orders:
            state["code"]="OPEN_ORDER_PENDING"
            self.save(state)
            return
        deals=self.history(state)
        ins=[d for d in deals if d.entry==m.DEAL_ENTRY_IN]
        outs=[d for d in deals if d.entry in (m.DEAL_ENTRY_OUT,m.DEAL_ENTRY_OUT_BY)]
        if ins and outs and abs(sum(d.volume for d in ins)-sum(d.volume for d in outs))<1e-8:
            state.update(phase="done",code="POSITION_CLOSED",profit=round(sum(d.profit+d.commission+d.swap+d.fee for d in deals),2),
                         volume=sum(float(d.volume) for d in ins),remaining_volume=0.0,entry_deals=len(ins),exit_deals=len(outs),open_price=float(ins[0].price),close_price=float(outs[-1].price),floating_profit=0.0)
            self.save(state)
            self.event(state,"CIERRE_CONFIRMADO",profit=state["profit"],volume=state.get("volume",0))
        else:
            state.update(phase="uncertain",code="OPEN_STATUS_UNCERTAIN")
            self.save(state)

    def tick(self):
        for state in list(self.states.values()):
            if state["job"]["action"]!="trade" or state["phase"] in FINAL_PHASES:
                continue
            try:
                if state["phase"]=="waiting":
                    self.open(state)
                else:
                    self.reconcile(state)
            except Fault as exc:
                state["code"]=str(exc)
                self.save(state)
            except Exception:
                state["code"]="LOCAL_ERROR_CHECK_LOG"
                self.save(state)


