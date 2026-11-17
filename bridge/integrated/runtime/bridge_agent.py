"""Unified lifecycle controller. Broker operations remain in the guarded DEMO worker."""
import argparse
from datetime import datetime,timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from process_tools import locked,lock
from update_handoff import mark_ready,update_pending

VERSION="2.2.0"
ROOT=Path(os.environ.get("LOCALAPPDATA",str(Path.home())))/"OLFX_MT5_BRIDGE"
MANAGED=ROOT/"managed"
RESIDENT=ROOT/"resident-v2"
HERE=Path(__file__).resolve().parent

def read(path,default=None):
    try:return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError,ValueError):return default

def atomic(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix(".tmp")
    temp.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding="utf-8")
    temp.replace(path)

def idle(root):
    root=Path(root)
    for folder in (root/"resident-v2"/"state",root/"state"):
        for path in folder.glob("*.json"):
            state=read(path)
            if not isinstance(state,dict):return False
            if state.get("status")=="running" or (state.get("job",{}).get("action")=="trade" and state.get("phase") not in {"done","failed"}):
                return False
    manifest=read(root/"structure-session.json")
    if manifest:
        stem=manifest.get("stem","")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}",stem):return False
        state=read(root/"mt5-test"/"MQL5"/"Files"/(stem+".json"))
        if not state or state.get("code")!="SESSION_FINISHED":return False
    return True

def request_stop():
    MANAGED.mkdir(parents=True,exist_ok=True)
    RESIDENT.mkdir(parents=True,exist_ok=True)
    (MANAGED/"STOP").touch()
    (ROOT/"STOP").touch()
    (RESIDENT/"STOP").touch()

def spawn(script,mode="run"):
    flags=getattr(subprocess,"CREATE_NEW_PROCESS_GROUP",0)
    env=dict(os.environ,OLFX_RUNTIME_DIR=str(HERE))
    return subprocess.Popen([sys.executable,str(script),mode],cwd=script.parent,env=env,creationflags=flags)

class Restart:
    def __init__(self):
        self.failures=0
        self.next_at=0.
    def failed(self,now):
        self.failures+=1
        self.next_at=now+min(60,2**min(self.failures,5))
    def due(self,now):return now>=self.next_at

def run():
    MANAGED.mkdir(parents=True,exist_ok=True)
    handle=lock(MANAGED/"supervisor.lock")
    if handle is None:
        print("OLFX integrado ya esta activo.",flush=True)
        return 0
    processes={}
    backoff={name:Restart() for name in ("bridge","resident")}
    scripts={"bridge":MANAGED/"original_launcher"/"bridge_bootstrap.py","resident":HERE/"resident_worker.py"}
    lockfiles={"bridge":ROOT/"agent.lock","resident":RESIDENT/"worker.lock"}
    started=time.time()
    marked=False
    draining=False
    failure_drain=False
    last_display=0.
    try:
        while True:
            stopping=(MANAGED/"STOP").exists()
            drain=read(MANAGED/"failure-drain.json",{})
            if drain.get("nonce")==os.environ.get("OLFX_BRIDGE_LAUNCH_NONCE","") and drain.get("nonce"):
                failure_drain=True;draining=True
            if update_pending(MANAGED) and not stopping and idle(ROOT):
                draining=True
            if stopping or draining:
                (ROOT/"STOP").touch();(RESIDENT/"STOP").touch()
                if not any(locked(path) for path in lockfiles.values()):
                    return 1 if failure_drain else 75 if draining and not stopping else 0
            else:
                for name,script in scripts.items():
                    process=processes.get(name)
                    if process is not None and process.poll() is not None:
                        processes.pop(name,None)
                        backoff[name].failed(time.monotonic())
                    if name not in processes and not locked(lockfiles[name]) and backoff[name].due(time.monotonic()):
                        marker=ROOT/"STOP" if name=="bridge" else RESIDENT/"STOP"
                        marker.unlink(missing_ok=True)
                        try:
                            processes[name]=spawn(script)
                            print("OLFX: iniciando "+name+".",flush=True)
                        except OSError:
                            backoff[name].failed(time.monotonic())
                            print("OLFX: no se pudo iniciar "+name+"; se reintentara.",flush=True)
            bridge_running=locked(lockfiles["bridge"])
            resident_running=locked(lockfiles["resident"])
            resident_health=read(RESIDENT/"local-health.json",{})
            fresh=0<=time.time()-resident_health.get("updated_at",0)<20 and resident_health.get("nonce")==os.environ.get("OLFX_BRIDGE_LAUNCH_NONCE","")
            ready=bridge_running and resident_running and fresh and resident_health.get("version")==VERSION
            if ready and not marked:
                mark_ready(MANAGED,VERSION);marked=True
                print("OLFX INTEGRADO ACTIVO: Bridge + Residente; menus manual y estrategia separados.",flush=True)
            status={"version":VERSION,"updated_at":datetime.now(timezone.utc).isoformat(),
                    "bridge_running":bridge_running,"resident_running":resident_running,"resident_heartbeat_fresh":fresh,
                    "resident_code":resident_health.get("code","STARTING"),"ready":ready,
                    "state":"stopping" if stopping else "updating" if draining else "running" if ready else "recovering",
                    "auto_update":"signed","test_terminal":"mt5-test","execution_terminal":"mt5-execution"}
            atomic(MANAGED/"system-health.json",status)
            if time.monotonic()-last_display>30:
                print("OLFX | Bridge: "+("activo" if bridge_running else "reintentando")+" | Residente: "+status["resident_code"],flush=True)
                last_display=time.monotonic()
            time.sleep(1)
    except KeyboardInterrupt:
        request_stop()
        print("OLFX: parada solicitada; esperando gestion de posiciones pendientes.",flush=True)
        while any(locked(path) for path in lockfiles.values()):
            time.sleep(1)
        return 130
    finally:
        handle.close()

def doctor():
    status=read(MANAGED/"system-health.json",{})
    print(json.dumps(status,ensure_ascii=False,indent=2))
    import resident_worker
    resident_worker.doctor()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("mode",choices=["run","stop","doctor","manual","strategy","drain"])
    args=parser.parse_args()
    if args.mode=="run":return run()
    if args.mode=="drain":
        atomic(MANAGED/"failure-drain.json",{"nonce":os.environ.get("OLFX_BRIDGE_LAUNCH_NONCE","")});return 0
    if args.mode=="stop":
        request_stop();print("Parada solicitada. Mantiene la gestion de operaciones hasta terminar.");return 0
    if args.mode=="doctor":doctor();return 0
    env=dict(os.environ,OLFX_RUNTIME_DIR=str(HERE))
    return subprocess.call([sys.executable,str(HERE/"panel_local.py"),args.mode],cwd=HERE,env=env)

if __name__=="__main__":
    try:sys.exit(main() or 0)
    except Exception:
        print("OLFX: error local del supervisor. No se publicaron datos privados.",flush=True)
        sys.exit(1)
