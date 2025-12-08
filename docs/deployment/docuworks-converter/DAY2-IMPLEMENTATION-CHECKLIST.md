# Day 2 Implementation Checklist - AWS Integration

## Morning Session (8:00 AM - 12:00 PM)

### Phase 1: Environment Setup (30 minutes)

- [ ] **1.1 Install NuGet Packages**
  ```bash
  cd C:\DocuWorksConverter
  dotnet add package AWSSDK.S3 --version 3.7.400
  dotnet add package AWSSDK.SQS --version 3.7.400
  dotnet add package AWSSDK.CloudWatchLogs --version 3.7.400
  dotnet add package AWSSDK.Core --version 3.7.400
  dotnet add package Polly --version 8.2.0
  dotnet restore
  ```

- [ ] **1.2 Verify AWS CLI Configuration**
  ```bash
  aws --version
  aws configure list --profile AdministratorAccess-770923989980
  aws sts get-caller-identity --profile AdministratorAccess-770923989980
  ```

- [ ] **1.3 Create Configuration Files**
  - [ ] Create `appsettings.json` (copy from AWS-INTEGRATION-STRATEGY.md)
  - [ ] Create `appsettings.Development.json`
  - [ ] Create `.env` file for local testing
  - [ ] Add `.env` to `.gitignore`

### Phase 2: AWS Configuration Service (45 minutes)

- [ ] **2.1 Create Directory Structure**
  ```bash
  mkdir -p Services\AWS
  mkdir -p Tests\AWS
  ```

- [ ] **2.2 Implement AwsConfig.cs**
  - [ ] Create `Services\AWS\AwsConfig.cs`
  - [ ] Implement credential loading from profile
  - [ ] Implement configuration binding
  - [ ] Add validation logic

- [ ] **2.3 Test AwsConfig**
  - [ ] Create test project if not exists
  - [ ] Write unit tests for configuration loading
  - [ ] Verify credential resolution
  - [ ] Run tests: `dotnet test`

### Phase 3: S3 Client Implementation (60 minutes)

- [ ] **3.1 Implement S3ClientService.cs**
  - [ ] Create `Services\AWS\S3ClientService.cs`
  - [ ] Implement `UploadFileAsync` method
  - [ ] Implement `VerifyUploadAsync` method
  - [ ] Implement `GetFileMetadataAsync` method
  - [ ] Add retry logic with Polly
  - [ ] Add upload progress tracking

- [ ] **3.2 Test S3 Client**
  - [ ] Run connection verification: `.\Verify-AwsConnections.ps1`
  - [ ] Test file upload with 1MB file
  - [ ] Test file upload with 10MB file
  - [ ] Test file upload with 100MB file (multipart)
  - [ ] Verify error handling
  - [ ] Verify retry mechanism

### Phase 4: SQS Client Implementation (45 minutes)

- [ ] **4.1 Implement SQSClientService.cs**
  - [ ] Create `Services\AWS\SQSClientService.cs`
  - [ ] Implement `SendConversionNotificationAsync` method
  - [ ] Implement `GetQueueStatsAsync` method
  - [ ] Add message deduplication logic
  - [ ] Add retry logic with Polly

- [ ] **4.2 Test SQS Client**
  - [ ] Send test message to queue
  - [ ] Verify message appears in AWS Console
  - [ ] Test message attributes
  - [ ] Test queue statistics retrieval
  - [ ] Verify deduplication works

### Phase 5: Connection Verification (30 minutes)

- [ ] **5.1 Implement AwsConnectionVerifier.cs**
  - [ ] Create `Services\AWS\AwsConnectionVerifier.cs`
  - [ ] Implement S3 connection check
  - [ ] Implement SQS connection check
  - [ ] Implement CloudWatch connection check
  - [ ] Implement combined verification

- [ ] **5.2 Run Verification Scripts**
  - [ ] Run PowerShell script: `.\Verify-AwsConnections.ps1`
  - [ ] Run C# test harness
  - [ ] Document any errors encountered
  - [ ] Fix configuration issues

