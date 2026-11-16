"""Outbound resident worker: dedicated mailbox, existing demo MT5, no terminal restart."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import queue
import re
import sys
import threading
import time
from resident_core import Engine, Fault, VERSION, atomic, fingerprint, need

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE / "legacy"))
import bridge_agent as legacy
from gold_settings import load_gold_settings

ROOT=legacy.ROOT
DATA=ROOT / "resident-v2"
DEVICE=legacy.DEVICE+"-resident"
PREFIX="bridge/resident-v2"
STOP=DATA / "STOP"
CANCEL=DATA / "CANCEL"
LOG=DATA / "resident.log"

def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")

def message(code):
    DATA.mkdir(parents=True,exist_ok=True)
    line=now()+" "+code
    print(line,flush=True)
    with LOG.open("a",encoding="utf-8") as out:
        out.write(line+"\n")

def singleton():
    import msvcrt
    DATA.mkdir(parents=True,exist_ok=True)
    stream=(DATA / "worker.lock").open("a+b")
    stream.seek(0)
    if stream.read(1)==b"":
        stream.write(b"0")
        stream.flush()
    stream.seek(0)
    try:
        msvcrt.locking(stream.fileno(),msvcrt.LK_NBLCK,1)
    except OSError:
        stream.close()
        raise Fault("RESIDENT_ALREADY_RUNNING") from None
    return stream

def connect():
    need(os.name=="nt","WINDOWS_REQUIRED")
    terminal=legacy.owned_terminal(ROOT)
    # Explicit owned path; never discover terminals or call mt5.login().
    import MetaTrader5 as mt5
    need(mt5.initialize(str(terminal / "terminal64.exe"),timeout=10000,portable=True),"MT5_CONNECT_FAILED")
    config=load_gold_settings(ROOT)
    pin=DATA / "account-pin.json"
    expected=json.loads(pin.read_text(encoding="utf-8")) if pin.is_file() else legacy.local_demo_from_logs(terminal)
    engine=Engine(mt5,DATA / "state",expected,terminal,config)
    engine.guard()
    if not pin.is_file():
        atomic(pin,expected)
    return mt5,engine

def public_status(engine,code="RESIDENT_ONLINE"):
    active=[engine.summary(s) for s in engine.states.values() if s["job"]["action"]=="trade" and s["phase"] not in {"done","failed"}]
    return {"schema":2,"version":VERSION,"state":"online","code":code,"updated_at":now(),
            "terminal_reused":True,"account_type_verified":"demo","device":DEVICE,
            "active_count":len(active),"active":active,
            "actions":["ping","diagnose","status","trade","close"],"periods":["M1","M5"]}

def bridge_network(incoming,outgoing,halt):
    """Network never blocks the trading/closing loop. No MT5 calls in this thread."""
    gh=legacy.GitHub(legacy.dpapi((ROOT / "token.dpapi").read_bytes(),False).decode())
    latest={}
    sent={}
    last_poll=0
    while not halt.is_set():
        while True:
            try:
                path,value=outgoing.get_nowait()
                latest[path]=value
            except queue.Empty:
                break
        try:
            if time.monotonic()-last_poll>=10:
                control=gh.json(PREFIX+"/control/"+DEVICE+".json")
                need(isinstance(control,dict) and control.get("schema")==2 and control.get("device")==DEVICE,"INVALID_RESIDENT_CONTROL")
                need(type(control.get("enabled")) is bool,"INVALID_RESIDENT_CONTROL")
                jobs=control.get("jobs")
                need(isinstance(jobs,list) and len(jobs)<=100,"INVALID_RESIDENT_QUEUE")
                ids=[j.get("id") for j in jobs if isinstance(j,dict)]
                need(len(ids)==len(jobs) and all(isinstance(i,str) for i in ids) and len(set(ids))==len(ids),"DUPLICATE_TASK_ID")
                if control["enabled"]:
                    incoming.put(jobs)
                last_poll=time.monotonic()
            for path,value in list(latest.items()):
                key=json.dumps(value,sort_keys=True)
                if sent.get(path)!=key:
                    gh.put(path,value)
                    sent[path]=key
                if latest.get(path) is value:
                    latest.pop(path,None)
        except Exception:
            # Never print raw exception bodies: provider errors may contain private data.
            message("NETWORK_RETRY_MANAGEMENT_CONTINUES")
        halt.wait(1)

def doctor():
    mt5,engine=connect()
    try:
        engine.guard(trade=True)
        message("RESIDENT_READY: DEMO verificada; no se envio ninguna operacion.")
        message("MT5 abierto se reutiliza. Dispositivo: "+DEVICE)
    finally:
        mt5.shutdown()  # Disconnect Python IPC, does not close MT5.

def run():
    lock=singleton()
    STOP.unlink(missing_ok=True)
    CANCEL.unlink(missing_ok=True)
    mt5,engine=connect()
    incoming,outgoing=queue.Queue(),queue.Queue()
    halt=threading.Event()
    worker=threading.Thread(target=bridge_network,args=(incoming,outgoing,halt),daemon=True)
    worker.start()
    message("RESIDENT "+VERSION+" ACTIVO; M1/M5; MT5 puede permanecer abierto.")
    revisions={}
    last_upload=0
    last_guard=0
    guard_code="RESIDENT_ONLINE"
    try:
        while True:
            if STOP.exists():
                # Stop accepting entries; keep managing owned positions until confirmed flat.
                for state in engine.states.values():
                    if state["job"]["action"]=="trade" and state["phase"]=="waiting":
                        state["cancel"]=True
                        engine.save(state)
            if CANCEL.exists():
                for state in engine.states.values():
                    if state["job"]["action"]=="trade" and state["phase"] not in {"done","failed"}:
                        state["cancel"]=True
                        engine.save(state)
                CANCEL.unlink(missing_ok=True)
            while True:
                try:
                    jobs=incoming.get_nowait()
                except queue.Empty:
                    break
                if STOP.exists():
                    continue
                for job in jobs:
                    try:
                        engine.accept(job)
                    except (Fault,legacy.BridgeError) as exc:
                        jid=job.get("id") if isinstance(job,dict) else None
                        if isinstance(jid,str) and re.fullmatch(r"[A-Za-z0-9_-]{1,64}",jid) and jid not in engine.states:
                            engine.save({"id":jid,"job":{"id":jid,"action":"rejected"},"fingerprint":fingerprint(job),"phase":"failed","code":str(exc),"created_at":time.time()})
                    except Exception:
                        message("LOCAL_TASK_ERROR_CHECK_CONFIGURATION")
            engine.tick()
            if time.monotonic()-last_guard>=5:
                try:
                    engine.guard(trade=True)
                    guard_code="RESIDENT_ONLINE"
                except Fault as exc:
                    guard_code=str(exc)
                last_guard=time.monotonic()
            for state in engine.states.values():
                result=engine.summary(state)
                # Heartbeats and floating P/L at most once per minute; transitions immediately.
                stable={k:v for k,v in result.items() if k not in {"updated_at","floating_profit","held_seconds"}}
                signature=json.dumps(stable,sort_keys=True)
                if revisions.get(state["id"])!=signature or time.monotonic()-last_upload>=60:
                    outgoing.put((PREFIX+"/results/"+DEVICE+"/"+state["id"]+".json",result))
                    revisions[state["id"]]=signature
            if time.monotonic()-last_upload>=60:
                outgoing.put((PREFIX+"/status/"+DEVICE+".json",public_status(engine,guard_code)))
                last_upload=time.monotonic()
            active=any(s["job"]["action"]=="trade" and s["phase"] not in {"done","failed"} for s in engine.states.values())
            if STOP.exists() and not active:
                message("RESIDENT_DETENIDO_SIN_POSICIONES_PROPIAS_PENDIENTES")
                break
            time.sleep(1)
    except KeyboardInterrupt:
        message("PARADA_SOLICITADA: usa DETENER_RESIDENTE.cmd para dejar gestionar cierres pendientes.")
        STOP.touch()
        # Remain alive to preserve hold timers; terminate only after managing all own orders.
        run_drain(engine)
    finally:
        halt.set()
        worker.join(timeout=2)
        mt5.shutdown()
        lock.close()

def run_drain(engine):
    for state in engine.states.values():
        if state["job"]["action"]=="trade" and state["phase"]=="waiting":
            state["cancel"]=True
            engine.save(state)
    while any(s["job"]["action"]=="trade" and s["phase"] not in {"done","failed"} for s in engine.states.values()):
        engine.tick()
        time.sleep(1)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("mode",choices=["run","doctor","stop","cancel"])
    args=parser.parse_args()
    DATA.mkdir(parents=True,exist_ok=True)
    if args.mode in {"stop","cancel"}:
        (STOP if args.mode=="stop" else CANCEL).touch()
        print("Solicitud guardada. Deja la ventana del receptor abierta hasta confirmar los cierres.")
    elif args.mode=="doctor":
        doctor()
    else:
        run()

if __name__=="__main__":
    try:
        main()
    except (Fault,legacy.BridgeError) as exc:
        message(str(exc))
        if str(exc)=="PYTHON_TRADING_DISABLED":
            print("En MT5: Tools > Options > Expert Advisors. Activa Algo Trading y desmarca 'Disable automated trading via external Python API'.")
        sys.exit(1)
    except Exception:
        message("LOCAL_ERROR_SEE_CONFIGURATION; no se publicaron datos privados.")
        sys.exit(1)
