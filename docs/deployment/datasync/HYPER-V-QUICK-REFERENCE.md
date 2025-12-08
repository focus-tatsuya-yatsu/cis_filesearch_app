# AWS DataSync on Hyper-V - Quick Reference Guide

## Quick Start (3 Steps)

### Option 1: Automated Setup (Recommended)

```powershell
# Run as Administrator
cd C:\path\to\scripts
.\0-Complete-Setup.ps1
```

This runs all setup steps automatically.

---

### Option 2: Manual Step-by-Step

```powershell
# Step 1: Download VHDX
.\1-Download-DataSync-Agent.ps1

# Step 2: Create VM
.\2-Create-DataSync-VM.ps1

# Step 3: Start VM
.\3-Start-And-Monitor.ps1

# Step 4: Health Check
.\4-Health-Check.ps1 -Detailed
```

---

## Common Commands

### VM Management

```powershell
# Start VM
Start-VM -Name "AWS-DataSync-Agent"

# Stop VM
Stop-VM -Name "AWS-DataSync-Agent"

# Get VM status
Get-VM -Name "AWS-DataSync-Agent"

# Connect to console
vmconnect.exe localhost "AWS-DataSync-Agent"
```

### Get VM IP Address

```powershell
Get-VMNetworkAdapter -VMName "AWS-DataSync-Agent" | Select-Object IPAddresses
```

### Monitor Performance

```powershell
# Real-time monitoring
.\3-Start-And-Monitor.ps1 -ContinuousMonitoring

# Quick status check
Get-VM -Name "AWS-DataSync-Agent" | Select-Object Name, State, CPUUsage, MemoryAssigned, Uptime
```

### Resource Metrics

```powershell
# Enable metering
Enable-VMResourceMetering -VMName "AWS-DataSync-Agent"

# View metrics
Measure-VM -VMName "AWS-DataSync-Agent"
```

---

## Troubleshooting Quick Fixes

### VM Won't Start

```powershell
# Check VM configuration
Get-VM -Name "AWS-DataSync-Agent" | Format-List *

# Check Hyper-V service
Get-Service vmms | Restart-Service

# Verify VHDX integrity
Test-VHD -Path "C:\Hyper-V\Virtual Machines\AWS-DataSync-Agent\AWS-DataSync-Agent.vhdx"
```

### No IP Address

```powershell
# Check virtual switch
Get-VMSwitch | Format-List *

# Recreate network adapter
$vm = "AWS-DataSync-Agent"
Remove-VMNetworkAdapter -VMName $vm
Add-VMNetworkAdapter -VMName $vm -SwitchName "External-Switch"

# Or connect to console and configure manually
vmconnect.exe localhost "AWS-DataSync-Agent"
```

### Cannot Access Web Interface

```powershell
# Get current IP
$ip = (Get-VMNetworkAdapter -VMName "AWS-DataSync-Agent").IPAddresses[0]

# Test connectivity
Test-NetConnection -ComputerName $ip -Port 80

# Check Windows Firewall
Get-NetFirewallRule | Where-Object {$_.DisplayName -like "*Hyper-V*"}

# Connect to console directly
vmconnect.exe localhost "AWS-DataSync-Agent"
```

### Poor Performance

```powershell
# Increase memory
Set-VMMemory -VMName "AWS-DataSync-Agent" -StartupBytes 24GB -MinimumBytes 16GB -MaximumBytes 40GB

# Add more CPUs
Set-VMProcessor -VMName "AWS-DataSync-Agent" -Count 6

# Remove bandwidth limit
Set-VMNetworkAdapter -VMName "AWS-DataSync-Agent" -MaximumBandwidth 0
```

---

## Configuration Files

### VM Specifications (Default)

```
Name: AWS-DataSync-Agent
Memory: 16GB startup (8GB min, 32GB max, dynamic)
CPU: 4 cores
Network: 100Mbps bandwidth limit
Disk: ~8GB VHDX (dynamic expansion)
Generation: 1
```

### Network Requirements

