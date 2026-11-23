"""Administracion acotada de OLFX Lab mediante el bridge firmado.

Sin shell remoto ni rutas/codigo recibidos de la cola. Solo el payload incluido
en la misma version firmada; nunca se reemplazan config.json ni experimentos.
"""
import contextlib
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import uuid

VERSION="1.0.39"
PAYLOAD_FILES=("ABRIR_OLFX_LAB.py","bootstrap.py","simple_ui.py","lab.py",
               "range_structure.py","lab_remote_worker.py","crt_strategy.py","autopilot.py","market_feed.py","history_data.py")
ACTIONS={"lab_status","lab_discover","lab_attach","lab_update","lab_doctor",
         "lab_prepare","lab_run","lab_demo","lab_stop","lab_results","lab_autopilot"}
DEFAULT_CONFIG={"symbol":"NAS100","terminal_path":"","train_days":180,"validation_days":90,"initial_balance":10000,"risk_pct":0.5,"commission_roundtrip_per_lot":None,"slippage_points_per_side":None,"max_spread_points":None,"time_confirmed":False,"excluded_holidays":[],"frames_minutes":[1,3,5,15],"target_winrate":0.75,"min_train_trades":60,"min_validation_trades":40,"min_demo_trades":60,"min_demo_days":30,"max_drawdown_pct":10,"min_profit_factor":1.2,"min_wilson_lower":0.6,"pivot_lengths":[2,3],"atr_buffers":[0.2,0.3],"exit_modes":["TP1","TP2","PARCIAL"],"confirmation":"Cierre","structure_lookback":30,"buffer_ticks":2}
REQUIREMENTS="MetaTrader5>=5.0.45,<6\nnumpy>=1.26,<3\ntzdata>=2024.1\n"

class LabError(Exception):
    pass

def require(ok,code):
    if not ok: raise LabError(code)

def read(path, default=None):
    try:
        p=Path(path)
        require(not p.is_symlink(),"LAB_LINK_BLOCKED")
        require(p.stat().st_size<=1000000,"LAB_STATE_TOO_LARGE")
        return json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default

def write(path, data):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    require(not path.is_symlink(),"LAB_LINK_BLOCKED")
    tmp=path.with_name(path.name+"."+uuid.uuid4().hex+".tmp")
    tmp.write_text(json.dumps(data,ensure_ascii=False,allow_nan=False),encoding="utf-8")
    os.replace(tmp,path)

def state_dir(root):
    p=Path(root)/"lab-management"
    require(not p.is_symlink(),"LAB_LINK_BLOCKED")
    p.mkdir(exist_ok=True,parents=True)
    return p

def payload():
    p=Path(__file__).resolve().parent/"lab_payload"
    for name in PAYLOAD_FILES:
        require((p/name).is_file() and not (p/name).is_symlink(),"LAB_PAYLOAD_INCOMPLETE")
    return p

def validate_job(job):
    require(isinstance(job,dict) and job.get("action") in ACTIONS,"LAB_ACTION_INVALID")
    fields={"id","action","expires_at"}
    if job["action"]=="lab_attach": fields.add("candidate_id")
    require(set(job)==fields,"LAB_UNEXPECTED_FIELD")
    if job["action"]=="lab_attach":
        require(isinstance(job["candidate_id"],str) and re.fullmatch("[a-f0-9]{16}",job["candidate_id"]),"LAB_CANDIDATE_INVALID")
    return job

def allowed_roots(root):
    home=Path.home()
    roots=[Path(root)/"olfx-lab",home/"Desktop",home/"Downloads",home/"Documents",
           home/"OneDrive"/"Desktop",home/"OneDrive"/"Documents"]
    for env in ("OneDrive","OneDriveConsumer","OneDriveCommercial"):
        if os.environ.get(env):
            roots.extend(Path(os.environ[env])/name for name in ("Desktop","Documents"))
    return roots

def safe_target(target, root):
    target=Path(target).absolute()
    # Refuse junctions/symlinks anywhere in the managed path.
    for p in (target,*target.parents):
        if p.exists():
            require(not p.is_symlink() and not (getattr(p.stat(),"st_file_attributes",0)&0x400),
                    "LAB_LINK_BLOCKED")
    resolved=target.resolve()
    require(any(resolved==p.resolve() or p.resolve() in resolved.parents for p in allowed_roots(root)),
            "LAB_OUTSIDE_ALLOWED_FOLDERS")
    return resolved

