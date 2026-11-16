@echo off
setlocal
cd /d "%~dp0"
set "OLFX_MENU_PYTHON=%LOCALAPPDATA%\OLFX_MT5_BRIDGE\resident-v2\venv\Scripts\python.exe"
if not exist "%OLFX_MENU_PYTHON%" (
 echo Primero instala el receptor residente y el panel.
 pause
 exit /b 1
)
"%OLFX_MENU_PYTHON%" "%~dp0separar_menus.py"
pause
