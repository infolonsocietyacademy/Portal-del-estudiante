@echo off
setlocal
cd /d "%~dp0"
set "OLFX_PYTHON=%LOCALAPPDATA%\OLFX_MT5_BRIDGE\resident-v2\venv\Scripts\python.exe"
if not exist "%OLFX_PYTHON%" (
 echo Primero instala el Bridge y el Residente con este usuario de Windows.
 pause
 exit /b 1
)
"%OLFX_PYTHON%" "%~dp0install_integrated.py"
pause
