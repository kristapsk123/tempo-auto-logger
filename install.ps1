# Tempo Auto Logger - install policy
#
# Run this ONCE on each teammate's machine. It writes a Chrome
# ExtensionInstallForcelist policy that tells Chrome to force-install the
# Tempo Auto Logger extension from our self-hosted updates.xml on GitHub
# Pages.
#
# This script first tries HKCU (per-user, no admin). At Visma the HKCU
# Chrome policy path is corporate-locked, so it falls back to HKLM
# (machine-wide, requires admin) and auto-elevates via UAC.
#
# After running:
#   1. Fully quit Chrome (check Task Manager - all chrome.exe gone).
#   2. Reopen Chrome.
#   3. Within ~30 seconds the extension auto-installs.
#
# To uninstall, run uninstall.ps1 with the same elevation.

$ErrorActionPreference = 'Stop'

$ExtensionId  = 'lllmnccgpmaohmachieeindoelkaaood'
$UpdatesUrl   = 'https://kristapsk123.github.io/tempo-auto-logger/updates.xml'
$PolicyEntry  = "$ExtensionId;$UpdatesUrl"

function Test-IsAdmin {
    $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $p  = New-Object System.Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Write-ForcelistEntry {
    param([string] $RegPath, [string] $Entry)

    if (-not (Test-Path $RegPath)) {
        New-Item -Path $RegPath -Force | Out-Null
    }

    # Find existing or pick next free numeric slot. Chrome reads each
    # numeric value name as a separate force-install entry.
    $existing = (Get-Item $RegPath).Property
    foreach ($name in $existing) {
        $val = (Get-ItemProperty -Path $RegPath -Name $name).$name
        if ($val -eq $Entry) {
            Write-Host "Already installed at $RegPath (slot $name)." -ForegroundColor Green
            return
        }
    }

    $slot = 1
    while ($existing -contains "$slot") { $slot++ }
    New-ItemProperty -Path $RegPath -Name "$slot" -Value $Entry -PropertyType String -Force | Out-Null
    Write-Host "Installed Tempo Auto Logger policy at $RegPath (slot $slot)." -ForegroundColor Green
}

$hkcuPath = 'HKCU:\Software\Policies\Google\Chrome\ExtensionInstallForcelist'
$hklmPath = 'HKLM:\Software\Policies\Google\Chrome\ExtensionInstallForcelist'

# When running elevated, write to HKLM (machine-wide). Writing to HKCU
# in an elevated session would target the Administrator user's hive, not
# the logged-in user's Chrome session, so Chrome would never see the
# policy. HKLM is read by Chrome regardless of which user runs it.
if (Test-IsAdmin) {
    try {
        Write-ForcelistEntry -RegPath $hklmPath -Entry $PolicyEntry
    } catch {
        Write-Host ('HKLM write failed: ' + $_.Exception.Message) -ForegroundColor Red
        Write-Host 'Ask Visma IT to push this ExtensionInstallForcelist entry'
        Write-Host ('via group policy: ' + $PolicyEntry)
        Read-Host 'Press Enter to close this window'
        exit 1
    }
} else {
    # Non-elevated: try HKCU first (no admin needed). At Visma the HKCU
    # Chrome policy path is corporate-locked, so this typically fails -
    # we then auto-elevate and re-run as admin to write HKLM.
    $hkcuOk = $false
    try {
        Write-ForcelistEntry -RegPath $hkcuPath -Entry $PolicyEntry
        $hkcuOk = $true
    } catch [System.UnauthorizedAccessException] {
        Write-Host 'HKCU Chrome policy path is locked by corporate group policy.' -ForegroundColor Yellow
        Write-Host 'Need admin to write the machine-wide HKLM policy instead.' -ForegroundColor Yellow
    } catch {
        Write-Host ('HKCU write failed: ' + $_.Exception.Message) -ForegroundColor Yellow
        Write-Host 'Falling back to HKLM (machine-wide, needs admin).' -ForegroundColor Yellow
    }

    if (-not $hkcuOk) {
        Write-Host 'Relaunching elevated to write HKLM policy...' -ForegroundColor Yellow
        try {
            Start-Process powershell -Verb RunAs -ArgumentList @(
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-File', $PSCommandPath
            ) -Wait
            Write-Host 'Elevated install finished.' -ForegroundColor Green
        } catch {
            Write-Host 'Elevation cancelled or failed.' -ForegroundColor Red
            Write-Host 'You need local admin on this machine to install. If you do not'
            Write-Host 'have admin rights, ask Visma IT to push the ExtensionInstallForcelist'
            Write-Host ('entry via group policy: ' + $PolicyEntry)
            Read-Host 'Press Enter to close this window'
            exit 1
        }
        Read-Host 'Press Enter to close this window'
        exit 0
    }
}

Write-Host ''
Write-Host 'Next steps:' -ForegroundColor Yellow
Write-Host '  1. Fully quit Chrome (Task Manager > End all chrome.exe).'
Write-Host '  2. Reopen Chrome.'
Write-Host '  3. Wait ~30 seconds. The extension icon should appear.'
Write-Host ''
Write-Host 'If it does not appear, open chrome://policy in Chrome and click'
Write-Host '"Reload policies" - you should see ExtensionInstallForcelist listed.'
Write-Host ''
Read-Host 'Press Enter to close this window'
