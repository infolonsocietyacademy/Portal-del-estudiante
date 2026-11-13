@echo off
setlocal EnableExtensions
title OLFX CONNECT - SINCRONIZACION RAPIDA
set "OLFX_HOME=%LOCALAPPDATA%\OLFXConnect"
set "RAW_URL=https://raw.githubusercontent.com/infolonsocietyacademy/Portal-del-estudiante/main/olfx-connector"
echo =====================================================
echo   OLFX CONNECT - SINCRONIZACION RAPIDA DE MT5
echo =====================================================
echo.
echo Este iniciador recupera el agente actualizado desde tu GitHub.
echo Tu token privado, clave RSA y ajustes NO se borran ni se envian a GitHub.
echo.
py -3.12 --version
if errorlevel 1 (
 echo ERROR: Necesitas Python 3.12 x64.
 goto :finish
)
if not exist "%OLFX_HOME%\settings.json" (
 echo ERROR: Falta la configuracion de Windows en:
 echo %OLFX_HOME%\settings.json
 echo Primero ejecuta el paso de configuracion del token.
 goto :finish
)
if not exist "%OLFX_HOME%\private_key.pem" (
 echo ERROR: Falta la clave privada en la carpeta OLFXConnect.
 echo No generes otra clave sin revisar el emparejamiento anterior.
 goto :finish
)
if not exist "%OLFX_HOME%" mkdir "%OLFX_HOME%"
echo [1/3] Descargando agente actualizado de tu repositorio GitHub...
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest -Uri '%RAW_URL%/olfx_agent.py' -OutFile '%OLFX_HOME%\olfx_agent.py' -UseBasicParsing; Invoke-WebRequest -Uri '%RAW_URL%/requirements.txt' -OutFile '%OLFX_HOME%\requirements.txt' -UseBasicParsing"
if errorlevel 1 (
 echo ERROR al descargar archivos. Comprueba Internet.
 goto :finish
)
findstr /c:"POLL_SECONDS = 15" "%OLFX_HOME%\olfx_agent.py" >nul
if errorlevel 1 (
 echo ERROR: El agente descargado no es la version de sincronizacion rapida.
 goto :finish
)
echo [2/3] Comprobando modulos de Python...
py -3.12 -c "import MetaTrader5, cryptography, httpx" >nul 2>&1
if errorlevel 1 (
 py -3.12 -m pip install -r "%OLFX_HOME%\requirements.txt"
 if errorlevel 1 (
  echo ERROR: No se pudieron instalar los modulos.
  goto :finish
 )
)
echo [3/3] Iniciando conexion automatica...
echo.
echo Lee cuentas nuevas cada 15 segundos.
echo Actualiza cuentas ya sincronizadas cada 24 horas.
echo Tu Windows tiene que permanecer encendido y conectado a Internet.
echo Deja esta ventana abierta. CTRL+C para detener.
echo.
py -3.12 -u "%OLFX_HOME%\olfx_agent.py" watch
echo.
echo El lector se ha detenido; revisa errores anteriores.
:finish
echo.
pause
