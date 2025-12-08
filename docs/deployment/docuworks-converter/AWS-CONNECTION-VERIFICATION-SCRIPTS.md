# AWS Connection Verification Scripts

## Overview

This document provides ready-to-use scripts for verifying AWS connectivity and testing the DocuWorks converter integration.

## Prerequisites

```bash
# Ensure AWS CLI is installed
aws --version

# Configure AWS profile
aws configure --profile AdministratorAccess-770923989980
```

## 1. PowerShell Verification Scripts (Windows)

### 1.1 Complete AWS Connection Verifier

Save as `Verify-AwsConnections.ps1`:

```powershell
<#
.SYNOPSIS
    Verifies AWS connections for DocuWorks Converter service
.DESCRIPTION
    Tests S3, SQS, and CloudWatch connectivity with detailed diagnostics
.EXAMPLE
    .\Verify-AwsConnections.ps1 -Profile "AdministratorAccess-770923989980"
#>

param(
    [Parameter(Mandatory=$false)]
    [string]$Profile = "AdministratorAccess-770923989980",

    [Parameter(Mandatory=$false)]
    [string]$Region = "ap-northeast-1",

    [Parameter(Mandatory=$false)]
    [string]$S3Bucket = "cis-filesearch-s3-landing",

    [Parameter(Mandatory=$false)]
    [string]$SQSQueueUrl = "https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-queue"
)

# Colors for output
$script:SuccessColor = "Green"
$script:ErrorColor = "Red"
$script:InfoColor = "Cyan"
$script:WarningColor = "Yellow"

function Write-TestHeader {
    param([string]$Message)
    Write-Host "`n========================================" -ForegroundColor $InfoColor
    Write-Host " $Message" -ForegroundColor $InfoColor
    Write-Host "========================================`n" -ForegroundColor $InfoColor
}

function Write-TestResult {
    param(
        [bool]$Success,
        [string]$Message,
        [string]$Details = ""
    )

    if ($Success) {
        Write-Host "[✓] $Message" -ForegroundColor $SuccessColor
        if ($Details) {
            Write-Host "    $Details" -ForegroundColor Gray
        }
    } else {
        Write-Host "[✗] $Message" -ForegroundColor $ErrorColor
        if ($Details) {
            Write-Host "    $Details" -ForegroundColor $ErrorColor
        }
    }
}

function Test-AwsCliInstalled {
    Write-TestHeader "Checking Prerequisites"

    try {
        $version = aws --version 2>&1
        Write-TestResult -Success $true -Message "AWS CLI installed" -Details $version
        return $true
    } catch {
        Write-TestResult -Success $false -Message "AWS CLI not found" -Details "Please install AWS CLI v2"
        return $false
    }
}

function Test-AwsProfile {
    param([string]$ProfileName)

    Write-TestHeader "Verifying AWS Profile: $ProfileName"

    try {
        $identity = aws sts get-caller-identity --profile $ProfileName --output json 2>&1 | ConvertFrom-Json

        Write-TestResult -Success $true -Message "AWS Profile valid"
        Write-Host "    Account: $($identity.Account)" -ForegroundColor Gray
        Write-Host "    UserId: $($identity.UserId)" -ForegroundColor Gray
        Write-Host "    Arn: $($identity.Arn)" -ForegroundColor Gray

        return $true
    } catch {
        Write-TestResult -Success $false -Message "Failed to verify AWS profile" -Details $_.Exception.Message
        return $false
    }
}

