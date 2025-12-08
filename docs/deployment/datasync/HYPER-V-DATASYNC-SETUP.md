# AWS DataSync Agent on Hyper-V - Complete Setup Guide

## Overview

This guide covers deploying AWS DataSync Agent on Hyper-V (Windows 11 Pro) for transferring 8TB from NAS to S3.

**System Requirements:**
- Windows 11 Pro with Hyper-V enabled
- 64GB RAM (16GB allocated to DataSync VM)
- 100Mbps network bandwidth
- 80GB disk space for VM

---

## Prerequisites Check

### 1. Verify Hyper-V Installation

```powershell
# Check if Hyper-V is installed and running
Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V

# Check Hyper-V services
Get-Service -Name vmms,vmcompute | Select-Object Name,Status

# Verify network adapters
Get-VMSwitch
```

**Expected Output:**
- State: Enabled
- vmms: Running
- vmcompute: Running
- At least one VMSwitch present

---

## Phase 1: Download DataSync Agent

### Option A: Direct VHDX Download (Recommended for Hyper-V)

AWS provides native VHDX format for Hyper-V:

```powershell
# Download AWS DataSync Agent VHDX
$downloadUrl = "https://s3.amazonaws.com/aws-datasync-downloads/datasync-agent-hyperv.zip"
$downloadPath = "C:\DataSync-Setup\datasync-agent-hyperv.zip"
$extractPath = "C:\DataSync-Setup\VM"

# Create directories
New-Item -Path "C:\DataSync-Setup" -ItemType Directory -Force
New-Item -Path $extractPath -ItemType Directory -Force

# Download (approximately 8GB)
Write-Host "Downloading AWS DataSync Agent VHDX..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $downloadUrl -OutFile $downloadPath -UseBasicParsing

# Extract
Write-Host "Extracting VHDX..." -ForegroundColor Cyan
Expand-Archive -Path $downloadPath -DestinationPath $extractPath -Force

Write-Host "Download complete: $extractPath" -ForegroundColor Green
```

### Option B: Convert OVA to VHDX (Alternative Method)

If you already have the OVA file:

```powershell
# Install required tools
# Download and install Microsoft Virtual Machine Converter
# URL: https://www.microsoft.com/en-us/download/details.aspx?id=42497

# Convert OVA to VHDX
Import-Module "C:\Program Files\Microsoft Virtual Machine Converter\MvmcCmdlet.psd1"

ConvertTo-MvmcVirtualHardDisk `
    -SourceLiteralPath "C:\Downloads\aws-datasync-agent.ova" `
    -DestinationLiteralPath "C:\DataSync-Setup\VM" `
    -VhdType DynamicHardDisk `
    -VhdFormat Vhdx

# Alternative: Use 7-Zip to extract OVA, then convert VMDK to VHDX
# Download qemu-img from: https://cloudbase.it/qemu-img-windows/
& "C:\Program Files\qemu-img\qemu-img.exe" convert `
    -f vmdk `
    -O vhdx `
    "C:\DataSync-Setup\extracted\aws-datasync-disk1.vmdk" `
    "C:\DataSync-Setup\VM\datasync-agent.vhdx"
```

---

## Phase 2: Create Optimized VM Configuration

### Automated VM Creation Script

