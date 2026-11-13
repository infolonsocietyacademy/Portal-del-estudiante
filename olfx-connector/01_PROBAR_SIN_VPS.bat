@echo off
setlocal
cd /d "%~dp0"
echo ============================================
echo OLFX CONNECT - PRUEBA LOCAL MT5 SIN VPS
echo ============================================
echo Asegurate de tener MT5 abierto y conectado.
py -3.12 --version
if errorlevel 1 (
 echo ERROR: Instala Python 3.12 de 64 bits desde python.org
 goto :end
)
py -3.12 -m pip install -r requirements.txt
if errorlevel 1 (
 echo ERROR: No se pudieron instalar los componentes.
 goto :end
)
py -3.12 olfx_agent.py doctor
:end
echo.
pause
