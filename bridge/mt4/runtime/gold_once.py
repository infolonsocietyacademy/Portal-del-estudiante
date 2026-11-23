"""Single explicit DEMO buy; automatic close request after 60 seconds."""
import math

GOLD_ONCE_HASH="5a837b6c9605bbc7b8475e905ab88bc6c125130f5d01a493076628c195f05396"


def verified_gold_once(data,config):
    from demo_gold import verified_gold
    state=verified_gold(data,config)
    if data.get("code")!="SESSION_FINISHED" or state["open_attempts"]!=1 or state["entry_deals"]<1 or state["exit_deals"]<1 or state["open_positions"]!=0:
        raise ValueError("GOLD_ONCE_ROUNDTRIP_NOT_CONFIRMED")
    values={}
    for name in ("volume_executed","volume_closed","open_price","close_price"):
        val=data.get(name)
        if type(val) not in (int,float) or not math.isfinite(val) or val<=0:
            raise ValueError("GOLD_ONCE_EXECUTION_INVALID")
        values[name]=val
    if values["volume_executed"]>1 or abs(values["volume_executed"]-values["volume_closed"])>1e-8 or values["volume_executed"]>state["last_volume"]+1e-8:
        raise ValueError("GOLD_ONCE_VOLUME_MISMATCH")
    held=data.get("held_seconds")
    if type(held) is not int or held<0:
        raise ValueError("GOLD_ONCE_TIME_INVALID")
    state.update(code="DEMO_GOLD_ROUNDTRIP_CLOSED",opened=True,closed=True,hold_seconds=60,
                 max_attempts=1,max_session_minutes=3,volume=values["volume_executed"],
                 open_price=values["open_price"],close_price=values["close_price"],profit=state["net_recorded"],actual_held_seconds=held)
    return state

