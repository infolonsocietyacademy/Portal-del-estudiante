@echo off
setlocal
title OLFX - PANEL DE ORDENES DEMO
set "OLFX_PANEL_ROOT=%LOCALAPPDATA%\OLFX_MT5_BRIDGE\resident-v2"
"%OLFX_PANEL_ROOT%\venv\Scripts\python.exe" "%OLFX_PANEL_ROOT%\panel\panel_local.py"
pause
