"""Resident DEMO command engine. MT5 access is injected; importing never trades."""
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import time

VERSION = "2.0.0-rc1"
LIVE_PHASES = {"waiting", "submitted", "open", "closing", "uncertain"}
FINAL_PHASES = {"done", "failed"}
MAX_ACTIVE = 3

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
        allowed |= {"symbol", "direction", "timeframe", "hold_seconds", "signal_timeout_seconds", "lots", "risk_percent", "rr"}
        need(job.get("symbol") == symbol, "SYMBOL_NOT_LOCALLY_APPROVED")
        need(job.get("direction") in {"buy", "sell", "structure"}, "INVALID_DIRECTION")
        need(job.get("timeframe") in {"M1", "M5"}, "INVALID_TIMEFRAME")
        need(type(job.get("hold_seconds", 300)) is int and 15 <= job.get("hold_seconds", 300) <= 3600, "INVALID_HOLD_SECONDS")
        need(type(job.get("signal_timeout_seconds", 1800)) is int and 30 <= job.get("signal_timeout_seconds", 1800) <= 3600, "INVALID_SIGNAL_TIMEOUT")
        need(not ("lots" in job and "risk_percent" in job), "ONE_SIZE_MODE_REQUIRED")
        if "lots" in job:
            need(finite(job["lots"], 0.001, 1.0), "INVALID_LOTS")
        if "risk_percent" in job:
            need(finite(job["risk_percent"], 0.05, 2.0), "INVALID_RISK")
        need(finite(job.get("rr", 2.0), 1.0, 5.0), "INVALID_RR")
    elif action == "close":
        allowed.add("target_id")
        need(isinstance(job.get("target_id"), str) and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", job["target_id"]), "INVALID_TARGET")
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
        rows = self.mt5.copy_rates_from_pos(job["symbol"], tf, 1, 96)
        need(rows is not None and len(rows) >= 64, "WAIT_HISTORY")
        return [{k: float(r[k]) if k != "time" else int(r[k]) for k in ("time", "open", "high", "low", "close")} for r in reversed(rows)]

    def summary(self, state):
        safe = {k: state[k] for k in ("id", "phase", "code", "updated_at", "retcode", "volume", "open_price", "close_price", "profit", "entry_deals", "exit_deals", "owned_open_positions", "floating_profit", "held_seconds", "side", "requested_volume", "remaining_volume") if k in state}
        safe.update(schema=2, version=VERSION, status="succeeded" if state["phase"] == "done" else "failed" if state["phase"] == "failed" else "running",
                    task_sha256=state["fingerprint"])
        if state["job"]["action"] == "trade":
            safe.update(symbol=state["job"]["symbol"], period=state["job"]["timeframe"], hold_seconds=state["job"].get("hold_seconds", 300))
        return safe

    def accept(self, job):
        jid = job.get("id", "") if isinstance(job, dict) else ""
        if jid in self.states:
            need(self.states[jid]["fingerprint"] == fingerprint(job), "TASK_ID_REUSED")
            return self.summary(self.states[jid])
        validate(job, self.config["symbol"], self.clock())
        self.guard()
        state = {"id": jid, "job": job, "fingerprint": fingerprint(job), "phase": "done", "code": "OK", "created_at": self.clock()}
        action = job["action"]
        if action == "trade":
            need(sum(s["phase"] in LIVE_PHASES and s["job"]["action"] == "trade" for s in self.states.values()) < MAX_ACTIVE, "MAX_ACTIVE_COMMANDS")
            need(not any(s["phase"] in {"submitted", "uncertain"} for s in self.states.values()), "RECONCILE_PREVIOUS_SEND_FIRST")
            state.update(phase="waiting", code="WAIT_SIGNAL", last_bar=0,
                         deadline=min(expiry(job["expires_at"]), self.clock()+job.get("signal_timeout_seconds",1800)))
            if job["direction"] == "structure":
                try:
                    state["last_bar"] = self.bars(job)[0]["time"]
                except Fault:
                    pass
        elif action == "close":
            target = self.states.get(job["target_id"])
            need(target is not None and target["job"]["action"] == "trade", "TARGET_NOT_OWNED")
            if target["phase"] not in FINAL_PHASES:
                target["cancel"] = True
                self.save(target)
            state["code"] = "CLOSE_REQUESTED"
        elif action == "ping":
            state["code"] = "PONG_RESIDENT"
        elif action == "diagnose":
            try:
                self.guard(trade=True)
                state["code"] = "RESIDENT_READY"
            except Fault as exc:
                state["code"] = str(exc)
        elif action == "status":
            state["code"] = "RESIDENT_STATUS"
        self.save(state)
        return self.summary(state)

    def request(self, state):
        job, m = state["job"], self.mt5
        account = self.guard(trade=True)
        need(not any(other["id"] != state["id"] and other["phase"] in {"submitted", "uncertain"} for other in self.states.values()), "WAIT_RECONCILIATION")
        symbol = job["symbol"]
        need(m.symbol_select(symbol, True), "SYMBOL_UNAVAILABLE")
        info, tick = m.symbol_info(symbol), m.symbol_info_tick(symbol)
        need(info is not None and tick is not None and finite(tick.bid,1e-9,1e9) and finite(tick.ask,tick.bid+1e-12,1e9), "QUOTE_UNAVAILABLE")
        need(info.currency_base == "XAU" and info.currency_profit == "USD", "WRONG_SYMBOL")
        need(abs(self.clock() - tick.time) <= 10, "WAIT_FRESH_QUOTE")
        need(tick.ask - tick.bid <= self.config["max_spread_price"], "WAIT_SPREAD")
        positions, orders = self.read_account(state)
        if account.margin_mode != m.ACCOUNT_MARGIN_MODE_RETAIL_HEDGING:
            need(not positions and not orders, "NETTING_POSITION_CONFLICT")
        rates = self.bars(job)
        atr = closed_atr(rates)
        side, swing, level = 0, 0.0, 0.0
        if job["direction"] == "structure":
            seconds = 60 if job["timeframe"] == "M1" else 300
            if not state["last_bar"]:
                state["last_bar"] = rates[0]["time"]
                self.save(state)
                raise Fault("WAIT_NEW_CANDLE")
            need(rates[0]["time"] > state["last_bar"], "WAIT_NEW_CANDLE")
            state["last_bar"] = rates[0]["time"]
            self.save(state)
            side, swing, level = structure_signal(rates)
            need(side != 0, "WAIT_STRUCTURE")
            need(0 <= self.clock() - rates[0]["time"] - seconds <= 10, "WAIT_FRESH_SIGNAL")
        else:
            side = 1 if job["direction"] == "buy" else -1
        entry = float(tick.ask if side > 0 else tick.bid)
        if level:
            need((entry > level if side > 0 else entry < level) and abs(entry-rates[0]["close"]) <= max(0.25*atr,self.config["max_spread_price"]), "WAIT_VALID_ENTRY")
        gap = info.trade_stops_level*info.point + tick.ask-tick.bid + 2*info.point
        risk = max(atr, gap, entry-(swing-0.2*atr) if side>0 and swing else (swing+0.2*atr)-entry if side<0 and swing else 1.2*atr)
        need(finite(risk, 1e-8, min(4*atr,self.config["max_stop_price"])), "WAIT_STOP_FILTER")
        step = float(info.trade_tick_size)
        need(step > 0, "INVALID_TICK_SIZE")
        sl = round((math.floor((entry-risk)/step) if side>0 else math.ceil((entry+risk)/step))*step, info.digits)
        risk = abs(entry-sl)
        need(risk <= min(4*atr,self.config["max_stop_price"]) + info.point, "WAIT_STOP_FILTER")
        tp = round(round((entry+side*job.get("rr",2.0)*risk)/step)*step, info.digits)
        order_type = m.ORDER_TYPE_BUY if side>0 else m.ORDER_TYPE_SELL
        loss = m.order_calc_profit(order_type,symbol,float(info.volume_min),entry,sl)
        need(loss is not None and finite(loss,-1e12,-1e-12), "PROFIT_CALC_UNAVAILABLE")
        per_lot = abs(loss)/float(info.volume_min)
        mode = "fixed" if "lots" in job else "risk" if "risk_percent" in job else self.config["size_mode"]
        fixed = job.get("lots",self.config["fixed_lots"])
        budget = account.equity*job.get("risk_percent",self.config["risk_percent"])/100
        volume = lots_for(mode,fixed,budget,per_lot,float(info.volume_min),float(info.volume_max),float(info.volume_step))
        request = {"action":m.TRADE_ACTION_DEAL,"symbol":symbol,"volume":volume,"type":order_type,"price":entry,
                   "sl":sl,"tp":tp,"deviation":20,"magic":magic_for(state["id"]),"comment":"OLFX R2 "+state["id"][-18:],"type_time":m.ORDER_TIME_GTC}
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
            if str(exc) in {"DEMO_ONLY","ACCOUNT_CHANGED","WRONG_TERMINAL","NETTING_POSITION_CONFLICT","VOLUME_OUTSIDE_LIMIT","FIXED_LOTS_NOT_ON_BROKER_STEP","ORDER_CHECK_REJECTED","UNSUPPORTED_FILLING","INVALID_TICK_SIZE","INVALID_VOLUME_METADATA","WRONG_SYMBOL","SYMBOL_UNAVAILABLE","RISK_BUDGET_EXCEEDED"}:
                state["phase"] = "failed"
            self.save(state)
            return
        # Persist BEFORE sending. A crash, timeout, restart or upload failure never retries an opening.
        state.update(phase="submitted", code="OPEN_SUBMITTED", requested_volume=request["volume"], side="BUY" if request["type"]==self.mt5.ORDER_TYPE_BUY else "SELL")
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
        start = datetime.fromtimestamp(state["created_at"]-60,timezone.utc)
        end = datetime.fromtimestamp(self.clock()+60,timezone.utc)
        deals = m.history_deals_get(start,end)
        need(deals is not None, "HISTORY_UNAVAILABLE")
        entries = [d for d in deals if d.magic == magic_for(state["id"]) and d.symbol == state["job"]["symbol"] and d.entry == m.DEAL_ENTRY_IN]
        identifiers = {d.position_id for d in entries}
        return [d for d in deals if d.symbol == state["job"]["symbol"] and d.position_id in identifiers]

    def close_position(self, state, position):
        m = self.mt5
        self.guard(trade=True)
        # Ticket, symbol and per-command magic must all still match at send time.
        current = m.positions_get(ticket=position.ticket)
        need(current is not None, "MT5_STATE_UNAVAILABLE")
        if not current:
            return
        p = current[0]
        need(p.magic == magic_for(state["id"]) and p.symbol == state["job"]["symbol"], "TARGET_NOT_OWNED")
        # Reconcile the previous close before issuing another; never duplicate pending closes.
        orders = m.orders_get(symbol=p.symbol)
        need(orders is not None, "MT5_STATE_UNAVAILABLE")
        need(not any(o.magic == p.magic for o in orders), "CLOSE_ORDER_PENDING")
        tick, info = m.symbol_info_tick(p.symbol),m.symbol_info(p.symbol)
        need(tick is not None and info is not None and abs(self.clock()-tick.time)<=10,"WAIT_FRESH_QUOTE")
        request={"action":m.TRADE_ACTION_DEAL,"symbol":p.symbol,"position":int(p.ticket),"magic":p.magic,
                 "volume":float(p.volume),"type":m.ORDER_TYPE_SELL if p.type==m.POSITION_TYPE_BUY else m.ORDER_TYPE_BUY,
                 "price":float(tick.bid if p.type==m.POSITION_TYPE_BUY else tick.ask),"deviation":20,
                 "comment":"OLFX R2 CLOSE","type_time":m.ORDER_TIME_GTC}
        request["type_filling"] = m.ORDER_FILLING_FOK if info.filling_mode & 1 else m.ORDER_FILLING_IOC if info.filling_mode & 2 else m.ORDER_FILLING_RETURN
        checked=m.order_check(request)
        need(checked is not None and checked.retcode==0,"CLOSE_CHECK_REJECTED")
        state.update(phase="closing",code="CLOSE_SUBMITTED",last_close_at=self.clock())
        self.save(state)
        self.guard(trade=True)
        result=m.order_send(request)
        if result is not None:
            state["retcode"]=int(result.retcode)
        # None/timeout remains pending; tick() does not blindly resend.
        if result is None or result.retcode in (m.TRADE_RETCODE_TIMEOUT,m.TRADE_RETCODE_PLACED):
            state["close_uncertain"]=True
        self.save(state)
        self.event(state,"ENVIO_CIERRE",volume=float(p.volume),retcode=state.get("retcode"))

    def reconcile(self,state):
        m=self.mt5
        positions,orders=self.own(state)
        state["owned_open_positions"]=len(positions)
        if positions:
            state.update(phase="open",code="POSITION_OPEN",floating_profit=round(sum(p.profit+p.swap for p in positions),2))
            p=positions[0]
            state.update(open_price=float(p.price_open),volume=max(state.get("volume",0),sum(float(item.volume) for item in positions)),remaining_volume=sum(float(item.volume) for item in positions),held_seconds=max(0,int(self.clock()-p.time)))
            if not state.get("entry_logged"):
                state["entry_logged"] = True
                self.event(state,"APERTURA_CONFIRMADA",symbol=p.symbol,side=state.get("side"),volume=float(p.volume),price=float(p.price_open))
            due=state.get("cancel") or state["held_seconds"]>=state["job"].get("hold_seconds",300)
            self.save(state)
            if due:
                # An uncertain close is never retried automatically: broker SL/TP stay active.
                if state.get("close_uncertain"):
                    state.update(phase="closing",code="CLOSE_STATUS_UNCERTAIN")
                    self.save(state)
                elif self.clock()-state.get("last_close_at",0)>=5:
                    self.close_position(state,p)
            return
        if orders:
            state["code"]="OPEN_ORDER_PENDING"
            if state.get("cancel") or self.clock()>=state["deadline"]:
                for order in orders:
                    self.guard(trade=True)
                    result=m.order_send({"action":m.TRADE_ACTION_REMOVE,"order":int(order.ticket),"magic":magic_for(state["id"])})
                    if result is not None:
                        state["retcode"]=int(result.retcode)
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
