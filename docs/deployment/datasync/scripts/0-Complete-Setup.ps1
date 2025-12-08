# ========================================
# AWS DataSync Agent - Complete Automated Setup
# ========================================
# End-to-end automation for DataSync Agent on Hyper-V
# Runs all setup steps in sequence
#
# Usage: .\0-Complete-Setup.ps1
# ========================================

#Requires -RunAsAdministrator

param(
    [string]$VMName = "AWS-DataSync-Agent",
    [string]$DownloadPath = "C:\DataSync-Setup",
    [string]$VMPath = "C:\Hyper-V\Virtual Machines",
    [int64]$MemoryStartupGB = 16,
    [int64]$MemoryMinimumGB = 8,
    [int64]$MemoryMaximumGB = 32,
    [int]$ProcessorCount = 4,
    [switch]$SkipDownload,
    [switch]$SkipVMCreation
)

$ErrorActionPreference = "Stop"

# Script location
$scriptPath = $PSScriptRoot
if (-not $scriptPath) {
    $scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
}

# Color output functions
function Write-Info { param([string]$Message) Write-Host $Message -ForegroundColor Cyan }
function Write-Success { param([string]$Message) Write-Host $Message -ForegroundColor Green }
function Write-Error { param([string]$Message) Write-Host $Message -ForegroundColor Red }
function Write-Warning { param([string]$Message) Write-Host $Message -ForegroundColor Yellow }
function Write-Step { param([string]$Message) Write-Host "`n$("="*70)" -ForegroundColor Cyan; Write-Host $Message -ForegroundColor Cyan; Write-Host $("="*70) -ForegroundColor Cyan }

# Display banner
Clear-Host
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  AWS DataSync Agent - Complete Automated Setup for Hyper-V" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "This script will:" -ForegroundColor White
Write-Host "  1. Download AWS DataSync Agent VHDX (or guide you through it)" -ForegroundColor White
Write-Host "  2. Create optimized Hyper-V virtual machine" -ForegroundColor White
Write-Host "  3. Configure VM for 8TB NAS transfer over 100Mbps" -ForegroundColor White
Write-Host "  4. Start the VM and verify connectivity" -ForegroundColor White
Write-Host "  5. Run comprehensive health checks" -ForegroundColor White
Write-Host "  6. Provide activation instructions" -ForegroundColor White
Write-Host ""
Write-Host "VM Configuration:" -ForegroundColor Yellow
Write-Host "  - Name: $VMName" -ForegroundColor White
Write-Host "  - Memory: ${MemoryStartupGB}GB (Dynamic: ${MemoryMinimumGB}GB - ${MemoryMaximumGB}GB)" -ForegroundColor White
Write-Host "  - Processors: $ProcessorCount cores" -ForegroundColor White
Write-Host "  - Network: 100Mbps bandwidth limit" -ForegroundColor White
Write-Host ""

# Confirm before proceeding
$confirm = Read-Host "Proceed with setup? (y/n)"
if ($confirm -ne "y") {
    Write-Info "Setup cancelled by user"
    exit 0
}

# Track setup progress
$setupProgress = @{
    Download = "PENDING"
    VMCreation = "PENDING"
    VMStart = "PENDING"
    HealthCheck = "PENDING"
}

