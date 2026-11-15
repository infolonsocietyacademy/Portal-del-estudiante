"""Build the self-contained Windows launcher. No private settings are bundled."""
import argparse
import base64
import hashlib
from pathlib import Path
import textwrap

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "diagnostico-vps" / "portal_monitor.py"
OUTPUT = ROOT / "OLFX_DIAGNOSTICO_VPS.cmd"
MARKER = "::OLFX_DIAG_PAYLOAD"


def build(source):
    digest = hashlib.sha256(source).hexdigest()
    template = r'''@echo off
setlocal EnableExtensions DisableDelayedExpansion
title OLFX - DIAGNOSTICO LIVE VPS
if not defined OLFX_DIAG_ROOT set "OLFX_DIAG_ROOT=%LOCALAPPDATA%\OLFXConnect\diagnostico"
set "OLFX_DIAG_SELF=%~f0"
set "OLFX_DIAG_EXIT=1"
set "OLFX_DIAG_HASH=@@DIGEST@@"
set "PLAYWRIGHT_BROWSERS_PATH=%OLFX_DIAG_ROOT%\browsers"
echo ===========================================================
echo   OLFX - MONITOR LIVE DEL PORTAL Y CONECTOR VPS
echo ===========================================================
echo.
echo Abre el portal en un navegador supervisado. Inicia sesion alli.
echo Registra errores JS, HTTP, sesion y estados de las cuentas.
echo Logs locales: %OLFX_DIAG_ROOT%\logs
echo No cambia registros, claves, tokens ni ajustes del conector.
echo.
echo Para capturar tambien la consola del conector, cierra antes
echo su CMD anterior. Si sigue activo, no se inicia otra copia.
echo El monitor usa el agente instalado, sin actualizar su codigo.
echo Si inicia el conector, manten esta ventana abierta para usarlo.
echo.
py -3.12 --version >nul 2>&1
if errorlevel 1 (
  echo ERROR: Necesitas Python 3.12 x64, como el conector MT5.
  goto :finish
)
if not exist "%OLFX_DIAG_ROOT%" mkdir "%OLFX_DIAG_ROOT%"
py -3.12 -c "import os,pathlib,base64,hashlib; p=pathlib.Path(os.environ['OLFX_DIAG_SELF']); a=p.read_bytes().splitlines(); i=a.index(b'::OLFX_DIAG_PAYLOAD'); s=base64.b64decode(b''.join(a[i+1:]),validate=True); assert hashlib.sha256(s).hexdigest()==os.environ['OLFX_DIAG_HASH'],'Integridad incorrecta: descarga el CMD otra vez'; compile(s,'portal_monitor.py','exec'); (pathlib.Path(os.environ['OLFX_DIAG_ROOT'])/'portal_monitor.py').write_bytes(s)"
if errorlevel 1 (
  echo ERROR: El CMD esta incompleto o no se pudo extraer el monitor.
  goto :finish
)
if not exist "%OLFX_DIAG_ROOT%\.venv\Scripts\python.exe" (
  py -3.12 -m venv "%OLFX_DIAG_ROOT%\.venv"
  if errorlevel 1 goto :install_error
)
echo Comprobando herramienta de navegador, version fija 1.65.2...
"%OLFX_DIAG_ROOT%\.venv\Scripts\python.exe" -c "import importlib.metadata; assert importlib.metadata.version('playwright')=='1.65.2'" >nul 2>&1
if errorlevel 1 (
  "%OLFX_DIAG_ROOT%\.venv\Scripts\python.exe" -m pip install --disable-pip-version-check playwright==1.65.2
  if errorlevel 1 goto :install_error
)
echo.
echo LIVE activo. Usa el portal abierto. CTRL+C para detener.
echo El archivo JSONL contiene datos tecnicos y montos visibles de
echo esa sesion. Guardalo de forma privada. No incluye credenciales.
echo.
"%OLFX_DIAG_ROOT%\.venv\Scripts\python.exe" -u "%OLFX_DIAG_ROOT%\portal_monitor.py" %*
set "OLFX_DIAG_EXIT=%ERRORLEVEL%"
goto :finish
:install_error
echo ERROR: No se pudo preparar el navegador. Comprueba Internet.
:finish
echo.
echo Logs: %OLFX_DIAG_ROOT%\logs\portal-live.jsonl
echo Este monitor solo observa su navegador y la VPS local.
if not "%OLFX_DIAG_UNATTENDED%"=="1" pause
exit /b %OLFX_DIAG_EXIT%
::OLFX_DIAG_PAYLOAD
@@PAYLOAD@@
'''
    result = template.replace("@@DIGEST@@", digest).replace("@@PAYLOAD@@", "\n".join(textwrap.wrap(base64.b64encode(source).decode("ascii"), 76)))
    return result.replace("\n", "\r\n").encode("ascii")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = build(SOURCE.read_bytes())
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_bytes() != expected:
            raise SystemExit("Regenerate OLFX_DIAGNOSTICO_VPS.cmd with scripts/build-vps-diagnostics.py")
        print("CMD bundle verified")
    else:
        OUTPUT.write_bytes(expected)
        print(OUTPUT.name, "built:", len(expected), "bytes")