## Afternoon Session (1:00 PM - 5:00 PM)

### Phase 6: Integration Testing (60 minutes)

- [ ] **6.1 Create Integration Test Suite**
  - [ ] Create `Tests\AWS\AwsIntegrationTests.cs`
  - [ ] Implement S3 upload test
  - [ ] Implement SQS notification test
  - [ ] Implement connection verification test
  - [ ] Implement large file upload test

- [ ] **6.2 Run Integration Tests**
  ```bash
  dotnet test --filter Category=Integration
  ```
  - [ ] All tests pass
  - [ ] Review test coverage
  - [ ] Fix any failing tests
  - [ ] Document test results

### Phase 7: Performance Optimization (45 minutes)

- [ ] **7.1 Implement Upload Progress Monitor**
  - [ ] Create `Services\AWS\UploadProgressMonitor.cs`
  - [ ] Integrate with S3ClientService
  - [ ] Add progress logging
  - [ ] Add performance metrics

- [ ] **7.2 Performance Benchmarking**
  - [ ] Test 1MB file upload (target: < 1 second)
  - [ ] Test 10MB file upload (target: < 5 seconds)
  - [ ] Test 100MB file upload (target: < 30 seconds)
  - [ ] Test 500MB file upload (target: < 2 minutes)
  - [ ] Document upload speeds
  - [ ] Optimize if needed

### Phase 8: Error Handling & Retry Logic (45 minutes)

- [ ] **8.1 Test Error Scenarios**
  - [ ] Test with invalid credentials
  - [ ] Test with network disconnection
  - [ ] Test with full S3 bucket
  - [ ] Test with invalid SQS queue URL
  - [ ] Test with throttling

- [ ] **8.2 Verify Retry Mechanism**
  - [ ] Verify exponential backoff works
  - [ ] Verify max retry limit respected
  - [ ] Verify error logging is comprehensive
  - [ ] Verify graceful degradation

### Phase 9: CloudWatch Logs Integration (45 minutes)

- [ ] **9.1 Implement CloudWatch Logger**
  - [ ] Create `Services\AWS\CloudWatchLogger.cs`
  - [ ] Implement log event batching
  - [ ] Implement automatic flushing
  - [ ] Add error handling

- [ ] **9.2 Test CloudWatch Logging**
  - [ ] Enable CloudWatch in config
  - [ ] Generate test logs
  - [ ] Verify logs appear in AWS Console
  - [ ] Verify log formatting
  - [ ] Verify log retention

### Phase 10: Documentation & Code Review (45 minutes)

- [ ] **10.1 Code Documentation**
  - [ ] Add XML documentation comments
  - [ ] Document all public methods
  - [ ] Document configuration options
  - [ ] Add usage examples

- [ ] **10.2 Create README**
  - [ ] Document setup instructions
  - [ ] Document configuration options
  - [ ] Document testing procedures
  - [ ] Add troubleshooting section

- [ ] **10.3 Code Review**
  - [ ] Review error handling
  - [ ] Review logging
  - [ ] Review resource disposal
  - [ ] Review security considerations

## End of Day Verification

### Final Checklist

- [ ] **All Integration Tests Pass**
  ```bash
  dotnet test --filter Category=Integration --logger:console;verbosity=detailed
  ```

- [ ] **AWS Connection Verification**
  ```powershell
  .\Verify-AwsConnections.ps1
  ```
  All checks should pass:
  - [x] Prerequisites
  - [x] AWS Profile
  - [x] Network Connectivity
  - [x] S3 Access
  - [x] SQS Access
  - [x] CloudWatch Access

- [ ] **Performance Benchmarks**
  | File Size | Target Time | Actual Time | Status |
  |-----------|-------------|-------------|--------|
  | 1 MB      | < 1s        | ____s       | [ ]    |
  | 10 MB     | < 5s        | ____s       | [ ]    |
  | 100 MB    | < 30s       | ____s       | [ ]    |
  | 500 MB    | < 2m        | ____s       | [ ]    |

