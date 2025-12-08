# DocuWorks Converter - Day 2 Testing Quick Start Guide

## Overview

This guide will help you execute the comprehensive Day 2 testing strategy for the DocuWorks to PDF converter service.

**Goal**: Validate mock implementation before Day 3 real DocuWorks license integration.

**Time Required**: 4-6 hours

**Prerequisites**: Windows machine, .NET 7, Docker, AWS CLI

---

## Quick Start (5 Minutes)

### 1. Copy Test Files to Your Project

```powershell
# Navigate to your project
cd C:\DocuWorksConverter

# Copy all test files from this directory to your project:
# - MockDocuWorksProcessorTests.cs → DocuWorksConverter.Tests\Services\
# - S3ServiceTests.cs → DocuWorksConverter.Tests\Services\
# - SqsServiceTests.cs → DocuWorksConverter.Tests\Services\
# - AwsIntegrationTests.cs → DocuWorksConverter.Tests\Integration\
# - run-all-tests.ps1 → scripts\
```

### 2. Install Required NuGet Packages

```powershell
cd DocuWorksConverter.Tests

dotnet add package xUnit
dotnet add package xunit.runner.visualstudio
dotnet add package Moq
dotnet add package FluentAssertions
dotnet add package AWSSDK.S3
dotnet add package AWSSDK.SQS
dotnet add package BenchmarkDotNet
```

### 3. Start LocalStack

```powershell
# Make sure Docker is running, then:
docker-compose up -d

# Verify LocalStack is running
docker ps | findstr localstack
```

### 4. Run All Tests

```powershell
# Run all tests with coverage
.\scripts\run-all-tests.ps1 -All -Coverage

# OR run individual test categories
.\scripts\run-all-tests.ps1 -Unit
.\scripts\run-all-tests.ps1 -Integration
.\scripts\run-all-tests.ps1 -Performance
.\scripts\run-all-tests.ps1 -Security
```

---

## Detailed Step-by-Step Guide

### Step 1: Environment Setup (15 minutes)

#### 1.1 Verify .NET 7 Installation

```powershell
dotnet --version
# Should output: 7.0.x
```

If not installed:
```powershell
winget install Microsoft.DotNet.SDK.7
```

#### 1.2 Verify Docker Installation

```powershell
docker --version
# Should output: Docker version X.X.X
```

If not installed:
```powershell
winget install Docker.DockerDesktop
```

#### 1.3 Install AWS CLI

```powershell
winget install Amazon.AWSCLI

# Verify installation
aws --version
```

#### 1.4 Install awslocal (LocalStack CLI)

```powershell
pip install awscli-local

# Verify installation
awslocal --version
```

### Step 2: Project Structure Setup (10 minutes)

Create the following directory structure in your project:

```
C:\DocuWorksConverter\
├── DocuWorksConverter\                    # Main project
│   ├── Services\
│   │   ├── MockDocuWorksProcessor.cs      # Your implementation
│   │   ├── S3Service.cs                   # Your implementation
│   │   └── SqsService.cs                  # Your implementation
│   └── Interfaces\
│       └── IDocuWorksProcessor.cs         # Your interface
│
├── DocuWorksConverter.Tests\              # Test project
│   ├── Services\
│   │   ├── MockDocuWorksProcessorTests.cs # Copy from templates
│   │   ├── S3ServiceTests.cs              # Copy from templates
│   │   └── SqsServiceTests.cs             # Copy from templates
│   ├── Integration\
│   │   └── AwsIntegrationTests.cs         # Copy from templates
│   └── DocuWorksConverter.Tests.csproj
│
├── scripts\
│   ├── run-all-tests.ps1                  # Copy from templates
│   └── security-scan.ps1                  # Optional
│
├── docker-compose.yml                     # For LocalStack
├── coverlet.runsettings                   # Coverage settings
└── README.md
```

### Step 3: LocalStack Configuration (10 minutes)

#### 3.1 Create docker-compose.yml

Create `C:\DocuWorksConverter\docker-compose.yml`:

```yaml
version: '3.8'
services:
  localstack:
    image: localstack/localstack:latest
    ports:
      - "4566:4566"
      - "4571:4571"
    environment:
      - SERVICES=s3,sqs
      - DEBUG=1
      - DATA_DIR=/tmp/localstack/data
      - DOCKER_HOST=unix:///var/run/docker.sock
    volumes:
      - "./localstack-data:/tmp/localstack"
      - "/var/run/docker.sock:/var/run/docker.sock"
```

#### 3.2 Start LocalStack

```powershell
cd C:\DocuWorksConverter
docker-compose up -d

# Wait for LocalStack to be ready (30 seconds)
Start-Sleep -Seconds 30

# Verify LocalStack is healthy
curl http://localhost:4566/_localstack/health
```