```
NAS IP Range: 192.168.1.212 - 192.168.1.218
Protocol: SMB (Port 445)
Virtual Switch: External-Switch
Bandwidth: 100Mbps
```

---

## Performance Expectations

### 100Mbps Bandwidth

| Metric | Value |
|--------|-------|
| Theoretical Max | 12.5 MB/s |
| Realistic Throughput | 8-10 MB/s |
| Daily Transfer | 700-850 GB/day |
| 8TB Transfer Time | 10-12 days |

### Resource Usage Targets

| Resource | Normal | Peak | Alert |
|----------|--------|------|-------|
| CPU | 20-40% | 60-80% | >90% |
| Memory | 12-16GB | 20-24GB | >28GB |
| Network | 50-70Mbps | 90-100Mbps | <10Mbps |

---

## AWS Activation URLs

### Web Interface
```
http://<VM-IP-ADDRESS>
```

### AWS Console
```
https://console.aws.amazon.com/datasync/
```

### Activation Steps
1. Access VM web interface
2. Copy activation key
3. Open AWS DataSync Console
4. Create agent → Enter key
5. Configure DataSync task

---

## Script Parameters

### 0-Complete-Setup.ps1
```powershell
.\0-Complete-Setup.ps1 `
    -VMName "AWS-DataSync-Agent" `
    -MemoryStartupGB 16 `
    -ProcessorCount 4 `
    -SkipDownload           # Optional: skip download
    -SkipVMCreation         # Optional: skip VM creation
```

### 2-Create-DataSync-VM.ps1
```powershell
.\2-Create-DataSync-VM.ps1 `
    -VMName "AWS-DataSync-Agent" `
    -VMPath "C:\Hyper-V\Virtual Machines" `
    -MemoryStartupGB 16 `
    -MemoryMinimumGB 8 `
    -MemoryMaximumGB 32 `
    -ProcessorCount 4 `
    -SwitchName "External-Switch"
```

### 4-Health-Check.ps1
```powershell
.\4-Health-Check.ps1 `
    -VMName "AWS-DataSync-Agent" `
    -Detailed               # Show detailed info
    -ExportReport           # Export JSON report
```

---

## File Locations

### Default Paths
```
Download Directory: C:\DataSync-Setup\
VM Directory: C:\Hyper-V\Virtual Machines\AWS-DataSync-Agent\
VHDX File: C:\Hyper-V\Virtual Machines\AWS-DataSync-Agent\AWS-DataSync-Agent.vhdx
Config File: C:\DataSync-Setup\config.json
Health Reports: C:\DataSync-Setup\health-report-*.json
```

---

## Checkpoints (Snapshots)

### Create Checkpoint
```powershell
Checkpoint-VM -Name "AWS-DataSync-Agent" -SnapshotName "Before-Configuration"
```

### List Checkpoints
```powershell
Get-VMCheckpoint -VMName "AWS-DataSync-Agent"
```

### Restore Checkpoint
```powershell
Restore-VMCheckpoint -Name "Before-Configuration" -VMName "AWS-DataSync-Agent" -Confirm:$false
```

### Remove Checkpoint
```powershell
Remove-VMCheckpoint -Name "Before-Configuration" -VMName "AWS-DataSync-Agent"
```

---

## Backup and Export

### Export VM
```powershell
Export-VM -Name "AWS-DataSync-Agent" -Path "D:\Hyper-V-Backups\DataSync"
```

### Compressed Backup
```powershell
$exportPath = "D:\Hyper-V-Backups\DataSync"
Export-VM -Name "AWS-DataSync-Agent" -Path $exportPath
Compress-Archive -Path "$exportPath\*" -DestinationPath "D:\Backups\DataSync-$(Get-Date -Format 'yyyy-MM-dd').zip"
```

### Import VM
```powershell
Import-VM -Path "D:\Hyper-V-Backups\DataSync\AWS-DataSync-Agent\Virtual Machines\*.vmcx"
```

---

## Integration Services

### Enable All Services
```powershell
$services = @(
    "Guest Service Interface",
    "Heartbeat",
    "Key-Value Pair Exchange",
    "Shutdown",
    "Time Synchronization",
    "VSS"
)

