# Tempo Auto Logger - per-user install policy
#
# Run this ONCE on each teammate's machine. It writes a per-user (HKCU)
# Chrome policy that tells Chrome to force-install the Tempo Auto Logger
# extension from our self-hosted updates.xml on GitHub Pages.
#
# After running:
#   1. Fully quit Chrome (check Task Manager - all chrome.exe gone).
#   2. Reopen Chrome.
#   3. Within ~30 seconds the extension auto-installs.
#
# No admin rights required. To uninstall, run uninstall.ps1 or delete
# the registry value manually under
#   HKCU\Software\Policies\Google\Chrome\ExtensionInstallForcelist

$ErrorActionPreference = 'Stop'

$ExtensionId  = 'lllmnccgpmaohmachieeindoelkaaood'
$UpdatesUrl   = 'https://kristapsk123.github.io/tempo-auto-logger/updates.xml'
$PolicyEntry  = "$ExtensionId;$UpdatesUrl"
$RegPath      = 'HKCU:\Software\Policies\Google\Chrome\ExtensionInstallForcelist'

if (-not (Test-Path $RegPath)) {
    New-Item -Path $RegPath -Force | Out-Null
}

# Find the next free numeric slot (1, 2, 3, ...). Chrome reads numeric
# value names under ExtensionInstallForcelist as separate force-install
# entries; we want to add ours without clobbering any existing one.
$existing = (Get-Item $RegPath).Property
$ourValueName = $null
foreach ($name in $existing) {
    $val = (Get-ItemProperty -Path $RegPath -Name $name).$name
    if ($val -eq $PolicyEntry) {
        $ourValueName = $name
        break
    }
}

if ($null -ne $ourValueName) {
    Write-Host "Already installed (slot $ourValueName)." -ForegroundColor Green
} else {
    $slot = 1
    while ($existing -contains "$slot") { $slot++ }
    New-ItemProperty -Path $RegPath -Name "$slot" -Value $PolicyEntry -PropertyType String -Force | Out-Null
    Write-Host "Installed Tempo Auto Logger policy (slot $slot)." -ForegroundColor Green
}

Write-Host ''
Write-Host 'Next steps:' -ForegroundColor Yellow
Write-Host '  1. Fully quit Chrome (Task Manager > End all chrome.exe).'
Write-Host '  2. Reopen Chrome.'
Write-Host '  3. Wait ~30 seconds. The extension icon should appear.'
Write-Host ''
Write-Host 'If it does not appear, open chrome://policy in Chrome and click'
Write-Host '"Reload policies" - you should see ExtensionInstallForcelist listed.'