#### 3.3 Setup Test Resources

```powershell
# Configure AWS CLI for LocalStack
$env:AWS_ACCESS_KEY_ID = "test"
$env:AWS_SECRET_ACCESS_KEY = "test"
$env:AWS_DEFAULT_REGION = "us-east-1"

# Create test S3 bucket
awslocal s3 mb s3://docuworks-integration-test-bucket

# Create test SQS queue
awslocal sqs create-queue --queue-name docuworks-integration-test-queue

# Verify resources
awslocal s3 ls
awslocal sqs list-queues
```

### Step 4: Build and Test (30 minutes)

#### 4.1 Restore Dependencies

```powershell
cd C:\DocuWorksConverter
dotnet restore
```

#### 4.2 Build Project

```powershell
dotnet build --configuration Release
```

#### 4.3 Run Unit Tests

```powershell
.\scripts\run-all-tests.ps1 -Unit -Coverage
```

**Expected Results**:
- ✅ All unit tests pass (80%+ coverage target)
- ✅ MockDocuWorksProcessor tests: 100% coverage
- ✅ S3Service tests: 85%+ coverage
- ✅ SqsService tests: 85%+ coverage

#### 4.4 Run Integration Tests

```powershell
.\scripts\run-all-tests.ps1 -Integration
```

**Expected Results**:
- ✅ End-to-end workflow test passes
- ✅ S3 upload/download works
- ✅ SQS message processing works
- ✅ All AWS services integrate correctly

#### 4.5 Run Performance Tests

```powershell
.\scripts\run-all-tests.ps1 -Performance
```

**Expected Baselines** (Mock Implementation):
- Single file conversion: < 5 seconds
- Memory usage: < 100 MB
- Throughput: > 10 files/minute

#### 4.6 Run Security Scan

```powershell
.\scripts\run-all-tests.ps1 -Security
```

**Expected Results**:
- ✅ No hardcoded credentials
- ✅ Input validation active
- ✅ AWS IAM properly configured
- ✅ Logging sanitized

### Step 5: Windows Service Testing (30 minutes)

#### 5.1 Install Service (Administrator PowerShell Required)

```powershell
# Open PowerShell as Administrator
cd C:\DocuWorksConverter

# Install service
sc.exe create DocuWorksConverter `
    binPath="C:\DocuWorksConverter\bin\Release\net7.0\DocuWorksConverter.exe" `
    DisplayName="DocuWorks to PDF Converter" `
    start=auto
```

#### 5.2 Test Service Lifecycle

```powershell
# Start service
sc.exe start DocuWorksConverter

# Check status
sc.exe query DocuWorksConverter
# Should show: STATE: 4 RUNNING

# View service logs
Get-EventLog -LogName Application -Source "DocuWorksConverter" -Newest 50

# Stop service
sc.exe stop DocuWorksConverter

# Verify stopped
sc.exe query DocuWorksConverter
# Should show: STATE: 1 STOPPED
```

#### 5.3 Test Service Recovery

```powershell
# Configure service recovery options
sc.exe failure DocuWorksConverter reset= 86400 actions= restart/5000/restart/10000/restart/30000

# Simulate crash (for testing only!)
# The service should automatically restart
```

### Step 6: End-to-End Smoke Test (30 minutes)

#### 6.1 Prepare Test File

```powershell
# Create test XDW file
$testFile = "C:\Temp\sample.xdw"
[System.IO.File]::WriteAllBytes($testFile, @(0x58, 0x44, 0x57, 0x46))
```

#### 6.2 Upload to S3

```powershell
awslocal s3 cp $testFile s3://docuworks-integration-test-bucket/source/
```

#### 6.3 Send SQS Message

```powershell
$queueUrl = (awslocal sqs list-queues --queue-name-prefix "docuworks-integration-test" | ConvertFrom-Json).QueueUrls[0]

