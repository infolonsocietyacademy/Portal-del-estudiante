$ErrorActionPreference = 'Stop'
$packageDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgeRoot = Join-Path $env:LOCALAPPDATA 'OLFX_MT5_BRIDGE'
$residentRoot = Join-Path $bridgeRoot 'resident-v2'
$appDir = Join-Path $residentRoot 'app\2.0.0-rc1'
$venvDir = Join-Path $residentRoot 'venv'
$pythonExe = Join-Path $venvDir 'Scripts\python.exe'
Write-Host 'OLFX MT5 BRIDGE - INSTALAR RECEPTOR RESIDENTE DEMO' -ForegroundColor Cyan
Write-Host 'Conserva la configuracion y se conecta al MT5 de pruebas existente.'
foreach ($name in @('settings.json','mailbox.json','token.dpapi')) {
  if (-not (Test-Path -LiteralPath (Join-Path $bridgeRoot $name))) {
    throw "Falta la instalacion anterior: $name. Ejecuta este instalador en la VPS y con el mismo usuario de Windows."
  }
}
$active = Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($residentRoot) -and $_.CommandLine.Contains('resident_worker.py') }
if ($active) { throw 'El receptor residente ya esta encendido. Para reinstalarlo, detenlo con DETENER_RESIDENTE.cmd y espera a que termine.' }
$manifest = Get-Content -LiteralPath (Join-Path $packageDir 'manifest.json') -Raw | ConvertFrom-Json
foreach ($entry in $manifest.files.PSObject.Properties) {
  $relative = $entry.Name
  if ($relative.Contains('..') -or [IO.Path]::IsPathRooted($relative)) { throw 'Ruta de paquete no valida.' }
  $file = Join-Path $packageDir $relative
  if (-not (Test-Path -LiteralPath $file)) { throw "Archivo ausente: $relative" }
  $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne $entry.Value) { throw "El archivo no coincide con el paquete: $relative. Descarga el ZIP nuevamente." }
}
New-Item -ItemType Directory -Path $residentRoot -Force | Out-Null
if (-not (Test-Path -LiteralPath $pythonExe)) {
  $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
  if ($launcher) {
    & $launcher.Source -3.12 -m venv $venvDir
    if ($LASTEXITCODE -ne 0) { throw 'Se necesita Python 3.12 de 64 bits. La instalacion anterior de OLFX suele tenerlo instalado.' }
  } else {
    $pythonCommand = Get-Command python.exe -ErrorAction Stop
    & $pythonCommand.Source -c 'import sys,struct; assert sys.version_info[:2] >= (3,10) and sys.version_info[:2] < (3,14) and struct.calcsize("P") == 8'
    if ($LASTEXITCODE -ne 0) { throw 'Se necesita Python 3.10-3.13 de 64 bits; se recomienda Python 3.12.' }
    & $pythonCommand.Source -m venv $venvDir
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el entorno del receptor.' }
  }
}
Write-Host 'Instalando dependencias en un entorno separado...'
& $pythonExe -m pip install --disable-pip-version-check --index-url https://pypi.org/simple --only-binary=:all: -r (Join-Path $packageDir 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar MetaTrader5 y NumPy. Verifica Internet y Python de 64 bits.' }
Write-Host 'Ejecutando pruebas sin conectar al broker...'
& $pythonExe -m unittest discover -s (Join-Path $packageDir 'tests') -v
if ($LASTEXITCODE -ne 0) { throw 'Las pruebas fallaron. No se inicia el receptor.' }
& $pythonExe -m compileall -q $packageDir
if ($LASTEXITCODE -ne 0) { throw 'La validacion de Python fallo. No se inicia el receptor.' }
New-Item -ItemType Directory -Path $appDir -Force | Out-Null
foreach ($name in @('resident_core.py','resident_worker.py')) {
  Copy-Item -LiteralPath (Join-Path $packageDir $name) -Destination (Join-Path $appDir $name) -Force
}
New-Item -ItemType Directory -Path (Join-Path $appDir 'legacy') -Force | Out-Null
Copy-Item -Path (Join-Path $packageDir 'legacy\*.py') -Destination (Join-Path $appDir 'legacy') -Force
foreach ($name in @('INICIAR_RESIDENTE.cmd','DIAGNOSTICAR_RESIDENTE.cmd','DETENER_RESIDENTE.cmd','CERRAR_OPERACIONES_RESIDENTE.cmd','VER_LOGS_RESIDENTE.cmd','LEEME_PRIMERO.txt')) {
  Copy-Item -LiteralPath (Join-Path $packageDir $name) -Destination (Join-Path $residentRoot $name) -Force
}
$desktopDir = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path $desktopDir 'OLFX Bridge Residente.lnk'))
$shortcut.TargetPath = Join-Path $residentRoot 'INICIAR_RESIDENTE.cmd'
$shortcut.WorkingDirectory = $residentRoot
$shortcut.Save()
Write-Host 'Comprobando la conexion DEMO; esta comprobacion no abre operaciones...'
& $pythonExe (Join-Path $appDir 'resident_worker.py') doctor
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Los archivos quedaron instalados. Revisa el mensaje del diagnostico.' -ForegroundColor Yellow
  Write-Host 'Si aparece PYTHON_TRADING_DISABLED: en el MT5 de pruebas entra en Tools > Options > Expert Advisors, activa el trading y desmarca Disable automated trading via external Python API.'
  Write-Host 'Despues ejecuta DIAGNOSTICAR_RESIDENTE.cmd y, si indica RESIDENT_READY, INICIAR_RESIDENTE.cmd.'
  throw 'Falta completar el diagnostico local; no se abrio ninguna operacion.'
}
Write-Host 'INSTALADO. Iniciando receptor residente...' -ForegroundColor Green
Start-Process -FilePath (Join-Path $residentRoot 'INICIAR_RESIDENTE.cmd') -WorkingDirectory $residentRoot
Write-Host 'Deja abierta la nueva ventana. Dispositivo esperado: worker-01-resident.'
Write-Host 'Ya puedes indicar en el chat: Receptor residente encendido; verifica la conexion.'
