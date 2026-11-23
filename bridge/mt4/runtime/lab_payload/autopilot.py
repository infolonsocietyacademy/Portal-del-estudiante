"""Configuracion automatica auditada y busqueda finita de RANGE / CRT."""
from datetime import datetime,timedelta,timezone
from pathlib import Path
import hashlib
import json
import math
import time
from zoneinfo import ZoneInfo
import numpy as np

UTC=timezone.utc
NY=ZoneInfo("America/New_York")

def axi_shift(stamp):
    utc=datetime.fromtimestamp(float(stamp),UTC)
    return 10800 if utc.astimezone(NY).dst().total_seconds() else 7200

def raw_to_utc(stamp,mode):
    if mode=="UTC":return float(stamp)
    guess=float(stamp)-7200
    return float(stamp)-axi_shift(guess)

class ClockReader:
    """Solo lectura; normaliza el modelo verificado sin exponer order_send."""
    allowed={"TIMEFRAME_M1","COPY_TICKS_ALL","last_error","shutdown","symbol_info","symbol_info_tick",
             "account_info","symbols_get","symbol_select","history_deals_get"}
    def __init__(self,mt,mode,bar_query_domain=None,tick_query_domain=None,tick_output_mode=None):
        self.mt,self.mode=mt,mode
        self.bar_query_domain=bar_query_domain or ("SERVER" if mode=="AXI_SERVER" else "UTC")
        self.tick_query_domain=tick_query_domain or ("SERVER" if mode=="AXI_SERVER" else "UTC")
        self.tick_output_mode=tick_output_mode or mode
    def __getattr__(self,key):
        if key not in self.allowed:raise AttributeError(key)
        return getattr(self.mt,key)
    def shift(self,dt):
        stamp=dt.timestamp() if hasattr(dt,"timestamp") else float(dt)
        return stamp+(axi_shift(stamp) if self.mode=="AXI_SERVER" else 0)
    def normalize(self,rows,mode=None):
        if rows is None:return None
        out=rows.copy()
        mode=mode or self.mode
        if mode=="UTC":return out
        names=out.dtype.names
        for field,scale in (("time",1),("time_msc",1000)):
            if field not in names or not len(out):continue
            values=out[field]
            first=axi_shift(float(values[0])/scale-7200)
            last=axi_shift(float(values[-1])/scale-7200)
            if first==last:
                out[field]=values-int(first*scale)
            else:
                out[field]=[int(raw_to_utc(float(t)/scale,mode)*scale) for t in values]
        return out
    def copy_rates_range(self,symbol,tf,a,b):
        if self.bar_query_domain=="UTC":
            start=a.timestamp() if hasattr(a,"timestamp") else float(a)
            end=b.timestamp() if hasattr(b,"timestamp") else float(b)
        else:start,end=self.shift(a),self.shift(b)
        return self.normalize(self.mt.copy_rates_range(symbol,tf,int(start),int(end)))
    def copy_ticks_range(self,symbol,a,b,flags):
        start=a.timestamp() if hasattr(a,"timestamp") else float(a)
        end=b.timestamp() if hasattr(b,"timestamp") else float(b)
        if self.tick_query_domain=="SERVER":start,end=start+axi_shift(start),end+axi_shift(end)
        return self.normalize(self.mt.copy_ticks_range(symbol,int(start),int(end),flags),self.tick_output_mode)

def tick_query_clock(mt,symbol,axi_broker,observations=None,live_mode="UTC"):
    now=time.time();valid=[]
    queries=[("UTC",now-120,now+2)]
    if axi_broker:queries.append(("SERVER",now-120+axi_shift(now),now+2+axi_shift(now)))
    for domain,a,b in queries:
        rows=mt.copy_ticks_range(symbol,int(a),int(b),mt.COPY_TICKS_ALL)
        if rows is None or len(rows)<3:continue
        for output in (["UTC","AXI_SERVER"] if axi_broker else ["UTC"]):
            raw=rows["time_msc"].astype(float)/1000
            if output=="AXI_SERVER":raw=raw-axi_shift(now)
            inside=raw[(raw>=now-120)&(raw<=now+5)]
            if len(inside)>=3 and len(np.unique(inside))>=2 and -5<=now-float(max(inside))<=10:
                if observations:
                    reference={int(t): (bid,ask) for t,bid,ask in observations}
                    matched=0
                    for t,(bid,ask) in reference.items():
                        stamp=raw_to_utc(t/1000,live_mode)
                        same=(np.abs(raw-stamp)<=.005)&(np.abs(rows["bid"]-bid)<=1e-7)&(np.abs(rows["ask"]-ask)<=1e-7)
                        matched+=bool(np.any(same))
                    if matched<min(2,len(reference)):continue
                valid.append((domain,output))
    if len(valid)!=1:raise ValueError("LAB_TICK_QUERY_CLOCK_NOT_VERIFIED")
    return valid[0]