$message = @{
    s3Key = "source/sample.xdw"
    fileName = "sample.xdw"
    timestamp = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json

awslocal sqs send-message --queue-url $queueUrl --message-body $message
```

#### 6.4 Monitor Processing

```powershell
# Check service logs
Get-EventLog -LogName Application -Source "DocuWorksConverter" -After (Get-Date).AddMinutes(-5)

# Check for converted PDF
Start-Sleep -Seconds 10
awslocal s3 ls s3://docuworks-integration-test-bucket/converted/
```

#### 6.5 Verify Output

```powershell
# Download converted PDF
awslocal s3 cp s3://docuworks-integration-test-bucket/converted/sample.pdf C:\Temp\

# Open PDF to verify
Start-Process "C:\Temp\sample.pdf"
```

---

## Troubleshooting

### LocalStack Not Starting

**Problem**: `docker-compose up -d` fails

**Solution**:
```powershell
# Check Docker Desktop is running
docker ps

# View LocalStack logs
docker-compose logs localstack

# Reset LocalStack
docker-compose down -v
docker-compose up -d
```

### Tests Failing

**Problem**: Unit or integration tests fail

**Solution**:
```powershell
# Run with verbose logging
.\scripts\run-all-tests.ps1 -Unit -Verbose

# Run specific test
dotnet test --filter "FullyQualifiedName~ConvertToPdf_WithValidXdwFile"

# Check test output
Get-ChildItem -Path "TestResults\" -Recurse -Filter "*.trx"
```

### AWS Connection Issues

**Problem**: Cannot connect to LocalStack

**Solution**:
```powershell
# Verify LocalStack is running
curl http://localhost:4566/_localstack/health

# Check environment variables
$env:AWS_ENDPOINT_URL = "http://localhost:4566"
$env:AWS_ACCESS_KEY_ID = "test"
$env:AWS_SECRET_ACCESS_KEY = "test"

# Test AWS CLI
awslocal s3 ls
```

### Windows Service Issues

**Problem**: Service won't start

**Solution**:
```powershell
# Check service status
sc.exe query DocuWorksConverter

# View service configuration
sc.exe qc DocuWorksConverter

# Check event log for errors
Get-EventLog -LogName Application -Source "DocuWorksConverter" -Newest 10 -EntryType Error

# Grant permissions (if needed)
icacls "C:\DocuWorksConverter" /grant "NT AUTHORITY\LOCAL SERVICE:(OI)(CI)F"
```

### Coverage Report Not Generating

**Problem**: No coverage data found

**Solution**:
```powershell
# Ensure coverlet.runsettings exists
Test-Path "C:\DocuWorksConverter\coverlet.runsettings"

# Run tests with coverage explicitly
dotnet test --collect:"XPlat Code Coverage" --settings coverlet.runsettings

# Check for coverage files
Get-ChildItem -Path . -Recurse -Filter "coverage.cobertura.xml"
```

---

## Success Checklist

Before proceeding to Day 3, ensure all items are checked:

### Must Have (Go/No-Go)
- [ ] 80%+ unit test coverage achieved
- [ ] All integration tests passing
- [ ] No critical security vulnerabilities
- [ ] Windows Service starts/stops reliably
- [ ] End-to-end workflow completes successfully
- [ ] Logging captures all critical events
- [ ] Error handling validated for all scenarios

### Should Have
- [ ] 85%+ unit test coverage
- [ ] Performance baselines documented
- [ ] All error scenarios tested
- [ ] Security scan clean
- [ ] Test automation configured

### Nice to Have
- [ ] 90%+ unit test coverage
- [ ] Load testing completed
- [ ] Monitoring dashboard configured
- [ ] Documentation updated

---

## Key Commands Reference

```powershell
# === Quick Test Runs ===
.\scripts\run-all-tests.ps1 -All                    # All tests
.\scripts\run-all-tests.ps1 -Unit -Coverage         # Unit tests with coverage
.\scripts\run-all-tests.ps1 -Integration            # Integration tests only

# === LocalStack ===
docker-compose up -d                                # Start
docker-compose down                                 # Stop
docker-compose logs -f localstack                   # View logs

# === AWS LocalStack ===
awslocal s3 ls                                      # List S3 buckets
awslocal s3 cp file.xdw s3://bucket/key             # Upload file
awslocal sqs list-queues                            # List queues

# === Windows Service ===
sc.exe start DocuWorksConverter                     # Start service
sc.exe stop DocuWorksConverter                      # Stop service
sc.exe query DocuWorksConverter                     # Check status

# === Logs ===
Get-EventLog -LogName Application -Source "DocuWorksConverter" -Newest 50

# === Coverage ===
# Auto-opens after running: .\scripts\run-all-tests.ps1 -Coverage
# Manual: Start-Process "C:\DocuWorksConverter\coverage-report\index.html"
```

---

## Next Steps

After successful Day 2 testing:

1. **Review test results**: Check coverage report and identify any gaps
2. **Document baselines**: Record performance metrics for Day 3 comparison
3. **Prepare for Day 3**: Real DocuWorks license integration
4. **Deploy to staging**: If all tests pass, deploy to staging environment
5. **Monitor production**: Setup monitoring for Day 3 production deployment

---

## Support

For questions or issues:
- Review the comprehensive testing strategy: `docuworks-converter-testing-strategy.md`
- Check test templates in: `docs/docuworks-test-templates/`
- View logs: `C:\DocuWorksConverter\test-reports\`

**Good luck with Day 2 testing!** 🚀
