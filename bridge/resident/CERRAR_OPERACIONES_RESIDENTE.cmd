@echo off
setlocal
title OLFX Cerrar Solo Operaciones Residentes
set "OLFX_RESIDENT_ROOT=%LOCALAPPDATA%\OLFX_MT5_BRIDGE\resident-v2"
"%OLFX_RESIDENT_ROOT%\venv\Scripts\python.exe" "%OLFX_RESIDENT_ROOT%\app\2.0.0-rc1\resident_worker.py" cancel
pause
