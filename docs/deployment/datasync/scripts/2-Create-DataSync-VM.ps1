# ========================================
# AWS DataSync Agent - VM Creation Script
# ========================================
# Creates optimized Hyper-V VM for DataSync Agent
# Configured for: 64GB RAM host, 8TB NAS transfer, 100Mbps bandwidth
#
# Usage: .\2-Create-DataSync-VM.ps1
# ========================================

#Requires -RunAsAdministrator

[CmdletBinding()]
param(
    [string]$VMName = "AWS-DataSync-Agent",
    [string]$ConfigPath = "C:\DataSync-Setup\config.json",
    [string]$VMPath = "C:\Hyper-V\Virtual Machines",
    [int64]$MemoryStartupGB = 16,
    [int64]$MemoryMinimumGB = 8,
    [int64]$MemoryMaximumGB = 32,
    [int]$ProcessorCount = 4,
    [string]$SwitchName = "External-Switch"
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
Write-Host "  AWS DataSync Agent - VM Creation" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Load configuration from previous script
Write-Info "Step 1: Loading configuration..."
if (Test-Path $ConfigPath) {
    $config = Get-Content $ConfigPath | ConvertFrom-Json
    $VHDXPath = $config.VHDXPath
    Write-Success "✓ Configuration loaded"
    Write-Host "  - VHDX: $VHDXPath" -ForegroundColor White
} else {
    Write-Warning "Configuration not found. Please provide VHDX path manually."
    $VHDXPath = Read-Host "Enter full path to DataSync Agent VHDX"
    if (-not (Test-Path $VHDXPath)) {
        Write-Error "✗ VHDX file not found: $VHDXPath"
        exit 1
    }
}

# Step 2: Verify Hyper-V is enabled
Write-Info "`nStep 2: Verifying Hyper-V installation..."
$hyperV = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V
if ($hyperV.State -ne "Enabled") {
    Write-Error "✗ Hyper-V is not enabled. Please enable Hyper-V first."
    Write-Host "Run: Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All" -ForegroundColor Yellow
    exit 1
}

$vmmsService = Get-Service vmms -ErrorAction SilentlyContinue
if ($vmmsService.Status -ne "Running") {
    Write-Error "✗ Hyper-V Virtual Machine Management service is not running"
    exit 1
}

Write-Success "✓ Hyper-V is enabled and running"

# Step 3: Check for existing VM
Write-Info "`nStep 3: Checking for existing VM..."
$existingVM = Get-VM -Name $VMName -ErrorAction SilentlyContinue
if ($existingVM) {
    Write-Warning "VM '$VMName' already exists!"
    Write-Host "Current state: $($existingVM.State)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Options:" -ForegroundColor Cyan
    Write-Host "  1. Remove and recreate VM" -ForegroundColor White
    Write-Host "  2. Keep existing VM and exit" -ForegroundColor White
    Write-Host ""
    $choice = Read-Host "Enter choice (1 or 2)"

    if ($choice -eq "1") {
        Write-Info "Removing existing VM..."
        if ($existingVM.State -eq "Running") {
            Stop-VM -Name $VMName -Force
            Write-Success "✓ VM stopped"
        }
        Remove-VM -Name $VMName -Force
        Write-Success "✓ VM removed"
    } else {
        Write-Info "Keeping existing VM. Exiting."
        exit 0
    }
}

# Step 4: Verify/Create Virtual Switch
Write-Info "`nStep 4: Checking virtual switch..."
$vSwitch = Get-VMSwitch -Name $SwitchName -ErrorAction SilentlyContinue

if (-not $vSwitch) {
    Write-Warning "Virtual switch '$SwitchName' not found. Creating external switch..."

    # Get active network adapter
    $netAdapters = Get-NetAdapter | Where-Object {
        $_.Status -eq "Up" -and
        $_.MediaType -eq "802.3" -and
        $_.Virtual -eq $false
    }

    if ($netAdapters.Count -eq 0) {
        Write-Error "✗ No active physical network adapter found"
        exit 1
    }

    Write-Host "`nAvailable network adapters:" -ForegroundColor Cyan
    $netAdapters | ForEach-Object -Begin { $i = 1 } -Process {
        Write-Host "  $i. $($_.Name) - $($_.InterfaceDescription)" -ForegroundColor White
        $i++
    }

    $adapterChoice = 1
    if ($netAdapters.Count -gt 1) {
        $adapterChoice = Read-Host "`nSelect adapter number (default: 1)"
        if ([string]::IsNullOrWhiteSpace($adapterChoice)) { $adapterChoice = 1 }
    }

    $selectedAdapter = $netAdapters[$adapterChoice - 1]
    Write-Info "Creating external switch using: $($selectedAdapter.Name)"

    try {
        New-VMSwitch `
            -Name $SwitchName `
            -NetAdapterName $selectedAdapter.Name `
            -AllowManagementOS $true `
            -Notes "External switch for AWS DataSync Agent - NAS access"

        Write-Success "✓ Virtual switch created: $SwitchName"
    } catch {
        Write-Error "✗ Failed to create virtual switch: $_"
        exit 1
    }
} else {
    Write-Success "✓ Virtual switch exists: $SwitchName ($($vSwitch.SwitchType))"
}

# Step 5: Create VM directory structure
Write-Info "`nStep 5: Creating VM directory structure..."
$vmDirectory = Join-Path $VMPath $VMName
try {
    New-Item -Path $vmDirectory -ItemType Directory -Force | Out-Null
    Write-Success "✓ VM directory created: $vmDirectory"
} catch {
    Write-Error "✗ Failed to create VM directory: $_"
    exit 1
}

# Step 6: Copy VHDX to VM directory
Write-Info "`nStep 6: Copying VHDX to VM directory..."
$vmVHDXPath = Join-Path $vmDirectory "$VMName.vhdx"

if (Test-Path $vmVHDXPath) {
    Write-Warning "VHDX already exists at destination. Using existing file."
} else {
    Write-Info "Copying VHDX (this may take several minutes)..."
    try {
        Copy-Item -Path $VHDXPath -Destination $vmVHDXPath -Force
        Write-Success "✓ VHDX copied to: $vmVHDXPath"
    } catch {
        Write-Error "✗ Failed to copy VHDX: $_"
        exit 1
    }
}

# Step 7: Create VM with optimal configuration
Write-Info "`nStep 7: Creating virtual machine..."
Write-Host "  - Name: $VMName" -ForegroundColor White
Write-Host "  - Memory: ${MemoryStartupGB}GB (Dynamic: ${MemoryMinimumGB}GB - ${MemoryMaximumGB}GB)" -ForegroundColor White
Write-Host "  - Processors: $ProcessorCount cores" -ForegroundColor White
Write-Host "  - Network: $SwitchName" -ForegroundColor White
Write-Host ""

try {
    # Create VM
    New-VM `
        -Name $VMName `
        -MemoryStartupBytes ($MemoryStartupGB * 1GB) `
        -Generation 1 `
        -VHDPath $vmVHDXPath `
        -Path $VMPath `
        -SwitchName $SwitchName | Out-Null

    Write-Success "✓ VM created successfully"

    # Configure Dynamic Memory (optimal for 64GB host)
    Write-Info "Configuring dynamic memory..."
    Set-VMMemory `
        -VMName $VMName `
        -DynamicMemoryEnabled $true `
        -MinimumBytes ($MemoryMinimumGB * 1GB) `
        -StartupBytes ($MemoryStartupGB * 1GB) `
        -MaximumBytes ($MemoryMaximumGB * 1GB) `
        -Priority 80 `
        -Buffer 20
    Write-Success "✓ Dynamic memory configured"

    # Configure Processor (25% of host resources for optimal balance)
    Write-Info "Configuring processor..."
    Set-VMProcessor `
        -VMName $VMName `
        -Count $ProcessorCount `
        -Reserve 10 `
        -Maximum 75 `
        -RelativeWeight 100
    Write-Success "✓ Processor configured"

    # Configure Network for 100Mbps bandwidth
    Write-Info "Configuring network adapter..."
    Set-VMNetworkAdapter `
        -VMName $VMName `
        -MacAddressSpoofing Off `
        -DhcpGuard Off `
        -RouterGuard Off `
        -AllowTeaming On

    # Set bandwidth limit (100 Mbps = 100,000,000 bps)
    Set-VMNetworkAdapter `
        -VMName $VMName `
        -MaximumBandwidth 100000000
    Write-Success "✓ Network adapter configured (100Mbps limit)"

    # Disable automatic checkpoints (not needed for DataSync)
    Write-Info "Configuring VM settings..."
    Set-VM -VMName $VMName -AutomaticCheckpointsEnabled $false
    Write-Success "✓ Automatic checkpoints disabled"

    # Configure for 24/7 operation
    Set-VM -VMName $VMName -AutomaticStartAction Start
    Set-VM -VMName $VMName -AutomaticStopAction ShutDown
    Set-VM -VMName $VMName -AutomaticStartDelay 30
    Write-Success "✓ 24/7 operation mode configured"

    # Enable Integration Services
    Write-Info "Enabling integration services..."
    $integrationServices = @(
        "Guest Service Interface",
        "Heartbeat",
        "Key-Value Pair Exchange",
        "Shutdown",
        "Time Synchronization",
        "VSS"
    )

    foreach ($service in $integrationServices) {
        Enable-VMIntegrationService -VMName $VMName -Name $service
    }
    Write-Success "✓ Integration services enabled"

    # Configure disk for optimal I/O (4K sector size)
    Write-Info "Optimizing disk I/O..."
    Set-VHD -Path $vmVHDXPath -PhysicalSectorSizeBytes 4096
    Write-Success "✓ Disk optimized (4K sectors)"

} catch {
    Write-Error "✗ Failed to configure VM: $_"
    # Cleanup on failure
    if (Get-VM -Name $VMName -ErrorAction SilentlyContinue) {
        Remove-VM -Name $VMName -Force
    }
    exit 1
}

# Step 8: Display VM configuration
Write-Host "`n" + "="*60 -ForegroundColor Green
Write-Host "VM CREATED SUCCESSFULLY" -ForegroundColor Green
Write-Host "="*60 -ForegroundColor Green
Write-Host ""

$vm = Get-VM -Name $VMName
$vmMemory = Get-VMMemory -VMName $VMName
$vmProcessor = Get-VMProcessor -VMName $VMName
$vmNetwork = Get-VMNetworkAdapter -VMName $VMName

Write-Host "VM Configuration Summary:" -ForegroundColor Cyan
Write-Host "-" * 60 -ForegroundColor Cyan
Write-Host "Name: $($vm.Name)" -ForegroundColor White
Write-Host "State: $($vm.State)" -ForegroundColor White
Write-Host "Generation: $($vm.Generation)" -ForegroundColor White
Write-Host ""
Write-Host "Memory:" -ForegroundColor Cyan
Write-Host "  - Dynamic Memory: $($vmMemory.DynamicMemoryEnabled)" -ForegroundColor White
Write-Host "  - Minimum: $($vmMemory.Minimum / 1GB) GB" -ForegroundColor White
Write-Host "  - Startup: $($vmMemory.Startup / 1GB) GB" -ForegroundColor White
Write-Host "  - Maximum: $($vmMemory.Maximum / 1GB) GB" -ForegroundColor White
Write-Host ""
Write-Host "Processor:" -ForegroundColor Cyan
Write-Host "  - Virtual CPUs: $($vmProcessor.Count)" -ForegroundColor White
Write-Host "  - Reserve: $($vmProcessor.Reserve)%" -ForegroundColor White
Write-Host "  - Maximum: $($vmProcessor.Maximum)%" -ForegroundColor White
Write-Host ""
Write-Host "Network:" -ForegroundColor Cyan
Write-Host "  - Switch: $($vmNetwork.SwitchName)" -ForegroundColor White
Write-Host "  - MAC Address: $($vmNetwork.MacAddress)" -ForegroundColor White
Write-Host "  - Bandwidth Limit: 100 Mbps" -ForegroundColor White
Write-Host ""
Write-Host "Storage:" -ForegroundColor Cyan
Write-Host "  - VHDX Path: $vmVHDXPath" -ForegroundColor White
$vhdInfo = Get-VHD -Path $vmVHDXPath
Write-Host "  - Disk Size: $([math]::Round($vhdInfo.Size / 1GB, 2)) GB" -ForegroundColor White
Write-Host "  - Format: $($vhdInfo.VhdFormat)" -ForegroundColor White
Write-Host ""

# Step 9: Create initial checkpoint
Write-Info "Creating initial checkpoint..."
try {
    Checkpoint-VM -Name $VMName -SnapshotName "Initial-Configuration-$(Get-Date -Format 'yyyy-MM-dd')"
    Write-Success "✓ Initial checkpoint created"
} catch {
    Write-Warning "Failed to create checkpoint: $_"
}

# Step 10: Update configuration file
Write-Info "`nUpdating configuration..."
$configData = if (Test-Path $ConfigPath) {
    Get-Content $ConfigPath | ConvertFrom-Json
} else {
    @{}
}

$configData | Add-Member -NotePropertyName "VMName" -NotePropertyValue $VMName -Force
$configData | Add-Member -NotePropertyName "VMPath" -NotePropertyValue $vmDirectory -Force
$configData | Add-Member -NotePropertyName "VMCreatedDate" -NotePropertyValue (Get-Date).ToString("yyyy-MM-dd HH:mm:ss") -Force
$configData | Add-Member -NotePropertyName "SwitchName" -NotePropertyValue $SwitchName -Force

$configData | ConvertTo-Json | Set-Content -Path $ConfigPath
Write-Success "✓ Configuration updated: $ConfigPath"

# Next steps
Write-Host "`n" + "="*60 -ForegroundColor Yellow
Write-Host "NEXT STEPS" -ForegroundColor Yellow
Write-Host "="*60 -ForegroundColor Yellow
Write-Host ""
Write-Host "1. Start the VM:" -ForegroundColor Cyan
Write-Host "   Start-VM -Name '$VMName'" -ForegroundColor White
Write-Host ""
Write-Host "2. Wait for VM to boot (60-90 seconds)" -ForegroundColor Cyan
Write-Host ""
Write-Host "3. Get VM IP address:" -ForegroundColor Cyan
Write-Host "   Get-VMNetworkAdapter -VMName '$VMName' | Select-Object IPAddresses" -ForegroundColor White
Write-Host ""
Write-Host "4. Access activation page:" -ForegroundColor Cyan
Write-Host "   http://<VM-IP-ADDRESS>" -ForegroundColor White
Write-Host ""
Write-Host "5. Activate agent in AWS Console:" -ForegroundColor Cyan
Write-Host "   https://console.aws.amazon.com/datasync/" -ForegroundColor White
Write-Host ""
Write-Host "Or run the next script: 3-Start-And-Monitor.ps1" -ForegroundColor Yellow
Write-Host ""