function Test-S3BucketAccess {
    param(
        [string]$BucketName,
        [string]$ProfileName
    )

    Write-TestHeader "Testing S3 Bucket: $BucketName"

    # Test 1: Bucket exists
    try {
        $location = aws s3api get-bucket-location --bucket $BucketName --profile $ProfileName --output json 2>&1 | ConvertFrom-Json
        Write-TestResult -Success $true -Message "Bucket exists" -Details "Location: $($location.LocationConstraint)"
    } catch {
        Write-TestResult -Success $false -Message "Cannot access bucket" -Details $_.Exception.Message
        return $false
    }

    # Test 2: List objects (permission check)
    try {
        $objects = aws s3api list-objects-v2 --bucket $BucketName --max-items 1 --profile $ProfileName --output json 2>&1 | ConvertFrom-Json
        Write-TestResult -Success $true -Message "List permission granted" -Details "Can list objects"
    } catch {
        Write-TestResult -Success $false -Message "List permission denied" -Details $_.Exception.Message
        return $false
    }

    # Test 3: Upload test file
    $testFile = [System.IO.Path]::GetTempFileName()
    $testContent = "AWS Connection Test - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    Set-Content -Path $testFile -Value $testContent

    $testKey = "connection-test/test-$(Get-Date -Format 'yyyyMMdd-HHmmss').txt"

    try {
        aws s3 cp $testFile "s3://$BucketName/$testKey" --profile $ProfileName --no-progress 2>&1 | Out-Null
        Write-TestResult -Success $true -Message "Upload permission granted" -Details "Test file uploaded: $testKey"

        # Test 4: Download test file
        $downloadFile = [System.IO.Path]::GetTempFileName()
        aws s3 cp "s3://$BucketName/$testKey" $downloadFile --profile $ProfileName --no-progress 2>&1 | Out-Null

        $downloadedContent = Get-Content -Path $downloadFile -Raw
        if ($downloadedContent -eq $testContent) {
            Write-TestResult -Success $true -Message "Download verified" -Details "Content matches"
        } else {
            Write-TestResult -Success $false -Message "Download verification failed" -Details "Content mismatch"
        }

        # Cleanup
        Remove-Item -Path $downloadFile -Force -ErrorAction SilentlyContinue

        # Test 5: Delete test file
        aws s3 rm "s3://$BucketName/$testKey" --profile $ProfileName 2>&1 | Out-Null
        Write-TestResult -Success $true -Message "Delete permission granted" -Details "Test file cleaned up"

    } catch {
        Write-TestResult -Success $false -Message "Upload/Download test failed" -Details $_.Exception.Message
        return $false
    } finally {
        Remove-Item -Path $testFile -Force -ErrorAction SilentlyContinue
    }

    return $true
}

function Test-SQSQueueAccess {
    param(
        [string]$QueueUrl,
        [string]$ProfileName
    )

    Write-TestHeader "Testing SQS Queue: $QueueUrl"

    # Test 1: Get queue attributes
    try {
        $attributes = aws sqs get-queue-attributes --queue-url $QueueUrl --attribute-names All --profile $ProfileName --output json 2>&1 | ConvertFrom-Json

        Write-TestResult -Success $true -Message "Queue accessible"
        Write-Host "    Approximate Messages: $($attributes.Attributes.ApproximateNumberOfMessages)" -ForegroundColor Gray
        Write-Host "    Messages In Flight: $($attributes.Attributes.ApproximateNumberOfMessagesNotVisible)" -ForegroundColor Gray
        Write-Host "    Messages Delayed: $($attributes.Attributes.ApproximateNumberOfMessagesDelayed)" -ForegroundColor Gray

    } catch {
        Write-TestResult -Success $false -Message "Cannot access queue" -Details $_.Exception.Message
        return $false
    }

    # Test 2: Send test message
    $testMessage = @{
        type = "connection-test"
        timestamp = (Get-Date).ToUniversalTime().ToString("o")
        source = "PowerShell-Verification"
        machineName = $env:COMPUTERNAME
    } | ConvertTo-Json

    try {
        $sendResult = aws sqs send-message --queue-url $QueueUrl --message-body $testMessage --profile $ProfileName --output json 2>&1 | ConvertFrom-Json
        Write-TestResult -Success $true -Message "Send message permission granted" -Details "MessageId: $($sendResult.MessageId)"

        # Wait a bit for message to be available
        Start-Sleep -Seconds 2

        # Test 3: Receive message
        $receiveResult = aws sqs receive-message --queue-url $QueueUrl --max-number-of-messages 1 --wait-time-seconds 5 --profile $ProfileName --output json 2>&1 | ConvertFrom-Json

        if ($receiveResult.Messages) {
            Write-TestResult -Success $true -Message "Receive message permission granted" -Details "Retrieved test message"

            # Test 4: Delete message
            $receiptHandle = $receiveResult.Messages[0].ReceiptHandle
            aws sqs delete-message --queue-url $QueueUrl --receipt-handle $receiptHandle --profile $ProfileName 2>&1 | Out-Null
            Write-TestResult -Success $true -Message "Delete message permission granted" -Details "Test message cleaned up"
        } else {
            Write-TestResult -Success $false -Message "Could not receive test message" -Details "Message may have been processed by another consumer"
        }

    } catch {
        Write-TestResult -Success $false -Message "Message operations failed" -Details $_.Exception.Message
        return $false
    }

    return $true
}