```powershell
# DataSync-Create-VM.ps1
# Optimized for 64GB RAM system with 8TB transfer requirements

param(
    [string]$VMName = "AWS-DataSync-Agent",
    [string]$VHDXPath = "C:\DataSync-Setup\VM\datasync-agent.vhdx",
    [string]$VMPath = "C:\Hyper-V\Virtual Machines",
    [int64]$MemoryStartupGB = 16,
    [int64]$MemoryMinimumGB = 8,
    [int64]$MemoryMaximumGB = 32,
    [int]$ProcessorCount = 4,
    [string]$SwitchName = "External-Switch"
)

# Configuration optimized for 100Mbps and 8TB transfer
$ErrorActionPreference = "Stop"

Write-Host "Creating AWS DataSync Agent VM on Hyper-V" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

# Step 1: Verify VHDX exists
if (-not (Test-Path $VHDXPath)) {
    throw "VHDX file not found at: $VHDXPath"
}

# Step 2: Check if VM already exists
if (Get-VM -Name $VMName -ErrorAction SilentlyContinue) {
    Write-Host "WARNING: VM '$VMName' already exists!" -ForegroundColor Yellow
    $response = Read-Host "Remove existing VM? (yes/no)"
    if ($response -eq "yes") {
        Stop-VM -Name $VMName -Force -ErrorAction SilentlyContinue
        Remove-VM -Name $VMName -Force
        Write-Host "Existing VM removed" -ForegroundColor Green
    } else {
        throw "VM already exists. Aborting."
    }
}

# Step 3: Create VM directory
$vmDirectory = Join-Path $VMPath $VMName
New-Item -Path $vmDirectory -ItemType Directory -Force | Out-Null

# Step 4: Copy VHDX to VM directory
$vmVHDXPath = Join-Path $vmDirectory "$VMName.vhdx"
Write-Host "Copying VHDX to VM directory..." -ForegroundColor Cyan
Copy-Item -Path $VHDXPath -Destination $vmVHDXPath -Force

# Step 5: Create VM with optimal settings
Write-Host "Creating VM: $VMName" -ForegroundColor Cyan

New-VM `
    -Name $VMName `
    -MemoryStartupBytes ($MemoryStartupGB * 1GB) `
    -Generation 1 `
    -VHDPath $vmVHDXPath `
    -Path $VMPath `
    -SwitchName $SwitchName

# Step 6: Configure Dynamic Memory (optimal for 64GB system)
Set-VMMemory `
    -VMName $VMName `
    -DynamicMemoryEnabled $true `
    -MinimumBytes ($MemoryMinimumGB * 1GB) `
    -StartupBytes ($MemoryStartupGB * 1GB) `
    -MaximumBytes ($MemoryMaximumGB * 1GB) `
    -Priority 80 `
    -Buffer 20

# Step 7: Configure Processor (25% of host CPU for optimal performance)
Set-VMProcessor `
    -VMName $VMName `
    -Count $ProcessorCount `
    -Reserve 10 `
    -Maximum 75 `
    -RelativeWeight 100

# Step 8: Network Optimization for 100Mbps bandwidth
Set-VMNetworkAdapter `
    -VMName $VMName `
    -MacAddressSpoofing Off `
    -DhcpGuard Off `
    -RouterGuard Off `
    -AllowTeaming On

# Enable bandwidth management (optional, for QoS)
Set-VMNetworkAdapter `
    -VMName $VMName `
    -MaximumBandwidth 100000000  # 100 Mbps in bytes

# Step 9: Disable automatic checkpoints (not needed for DataSync)
Set-VM -VMName $VMName -AutomaticCheckpointsEnabled $false

# Step 10: Enable Integration Services
Enable-VMIntegrationService -VMName $VMName -Name "Guest Service Interface"
Enable-VMIntegrationService -VMName $VMName -Name "Heartbeat"
Enable-VMIntegrationService -VMName $VMName -Name "Key-Value Pair Exchange"
Enable-VMIntegrationService -VMName $VMName -Name "Shutdown"
Enable-VMIntegrationService -VMName $VMName -Name "Time Synchronization"
Enable-VMIntegrationService -VMName $VMName -Name "VSS"

# Step 11: Configure disk for optimal I/O
Set-VHD -Path $vmVHDXPath -PhysicalSectorSizeBytes 4096

# Step 12: Display configuration
Write-Host "`nVM Configuration Summary:" -ForegroundColor Green
Write-Host "=========================" -ForegroundColor Green
Get-VM -Name $VMName | Format-List Name, State, CPUUsage, MemoryAssigned, MemoryDemand, Uptime
Get-VMMemory -VMName $VMName | Format-List VMName, DynamicMemoryEnabled, Minimum, Startup, Maximum
Get-VMProcessor -VMName $VMName | Format-List VMName, Count, Reserve, Maximum
Get-VMNetworkAdapter -VMName $VMName | Format-List VMName, SwitchName, MacAddress, Status

Write-Host "`nVM created successfully!" -ForegroundColor Green
Write-Host "Next step: Start the VM with 'Start-VM -Name $VMName'" -ForegroundColor Yellow
```

---

## Phase 3: Network Configuration for NAS Access

### Create External Virtual Switch (if not exists)

```powershell
# Create-External-Switch.ps1

# Get physical network adapter
$netAdapter = Get-NetAdapter | Where-Object {$_.Status -eq "Up" -and $_.MediaType -eq "802.3"} | Select-Object -First 1

if (-not $netAdapter) {
    throw "No active network adapter found"
}

Write-Host "Using network adapter: $($netAdapter.Name)" -ForegroundColor Cyan

# Create external switch
New-VMSwitch `
    -Name "External-Switch" `
    -NetAdapterName $netAdapter.Name `
    -AllowManagementOS $true `
    -Notes "External switch for DataSync Agent to access NAS"

Write-Host "External switch created successfully" -ForegroundColor Green