try {
    # ========================================
    # STEP 1: Download DataSync Agent
    # ========================================
    if (-not $SkipDownload) {
        Write-Step "STEP 1: Download DataSync Agent VHDX"

        $downloadScript = Join-Path $scriptPath "1-Download-DataSync-Agent.ps1"
        if (Test-Path $downloadScript) {
            & $downloadScript -DownloadPath $DownloadPath
            if ($LASTEXITCODE -eq 0) {
                $setupProgress.Download = "SUCCESS"
                Write-Success "✓ Download step completed"
            } else {
                throw "Download script failed"
            }
        } else {
            Write-Warning "Download script not found. Please download VHDX manually."
            Write-Host "Place VHDX file at: $DownloadPath\VM\datasync-agent.vhdx" -ForegroundColor Yellow
            Read-Host "Press Enter once VHDX is ready"
            $setupProgress.Download = "MANUAL"
        }
    } else {
        Write-Info "Skipping download step (as requested)"
        $setupProgress.Download = "SKIPPED"
    }

    # ========================================
    # STEP 2: Create Virtual Machine
    # ========================================
    if (-not $SkipVMCreation) {
        Write-Step "STEP 2: Create Virtual Machine"

        $createVMScript = Join-Path $scriptPath "2-Create-DataSync-VM.ps1"
        if (Test-Path $createVMScript) {
            & $createVMScript `
                -VMName $VMName `
                -VMPath $VMPath `
                -MemoryStartupGB $MemoryStartupGB `
                -MemoryMinimumGB $MemoryMinimumGB `
                -MemoryMaximumGB $MemoryMaximumGB `
                -ProcessorCount $ProcessorCount

            if ($LASTEXITCODE -eq 0 -or (Get-VM -Name $VMName -ErrorAction SilentlyContinue)) {
                $setupProgress.VMCreation = "SUCCESS"
                Write-Success "✓ VM creation completed"
            } else {
                throw "VM creation failed"
            }
        } else {
            throw "VM creation script not found: $createVMScript"
        }
    } else {
        Write-Info "Skipping VM creation (as requested)"
        $setupProgress.VMCreation = "SKIPPED"
    }

    # ========================================
    # STEP 3: Start and Monitor VM
    # ========================================
    Write-Step "STEP 3: Start Virtual Machine"

    $startScript = Join-Path $scriptPath "3-Start-And-Monitor.ps1"
    if (Test-Path $startScript) {
        & $startScript -VMName $VMName

        if (Get-VM -Name $VMName | Where-Object { $_.State -eq "Running" }) {
            $setupProgress.VMStart = "SUCCESS"
            Write-Success "✓ VM started successfully"
        } else {
            throw "VM failed to start"
        }
    } else {
        Write-Warning "Start script not found. Starting VM manually..."
        Start-VM -Name $VMName
        Start-Sleep -Seconds 60
        $setupProgress.VMStart = "MANUAL"
    }

    # ========================================
    # STEP 4: Health Check
    # ========================================
    Write-Step "STEP 4: Running Health Checks"

    $healthScript = Join-Path $scriptPath "4-Health-Check.ps1"
    if (Test-Path $healthScript) {
        & $healthScript -VMName $VMName -Detailed

        $setupProgress.HealthCheck = "SUCCESS"
        Write-Success "✓ Health check completed"
    } else {
        Write-Warning "Health check script not found. Skipping health check."
        $setupProgress.HealthCheck = "SKIPPED"
    }

    # ========================================
    # FINAL SUMMARY
    # ========================================
    Write-Step "SETUP COMPLETE"

    Write-Host "Setup Progress:" -ForegroundColor Cyan
    foreach ($step in $setupProgress.GetEnumerator()) {
        $color = switch ($step.Value) {
            "SUCCESS" { "Green" }
            "SKIPPED" { "Yellow" }
            "MANUAL" { "Yellow" }
            default { "Red" }
        }
        Write-Host "  $($step.Key): $($step.Value)" -ForegroundColor $color
    }

    # Get VM information
    $vm = Get-VM -Name $VMName
    $vmNetwork = Get-VMNetworkAdapter -VMName $VMName
    $ipAddress = if ($vmNetwork.IPAddresses) { $vmNetwork.IPAddresses[0] } else { "Not assigned yet" }

    Write-Host "`nVM Information:" -ForegroundColor Cyan
    Write-Host "  Name: $($vm.Name)" -ForegroundColor White
    Write-Host "  State: $($vm.State)" -ForegroundColor $(if($vm.State -eq "Running"){"Green"}else{"Red"})
    Write-Host "  IP Address: $ipAddress" -ForegroundColor $(if($ipAddress -ne "Not assigned yet"){"Green"}else{"Yellow"})
    Write-Host "  Memory: $([math]::Round($vm.MemoryAssigned / 1GB, 2)) GB" -ForegroundColor White
    Write-Host "  CPU Usage: $($vm.CPUUsage)%" -ForegroundColor White

    # Activation instructions
    Write-Host "`n" + "="*70 -ForegroundColor Yellow
    Write-Host "NEXT STEPS: AWS ACTIVATION" -ForegroundColor Yellow
    Write-Host "="*70 -ForegroundColor Yellow
    Write-Host ""
    Write-Host "1. Access the DataSync Agent activation page:" -ForegroundColor Cyan
    if ($ipAddress -ne "Not assigned yet") {
        Write-Host "   http://$ipAddress" -ForegroundColor Green
        Write-Host ""
        $openBrowser = Read-Host "   Open in browser now? (y/n)"
        if ($openBrowser -eq "y") {
            Start-Process "http://$ipAddress"
        }
    } else {
        Write-Host "   http://<VM-IP-ADDRESS> (wait for IP assignment)" -ForegroundColor Yellow
        Write-Host "   Check IP with: Get-VMNetworkAdapter -VMName '$VMName' | Select IPAddresses" -ForegroundColor White
    }

    Write-Host ""
    Write-Host "2. Copy the activation key from the web interface" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "3. Open AWS DataSync Console:" -ForegroundColor Cyan
    Write-Host "   https://console.aws.amazon.com/datasync/" -ForegroundColor White
    Write-Host ""
    Write-Host "4. Create agent and paste the activation key" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "5. Configure DataSync task:" -ForegroundColor Cyan
    Write-Host "   - Source: NAS locations (192.168.1.212-218)" -ForegroundColor White
    Write-Host "   - Destination: S3 bucket" -ForegroundColor White
    Write-Host "   - Options: Enable verification, set bandwidth limit" -ForegroundColor White
    Write-Host ""

    # Performance expectations
    Write-Host "="*70 -ForegroundColor Cyan
    Write-Host "PERFORMANCE EXPECTATIONS" -ForegroundColor Cyan
    Write-Host "="*70 -ForegroundColor Cyan
    Write-Host ""
    Write-Host "With 100Mbps bandwidth:" -ForegroundColor White
    Write-Host "  - Throughput: 8-10 MB/s (realistic)" -ForegroundColor White
    Write-Host "  - Daily capacity: 700-850 GB/day" -ForegroundColor White
    Write-Host "  - 8TB transfer: 10-12 days" -ForegroundColor White
    Write-Host ""

    # Useful commands
    Write-Host "="*70 -ForegroundColor Cyan
    Write-Host "USEFUL COMMANDS" -ForegroundColor Cyan
    Write-Host "="*70 -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Monitor VM:" -ForegroundColor Yellow
    Write-Host "  .\3-Start-And-Monitor.ps1 -ContinuousMonitoring" -ForegroundColor White
    Write-Host ""
    Write-Host "Health check:" -ForegroundColor Yellow
    Write-Host "  .\4-Health-Check.ps1 -Detailed" -ForegroundColor White
    Write-Host ""
    Write-Host "Get VM status:" -ForegroundColor Yellow
    Write-Host "  Get-VM -Name '$VMName'" -ForegroundColor White
    Write-Host ""
    Write-Host "Connect to VM console:" -ForegroundColor Yellow
    Write-Host "  vmconnect.exe localhost '$VMName'" -ForegroundColor White
    Write-Host ""
    Write-Host "Stop VM:" -ForegroundColor Yellow
    Write-Host "  Stop-VM -Name '$VMName'" -ForegroundColor White
    Write-Host ""

    Write-Success "`n✓✓✓ Setup completed successfully! ✓✓✓"
    Write-Host ""

} catch {
    Write-Host "`n" + "="*70 -ForegroundColor Red
    Write-Host "SETUP FAILED" -ForegroundColor Red
    Write-Host "="*70 -ForegroundColor Red
    Write-Host ""
    Write-Error "Error: $($_.Exception.Message)"
    Write-Host ""
    Write-Host "Setup Progress:" -ForegroundColor Yellow
    foreach ($step in $setupProgress.GetEnumerator()) {
        $color = switch ($step.Value) {
            "SUCCESS" { "Green" }
            "PENDING" { "Yellow" }
            default { "Red" }
        }
        Write-Host "  $($step.Key): $($step.Value)" -ForegroundColor $color
    }
    Write-Host ""
    Write-Host "You can run individual scripts to continue setup:" -ForegroundColor Yellow
    Write-Host "  1-Download-DataSync-Agent.ps1" -ForegroundColor White
    Write-Host "  2-Create-DataSync-VM.ps1" -ForegroundColor White
    Write-Host "  3-Start-And-Monitor.ps1" -ForegroundColor White
    Write-Host "  4-Health-Check.ps1" -ForegroundColor White
    Write-Host ""
    exit 1
}
