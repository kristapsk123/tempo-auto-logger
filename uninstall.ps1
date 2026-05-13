# Tempo Auto Logger - per-user uninstall
# Removes the HKCU Chrome policy that auto-installs the extension.
# After running this, restart Chrome - the extension will disappear.

$ErrorActionPreference = 'Stop'

$ExtensionId  = 'lllmnccgpmaohmachieeindoelkaaood'
$UpdatesUrl   = 'https://kristapsk123.github.io/tempo-auto-logger/updates.xml'
$PolicyEntry  = "$ExtensionId;$UpdatesUrl"
$RegPath      = 'HKCU:\Software\Policies\Google\Chrome\ExtensionInstallForcelist'

if (-not (Test-Path $RegPath)) {
    Write-Host 'No policy installed.' -ForegroundColor Yellow
    return
}

$removed = $false
foreach ($name in (Get-Item $RegPath).Property) {
    $val = (Get-ItemProperty -Path $RegPath -Name $name).$name
    if ($val -eq $PolicyEntry) {
        Remove-ItemProperty -Path $RegPath -Name $name
        Write-Host "Removed Tempo Auto Logger policy (slot $name)." -ForegroundColor Green
        $removed = $true
    }
}

if (-not $removed) {
    Write-Host 'Tempo Auto Logger policy not found.' -ForegroundColor Yellow
}

Write-Host 'Restart Chrome to apply.'