- [ ] **Code Quality Checks**
  - [ ] No compiler warnings
  - [ ] No TODO comments
  - [ ] All using statements organized
  - [ ] All resources properly disposed
  - [ ] All async methods follow best practices

- [ ] **Documentation Complete**
  - [ ] README.md created
  - [ ] API documentation complete
  - [ ] Configuration guide complete
  - [ ] Troubleshooting guide complete

## Day 2 Deliverables

### Code Artifacts
- [ ] `Services\AWS\AwsConfig.cs`
- [ ] `Services\AWS\S3ClientService.cs`
- [ ] `Services\AWS\SQSClientService.cs`
- [ ] `Services\AWS\AwsConnectionVerifier.cs`
- [ ] `Services\AWS\UploadProgressMonitor.cs`
- [ ] `Services\AWS\CloudWatchLogger.cs`
- [ ] `Tests\AWS\AwsIntegrationTests.cs`

### Documentation
- [ ] `README-AWS-INTEGRATION.md`
- [ ] `CONFIGURATION-GUIDE.md`
- [ ] `TROUBLESHOOTING.md`
- [ ] Performance benchmark results
- [ ] Integration test results

### Configuration Files
- [ ] `appsettings.json`
- [ ] `appsettings.Development.json`
- [ ] `.env.example`
- [ ] `Verify-AwsConnections.ps1`
- [ ] `Quick-HealthCheck.ps1`

## Common Issues & Solutions

### Issue 1: "Access Denied" on S3 Upload

**Symptoms**: `AmazonS3Exception: Access Denied`

**Solution**:
```bash
# Verify IAM permissions
aws iam get-user --profile AdministratorAccess-770923989980

# Test S3 access directly
aws s3 ls s3://cis-filesearch-s3-landing --profile AdministratorAccess-770923989980

# Check bucket policy
aws s3api get-bucket-policy --bucket cis-filesearch-s3-landing
```

### Issue 2: "Queue does not exist" on SQS

**Symptoms**: `AmazonSQSException: AWS.SimpleQueueService.NonExistentQueue`

**Solution**:
```bash
# Verify queue exists
aws sqs get-queue-url --queue-name cis-filesearch-queue --profile AdministratorAccess-770923989980

# List all queues
aws sqs list-queues --profile AdministratorAccess-770923989980
```

### Issue 3: Slow Upload Performance

**Symptoms**: Uploads taking longer than expected

**Solutions**:
1. Increase concurrent service requests:
   ```csharp
   var transferConfig = new TransferUtilityConfig
   {
       ConcurrentServiceRequests = 20  // Increase from 10
   };
   ```

2. Adjust part size:
   ```csharp
   MinSizeBeforePartUpload = 50 * 1024 * 1024  // 50MB instead of 100MB
   ```

3. Check network speed:
   ```powershell
   Test-NetConnection s3.ap-northeast-1.amazonaws.com -Port 443
   ```

### Issue 4: "CredentialsNotFound" Error

**Symptoms**: `Amazon.Runtime.AmazonServiceException: Unable to find credentials`

**Solution**:
```bash
# Configure AWS credentials
aws configure --profile AdministratorAccess-770923989980

# Verify credentials file
cat ~/.aws/credentials

# Or use environment variables
set AWS_ACCESS_KEY_ID=your_access_key
set AWS_SECRET_ACCESS_KEY=your_secret_key
set AWS_DEFAULT_REGION=ap-northeast-1
```

### Issue 5: Multipart Upload Failures

**Symptoms**: Large files fail during upload

**Solution**:
```csharp
// Add more aggressive retry policy
var retryConfig = new RetryConfig
{
    MaxRetryAttempts = 5,  // Increase from 3
    InitialBackoffSeconds = 1,
    MaxBackoffSeconds = 60
};

// Reduce part size for better reliability
var transferConfig = new TransferUtilityConfig
{
    MinSizeBeforePartUpload = 50 * 1024 * 1024,  // 50MB
    ConcurrentServiceRequests = 5  // Reduce concurrency
};
```

## Performance Optimization Tips