function Test-CloudWatchLogsAccess {
    param([string]$ProfileName)

    Write-TestHeader "Testing CloudWatch Logs Access"

    try {
        $logGroups = aws logs describe-log-groups --max-items 1 --profile $ProfileName --output json 2>&1 | ConvertFrom-Json
        Write-TestResult -Success $true -Message "CloudWatch Logs accessible" -Details "Can describe log groups"
        return $true
    } catch {
        Write-TestResult -Success $false -Message "Cannot access CloudWatch Logs" -Details $_.Exception.Message
        return $false
    }
}

function Test-NetworkConnectivity {
    Write-TestHeader "Testing Network Connectivity"

    $endpoints = @(
        @{ Name = "S3 Endpoint"; Host = "s3.ap-northeast-1.amazonaws.com"; Port = 443 },
        @{ Name = "SQS Endpoint"; Host = "sqs.ap-northeast-1.amazonaws.com"; Port = 443 },
        @{ Name = "CloudWatch Logs"; Host = "logs.ap-northeast-1.amazonaws.com"; Port = 443 }
    )

    foreach ($endpoint in $endpoints) {
        try {
            $connection = Test-NetConnection -ComputerName $endpoint.Host -Port $endpoint.Port -WarningAction SilentlyContinue
            if ($connection.TcpTestSucceeded) {
                Write-TestResult -Success $true -Message "$($endpoint.Name)" -Details "Port $($endpoint.Port) reachable"
            } else {
                Write-TestResult -Success $false -Message "$($endpoint.Name)" -Details "Port $($endpoint.Port) not reachable"
            }
        } catch {
            Write-TestResult -Success $false -Message "$($endpoint.Name)" -Details $_.Exception.Message
        }
    }
}

function Measure-UploadPerformance {
    param(
        [string]$BucketName,
        [string]$ProfileName
    )

    Write-TestHeader "Performance Benchmarking"

    $fileSizes = @(
        @{ Size = 1MB; Name = "1MB" },
        @{ Size = 10MB; Name = "10MB" },
        @{ Size = 100MB; Name = "100MB" }
    )

    foreach ($fileSize in $fileSizes) {
        $testFile = [System.IO.Path]::GetTempFileName()

        try {
            # Create test file
            $stream = [System.IO.File]::Create($testFile)
            $stream.SetLength($fileSize.Size)
            $stream.Close()

            $testKey = "performance-test/$($fileSize.Name)-$(Get-Date -Format 'yyyyMMdd-HHmmss').dat"

            # Measure upload
            $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
            aws s3 cp $testFile "s3://$BucketName/$testKey" --profile $ProfileName --no-progress 2>&1 | Out-Null
            $stopwatch.Stop()

            $speedMbps = ($fileSize.Size / 1MB) / $stopwatch.Elapsed.TotalSeconds

            Write-Host "[$($fileSize.Name)] Upload completed in $($stopwatch.Elapsed.TotalSeconds.ToString('F2'))s" -ForegroundColor $InfoColor
            Write-Host "         Speed: $($speedMbps.ToString('F2')) MB/s" -ForegroundColor Gray

            # Cleanup
            aws s3 rm "s3://$BucketName/$testKey" --profile $ProfileName 2>&1 | Out-Null

        } catch {
            Write-Host "[$($fileSize.Name)] Performance test failed: $($_.Exception.Message)" -ForegroundColor $ErrorColor
        } finally {
            Remove-Item -Path $testFile -Force -ErrorAction SilentlyContinue
        }
    }
}

# Main execution
Write-Host "`n╔════════════════════════════════════════════════════════════╗" -ForegroundColor $InfoColor
Write-Host "║  DocuWorks Converter - AWS Connection Verification        ║" -ForegroundColor $InfoColor
Write-Host "╚════════════════════════════════════════════════════════════╝`n" -ForegroundColor $InfoColor

$results = @{
    Prerequisites = $false
    Profile = $false
    NetworkConnectivity = $false
    S3Access = $false
    SQSAccess = $false
    CloudWatchAccess = $false
}

# Run tests
$results.Prerequisites = Test-AwsCliInstalled
if (-not $results.Prerequisites) {
    Write-Host "`n[CRITICAL] Prerequisites not met. Please install AWS CLI." -ForegroundColor $ErrorColor
    exit 1
}

