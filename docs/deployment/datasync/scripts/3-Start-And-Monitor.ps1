# ========================================
# AWS DataSync Agent - Start & Monitor Script
# ========================================
# Starts DataSync VM and provides real-time monitoring
#
# Usage: .\3-Start-And-Monitor.ps1
# ========================================

#Requires -RunAsAdministrator

[CmdletBinding()]
param(
    [string]$VMName = "AWS-DataSync-Agent",
    [int]$BootWaitSeconds = 90,
    [switch]$ContinuousMonitoring
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
Write-Host "  AWS DataSync Agent - Start & Monitor" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check if VM exists
Write-Info "Step 1: Checking VM status..."
$vm = Get-VM -Name $VMName -ErrorAction SilentlyContinue
if (-not $vm) {
    Write-Error "✗ VM '$VMName' not found"
    Write-Host "Run '2-Create-DataSync-VM.ps1' to create the VM" -ForegroundColor Yellow
    exit 1
}
Write-Success "✓ VM found: $VMName"
Write-Host "  Current state: $($vm.State)" -ForegroundColor White

# Step 2: Start VM if not running
if ($vm.State -ne "Running") {
    Write-Info "`nStep 2: Starting VM..."
    try {
        Start-VM -Name $VMName
        Write-Success "✓ VM started successfully"
    } catch {
        Write-Error "✗ Failed to start VM: $_"
        exit 1
    }

    # Wait for boot
    Write-Info "`nStep 3: Waiting for VM to boot ($BootWaitSeconds seconds)..."
    Write-Host "This typically takes 60-90 seconds..." -ForegroundColor Yellow

    for ($i = 1; $i -le $BootWaitSeconds; $i++) {
        $percent = [math]::Round(($i / $BootWaitSeconds) * 100)
        Write-Progress -Activity "Booting DataSync Agent" -Status "$percent% Complete" -PercentComplete $percent
        Start-Sleep -Seconds 1
    }
    Write-Progress -Activity "Booting DataSync Agent" -Completed
    Write-Success "✓ Boot wait complete"
} else {
    Write-Success "`n✓ VM is already running"
}

# Step 3: Enable resource metering
Write-Info "`nStep 4: Enabling resource metering..."
try {
    Enable-VMResourceMetering -VMName $VMName -ErrorAction SilentlyContinue
    Write-Success "✓ Resource metering enabled"
} catch {
    Write-Warning "Could not enable resource metering: $_"
}

# Step 4: Get VM status
Write-Info "`nStep 5: Retrieving VM information..."
Start-Sleep -Seconds 5  # Give integration services time to report

$vm = Get-VM -Name $VMName
$vmMemory = Get-VMMemory -VMName $VMName
$vmProcessor = Get-VMProcessor -VMName $VMName
$vmNetwork = Get-VMNetworkAdapter -VMName $VMName
$vmMetrics = Measure-VM -VMName $VMName

# Display current status
Write-Host "`n" + "="*70 -ForegroundColor Green
Write-Host "VM STATUS" -ForegroundColor Green
Write-Host "="*70 -ForegroundColor Green

Write-Host "`nGeneral Information:" -ForegroundColor Cyan
Write-Host "  Name: $($vm.Name)" -ForegroundColor White
Write-Host "  State: $($vm.State)" -ForegroundColor $(if($vm.State -eq "Running"){"Green"}else{"Yellow"})
Write-Host "  Uptime: $($vm.Uptime)" -ForegroundColor White
Write-Host "  Integration Services: $($vm.IntegrationServicesState)" -ForegroundColor White

Write-Host "`nResource Usage:" -ForegroundColor Cyan
Write-Host "  CPU Usage: $($vm.CPUUsage)%" -ForegroundColor $(if($vm.CPUUsage -gt 80){"Red"}elseif($vm.CPUUsage -gt 50){"Yellow"}else{"Green"})
Write-Host "  Memory Assigned: $([math]::Round($vm.MemoryAssigned / 1GB, 2)) GB" -ForegroundColor White
Write-Host "  Memory Demand: $([math]::Round($vm.MemoryDemand / 1GB, 2)) GB" -ForegroundColor White
Write-Host "  Memory Status: $($vm.MemoryStatus)" -ForegroundColor White

Write-Host "`nNetwork Information:" -ForegroundColor Cyan
Write-Host "  Switch: $($vmNetwork.SwitchName)" -ForegroundColor White
Write-Host "  MAC Address: $($vmNetwork.MacAddress)" -ForegroundColor White
Write-Host "  Connection State: $($vmNetwork.Status)" -ForegroundColor $(if($vmNetwork.Status -eq "Ok"){"Green"}else{"Red"})

# Try to get IP address
$ipAddresses = $vmNetwork.IPAddresses
if ($ipAddresses -and $ipAddresses.Count -gt 0) {
    Write-Host "  IP Addresses:" -ForegroundColor White
    foreach ($ip in $ipAddresses) {
        Write-Host "    - $ip" -ForegroundColor Green
    }
    $primaryIP = $ipAddresses[0]
} else {
    Write-Host "  IP Addresses: Not yet assigned" -ForegroundColor Yellow
    Write-Host "  (Integration services may need more time)" -ForegroundColor Yellow
    $primaryIP = $null
}

# Resource metrics (if available)
if ($vmMetrics) {
    Write-Host "`nResource Metrics:" -ForegroundColor Cyan
    Write-Host "  Average CPU: $([math]::Round($vmMetrics.AverageCPUUsage, 2))%" -ForegroundColor White
    Write-Host "  Average Memory: $([math]::Round($vmMetrics.AverageMemoryUsage / 1MB, 2)) MB" -ForegroundColor White

    if ($vmMetrics.NetworkMeteredTrafficReport -and $vmMetrics.NetworkMeteredTrafficReport.Count -gt 0) {
        $networkReport = $vmMetrics.NetworkMeteredTrafficReport[0]
        Write-Host "  Network Incoming: $([math]::Round($networkReport.IncomingTrafficTotal / 1MB, 2)) MB" -ForegroundColor White
        Write-Host "  Network Outgoing: $([math]::Round($networkReport.OutgoingTrafficTotal / 1MB, 2)) MB" -ForegroundColor White
    }
}

# Step 5: Test web interface access
if ($primaryIP) {
    Write-Host "`n" + "="*70 -ForegroundColor Yellow
    Write-Host "WEB INTERFACE ACCESS" -ForegroundColor Yellow
    Write-Host "="*70 -ForegroundColor Yellow

    Write-Info "`nTesting web interface access..."
    $webUrl = "http://$primaryIP"

    try {
        $response = Invoke-WebRequest -Uri $webUrl -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            Write-Success "✓ Web interface is accessible"
            Write-Host ""
            Write-Host "Activation URL: $webUrl" -ForegroundColor Green -BackgroundColor Black
            Write-Host ""
            Write-Host "Open this URL in your browser to access the activation page" -ForegroundColor Cyan

            # Try to open in default browser
            $openBrowser = Read-Host "`nOpen in browser now? (y/n)"
            if ($openBrowser -eq "y") {
                Start-Process $webUrl
            }
        }
    } catch {
        Write-Warning "✗ Web interface not yet accessible"
        Write-Host "The VM may still be initializing. Please wait 1-2 minutes and try accessing:" -ForegroundColor Yellow
        Write-Host "  $webUrl" -ForegroundColor Cyan
    }
}

