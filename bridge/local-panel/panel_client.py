"""Local panel transport. Appends commands to the existing DEMO mailbox; never sends broker orders."""
import base64
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time
import urllib.parse
import uuid

class PanelError(Exception):
    pass

def need(condition, code):
    if not condition:
        raise PanelError(code)

def digest(job):
    return hashlib.sha256(json.dumps(job,sort_keys=True,separators=(",",":")).encode()).hexdigest()

def iso(epoch):
    return datetime.fromtimestamp(epoch,timezone.utc).isoformat(timespec="seconds")

def valid_id(value):
    import re
    return isinstance(value,str) and re.fullmatch(r"[A-Za-z0-9_-]{1,64}",value) is not None

def make_trade(config,direction,timeframe,hold_minutes=5,size_mode="configured",size=None,rr=2.0,wait_minutes=30,clock=time.time,identifier=None,sl_distance=None,tp_distance=None):
    need(direction in {"buy","sell","structure"},"INVALID_DIRECTION")
    manual=direction in {"buy","sell"} and sl_distance is not None
    need(timeframe in {"M1","M5"} or (manual and timeframe is None),"INVALID_TIMEFRAME")
    need(type(hold_minutes) is int and ((manual and hold_minutes==0) or 1<=hold_minutes<=60),"INVALID_HOLD")
    need(type(wait_minutes) is int and 1<=wait_minutes<=60,"INVALID_WAIT")
    job={"id":identifier or "local-"+uuid.uuid4().hex[:20],"action":"trade",
         "expires_at":iso(clock()+(wait_minutes*60 if direction=="structure" else 120)),
         "symbol":config["symbol"],"direction":direction,"timeframe":timeframe,
         "hold_seconds":hold_minutes*60,"signal_timeout_seconds":wait_minutes*60 if direction=="structure" else 120,"rr":rr}
    if manual:
        job.pop("timeframe",None)
        job["sl_distance"]=sl_distance
        if tp_distance is not None:
            job["tp_distance"]=tp_distance
    if size_mode=="fixed":
        job["lots"]=size
    elif size_mode=="risk":
        job["risk_percent"]=size
    else:
        need(size_mode=="configured","INVALID_SIZE_MODE")
        job["lots" if config["size_mode"]=="fixed" else "risk_percent"]=config["fixed_lots"] if config["size_mode"]=="fixed" else config["risk_percent"]
    return job

def make_close(target_id,clock=time.time,identifier=None):
    need(valid_id(target_id),"INVALID_TARGET")
    return {"id":identifier or "local-close-"+uuid.uuid4().hex[:16],"action":"close",
            "target_id":target_id,"expires_at":iso(clock()+300)}

def load_states(directory):
    states=[]
    for path in Path(directory).glob("*.json"):
        try:
            state=json.loads(path.read_text(encoding="utf-8"))
            if valid_id(state.get("id")) and state.get("job",{}).get("action")=="trade":
                states.append(state)
        except (ValueError,OSError):
            continue
    return sorted(states,key=lambda s:s.get("updated_at",0),reverse=True)

class Mailbox:
    def __init__(self,github,branch,device,journal_dir,validator,symbol):
        self.github,self.branch,self.device=github,branch,device
        self.path="bridge/resident-v2/control/"+device+".json"
        self.journal=Path(journal_dir)
        self.journal.mkdir(parents=True,exist_ok=True)
        self.validator,self.symbol=validator,symbol

    def record(self,job,outcome):
        value={"job":job,"fingerprint":digest(job),"outcome":outcome,"updated_at":time.time()}
        path=self.journal/(job["id"]+".json")
        temp=path.with_suffix(".tmp")
        with temp.open("w",encoding="utf-8") as stream:
            json.dump(value,stream,ensure_ascii=False,indent=2)
            stream.flush()
            import os
            os.fsync(stream.fileno())
        temp.replace(path)

    def submit(self,job):
        need(valid_id(job.get("id")),"INVALID_TASK_ID")
        self.record(job,"sending")
        endpoint="/contents/"+urllib.parse.quote(self.path,safe="/")
        try:
            for _ in range(5):
                current=self.github.get(self.path,ref=self.branch)
                need(current is not None,"RESIDENT_MAILBOX_MISSING")
                control=json.loads(current[0])
                need(isinstance(control,dict) and control.get("schema")==2 and control.get("device")==self.device,"INVALID_MAILBOX")
                jobs=control.get("jobs")
                need(isinstance(jobs,list) and len(jobs)<=100 and all(isinstance(j,dict) and valid_id(j.get("id")) for j in jobs),"INVALID_QUEUE")
                need(len({j["id"] for j in jobs})==len(jobs),"INVALID_QUEUE")
                existing=next((j for j in jobs if j["id"]==job["id"]),None)
                if existing is not None:
                    need(digest(existing)==digest(job),"TASK_ID_REUSED")
                    self.record(job,"queued")
                    return "ALREADY_QUEUED"
                self.validator(job,self.symbol)
                need(control.get("enabled") is True,"RESIDENT_MAILBOX_DISABLED")
                need(len(jobs)<100,"QUEUE_FULL")
                jobs.append(job)
                payload={"branch":self.branch,"message":"OLFX local panel: "+job["id"],
                         "content":base64.b64encode(json.dumps(control,ensure_ascii=False,indent=2).encode()).decode(),"sha":current[1]}
                try:
                    response=self.github.request("PUT",endpoint,payload)
                    need(response is not None,"WRITE_NOT_CONFIRMED")
                except Exception as exc:
                    if str(exc)=="GITHUB_HTTP_409":
                        continue
                    raise
                self.record(job,"queued")
                return "QUEUED"
            raise PanelError("QUEUE_CONFLICT_RETRY_SAME_ID")
        except Exception:
            self.record(job,"uncertain")
            raise

    def unresolved(self):
        records=[]
        for path in self.journal.glob("*.json"):
            try:
                row=json.loads(path.read_text(encoding="utf-8"))
                if row.get("outcome") in {"sending","uncertain"}:
                    records.append(row)
            except (ValueError,OSError):
                continue
        return records
