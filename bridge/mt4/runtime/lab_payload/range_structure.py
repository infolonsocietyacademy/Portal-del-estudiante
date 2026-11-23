"""Estrategia de rango con estructura confirmada y ejecucion Bid/Ask."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import math
import numpy as np

NY = ZoneInfo("America/New_York")


def bars_from_ticks(q, frame):
    buckets = q[:, 0].astype("int64") // (frame * 60000)
    starts = np.r_[0, np.flatnonzero(np.diff(buckets)) + 1]
    ends = np.r_[starts[1:], len(q)]
    return np.array([[buckets[a]*frame*60000, q[a,1], max(q[a:b,1]),
                      min(q[a:b,1]), q[b-1,1]] for a,b in zip(starts,ends)], dtype=float)


def aggregate_context(context, frame):
    if context is None or not len(context):
        return np.empty((0,5))
    buckets = context[:,0].astype("int64") // (frame*60000)
    starts = np.r_[0, np.flatnonzero(np.diff(buckets))+1]
    ends = np.r_[starts[1:], len(context)]
    rows=[]
    for a,b in zip(starts,ends):
        part=context[a:b]
        expected=buckets[a]*frame*60000 + np.arange(frame)*60000
        if len(part)!=frame or not np.array_equal(part[:,0],expected):
            continue
        rows.append([expected[0],part[0,1],max(part[:,2]),min(part[:,3]),part[-1,4]])
    return np.array(rows,dtype=float).reshape(-1,5)


def stop_at(bars, k, side, p, info):
    """Solo barras hasta k; pivote confirmado p velas despues de su extremo."""
    n=p["pivot"]
    begin=max(0,k-p["lookback"])
    pivot=None
    for j in range(k-n, max(n,begin)-1, -1):
        left=bars[j-n:j]; right=bars[j+1:j+n+1]
        if side=="BUY":
            valid=bars[j,3] <= min(left[:,3]) and bars[j,3] < min(right[:,3])
            price=bars[j,3]
        else:
            valid=bars[j,2] >= max(left[:,2]) and bars[j,2] > max(right[:,2])
            price=bars[j,2]
        if valid:
            pivot=float(price)
            break
    past=bars[begin:k]
    if pivot is None:
        col=3 if side=="BUY" else 2
        pivot=float(min(past[:,col]) if side=="BUY" and len(past) else
                    max(past[:,col]) if len(past) else bars[k,col])
    # Wilder ATR(14), inicializado con SMA. Contexto anterior a la sesion.
    tr=[]
    for j in range(k+1):
        prev=bars[j-1,4] if j else bars[j,4]
        tr.append(max(bars[j,2]-bars[j,3],abs(bars[j,2]-prev),abs(bars[j,3]-prev)))
    atr=0.
    if len(tr)>=14:
        atr=sum(tr[:14])/14
        for value in tr[14:]:
            atr=(atr*13+value)/14
    tick=info["trade_tick_size"]
    buffer=max(atr*p["atr_buffer"],tick*p["buffer_ticks"])
    if side=="BUY":
        return math.floor((min(pivot,bars[k,3])-buffer)/tick+1e-10)*tick
    return math.ceil((max(pivot,bars[k,2])+buffer)/tick-1e-10)*tick


def replay(q, day, p, c, info, context=None):
    base=datetime.combine(day,datetime.min.time(),NY)
    start,arm,end=[int((base+timedelta(minutes=m)).timestamp()*1000) for m in (630,645,955)]
    r=q[(q[:,0]>=start)&(q[:,0]<arm)]
    if not len(r) or len(np.unique(r[:,0].astype("int64")//60000))!=15:
        return None
    hi,lo=float(max(r[:,1])),float(min(r[:,1]))
    if hi<=lo:
        return None
    frame=p["frame"]
    bars=bars_from_ticks(q,frame)
    warm=aggregate_context(context,frame)
    if len(warm):
        warm=warm[warm[:,0]+frame*60000<=start]
        bars=np.concatenate((warm,bars))
    k=None
    side=None
    signal_ms=None
    if p.get('family','RANGE')=='CRT':
        from crt_strategy import signal
        found=signal(bars,q,context,arm,end,p)
        if found is not None:k,side,signal_ms=found
    else:
        for j,b in enumerate(bars):
            close_ms=b[0]+frame*60000
            if b[0]<arm or close_ms>=end or close_ms>q[-1,0]:
                continue
            up=b[2]>hi if p["confirmation"]=="Mecha" else b[4]>hi
            down=b[3]<lo if p["confirmation"]=="Mecha" else b[4]<lo
            if up and down:
                return None # Primera ruptura ambigua: no inventar orden ni tomar la siguiente.
            if up or down:
                k=j; side="BUY" if up else "SELL"; signal_ms=close_ms
                break
    if k is None:
        return None
    i=int(np.searchsorted(q[:,0],signal_ms))
    if i>=len(q) or q[i,0]-signal_ms>60000:
        return None
    tick=info["trade_tick_size"]; point=info["point"]
    slip=c["slippage_points_per_side"]*point
    if (q[i,2]-q[i,1])/point>c["max_spread_points"]:
        return None
    direction=1 if side=="BUY" else -1
    entry=float(q[i,2]+slip if side=="BUY" else q[i,1]-slip)
    sl=stop_at(bars,k,side,p,info)
    risk=direction*(entry-sl)
    if risk<=max(tick,info["trade_stops_level"]*point):
        return None
    # Distancia de objetivos desde el fill estimado, redondeada al tick.
    tp1=math.floor((entry+direction*risk)/tick+0.5)*tick
    tp2=math.floor((entry+direction*2*risk)/tick+0.5)*tick
    market=float(q[i,1] if side=="BUY" else q[i,2])
    min_stop=info["trade_stops_level"]*point
    if direction*(market-sl)<min_stop or direction*(tp1-market)<min_stop:
        return None
    risk_lot=(risk+slip)/tick*info["trade_tick_value_loss"]+c["commission_roundtrip_per_lot"]
    step=info["volume_step"]
    lots=math.floor(min(info["volume_max"],c["initial_balance"]*c["risk_pct"]/100/risk_lot)/step+1e-10)*step
    if lots<info["volume_min"]:
        return None
    mode=p["exit_mode"]
    if mode=="PARCIAL":
        first=math.floor(lots/2/step+1e-10)*step
        if first<info["volume_min"] or lots-first<info["volume_min"]:
            return None # No inventar medios lotes si el contrato no los admite.
        legs=[dict(qty=first,target=tp1,name="TP1"),dict(qty=lots-first,target=tp2,name="TP2")]
    else:
        legs=[dict(qty=lots,target=tp1 if mode=="TP1" else tp2,name=mode)]
    total_comm=c["commission_roundtrip_per_lot"]*lots
    realized=0.; marks=[]; reasons=[]; exit_prices=[]
    closed=False; exit_ms=None; tp1_hit=False; tp2_hit=False
    tail=q[i:]
    def pnl(px,qty):
        delta=direction*(px-entry)
        value=info["trade_tick_value_profit"] if delta>=0 else info["trade_tick_value_loss"]
        return delta/tick*value*qty
    quotes=tail[:,1] if side=="BUY" else tail[:,2]
    count=len(tail)
    times=np.arange(count)
    equity=np.full(count,-total_comm,dtype=float)
    final_indices=[]
    for leg in legs:
        hit_stop=direction*(quotes-sl)<=0
        hit_tp=direction*(quotes-leg["target"])>=0
        hits=np.flatnonzero(hit_stop|hit_tp|(tail[:,0]>=end))
        closed_leg=bool(len(hits))
        j=int(hits[0]) if closed_leg else count-1
        mark_px=quotes-direction*slip
        delta=direction*(mark_px-entry)
        marks_leg=delta/tick*np.where(delta>=0,info["trade_tick_value_profit"],info["trade_tick_value_loss"])*leg["qty"]
        if closed_leg:
            reason="SL" if hit_stop[j] else leg["name"] if hit_tp[j] else "CIERRE_SESION"
            px=(leg["target"] if hit_tp[j] and not hit_stop[j] else float(quotes[j]))-direction*slip
            net_leg=pnl(px,leg["qty"])
            marks_leg[j:]=net_leg
            final_indices.append(j);exit_prices.append((px,leg["qty"]))
            reasons.append((j,leg["name"],reason))
            tp1_hit |= reason=="TP1";tp2_hit |= reason=="TP2"
        equity+=marks_leg
    closed=len(final_indices)==len(legs)
    if closed:
        j=max(final_indices);exit_ms=int(tail[j,0]);equity=equity[:j+1]
    marks=equity
    reasons=[r[2] for r in sorted(reasons,key=lambda x:(x[0],x[1]))]
    peaks=np.maximum.accumulate(np.maximum(marks,0))
    changes=np.r_[0,np.flatnonzero(np.diff(peaks))+1,len(peaks)]
    pairs=[[float(peaks[a]),float(min(marks[a:b]))] for a,b in zip(changes[:-1],changes[1:])]
    return dict(day=str(day),side=side,entry_ms=int(q[i,0]),signal_ms=int(signal_ms),
        exit_ms=exit_ms,entry=entry,exit=sum(px*v for px,v in exit_prices)/lots if closed else None,
        sl=sl,tp=tp1 if mode=="TP1" else tp2,tp1=tp1,tp2=tp2,lots=lots,
        exit_mode=mode,tp1_exit=tp1_hit,tp2_exit=tp2_hit,
        net=float(marks[-1]) if closed else None,worst=float(min(0,min(marks))),
        dd_pairs=pairs,reason="+".join(reasons) if closed else "ABIERTA")