$results.Profile = Test-AwsProfile -ProfileName $Profile
if (-not $results.Profile) {
    Write-Host "`n[CRITICAL] AWS Profile verification failed." -ForegroundColor $ErrorColor
    exit 1
}

Test-NetworkConnectivity

$results.S3Access = Test-S3BucketAccess -BucketName $S3Bucket -ProfileName $Profile
$results.SQSAccess = Test-SQSQueueAccess -QueueUrl $SQSQueueUrl -ProfileName $Profile
$results.CloudWatchAccess = Test-CloudWatchLogsAccess -ProfileName $Profile

# Performance benchmarking (optional)
Write-Host "`nRun performance benchmarking? (y/N): " -ForegroundColor $WarningColor -NoNewline
$runPerf = Read-Host
if ($runPerf -eq 'y' -or $runPerf -eq 'Y') {
    Measure-UploadPerformance -BucketName $S3Bucket -ProfileName $Profile
}

# Summary
Write-TestHeader "Verification Summary"

$allPassed = $true
foreach ($result in $results.GetEnumerator()) {
    Write-TestResult -Success $result.Value -Message $result.Key
    $allPassed = $allPassed -and $result.Value
}

Write-Host ""
if ($allPassed) {
    Write-Host "✓ All verifications passed! AWS integration is ready." -ForegroundColor $SuccessColor
    exit 0
} else {
    Write-Host "✗ Some verifications failed. Please review the errors above." -ForegroundColor $ErrorColor
    exit 1
}
```

### 1.2 Quick Health Check Script

Save as `Quick-HealthCheck.ps1`:

```powershell
<#
.SYNOPSIS
    Quick health check for AWS services
.EXAMPLE
    .\Quick-HealthCheck.ps1
#>

param(
    [string]$Profile = "AdministratorAccess-770923989980",
    [string]$S3Bucket = "cis-filesearch-s3-landing",
    [string]$SQSQueueUrl = "https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-queue"
)

Write-Host "AWS Quick Health Check" -ForegroundColor Cyan
Write-Host "======================" -ForegroundColor Cyan

# S3 Check
Write-Host "`nS3 Bucket: " -NoNewline
try {
    $s3Result = aws s3 ls "s3://$S3Bucket" --profile $Profile --max-items 1 2>&1
    Write-Host "OK" -ForegroundColor Green
} catch {
    Write-Host "FAILED" -ForegroundColor Red
}

# SQS Check
Write-Host "SQS Queue: " -NoNewline
try {
    $sqsResult = aws sqs get-queue-attributes --queue-url $SQSQueueUrl --profile $Profile --attribute-names ApproximateNumberOfMessages --output json 2>&1 | ConvertFrom-Json
    $msgCount = $sqsResult.Attributes.ApproximateNumberOfMessages
    Write-Host "OK (Messages: $msgCount)" -ForegroundColor Green
} catch {
    Write-Host "FAILED" -ForegroundColor Red
}

# CloudWatch Check
Write-Host "CloudWatch: " -NoNewline
try {
    aws logs describe-log-groups --max-items 1 --profile $Profile --output json 2>&1 | Out-Null
    Write-Host "OK" -ForegroundColor Green
} catch {
    Write-Host "FAILED" -ForegroundColor Red
}

Write-Host ""
```

## 2. C# Console Application for Testing

Save as `Program.cs` in a test console project:

```csharp
using System;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using DocuWorksConverter.Services.AWS;

