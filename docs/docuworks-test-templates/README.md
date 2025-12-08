# DocuWorks to PDF Converter - Day 2 Testing Package

## Overview

This package contains a comprehensive testing strategy and implementation for Day 2 of the DocuWorks to PDF converter service deployment. The tests validate the mock implementation before Day 3 real DocuWorks license integration.

**Project**: C:\DocuWorksConverter
**Technology**: .NET 7, AWS S3, AWS SQS, Windows Service
**Testing Framework**: xUnit, Moq, FluentAssertions, BenchmarkDotNet
**Target Coverage**: 80%+ (Critical: 100%)

---

## 📦 Package Contents

### Documentation
- **`docuworks-converter-testing-strategy.md`** (45 pages)
  - Complete testing strategy with all test categories
  - Detailed test scenarios and expected outcomes
  - Performance benchmarks and security guidelines
  - Day 2 execution plan with timeline

- **`DAY2-QUICKSTART.md`**
  - Step-by-step quick start guide
  - Troubleshooting section
  - Success checklist
  - Key commands reference

- **`README.md`** (this file)
  - Package overview and structure
  - Quick installation guide
  - File descriptions

### Test Implementation Files

#### Unit Tests (3 files)
- **`MockDocuWorksProcessorTests.cs`** (450 lines)
  - Tests for IDocuWorksProcessor mock implementation
  - Coverage target: 100% (critical component)
  - Test scenarios:
    - Happy path conversions
    - Error handling (invalid files, missing files, etc.)
    - Filename variations (Unicode, special characters)
    - File size variations
    - Logging verification
    - Concurrent processing

- **`S3ServiceTests.cs`** (650 lines)
  - Tests for AWS S3 integration
  - Coverage target: 85%+
  - Test scenarios:
    - Upload with metadata
    - Download and verify content
    - File listing with prefixes
    - Large file multipart upload
    - Error handling (404, access denied)
    - Metadata retrieval

- **`SqsServiceTests.cs`** (800 lines)
  - Tests for AWS SQS integration
  - Coverage target: 85%+
  - Test scenarios:
    - Message receive with long polling
    - Message parsing (JSON deserialization)
    - Batch delete operations
    - Visibility timeout management
    - Message attributes
    - Error handling

#### Integration Tests (1 file)
- **`AwsIntegrationTests.cs`** (850 lines)
  - End-to-end integration tests using LocalStack
  - Coverage target: 100% of integration scenarios
  - Test scenarios:
    - Complete conversion workflow (upload → process → convert → upload)
    - S3 upload/download with content verification
    - SQS message flow
    - Batch processing
    - Concurrent operations
    - Performance validation

### Automation Scripts

- **`run-all-tests.ps1`** (PowerShell, 500 lines)
  - Comprehensive test automation script
  - Features:
    - Prerequisite checking
    - LocalStack management
    - Parallel test execution
    - Coverage report generation
    - Test result aggregation
    - Markdown report generation
  - Usage:
    ```powershell
    .\run-all-tests.ps1 -All -Coverage
    .\run-all-tests.ps1 -Unit
    .\run-all-tests.ps1 -Integration
    ```

---

## 🚀 Quick Installation

### Option 1: Automated Setup (Recommended)

```powershell
# 1. Navigate to your project
cd C:\DocuWorksConverter

# 2. Create test project structure
dotnet new xunit -n DocuWorksConverter.Tests

# 3. Copy all files from this package:
#    - Copy *.cs files to appropriate folders
#    - Copy *.ps1 to scripts folder
#    - Copy *.md to docs folder

# 4. Install NuGet packages
cd DocuWorksConverter.Tests
dotnet add package xUnit
dotnet add package xunit.runner.visualstudio
dotnet add package Moq
dotnet add package FluentAssertions
dotnet add package AWSSDK.S3
dotnet add package AWSSDK.SQS
dotnet add package BenchmarkDotNet

# 5. Add project reference
dotnet add reference ../DocuWorksConverter/DocuWorksConverter.csproj

# 6. Start LocalStack
docker-compose up -d

# 7. Run tests
..\scripts\run-all-tests.ps1 -All -Coverage
```

### Option 2: Manual Setup

See **`DAY2-QUICKSTART.md`** for detailed step-by-step instructions.

---

## 📁 File Locations

Copy files to the following locations in your project:

