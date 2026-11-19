@echo off
setlocal
cd /d "%~dp0"
title OLFX Copy Trade - Simulacion y Demo
echo OLFX COPY TRADE - Una maestra a tus cuentas receptoras
echo Configura las cuentas y los lotajes desde Copy Trade en el portal.
echo Esta version admite simulacion o cuentas receptoras DEMO.
echo.
py -3.12 -c "import MetaTrader5" >nul 2>&1
if errorlevel 1 (
  echo Falta Python 3.12 de 64 bits o MetaTrader5 para Python.
  echo Instala los requisitos con: py -3.12 -m pip install -r requirements.txt
  pause
  exit /b 1
)
if not exist "%LOCALAPPDATA%\OLFXConnect\settings.json" (
  echo Primero empareja OLFX CONNECT con el portal.
  pause
  exit /b 1
)
py -3.12 -u portal_agent.py
echo.
echo El agente se detuvo. Revisa el mensaje anterior.
pause
