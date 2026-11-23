"""CRT 1H: C2 barre un lado de C1, cierra dentro; confirmacion LTF posterior."""
import numpy as np

def confirmed_structure(bars, before, side, strength):
    col=2 if side=="BUY" else 3
    for j in range(before-strength, strength-1,-1):
        left=bars[j-strength:j,col];right=bars[j+1:j+strength+1,col]
        value=bars[j,col]
        valid=(value>=max(left) and value>max(right)) if side=="BUY" else (value<=min(left) and value<min(right))
        if valid:return float(value)
    return None

def signal(bars, q, context, arm, end, p):
    from range_structure import aggregate_context,bars_from_ticks
    minutes=bars_from_ticks(q,1)
    prior=np.empty((0,5)) if context is None else context[context[:,0]<minutes[0,0]]
    all_minutes=np.concatenate((prior,minutes))
    base=int(p.get("crt_frame",60))
    htf=aggregate_context(all_minutes,base)
    duration=base*60000
    setups=[]
    for n in range(1,len(htf)):
        c1,c2=htf[n-1],htf[n]
        if c2[0]-c1[0]!=duration:continue
        closed=c2[0]+duration
        if closed<arm or closed>=end or closed>q[-1,0]:continue
        if not c1[3]<c2[4]<c1[2]:continue
        sweep_high=c2[2]>c1[2];sweep_low=c2[3]<c1[3]
        if sweep_high==sweep_low:continue
        side="SELL" if sweep_high else "BUY"
        # Los pivotes deben estar confirmados ANTES de terminar C2.
        before=int(np.searchsorted(bars[:,0],closed))-1
        level=confirmed_structure(bars,before,side,p["pivot"])
        if level is None:
            level=float(c2[2] if side=="BUY" else c2[3])
        setups.append((closed,min(closed+duration,end),side,level))
    for k,b in enumerate(bars):
        close_ms=b[0]+p["frame"]*60000
        if b[0]<arm or close_ms>=end or close_ms>q[-1,0]:continue
        for start,expiry,side,level in setups:
            if not start<=b[0]<expiry:continue
            if (b[4]>level if side=="BUY" else b[4]<level):
                return k,side,close_ms
    return None

