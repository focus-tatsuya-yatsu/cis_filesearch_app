# ========================================
# AWS DataSync Agent - Health Check Script
# ========================================
# Comprehensive health check for DataSync VM
#
# Usage: .\4-Health-Check.ps1 [-Detailed]
# ========================================

#Requires -RunAsAdministrator

[CmdletBinding()]
param(
    [string]$VMName = "AWS-DataSync-Agent",
    [switch]$Detailed,
    [switch]$ExportReport
)

$ErrorActionPreference = "Stop"

# Color output functions
function Write-Info { param([string]$Message) Write-Host $Message -ForegroundColor Cyan }
function Write-Success { param([string]$Message) Write-Host $Message -ForegroundColor Green }
function Write-Error { param([string]$Message) Write-Host $Message -ForegroundColor Red }
function Write-Warning { param([string]$Message) Write-Host $Message -ForegroundColor Yellow }
function Write-Pass { param([string]$Message) Write-Host "  ✓ $Message" -ForegroundColor Green }
function Write-Fail { param([string]$Message) Write-Host "  ✗ $Message" -ForegroundColor Red }

# Initialize health report
$healthReport = @{
    Timestamp = Get-Date
    VMName = $VMName
    Checks = @{}
    OverallStatus = "Unknown"
    Recommendations = @()
}

# Display banner
Clear-Host
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  AWS DataSync Agent - Health Check" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "VM: $VMName" -ForegroundColor White
Write-Host "Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor White
Write-Host ""

# ========================================
# CHECK 1: VM Existence and State
# ========================================
Write-Info "[1/10] Checking VM existence and state..."
$vm = Get-VM -Name $VMName -ErrorAction SilentlyContinue

if (-not $vm) {
    Write-Fail "VM not found"
    $healthReport.Checks.VMExists = @{ Status = "FAIL"; Message = "VM not found" }
    $healthReport.OverallStatus = "CRITICAL"
    Write-Host "`nCRITICAL: VM does not exist. Run setup scripts first." -ForegroundColor Red
    exit 1
}

if ($vm.State -eq "Running") {
    Write-Pass "VM is running"
    $healthReport.Checks.VMState = @{ Status = "PASS"; Message = "VM is running"; Uptime = $vm.Uptime.ToString() }
} else {
    Write-Fail "VM is not running (State: $($vm.State))"
    $healthReport.Checks.VMState = @{ Status = "FAIL"; Message = "VM state: $($vm.State)" }
    $healthReport.Recommendations += "Start the VM: Start-VM -Name '$VMName'"
}

# ========================================
# CHECK 2: Integration Services
# ========================================
Write-Info "`n[2/10] Checking Integration Services..."
$integrationState = $vm.IntegrationServicesState

if ($integrationState -eq "Up to date") {
    Write-Pass "Integration Services are up to date"
    $healthReport.Checks.IntegrationServices = @{ Status = "PASS"; Message = "Up to date" }
} else {
    Write-Fail "Integration Services state: $integrationState"
    $healthReport.Checks.IntegrationServices = @{ Status = "WARN"; Message = $integrationState }
    $healthReport.Recommendations += "Integration services may need attention"
}

# Check individual integration services
if ($Detailed) {
    Write-Info "  Integration Services Details:"
    $services = Get-VMIntegrationService -VMName $VMName
    foreach ($service in $services) {
        $status = if ($service.Enabled) { "Enabled" } else { "Disabled" }
        $color = if ($service.Enabled) { "Green" } else { "Yellow" }
        Write-Host "    - $($service.Name): $status" -ForegroundColor $color
    }
}

# ========================================
# CHECK 3: CPU Resources
# ========================================
Write-Info "`n[3/10] Checking CPU resources..."
$cpuUsage = $vm.CPUUsage
$vmProcessor = Get-VMProcessor -VMName $VMName

if ($cpuUsage -lt 90) {
    Write-Pass "CPU usage is normal ($cpuUsage%)"
    $healthReport.Checks.CPU = @{
        Status = "PASS"
        Usage = $cpuUsage
        Count = $vmProcessor.Count
    }
} else {
    Write-Fail "CPU usage is high ($cpuUsage%)"
    $healthReport.Checks.CPU = @{
        Status = "WARN"
        Usage = $cpuUsage
        Count = $vmProcessor.Count
    }
    $healthReport.Recommendations += "CPU usage is high. Consider increasing processor count or reducing workload."
}

if ($Detailed) {
    Write-Host "  Virtual CPUs: $($vmProcessor.Count)" -ForegroundColor White
    Write-Host "  Reserve: $($vmProcessor.Reserve)%" -ForegroundColor White
    Write-Host "  Maximum: $($vmProcessor.Maximum)%" -ForegroundColor White
}

