@echo off
powershell.exe -NoProfile -Command "$p=Join-Path $env:LOCALAPPDATA 'OLFX_MT5_BRIDGE\resident-v2\operaciones.jsonl'; if(Test-Path -LiteralPath $p){Get-Content -LiteralPath $p -Tail 30 -Wait}else{Write-Host 'Todavia no hay operaciones registradas.'; Read-Host 'Enter para salir'}"
