"""One-time migration to integrated supervision and separate owned demo/test terminals."""
import ctypes
from datetime import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

HERE=Path(__file__).resolve().parent
ROOT=Path(os.environ.get("LOCALAPPDATA",str(Path.home())))/"OLFX_MT5_BRIDGE"
DATA=ROOT/"resident-v2"
MANAGED=ROOT/"managed"
VERSION="2.1.0"
PREVIOUS={}
STOPPED=False

def atomic(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix(".tmp")
    temp.write_text(json.dumps(value,indent=2),encoding="utf-8");temp.replace(path)

def verify(folder):
    folder=Path(folder).resolve()
    data=json.loads((folder/"package_manifest.json").read_text(encoding="utf-8"))
    for name,record in data["files"].items():
        path=(folder/name).resolve()
        if folder not in path.parents or not path.is_file() or path.is_symlink() or path.stat().st_size!=record["size"] or hashlib.sha256(path.read_bytes()).hexdigest()!=record["sha256"]:
            raise RuntimeError("Paquete incompleto o alterado: "+name)

def pending_requests(folder,now=None):
    now=time.time() if now is None else now
    active=[]
    for path in Path(folder).glob("*.json"):
        try:
            state=json.loads(path.read_text(encoding="utf-8"))
            if state.get("job",{}).get("action")!="trade" or state.get("phase") in {"done","failed"}:continue
            if state.get("phase")=="waiting":
                stamp=datetime.fromisoformat(state["job"]["expires_at"].replace("Z","+00:00")).timestamp()
                if stamp<=now:continue
            active.append(state["id"])
        except (OSError,ValueError,KeyError):
            active.append("ESTADO_POR_VERIFICAR:"+path.stem)
    return active

def clone_demo_terminal(source,target,installation_id):
    source,target=Path(source),Path(target)
    marker=source/".olfx-owned"
    if not marker.is_file() or marker.read_text().strip()!=installation_id:
        raise RuntimeError("La terminal origen no pertenece al Bridge.")
    if target.exists():
        if not (target/".olfx-owned").is_file() or (target/".olfx-owned").read_text().strip()!=installation_id:
            raise RuntimeError("La carpeta de ejecucion no pertenece al Bridge.")
        return
    if shutil.disk_usage(source).free<2*1024**3:
        raise RuntimeError("Se necesitan al menos 2 GB libres para preparar la terminal independiente.")
    staging=target.with_name(target.name+".stage")
    if staging.exists():shutil.rmtree(staging)
    staging.mkdir(parents=True)
    try:
        for item in source.iterdir():
            if item.is_symlink():continue
            if item.is_file() and item.suffix.lower() in {".exe",".dll",".dat"}:
                shutil.copy2(item,staging/item.name)
            elif item.is_dir() and item.name.casefold() in {"config","bases","sounds","lang"}:
                shutil.copytree(item,staging/item.name,symlinks=False)
        if not (staging/"terminal64.exe").is_file():raise RuntimeError("Falta terminal64.exe.")
        (staging/"MQL5"/"Files").mkdir(parents=True)
        (staging/".olfx-owned").write_text(installation_id)
        staging.rename(target)
    finally:
        if staging.exists():shutil.rmtree(staging)

def install_baseline(package,managed):
    package,managed=Path(package),Path(managed)
    folder=managed/"versions"/"000000-2.1.0"
    folder.parent.mkdir(parents=True,exist_ok=True)
    staging=folder.with_name(".stage-"+str(time.time_ns()))
    shutil.copytree(package/"runtime",staging,ignore=shutil.ignore_patterns("__pycache__","*.pyc"))
    if folder.exists():folder.rename(folder.with_name(folder.name+".backup-"+str(time.time_ns())))
    staging.rename(folder)
    records={}
    for path in folder.rglob("*.py"):
        raw=path.read_bytes()
        records[str(path.relative_to(folder)).replace(os.sep,"/")]={"sha256":hashlib.sha256(raw).hexdigest(),"size":len(raw)}
    manifest={"schema":1,"sequence":0,"version":"2.1.0","launcher":2,"session_schema":1,"files":records}
    raw=(json.dumps(manifest,sort_keys=True,indent=2)+"\n").encode()
    (folder/"baseline_manifest.json").write_bytes(raw)
    atomic(managed/"trusted_baseline.json",{"dir":folder.name,"manifest_sha256":hashlib.sha256(raw).hexdigest()})
    atomic(managed/"current_runtime.json",{"dir":folder.name})
    return folder

def cmd(mode,title):
    return '@echo off\r\nsetlocal\r\ntitle '+title+'\r\nset "OLFX_ROOT=%LOCALAPPDATA%\\OLFX_MT5_BRIDGE"\r\n"%OLFX_ROOT%\\resident-v2\\venv\\Scripts\\python.exe" "%OLFX_ROOT%\\managed\\launcher\\bridge_bootstrap.py" '+mode+'\r\npause\r\n'

def desktop():
    buffer=ctypes.create_unicode_buffer(32768)
    if ctypes.windll.shell32.SHGetFolderPathW(None,0x10,None,0,buffer)==0:return Path(buffer.value)
    return Path.home()/"Desktop"

def main():
    global PREVIOUS,STOPPED
    if os.name!="nt":raise RuntimeError("WINDOWS_REQUIRED")
    verify(HERE)
    for path in (ROOT/"settings.json",ROOT/"mailbox.json",ROOT/"token.dpapi",ROOT/"current_runtime.json",DATA/"account-pin.json"):
        if not path.is_file():raise RuntimeError("Se necesita el Bridge y el Residente ya configurados.")
    subprocess.run([sys.executable,"-m","compileall","-q",str(HERE)],check=True)
    sys.path.insert(0,str(HERE/"runtime"))
    sys.path.insert(0,str(HERE/"runtime"/"legacy"))
    import bridge_agent as legacy
    # The import above is the legacy helper, not the lifecycle controller.
    from process_tools import locked,close_owned_terminal,process_path
    config=json.loads((ROOT/"settings.json").read_text(encoding="utf-8"))
    expected=json.loads((DATA/"account-pin.json").read_text(encoding="utf-8"))
    test=legacy.owned_terminal(ROOT)
    active=pending_requests(DATA/"state")
    if active:raise RuntimeError("Solicitudes todavia activas: "+", ".join(active)+". Dejalas terminar antes de instalar.")
    for path in (ROOT/"state").glob("*.json"):
        if json.loads(path.read_text(encoding="utf-8")).get("status")=="running":
            raise RuntimeError("Hay una tarea de pruebas en ejecucion. Espera a que termine.")
    import MetaTrader5 as mt5
    if not mt5.initialize(str(test/"terminal64.exe"),timeout=10000,portable=True):raise RuntimeError("No se pudo verificar la demo original.")
    try:
        account=mt5.account_info()
        info=mt5.terminal_info()
        if account is None or account.trade_mode!=mt5.ACCOUNT_TRADE_MODE_DEMO or str(account.login)!=str(expected["login"]) or account.server!=expected["server"]:
            raise RuntimeError("La cuenta original no coincide con la DEMO autorizada.")
        if info is None or Path(info.path).resolve()!=test:raise RuntimeError("Terminal diferente de la copia de pruebas.")
        positions,orders=mt5.positions_get(),mt5.orders_get()
        if positions is None or orders is None or positions or orders:
            raise RuntimeError("La demo debe estar sin posiciones ni ordenes pendientes para migrar. No se cerro ninguna.")
    finally:mt5.shutdown()
    session=ROOT/"structure-session.json"
    if session.is_file():
        record=json.loads(session.read_text(encoding="utf-8"))
        state=test/"MQL5"/"Files"/(record.get("stem","")+".json")
        if state.is_file() and json.loads(state.read_text(encoding="utf-8-sig")).get("code")!="SESSION_FINISHED":
            raise RuntimeError("La sesion del EA anterior no ha terminado.")
    PREVIOUS={"bridge":locked(ROOT/"agent.lock"),"resident":locked(DATA/"worker.lock")}
    print("Demo sin operaciones verificada. Solicitando parada ordenada de los agentes...")
    MANAGED.mkdir(parents=True,exist_ok=True)
    for path in (ROOT/"STOP",DATA/"STOP",MANAGED/"STOP"):path.touch()
    deadline=time.monotonic()+90
    locks=[ROOT/"agent.lock",DATA/"worker.lock",MANAGED/"launcher.lock",MANAGED/"supervisor.lock"]
    while any(locked(path) for path in locks):
        if time.monotonic()>deadline:raise RuntimeError("Los agentes no terminaron. No se forzo ningun cierre.")
        time.sleep(1)
    STOPPED=True
    pids=[pid for pid in legacy.processes_in(test) if process_path(pid).name.casefold()=="terminal64.exe"]
    close_owned_terminal(pids)
    deadline=time.monotonic()+30
    while any(process_path(pid).name.casefold()=="terminal64.exe" for pid in legacy.processes_in(test)):
        if time.monotonic()>deadline:raise RuntimeError("Cierra solo el MT5 de pruebas para completar la migracion.")
        time.sleep(1)
    print("Preparando la terminal de ejecucion independiente dentro de la VPS...")
    clone_demo_terminal(test,ROOT/"mt5-execution",config["installation_id"])
    shutil.copytree(HERE/"launcher",MANAGED/"launcher",dirs_exist_ok=True,ignore=shutil.ignore_patterns("__pycache__","*.pyc"))
    shutil.copytree(HERE/"original_launcher",MANAGED/"original_launcher",dirs_exist_ok=True,ignore=shutil.ignore_patterns("__pycache__","*.pyc"))
    shutil.copy2(ROOT/"mailbox.json",MANAGED/"mailbox.json")
    folder=install_baseline(HERE,MANAGED)
    print("Comprobando la terminal DEMO independiente; no se envian operaciones...")
    check=subprocess.run([sys.executable,str(folder/"resident_worker.py"),"doctor"],cwd=folder)
    if check.returncode!=0:
        raise RuntimeError("Falta completar el diagnostico de la nueva terminal. Las configuraciones anteriores se conservan.")
    backup=MANAGED/"backup_launchers"/str(int(time.time()))
    backup.mkdir(parents=True)
    links={"INICIAR_OLFX.cmd":("run","OLFX integrado - Bridge y Residente"),
           "PANEL_ORDENES.cmd":("manual","OLFX ordenes manuales DEMO"),
           "ESTRATEGIA.cmd":("strategy","OLFX estrategia DEMO"),
           "DIAGNOSTICO_OLFX.cmd":("doctor","OLFX diagnostico"),
           "DETENER_OLFX.cmd":("stop","OLFX detener")}
    for name,(mode,title) in links.items():
        path=ROOT/name
        if path.is_file():shutil.copy2(path,backup/name)
        path.write_bytes(cmd(mode,title).encode())
        shutil.copy2(path,desktop()/name)
    for name,mode in (("INICIAR_RESIDENTE.cmd","run"),("DETENER_RESIDENTE.cmd","stop"),("DIAGNOSTICAR_RESIDENTE.cmd","doctor"),("PANEL_ORDENES.cmd","manual"),("ESTRATEGIA.cmd","strategy")):
        path=DATA/name
        if path.exists():shutil.copy2(path,backup/("resident-"+name))
        path.write_bytes(cmd(mode,"OLFX integrado").encode())
    for path in (ROOT/"STOP",DATA/"STOP",MANAGED/"STOP"):path.unlink(missing_ok=True)
    subprocess.Popen(["cmd.exe","/k",str(ROOT/"INICIAR_OLFX.cmd")],cwd=ROOT,creationflags=subprocess.CREATE_NEW_CONSOLE)
    print("INSTALACION INTEGRADA TERMINADA. Conserva la ventana INICIAR_OLFX abierta.")
    print("Revisa DIAGNOSTICO_OLFX.cmd; debe mostrar ambos procesos y la edad de cotizacion.")
    print("No se envio ninguna operacion. Falta verificar el estado real de la VPS desde el chat.")

def recover_previous():
    if not STOPPED:return
    for marker in (ROOT/"STOP",DATA/"STOP",MANAGED/"STOP"):
        marker.unlink(missing_ok=True)
    flags=getattr(subprocess,"CREATE_NEW_CONSOLE",0)
    if PREVIOUS.get("bridge"):
        subprocess.Popen([sys.executable,str(HERE/"original_launcher"/"bridge_bootstrap.py"),"run"],cwd=HERE/"original_launcher",creationflags=flags)
    if PREVIOUS.get("resident") and (DATA/"INICIAR_RESIDENTE.cmd").is_file():
        subprocess.Popen(["cmd.exe","/k",str(DATA/"INICIAR_RESIDENTE.cmd")],cwd=DATA,creationflags=flags)
    print("Se solicito reiniciar los agentes que estaban activos antes de la instalacion.")

if __name__=="__main__":
    try:main()
    except Exception as exc:
        print("INSTALACION NO COMPLETADA:",str(exc))
        try:recover_previous()
        except Exception:print("Reabre los agentes anteriores desde sus accesos existentes.")
        sys.exit(1)