foreach ($service in $services) {
    Enable-VMIntegrationService -VMName "AWS-DataSync-Agent" -Name $service
}
```

### Check Service Status
```powershell
Get-VMIntegrationService -VMName "AWS-DataSync-Agent"
```

---

## Network Configuration

### Create External Switch
```powershell
$adapter = Get-NetAdapter | Where-Object {$_.Status -eq "Up"} | Select-Object -First 1
New-VMSwitch -Name "External-Switch" -NetAdapterName $adapter.Name -AllowManagementOS $true
```

### Change VM Network
```powershell
Connect-VMNetworkAdapter -VMName "AWS-DataSync-Agent" -SwitchName "External-Switch"
```

### Set Bandwidth Limit
```powershell
# 100 Mbps
Set-VMNetworkAdapter -VMName "AWS-DataSync-Agent" -MaximumBandwidth 100000000

# Unlimited
Set-VMNetworkAdapter -VMName "AWS-DataSync-Agent" -MaximumBandwidth 0
```

---

## NAS Connectivity Test

### Test from Host
```powershell
# Test ping
212..218 | ForEach-Object {
    $ip = "192.168.1.$_"
    if (Test-Connection $ip -Count 1 -Quiet) {
        Write-Host "✓ $ip reachable" -ForegroundColor Green
    }
}

# Test SMB port
Test-NetConnection -ComputerName "192.168.1.212" -Port 445
```

---

## Event Logs

### Check Hyper-V Logs
```powershell
# Recent errors
Get-WinEvent -LogName "Microsoft-Windows-Hyper-V-Worker-Admin" -MaxEvents 20 | Where-Object {$_.LevelDisplayName -eq "Error"}

# Specific VM events
Get-WinEvent -LogName "Microsoft-Windows-Hyper-V-Worker-Admin" | Where-Object {$_.Message -like "*DataSync*"}
```

---

## Auto-Start Configuration

### Configure Auto-Start
```powershell
# Start VM when host boots
Set-VM -Name "AWS-DataSync-Agent" -AutomaticStartAction Start

# Delay before auto-start (seconds)
Set-VM -Name "AWS-DataSync-Agent" -AutomaticStartDelay 30

# Stop action when host shuts down
Set-VM -Name "AWS-DataSync-Agent" -AutomaticStopAction ShutDown
```

---

## Performance Tuning

### Host Optimization
```powershell
# High performance power plan
powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c

# Disable hibernation
powercfg /hibernate off

# Disable Windows Search (optional)
Stop-Service WSearch
Set-Service WSearch -StartupType Disabled
```

### VM Optimization
```powershell
# Disable checkpoints
Set-VM -Name "AWS-DataSync-Agent" -AutomaticCheckpointsEnabled $false

# Set processor reserve
Set-VMProcessor -VMName "AWS-DataSync-Agent" -Reserve 10 -Maximum 75

# Enable NUMA spanning (for large VMs)
Set-VMProcessor -VMName "AWS-DataSync-Agent" -ExposeVirtualizationExtensions $true
```

---

## Security

### Firewall Rules
```powershell
# Allow DataSync ports
New-NetFirewallRule -DisplayName "DataSync-HTTP" -Direction Inbound -LocalPort 80 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "DataSync-Agent" -Direction Inbound -LocalPort 1024-1064 -Protocol TCP -Action Allow
```

### Secure VM Access
```powershell
# Enable Enhanced Session Mode
Set-VMHost -EnableEnhancedSessionMode $true
```

---

## Resource Limits

### Set CPU Reserve/Limit
```powershell
Set-VMProcessor -VMName "AWS-DataSync-Agent" `
    -Reserve 10 `         # Minimum 10% guaranteed
    -Maximum 75           # Maximum 75% usage
```

### Set Memory Limits
```powershell
Set-VMMemory -VMName "AWS-DataSync-Agent" `
    -DynamicMemoryEnabled $true `
    -MinimumBytes 8GB `
    -StartupBytes 16GB `
    -MaximumBytes 32GB `
    -Priority 80
```

