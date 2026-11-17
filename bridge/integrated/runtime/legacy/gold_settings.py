import json,math,re
from pathlib import Path
def load_gold_settings(root):
    data=json.loads((Path(root)/"gold_settings.json").read_text(encoding="utf-8"))
    if not re.fullmatch(r"XAUUSD(?:[._-]?[A-Za-z0-9]{1,8})?",str(data.get("symbol",""))):raise ValueError("SIMBOLO_XAUUSD_INVALIDO")
    if data.get("size_mode") not in {"fixed","percent"}:raise ValueError("MODO_LOTE_INVALIDO")
    for name,low,high in (("fixed_lots",0.001,1.),("risk_percent",0.05,2.),("max_spread_price",0.01,5.),("max_stop_price",0.1,50.)):
        v=data.get(name)
        if type(v) not in (int,float) or not math.isfinite(v) or not low<=v<=high:raise ValueError("CONFIG_XAUUSD_INVALIDA")
    return data
