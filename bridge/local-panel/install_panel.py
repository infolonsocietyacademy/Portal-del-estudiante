"""Install the local panel and compatible resident runtime; no trades submitted."""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

VERSION="2.0.1-rc1"
SOURCE=Path(__file__).resolve().parent
ROOT=Path(os.environ.get("LOCALAPPDATA",str(Path.home())))/"OLFX_MT5_BRIDGE"
DATA=ROOT/"resident-v2"

def active_requests(directory):
    active=[]
    for path in Path(directory).glob("*.json"):
        try:
            state=json.loads(path.read_text(encoding="utf-8"))
            if state.get("job",{}).get("action")=="trade" and state.get("phase") not in {"done","failed"}:
                active.append(state.get("id",path.stem))
        except (ValueError,OSError):
            active.append("ESTADO_POR_VERIFICAR:"+path.stem)
    return active

def verify_package(folder):
    folder=Path(folder)
    manifest=json.loads((folder/"manifest.json").read_text(encoding="utf-8"))
    for name,expected in manifest["files"].items():
        path=(folder/name).resolve()
        if folder.resolve() not in path.parents or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=expected:
            raise RuntimeError("Archivo ausente o alterado: "+name)

def running(directory):
    import msvcrt
    path=Path(directory)/"worker.lock"
    with path.open("a+b") as lock:
        lock.seek(0)
        if lock.read(1)==b"":
            lock.write(b"0")
            lock.flush()
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
        except OSError:
            return True
        lock.seek(0)
        msvcrt.locking(lock.fileno(),msvcrt.LK_UNLCK,1)
        return False

def launcher(mode,title):
    return '@echo off\r\nsetlocal\r\ntitle '+title+'\r\nset "OLFX_RESIDENT_ROOT=%LOCALAPPDATA%\\OLFX_MT5_BRIDGE\\resident-v2"\r\n"%OLFX_RESIDENT_ROOT%\\venv\\Scripts\\python.exe" "%OLFX_RESIDENT_ROOT%\\app\\'+VERSION+'\\resident_worker.py" '+mode+'\r\npause\r\n'

def desktop():
    buffer=ctypes.create_unicode_buffer(32768)
    result=ctypes.windll.shell32.SHGetFolderPathW(None,0x10,None,0,buffer)
    if result==0:
        return Path(buffer.value)
    return Path.home()/"Desktop"

def main():
    if os.name!="nt":
        raise RuntimeError("Este instalador es para Windows.")
    if not (DATA/"venv"/"Scripts"/"python.exe").is_file():
        raise RuntimeError("Primero instala OLFX Bridge Residente con el mismo usuario de Windows.")
    if not (DATA/"account-pin.json").is_file():
        raise RuntimeError("Primero completa el diagnostico DEMO del receptor existente.")
    verify_package(SOURCE)
    print("Ejecutando pruebas sin enviar operaciones...")
    subprocess.run([sys.executable,"-m","unittest","discover","-s",str(SOURCE/"tests"),"-v"],check=True)
    subprocess.run([sys.executable,"-m","compileall","-q",str(SOURCE)],check=True)
    print("Esperando a que el receptor quede sin solicitudes activas.")
    print("No cierra MT5 ni toca OLFX CONNECT. Tampoco fuerza el cierre de operaciones.")
    limit=time.monotonic()+300
    active=active_requests(DATA/"state")
    while active:
        print("Pendientes:",", ".join(active))
        if time.monotonic()>=limit:
            raise RuntimeError("Todavia hay solicitudes activas. Ejecuta AGREGAR_PANEL.cmd cuando terminen. No se modifico el receptor.")
        time.sleep(10)
        active=active_requests(DATA/"state")
    # Stop only this resident. The old launcher retains its own MT5 EAs and CONNECT.
    stop=DATA/"STOP"
    stop.touch()
    deadline=time.monotonic()+60
    while running(DATA):
        if time.monotonic()>=deadline:
            stop.unlink(missing_ok=True)
            raise RuntimeError("El receptor aun esta gestionando una solicitud. No se instala sobre un proceso activo.")
        time.sleep(1)
    if active_requests(DATA/"state"):
        stop.unlink(missing_ok=True)
        raise RuntimeError("Cambio de estado durante la parada; vuelve a verificar solicitudes antes de instalar.")
    app=DATA/"app"/VERSION
    backup=DATA/"backups"/("panel-"+str(int(time.time())))
    backup.mkdir(parents=True,exist_ok=True)
    names={"INICIAR_RESIDENTE.cmd":("run","OLFX Bridge Residente - DEMO"),
           "DIAGNOSTICAR_RESIDENTE.cmd":("doctor","OLFX Diagnostico Residente"),
           "DETENER_RESIDENTE.cmd":("stop","OLFX Detener Residente"),
           "CERRAR_OPERACIONES_RESIDENTE.cmd":("cancel","OLFX Cerrar Solo Operaciones Residentes")}
    for name in names:
        path=DATA/name
        if path.is_file():
            shutil.copy2(path,backup/name)
    shutil.copytree(SOURCE/"runtime",app,dirs_exist_ok=True)
    panel=DATA/"panel"
    panel.mkdir(parents=True,exist_ok=True)
    for name in ("panel_client.py","panel_local.py"):
        shutil.copy2(SOURCE/name,panel/name)
    shutil.copy2(SOURCE/"PANEL_ORDENES.cmd",DATA/"PANEL_ORDENES.cmd")
    for name,(mode,title) in names.items():
        (DATA/name).write_bytes(launcher(mode,title).encode("utf-8"))
    doctor=subprocess.run([sys.executable,str(app/"resident_worker.py"),"doctor"],cwd=app)
    if doctor.returncode!=0:
        for name in names:
            saved=backup/name
            if saved.is_file():
                shutil.copy2(saved,DATA/name)
        stop.unlink(missing_ok=True)
        subprocess.Popen(["cmd.exe","/k",str(DATA/"INICIAR_RESIDENTE.cmd")],cwd=DATA,creationflags=subprocess.CREATE_NEW_CONSOLE)
        raise RuntimeError("El diagnostico de la nueva version fallo. Se restauraron los accesos anteriores. No se envio ninguna operacion.")
    stop.unlink(missing_ok=True)
    try:
        shutil.copy2(DATA/"PANEL_ORDENES.cmd",desktop()/"OLFX_PANEL_ORDENES.cmd")
    except OSError:
        pass
    subprocess.Popen(["cmd.exe","/k",str(DATA/"INICIAR_RESIDENTE.cmd")],cwd=DATA,creationflags=subprocess.CREATE_NEW_CONSOLE)
    print("\nPANEL INSTALADO. Receptor compatible: "+VERSION)
    print("Abre OLFX_PANEL_ORDENES.cmd en el escritorio, o PANEL_ORDENES.cmd de este paquete.")
    print("Compras y ventas manuales con SL/TP propios, independientes del modo estructura.")
    print("No se abrio ninguna operacion durante la instalacion.")

if __name__=="__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Instalacion interrumpida. No se solicito cerrar operaciones.")
        sys.exit(1)
    except Exception as exc:
        print("INSTALACION NO COMPLETADA:",str(exc))
        sys.exit(1)