# Verify
Get-VMSwitch -Name "External-Switch" | Format-List *
```

### Configure Static IP (Optional but Recommended)

Once VM is running, configure static IP via DataSync activation page or connect via Hyper-V console:

```bash
# Inside DataSync Agent VM (Linux-based)
sudo vi /etc/sysconfig/network-scripts/ifcfg-eth0

# Set:
BOOTPROTO=static
IPADDR=192.168.1.220
NETMASK=255.255.255.0
GATEWAY=192.168.1.1
DNS1=8.8.8.8
DNS2=8.8.4.4

# Restart network
sudo systemctl restart network
```

---

## Phase 4: Start and Activate DataSync Agent

### Start VM

```powershell
# Start DataSync VM
Start-VM -Name "AWS-DataSync-Agent"

# Wait for boot (approximately 60 seconds)
Write-Host "Waiting for VM to boot..." -ForegroundColor Cyan
Start-Sleep -Seconds 60

# Check VM status
Get-VM -Name "AWS-DataSync-Agent" | Select-Object Name, State, CPUUsage, MemoryAssigned, Uptime

# Get IP address (requires guest integration services)
Get-VMNetworkAdapter -VMName "AWS-DataSync-Agent" | Select-Object VMName, IPAddresses, Status
```

### Access Activation Interface

1. **Find VM IP Address:**
   ```powershell
   $vmIP = (Get-VMNetworkAdapter -VMName "AWS-DataSync-Agent").IPAddresses[0]
   Write-Host "DataSync Agent IP: $vmIP" -ForegroundColor Green
   ```

2. **Open Activation Page in Browser:**
   ```
   http://<VM-IP-ADDRESS>
   ```
   Default: `http://192.168.1.220` (if static IP configured)

3. **Complete AWS Activation:**
   - Navigate to AWS Console → DataSync → Agents
   - Click "Create agent"
   - Select "Hyper-V" as hypervisor
   - Enter activation key from VM web interface
   - Configure agent settings

---

## Phase 5: Performance Optimization

### Host System Optimization

```powershell
# Optimize-Hyper-V-Host.ps1

# Disable unnecessary Windows services that compete for I/O
$servicesToStop = @(
    "SysMain",              # Superfetch
    "WSearch",              # Windows Search
    "DiagTrack"             # Diagnostics Tracking
)

foreach ($service in $servicesToStop) {
    Stop-Service -Name $service -Force -ErrorAction SilentlyContinue
    Set-Service -Name $service -StartupType Disabled
    Write-Host "Disabled: $service" -ForegroundColor Green
}

# Configure Windows for best performance (power plan)
powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c  # High Performance

# Disable hibernation to free up disk space
powercfg /hibernate off

# Set network adapter to maximum performance
Get-NetAdapter | Set-NetAdapterAdvancedProperty -DisplayName "Interrupt Moderation" -DisplayValue "Disabled"

Write-Host "Host optimization complete" -ForegroundColor Green
```

### VM-Level Optimization

```powershell
# Configure for 24/7 operation
Set-VM -Name "AWS-DataSync-Agent" -AutomaticStartAction Start
Set-VM -Name "AWS-DataSync-Agent" -AutomaticStopAction ShutDown

# Disable automatic updates during sync hours (optional)
Set-VM -Name "AWS-DataSync-Agent" -AutomaticStartDelay 30

# Enable performance counters
Enable-VMResourceMetering -VMName "AWS-DataSync-Agent"
```

---

## Phase 6: Monitoring and Maintenance

### Real-Time Performance Monitoring

