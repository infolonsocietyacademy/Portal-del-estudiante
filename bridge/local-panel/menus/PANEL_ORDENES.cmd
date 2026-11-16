@echo off
setlocal
title OLFX - Solo ordenes manuales DEMO
set "OLFX_MENU_ROOT=%LOCALAPPDATA%\OLFX_MT5_BRIDGE\resident-v2"
"%OLFX_MENU_ROOT%\venv\Scripts\python.exe" "%OLFX_MENU_ROOT%\panel\panel_local.py" manual
pause
