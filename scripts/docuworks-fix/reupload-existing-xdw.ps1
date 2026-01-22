# ========================================
# Re-upload Existing DocuWorks Files Script
# ========================================
# This script re-uploads DocuWorks files that were incorrectly
# uploaded as PDFs only. It will:
#   1. Scan NAS for original .xdw files
#   2. Upload them to documents/ in S3
#   3. Send SQS notifications for reindexing
#
# Run this ONCE to fix existing ts-server7 DocuWorks files
# ========================================

param(
    [string]$NASPath = "\\ts-server7\share",
    [string]$RootFolders = "R05_JOB,R06_JOB,R07_JOB,H27_JOB,H28_JOB,H29_JOB,H30_JOB,R01_JOB,R02_JOB,R03_JOB,R04_JOB",
    [switch]$DryRun,
    [int]$BatchSize = 100,
    [int]$DelayMs = 200
)

$ErrorActionPreference = "Stop"

# ========================================
# Configuration
# ========================================
$config = @{
    AWS_PROFILE = "AdministratorAccess-770923989980"
    AWS_REGION = "ap-northeast-1"
    S3_BUCKET = "cis-filesearch-s3-landing"
    SQS_QUEUE_URL = "https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-queue"
    CATEGORY = "structure"
    NAS_SERVER = "ts-server7"
    LOG_FOLDER = "C:\CIS-FileSearch\logs"
}

# ========================================
# Logging
# ========================================
function Write-Log {
    param([string]$Message, [string]$Level = "INFO")

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"

    switch ($Level) {
        "ERROR" { Write-Host $logMessage -ForegroundColor Red }
        "WARNING" { Write-Host $logMessage -ForegroundColor Yellow }
        "SUCCESS" { Write-Host $logMessage -ForegroundColor Green }
        default { Write-Host $logMessage -ForegroundColor Cyan }
    }

    $logFile = Join-Path $config.LOG_FOLDER "reupload-xdw-$(Get-Date -Format 'yyyyMMdd').log"
    Add-Content -Path $logFile -Value $logMessage -ErrorAction SilentlyContinue
}

# ========================================
# Upload and Notify Function
# ========================================
function Upload-XdwFile {
    param(
        [string]$LocalPath,
        [string]$RelativePath
    )

    $fileName = [System.IO.Path]::GetFileName($LocalPath)
    $fileExtension = [System.IO.Path]::GetExtension($LocalPath).ToLower()
    $fileSize = (Get-Item $LocalPath).Length

    # Build S3 key
    $s3Key = "documents/$($config.CATEGORY)/$($config.NAS_SERVER)/$RelativePath"

    if ($DryRun) {
        Write-Log "[DRY RUN] Would upload: $LocalPath -> s3://$($config.S3_BUCKET)/$s3Key"
        return $true
    }

    try {
        # Set AWS environment
        $env:AWS_PROFILE = $config.AWS_PROFILE
        $env:AWS_DEFAULT_REGION = $config.AWS_REGION

        # Upload to S3
        $result = & aws s3 cp $LocalPath "s3://$($config.S3_BUCKET)/$s3Key" `
            --metadata "original-filename=$fileName,nas-server=$($config.NAS_SERVER),category=$($config.CATEGORY)" `
            2>&1

        if ($LASTEXITCODE -ne 0) {
            throw "Upload failed: $result"
        }

        # Send SQS notification
        $messageBody = @{
            eventType = "S3_OBJECT_CREATED"
            s3Bucket = $config.S3_BUCKET
            s3Key = $s3Key
            fileName = $fileName
            fileSize = $fileSize
            fileExtension = $fileExtension
            eventTime = (Get-Date -Format "o")
            processingRequired = $true
            source = "reupload-script"
            nasServer = $config.NAS_SERVER
            category = $config.CATEGORY
        } | ConvertTo-Json -Compress

        $sqsResult = & aws sqs send-message `
            --queue-url $config.SQS_QUEUE_URL `
            --message-body $messageBody `
            2>&1

        if ($LASTEXITCODE -ne 0) {
            Write-Log "SQS notification failed (file uploaded): $sqsResult" "WARNING"
        }

        Write-Log "Uploaded: $fileName" "SUCCESS"
        return $true
    }
    catch {
        Write-Log "Failed to upload $fileName`: $_" "ERROR"
        return $false
    }
}

# ========================================
# Main Script
# ========================================
Write-Log "="*60
Write-Log "Re-upload DocuWorks Files to S3"
Write-Log "="*60
Write-Log "NAS Path: $NASPath"
Write-Log "Category: $($config.CATEGORY)"
Write-Log "NAS Server: $($config.NAS_SERVER)"
if ($DryRun) { Write-Log "MODE: DRY RUN (no actual uploads)" "WARNING" }
Write-Log "="*60

$totalFiles = 0
$uploadedFiles = 0
$failedFiles = 0
$startTime = Get-Date

# Process each root folder
$folders = $RootFolders -split ","

foreach ($rootFolder in $folders) {
    $folderPath = Join-Path $NASPath $rootFolder.Trim()

    if (-not (Test-Path $folderPath)) {
        Write-Log "Folder not found: $folderPath" "WARNING"
        continue
    }

    Write-Log "Scanning: $folderPath"

    # Find all .xdw and .xbd files
    $xdwFiles = Get-ChildItem -Path $folderPath -Include "*.xdw", "*.xbd" -Recurse -File -ErrorAction SilentlyContinue

    Write-Log "Found $($xdwFiles.Count) DocuWorks files in $rootFolder"

    $batchCount = 0
    foreach ($file in $xdwFiles) {
        $totalFiles++

        # Calculate relative path from NAS root
        $relativePath = $file.FullName.Substring($NASPath.Length + 1).Replace("\", "/")

        $success = Upload-XdwFile -LocalPath $file.FullName -RelativePath $relativePath

        if ($success) {
            $uploadedFiles++
        }
        else {
            $failedFiles++
        }

        $batchCount++

        # Progress update every batch
        if ($batchCount -ge $BatchSize) {
            $elapsed = (Get-Date) - $startTime
            $rate = $totalFiles / $elapsed.TotalMinutes
            Write-Log "Progress: $totalFiles files processed ($([math]::Round($rate, 1)) files/min)"
            $batchCount = 0
        }

        # Small delay to avoid overwhelming AWS
        Start-Sleep -Milliseconds $DelayMs
    }
}

# Summary
$duration = (Get-Date) - $startTime
Write-Log "="*60
Write-Log "COMPLETE" "SUCCESS"
Write-Log "="*60
Write-Log "Total files found: $totalFiles"
Write-Log "Successfully uploaded: $uploadedFiles"
Write-Log "Failed: $failedFiles"
Write-Log "Duration: $([math]::Round($duration.TotalMinutes, 1)) minutes"
Write-Log "="*60

if ($DryRun) {
    Write-Log ""
    Write-Log "This was a DRY RUN. To actually upload, run without -DryRun flag:" "WARNING"
    Write-Log "  .\reupload-existing-xdw.ps1" "WARNING"
}
