"""Gold-only demo launcher configuration and strict public summary."""
import math
from gold_settings import validate_gold_settings

GOLD_SOURCE_HASH="06b171cfa326f7e048c715e8cc3a504e74690455237184edf57ff50097ec169d"


def build_gold_files(job_id,demo,config):
    from demo_structure import build_structure_files
    config=validate_gold_settings(config)
    files=build_structure_files(job_id,demo)
    files["ini"]=files["ini"].replace("Symbol=EURUSD\n","Symbol="+config["symbol"]+"\n")
    files["parameters"]+=("ExpectedGoldSymbol="+config["symbol"]+"\nSizeMode="+str(0 if config["size_mode"]=="fixed" else 1)
        +"\nFixedLots="+str(config["fixed_lots"])+"\nRiskPercent="+str(config["risk_percent"])
        +"\nMaxSpreadPrice="+str(config["max_spread_price"])+"\nMaxStopPrice="+str(config["max_stop_price"])+"\n")
    return files


def verified_gold(data,config,started=False):
    from demo_structure import verified_session
    config=validate_gold_settings(config)
    result=verified_session(data)
    mode=0 if config["size_mode"]=="fixed" else 1
    if data.get("symbol")!=config["symbol"] or type(data.get("size_mode")) is not int or data["size_mode"]!=mode:
        raise ValueError("GOLD_CONFIG_MISMATCH")
    for name in ("fixed_lots","risk_percent"):
        val=data.get(name)
        if type(val) not in (int,float) or not math.isfinite(val) or abs(val-config[name])>1e-8:
            raise ValueError("GOLD_CONFIG_MISMATCH")
    result.update(code="DEMO_GOLD_STARTED" if started else data["code"],symbol=config["symbol"],
        size_mode=config["size_mode"],fixed_lots=config["fixed_lots"],risk_percent=config["risk_percent"])
    result.pop("volume",None)
    for name,upper in (("last_volume",1.0),("planned_risk_cash",1e12)):
        val=data.get(name)
        if type(val) not in (int,float) or not math.isfinite(val) or not 0<=val<=upper:
            raise ValueError("GOLD_SIZE_INVALID")
        result[name]=val
    if mode==0 and result["last_volume"] and abs(result["last_volume"]-config["fixed_lots"])>1e-8:
        raise ValueError("GOLD_SIZE_MISMATCH")
    return result