```
C:\DocuWorksConverter\
│
├── DocuWorksConverter.Tests\
│   ├── Services\
│   │   ├── MockDocuWorksProcessorTests.cs    ← Copy here
│   │   ├── S3ServiceTests.cs                 ← Copy here
│   │   └── SqsServiceTests.cs                ← Copy here
│   │
│   ├── Integration\
│   │   └── AwsIntegrationTests.cs            ← Copy here
│   │
│   └── DocuWorksConverter.Tests.csproj
│
├── scripts\
│   └── run-all-tests.ps1                     ← Copy here
│
└── docs\
    ├── docuworks-converter-testing-strategy.md ← Copy here
    ├── DAY2-QUICKSTART.md                      ← Copy here
    └── README.md                                ← Copy here
```

---

## 🎯 Test Categories

### 1. Unit Tests (70% of total tests)
- **MockDocuWorksProcessor**: Validates conversion logic
- **S3Service**: Tests S3 upload/download/metadata operations
- **SqsService**: Tests SQS message processing
- **Target**: 80%+ code coverage

### 2. Integration Tests (20% of total tests)
- **End-to-End Workflow**: Complete conversion flow
- **AWS Services**: Real AWS SDK calls to LocalStack
- **Concurrent Processing**: Parallel operations
- **Target**: 100% scenario coverage

### 3. Performance Tests (5% of total tests)
- **Single File Conversion**: < 5 seconds (mock)
- **Batch Processing**: > 10 files/minute
- **Memory Usage**: < 100 MB
- **Baseline**: For Day 3 comparison

### 4. Security Tests (5% of total tests)
- **Credential Scanning**: No hardcoded secrets
- **Input Validation**: XSS, SQL injection, path traversal
- **AWS IAM**: Least privilege verification
- **Logging**: PII sanitization

---

## 📊 Coverage Targets

| Component | Line Coverage | Branch Coverage | Priority |
|-----------|--------------|-----------------|----------|
| **MockDocuWorksProcessor** | 100% | 100% | Critical |
| **S3Service** | 85%+ | 80%+ | High |
| **SqsService** | 85%+ | 80%+ | High |
| **Worker Service** | 80%+ | 75%+ | High |
| **Error Handlers** | 90%+ | 85%+ | High |
| **Validators** | 95%+ | 90%+ | Critical |
| **Utilities** | 75%+ | 70%+ | Medium |

---

## ⚙️ Prerequisites

### Software Requirements
- ✅ Windows 10/11 or Windows Server 2019+
- ✅ .NET 7 SDK
- ✅ Docker Desktop
- ✅ AWS CLI
- ✅ Git (optional)

### Installation Commands

```powershell
# .NET 7 SDK
winget install Microsoft.DotNet.SDK.7

# Docker Desktop
winget install Docker.DockerDesktop

# AWS CLI
winget install Amazon.AWSCLI

# awslocal (LocalStack CLI)
pip install awscli-local
```

### Hardware Requirements
- CPU: 4+ cores recommended
- RAM: 8 GB minimum, 16 GB recommended
- Disk: 10 GB free space
- Network: Internet connection (for Docker images)

---

## 🧪 Running Tests

### All Tests with Coverage
```powershell
.\scripts\run-all-tests.ps1 -All -Coverage
```

### Individual Test Categories
```powershell
# Unit tests only
.\scripts\run-all-tests.ps1 -Unit

# Integration tests only
.\scripts\run-all-tests.ps1 -Integration

# Performance tests only
.\scripts\run-all-tests.ps1 -Performance

# Security scan only
.\scripts\run-all-tests.ps1 -Security
```

### Advanced Options
```powershell
# Verbose output
.\scripts\run-all-tests.ps1 -All -Verbose

# Skip build step
.\scripts\run-all-tests.ps1 -Unit -SkipBuild

# Custom filter
.\scripts\run-all-tests.ps1 -Unit -Filter "FullyQualifiedName~S3Service"
```

---

## 📈 Expected Results

### Unit Tests
- **Total Tests**: ~50
- **Expected Pass Rate**: 100%
- **Execution Time**: < 2 minutes
- **Coverage**: 80%+

### Integration Tests
- **Total Tests**: ~15
- **Expected Pass Rate**: 100%
- **Execution Time**: < 5 minutes
- **Scenarios**: 100%

### Performance Baselines (Mock Implementation)
- Single file conversion: **< 5 seconds**
- Memory usage: **< 100 MB**
- Throughput: **> 10 files/minute**
- CPU usage: **< 50%**

### Security Scan
- Hardcoded credentials: **0 found**
- Input validation: **All paths validated**
- AWS permissions: **Least privilege verified**
- Logging: **PII sanitized**

---

## 🔍 Test Reports

After running tests, find reports at:

