# ====================================================================================================
# DocuWorks Converter - Comprehensive Test Runner
# Day 2 Testing Automation Script
# ====================================================================================================

param(
    [switch]$Unit,
    [switch]$Integration,
    [switch]$Performance,
    [switch]$Security,
    [switch]$All,
    [switch]$Coverage,
    [switch]$Verbose,
    [switch]$SkipBuild,
    [string]$Filter = ""
)

$ErrorActionPreference = "Stop"
$InformationPreference = "Continue"

# ====================================================================================================
# Configuration
# ====================================================================================================

$ProjectRoot = "C:\DocuWorksConverter"
$TestProject = "$ProjectRoot\DocuWorksConverter.Tests\DocuWorksConverter.Tests.csproj"
$MainProject = "$ProjectRoot\DocuWorksConverter\DocuWorksConverter.csproj"
$ReportDir = "$ProjectRoot\test-reports"
$CoverageDir = "$ProjectRoot\coverage-report"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

# Colors for output
$ColorInfo = "Cyan"
$ColorSuccess = "Green"
$ColorWarning = "Yellow"
$ColorError = "Red"
$ColorHeader = "Magenta"

# ====================================================================================================
# Helper Functions
# ====================================================================================================

function Write-Header {
    param([string]$Message)
    Write-Host "`n=====================================================================================================" -ForegroundColor $ColorHeader
    Write-Host "  $Message" -ForegroundColor $ColorHeader
    Write-Host "=====================================================================================================" -ForegroundColor $ColorHeader
}

function Write-Info {
    param([string]$Message)
    Write-Host "  $Message" -ForegroundColor $ColorInfo
}

function Write-Success {
    param([string]$Message)
    Write-Host "  $Message" -ForegroundColor $ColorSuccess
}

function Write-Warning {
    param([string]$Message)
    Write-Host "  $Message" -ForegroundColor $ColorWarning
}

function Write-Error {
    param([string]$Message)
    Write-Host "  $Message" -ForegroundColor $ColorError
}

function Test-Prerequisites {
    Write-Header "Checking Prerequisites"

    # Check .NET SDK
    $dotnetVersion = dotnet --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Success ".NET SDK: $dotnetVersion"
    } else {
        Write-Error ".NET SDK not found. Please install .NET 7 SDK"
        exit 1
    }

    # Check Docker (for LocalStack)
    $dockerVersion = docker --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Docker: $dockerVersion"
    } else {
        Write-Warning "Docker not found. Integration tests will be skipped"
    }

    # Check project files
    if (Test-Path $TestProject) {
        Write-Success "Test project found: $TestProject"
    } else {
        Write-Error "Test project not found: $TestProject"
        exit 1
    }

    # Check LocalStack availability (if integration tests requested)
    if ($Integration -or $All) {
        $localStackStatus = docker ps --filter "name=localstack" --format "{{.Status}}" 2>$null
        if ($localStackStatus -match "Up") {
            Write-Success "LocalStack is running"
        } else {
            Write-Warning "LocalStack is not running. Starting LocalStack..."
            Start-LocalStack
        }
    }
}

function Start-LocalStack {
    Write-Info "Starting LocalStack with docker-compose..."

    Push-Location $ProjectRoot

    if (Test-Path "docker-compose.yml") {
        docker-compose up -d 2>&1 | Out-Null

        if ($LASTEXITCODE -eq 0) {
            Write-Success "LocalStack started successfully"

            # Wait for LocalStack to be ready
            Write-Info "Waiting for LocalStack to be ready..."
            $maxRetries = 30
            $retryCount = 0

            while ($retryCount -lt $maxRetries) {
                try {
                    $response = Invoke-WebRequest -Uri "http://localhost:4566/_localstack/health" -Method Get -TimeoutSec 2 -ErrorAction SilentlyContinue
                    if ($response.StatusCode -eq 200) {
                        Write-Success "LocalStack is ready"
                        break
                    }
                } catch {
                    # Continue waiting
                }

                $retryCount++
                Start-Sleep -Seconds 1
            }

            if ($retryCount -eq $maxRetries) {
                Write-Warning "LocalStack health check timeout. Tests may fail."
            }

            # Setup test resources
            Setup-LocalStackResources
        } else {
            Write-Error "Failed to start LocalStack"
            Pop-Location
            exit 1
        }
    } else {
        Write-Error "docker-compose.yml not found in project root"
        Pop-Location
        exit 1
    }

    Pop-Location
}

function Setup-LocalStackResources {
    Write-Info "Setting up LocalStack test resources..."

    # Configure AWS CLI for LocalStack
    $env:AWS_ACCESS_KEY_ID = "test"
    $env:AWS_SECRET_ACCESS_KEY = "test"
    $env:AWS_DEFAULT_REGION = "us-east-1"

    # Create test S3 bucket
    awslocal s3 mb s3://docuworks-integration-test-bucket 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Created test S3 bucket"
    }

    # Create test SQS queue
    awslocal sqs create-queue --queue-name docuworks-integration-test-queue 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Created test SQS queue"
    }
}

