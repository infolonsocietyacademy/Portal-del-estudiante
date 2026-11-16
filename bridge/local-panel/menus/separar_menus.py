"""Install UI-only manual/strategy CMD separation. Does not stop or modify the receiver."""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

PAYLOAD=("menu_scope.py","panel_local.py","PANEL_ORDENES.cmd","ESTRATEGIA.cmd")

def verify(folder):
    folder=Path(folder).resolve()
    manifest=json.loads((folder/"manifest_menus.json").read_text(encoding="utf-8"))
    for name,expected in manifest["files"].items():
        path=(folder/name).resolve()
        if folder not in path.parents or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=expected:
            raise RuntimeError("Archivo del paquete ausente o alterado: "+name)

def install_ui(source,data,desktop=None):
    source,data=Path(source),Path(data)
    panel=data/"panel"
    if not (panel/"panel_client.py").is_file():
        raise RuntimeError("Primero instala el panel local compatible.")
    backup=data/"backups"/("menus-"+str(time.time_ns()))
    backup.mkdir(parents=True)
    updated=[]
    for name in PAYLOAD:
        target=(panel/name) if name.endswith(".py") else (data/name)
        if target.is_file():
            shutil.copy2(target,backup/name)
        temp=target.with_name(target.name+".menus-new")
        shutil.copy2(source/name,temp)
        temp.replace(target)
        updated.append(str(target))
    if desktop is not None:
        desktop=Path(desktop)
        desktop.mkdir(parents=True,exist_ok=True)
        shutil.copy2(data/"PANEL_ORDENES.cmd",desktop/"OLFX_PANEL_ORDENES.cmd")
        shutil.copy2(data/"ESTRATEGIA.cmd",desktop/"OLFX_ESTRATEGIA.cmd")
    return updated

def desktop_path():
    buffer=ctypes.create_unicode_buffer(32768)
    if ctypes.windll.shell32.SHGetFolderPathW(None,0x10,None,0,buffer)==0:
        return Path(buffer.value)
    return Path.home()/"Desktop"

def main():
    if os.name!="nt":
        raise RuntimeError("Este ajuste es para Windows.")
    folder=Path(__file__).resolve().parent
    verify(folder)
    data=Path(os.environ["LOCALAPPDATA"])/"OLFX_MT5_BRIDGE"/"resident-v2"
    launcher=data/"INICIAR_RESIDENTE.cmd"
    if not launcher.is_file() or "2.0.1-rc1" not in launcher.read_text(encoding="utf-8-sig"):
        raise RuntimeError("Primero completa la instalacion del panel con el receptor 2.0.1-rc1.")
    print("Comprobando menus; no se envian operaciones...")
    subprocess.run([sys.executable,"-m","compileall","-q",str(folder)],check=True)
    install_ui(folder,data,desktop_path())
    print("\nMENUS SEPARADOS INSTALADOS")
    print("PANEL_ORDENES.cmd: solo compras, ventas y gestion MANUAL.")
    print("ESTRATEGIA.cmd: solo la logica de estructura M1/M5.")
    print("Cada menu lista y cierra solamente sus propias solicitudes.")
    print("Cierra y vuelve a abrir las ventanas antiguas del menu para ver el cambio.")
    print("MT5, OLFX CONNECT y el receptor permanecen funcionando.")
    print("El receptor y las estrategias no fueron modificados. No se abrieron operaciones.")

if __name__=="__main__":
    try:
        main()
    except Exception as exc:
        print("AJUSTE NO COMPLETADO:",str(exc))
        sys.exit(1)
