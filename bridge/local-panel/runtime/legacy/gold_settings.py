"""Read the existing approved local Gold settings; no credentials or writes."""
import json
import math
from pathlib import Path
import re
DEFAULTS=dict(schema=1,symbol="XAUUSD",size_mode="fixed",fixed_lots=0.01,risk_percent=0.5,max_spread_price=0.60,max_stop_price=20.0)
def validate_gold_settings(data):
    if not isinstance(data,dict) or set(data)!=set(DEFAULTS) or type(data.get("schema")) is not int or data["schema"]!=1:
        raise ValueError("CONFIG_XAUUSD_INVALIDA")
    if not isinstance(data["symbol"],str) or not re.fullmatch(r"XAUUSD(?:[._-]?[A-Za-z0-9]{1,8})?",data["symbol"]):
        raise ValueError("SIMBOLO_XAUUSD_INVALIDO")
    if data["size_mode"] not in ("fixed","percent"):
        raise ValueError("MODO_LOTE_INVALIDO")
    for name,low,high in (("fixed_lots",0.001,1.0),("risk_percent",0.05,2.0),("max_spread_price",0.01,5.0),("max_stop_price",0.1,50.0)):
        value=data[name]
        if type(value) not in (int,float) or not math.isfinite(value) or not low<=value<=high:
            raise ValueError("CONFIG_FUERA_DE_LIMITE_"+name.upper())
    return dict(data)
def load_gold_settings(root):
    path=Path(root)/"gold_settings.json"
    if not path.is_file() or path.stat().st_size>8192:
        raise ValueError("EJECUTA_CONFIGURAR_XAUUSD_PRIMERO")
    return validate_gold_settings(json.loads(path.read_text(encoding="utf-8")))
