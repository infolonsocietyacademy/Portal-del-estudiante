"""Cierra solo la UI conocida del Lab si su configuracion impide probar.

No cierra el bridge, MT5, otros Python ni trabajos remotos.
"""
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import subprocess

LEGACY_HASHES={"lab.py":"adca371f02e5b7ae8364b2949606ae74678baa380314edb955c31a87f8406823","simple_ui.py":"5b2f42524aa82c3f096359fc29811086672f5c6db916c5bec82701501e5074b4"}

class HandoffError(Exception):pass

def matches(process,target,argv):
    exe=Path(str(process.get("ExecutablePath",""))).resolve()
    expected=(Path(target)/".venv"/"Scripts"/"python.exe").resolve()
    scripts=[Path(a).resolve() for a in argv[1:] if isinstance(a,str) and a.lower().endswith(".py")]
    launcher=Path(str(argv[0])).resolve() if argv else None
    return (exe.name.lower() in {"python.exe","pythonw.exe"} and
            (exe==expected or launcher==expected) and
            scripts==[(Path(target)/"simple_ui.py").resolve()])

def query():
    script="Get-CimInstance Win32_Process -Filter \"Name='python.exe' OR Name='pythonw.exe'\" | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress"
    p=subprocess.run(["powershell.exe","-NoProfile","-NonInteractive","-Command",script],
                     capture_output=True,text=True,timeout=15,creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
    if p.returncode:raise HandoffError("LAB_UI_DISCOVERY_FAILED")
    value=json.loads(p.stdout or "[]")
    return value if isinstance(value,list) else [value]

def argv_windows(text):
    shell=ctypes.WinDLL("shell32",use_last_error=True)
    shell.CommandLineToArgvW.argtypes=[wintypes.LPCWSTR,ctypes.POINTER(ctypes.c_int)]
    shell.CommandLineToArgvW.restype=ctypes.POINTER(wintypes.LPWSTR)
    n=ctypes.c_int()
    ptr=shell.CommandLineToArgvW(str(text),ctypes.byref(n))
    if not ptr:raise HandoffError("LAB_UI_COMMAND_UNVERIFIED")
    try:return [ptr[i] for i in range(n.value)]
    finally:
        k=ctypes.WinDLL("kernel32",use_last_error=True)
        k.LocalFree.argtypes=[ctypes.c_void_p];k.LocalFree(ctypes.cast(ptr,ctypes.c_void_p))

def close_known_idle_ui(target):
    if os.name!="nt":raise HandoffError("LAB_UI_HANDOFF_REQUIRES_WINDOWS")
    target=Path(target)
    for name,wanted in LEGACY_HASHES.items():
        p=target/name
        if not p.is_file() or p.is_symlink() or hashlib.sha256(p.read_bytes()).hexdigest()!=wanted:
            raise HandoffError("LAB_UI_VERSION_NOT_VERIFIED")
    k=ctypes.WinDLL("kernel32",use_last_error=True)
    k.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD];k.OpenProcess.restype=wintypes.HANDLE
    k.CloseHandle.argtypes=[wintypes.HANDLE]
    k.QueryFullProcessImageNameW.argtypes=[wintypes.HANDLE,wintypes.DWORD,wintypes.LPWSTR,ctypes.POINTER(wintypes.DWORD)]
    k.TerminateProcess.argtypes=[wintypes.HANDLE,wintypes.UINT]
    k.WaitForSingleObject.argtypes=[wintypes.HANDLE,wintypes.DWORD]
    candidates=[p for p in query() if matches(p,target,argv_windows(p.get("CommandLine","")))]
    if len(candidates)!=1:raise HandoffError("LAB_UI_NOT_UNIQUELY_IDENTIFIED")
    p=candidates[0];pid=int(p["ProcessId"])
    handle=k.OpenProcess(0x00100000|0x1000|0x0001,False,pid)
    if not handle:raise HandoffError("LAB_UI_ACCESS_FAILED")
    try:
        size=wintypes.DWORD(32768);path=ctypes.create_unicode_buffer(size.value)
        if not k.QueryFullProcessImageNameW(handle,0,path,ctypes.byref(size)):
            raise HandoffError("LAB_UI_PROCESS_UNVERIFIED")
        if Path(path.value).resolve()!=Path(str(p["ExecutablePath"])).resolve():
            raise HandoffError("LAB_UI_PROCESS_CHANGED")
        # Con el handle abierto, comprueba otra vez identidad y argumentos.
        current=[r for r in query() if int(r["ProcessId"])==pid]
        if len(current)!=1 or not matches(current[0],target,argv_windows(current[0].get("CommandLine",""))):
            raise HandoffError("LAB_UI_PROCESS_CHANGED")
        if not k.TerminateProcess(handle,0):raise HandoffError("LAB_UI_CLOSE_FAILED")
        k.WaitForSingleObject(handle,5000)
    finally:k.CloseHandle(handle)
    return True