def rate_query_domain(mt,symbol,recent,mode):
    wanted=int(recent[-2 if len(recent)>1 else -1]["time"])
    utc=raw_to_utc(wanted,mode)
    candidates=[("UTC",int(utc))]
    if mode=="AXI_SERVER":candidates.append(("SERVER",wanted))
    for attempt in range(3):
        matches=[]
        for name,start in candidates:
            rows=mt.copy_rates_range(symbol,mt.TIMEFRAME_M1,start,start+59)
            if rows is not None and len(rows) and np.any(rows["time"]==wanted):matches.append(name)
        if len(matches)==1:return matches[0]
        if mode=="UTC" and matches:return "UTC"
        time.sleep(1)
    raise ValueError("LAB_RATE_QUERY_CLOCK_NOT_VERIFIED")

def observed_commission(mt,symbol):
    now=datetime.now(UTC)
    try: rows=mt.history_deals_get(now-timedelta(days=60),now)
    except Exception:return None,0
    grouped={}
    for d in rows or ():
        if getattr(d,"symbol",None)!=symbol or getattr(d,"type",-1) not in (0,1):continue
        pos=int(getattr(d,"position_id",0));entry=int(getattr(d,"entry",-1))
        if not pos or entry not in (0,1):continue
        v=grouped.setdefault(pos,{"in":0.,"out":0.,"fees":0.})
        v["in" if entry==0 else "out"]+=float(d.volume)
        v["fees"]+=abs(float(getattr(d,"commission",0)))+abs(float(getattr(d,"fee",0)))
    rates=[v["fees"]/v["in"] for v in grouped.values() if v["in"]>0 and abs(v["in"]-v["out"])<1e-7]
    return (float(np.percentile(rates,95)),len(rates)) if len(rates)>=5 else (None,len(rates))

def progress(root,phase,**kwargs):
    import lab
    safe={"phase":phase,"updated_at":datetime.now(UTC).isoformat(),**kwargs}
    lab.save(Path(root)/"autopilot_progress.json",safe)
    print("OLFX AUTO | "+phase,flush=True)

