# CIS File Handler - Protocol Handler Installer
# Run with: .\install.ps1 (PowerShell as Administrator for system-wide installation)
# Or without Admin for current user only

param(
    [switch]$SystemWide,
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

# Protocol name
$ProtocolName = "cis-open"
$ProtocolDescription = "URL:CIS File Search Protocol"

# Get the directory where this script is located
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$HandlerPath = Join-Path $ScriptDir "cis-open-handler.bat"

# Check if handler exists
if (-not (Test-Path $HandlerPath)) {
    Write-Error "Handler not found: $HandlerPath"
    Write-Host "Please ensure cis-open-handler.bat is in the same directory as this script."
    exit 1
}

# Determine registry root (HKLM for system-wide, HKCU for current user)
if ($SystemWide) {
    $RegRoot = "HKLM:\Software\Classes"
    Write-Host "Installing system-wide (requires Administrator privileges)..."
} else {
    $RegRoot = "HKCU:\Software\Classes"
    Write-Host "Installing for current user..."
}

$RegPath = "$RegRoot\$ProtocolName"

try {
    # Create the protocol key
    Write-Host "Creating registry key: $RegPath"

    if (-not (Test-Path $RegPath)) {
        New-Item -Path $RegPath -Force | Out-Null
    }

    # Set default value and URL Protocol marker
    Set-ItemProperty -Path $RegPath -Name "(Default)" -Value $ProtocolDescription
    Set-ItemProperty -Path $RegPath -Name "URL Protocol" -Value ""

    # Create DefaultIcon key (optional, for icon display)
    $IconPath = "$RegPath\DefaultIcon"
    if (-not (Test-Path $IconPath)) {
        New-Item -Path $IconPath -Force | Out-Null
    }
    Set-ItemProperty -Path $IconPath -Name "(Default)" -Value "%SystemRoot%\System32\shell32.dll,4"

    # Create shell\open\command key
    $ShellPath = "$RegPath\shell"
    if (-not (Test-Path $ShellPath)) {
        New-Item -Path $ShellPath -Force | Out-Null
    }

    $OpenPath = "$ShellPath\open"
    if (-not (Test-Path $OpenPath)) {
        New-Item -Path $OpenPath -Force | Out-Null
    }

    $CommandPath = "$OpenPath\command"
    if (-not (Test-Path $CommandPath)) {
        New-Item -Path $CommandPath -Force | Out-Null
    }

    # Set the command to execute
    # The %1 will be replaced with the full URL (cis-open://...)
    $CommandValue = "`"$HandlerPath`" `"%1`""
    Set-ItemProperty -Path $CommandPath -Name "(Default)" -Value $CommandValue

    Write-Host ""
    Write-Host "Installation completed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Protocol Handler Details:"
    Write-Host "  Protocol: $ProtocolName://"
    Write-Host "  Handler: $HandlerPath"
    Write-Host "  Registry: $RegPath"
    Write-Host ""
    Write-Host "You can now open NAS files directly from the CIS File Search application."
    Write-Host ""
    Write-Host "To test, try opening this URL in your browser:"
    Write-Host "  cis-open://\\ts-server3\test"
    Write-Host ""

} catch {
    Write-Error "Failed to install protocol handler: $_"
    exit 1
}
