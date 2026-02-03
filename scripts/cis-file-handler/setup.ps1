# ========================================================================
# CIS File Handler - Self-Contained Setup Script
# Version: 2.0
#
# This script:
#   1. Copies the handler files to a local directory
#   2. Registers the cis-open:// protocol handler
#   3. Works without administrator privileges
#
# Usage:
#   .\setup.ps1              # Install
#   .\setup.ps1 -Uninstall   # Uninstall
# ========================================================================

param(
    [switch]$Uninstall,
    [switch]$Silent
)

$ErrorActionPreference = "Stop"

# ========================================================================
# Configuration
# ========================================================================

$ProtocolName = "cis-open"
$ProtocolDescription = "URL:CIS File Search Protocol"
$AppName = "CIS File Handler"
$Version = "2.0"

# Installation directory (in user's local app data)
$InstallDir = "$env:LOCALAPPDATA\CIS\FileHandler"

# Get the directory where this script is located
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$HandlerBatSource = Join-Path $ScriptDir "cis-open-handler.bat"
$HandlerPs1Source = Join-Path $ScriptDir "cis-open-handler.ps1"

# Registry path
$RegPath = "HKCU:\Software\Classes\$ProtocolName"

# ========================================================================
# Helper Functions
# ========================================================================

function Write-Log {
    param([string]$Message, [string]$Type = "Info")

    if (-not $Silent) {
        switch ($Type) {
            "Success" { Write-Host $Message -ForegroundColor Green }
            "Warning" { Write-Host $Message -ForegroundColor Yellow }
            "Error"   { Write-Host $Message -ForegroundColor Red }
            default   { Write-Host $Message }
        }
    }
}

function Show-Banner {
    if (-not $Silent) {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  $AppName v$Version" -ForegroundColor Cyan
        Write-Host "  NAS File Direct Open Handler" -ForegroundColor Cyan
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host ""
    }
}

# ========================================================================
# Uninstall Function
# ========================================================================

function Uninstall-Handler {
    Show-Banner
    Write-Log "Starting uninstallation..."

    # Remove registry entry
    if (Test-Path $RegPath) {
        Write-Log "Removing registry entry: $RegPath"
        Remove-Item -Path $RegPath -Recurse -Force
        Write-Log "Registry entry removed." "Success"
    } else {
        Write-Log "Registry entry not found (already uninstalled)" "Warning"
    }

    # Remove installation directory
    if (Test-Path $InstallDir) {
        Write-Log "Removing installation directory: $InstallDir"
        Remove-Item -Path $InstallDir -Recurse -Force
        Write-Log "Installation directory removed." "Success"
    } else {
        Write-Log "Installation directory not found" "Warning"
    }

    # Try to remove parent CIS directory if empty
    $CISDir = Split-Path -Parent $InstallDir
    if ((Test-Path $CISDir) -and ((Get-ChildItem $CISDir | Measure-Object).Count -eq 0)) {
        Remove-Item -Path $CISDir -Force
    }

    Write-Log ""
    Write-Log "Uninstallation completed!" "Success"
    Write-Log ""
    Write-Log "The cis-open:// protocol handler has been removed."
    Write-Log "You can still use 'Copy Path' feature in CIS File Search."

    return 0
}

# ========================================================================
# Install Function
# ========================================================================

function Install-Handler {
    Show-Banner

    # Check if source handler files exist
    if (-not (Test-Path $HandlerBatSource)) {
        Write-Log "Error: cis-open-handler.bat not found at: $HandlerBatSource" "Error"
        Write-Log ""
        Write-Log "Please ensure the following files are in the same directory:" "Warning"
        Write-Log "  - setup.ps1 (this script)"
        Write-Log "  - cis-open-handler.bat"
        Write-Log "  - cis-open-handler.ps1"
        return 1
    }

    if (-not (Test-Path $HandlerPs1Source)) {
        Write-Log "Error: cis-open-handler.ps1 not found at: $HandlerPs1Source" "Error"
        Write-Log ""
        Write-Log "Please ensure the following files are in the same directory:" "Warning"
        Write-Log "  - setup.ps1 (this script)"
        Write-Log "  - cis-open-handler.bat"
        Write-Log "  - cis-open-handler.ps1"
        return 1
    }

    Write-Log "Installing $AppName..."
    Write-Log ""

    # Step 1: Create installation directory
    Write-Log "[1/3] Creating installation directory..."
    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }
    Write-Log "      Directory: $InstallDir" "Success"

    # Step 2: Copy handler files
    Write-Log "[2/3] Copying handler files..."
    $HandlerBatDest = Join-Path $InstallDir "cis-open-handler.bat"
    $HandlerPs1Dest = Join-Path $InstallDir "cis-open-handler.ps1"
    Copy-Item -Path $HandlerBatSource -Destination $HandlerBatDest -Force
    Copy-Item -Path $HandlerPs1Source -Destination $HandlerPs1Dest -Force
    Write-Log "      Copied: cis-open-handler.bat" "Success"
    Write-Log "      Copied: cis-open-handler.ps1" "Success"

    # Create a version info file
    $VersionFile = Join-Path $InstallDir "version.txt"
    @"
CIS File Handler
Version: $Version
Installed: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
User: $env:USERNAME
"@ | Out-File -FilePath $VersionFile -Encoding UTF8

    # Step 3: Register protocol handler
    Write-Log "[3/3] Registering protocol handler..."

    try {
        # Create the protocol key
        if (-not (Test-Path $RegPath)) {
            New-Item -Path $RegPath -Force | Out-Null
        }

        # Set default value and URL Protocol marker
        Set-ItemProperty -Path $RegPath -Name "(Default)" -Value $ProtocolDescription
        Set-ItemProperty -Path $RegPath -Name "URL Protocol" -Value ""

        # Create DefaultIcon key
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

        # Set the command to execute (pointing to local copy)
        $CommandValue = "`"$HandlerBatDest`" `"%1`""
        Set-ItemProperty -Path $CommandPath -Name "(Default)" -Value $CommandValue

        Write-Log "      Protocol: cis-open://" "Success"

    } catch {
        Write-Log "Failed to register protocol handler: $_" "Error"
        return 1
    }

    # Success message
    Write-Log ""
    Write-Log "========================================" -ForegroundColor Green
    Write-Log "  Installation completed successfully!" -ForegroundColor Green
    Write-Log "========================================" -ForegroundColor Green
    Write-Log ""
    Write-Log "You can now open NAS files directly from CIS File Search."
    Write-Log ""
    Write-Log "How to use:"
    Write-Log "  1. Search for files in CIS File Search"
    Write-Log "  2. Click the green folder icon next to any result"
    Write-Log "  3. The file will open in Windows Explorer"
    Write-Log ""
    Write-Log "Installation details:"
    Write-Log "  Location: $InstallDir"
    Write-Log "  Protocol: cis-open://"
    Write-Log "  Registry: $RegPath"
    Write-Log ""

    return 0
}

# ========================================================================
# Main Entry Point
# ========================================================================

if ($Uninstall) {
    $exitCode = Uninstall-Handler
} else {
    $exitCode = Install-Handler
}

exit $exitCode