# ========================================
# CHECK 4: Memory Resources
# ========================================
Write-Info "`n[4/10] Checking memory resources..."
$vmMemory = Get-VMMemory -VMName $VMName
$memoryAssignedGB = [math]::Round($vm.MemoryAssigned / 1GB, 2)
$memoryDemandGB = [math]::Round($vm.MemoryDemand / 1GB, 2)
$memoryMinGB = [math]::Round($vmMemory.Minimum / 1GB, 2)
$memoryMaxGB = [math]::Round($vmMemory.Maximum / 1GB, 2)

# Check if memory is sufficient (demand should be less than assigned)
if ($memoryAssignedGB -ge $memoryDemandGB -and $memoryAssignedGB -ge 8) {
    Write-Pass "Memory allocation is adequate ($memoryAssignedGB GB assigned, $memoryDemandGB GB demand)"
    $healthReport.Checks.Memory = @{
        Status = "PASS"
        Assigned = $memoryAssignedGB
        Demand = $memoryDemandGB
        Status = $vm.MemoryStatus
    }
} else {
    Write-Fail "Memory may be insufficient ($memoryAssignedGB GB assigned, $memoryDemandGB GB demand)"
    $healthReport.Checks.Memory = @{
        Status = "WARN"
        Assigned = $memoryAssignedGB
        Demand = $memoryDemandGB
        Status = $vm.MemoryStatus
    }
    $healthReport.Recommendations += "Consider increasing maximum memory allocation"
}

if ($Detailed) {
    Write-Host "  Dynamic Memory: $($vmMemory.DynamicMemoryEnabled)" -ForegroundColor White
    Write-Host "  Minimum: $memoryMinGB GB" -ForegroundColor White
    Write-Host "  Startup: $([math]::Round($vmMemory.Startup / 1GB, 2)) GB" -ForegroundColor White
    Write-Host "  Maximum: $memoryMaxGB GB" -ForegroundColor White
    Write-Host "  Memory Status: $($vm.MemoryStatus)" -ForegroundColor White
}

# ========================================
# CHECK 5: Network Connectivity
# ========================================
Write-Info "`n[5/10] Checking network connectivity..."
$vmNetwork = Get-VMNetworkAdapter -VMName $VMName

if ($vmNetwork.Status -eq "Ok") {
    Write-Pass "Network adapter status is OK"
    $healthReport.Checks.Network = @{
        Status = "PASS"
        AdapterStatus = $vmNetwork.Status
        Switch = $vmNetwork.SwitchName
    }
} else {
    Write-Fail "Network adapter status: $($vmNetwork.Status)"
    $healthReport.Checks.Network = @{
        Status = "FAIL"
        AdapterStatus = $vmNetwork.Status
        Switch = $vmNetwork.SwitchName
    }
    $healthReport.Recommendations += "Check virtual switch configuration"
}

# Check IP address assignment
$ipAddresses = $vmNetwork.IPAddresses
if ($ipAddresses -and $ipAddresses.Count -gt 0) {
    Write-Pass "IP address assigned: $($ipAddresses[0])"
    $healthReport.Checks.Network.IPAddress = $ipAddresses[0]
} else {
    Write-Fail "No IP address assigned"
    $healthReport.Checks.Network.IPAddress = "None"
    $healthReport.Recommendations += "Check DHCP server or configure static IP"
}

if ($Detailed) {
    Write-Host "  Switch Name: $($vmNetwork.SwitchName)" -ForegroundColor White
    Write-Host "  MAC Address: $($vmNetwork.MacAddress)" -ForegroundColor White
    if ($vmNetwork.IPAddresses) {
        foreach ($ip in $vmNetwork.IPAddresses) {
            Write-Host "  IP Address: $ip" -ForegroundColor White
        }
    }
}

# ========================================
# CHECK 6: Web Interface Accessibility
# ========================================
Write-Info "`n[6/10] Checking web interface accessibility..."

if ($ipAddresses -and $ipAddresses.Count -gt 0) {
    $webUrl = "http://$($ipAddresses[0])"
    try {
        $response = Invoke-WebRequest -Uri $webUrl -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            Write-Pass "Web interface is accessible at $webUrl"
            $healthReport.Checks.WebInterface = @{
                Status = "PASS"
                URL = $webUrl
                ResponseCode = $response.StatusCode
            }
        }
    } catch {
        Write-Fail "Web interface is not accessible"
        $healthReport.Checks.WebInterface = @{
            Status = "FAIL"
            URL = $webUrl
            Error = $_.Exception.Message
        }
        $healthReport.Recommendations += "Web interface not accessible. VM may still be initializing or there may be a network issue."
    }
} else {
    Write-Warning "Cannot test web interface (no IP address)"
    $healthReport.Checks.WebInterface = @{ Status = "SKIP"; Message = "No IP address" }
}