namespace DocuWorksConverter.TestHarness
{
    class Program
    {
        static async Task<int> Main(string[] args)
        {
            Console.WriteLine("╔══════════════════════════════════════════════════════════╗");
            Console.WriteLine("║  DocuWorks Converter - AWS Integration Test Harness     ║");
            Console.WriteLine("╚══════════════════════════════════════════════════════════╝\n");

            // Build configuration
            var configuration = new ConfigurationBuilder()
                .SetBasePath(Directory.GetCurrentDirectory())
                .AddJsonFile("appsettings.json", optional: false)
                .AddJsonFile("appsettings.Development.json", optional: true)
                .AddEnvironmentVariables()
                .Build();

            // Setup dependency injection
            var services = new ServiceCollection();
            ConfigureServices(services, configuration);

            var serviceProvider = services.BuildServiceProvider();

            // Run tests
            try
            {
                Console.WriteLine("Starting AWS connection verification...\n");

                var verifier = serviceProvider.GetRequiredService<IAwsConnectionVerifier>();
                var result = await verifier.VerifyAllConnectionsAsync();

                Console.WriteLine("\n" + new string('=', 60));
                Console.WriteLine("VERIFICATION RESULTS");
                Console.WriteLine(new string('=', 60));

                PrintResult("S3 Connection", result.S3Connected);
                PrintResult("SQS Connection", result.SQSConnected);
                PrintResult("CloudWatch Connection", result.CloudWatchConnected);
                PrintResult("Overall Status", result.AllServicesConnected);

                if (result.AllServicesConnected)
                {
                    Console.WriteLine("\n✓ All AWS services are accessible!");

                    // Run integration tests
                    if (PromptYesNo("\nRun integration tests?"))
                    {
                        await RunIntegrationTestsAsync(serviceProvider);
                    }

                    return 0;
                }
                else
                {
                    Console.WriteLine("\n✗ Some AWS services are not accessible.");
                    Console.WriteLine("Please check the logs above for details.");
                    return 1;
                }
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine($"\nFATAL ERROR: {ex.Message}");
                Console.WriteLine($"Stack Trace:\n{ex.StackTrace}");
                Console.ResetColor();
                return 1;
            }
        }

        static void ConfigureServices(IServiceCollection services, IConfiguration configuration)
        {
            // Logging
            services.AddLogging(builder =>
            {
                builder.AddConsole();
                builder.SetMinimumLevel(LogLevel.Information);
            });

            // Configuration
            services.AddSingleton(configuration);
            services.AddSingleton<AwsConfig>();

            // AWS Services
            services.AddSingleton<IAwsConnectionVerifier, AwsConnectionVerifier>();
            services.AddSingleton<IS3ClientService, S3ClientService>();
            services.AddSingleton<ISQSClientService, SQSClientService>();
            services.AddSingleton<IUploadProgressMonitor, UploadProgressMonitor>();
        }

        static async Task RunIntegrationTestsAsync(IServiceProvider serviceProvider)
        {
            Console.WriteLine("\n" + new string('=', 60));
            Console.WriteLine("INTEGRATION TESTS");
            Console.WriteLine(new string('=', 60) + "\n");

            var s3Client = serviceProvider.GetRequiredService<IS3ClientService>();
            var sqsClient = serviceProvider.GetRequiredService<ISQSClientService>();

            // Test 1: S3 Upload
            Console.Write("Test 1: S3 File Upload... ");
            try
            {
                var testFile = CreateTestFile(1024 * 1024); // 1MB
                var testKey = $"test/{Guid.NewGuid()}.dat";

                var s3Url = await s3Client.UploadFileAsync(testFile, testKey);
                var verified = await s3Client.VerifyUploadAsync(testKey);

                File.Delete(testFile);

                if (verified)
                {
                    Console.ForegroundColor = ConsoleColor.Green;
                    Console.WriteLine("PASSED");
                    Console.ResetColor();
                }
                else
                {
                    throw new Exception("Upload verification failed");
                }
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine($"FAILED: {ex.Message}");
                Console.ResetColor();
            }

            // Test 2: SQS Message
            Console.Write("Test 2: SQS Message Send... ");
            try
            {
                var notification = new ConversionNotification
                {
                    OriginalFilePath = @"C:\Test\sample.xdw",
                    OriginalFileName = "sample.xdw",
                    S3Bucket = "cis-filesearch-s3-landing",
                    S3Key = "test/sample.pdf",
                    S3Url = "s3://cis-filesearch-s3-landing/test/sample.pdf",
                    FileType = "pdf",
                    Status = "completed",
                    FileSizeBytes = 1024 * 500
                };

                var messageId = await sqsClient.SendConversionNotificationAsync(notification);

                Console.ForegroundColor = ConsoleColor.Green;
                Console.WriteLine($"PASSED (MessageId: {messageId})");
                Console.ResetColor();
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine($"FAILED: {ex.Message}");
                Console.ResetColor();
            }

            // Test 3: Queue Statistics
            Console.Write("Test 3: SQS Queue Stats... ");
            try
            {
                var stats = await sqsClient.GetQueueStatsAsync();

                Console.ForegroundColor = ConsoleColor.Green;
                Console.WriteLine($"PASSED (Total Messages: {stats.TotalMessages})");
                Console.ResetColor();
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine($"FAILED: {ex.Message}");
                Console.ResetColor();
            }

            Console.WriteLine("\nIntegration tests completed.");
        }