function Stop-LocalStack {
    Write-Info "Stopping LocalStack..."
    Push-Location $ProjectRoot
    docker-compose down 2>&1 | Out-Null
    Pop-Location
    Write-Success "LocalStack stopped"
}

function Build-Project {
    Write-Header "Building Project"

    if ($SkipBuild) {
        Write-Warning "Skipping build (--SkipBuild flag set)"
        return $true
    }

    $buildArgs = @(
        "build",
        $MainProject,
        "--configuration", "Release",
        "--verbosity", $(if ($Verbose) { "detailed" } else { "minimal" })
    )

    Write-Info "Building main project..."
    & dotnet $buildArgs

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Build failed"
        return $false
    }

    Write-Success "Build successful"
    return $true
}

function Run-Tests {
    param(
        [string]$TestCategory,
        [string]$DisplayName,
        [bool]$RunCoverage = $false
    )

    Write-Header "Running $DisplayName"

    # Prepare test arguments
    $testArgs = @(
        "test",
        $TestProject,
        "--configuration", "Release",
        "--no-build",
        "--logger", "trx;LogFileName=$ReportDir\$TestCategory-$Timestamp.trx",
        "--logger", "console;verbosity=$(if ($Verbose) { 'detailed' } else { 'normal' })"
    )

    # Add category filter
    if ($TestCategory -ne "All") {
        $testArgs += @("--filter", "Category=$TestCategory")
    }

    # Add custom filter if provided
    if ($Filter) {
        if ($TestCategory -eq "All") {
            $testArgs += @("--filter", $Filter)
        } else {
            $testArgs += @("--filter", "Category=$TestCategory&$Filter")
        }
    }

    # Add coverage collection
    if ($RunCoverage) {
        $testArgs += @(
            "--collect:XPlat Code Coverage",
            "--settings", "$ProjectRoot\coverlet.runsettings"
        )
    }

    # Run tests
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

    & dotnet $testArgs

    $stopwatch.Stop()
    $testResult = $LASTEXITCODE -eq 0

    # Display results
    if ($testResult) {
        Write-Success "$DisplayName completed successfully in $($stopwatch.Elapsed.TotalSeconds) seconds"
    } else {
        Write-Error "$DisplayName failed"
    }

    return $testResult
}

function Generate-CoverageReport {
    Write-Header "Generating Coverage Report"

    # Install report generator if not already installed
    dotnet tool install -g dotnet-reportgenerator-globaltool 2>$null

    # Find coverage files
    $coverageFiles = Get-ChildItem -Path $ProjectRoot -Recurse -Filter "coverage.cobertura.xml" -ErrorAction SilentlyContinue

    if ($coverageFiles.Count -eq 0) {
        Write-Warning "No coverage data found"
        return
    }

    $coveragePaths = ($coverageFiles | ForEach-Object { $_.FullName }) -join ";"

    Write-Info "Found $($coverageFiles.Count) coverage file(s)"
    Write-Info "Generating HTML report..."

    # Generate report
    reportgenerator `
        -reports:$coveragePaths `
        -targetdir:$CoverageDir `
        -reporttypes:"Html;TextSummary;Badges;JsonSummary" `
        -verbosity:$(if ($Verbose) { "Info" } else { "Error" })

    if ($LASTEXITCODE -eq 0) {
        Write-Success "Coverage report generated: $CoverageDir\index.html"

        # Display summary
        $summaryFile = "$CoverageDir\Summary.txt"
        if (Test-Path $summaryFile) {
            Write-Header "Coverage Summary"
            Get-Content $summaryFile | ForEach-Object {
                if ($_ -match "Line coverage:.*?(\d+\.?\d*)%") {
                    $lineCoverage = [double]$matches[1]
                    $color = if ($lineCoverage -ge 80) { $ColorSuccess } elseif ($lineCoverage -ge 60) { $ColorWarning } else { $ColorError }
                    Write-Host "  $_" -ForegroundColor $color
                } else {
                    Write-Info $_
                }
            }
        }

        # Parse JSON summary for detailed metrics
        $jsonSummary = "$CoverageDir\Summary.json"
        if (Test-Path $jsonSummary) {
            $summary = Get-Content $jsonSummary | ConvertFrom-Json
            $coverage = $summary.summary

            Write-Header "Detailed Coverage Metrics"
            Write-Info "Line Coverage:   $($coverage.linecoverage)%"
            Write-Info "Branch Coverage: $($coverage.branchcoverage)%"
            Write-Info "Method Coverage: $($coverage.methodcoverage)%"
        }

        # Open report in browser
        if (-not $Verbose) {
            Write-Info "Opening coverage report in browser..."
            Start-Process "$CoverageDir\index.html"
        }
    } else {
        Write-Error "Failed to generate coverage report"
    }
}

