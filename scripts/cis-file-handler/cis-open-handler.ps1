# ========================================================================
# CIS File Handler - Opens NAS files from cis-open:// protocol
# Version: 2.3 (Production - with file type safety)
#
# Usage: cis-open-handler.ps1 "cis-open://\\server\share\file.txt"
#
# Security measures:
#   - Strict server whitelist (ts-server3, ts-server5, ts-server6, ts-server7)
#   - Command injection prevention
#   - Path traversal prevention
# ========================================================================

param(
    [Parameter(Position=0)]
    [string]$Url
)

# Enable strict mode
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ========================================================================
# Configuration
# ========================================================================

$AllowedServers = @("ts-server3", "ts-server5", "ts-server6", "ts-server7")
$LogFile = "$env:TEMP\cis-open-handler.log"

# Safe file extensions that can be opened directly
# Other extensions will open the parent folder in Explorer
$SafeExtensions = @(
    # Images
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".tif", ".webp", ".ico", ".svg",
    # Documents
    ".pdf", ".txt", ".rtf", ".csv",
    # Office
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp",
    # CAD
    ".dwg", ".dxf", ".sfc",
    # DocuWorks
    ".xdw", ".xbd",
    # Media
    ".mp3", ".mp4", ".wav", ".avi", ".mov", ".wmv", ".mkv"
)

# Dangerous extensions - always open parent folder
$DangerousExtensions = @(
    ".exe", ".bat", ".cmd", ".ps1", ".vbs", ".js", ".jse", ".wsf", ".wsh",
    ".msi", ".com", ".scr", ".pif", ".hta", ".cpl",
    ".zip", ".rar", ".7z", ".tar", ".gz", ".bz2",
    ".lnk", ".url", ".desktop"
)

# ========================================================================
# Logging function
# ========================================================================

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$timestamp - $Message" | Out-File -FilePath $LogFile -Append -Encoding UTF8
}

# ========================================================================
# Main Logic
# ========================================================================

try {
    Write-Log "=== New request ==="
    Write-Log "Raw URL: $Url"

    # Check if URL is empty
    if ([string]::IsNullOrEmpty($Url)) {
        Write-Log "ERROR: No URL provided"
        exit 1
    }

    # Remove the protocol prefix (cis-open://)
    $path = $Url -replace "^cis-open://", ""
    Write-Log "After removing protocol: $path"

    # URL decode the path (handles Japanese characters properly)
    $path = [System.Uri]::UnescapeDataString($path)
    Write-Log "After URL decode: $path"

    # Convert forward slashes to backslashes
    $path = $path -replace "/", "\"
    Write-Log "After slash conversion: $path"

    # Remove trailing backslashes (critical fix for file paths)
    $path = $path.TrimEnd('\')
    Write-Log "After trimming trailing slash: $path"

    # ========================================================================
    # Security Check 1: Path Traversal Prevention
    # ========================================================================

    if ($path -match "\.\.") {
        Write-Log "ERROR: Path traversal detected"
        exit 1
    }

    # ========================================================================
    # Security Check 2: Dangerous characters (Command Injection Prevention)
    # ========================================================================

    $dangerousChars = @('&', '|', '<', '>', ';', '`', '$')
    foreach ($char in $dangerousChars) {
        if ($path.Contains($char)) {
            Write-Log "ERROR: Dangerous character detected: $char"
            exit 1
        }
    }

    # ========================================================================
    # Security Check 3: UNC Path format validation
    # ========================================================================

    if (-not $path.StartsWith("\\")) {
        Write-Log "ERROR: Invalid path format (must start with \\)"
        exit 1
    }

    # ========================================================================
    # Security Check 4: Strict Server Whitelist
    # ========================================================================

    # Extract server name from path (\\server\share\...)
    $pathParts = $path.TrimStart('\').Split('\')
    $serverName = $pathParts[0]
    Write-Log "Server name: $serverName"

    $serverAllowed = $false
    foreach ($allowed in $AllowedServers) {
        if ($serverName -ieq $allowed) {
            $serverAllowed = $true
            break
        }
    }

    if (-not $serverAllowed) {
        Write-Log "ERROR: Server '$serverName' is not in the allowed list"
        Write-Log "Allowed servers: $($AllowedServers -join ', ')"
        exit 1
    }

    # ========================================================================
    # Open the file/directory
    # ========================================================================

    Write-Log "Attempting to open: $path"

    # Helper function to check if extension is safe
    function Test-SafeExtension {
        param([string]$FilePath)
        $ext = [System.IO.Path]::GetExtension($FilePath).ToLower()

        # If it's in the dangerous list, definitely not safe
        if ($DangerousExtensions -contains $ext) {
            Write-Log "Extension '$ext' is in dangerous list - will open parent folder"
            return $false
        }

        # If it's in the safe list, it's safe
        if ($SafeExtensions -contains $ext) {
            return $true
        }

        # Unknown extension - open parent folder to be safe
        Write-Log "Extension '$ext' is unknown - will open parent folder for safety"
        return $false
    }

    if (Test-Path -LiteralPath $path -PathType Container) {
        # It's a directory - open in Explorer
        Write-Log "Opening directory in Explorer"
        Start-Process "explorer.exe" -ArgumentList "`"$path`""
    }
    elseif (Test-Path -LiteralPath $path -PathType Leaf) {
        # It's a file - check if safe to open directly
        if (Test-SafeExtension -FilePath $path) {
            Write-Log "Opening file with default application (safe extension)"
            Start-Process -FilePath $path
        }
        else {
            # Open parent folder and select the file in Explorer
            Write-Log "Opening parent folder and selecting file (unsafe extension)"
            $parentDir = Split-Path -Parent $path
            Start-Process "explorer.exe" -ArgumentList "/select,`"$path`""
        }
    }
    else {
        # Path doesn't exist - try to open parent folder
        Write-Log "Path does not exist, trying parent folder"
        $parentDir = Split-Path -Parent $path

        if (Test-Path -LiteralPath $parentDir) {
            Write-Log "Opening parent directory: $parentDir"
            Start-Process "explorer.exe" -ArgumentList "`"$parentDir`""
        }
        else {
            # Try to open just the server share root
            if ($pathParts.Length -ge 2) {
                $shareRoot = "\\$($pathParts[0])\$($pathParts[1])"
                Write-Log "Trying share root: $shareRoot"

                if (Test-Path -LiteralPath $shareRoot) {
                    Start-Process "explorer.exe" -ArgumentList "`"$shareRoot`""
                }
                else {
                    Write-Log "ERROR: Cannot access share root"
                    exit 1
                }
            }
            else {
                Write-Log "ERROR: Path not accessible"
                exit 1
            }
        }
    }

    Write-Log "SUCCESS: Command executed"
    exit 0
}
catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    exit 1
}