        static string CreateTestFile(int sizeBytes)
        {
            var tempFile = Path.GetTempFileName();
            var randomData = new byte[sizeBytes];
            new Random().NextBytes(randomData);
            File.WriteAllBytes(tempFile, randomData);
            return tempFile;
        }

        static void PrintResult(string name, bool success)
        {
            Console.Write($"{name,-30}: ");
            if (success)
            {
                Console.ForegroundColor = ConsoleColor.Green;
                Console.WriteLine("✓ PASS");
            }
            else
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("✗ FAIL");
            }
            Console.ResetColor();
        }

        static bool PromptYesNo(string message)
        {
            Console.Write($"{message} (y/N): ");
            var response = Console.ReadLine()?.Trim().ToLower();
            return response == "y" || response == "yes";
        }
    }
}
```

## 3. Bash Scripts (For macOS/Linux testing)

Save as `verify-aws-connections.sh`:

```bash
#!/bin/bash

# Configuration
PROFILE="AdministratorAccess-770923989980"
REGION="ap-northeast-1"
S3_BUCKET="cis-filesearch-s3-landing"
SQS_QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-queue"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

print_header() {
    echo -e "\n${CYAN}========================================"
    echo -e " $1"
    echo -e "========================================${NC}\n"
}

print_result() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}[✓]${NC} $2"
    else
        echo -e "${RED}[✗]${NC} $2"
    fi
}

# Check AWS CLI
print_header "Checking Prerequisites"
if command -v aws &> /dev/null; then
    VERSION=$(aws --version)
    print_result 0 "AWS CLI installed: $VERSION"
else
    print_result 1 "AWS CLI not found"
    exit 1
fi

# Check AWS Profile
print_header "Verifying AWS Profile"
IDENTITY=$(aws sts get-caller-identity --profile $PROFILE --output json 2>&1)
if [ $? -eq 0 ]; then
    ACCOUNT=$(echo $IDENTITY | jq -r '.Account')
    USER_ID=$(echo $IDENTITY | jq -r '.UserId')
    print_result 0 "AWS Profile valid (Account: $ACCOUNT)"
else
    print_result 1 "AWS Profile verification failed"
    exit 1
fi

# Test S3
print_header "Testing S3 Bucket: $S3_BUCKET"

# Check bucket existence
aws s3api head-bucket --bucket $S3_BUCKET --profile $PROFILE 2>&1
if [ $? -eq 0 ]; then
    print_result 0 "S3 Bucket accessible"
else
    print_result 1 "S3 Bucket not accessible"
    exit 1
fi

# Upload test
TEST_FILE=$(mktemp)
echo "AWS Connection Test - $(date)" > $TEST_FILE
TEST_KEY="connection-test/test-$(date +%Y%m%d-%H%M%S).txt"

aws s3 cp $TEST_FILE "s3://$S3_BUCKET/$TEST_KEY" --profile $PROFILE &> /dev/null
if [ $? -eq 0 ]; then
    print_result 0 "S3 Upload successful"

    # Download test
    DOWNLOAD_FILE=$(mktemp)
    aws s3 cp "s3://$S3_BUCKET/$TEST_KEY" $DOWNLOAD_FILE --profile $PROFILE &> /dev/null
    if [ $? -eq 0 ]; then
        print_result 0 "S3 Download successful"
    fi

    # Cleanup
    aws s3 rm "s3://$S3_BUCKET/$TEST_KEY" --profile $PROFILE &> /dev/null
    rm -f $DOWNLOAD_FILE
else
    print_result 1 "S3 Upload failed"
fi

rm -f $TEST_FILE

# Test SQS
print_header "Testing SQS Queue"

# Get queue attributes
QUEUE_ATTRS=$(aws sqs get-queue-attributes \
    --queue-url $SQS_QUEUE_URL \
    --attribute-names All \
    --profile $PROFILE \
    --output json 2>&1)

if [ $? -eq 0 ]; then
    MSG_COUNT=$(echo $QUEUE_ATTRS | jq -r '.Attributes.ApproximateNumberOfMessages')
    print_result 0 "SQS Queue accessible (Messages: $MSG_COUNT)"

    # Send test message
    TEST_MESSAGE='{"type":"connection-test","timestamp":"'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"}'
    MSG_RESULT=$(aws sqs send-message \
        --queue-url $SQS_QUEUE_URL \
        --message-body "$TEST_MESSAGE" \
        --profile $PROFILE \
        --output json 2>&1)

    if [ $? -eq 0 ]; then
        MESSAGE_ID=$(echo $MSG_RESULT | jq -r '.MessageId')
        print_result 0 "SQS Send message successful (MessageId: $MESSAGE_ID)"
    else
        print_result 1 "SQS Send message failed"
    fi
