# Owner-approved recovery of OLFX MT5 Bridge. No account passwords or private keys are requested.
param(
    [Parameter(Mandatory=$true)]
    [ValidatePattern('^[0-9a-f]{40}$')]
    [string]$SourceRef
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Join-Path $env:LOCALAPPDATA 'OLFX_MT5_BRIDGE'
$recovery = Join-Path $root 'owner-recovery-v1'
if (!(Test-Path -LiteralPath (Join-Path $root 'settings.json'))) { throw 'No se encontro el bridge instalado para este usuario de Windows.' }
$tokenFile = Join-Path $root 'token.dpapi'
if (!(Test-Path -LiteralPath $tokenFile)) { throw 'Falta el token protegido del bridge existente.' }
New-Item -ItemType Directory -Force -Path $recovery | Out-Null
Add-Type -AssemblyName System.Security
$clearBytes = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($tokenFile), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
$token = [Text.Encoding]::UTF8.GetString($clearBytes)
$headers = @{ Authorization = ('Bearer ' + $token); Accept = 'application/vnd.github+json'; 'User-Agent' = 'OLFX-Owner-Recovery/1'; 'X-GitHub-Api-Version' = '2022-11-28' }
$base = 'https://api.github.com/repos/infolonsocietyacademy/Portal-del-estudiante/contents/bridge/breakfake_m1/recovery/'
$items = @(
    @{ Name = 'install_owner.py'; Sha256 = '4bc56efd10716e15a49e89f06210e02ae66128d86092c1f4c132690b8bc77151' },
    @{ Name = 'bridge_bootstrap.py'; Sha256 = '5ce19d70698bc35bcc89dc58f400a8742419c1aa92ee4c34acb4f780540bd526' }
)
try {
    foreach ($item in $items) {
        $url = $base + $item.Name + '?ref=' + $SourceRef
        $doc = Invoke-RestMethod -Uri $url -Headers $headers -Method Get
        if ($doc.encoding -ne 'base64') { throw 'Formato de descarga inesperado.' }
        $raw = [Convert]::FromBase64String($doc.content)
        $hasher = [Security.Cryptography.SHA256]::Create()
        try { $digest = ([BitConverter]::ToString($hasher.ComputeHash($raw))).Replace('-', '').ToLowerInvariant() }
        finally { $hasher.Dispose() }
        if ($digest -ne $item.Sha256) { throw ('Hash incorrecto: ' + $item.Name) }
        [IO.File]::WriteAllBytes((Join-Path $recovery $item.Name), $raw)
    }
} finally {
    [Array]::Clear($clearBytes, 0, $clearBytes.Length)
    $token = $null
    $headers = $null
}
$owner = Join-Path $recovery 'install_owner.py'
$python = Join-Path $root 'resident-v2\venv\Scripts\python.exe'
if (Test-Path -LiteralPath $python) {
    & $python -c 'import MetaTrader5' 2>$null
    if ($LASTEXITCODE -ne 0) { $python = $null }
} else { $python = $null }
if ($python) {
    & $python $owner --ref $SourceRef
} else {
    $py = Get-Command py.exe -ErrorAction SilentlyContinue
    if (!$py) { throw 'No se encontro Python 3.12 ni el entorno existente del bridge.' }
    & $py.Source -3.12 -c 'import MetaTrader5' 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'El Python existente no tiene MetaTrader5. No se cambio la cuenta ni el runtime activo.' }
    & $py.Source -3.12 $owner --ref $SourceRef
}
if ($LASTEXITCODE -ne 0) { throw ('La recuperacion termino con codigo ' + $LASTEXITCODE + '. Conserva el mensaje mostrado para revisarlo.') }
