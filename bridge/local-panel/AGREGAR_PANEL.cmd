@echo off
setlocal
cd /d "%~dp0"
set "OLFX_PANEL_PYTHON=%LOCALAPPDATA%\OLFX_MT5_BRIDGE\resident-v2\venv\Scripts\python.exe"
if not exist "%OLFX_PANEL_PYTHON%" (
 echo Primero instala OLFX Bridge Residente en esta VPS y con este usuario.
 pause
 exit /b 1
)
"%OLFX_PANEL_PYTHON%" "%~dp0install_panel.py"
pause
