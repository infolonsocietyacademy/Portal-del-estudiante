"""Windows ownership and byte-range locks. Never reads a locked byte."""
import ctypes
from ctypes import wintypes
import os
from pathlib import Path
import time
def lock(path,probe=False):
    import msvcrt
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    stream=path.open("a+b")
    if os.fstat(stream.fileno()).st_size==0:
        stream.write(b"0");stream.flush()
    stream.seek(0)
    try:msvcrt.locking(stream.fileno(),msvcrt.LK_NBLCK,1)
    except OSError:stream.close();return None
    if probe:
        stream.seek(0);msvcrt.locking(stream.fileno(),msvcrt.LK_UNLCK,1);stream.close()
        return True
    return stream
def locked(path):
    return lock(path,probe=True) is None
def close_owned_terminal(pids):
    """Graceful WM_CLOSE only to windows owned by verified dedicated MT5 PIDs."""
    if os.name!="nt":raise RuntimeError("WINDOWS_REQUIRED")
    owned=set(pids)
    callback_type=ctypes.WINFUNCTYPE(wintypes.BOOL,wintypes.HWND,wintypes.LPARAM)
    user=ctypes.windll.user32
    user.GetWindowThreadProcessId.argtypes=[wintypes.HWND,ctypes.POINTER(wintypes.DWORD)]
    user.SendMessageTimeoutW.argtypes=[wintypes.HWND,wintypes.UINT,wintypes.WPARAM,wintypes.LPARAM,wintypes.UINT,wintypes.UINT,ctypes.POINTER(ctypes.c_size_t)]
    user.SendMessageTimeoutW.restype=wintypes.LPARAM
    user.EnumWindows.argtypes=[callback_type,wintypes.LPARAM]
    @callback_type
    def visit(hwnd,unused):
        pid=wintypes.DWORD()
        user.GetWindowThreadProcessId(hwnd,ctypes.byref(pid))
        if pid.value in owned:
            result=ctypes.c_size_t()
            user.SendMessageTimeoutW(hwnd,0x0010,0,0,0x0002,3000,ctypes.byref(result))
        return True
    user.EnumWindows(visit,0)

def process_path(pid):
    kernel=ctypes.windll.kernel32
    kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
    kernel.OpenProcess.restype=wintypes.HANDLE
    kernel.QueryFullProcessImageNameW.argtypes=[wintypes.HANDLE,wintypes.DWORD,wintypes.LPWSTR,ctypes.POINTER(wintypes.DWORD)]
    kernel.CloseHandle.argtypes=[wintypes.HANDLE]
    handle=kernel.OpenProcess(0x1000,False,pid)
    if not handle:raise RuntimeError("PROCESS_IDENTITY_UNAVAILABLE")
    try:
        size=wintypes.DWORD(32768)
        buffer=ctypes.create_unicode_buffer(size.value)
        if not kernel.QueryFullProcessImageNameW(handle,0,buffer,ctypes.byref(size)):
            raise RuntimeError("PROCESS_IDENTITY_UNAVAILABLE")
        return Path(buffer.value).resolve()
    finally:
        kernel.CloseHandle(handle)