def configure():
    import lab
    from market_feed import MarketFeed
    root=lab.ROOT
    path=root/"config.json"
    c={**lab.DEFAULT,**(lab.read(path) if path.exists() else {})}
    c.pop("clock_mode",None)
    mt,symbol,info,server=lab.connect(c)
    try:
        progress(root,"VERIFICANDO_MT5_Y_HORARIO")
        feed=MarketFeed();spreads=[];observations=[];last=None
        for _ in range(32):
            lab.check_remote_stop()
            quote=mt.symbol_info_tick(symbol)
            if quote and quote.ask>quote.bid>0:
                feed.observe(quote);spreads.append(float(quote.ask-quote.bid));last=quote
                observations.append((int(quote.time_msc),float(quote.bid),float(quote.ask)))
            if feed.offset is not None and len(feed.samples)>=3:break
            time.sleep(.5)
        if feed.offset is None or not feed.fresh or last is None:
            raise ValueError("LAB_LIVE_CLOCK_NOT_VERIFIED")
        account=mt.account_info()
        identity=(str(getattr(account,"company",""))+" "+str(server)).lower()
        if feed.offset==0:
            mode="UTC"
        elif "axi" in identity and feed.offset==-axi_shift(time.time()):
            mode="AXI_SERVER"
        else:
            raise ValueError("LAB_BROKER_CLOCK_RULE_UNKNOWN")
        progress(root,"VERIFICANDO_VELAS_M1",clock_mode=mode)
        recent=mt.copy_rates_from_pos(symbol,mt.TIMEFRAME_M1,0,3)
        if recent is None or not len(recent) or not 0<=float(last.time)-float(recent[-1]["time"])<120:
            raise ValueError("LAB_BAR_CLOCK_NOT_VERIFIED")
        bar_domain=rate_query_domain(mt,symbol,recent,mode)
        progress(root,"VERIFICANDO_TICKS_HISTORICOS",clock_mode=mode)
        tick_domain,tick_output=tick_query_clock(mt,symbol,"axi" in identity,observations,mode)
        progress(root,"CALIBRANDO_COSTOS",clock_mode=mode)
        median=float(np.median(spreads));sources={}
        previous_assumptions=set(c.get("cost_assumptions",[]))
        previous_sources=c.get("calibration",{}).get("sources",{})
        assumptions=[]
        commission,sample=observed_commission(mt,symbol)
        if c.get("commission_roundtrip_per_lot") is None or ("commission" in previous_assumptions and commission is not None):
            c["commission_roundtrip_per_lot"]=commission if commission is not None else 10.
            sources["commission"]="observed_95pct" if commission is not None else "assumed_10_USD_roundtrip_per_lot"
            if commission is None:assumptions.append("commission")
        else:
            sources["commission"]=previous_sources.get("commission","existing_configuration")
            if "commission" in previous_assumptions:assumptions.append("commission")
        if c.get("slippage_points_per_side") is None:
            c["slippage_points_per_side"]=max(2.,median/info["point"]*.25)
            sources["slippage"]="assumed_max_2_points_or_quarter_current_spread"
            assumptions.append("slippage")
        else:
            sources["slippage"]=previous_sources.get("slippage","existing_configuration")
            if "slippage" in previous_assumptions:assumptions.append("slippage")
        if c.get("max_spread_points") is None:
            c["max_spread_points"]=max(3.,median/info["point"]*3.)
            sources["max_spread"]="three_times_observed_live_median"
        else:sources["max_spread"]="existing_configuration"
        c.update(clock_mode=mode,bar_query_domain=bar_domain,tick_query_domain=tick_domain,
                 tick_output_mode=tick_output,time_confirmed=True,auto_compare=True,
                 strategy_families=["RANGE","CRT"],crt_frames=[60],
                 frames_minutes=[1,3,5,15],pivot_lengths=[2],atr_buffers=[.20,.30],
                 exit_modes=["TP1","TP2"],confirmation="Cierre",
                 costs_verified=not assumptions)
        c["cost_assumptions"]=assumptions
        # Regla fijada ANTES de ver resultados; no elimina dias perdedores.
        # https://www.nasdaqtrader.com/Trader.aspx?id=Calendar
        if symbol.upper() in {"NAS100","USTECH","US100"}:
            holidays=["2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25",
                      "2026-06-19","2026-07-03","2026-09-07","2026-11-26","2026-12-25"]
            c["excluded_holidays"]=sorted(set(c.get("excluded_holidays",[]))|set(holidays))
            c["calendar_policy"]="EXCLUDE_NASDAQ_FULL_HOLIDAYS_2026"
        c["calibration"]={"sources":sources,"commission_sample_positions":sample,"clock_mode":mode,
                          "bar_query_domain":bar_domain,"tick_query_domain":tick_domain,"tick_output_mode":tick_output,
                          "quote_offset_seconds":feed.offset,"updated_at":datetime.now(UTC).isoformat()}
        progress(root,"GUARDANDO_Y_VALIDANDO_CONFIGURACION",clock_mode=mode)
        lab.save(path,c)
        lab.config()
        progress(root,"CONFIGURACION_AUTOMATICA_LISTA",costs_verified=c["costs_verified"],cost_assumptions=assumptions)
        return c
    finally:mt.shutdown()

def run():
    import lab
    configure()
    progress(lab.ROOT,"BUSCANDO_RANGO_Y_CRT")
    lab.experiment()
    folder=lab.latest()
    result=lab.read(folder/"estado.json")
    progress(lab.ROOT,result["status"],costs_verified=lab.config().get("costs_verified",False))