# Step 6: Display activation instructions
Write-Host "`n" + "="*70 -ForegroundColor Yellow
Write-Host "ACTIVATION INSTRUCTIONS" -ForegroundColor Yellow
Write-Host "="*70 -ForegroundColor Yellow
Write-Host ""
Write-Host "1. Access the DataSync Agent activation page:" -ForegroundColor Cyan
if ($primaryIP) {
    Write-Host "   $webUrl" -ForegroundColor Green
} else {
    Write-Host "   http://<VM-IP-ADDRESS>" -ForegroundColor Yellow
    Write-Host "   (Wait for IP address to be assigned)" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "2. Copy the activation key from the web interface" -ForegroundColor Cyan
Write-Host ""
Write-Host "3. Open AWS DataSync Console:" -ForegroundColor Cyan
Write-Host "   https://console.aws.amazon.com/datasync/" -ForegroundColor White
Write-Host ""
Write-Host "4. Navigate to: Agents > Create agent" -ForegroundColor Cyan
Write-Host ""
Write-Host "5. Select deployment:" -ForegroundColor Cyan
Write-Host "   - Service endpoint: Public service endpoints (default)" -ForegroundColor White
Write-Host "   - Activation key region: Your AWS region" -ForegroundColor White
Write-Host "   - Hypervisor: Microsoft Hyper-V" -ForegroundColor White
Write-Host ""
Write-Host "6. Enter the activation key and complete agent creation" -ForegroundColor Cyan
Write-Host ""
Write-Host "7. Assign a name to your agent (e.g., 'NAS-to-S3-Agent')" -ForegroundColor Cyan
Write-Host ""

# NAS connectivity information
Write-Host "="*70 -ForegroundColor Yellow
Write-Host "NAS CONNECTIVITY INFORMATION" -ForegroundColor Yellow
Write-Host "="*70 -ForegroundColor Yellow
Write-Host ""
Write-Host "Ensure the DataSync Agent can reach your NAS:" -ForegroundColor Cyan
Write-Host "  - NAS IP Range: 192.168.1.212 - 192.168.1.218" -ForegroundColor White
Write-Host "  - Protocol: SMB (Port 445)" -ForegroundColor White
Write-Host "  - Credentials: Store in AWS Secrets Manager (recommended)" -ForegroundColor White
Write-Host ""

# Test NAS connectivity
Write-Info "Testing NAS connectivity from host..."
$nasIPs = 212..218 | ForEach-Object { "192.168.1.$_" }
$reachableNAS = @()

foreach ($nasIP in $nasIPs) {
    if (Test-Connection -ComputerName $nasIP -Count 1 -Quiet) {
        Write-Host "  ✓ $nasIP is reachable" -ForegroundColor Green
        $reachableNAS += $nasIP
    } else {
        Write-Host "  ✗ $nasIP is not reachable" -ForegroundColor Red
    }
}

if ($reachableNAS.Count -gt 0) {
    Write-Success "`n✓ $($reachableNAS.Count) NAS device(s) reachable from host"
    Write-Host "The VM should be able to access these devices through the external switch" -ForegroundColor Cyan
} else {
    Write-Warning "`n✗ No NAS devices reachable from host"
    Write-Host "Check network configuration and NAS connectivity" -ForegroundColor Yellow
}

# Continuous monitoring option
if ($ContinuousMonitoring) {
    Write-Host "`n" + "="*70 -ForegroundColor Cyan
    Write-Host "CONTINUOUS MONITORING MODE" -ForegroundColor Cyan
    Write-Host "="*70 -ForegroundColor Cyan
    Write-Host "Press Ctrl+C to exit monitoring`n" -ForegroundColor Yellow

    while ($true) {
        Start-Sleep -Seconds 5

        Clear-Host
        Write-Host "AWS DataSync Agent - Live Monitor" -ForegroundColor Cyan
        Write-Host "=" * 70 -ForegroundColor Cyan
        Write-Host "Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor White
        Write-Host ""

        $vm = Get-VM -Name $VMName
        $vmNetwork = Get-VMNetworkAdapter -VMName $VMName

        Write-Host "Status: $($vm.State)" -ForegroundColor $(if($vm.State -eq "Running"){"Green"}else{"Red"})
        Write-Host "Uptime: $($vm.Uptime)" -ForegroundColor White
        Write-Host "CPU: $($vm.CPUUsage)%" -ForegroundColor $(if($vm.CPUUsage -gt 80){"Red"}elseif($vm.CPUUsage -gt 50){"Yellow"}else{"Green"})
        Write-Host "Memory: $([math]::Round($vm.MemoryAssigned / 1GB, 2)) GB / $([math]::Round($vm.MemoryDemand / 1GB, 2)) GB (demand)" -ForegroundColor White
        Write-Host "Network: $($vmNetwork.Status)" -ForegroundColor $(if($vmNetwork.Status -eq "Ok"){"Green"}else{"Red"})

        if ($vmNetwork.IPAddresses -and $vmNetwork.IPAddresses.Count -gt 0) {
            Write-Host "IP: $($vmNetwork.IPAddresses[0])" -ForegroundColor Green
        } else {
            Write-Host "IP: Waiting for assignment..." -ForegroundColor Yellow
        }

        Write-Host "`nPress Ctrl+C to exit" -ForegroundColor Yellow
    }
}

# Summary
Write-Host "`n" + "="*70 -ForegroundColor Green
Write-Host "STARTUP COMPLETE" -ForegroundColor Green
Write-Host "="*70 -ForegroundColor Green
Write-Host ""
Write-Host "VM is running and ready for activation!" -ForegroundColor Green
Write-Host ""
Write-Host "Useful commands:" -ForegroundColor Cyan
Write-Host "  - Get VM status: Get-VM -Name '$VMName'" -ForegroundColor White
Write-Host "  - Get IP address: Get-VMNetworkAdapter -VMName '$VMName' | Select IPAddresses" -ForegroundColor White
Write-Host "  - Connect to console: vmconnect.exe localhost '$VMName'" -ForegroundColor White
Write-Host "  - Stop VM: Stop-VM -Name '$VMName'" -ForegroundColor White
Write-Host ""
Write-Host "For continuous monitoring, run:" -ForegroundColor Yellow
Write-Host "  .\3-Start-And-Monitor.ps1 -ContinuousMonitoring" -ForegroundColor White
Write-Host ""