@contextlib.contextmanager
def lab_lock(target):
    p=Path(target)/"instancia.lock"
    require(not p.is_symlink(),"LAB_LINK_BLOCKED")
    f=p.open("a+b")
    if p.stat().st_size == 0:
        f.write(b"0");f.flush()
    f.seek(0)
    try:
        if os.name=="nt":
            import msvcrt
            try: msvcrt.locking(f.fileno(),msvcrt.LK_NBLCK,1)
            except OSError: raise LabError("LAB_BUSY_CLOSE_LAB_TO_UPDATE") from None
        else:
            import fcntl
            try: fcntl.flock(f.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
            except OSError: raise LabError("LAB_BUSY_CLOSE_LAB_TO_UPDATE") from None
        yield
    finally:
        f.close()

def busy(target):
    try:
        with lab_lock(target): return False
    except LabError as e:
        if str(e)=="LAB_BUSY_CLOSE_LAB_TO_UPDATE": return True
        raise

def discover(root, roots=None):
    found={};visited=0;deadline=time.monotonic()+8
    for base in roots if roots is not None else allowed_roots(root):
        if not base.is_dir() or base.is_symlink(): continue
        stack=[(base,0)]
        while stack and visited<3000 and time.monotonic()<deadline:
            folder,depth=stack.pop();visited+=1
            try:
                if folder.is_symlink() or getattr(folder.stat(),"st_file_attributes",0)&0x400: continue
                if (folder/"lab.py").is_file() and (folder/"ABRIR_OLFX_LAB.py").is_file():
                    # Confirm the marker before inspecting a lock.
                    if (folder/"lab.py").stat().st_size > 200000:
                        continue
                    text=(folder/"lab.py").read_text(encoding="utf-8")
                    if "OLFX" in text and len(text)<200000:
                        path=safe_target(folder,root)
                        key=hashlib.sha256(str(path).casefold().encode()).hexdigest()[:16]
                        found[key]=str(path)
                    continue
                if depth<4:
                    stack.extend((p,depth+1) for p in sorted(folder.iterdir(),key=lambda x:x.name,reverse=True)
                                 if p.is_dir() and p.name not in {".venv","venv","node_modules",".git","experimentos","registros"})
            except (OSError,UnicodeError,LabError):
                continue
    write(state_dir(root)/"candidates.json",found)
    return [{"id":k,"label":Path(p).name[:80],"busy":busy(Path(p))} for k,p in found.items()]

def bind(root, candidate=None):
    state=state_dir(root);binding=read(state/"binding.json")
    if candidate is not None:
        candidates=read(state/"candidates.json",{})
        require(candidate in candidates,"LAB_CANDIDATE_NOT_FOUND")
        target=safe_target(candidates[candidate],root)
    elif binding:
        return safe_target(binding["path"],root)
    else:
        items=discover(root)
        active=[x for x in items if x["busy"]]
        options=active if len(active)==1 else items
        require(len(options)<=1,"LAB_MULTIPLE_CANDIDATES_ATTACH_REQUIRED")
        if options:
            candidates=read(state/"candidates.json")
            target=safe_target(candidates[options[0]["id"]],root)
        else:
            target=safe_target(Path(root)/"olfx-lab",root)
            target.mkdir(parents=True,exist_ok=True)
    write(state/"binding.json",{"path":str(target),"schema":1})
    return target

def installed(root):
    b=read(state_dir(root)/"binding.json")
    return safe_target(b["path"],root) if b else None

def signature_matches(target):
    p=payload()
    return all((target/name).is_file() and not (target/name).is_symlink() and
               hashlib.sha256((target/name).read_bytes()).digest()==hashlib.sha256((p/name).read_bytes()).digest()
               for name in PAYLOAD_FILES)

def update(root):
    target=bind(root)
    try:
        with lab_lock(target):
            p=payload()
            if not signature_matches(target):
                backup=target/"actualizaciones"/(datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")+"_"+uuid.uuid4().hex[:8])
                safe_target(backup,root)
                backup.mkdir(parents=True)
                previous={}
                try:
                    for name in PAYLOAD_FILES:
                        dest=target/name
                        require(not dest.is_symlink(),"LAB_LINK_BLOCKED")
                        previous[name]=dest.read_bytes() if dest.exists() else None
                        if previous[name] is not None: (backup/name).write_bytes(previous[name])
                    for name in PAYLOAD_FILES:
                        tmp=target/(name+".updating")
                        require(not tmp.is_symlink(),"LAB_LINK_BLOCKED")
                        tmp.write_bytes((p/name).read_bytes());os.replace(tmp,target/name)
                    require(signature_matches(target),"LAB_INSTALL_HASH_MISMATCH")
                except BaseException:
                    for name,old in previous.items():
                        if old is None: (target/name).unlink(missing_ok=True)
                        else: (target/name).write_bytes(old)
                    raise
            if not (target/"config.json").exists(): write(target/"config.json",DEFAULT_CONFIG)
            if not (target/"requirements.txt").exists(): (target/"requirements.txt").write_text(REQUIREMENTS)
            write(target/"bridge_lab_version.json",{"version":VERSION,"schema":1})
            (state_dir(root)/"pending_update.json").unlink(missing_ok=True)
            result={"code":"LAB_UPDATED","version":VERSION,"config_preserved":True,"results_preserved":True}
            write(state_dir(root)/"update_result.json",result)
            return result
    except LabError as e:
        if str(e)!="LAB_BUSY_CLOSE_LAB_TO_UPDATE": raise
        write(state_dir(root)/"pending_update.json",{"requested":datetime.now(timezone.utc).isoformat()})
        return {"code":"LAB_UPDATE_WAITING_FOR_CLOSE","config_preserved":True,"results_preserved":True}

def safe_metrics(value):
    keys={"trades","wins","winrate","wilson95_lower","net","profit_factor","no_losses","max_drawdown_pct","open_trades"}
    if not isinstance(value,dict): return {}
    return {k:v for k,v in value.items() if k in keys and
            (v is None or type(v) in (bool,int,float) and (type(v) is bool or math.isfinite(v)))}

def results(root):
    target=installed(root)
    require(target is not None,"LAB_NOT_ATTACHED")
    folder=target/"experimentos"
    require(not folder.is_symlink(),"LAB_LINK_BLOCKED")
    items=sorted(folder.glob("*/estado.json")) if folder.exists() else []
    if not items: return {"code":"LAB_NO_RESULTS"}
    safe_target(items[-1],root)
    result=read(items[-1],{})
    output={"code":"LAB_RESULTS","status":str(result.get("status","UNKNOWN"))[:64]}
    if "validation" in result: output["validation"]=safe_metrics(result["validation"])
    windows=result.get("windows_14_30_60_90",{})
    output["windows_14_30_60_90"]={str(n):safe_metrics(windows.get(str(n),{})) for n in (14,30,60,90)}
    demo=read(items[-1].parent/"resultado_demo.json",{})
    if demo: output["demo"]={"status":str(demo.get("status","UNKNOWN"))[:64],"metrics":safe_metrics(demo.get("metrics",{}))}
    return output

def configuration_status(target):
    raw=read(target/"config.json",{})
    if not isinstance(raw,dict):
        return {"required":["config.json"],"invalid":[]}
    c={**DEFAULT_CONFIG,**raw}
    required=[]
    invalid=[]
    checks={"initial_balance":(0,None),"risk_pct":(0,2),
        "commission_roundtrip_per_lot":(0,None),"slippage_points_per_side":(0,None),
        "max_spread_points":(0,None),"target_winrate":(.70,1),
        "max_drawdown_pct":(0,10),"min_profit_factor":(1.2,None),"min_wilson_lower":(.60,1)}
    positive={"initial_balance","risk_pct","max_spread_points","max_drawdown_pct"}
    for key,(minimum,maximum) in checks.items():
        value=c.get(key)
        if value is None:
            required.append(key)
        elif type(value) not in (int,float) or not math.isfinite(value):
            invalid.append(key)
        elif value<minimum or (key in positive and value==0) or (maximum is not None and value>maximum):
            invalid.append(key)
    if c.get("time_confirmed") is not True:
        required.append("time_confirmed")
    return {"required":required,"invalid":invalid}

def status(root):
    target=installed(root)
    out={"code":"LAB_NOT_ATTACHED","version":VERSION,"attached":target is not None}
    if target:
        out.update(code="LAB_STATUS",installed_version=read(target/"bridge_lab_version.json",{}).get("version"),
                   busy=busy(target),update_pending=(state_dir(root)/"pending_update.json").exists())
        out["configuration"]=configuration_status(target)
        progress=read(target/"autopilot_progress.json",{})
        safe_keys={"phase","updated_at","processed_days","incomplete_days","total_days","candidates","last_day","expected_minutes","found_tick_minutes","found_bar_minutes","costs_verified","cost_assumptions","selected"}
        out["progress"]={k:v for k,v in progress.items() if k in safe_keys}
        if "best_training" in progress:out["progress"]["best_training"]=safe_metrics(progress["best_training"])
        if "validation" in progress:out["progress"]["validation"]=safe_metrics(progress["validation"])
        worker=read(target/"remote_result.json",{})
        allowed={"state","mode","code","updated_at"}
        out["worker"]={k:v for k,v in worker.items() if k in allowed and isinstance(v,str) and len(v)<=100}
    return out

def start(root, mode):
    target=installed(root)
    require(target is not None and signature_matches(target),"LAB_UPDATE_REQUIRED")
    require(not busy(target),"LAB_BUSY")
    # Never launch a second management worker even while preparing the environment.
    control=read(target/"remote_control.json",{})
    previous=read(target/"remote_result.json",{})
    if control and previous.get("state")=="RUNNING":
        require(time.time()-control.get("started_epoch",0)>86400,"LAB_REMOTE_JOB_ALREADY_RUNNING")
        raise LabError("LAB_REMOTE_STATE_REVIEW_REQUIRED")
    (target/"remote_stop").unlink(missing_ok=True)
    nonce=uuid.uuid4().hex
    write(target/"remote_control.json",{"nonce":nonce,"mode":mode,"started_epoch":time.time()})
    write(target/"remote_result.json",{"state":"RUNNING","mode":mode,"code":"LAB_JOB_STARTING","updated_at":datetime.now(timezone.utc).isoformat()})
    py=target/".venv"/("Scripts/python.exe" if os.name=="nt" else "bin/python")
    exe=str(py) if py.is_file() else sys.executable
    safe_target(py,root)
    args=[exe,"-u",str(target/"lab_remote_worker.py"),"--mode",mode,"--nonce",nonce]
    log=(target/"registros");require(not log.is_symlink(),"LAB_LINK_BLOCKED");log.mkdir(exist_ok=True)
    try:
        if mode=="autopilot":
            proc=subprocess.Popen(args,cwd=target,stdin=subprocess.DEVNULL,
                                  creationflags=getattr(subprocess,"CREATE_NEW_CONSOLE",0))
        else:
            with (log/"bridge_job.log").open("ab") as f:
                proc=subprocess.Popen(args,cwd=target,stdin=subprocess.DEVNULL,stdout=f,stderr=f,
                                      creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
    except OSError:
        write(target/"remote_result.json",{"state":"FAILED","mode":mode,"code":"LAB_PROCESS_START_FAILED","updated_at":datetime.now(timezone.utc).isoformat()})
        raise LabError("LAB_PROCESS_START_FAILED") from None
    return {"code":"LAB_JOB_STARTED","mode":mode}

def stop(root):
    target=installed(root)
    require(target is not None,"LAB_NOT_ATTACHED")
    result=read(target/"remote_result.json",{})
    require(result.get("state")=="RUNNING","LAB_NO_REMOTE_JOB_RUNNING")
    # Cooperative cancellation only. Never kill the open UI, MT5 or bridge.
    (target/"remote_stop").touch()
    return {"code":"LAB_STOP_REQUESTED","mode":result.get("mode","UNKNOWN")}

def maintain(root):
    state=state_dir(root)
    if (state/"pending_update.json").exists():
        try: update(root)
        except (LabError,OSError,ValueError): pass

def execute(job,root):
    validate_job(job)
    action=job["action"]
    if action=="lab_autopilot":
        target=bind(root)
        if busy(target):
            cfg=configuration_status(target)
            worker=read(target/"remote_result.json",{})
            require(worker.get("state")!="RUNNING","LAB_REMOTE_JOB_ALREADY_RUNNING")
            require(bool(cfg["required"] or cfg["invalid"]),"LAB_BUSY_WAIT_FOR_CURRENT_TEST")
            from lab_handoff import close_known_idle_ui,HandoffError
            try:close_known_idle_ui(target)
            except HandoffError as e:raise LabError(str(e)) from None
        applied=update(root)
        require(applied["code"]=="LAB_UPDATED","LAB_BUSY_WAIT_FOR_CURRENT_TEST")
        # Usa el terminal de datos ya preparado por el bridge si el Lab no tiene uno.
        settings=read(Path(root)/"settings.json",{})
        terminal=Path(root)/"mt5-test"
        marker=terminal/".olfx-owned"
        c=read(target/"config.json",{})
        if (not c.get("terminal_path") and marker.is_file() and not marker.is_symlink() and
            marker.read_text().strip()==settings.get("installation_id") and
            (terminal/"terminal64.exe").is_file()):
            c["terminal_path"]=str((terminal/"terminal64.exe").resolve())
            c["terminal_portable"]=True
            write(target/"config.json",c)
        return start(root,"autopilot")
    if action=="lab_discover": return {"code":"LAB_DISCOVERED","candidates":discover(root)}
    if action=="lab_attach":
        bind(root,job["candidate_id"]);return {"code":"LAB_ATTACHED"}
    if action=="lab_update": return update(root)
    if action=="lab_status": return status(root)
    if action=="lab_results": return results(root)
    if action=="lab_stop": return stop(root)
    modes={"lab_doctor":"doctor","lab_prepare":"prepare","lab_run":"optimize","lab_demo":"demo"}
    return start(root,modes[action])

