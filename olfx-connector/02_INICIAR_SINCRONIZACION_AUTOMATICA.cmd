@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title OLFX CONNECT - SINCRONIZACION AUTOMATICA
echo ==================================================
echo OLFX CONNECT - SINCRONIZACION AUTOMATICA MT5
echo ==================================================
echo.
echo Una cuenta recien vinculada se revisa en unos 15 segundos.
echo Las cuentas ya sincronizadas se refrescan 1 vez al dia.
echo Este programa no ejecuta operaciones.
echo.
py -3.12 --version >nul 2>&1
if errorlevel 1 (
  echo ERROR: No se encontro Python 3.12. Instala Python 3.12 de 64 bits.
  goto :end
)
if not exist "olfx_agent.py" (
  echo ERROR: olfx_agent.py tiene que estar en esta misma carpeta.
  goto :end
)
py -3.12 -c "import MetaTrader5, cryptography, httpx" >nul 2>&1
if errorlevel 1 (
  echo Instalando componentes necesarios...
  py -3.12 -m pip install -r requirements.txt
  if errorlevel 1 goto :end
)
echo.
echo Iniciando lector MT5. Manten esta ventana abierta.
echo Cuando un estudiante agregue su cuenta en el portal, el lector la detectara.
echo Para salir, presiona CTRL+C.
echo.
py -3.12 -u olfx_agent.py watch
echo.
echo El lector dejo de ejecutarse. Revisa el mensaje superior.
:end
echo.
pause