# ========================================
# CHECK 7: Virtual Switch Configuration
# ========================================
Write-Info "`n[7/10] Checking virtual switch configuration..."
$vSwitch = Get-VMSwitch -Name $vmNetwork.SwitchName -ErrorAction SilentlyContinue

if ($vSwitch) {
    Write-Pass "Virtual switch exists: $($vSwitch.Name) ($($vSwitch.SwitchType))"
    $healthReport.Checks.VirtualSwitch = @{
        Status = "PASS"
        Name = $vSwitch.Name
        Type = $vSwitch.SwitchType
    }

    if ($vSwitch.SwitchType -eq "External") {
        Write-Pass "External switch configured (can access NAS)"
    } else {
        Write-Warning "Switch type is $($vSwitch.SwitchType) - may not have external network access"
        $healthReport.Recommendations += "Ensure external switch is configured for NAS access"
    }
} else {
    Write-Fail "Virtual switch not found"
    $healthReport.Checks.VirtualSwitch = @{ Status = "FAIL"; Message = "Switch not found" }
    $healthReport.Recommendations += "Configure virtual switch"
}

# ========================================
# CHECK 8: Disk Space and Performance
# ========================================
Write-Info "`n[8/10] Checking disk space and performance..."
$vhd = Get-VHD -VMId $vm.VMId

$diskSizeGB = [math]::Round($vhd.Size / 1GB, 2)
$diskUsedGB = [math]::Round($vhd.FileSize / 1GB, 2)
$diskFreeGB = [math]::Round(($vhd.Size - $vhd.FileSize) / 1GB, 2)
$diskFreePercent = [math]::Round((($vhd.Size - $vhd.FileSize) / $vhd.Size) * 100, 2)

if ($diskFreePercent -gt 20) {
    Write-Pass "Disk space is adequate ($diskFreeGB GB free, $diskFreePercent%)"
    $healthReport.Checks.Disk = @{
        Status = "PASS"
        SizeGB = $diskSizeGB
        UsedGB = $diskUsedGB
        FreeGB = $diskFreeGB
        FreePercent = $diskFreePercent
    }
} else {
    Write-Fail "Low disk space ($diskFreeGB GB free, $diskFreePercent%)"
    $healthReport.Checks.Disk = @{
        Status = "WARN"
        SizeGB = $diskSizeGB
        UsedGB = $diskUsedGB
        FreeGB = $diskFreeGB
        FreePercent = $diskFreePercent
    }
    $healthReport.Recommendations += "Consider expanding virtual disk"
}

if ($Detailed) {
    Write-Host "  Disk Size: $diskSizeGB GB" -ForegroundColor White
    Write-Host "  Used: $diskUsedGB GB" -ForegroundColor White
    Write-Host "  Free: $diskFreeGB GB ($diskFreePercent%)" -ForegroundColor White
    Write-Host "  Format: $($vhd.VhdFormat)" -ForegroundColor White
    Write-Host "  Type: $($vhd.VhdType)" -ForegroundColor White
}

# ========================================
# CHECK 9: NAS Reachability
# ========================================
Write-Info "`n[9/10] Checking NAS reachability from host..."
$nasIPs = 212..218 | ForEach-Object { "192.168.1.$_" }
$reachableNAS = @()

foreach ($nasIP in $nasIPs) {
    if (Test-Connection -ComputerName $nasIP -Count 1 -Quiet -TimeoutSec 2) {
        Write-Pass "$nasIP is reachable"
        $reachableNAS += $nasIP
    } else {
        Write-Warning "$nasIP is not reachable"
    }
}

$healthReport.Checks.NAS = @{
    Status = if ($reachableNAS.Count -gt 0) { "PASS" } else { "FAIL" }
    TotalNAS = $nasIPs.Count
    ReachableNAS = $reachableNAS.Count
    ReachableIPs = $reachableNAS
}

if ($reachableNAS.Count -eq 0) {
    $healthReport.Recommendations += "No NAS devices reachable. Check network connectivity and NAS status."
}

