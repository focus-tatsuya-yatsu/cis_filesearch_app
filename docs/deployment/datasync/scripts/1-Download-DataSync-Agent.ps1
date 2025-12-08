# ========================================
# AWS DataSync Agent - Download Script
# ========================================
# Downloads AWS DataSync Agent VHDX for Hyper-V
# Optimized for Windows 11 Pro with 64GB RAM
#
# Usage: .\1-Download-DataSync-Agent.ps1
# ========================================

#Requires -RunAsAdministrator

[CmdletBinding()]
param(
    [string]$DownloadPath = "C:\DataSync-Setup",
    [string]$VHDXFileName = "datasync-agent.vhdx"
)

$ErrorActionPreference = "Stop"

# Color output functions
function Write-Info { param([string]$Message) Write-Host $Message -ForegroundColor Cyan }
function Write-Success { param([string]$Message) Write-Host $Message -ForegroundColor Green }
function Write-Error { param([string]$Message) Write-Host $Message -ForegroundColor Red }
function Write-Warning { param([string]$Message) Write-Host $Message -ForegroundColor Yellow }

# Display banner
Clear-Host
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  AWS DataSync Agent Download for Hyper-V" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Create download directory
Write-Info "Step 1: Creating download directory..."
try {
    New-Item -Path $DownloadPath -ItemType Directory -Force | Out-Null
    New-Item -Path "$DownloadPath\VM" -ItemType Directory -Force | Out-Null
    Write-Success "✓ Directory created: $DownloadPath"
} catch {
    Write-Error "✗ Failed to create directory: $_"
    exit 1
}

# Step 2: Check available disk space
Write-Info "`nStep 2: Checking disk space..."
$drive = (Get-Item $DownloadPath).PSDrive
$freeSpaceGB = [math]::Round($drive.Free / 1GB, 2)
$requiredSpaceGB = 20

if ($freeSpaceGB -lt $requiredSpaceGB) {
    Write-Error "✗ Insufficient disk space. Required: ${requiredSpaceGB}GB, Available: ${freeSpaceGB}GB"
    exit 1
}
Write-Success "✓ Sufficient disk space available: ${freeSpaceGB}GB"

# Step 3: Download AWS DataSync Agent
Write-Info "`nStep 3: Downloading AWS DataSync Agent VHDX..."
Write-Warning "Note: This is a large file (~8GB). Download may take 10-30 minutes depending on your connection."
Write-Warning "The official AWS download URL requires AWS CLI or manual download from AWS Console."
Write-Host ""

# AWS provides DataSync agent images via console download or AWS CLI
# Method 1: Using AWS CLI (if installed)
$awsCliInstalled = Get-Command aws -ErrorAction SilentlyContinue

if ($awsCliInstalled) {
    Write-Info "AWS CLI detected. Attempting download via AWS..."

    # Check AWS credentials
    $awsIdentity = aws sts get-caller-identity 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Success "✓ AWS credentials configured"

        # Download from S3 (AWS provides agent in public bucket for some regions)
        # Note: URL varies by region, adjust accordingly
        $s3Url = "s3://aws-datasync-downloads/datasync-agent-hyperv-latest.zip"
        $zipPath = Join-Path $DownloadPath "datasync-agent.zip"

        Write-Info "Downloading from AWS S3..."
        aws s3 cp $s3Url $zipPath --no-sign-request 2>&1

        if (Test-Path $zipPath) {
            Write-Success "✓ Download complete: $zipPath"

            # Extract ZIP
            Write-Info "Extracting VHDX..."
            Expand-Archive -Path $zipPath -DestinationPath "$DownloadPath\VM" -Force

            # Find VHDX file
            $vhdxFile = Get-ChildItem -Path "$DownloadPath\VM" -Filter "*.vhdx" -Recurse | Select-Object -First 1
            if ($vhdxFile) {
                Write-Success "✓ VHDX extracted: $($vhdxFile.FullName)"
            }
        } else {
            Write-Warning "AWS CLI download failed. Proceeding to manual instructions."
        }
    } else {
        Write-Warning "AWS CLI installed but credentials not configured."
    }
} else {
    Write-Warning "AWS CLI not installed."
}