### 1. Use Transfer Acceleration (Optional)

```csharp
var s3ClientConfig = new AmazonS3Config
{
    RegionEndpoint = awsConfig.Region,
    UseAccelerateEndpoint = true  // Enable Transfer Acceleration
};
```

**Note**: Requires S3 Transfer Acceleration to be enabled on the bucket.

### 2. Optimize Buffer Sizes

```csharp
// For large files
var transferRequest = new TransferUtilityUploadRequest
{
    FilePath = filePath,
    BucketName = bucket,
    Key = key,
    PartSize = 10 * 1024 * 1024  // 10MB parts for better throughput
};
```

### 3. Connection Pooling

```csharp
// Reuse S3 client instances
// Already implemented in S3ClientService as a singleton
```

### 4. Async/Await Best Practices

```csharp
// Use ConfigureAwait(false) for library code
await _s3Client.UploadAsync(request, cancellationToken).ConfigureAwait(false);
```

## Security Checklist

- [ ] Credentials not hardcoded
- [ ] Credentials not in source control
- [ ] Using IAM roles when possible
- [ ] Encryption in transit (HTTPS)
- [ ] Server-side encryption enabled on S3
- [ ] Least privilege IAM permissions
- [ ] CloudTrail logging enabled
- [ ] VPC endpoints configured (if on AWS)
- [ ] Security groups properly configured

## Monitoring Setup

### CloudWatch Metrics to Monitor

1. **S3 Metrics**
   - BucketSize
   - NumberOfObjects
   - AllRequests
   - 4xxErrors
   - 5xxErrors

2. **SQS Metrics**
   - ApproximateNumberOfMessagesVisible
   - ApproximateNumberOfMessagesNotVisible
   - NumberOfMessagesSent
   - NumberOfMessagesReceived

3. **Custom Metrics**
   - Upload success rate
   - Average upload time
   - Error rate by error type
   - Queue processing lag

### CloudWatch Alarms to Create

```bash
# High error rate alarm
aws cloudwatch put-metric-alarm \
  --alarm-name docuworks-converter-high-error-rate \
  --alarm-description "Alert when error rate exceeds 5%" \
  --metric-name ErrorRate \
  --namespace CIS/DocuWorksConverter \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 5.0 \
  --comparison-operator GreaterThanThreshold \
  --profile AdministratorAccess-770923989980
```

## Day 3 Preparation

### Tomorrow's Focus: Production Deployment

- [ ] Windows Service installation
- [ ] Startup configuration
- [ ] Health monitoring
- [ ] Automatic restart on failure
- [ ] Log rotation
- [ ] Security hardening

### Pre-read Documentation

- Windows Service creation in .NET 7
- AWS Systems Manager for remote management
- AWS CloudWatch dashboard creation
- S3 lifecycle policies
- SQS dead-letter queues

## Success Criteria

Day 2 is considered successful if:

1. ✅ All AWS services (S3, SQS, CloudWatch) are accessible
2. ✅ File uploads work reliably for all file sizes
3. ✅ SQS notifications are sent successfully
4. ✅ Integration tests pass with 100% success rate
5. ✅ Performance benchmarks meet targets
6. ✅ Error handling and retry logic work as expected
7. ✅ Code is well-documented and reviewed
8. ✅ All deliverables are complete

## Time Tracking

| Phase | Estimated | Actual | Notes |
|-------|-----------|--------|-------|
| Environment Setup | 30m | ___m | |
| AWS Config | 45m | ___m | |
| S3 Client | 60m | ___m | |
| SQS Client | 45m | ___m | |
| Connection Verifier | 30m | ___m | |
| Integration Tests | 60m | ___m | |
| Performance Optimization | 45m | ___m | |
| Error Handling | 45m | ___m | |
| CloudWatch Logs | 45m | ___m | |
| Documentation | 45m | ___m | |
| **Total** | **7h 30m** | ___m | |

## Notes & Observations

_Add notes here as you work through the day_

---

**Remember**: Take breaks, stay hydrated, and don't hesitate to ask for help if stuck!
