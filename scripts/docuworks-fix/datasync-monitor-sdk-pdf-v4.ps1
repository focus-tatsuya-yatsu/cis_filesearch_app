# ========================================
# DocuWorks Upload Script v4 - Fixed Version
# ========================================
# CRITICAL FIX: This version uploads BOTH:
#   1. Original .xdw files to documents/ (for indexing with DocuWorks filter)
#   2. Converted PDFs to docuworks-converted/ (for preview only)
#
# Previous versions (v3 and earlier) only uploaded PDFs, which caused
# DocuWorks files to not appear when using the DocuWorks file type filter.
# ========================================

param(
    [string]$ConfigPath = "C:\CIS-FileSearch\config\datasync-config.json",
    [switch]$TestMode,
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"

# ========================================
# Configuration
# ========================================
$config = @{
    # AWS Settings
    AWS_PROFILE = "AdministratorAccess-770923989980"
    AWS_REGION = "ap-northeast-1"
    S3_BUCKET = "cis-filesearch-s3-landing"
    SQS_QUEUE_URL = "https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-queue"

    # Paths
    INCOMING_FOLDER = "C:\CIS-FileSearch\incoming"
    PROCESSED_FOLDER = "C:\CIS-FileSearch\processed"
    ERROR_FOLDER = "C:\CIS-FileSearch\error"
    LOG_FOLDER = "C:\CIS-FileSearch\logs"
    TEMP_FOLDER = "C:\CIS-FileSearch\temp"

    # Category/Server Mapping
    # ts-server7 = structure category
    CATEGORY = "structure"
    NAS_SERVER = "ts-server7"
}

# ========================================
# Logging Functions
# ========================================
function Write-Log {
    param(
        [string]$Message,
        [string]$Level = "INFO"
    )

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"

    # Console output with colors
    switch ($Level) {
        "ERROR" { Write-Host $logMessage -ForegroundColor Red }
        "WARNING" { Write-Host $logMessage -ForegroundColor Yellow }
        "SUCCESS" { Write-Host $logMessage -ForegroundColor Green }
        default { Write-Host $logMessage -ForegroundColor Cyan }
    }

    # File logging
    $logFile = Join-Path $config.LOG_FOLDER "datasync-monitor-$(Get-Date -Format 'yyyyMMdd').log"
    Add-Content -Path $logFile -Value $logMessage
}

# ========================================
# AWS S3 Upload Function
# ========================================
function Upload-ToS3 {
    param(
        [string]$LocalPath,
        [string]$S3Key,
        [hashtable]$Metadata = @{}
    )

    try {
        Write-Log "Uploading to S3: $LocalPath -> s3://$($config.S3_BUCKET)/$S3Key"

        # Build metadata string for AWS CLI
        $metadataArgs = @()
        if ($Metadata.Count -gt 0) {
            $metadataString = ($Metadata.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ","
            $metadataArgs = @("--metadata", $metadataString)
        }

        # Use AWS CLI with configured profile
        $env:AWS_PROFILE = $config.AWS_PROFILE
        $env:AWS_DEFAULT_REGION = $config.AWS_REGION

        $uploadArgs = @(
            "s3", "cp",
            $LocalPath,
            "s3://$($config.S3_BUCKET)/$S3Key"
        ) + $metadataArgs

        $result = & aws @uploadArgs 2>&1

        if ($LASTEXITCODE -ne 0) {
            throw "AWS CLI upload failed: $result"
        }

        Write-Log "Successfully uploaded: s3://$($config.S3_BUCKET)/$S3Key" "SUCCESS"
        return $true
    }
    catch {
        Write-Log "Failed to upload to S3: $_" "ERROR"
        return $false
    }
}

# ========================================
# SQS Notification Function
# ========================================
function Send-SQSNotification {
    param(
        [string]$S3Key,
        [string]$FileName,
        [long]$FileSize,
        [string]$FileExtension
    )

    try {
        Write-Log "Sending SQS notification for: $S3Key"

        # Create message body for the Python worker
        # IMPORTANT: The S3Key should point to the ORIGINAL file (documents/...)
        # NOT the converted PDF (docuworks-converted/...)
        $messageBody = @{
            eventType = "S3_OBJECT_CREATED"
            s3Bucket = $config.S3_BUCKET
            s3Key = $S3Key
            fileName = $FileName
            fileSize = $FileSize
            fileExtension = $FileExtension
            eventTime = (Get-Date -Format "o")
            processingRequired = $true
            source = "docuworks-converter"
            nasServer = $config.NAS_SERVER
            category = $config.CATEGORY
        } | ConvertTo-Json -Compress

        $env:AWS_PROFILE = $config.AWS_PROFILE
        $env:AWS_DEFAULT_REGION = $config.AWS_REGION

        $result = & aws sqs send-message `
            --queue-url $config.SQS_QUEUE_URL `
            --message-body $messageBody `
            2>&1

        if ($LASTEXITCODE -ne 0) {
            throw "AWS CLI SQS send failed: $result"
        }

        Write-Log "SQS notification sent successfully" "SUCCESS"
        return $true
    }
    catch {
        Write-Log "Failed to send SQS notification: $_" "ERROR"
        return $false
    }
}

# ========================================
# DocuWorks to PDF Conversion (using SDK)
# ========================================
function Convert-DocuWorksToPdf {
    param(
        [string]$XdwPath,
        [string]$OutputPdfPath
    )

    try {
        Write-Log "Converting DocuWorks to PDF: $XdwPath"

        # Check if DocuWorks SDK is available
        $docuworksPath = "C:\Program Files\Fuji Xerox\DocuWorks\bin\dwdocprint.exe"

        if (Test-Path $docuworksPath) {
            # Use DocuWorks SDK for conversion
            & $docuworksPath -p "Microsoft Print to PDF" -o $OutputPdfPath $XdwPath

            if (Test-Path $OutputPdfPath) {
                Write-Log "Conversion successful: $OutputPdfPath" "SUCCESS"
                return $true
            }
        }

        # Fallback: Use alternative conversion method
        Write-Log "Using alternative conversion method..." "WARNING"

        # Alternative: Copy as-is for now (you may need to implement your preferred method)
        # This is a placeholder - implement your actual conversion logic

        return $false
    }
    catch {
        Write-Log "Failed to convert DocuWorks to PDF: $_" "ERROR"
        return $false
    }
}

# ========================================
# Process Single File - FIXED VERSION
# ========================================
function Process-DocuWorksFile {
    param(
        [string]$XdwPath
    )

    $fileName = [System.IO.Path]::GetFileName($XdwPath)
    $fileNameWithoutExt = [System.IO.Path]::GetFileNameWithoutExtension($XdwPath)
    $fileExtension = [System.IO.Path]::GetExtension($XdwPath).ToLower()
    $fileSize = (Get-Item $XdwPath).Length

    Write-Log "="*60
    Write-Log "Processing: $fileName"
    Write-Log "Size: $([math]::Round($fileSize / 1KB, 2)) KB"

    try {
        # Extract metadata from filename (format: ts-server7_rootFolder_subpath_filename.xdw)
        # Or extract from .meta file if available
        $metaFilePath = $XdwPath + ".meta"
        $rootFolder = "unknown"
        $subPath = ""

        if (Test-Path $metaFilePath) {
            $metadata = Get-Content $metaFilePath | ConvertFrom-Json
            $rootFolder = $metadata.rootFolder
            $subPath = $metadata.relativePath
            Write-Log "Loaded metadata from .meta file"
        }
        else {
            # Parse from filename convention
            # Expected: ts-server7_R05_JOB_subpath_filename.xdw
            if ($fileName -match "^ts-server\d+_([^_]+)_(.+)$") {
                $rootFolder = $Matches[1]
                $remainingPath = $Matches[2]
                Write-Log "Parsed metadata from filename: rootFolder=$rootFolder"
            }
        }

        # ========================================
        # CRITICAL FIX: Upload BOTH files
        # ========================================

        # 1. Build S3 key for ORIGINAL DocuWorks file
        #    This goes to documents/ for proper indexing
        $originalS3Key = "documents/$($config.CATEGORY)/$($config.NAS_SERVER)/$rootFolder"
        if ($subPath) {
            $originalS3Key += "/$subPath"
        }
        $originalS3Key += "/$fileName"

        Write-Log "Original file S3 key: $originalS3Key"

        # 2. Upload ORIGINAL DocuWorks file first
        Write-Log "Step 1: Uploading original DocuWorks file..."
        $originalUploaded = Upload-ToS3 -LocalPath $XdwPath -S3Key $originalS3Key -Metadata @{
            "original-filename" = $fileName
            "nas-server" = $config.NAS_SERVER
            "category" = $config.CATEGORY
            "root-folder" = $rootFolder
        }

        if (-not $originalUploaded) {
            throw "Failed to upload original DocuWorks file"
        }

        # 3. Convert to PDF for preview
        $pdfFileName = "$fileNameWithoutExt.pdf"
        $tempPdfPath = Join-Path $config.TEMP_FOLDER $pdfFileName

        Write-Log "Step 2: Converting to PDF for preview..."
        $converted = Convert-DocuWorksToPdf -XdwPath $XdwPath -OutputPdfPath $tempPdfPath

        if ($converted -and (Test-Path $tempPdfPath)) {
            # 4. Build S3 key for converted PDF (preview only)
            $pdfS3Key = "docuworks-converted/$($config.CATEGORY)/$($config.NAS_SERVER)/$rootFolder"
            if ($subPath) {
                $pdfS3Key += "/$subPath"
            }
            $pdfS3Key += "/$pdfFileName"

            Write-Log "Step 3: Uploading converted PDF for preview..."
            $pdfUploaded = Upload-ToS3 -LocalPath $tempPdfPath -S3Key $pdfS3Key -Metadata @{
                "original-xdw-filename" = $fileName
                "conversion-source" = "docuworks-sdk"
                "preview-only" = "true"
            }

            if ($pdfUploaded) {
                Write-Log "PDF uploaded for preview: $pdfS3Key" "SUCCESS"
            }

            # Cleanup temp PDF
            Remove-Item $tempPdfPath -Force -ErrorAction SilentlyContinue
        }
        else {
            Write-Log "PDF conversion skipped or failed - original DocuWorks file still uploaded" "WARNING"
        }

        # 5. Send SQS notification for the ORIGINAL file (not PDF)
        #    This ensures the Python worker indexes the .xdw file
        Write-Log "Step 4: Sending SQS notification for indexing..."
        $notified = Send-SQSNotification `
            -S3Key $originalS3Key `
            -FileName $fileName `
            -FileSize $fileSize `
            -FileExtension $fileExtension

        if (-not $notified) {
            throw "Failed to send SQS notification"
        }

        # 6. Move to processed folder
        $processedPath = Join-Path $config.PROCESSED_FOLDER $fileName
        Move-Item -Path $XdwPath -Destination $processedPath -Force

        # Also move meta file if exists
        if (Test-Path $metaFilePath) {
            $processedMetaPath = Join-Path $config.PROCESSED_FOLDER ($fileName + ".meta")
            Move-Item -Path $metaFilePath -Destination $processedMetaPath -Force
        }

        Write-Log "Successfully processed: $fileName" "SUCCESS"
        return $true
    }
    catch {
        Write-Log "Error processing $fileName`: $_" "ERROR"

        # Move to error folder
        $errorPath = Join-Path $config.ERROR_FOLDER $fileName
        Move-Item -Path $XdwPath -Destination $errorPath -Force -ErrorAction SilentlyContinue

        # Write error log
        $errorLogPath = Join-Path $config.ERROR_FOLDER "$fileNameWithoutExt.error.txt"
        @"
File: $fileName
Error: $_
Time: $(Get-Date -Format "o")
"@ | Set-Content $errorLogPath

        return $false
    }
}

# ========================================
# Main Monitoring Loop
# ========================================
function Start-Monitoring {
    Write-Log "="*60
    Write-Log "DocuWorks Upload Monitor v4 - FIXED VERSION"
    Write-Log "="*60
    Write-Log "IMPORTANT: This version uploads BOTH original .xdw AND converted PDF"
    Write-Log "  - Original .xdw -> documents/ (for DocuWorks filter)"
    Write-Log "  - Converted PDF -> docuworks-converted/ (for preview)"
    Write-Log "="*60
    Write-Log "Monitoring folder: $($config.INCOMING_FOLDER)"
    Write-Log "Category: $($config.CATEGORY)"
    Write-Log "NAS Server: $($config.NAS_SERVER)"
    Write-Log "="*60

    # Ensure folders exist
    @(
        $config.INCOMING_FOLDER,
        $config.PROCESSED_FOLDER,
        $config.ERROR_FOLDER,
        $config.LOG_FOLDER,
        $config.TEMP_FOLDER
    ) | ForEach-Object {
        if (-not (Test-Path $_)) {
            New-Item -ItemType Directory -Path $_ -Force | Out-Null
            Write-Log "Created folder: $_"
        }
    }

    $processedCount = 0
    $errorCount = 0

    while ($true) {
        # Get all .xdw and .xbd files in incoming folder
        $files = Get-ChildItem -Path $config.INCOMING_FOLDER -Filter "*.xdw" -File
        $files += Get-ChildItem -Path $config.INCOMING_FOLDER -Filter "*.xbd" -File

        if ($files.Count -gt 0) {
            Write-Log "Found $($files.Count) DocuWorks file(s) to process"

            foreach ($file in $files) {
                $success = Process-DocuWorksFile -XdwPath $file.FullName

                if ($success) {
                    $processedCount++
                }
                else {
                    $errorCount++
                }

                # Small delay between files
                Start-Sleep -Milliseconds 500
            }

            Write-Log "Batch complete. Total processed: $processedCount, Errors: $errorCount"
        }

        # Wait before next scan
        Start-Sleep -Seconds 5
    }
}

# ========================================
# Entry Point
# ========================================
if ($TestMode) {
    Write-Log "TEST MODE - Running single file test"

    $testFile = Get-ChildItem -Path $config.INCOMING_FOLDER -Filter "*.xdw" -File | Select-Object -First 1
    if ($testFile) {
        Process-DocuWorksFile -XdwPath $testFile.FullName
    }
    else {
        Write-Log "No .xdw files found in $($config.INCOMING_FOLDER)" "WARNING"
    }
}
else {
    Start-Monitoring
}