```
C:\DocuWorksConverter\
├── test-reports\
│   ├── Unit-20250128-153045.trx          # Unit test results
│   ├── Integration-20250128-153245.trx   # Integration test results
│   └── day2-test-report-20250128-153500.md  # Summary report
│
└── coverage-report\
    ├── index.html                         # Coverage dashboard
    ├── Summary.txt                        # Text summary
    ├── Summary.json                       # JSON metrics
    └── Badges\                            # Coverage badges
```

**View Coverage Report**:
```powershell
Start-Process "C:\DocuWorksConverter\coverage-report\index.html"
```

---

## ✅ Success Checklist

Before proceeding to Day 3 (real DocuWorks implementation):

### Critical (Must Have)
- [ ] All unit tests passing (100%)
- [ ] All integration tests passing (100%)
- [ ] Unit test coverage ≥ 80%
- [ ] No critical security vulnerabilities
- [ ] Windows Service starts/stops reliably
- [ ] End-to-end workflow verified
- [ ] Error handling validated
- [ ] Logging captures all events

### Important (Should Have)
- [ ] Unit test coverage ≥ 85%
- [ ] Performance baselines documented
- [ ] All error scenarios tested
- [ ] Security scan clean
- [ ] Test automation configured
- [ ] Test reports generated

### Optional (Nice to Have)
- [ ] Unit test coverage ≥ 90%
- [ ] Load testing completed
- [ ] Monitoring dashboard configured
- [ ] CI/CD pipeline integrated
- [ ] Documentation updated

---

## 🐛 Troubleshooting

### Common Issues

#### LocalStack Not Starting
```powershell
# Check Docker
docker ps

# View logs
docker-compose logs localstack

# Reset
docker-compose down -v
docker-compose up -d
```

#### Tests Failing
```powershell
# Verbose output
.\scripts\run-all-tests.ps1 -Unit -Verbose

# Single test
dotnet test --filter "FullyQualifiedName~ConvertToPdf_WithValidXdwFile"
```

#### Coverage Not Generating
```powershell
# Ensure settings file exists
Test-Path "coverlet.runsettings"

# Run with explicit coverage
dotnet test --collect:"XPlat Code Coverage"
```

For more troubleshooting, see **`DAY2-QUICKSTART.md`**.

---

## 📚 Additional Resources

### Documentation
- **Main Strategy**: `docuworks-converter-testing-strategy.md`
- **Quick Start**: `DAY2-QUICKSTART.md`
- **This File**: `README.md`

### External Resources
- [xUnit Documentation](https://xunit.net/)
- [Moq Documentation](https://github.com/moq/moq4)
- [FluentAssertions](https://fluentassertions.com/)
- [LocalStack Docs](https://docs.localstack.cloud/)
- [AWS SDK for .NET](https://docs.aws.amazon.com/sdk-for-net/)

---

## 🔄 Day 3 Transition

After successful Day 2 testing:

1. **Compare Performance**: Mock vs Real DocuWorks API
2. **Update Tests**: Replace mock processor with real implementation
3. **Re-run All Tests**: Validate real implementation
4. **Deploy to Production**: Windows Server deployment
5. **Monitor**: Track first production conversions

### Day 3 Checklist
- [ ] Real DocuWorks license installed
- [ ] Replace `MockDocuWorksProcessor` with `RealDocuWorksProcessor`
- [ ] Update test expectations for real conversion times
- [ ] Re-run all tests with real implementation
- [ ] Performance comparison: Mock vs Real
- [ ] Production deployment verified

---

## 📞 Support

### Questions?
- Review the comprehensive strategy document
- Check the quick start guide
- Search test code for examples
- Review test reports for insights

### Issues?
- Check troubleshooting section
- Review LocalStack logs
- Check Windows Event Viewer
- Verify AWS credentials

---

## 📝 Version Information

**Package Version**: 1.0.0
**Created**: 2025-01-28
**Last Updated**: 2025-01-28
**Compatibility**: .NET 7, Windows 10+, Docker 20+
**Status**: Production Ready

---

## 🎉 Ready to Test!

You now have everything needed for comprehensive Day 2 testing:

1. ✅ Complete test strategy document
2. ✅ Full test implementation (4 test files)
3. ✅ Automated test runner script
4. ✅ Quick start guide
5. ✅ Troubleshooting resources

**Next Steps**:
1. Follow **`DAY2-QUICKSTART.md`**
2. Run `.\scripts\run-all-tests.ps1 -All -Coverage`
3. Review coverage report
4. Complete success checklist
5. Prepare for Day 3!

**Good luck with Day 2 testing!** 🚀

---

*For detailed implementation guidance, see the comprehensive testing strategy document.*
