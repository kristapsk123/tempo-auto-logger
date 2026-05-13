# Tempo Auto Logger - uninstall policy
# Removes the Chrome policy that auto-installs the extension from both
# HKCU and HKLM. HKLM removal needs admin and self-elevates.

$ErrorActionPreference = 'Stop'

$ExtensionId  = 'lllmnccgpmaohmachieeindoelkaaood'
$UpdatesUrl   = 'https://kristapsk123.github.io/tempo-auto-logger/updates.xml'
$PolicyEntry  = "$ExtensionId;$UpdatesUrl"

function Test-IsAdmin {
    $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $p  = New-Object System.Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Remove-ForcelistEntry {
    param([string] $RegPath, [string] $Entry)

    if (-not (Test-Path $RegPath)) { return $false }
    $removed = $false
    foreach ($name in (Get-Item $RegPath).Property) {
        $val = (Get-ItemProperty -Path $RegPath -Name $name).$name
        if ($val -eq $Entry) {
            Remove-ItemProperty -Path $RegPath -Name $name
            Write-Host "Removed policy at $RegPath (slot $name)." -ForegroundColor Green
            $removed = $true
        }
    }
    return $removed
}

$hkcuPath = 'HKCU:\Software\Policies\Google\Chrome\ExtensionInstallForcelist'
$hklmPath = 'HKLM:\Software\Policies\Google\Chrome\ExtensionInstallForcelist'

$any = $false
try {
    if (Remove-ForcelistEntry -RegPath $hkcuPath -Entry $PolicyEntry) { $any = $true }
} catch {
    Write-Host ('HKCU removal failed: ' + $_.Exception.Message) -ForegroundColor Yellow
}

if (Test-Path $hklmPath) {
    if (-not (Test-IsAdmin)) {
        Write-Host 'Relaunching elevated to remove HKLM policy...' -ForegroundColor Yellow
        Start-Process powershell -Verb RunAs -ArgumentList @(
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', $PSCommandPath
        ) -Wait
        Read-Host 'Press Enter to close this window'
        exit 0
    }
    try {
        if (Remove-ForcelistEntry -RegPath $hklmPath -Entry $PolicyEntry) { $any = $true }
    } catch {
        Write-Host ('HKLM removal failed: ' + $_.Exception.Message) -ForegroundColor Yellow
    }
}

if (-not $any) {
    Write-Host 'Tempo Auto Logger policy not found.' -ForegroundColor Yellow
}

Write-Host 'Restart Chrome to apply.'
Write-Host ''
Read-Host 'Press Enter to close this window'
