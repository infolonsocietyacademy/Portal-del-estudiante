@echo off
setlocal EnableExtensions
title OLFX CONNECT - VPS AUTOACTUALIZABLE
set "OLFX_HOME=%LOCALAPPDATA%\OLFXConnect"
set "OLFX_AGENT=%OLFX_HOME%\olfx_agent.py"
set "OLFX_BACKUP=%OLFX_HOME%\olfx_agent.py.previous"
set "OLFX_RAW=https://raw.githubusercontent.com/infolonsocietyacademy/Portal-del-estudiante/main/olfx-connector/olfx_agent.py"
set "OLFX_DISABLE_AUTOUPDATE="
set "OLFX_AUTOUPDATE_SUPERVISED=1"
set "OLFX_JUST_UPDATED=0"

echo ======================================================
echo  OLFX CONNECT - VPS / ACTUALIZACION AUTOMATICA
echo ======================================================
echo.
echo Nuevas cuentas: comprobacion cada 15 segundos.
echo Codigo Python: actualizacion desde GitHub cada 5 min.
echo Las sincronizaciones MT5 terminan antes de actualizar.
echo Configuracion y claves privadas: nunca se reemplazan.
echo.
py -3.12 --version >nul 2>&1
if errorlevel 1 (
  echo ERROR: Instala Python 3.12 x64 primero.
  goto :STOP
)
if not exist "%OLFX_HOME%\settings.json" (
  echo ERROR: Falta settings.json en %OLFX_HOME%.
  echo Copia la configuracion original de OLFX CONNECT.
  goto :STOP
)
if not exist "%OLFX_HOME%\private_key.pem" (
  echo ERROR: Falta private_key.pem en %OLFX_HOME%.
  echo No generes otra clave: conserva la configuracion original.
  goto :STOP
)
if not exist "%OLFX_HOME%" mkdir "%OLFX_HOME%"
echo Descargando ultima version desde tu GitHub (si hay Internet)...
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest -Uri '%OLFX_RAW%' -OutFile '%OLFX_AGENT%.download' -UseBasicParsing" >nul 2>&1
if not errorlevel 1 (
  py -3.12 -c "import pathlib; p=pathlib.Path(r'%OLFX_AGENT%.download'); s=p.read_bytes(); assert 4000 <= len(s) <= 250000 and b'OLFX CONNECT' in s and b'def sync_account(' in s and b'AUTOUPDATE_SECONDS' in s; compile(s,str(p),'exec')" >nul 2>&1
  if not errorlevel 1 (
    if exist "%OLFX_AGENT%" copy /y "%OLFX_AGENT%" "%OLFX_BACKUP%" >nul
    move /y "%OLFX_AGENT%.download" "%OLFX_AGENT%" >nul
    echo Version del agente validada.
  ) else (
    echo Aviso: GitHub envio una version no valida. Conservando la instalada.
  )
) else (
  echo Aviso: sin descarga de GitHub. Usando la version instalada.
)
if exist "%OLFX_AGENT%.download" del /q "%OLFX_AGENT%.download" >nul 2>&1
if not exist "%OLFX_AGENT%" (
  echo ERROR: No se encontro el agente. Ejecuta antes la opcion 1 del instalador OLFX.
  goto :STOP
)
py -3.12 -c "import MetaTrader5, httpx, cryptography" >nul 2>&1
if errorlevel 1 (
  echo ERROR: Faltan paquetes de Python. Ejecuta antes la opcion 1 del instalador OLFX.
  goto :STOP
)
echo.
echo OLFX CONNECT activo. NO CIERRES esta ventana.
echo.
:RUN
py -3.12 -u "%OLFX_AGENT%" watch
set "OLFX_EXIT=%ERRORLEVEL%"
if "%OLFX_EXIT%"=="75" (
  echo [AUTOUPDATE] Reiniciando con la nueva version de OLFX...
  set "OLFX_JUST_UPDATED=1"
  goto :RUN
)
if "%OLFX_JUST_UPDATED%"=="1" (
  if not "%OLFX_EXIT%"=="0" (
    if exist "%OLFX_BACKUP%" (
      echo [AUTOUPDATE] Error en la nueva version. Restaurando la version anterior...
      copy /y "%OLFX_BACKUP%" "%OLFX_AGENT%" >nul
      set "OLFX_DISABLE_AUTOUPDATE=1"
      set "OLFX_JUST_UPDATED=0"
      echo Actualizaciones pausadas para evitar un bucle; OLFX anterior sigue operativo.
      goto :RUN
    )
  )
)
echo.
echo OLFX CONNECT se detuvo. Codigo de salida: %OLFX_EXIT%.
echo Revisa el error anterior si no fue intencional.
:STOP
echo.
pause