---

## Useful One-Liners

```powershell
# Quick status
Get-VM "AWS-DataSync-Agent" | Select Name,State,CPUUsage,@{N='MemGB';E={[math]::Round($_.MemoryAssigned/1GB,2)}},Uptime

# Get all VM info
Get-VM "AWS-DataSync-Agent" | Format-List *

# Force shutdown
Stop-VM "AWS-DataSync-Agent" -Force -TurnOff

# Reset VM
Restart-VM "AWS-DataSync-Agent" -Force

# Clone VHDX
Copy-Item "C:\...\original.vhdx" "C:\...\clone.vhdx"

# Compact VHDX
Optimize-VHD -Path "C:\...\AWS-DataSync-Agent.vhdx" -Mode Full
```

---

## Support and Documentation

### Official AWS Resources
- DataSync Documentation: https://docs.aws.amazon.com/datasync/
- Hyper-V Requirements: https://docs.aws.amazon.com/datasync/latest/userguide/deploy-agents.html

### Microsoft Hyper-V
- Hyper-V PowerShell: https://docs.microsoft.com/powershell/module/hyper-v/
- Hyper-V Best Practices: https://docs.microsoft.com/windows-server/virtualization/hyper-v/

### Troubleshooting
- AWS DataSync Troubleshooting: https://docs.aws.amazon.com/datasync/latest/userguide/troubleshooting.html
- Hyper-V Event Logs: Event Viewer → Applications and Services Logs → Microsoft → Windows → Hyper-V-Worker

---

## Emergency Recovery

### VM Won't Start - Full Reset

```powershell
# 1. Stop all processes
Stop-VM "AWS-DataSync-Agent" -Force -TurnOff

# 2. Restart Hyper-V service
Restart-Service vmms

# 3. Check VHDX
Test-VHD -Path "C:\Hyper-V\Virtual Machines\AWS-DataSync-Agent\AWS-DataSync-Agent.vhdx"

# 4. Restore from checkpoint if needed
Restore-VMCheckpoint -Name "Initial-Configuration" -VMName "AWS-DataSync-Agent" -Confirm:$false

# 5. Start VM
Start-VM "AWS-DataSync-Agent"
```

### Recreate VM (Keep VHDX)

```powershell
# 1. Stop and remove VM (keeps VHDX)
Stop-VM "AWS-DataSync-Agent" -Force
Remove-VM "AWS-DataSync-Agent" -Force

# 2. Recreate with existing VHDX
.\2-Create-DataSync-VM.ps1
```

---

## Performance Monitoring Dashboard

```powershell
# Continuous monitoring with custom formatting
while ($true) {
    cls
    $vm = Get-VM "AWS-DataSync-Agent"
    $net = Get-VMNetworkAdapter -VMName "AWS-DataSync-Agent"

    Write-Host "DataSync Agent Monitor - $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor Cyan
    Write-Host "="*60

    Write-Host "Status    : " -NoNewline; Write-Host $vm.State -ForegroundColor $(if($vm.State -eq "Running"){"Green"}else{"Red"})
    Write-Host "Uptime    : " -NoNewline; Write-Host $vm.Uptime
    Write-Host "CPU       : " -NoNewline; Write-Host "$($vm.CPUUsage)%" -ForegroundColor $(if($vm.CPUUsage -gt 80){"Red"}elseif($vm.CPUUsage -gt 50){"Yellow"}else{"Green"})
    Write-Host "Memory    : " -NoNewline; Write-Host "$([math]::Round($vm.MemoryAssigned/1GB,2)) GB"
    Write-Host "Network   : " -NoNewline; Write-Host $net.Status -ForegroundColor $(if($net.Status -eq "Ok"){"Green"}else{"Red"})
    Write-Host "IP        : " -NoNewline; Write-Host $(if($net.IPAddresses){$net.IPAddresses[0]}else{"Pending"})

    Start-Sleep 3
}
```

---

**Quick Help:** For detailed information, refer to `HYPER-V-DATASYNC-SETUP.md`
