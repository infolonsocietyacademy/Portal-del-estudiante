"""Velas M1 derivadas exclusivamente de ticks BID reales; no relleno de huecos."""
from datetime import datetime,timedelta,timezone
import numpy as np

FIELDS=[("time","i8"),("open","f8"),("high","f8"),("low","f8"),("close","f8")]

def bars_from_quotes(q):
    if q is None or not len(q):return np.empty(0,dtype=FIELDS)
    q=np.asarray(q)
    minute=q[:,0].astype("int64")//60000
    starts=np.r_[0,np.flatnonzero(np.diff(minute))+1]
    ends=np.r_[starts[1:]-1,len(q)-1]
    rows=np.empty(len(starts),dtype=FIELDS)
    rows["time"]=minute[starts]*60
    rows["open"]=q[starts,1]
    rows["high"]=np.maximum.reduceat(q[:,1],starts)
    rows["low"]=np.minimum.reduceat(q[:,1],starts)
    rows["close"]=q[ends,1]
    return rows

def complete_session_bars(existing,q,start_ms,end_ms):
    expected=np.arange(start_ms//60000,end_ms//60000)
    actual=q[:,0].astype("int64")//60000
    if not np.all(np.isin(expected,actual)):
        raise ValueError("LAB_TICK_MINUTES_INCOMPLETE")
    if existing is not None and np.all(np.isin(expected,existing["time"]//60)):
        return existing,False
    derived=bars_from_quotes(q)
    # Las velas presentes del broker deben tener extremos compatibles.
    if existing is not None and len(existing):
        common=existing[(existing["time"]*1000>=start_ms)&(existing["time"]*1000<end_ms)]
        lookup={int(r["time"]):r for r in derived}
        for r in common:
            other=lookup.get(int(r["time"]))
            if other is not None and (other["high"]>r["high"]+1e-6 or other["low"]<r["low"]-1e-6):
                raise ValueError("LAB_TICK_BAR_CONFLICT")
    return derived,True

def context_from_ticks(reader,symbol,a,b):
    from range_structure import aggregate_context
    if not hasattr(reader,"_context_days"):reader._context_days={}
    cache=reader._context_days
    oldest=a.date();day=b.date();collected=[]
    while day>=oldest:
        key=(symbol,day.isoformat())
        start=datetime.combine(day,datetime.min.time(),timezone.utc)
        stop=min(start+timedelta(days=1),b)
        wanted=int(stop.timestamp()*1000)
        old=cache.get(key)
        if old is None or old["until_ms"]<wanted:
            cursor=datetime.fromtimestamp(old["until_ms"]/1000,timezone.utc) if old is not None else start
            chunks=[old["rows"]] if old is not None else []
            while cursor<stop:
                import lab
                lab.check_remote_stop()
                end=min(cursor+timedelta(minutes=30),stop)
                rows=reader.copy_ticks_range(symbol,cursor,end,reader.COPY_TICKS_ALL)
                if rows is None:raise ValueError("LAB_CONTEXT_TICK_API_FAILED")
                if len(rows):
                    q=np.column_stack((rows["time_msc"],rows["bid"],rows["ask"])).astype(float)
                    lo=int(cursor.timestamp()*1000);hi=int(end.timestamp()*1000)
                    q=q[(q[:,0]>=lo)&(q[:,0]<hi)]
                    if len(q):
                        lab.check_quotes(q)
                        chunks.append(bars_from_quotes(q))
                cursor=end
            cache[key]={"until_ms":wanted,"rows":np.concatenate(chunks) if chunks else np.empty(0,dtype=FIELDS)}
        rows=cache[key]["rows"]
        if len(rows):
            matrix=np.column_stack((rows["time"]*1000,rows["open"],rows["high"],rows["low"],rows["close"])).astype(float)
            matrix=matrix[(matrix[:,0]>=a.timestamp()*1000)&(matrix[:,0]<b.timestamp()*1000)]
            collected.append(matrix)
        merged=np.concatenate(collected) if collected else np.empty((0,5))
        if len(merged):
            merged=merged[np.argsort(merged[:,0])]
            if all(len(aggregate_context(merged,f))>=100 for f in (1,3,5,15)):
                return merged
        day-=timedelta(days=1)
    raise ValueError("LAB_CONTEXT_HISTORY_INCOMPLETE")

