# CIS File Handler - Protocol Handler Uninstaller
# Run with: .\uninstall.ps1 (or as Administrator for system-wide uninstall)

param(
    [switch]$SystemWide
)

$ErrorActionPreference = "Stop"

# Protocol name
$ProtocolName = "cis-open"

# Determine registry root
if ($SystemWide) {
    $RegRoot = "HKLM:\Software\Classes"
    Write-Host "Uninstalling system-wide (requires Administrator privileges)..."
} else {
    $RegRoot = "HKCU:\Software\Classes"
    Write-Host "Uninstalling for current user..."
}

$RegPath = "$RegRoot\$ProtocolName"

try {
    if (Test-Path $RegPath) {
        Write-Host "Removing registry key: $RegPath"
        Remove-Item -Path $RegPath -Recurse -Force

        Write-Host ""
        Write-Host "Uninstallation completed successfully!" -ForegroundColor Green
        Write-Host ""
        Write-Host "The cis-open:// protocol handler has been removed."
        Write-Host ""
    } else {
        Write-Host "Protocol handler not found at: $RegPath" -ForegroundColor Yellow
        Write-Host "Nothing to uninstall."
    }

} catch {
    Write-Error "Failed to uninstall protocol handler: $_"
    exit 1
}