function Run-SecurityScan {
    Write-Header "Running Security Scan"

    $securityScript = "$ProjectRoot\scripts\security-scan.ps1"

    if (Test-Path $securityScript) {
        & $securityScript
        return $LASTEXITCODE -eq 0
    } else {
        Write-Warning "Security scan script not found: $securityScript"
        Write-Info "Creating basic security checks..."

        # Basic security checks
        $issues = 0

        # Check for hardcoded credentials
        Write-Info "Scanning for hardcoded credentials..."
        $credentialPatterns = @(
            'password\s*=\s*"[^"]+"',
            'apiKey\s*=\s*"[^"]+"',
            'accessKey\s*=\s*"[^"]+"'
        )

        foreach ($pattern in $credentialPatterns) {
            $results = Get-ChildItem -Path $ProjectRoot -Recurse -Include *.cs,*.config,*.json -ErrorAction SilentlyContinue |
                Select-String -Pattern $pattern -CaseSensitive:$false

            if ($results) {
                Write-Warning "Potential hardcoded credentials found:"
                $results | ForEach-Object { Write-Warning "  $($_.Path):$($_.LineNumber)" }
                $issues++
            }
        }

        if ($issues -eq 0) {
            Write-Success "No security issues detected"
            return $true
        } else {
            Write-Warning "Found $issues potential security issue(s)"
            return $false
        }
    }
}

function Generate-TestReport {
    param([hashtable]$TestResults)

    Write-Header "Test Summary"

    $totalCategories = $TestResults.Count
    $passedCategories = ($TestResults.Values | Where-Object { $_ -eq $true }).Count

    # Display individual results
    foreach ($category in $TestResults.Keys | Sort-Object) {
        $status = if ($TestResults[$category]) { "PASS" } else { "FAIL" }
        $color = if ($TestResults[$category]) { $ColorSuccess } else { $ColorError }
        $icon = if ($TestResults[$category]) { "" } else { "" }

        Write-Host "  $icon $($category.PadRight(20)) : $status" -ForegroundColor $color
    }

    Write-Host ""
    Write-Host "  " -NoNewline
    Write-Host "Total: $passedCategories/$totalCategories passed" -ForegroundColor $(
        if ($passedCategories -eq $totalCategories) { $ColorSuccess } else { $ColorWarning }
    )

    # Generate markdown report
    $reportPath = "$ReportDir\day2-test-report-$Timestamp.md"
    $reportContent = @"
# DocuWorks Converter - Day 2 Test Report

**Date**: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
**Tester**: $env:USERNAME
**Environment**: Windows, .NET 7, LocalStack

## Summary

| Category | Status |
|----------|--------|
$(foreach ($category in $TestResults.Keys | Sort-Object) {
    $status = if ($TestResults[$category]) { "PASS" } else { "FAIL" }
    "| $category | $status |"
})

**Total**: $passedCategories/$totalCategories passed

## Test Artifacts

- Test Results: `$ReportDir\`
- Coverage Report: `$CoverageDir\index.html`
- Timestamp: $Timestamp

## Next Steps

$( if ($passedCategories -eq $totalCategories) {
    " Ready for Day 3 production deployment"
} else {
    " Review failed tests before proceeding to Day 3"
})

---
*Generated by run-all-tests.ps1*
"@

    $reportContent | Out-File -FilePath $reportPath -Encoding utf8
    Write-Info "Test report saved: $reportPath"
}

# ====================================================================================================
# Main Execution
# ====================================================================================================

Write-Header "DocuWorks Converter - Day 2 Test Runner"
Write-Info "Started at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host ""

# Create report directories
New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
New-Item -ItemType Directory -Path $CoverageDir -Force | Out-Null

# Check prerequisites
Test-Prerequisites

# Build project
if (-not (Build-Project)) {
    Write-Error "Build failed. Cannot proceed with tests."
    exit 1
}

# Determine which tests to run
$runUnit = $Unit -or $All
$runIntegration = $Integration -or $All
$runPerformance = $Performance -or $All
$runSecurity = $Security -or $All

# If no specific category selected, default to Unit tests
if (-not ($runUnit -or $runIntegration -or $runPerformance -or $runSecurity)) {
    $runUnit = $true
}

# Store test results
$testResults = @{}

# Run Unit Tests
if ($runUnit) {
    $testResults["Unit Tests"] = Run-Tests -TestCategory "Unit" -DisplayName "Unit Tests" -RunCoverage $Coverage
}

# Run Integration Tests
if ($runIntegration) {
    try {
        $testResults["Integration Tests"] = Run-Tests -TestCategory "Integration" -DisplayName "Integration Tests"
    } finally {
        # Stop LocalStack after integration tests
        if ($Integration -or $All) {
            Stop-LocalStack
        }
    }
}

# Run Performance Tests
if ($runPerformance) {
    $testResults["Performance Tests"] = Run-Tests -TestCategory "Performance" -DisplayName "Performance Tests"
}

# Run Security Scan
if ($runSecurity) {
    $testResults["Security Scan"] = Run-SecurityScan
}

# Generate coverage report if requested
if ($Coverage) {
    Generate-CoverageReport
}

# Generate test report
Generate-TestReport -TestResults $testResults

# Final summary
Write-Header "Test Execution Complete"
Write-Info "Completed at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

# Exit with appropriate code
$allPassed = ($testResults.Values | Where-Object { $_ -eq $false }).Count -eq 0
exit $(if ($allPassed) { 0 } else { 1 })