```powershell
# Monitor-DataSync-VM.ps1

param(
    [int]$RefreshSeconds = 5
)

while ($true) {
    Clear-Host
    Write-Host "AWS DataSync Agent - Performance Monitor" -ForegroundColor Cyan
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host "Press Ctrl+C to exit`n" -ForegroundColor Yellow

    # VM Stats
    $vm = Get-VM -Name "AWS-DataSync-Agent"
    $vmMetrics = Measure-VM -VMName "AWS-DataSync-Agent"
    $netAdapter = Get-VMNetworkAdapter -VMName "AWS-DataSync-Agent"

    Write-Host "VM Status: $($vm.State)" -ForegroundColor Green
    Write-Host "Uptime: $($vm.Uptime)"
    Write-Host ""

    Write-Host "CPU Usage: $($vm.CPUUsage)%" -ForegroundColor $(if($vm.CPUUsage -gt 80){"Red"}else{"Green"})
    Write-Host "Memory Assigned: $([math]::Round($vm.MemoryAssigned / 1GB, 2)) GB"
    Write-Host "Memory Demand: $([math]::Round($vm.MemoryDemand / 1GB, 2)) GB"
    Write-Host ""

    Write-Host "Network Adapter: $($netAdapter.SwitchName)"
    Write-Host "IP Addresses: $($netAdapter.IPAddresses -join ', ')"
    Write-Host "Status: $($netAdapter.Status)"
    Write-Host ""

    # Resource metering (if enabled)
    Write-Host "Average CPU: $([math]::Round($vmMetrics.AverageCPUUsage, 2))%"
    Write-Host "Average Memory: $([math]::Round($vmMetrics.AverageMemoryUsage / 1MB, 2)) MB"
    Write-Host "Network Incoming: $([math]::Round($vmMetrics.NetworkMeteredTrafficReport[0].IncomingTrafficTotal / 1MB, 2)) MB"
    Write-Host "Network Outgoing: $([math]::Round($vmMetrics.NetworkMeteredTrafficReport[0].OutgoingTrafficTotal / 1MB, 2)) MB"

    Start-Sleep -Seconds $RefreshSeconds
}
```

### Health Check Script

```powershell
# HealthCheck-DataSync.ps1

function Test-DataSyncHealth {
    $health = @{
        VMRunning = $false
        NetworkConnected = $false
        MemoryOK = $false
        CPUOk = $false
        DiskSpaceOK = $false
        WebInterfaceAccessible = $false
    }

    # Check VM state
    $vm = Get-VM -Name "AWS-DataSync-Agent" -ErrorAction SilentlyContinue
    if ($vm -and $vm.State -eq "Running") {
        $health.VMRunning = $true
    }

    # Check network
    $netAdapter = Get-VMNetworkAdapter -VMName "AWS-DataSync-Agent" -ErrorAction SilentlyContinue
    if ($netAdapter -and $netAdapter.Status -eq "Ok") {
        $health.NetworkConnected = $true
    }

    # Check memory
    if ($vm.MemoryAssigned -ge 8GB) {
        $health.MemoryOK = $true
    }

    # Check CPU
    if ($vm.CPUUsage -lt 95) {
        $health.CPUOk = $true
    }

    # Check disk space
    $vhd = Get-VHD -VMId $vm.VMId
    $diskFreePercent = (($vhd.Size - $vhd.FileSize) / $vhd.Size) * 100
    if ($diskFreePercent -gt 10) {
        $health.DiskSpaceOK = $true
    }

    # Check web interface
    $vmIP = $netAdapter.IPAddresses[0]
    if ($vmIP) {
        try {
            $response = Invoke-WebRequest -Uri "http://$vmIP" -TimeoutSec 5 -UseBasicParsing
            if ($response.StatusCode -eq 200) {
                $health.WebInterfaceAccessible = $true
            }
        } catch {
            # Web interface not accessible
        }
    }

    # Display results
    Write-Host "`nDataSync Agent Health Check" -ForegroundColor Cyan
    Write-Host "============================" -ForegroundColor Cyan
    foreach ($check in $health.GetEnumerator()) {
        $status = if ($check.Value) { "✓ PASS" } else { "✗ FAIL" }
        $color = if ($check.Value) { "Green" } else { "Red" }
        Write-Host "$($check.Key): $status" -ForegroundColor $color
    }

    # Overall status
    $allPassed = ($health.Values | Where-Object { $_ -eq $false }).Count -eq 0
    Write-Host "`nOverall Status: " -NoNewline
    if ($allPassed) {
        Write-Host "HEALTHY ✓" -ForegroundColor Green
    } else {
        Write-Host "NEEDS ATTENTION ✗" -ForegroundColor Red
    }

    return $health
}

# Run health check
Test-DataSyncHealth
```

---

## Phase 7: Backup and Recovery

### Create VM Checkpoint Before Configuration

```powershell
# Create checkpoint before AWS activation
Checkpoint-VM -Name "AWS-DataSync-Agent" -SnapshotName "Pre-Activation-$(Get-Date -Format 'yyyy-MM-dd')"

# List checkpoints
Get-VMCheckpoint -VMName "AWS-DataSync-Agent"

# Restore checkpoint if needed
Restore-VMCheckpoint -Name "Pre-Activation-2025-01-15" -VMName "AWS-DataSync-Agent" -Confirm:$false
```

### Export VM for Backup

```powershell
# Export VM (for disaster recovery)
Export-VM -Name "AWS-DataSync-Agent" -Path "D:\Hyper-V-Backups\DataSync"