else
    print_result 1 "SQS Queue not accessible"
fi

# Test CloudWatch Logs
print_header "Testing CloudWatch Logs"

aws logs describe-log-groups --max-items 1 --profile $PROFILE &> /dev/null
if [ $? -eq 0 ]; then
    print_result 0 "CloudWatch Logs accessible"
else
    print_result 1 "CloudWatch Logs not accessible"
fi

print_header "Verification Complete"
echo -e "${GREEN}✓ All AWS connections verified successfully!${NC}\n"
```

Make it executable:
```bash
chmod +x verify-aws-connections.sh
```

## 4. Environment Configuration File

Create `.env.test`:

```bash
# AWS Configuration
AWS_PROFILE=AdministratorAccess-770923989980
AWS_REGION=ap-northeast-1

# S3 Configuration
S3_LANDING_BUCKET=cis-filesearch-s3-landing
S3_UPLOAD_PREFIX=docuworks-converted/

# SQS Configuration
SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-queue
SQS_MESSAGE_GROUP_ID=docuworks-converter

# CloudWatch Configuration
CLOUDWATCH_LOG_GROUP=/cis-filesearch/docuworks-converter
CLOUDWATCH_LOG_STREAM=converter-service

# Testing Configuration
ENABLE_CLOUDWATCH_LOGS=false
LOG_LEVEL=Debug
```

## 5. Docker-based Test Environment

Create `Dockerfile.test`:

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:7.0

WORKDIR /app

# Install AWS CLI
RUN apt-get update && \
    apt-get install -y awscli jq && \
    rm -rf /var/lib/apt/lists/*

# Copy project files
COPY . .

# Restore dependencies
RUN dotnet restore

# Run tests
CMD ["dotnet", "test", "--logger:console;verbosity=detailed"]
```

Build and run:
```bash
docker build -f Dockerfile.test -t docuworks-converter-test .
docker run --env-file .env.test docuworks-converter-test
```

## Usage Instructions

### Running the PowerShell Verification Script

```powershell
# Run with default settings
.\Verify-AwsConnections.ps1

# Run with custom profile
.\Verify-AwsConnections.ps1 -Profile "MyCustomProfile"

# Run with all custom parameters
.\Verify-AwsConnections.ps1 `
    -Profile "AdministratorAccess-770923989980" `
    -Region "ap-northeast-1" `
    -S3Bucket "cis-filesearch-s3-landing" `
    -SQSQueueUrl "https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-queue"
```

### Running the C# Test Harness

```bash
# Navigate to test project
cd C:\DocuWorksConverter\Tests

# Run tests
dotnet run

# Or build and run
dotnet build
dotnet .\bin\Debug\net7.0\DocuWorksConverter.TestHarness.exe
```

### Running Integration Tests

```bash
# Run all integration tests
dotnet test --filter Category=Integration

# Run specific test
dotnet test --filter FullyQualifiedName~Test_AwsConnections_ShouldSucceed

# Run with detailed output
dotnet test --logger:console;verbosity=detailed
```

## Troubleshooting

### Common Issues and Solutions

1. **AWS CLI Not Found**
   ```powershell
   # Install AWS CLI v2
   msiexec.exe /i https://awscli.amazonaws.com/AWSCLIV2.msi
   ```

2. **Profile Not Found**
   ```bash
   # Configure AWS profile
   aws configure --profile AdministratorAccess-770923989980
   ```

3. **Access Denied**
   ```bash
   # Verify IAM permissions
   aws iam get-user --profile AdministratorAccess-770923989980

   # Check S3 bucket policy
   aws s3api get-bucket-policy --bucket cis-filesearch-s3-landing
   ```

4. **Network Connectivity**
   ```powershell
   # Test network connectivity
   Test-NetConnection s3.ap-northeast-1.amazonaws.com -Port 443
   Test-NetConnection sqs.ap-northeast-1.amazonaws.com -Port 443
   ```

## Next Steps

After successful verification:
1. Review all test results
2. Document any issues encountered
3. Proceed to Day 2 Afternoon tasks (integration implementation)
4. Set up continuous monitoring
