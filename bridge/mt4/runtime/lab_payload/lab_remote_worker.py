"""Trabajo remoto de OLFX Lab. Modos fijos; sin ordenes de trading."""
import argparse
import contextlib
from datetime import datetime,timezone
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import traceback
import re
import uuid

ROOT=Path(__file__).resolve().parent

def write_result(state,mode,code):
    path=ROOT/"remote_result.json"
    tmp=path.with_name(path.name+"."+uuid.uuid4().hex+".tmp")
    tmp.write_text(json.dumps(dict(state=state,mode=mode,code=code,
        updated_at=datetime.now(timezone.utc).isoformat())),encoding="utf-8")
    os.replace(tmp,path)

@contextlib.contextmanager
def lock():
    p=ROOT/"instancia.lock"
    if p.is_symlink(): raise RuntimeError("LAB_LINK_BLOCKED")
    f=p.open("a+b")
    if p.stat().st_size == 0:
        f.write(b"0");f.flush()
    f.seek(0)
    try:
        if os.name=="nt":
            import msvcrt
            msvcrt.locking(f.fileno(),msvcrt.LK_NBLCK,1)
        else:
            import fcntl
            fcntl.flock(f.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        yield
    finally: f.close()

def prepare():
    if os.name!="nt" or sys.version_info[:2]!=(3,12):
        return "LAB_REQUIRES_WINDOWS_PYTHON_312"
    folder=ROOT/".venv"
    if folder.is_symlink(): return "LAB_LINK_BLOCKED"
    py=folder/"Scripts"/"python.exe"
    if not py.exists():
        subprocess.run([sys.executable,"-m","venv",str(folder)],check=True,timeout=120)
    # Dependencias de PyPI, nombres fijos. No ejecutar requirements de la cola.
    subprocess.run([str(py),"-m","pip","install","--only-binary=:all:","--timeout","30","--retries","2",
                    "MetaTrader5>=5.0.45,<6","numpy>=1.26,<3","tzdata>=2024.1"],check=True,timeout=600)
    return "LAB_RUNTIME_PREPARED"

def doctor():
    try:
        importlib.import_module("MetaTrader5")
        importlib.import_module("numpy")
        from zoneinfo import ZoneInfo
        ZoneInfo("America/New_York")
    except (ImportError,ModuleNotFoundError,KeyError):
        return "LAB_DEPENDENCIES_MISSING"
    import lab
    try: c=lab.config()
    except (ValueError,OSError,KeyError,TypeError):
        return "LAB_CONFIG_REQUIRED"
    mt=None
    try:
        mt,_,_,_=lab.connect(c)
        return "LAB_MT5_READY"
    except Exception:
        return "LAB_MT5_CHECK_FAILED"
    finally:
        if mt is not None: mt.shutdown()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--mode",choices=["doctor","prepare","optimize","demo","autopilot"],required=True)
    parser.add_argument("--nonce",required=True)
    args=parser.parse_args()
    control=json.loads((ROOT/"remote_control.json").read_text(encoding="utf-8"))
    if control.get("nonce")!=args.nonce or control.get("mode")!=args.mode:
        return 2
    done=threading.Event()
    def heartbeat():
        while not done.wait(15):
            write_result("RUNNING",args.mode,"LAB_JOB_RUNNING")
    thread=threading.Thread(target=heartbeat,daemon=True)
    state="COMPLETE";code="LAB_JOB_COMPLETE"
    try:
        with lock():
            thread.start()
            os.environ["OLFX_LAB_REMOTE"]="1"
            if args.mode=="autopilot":
                import autopilot
                autopilot.run()
                code="LAB_AUTOPILOT_FINISHED"
            elif args.mode=="prepare":
                code=prepare()
            elif args.mode=="doctor":
                code=doctor()
            else:
                code=doctor()
                if code=="LAB_MT5_READY":
                    import lab
                    (ROOT/"experimentos").mkdir(exist_ok=True)
                    if args.mode=="optimize": lab.experiment()
                    else: lab.demo()
                    code="LAB_JOB_COMPLETE"
            if code not in {"LAB_JOB_COMPLETE","LAB_MT5_READY","LAB_RUNTIME_PREPARED","LAB_AUTOPILOT_FINISHED"}:
                state="FAILED"
    except KeyboardInterrupt:
        state="STOPPED";code="LAB_STOPPED_WITH_STATE_PRESERVED"
    except BaseException as error:
        traceback.print_exc() # Solo registro LOCAL.
        state="FAILED"
        label=str(error)
        if re.fullmatch(r"LAB_[A-Z0-9_]{1,70}",label):
            code=label
        else:
            frames=traceback.extract_tb(error.__traceback__)
            allowed={"lab.py","range_structure.py","crt_strategy.py","autopilot.py","lab_remote_worker.py","history_data.py"}
            locations=[f for f in frames if Path(f.filename).name in allowed]
            location=locations[-1] if locations else None
            line=location.lineno if location is not None else 0
            name=type(error).__name__
            code="LAB_AUTO_"+name[:25]+"_L"+str(line)
    finally:
        done.set()
        if thread.is_alive(): thread.join(timeout=2)
        write_result(state,args.mode,code)
    if args.mode=="autopilot":
        print("\nOLFX AUTO | "+code+" | "+state,flush=True)
        print("Resultados guardados. Esta ventana muestra el estado del laboratorio.",flush=True)
        try:
            while not (ROOT/"remote_stop").exists():
                current=json.loads((ROOT/"remote_control.json").read_text())
                if current.get("nonce")!=args.nonce:break
                time.sleep(2)
        except (KeyboardInterrupt,OSError,ValueError):pass
    return 0 if state=="COMPLETE" else 1

if __name__=="__main__":
    sys.exit(main())