# Compressed backup
$exportPath = "D:\Hyper-V-Backups\DataSync"
Export-VM -Name "AWS-DataSync-Agent" -Path $exportPath
Compress-Archive -Path "$exportPath\*" -DestinationPath "D:\Backups\DataSync-Agent-$(Get-Date -Format 'yyyy-MM-dd').zip"
```

---

## Troubleshooting

### Common Issues and Solutions

#### Issue 1: VM Won't Start

```powershell
# Check VM configuration
Get-VM -Name "AWS-DataSync-Agent" | Format-List *

# Check event logs
Get-WinEvent -LogName "Microsoft-Windows-Hyper-V-Worker-Admin" -MaxEvents 20 | Where-Object {$_.Message -like "*DataSync*"}

# Verify VHDX integrity
Test-VHD -Path "C:\Hyper-V\Virtual Machines\AWS-DataSync-Agent\AWS-DataSync-Agent.vhdx"
```

#### Issue 2: No Network Connectivity

```powershell
# Verify virtual switch
Get-VMSwitch | Format-List *

# Check network adapter binding
Get-VMNetworkAdapter -VMName "AWS-DataSync-Agent" | Format-List *

# Test host network
Test-NetConnection -ComputerName 192.168.1.212 -Port 445  # SMB to NAS
```

#### Issue 3: Poor Performance

```powershell
# Check resource contention
Get-VM | Measure-VM | Sort-Object AverageCPUUsage -Descending

# Verify dynamic memory settings
Get-VMMemory -VMName "AWS-DataSync-Agent"

# Check network throttling
Get-VMNetworkAdapter -VMName "AWS-DataSync-Agent" | Select-Object BandwidthSetting
```

#### Issue 4: Cannot Access Web Interface

```powershell
# Get VM IP
Get-VMNetworkAdapter -VMName "AWS-DataSync-Agent" | Select-Object IPAddresses

# Connect to VM console directly
vmconnect.exe localhost "AWS-DataSync-Agent"

# Check firewall rules on host
Get-NetFirewallRule | Where-Object {$_.DisplayName -like "*Hyper-V*"}
```

---

## Performance Expectations

### Expected Transfer Rates

**With 100Mbps bandwidth:**
- Theoretical Maximum: 12.5 MB/s
- Realistic Throughput: 8-10 MB/s (accounting for overhead)
- Daily Transfer Capacity: ~700-850 GB/day
- **8TB Transfer Time: 10-12 days**

### Resource Utilization Targets

| Resource | Normal | Peak | Alert Threshold |
|----------|--------|------|----------------|
| CPU Usage | 20-40% | 60-80% | >90% |
| Memory | 12-16GB | 20-24GB | >28GB |
| Network | 50-70Mbps | 90-100Mbps | <10Mbps |
| Disk I/O | 50-100 IOPS | 200-500 IOPS | >1000 IOPS |

---

## Next Steps After Setup

1. **Configure DataSync Task in AWS Console:**
   - Source: NAS locations (192.168.1.212-218)
   - Destination: S3 bucket
   - Schedule: Continuous or scheduled
   - Options: Verification, bandwidth throttling

2. **Set Up CloudWatch Monitoring:**
   - Enable DataSync logs
   - Create alarms for failures
   - Monitor transfer progress

3. **Test with Small Dataset First:**
   - Transfer 100GB sample
   - Verify data integrity
   - Check performance metrics

4. **Production Rollout:**
   - Start full 8TB transfer
   - Monitor for first 24 hours
   - Adjust resources if needed

---

## Security Considerations

### Firewall Rules for DataSync

```powershell
# Allow DataSync agent ports (if Windows Firewall enabled)
New-NetFirewallRule -DisplayName "DataSync-HTTP" -Direction Inbound -LocalPort 80 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "DataSync-Agent" -Direction Inbound -LocalPort 1024-1064 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "DataSync-Activation" -Direction Outbound -RemoteAddress 52.94.0.0/16 -Protocol TCP -Action Allow
```

### NAS Access Credentials

Store NAS credentials securely:
- Use AWS Secrets Manager for SMB credentials
- Configure DataSync to retrieve credentials from Secrets Manager
- Rotate credentials regularly

---

## Conclusion

Your Hyper-V setup provides **superior performance and manageability** compared to VMware Player for this use case. The 64GB RAM system is well-suited for running DataSync Agent 24/7 with dynamic memory allocation.

**Key Advantages:**
✅ Native Windows integration
✅ Better resource efficiency with Dynamic Memory
✅ Production-grade hypervisor for 24/7 operation
✅ No additional licensing costs
✅ PowerShell automation capabilities

**Next:** Run the automated setup scripts to deploy your DataSync Agent.