# Method 2: Manual download instructions
Write-Host "`n" + "="*60 -ForegroundColor Yellow
Write-Host "MANUAL DOWNLOAD REQUIRED" -ForegroundColor Yellow
Write-Host "="*60 -ForegroundColor Yellow
Write-Host ""
Write-Host "AWS DataSync Agent must be downloaded from AWS Console:" -ForegroundColor White
Write-Host ""
Write-Host "1. Open AWS Console: https://console.aws.amazon.com/datasync/" -ForegroundColor Cyan
Write-Host "2. Navigate to: Agents > Create agent" -ForegroundColor Cyan
Write-Host "3. Select deployment option: Hyper-V" -ForegroundColor Cyan
Write-Host "4. Click 'Download agent image (VHDX)'" -ForegroundColor Cyan
Write-Host "5. Save to: $DownloadPath\VM\" -ForegroundColor Cyan
Write-Host "6. Rename file to: datasync-agent.vhdx" -ForegroundColor Cyan
Write-Host ""
Write-Host "Alternative - Download OVA and Convert:" -ForegroundColor Yellow
Write-Host "If VHDX not available, download OVA and use conversion tools:" -ForegroundColor White
Write-Host "  - Download OVA from AWS Console" -ForegroundColor Cyan
Write-Host "  - Use 7-Zip to extract VMDK from OVA" -ForegroundColor Cyan
Write-Host "  - Convert VMDK to VHDX using qemu-img:" -ForegroundColor Cyan
Write-Host "    qemu-img convert -f vmdk -O vhdx input.vmdk output.vhdx" -ForegroundColor Cyan
Write-Host ""
Write-Host "="*60 -ForegroundColor Yellow

# Step 4: Wait for manual download
Write-Host "`nWaiting for VHDX file..." -ForegroundColor Yellow
Write-Host "Press any key once you've downloaded the VHDX file to $DownloadPath\VM\" -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Step 5: Verify VHDX exists
Write-Info "`nStep 4: Verifying VHDX file..."
$vhdxPath = Join-Path "$DownloadPath\VM" $VHDXFileName

if (-not (Test-Path $vhdxPath)) {
    # Try to find any VHDX file
    $foundVhdx = Get-ChildItem -Path "$DownloadPath\VM" -Filter "*.vhdx" -Recurse | Select-Object -First 1
    if ($foundVhdx) {
        Write-Warning "Found VHDX with different name: $($foundVhdx.Name)"
        $vhdxPath = $foundVhdx.FullName
        Write-Success "✓ Using: $vhdxPath"
    } else {
        Write-Error "✗ VHDX file not found in $DownloadPath\VM\"
        Write-Error "Please ensure the file is downloaded and try again."
        exit 1
    }
} else {
    Write-Success "✓ VHDX file found: $vhdxPath"
}

# Step 6: Verify VHDX integrity
Write-Info "`nStep 5: Verifying VHDX integrity..."
try {
    $vhdInfo = Get-VHD -Path $vhdxPath
    Write-Success "✓ VHDX is valid"
    Write-Host "  - Size: $([math]::Round($vhdInfo.Size / 1GB, 2)) GB" -ForegroundColor White
    Write-Host "  - Format: $($vhdInfo.VhdFormat)" -ForegroundColor White
    Write-Host "  - Type: $($vhdInfo.VhdType)" -ForegroundColor White
} catch {
    Write-Error "✗ VHDX file appears to be corrupt or invalid: $_"
    exit 1
}

# Summary
Write-Host "`n" + "="*60 -ForegroundColor Green
Write-Host "DOWNLOAD COMPLETE" -ForegroundColor Green
Write-Host "="*60 -ForegroundColor Green
Write-Host ""
Write-Host "VHDX Location: $vhdxPath" -ForegroundColor Cyan
Write-Host "VHDX Size: $([math]::Round($vhdInfo.Size / 1GB, 2)) GB" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Step: Run '2-Create-DataSync-VM.ps1' to create the virtual machine" -ForegroundColor Yellow
Write-Host ""

# Export path for next script
$configPath = Join-Path $DownloadPath "config.json"
$config = @{
    VHDXPath = $vhdxPath
    DownloadDate = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    VHDXSize = $vhdInfo.Size
}
$config | ConvertTo-Json | Set-Content -Path $configPath
Write-Success "✓ Configuration saved to: $configPath"
