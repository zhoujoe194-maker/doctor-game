# Destructive only to this fresh CI runner's test installation and synthetic data.
# Never run against a player's existing profile or installation.
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') {
    throw 'This lifecycle test runs only on a disposable Windows GitHub Actions runner.'
}
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$install = Join-Path $env:LOCALAPPDATA 'Programs\doctorgame-beta-ci'
$data = Join-Path $env:APPDATA 'doctorgame'
if ((Test-Path $install) -or (Test-Path $data)) { throw 'Refusing to touch an existing installation or profile.' }
$exe = Join-Path $install 'doctorgame.exe'
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'doctorgame.lnk'
$result = [ordered]@{ platform = 'Windows x64 GitHub hosted runner'; version = $version; checks = @(); hardwareCaptureTested = $false }
New-Item -ItemType Directory -Force artifacts | Out-Null
function Save-Result { $result | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 artifacts/windows-install-result.json }
function Check($name, $condition) {
    if (-not $condition) { throw "Check failed: $name" }
    $result.checks += $name
    Save-Result
    Write-Host "PASS: $name"
}
function Stop-TestApp {
    Get-Process doctorgame -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Stop-Process -Force
}
function Install-Test($installer) {
    $process = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$install") -Wait -PassThru
    Check 'NSIS installer exit code 0' ($process.ExitCode -eq 0)
    Stop-TestApp
    Check 'Installed standalone executable exists' (Test-Path $exe)
}
try {
    $setup = (Get-ChildItem "release/$version/installer/*setup.exe").FullName
    if (@($setup).Count -ne 1) { throw 'Expected exactly one installer.' }
    $hash = (Get-FileHash $setup -Algorithm SHA256).Hash.ToLower()
    $result.installerSHA256 = $hash
    $result.signatureStatus = (Get-AuthenticodeSignature $setup).Status.ToString()
    Check 'Installer checksum matches its sidecar' ((Get-Content "$setup.sha256").StartsWith($hash))
    Install-Test $setup
    Check 'Start Menu shortcut created' (Test-Path $shortcut)
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
    Check 'Start Menu shortcut targets installed executable' ($link.TargetPath -eq $exe)
    # Launch through the actual shortcut with development tools removed from PATH.
    $savedPath = $env:PATH
    try {
        $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
        Start-Process -FilePath $shortcut
        $running = $null
        for ($i = 0; $i -lt 30; $i++) {
            $running = Get-Process doctorgame -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe -and $_.MainWindowHandle -ne 0 }
            if ($running) { break }
            Start-Sleep -Seconds 1
        }
        Check 'Start Menu launches a window without external Node or pnpm' ([bool]$running)
    } finally { $env:PATH = $savedPath; Stop-TestApp }
    $env:DOCTORGAME_EXECUTABLE = $exe
    $env:DOCTORGAME_TEST_USER_DATA = $data
    $env:DOCTORGAME_TEST_LABEL = 'windows-installed'
    $env:DOCTORGAME_EXPECTED_VERSION = $version
    node tests/electron-smoke.mjs
    Check 'Installed app imports, decodes, seeks, reviews and retains data after restart' ($LASTEXITCODE -eq 0)
    $expectedFile = Join-Path $root 'artifacts/electron/windows-installed/expected-state.json'
    $expected = Get-Content $expectedFile -Raw | ConvertFrom-Json
    $recording = Join-Path $data "recordings/$($expected.state.id).webm"
    $index = Join-Path $data "recordings/$($expected.state.id).json"
    $indexHash = (Get-FileHash $index -Algorithm SHA256).Hash
    # Same code, newer test-only version. Only beta.1 is distributed as an artifact.
    $upgradeVersion = '0.2.0-beta.2'
    node scripts/installer.mjs "--version=$upgradeVersion"
    Check 'Test-only upgrade installer built' ($LASTEXITCODE -eq 0)
    Install-Test (Get-ChildItem "release/$upgradeVersion/installer/*setup.exe").FullName
    $env:DOCTORGAME_TEST_LABEL = 'windows-upgraded'
    $env:DOCTORGAME_TEST_REOPEN_ONLY = '1'
    $env:DOCTORGAME_EXPECTED_STATE = $expectedFile
    $env:DOCTORGAME_EXPECTED_VERSION = $upgradeVersion
    node tests/electron-smoke.mjs
    Check 'Upgrade retains exact profile, report, recording and per-match settings' ($LASTEXITCODE -eq 0)
    $uninstall = Join-Path $install 'Uninstall doctorgame.exe'
    Check 'Uninstaller exists' (Test-Path $uninstall)
    $process = Start-Process -FilePath $uninstall -ArgumentList '/S' -Wait -PassThru
    Check 'Uninstaller exit code 0' ($process.ExitCode -eq 0)
    for ($i = 0; $i -lt 30 -and (Test-Path $exe); $i++) { Start-Sleep -Seconds 1 }
    Check 'Uninstall removes executable and Start Menu shortcut' (-not (Test-Path $exe) -and -not (Test-Path $shortcut))
    Check 'Uninstall retains recording bytes' ((Get-FileHash $recording -Algorithm SHA256).Hash.ToLower() -eq $expected.recordingSHA256)
    Check 'Uninstall retains recording metadata' ((Get-FileHash $index -Algorithm SHA256).Hash -eq $indexHash)
    Check 'Uninstall retains profile/report storage' (Test-Path (Join-Path $data 'Local Storage/leveldb'))
    $result.passed = $true
    Save-Result
    "Installer SHA-256: ``$hash``" | Add-Content $env:GITHUB_STEP_SUMMARY
    'Installed application, shortcut, UI import/review, restart, upgrade and uninstall checks passed. Game capture and Vanguard require gaming hardware.' | Add-Content $env:GITHUB_STEP_SUMMARY
} catch {
    $result.passed = $false
    $result.failure = $_.Exception.Message
    Save-Result
    throw
} finally { Stop-TestApp }