# ========================================
# CHECK 10: Resource Metrics (if available)
# ========================================
Write-Info "`n[10/10] Checking resource metrics..."
try {
    $vmMetrics = Measure-VM -VMName $VMName -ErrorAction Stop

    Write-Pass "Resource metering is enabled"
    $healthReport.Checks.Metrics = @{
        Status = "PASS"
        AvgCPU = [math]::Round($vmMetrics.AverageCPUUsage, 2)
        AvgMemoryMB = [math]::Round($vmMetrics.AverageMemoryUsage / 1MB, 2)
    }

    if ($Detailed) {
        Write-Host "  Average CPU: $([math]::Round($vmMetrics.AverageCPUUsage, 2))%" -ForegroundColor White
        Write-Host "  Average Memory: $([math]::Round($vmMetrics.AverageMemoryUsage / 1MB, 2)) MB" -ForegroundColor White

        if ($vmMetrics.NetworkMeteredTrafficReport -and $vmMetrics.NetworkMeteredTrafficReport.Count -gt 0) {
            $networkReport = $vmMetrics.NetworkMeteredTrafficReport[0]
            Write-Host "  Network In: $([math]::Round($networkReport.IncomingTrafficTotal / 1MB, 2)) MB" -ForegroundColor White
            Write-Host "  Network Out: $([math]::Round($networkReport.OutgoingTrafficTotal / 1MB, 2)) MB" -ForegroundColor White

            $healthReport.Checks.Metrics.NetworkInMB = [math]::Round($networkReport.IncomingTrafficTotal / 1MB, 2)
            $healthReport.Checks.Metrics.NetworkOutMB = [math]::Round($networkReport.OutgoingTrafficTotal / 1MB, 2)
        }
    }
} catch {
    Write-Warning "Resource metering not available"
    $healthReport.Checks.Metrics = @{ Status = "SKIP"; Message = "Not enabled" }
}

# ========================================
# Overall Health Assessment
# ========================================
Write-Host "`n" + "="*70 -ForegroundColor Cyan
Write-Host "HEALTH CHECK SUMMARY" -ForegroundColor Cyan
Write-Host "="*70 -ForegroundColor Cyan

$passedChecks = ($healthReport.Checks.Values | Where-Object { $_.Status -eq "PASS" }).Count
$totalChecks = ($healthReport.Checks.Values | Where-Object { $_.Status -ne "SKIP" }).Count
$failedChecks = ($healthReport.Checks.Values | Where-Object { $_.Status -eq "FAIL" }).Count
$warnChecks = ($healthReport.Checks.Values | Where-Object { $_.Status -eq "WARN" }).Count

Write-Host "`nCheck Results:" -ForegroundColor White
Write-Host "  Passed: $passedChecks / $totalChecks" -ForegroundColor Green
if ($warnChecks -gt 0) {
    Write-Host "  Warnings: $warnChecks" -ForegroundColor Yellow
}
if ($failedChecks -gt 0) {
    Write-Host "  Failed: $failedChecks" -ForegroundColor Red
}

# Determine overall status
if ($failedChecks -eq 0 -and $warnChecks -eq 0) {
    $healthReport.OverallStatus = "HEALTHY"
    Write-Host "`nOverall Status: HEALTHY ✓" -ForegroundColor Green
    Write-Host "The DataSync Agent VM is operating normally." -ForegroundColor Green
} elseif ($failedChecks -eq 0) {
    $healthReport.OverallStatus = "WARNING"
    Write-Host "`nOverall Status: WARNING ⚠" -ForegroundColor Yellow
    Write-Host "The VM is operational but some areas need attention." -ForegroundColor Yellow
} else {
    $healthReport.OverallStatus = "CRITICAL"
    Write-Host "`nOverall Status: CRITICAL ✗" -ForegroundColor Red
    Write-Host "The VM has critical issues that need immediate attention." -ForegroundColor Red
}

# Display recommendations
if ($healthReport.Recommendations.Count -gt 0) {
    Write-Host "`nRecommendations:" -ForegroundColor Yellow
    foreach ($recommendation in $healthReport.Recommendations) {
        Write-Host "  - $recommendation" -ForegroundColor White
    }
}

# Quick Action Items
Write-Host "`nQuick Actions:" -ForegroundColor Cyan
if ($ipAddresses -and $ipAddresses.Count -gt 0) {
    Write-Host "  - Access web interface: http://$($ipAddresses[0])" -ForegroundColor White
}
Write-Host "  - View VM console: vmconnect.exe localhost '$VMName'" -ForegroundColor White
Write-Host "  - Monitor performance: Get-VM -Name '$VMName'" -ForegroundColor White

# Export report if requested
if ($ExportReport) {
    $reportPath = "C:\DataSync-Setup\health-report-$(Get-Date -Format 'yyyy-MM-dd-HHmmss').json"
    $healthReport | ConvertTo-Json -Depth 5 | Set-Content -Path $reportPath
    Write-Host "`n✓ Health report exported to: $reportPath" -ForegroundColor Green
}

Write-Host ""
